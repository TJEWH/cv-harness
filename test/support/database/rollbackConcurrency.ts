import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adaptiveJsonSqlLiteral } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';
import { sql, sqlAsync } from './postgres';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
type Json = Record<string, any>;

/** Run only at the end of the fully installed, labelled disposable release suite.
 * Task receipts below are explicitly synthetic attestations. No scheduler,
 * production database, schema reset or permission change is performed here.
 */
export async function runConcurrentRollbackAckRegression(): Promise<void> {
  const owner = randomUUID(), search = randomUUID(), setup = randomUUID(), rollback = randomUUID();
  const project = 'cccccccccccccccccccc', task = `synthetic-rollback-concurrency-${randomUUID()}`;
  const schedule = { frequency: 'daily', intervalHours: 24, weekdays: [], time: '08:00', timezone: 'UTC', runImmediately: false };
  const meta = { version: 1, active: true, editor: { id: 'shared', name: 'Synthetic rollback concurrency', researchInterests: 'Acoustic sensing; BCI' },
    systemPrompt: 'Synthetic shared search protocol.', userPrompt: 'Synthetic public research interests.', recurringPrompt: 'Run the saved shared research without changing scheduled tasks.' };
  const ownerCall = (statement: string) => `begin;
    do $owner$ begin perform set_config('request.jwt.claims',${adaptiveJsonSqlLiteral({ sub: owner,is_anonymous: false })}::text,true);end $owner$;
    set local role authenticated;
    ${statement};
    commit;`;
  const snapshot = () => JSON.parse(sql(`select jsonb_build_object(
    'template_revision',t.revision,'binding_template_revision',b.template_revision,'binding_task_id',b.task_id,
    'binding_setup_id',b.confirmed_setup_id,'binding_capability',b.runner_capability,'binding_confirmed_at',b.confirmed_at,
    'runner_revision',c.revision,'mode',c.mode,'migration_requested',c.migration_requested,
    'rollback_acknowledgements',(select count(*) from private.opportunity_search_setup_acknowledgements where setup_id=${quote(rollback)}::uuid),
    'owner_runs',(select count(*) from public.opportunity_search_runs where user_id=${quote(owner)}::uuid),
    'global_runs',(select count(*) from public.opportunity_search_runs))
    from public.opportunity_search_templates t join public.opportunity_search_schedule_bindings b on b.search_id=t.id and b.user_id=t.user_id
    join public.opportunity_search_runner_config c on c.search_id=t.id and c.user_id=t.user_id where t.id=${quote(search)}::uuid;`)) as Json;
  const pending: Promise<unknown>[] = [];
  const originalRuns = Number(sql('select count(*) from public.opportunity_search_runs;'));
  assert.equal(sql('select enabled or project_ref is not null from public.opportunity_search_adaptive_release where singleton;'),'f',
    'The concurrency gate must start after earlier release cases restored the default-off state.');
  try {
    sql(`insert into auth.users(id) values(${quote(owner)}::uuid);
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search)
        values(${quote(search)}::uuid,${quote(owner)}::uuid,'Synthetic concurrent rollback',
          ${adaptiveJsonSqlLiteral({ topicsAndMethods: 'Acoustic sensing; BCI' })},${adaptiveJsonSqlLiteral(schedule)},${adaptiveJsonSqlLiteral(meta)});
      update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;`);
    const authorization = JSON.parse(sql(ownerCall(`select public.set_opportunity_search_runner_authorization(${quote(search)}::uuid,${quote(project)},true,0)`))) as Json;
    assert.equal(authorization.enabled,true);
    const requestedSetup = JSON.parse(sql(ownerCall(`select public.request_adaptive_search_migration(${quote(search)}::uuid,${quote(project)},0,${quote(setup)}::uuid)`))) as Json;
    assert.equal(requestedSetup.migration_requested,true);
    const handoff = JSON.parse(sql(`select private.read_adaptive_search_setup(${quote(search)}::uuid,${quote(setup)}::uuid,${quote(project)});`)) as Json;
    assert.equal(handoff.compatible,true,JSON.stringify(handoff));
    assert.equal(handoff.target.requires_explicit_selection,true);
    const setupPayload = structuredClone(handoff.acknowledgement.payload_template) as Json;
    setupPayload.operation = 'create'; setupPayload.task_id = task; setupPayload.explicit_selection_confirmed = true;
    setupPayload.task_tool_receipt = { ...setupPayload.task_tool_receipt,task_id: task,operation: 'create' };
    const setupAck = JSON.parse(sql(`select private.ack_adaptive_search_setup(${quote(search)}::uuid,${quote(setup)}::uuid,${adaptiveJsonSqlLiteral(setupPayload)});`)) as Json;
    assert.equal(setupAck.acknowledged,true,JSON.stringify(setupAck));
    assert.equal(setupAck.mode,'adaptive'); assert.equal(setupAck.task_id,task);

    const releaseRevision = Number(sql('select release_revision from public.opportunity_search_adaptive_release where singleton;'));
    const stopped = JSON.parse(sql(`select private.disable_adaptive_search_release(${quote(project)},${releaseRevision});`)) as Json;
    assert.equal(stopped.adaptive_database_disabled,true);
    const runnerRevision = Number(sql(`select revision from public.opportunity_search_runner_config where user_id=${quote(owner)}::uuid and search_id=${quote(search)}::uuid;`));
    const request = JSON.parse(sql(ownerCall(`select public.request_adaptive_search_rollback(${quote(search)}::uuid,${quote(project)},${runnerRevision},0,${quote(rollback)}::uuid,true)`))) as Json;
    assert.equal(request.task_changed,false); assert.equal(request.rollback_revision,1);
    const rollbackHandoff = JSON.parse(sql(`select private.read_adaptive_search_rollback(${quote(search)}::uuid,${quote(rollback)}::uuid,${quote(project)});`)) as Json;
    assert.equal(rollbackHandoff.compatible,true,JSON.stringify(rollbackHandoff));
    assert.equal(rollbackHandoff.target.task_id,task); assert.equal(rollbackHandoff.rollback.adaptive_database_disabled,true);
    const payload = rollbackHandoff.acknowledgement.payload_template as Json;
    assert.equal(payload.operation,'update'); assert.equal(payload.task_id,task);
    const before = snapshot();
    assert.equal(before.mode,'adaptive'); assert.equal(before.rollback_acknowledgements,0); assert.equal(before.owner_runs,0);

    // A bounded row-lock barrier makes both independent psql sessions contend
    // before either acknowledgement proceeds. The marker is streamed by the
    // shared driver; no sleeps are used as an assumption that a race happened.
    const suffix = rollback.replaceAll('-','').slice(0,12);
    const sessions = [`af11-rollback-${suffix}-a`,`af11-rollback-${suffix}-b`];
    let releaseReady!: () => void, rejectReady!: (cause: unknown) => void;
    const ready = new Promise<void>((resolve,reject) => { releaseReady = resolve; rejectReady = reject; });
    let output = '';
    const holder = sqlAsync(`set statement_timeout='20s';begin;
      select 1 from public.opportunity_search_templates where id=${quote(search)}::uuid for no key update;
      select 'AF11_ROLLBACK_LOCK_READY';
      do $barrier$ declare deadline timestamptz:=clock_timestamp()+interval '10 seconds';waiting integer;
      begin loop
        perform pg_stat_clear_snapshot();
        select count(*) into waiting from pg_stat_activity where application_name in(${sessions.map(quote).join(',')}) and wait_event_type='Lock';
        exit when waiting=2;
        if clock_timestamp()>deadline then raise exception 'Both synthetic rollback acknowledgements did not reach the row-lock barrier';end if;
        perform pg_sleep(0.01);
      end loop;end $barrier$;
      select 'AF11_ROLLBACK_BOTH_ACKS_WAITING';commit;`,chunk => {
      output += chunk; if (output.includes('AF11_ROLLBACK_LOCK_READY')) releaseReady();
    });
    pending.push(holder); void holder.catch(rejectReady);
    await ready;
    const acknowledgementSql = `select private.ack_adaptive_search_rollback(${quote(search)}::uuid,${quote(rollback)}::uuid,${adaptiveJsonSqlLiteral(payload)});`;
    const acknowledgements = sessions.map(session => sqlAsync(`set application_name=${quote(session)};set statement_timeout='20s';${acknowledgementSql}`));
    pending.push(...acknowledgements);
    const settled = await Promise.allSettled([holder,...acknowledgements]);
    for (const result of settled) if (result.status==='rejected') throw result.reason;
    assert.match((settled[0] as PromiseFulfilledResult<string>).value,/AF11_ROLLBACK_BOTH_ACKS_WAITING/);
    const replies = settled.slice(1).map(result => JSON.parse((result as PromiseFulfilledResult<string>).value) as Json);
    for (const reply of replies) {
      assert.equal(reply.acknowledged,true,JSON.stringify(reply)); assert.equal(reply.setup_id,rollback);
      assert.equal(reply.task_id,task); assert.equal(reply.mode,'legacy'); assert.equal(reply.rollback_contract_version,1);
    }
    assert.deepEqual(replies.map(reply=>reply.historical).sort(),[false,true],
      'Concurrent identical acknowledgements must publish once and return one historical receipt.');
    const after = snapshot();
    assert.equal(after.rollback_acknowledgements,1); assert.equal(after.mode,'legacy'); assert.equal(after.migration_requested,false);
    assert.equal(after.template_revision,before.template_revision+1,'Concurrent acknowledgements advanced template publication more than once.');
    assert.equal(after.binding_template_revision,before.binding_template_revision+1,'Task binding template revision advanced more than once.');
    assert.equal(after.binding_template_revision,after.template_revision);
    assert.equal(after.runner_revision,before.runner_revision+1,'The confirmed runner mode advanced more than once.');
    assert.equal(after.binding_setup_id,rollback); assert.equal(after.binding_task_id,task); assert.equal(after.binding_capability,'legacy-v1');
    assert.equal(after.owner_runs,0); assert.equal(after.global_runs,originalRuns,'A setup or rollback acknowledgement fabricated a research run.');
  } finally {
    await Promise.allSettled(pending);
    sql(`delete from auth.users where id=${quote(owner)}::uuid;
      update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  }
}
