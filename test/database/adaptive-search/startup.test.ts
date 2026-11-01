import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { file, reset, sql, sqlAsync } from '../../support/database/postgres';

before(() => reset());
import { projectAdaptiveSearchStartup } from '../../../src/features/meta-search/domain/adaptiveSearchStartup';

test('AF-07 one startup call returns a bounded authorized bundle with pinned revisions and privacy-safe retries', () => {
  sql(file('supabase/tests/opportunity_search_adaptive_startup.sql'));
});

test('AF-07 concurrent logical starts serialize one active run and exact retries reuse its frozen context', async () => {
  assert.equal(sql("select to_regprocedure('private.begin_adaptive_opportunity_search(uuid,uuid)') is not null;"), 't', 'Install startup prerequisites before creating fixtures');
  const owner = randomUUID(), search = randomUUID(), first = randomUUID(), second = randomUUID();
  const project = 'abcdefghijklmnopqrst';
  const opportunityCount = sql('select count(*) from public.opportunities;');
  const scheduleCount = sql('select count(*) from public.opportunity_search_schedule_bindings;');
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic concurrency search','{"topicsAndMethods":"Acoustic sensing; BCI"}',
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    select set_config('request.jwt.claims','{"sub":"${owner}","is_anonymous":false}',false);
    set role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    reset role;`);
  try {
    const replies = await Promise.all([first, second].map(run =>
      sqlAsync(`select private.begin_adaptive_opportunity_search('${search}','${run}');`).then(JSON.parse)));
    assert.equal(replies.filter(reply => reply.compatible).length, 1, 'Overlapping runs both acquired execution authority');
    assert.equal(replies.find(reply => !reply.compatible)?.error.code, 'run_in_progress');
    const bundle = replies.find(reply => reply.compatible)!;
    assert.equal(bundle.scope.user_id, owner); assert.equal(bundle.scope.search_id, search);
    const run = bundle.scope.run_id;
    const retries = await Promise.all([1, 2].map(() =>
      sqlAsync(`select private.begin_adaptive_opportunity_search('${search}','${run}');`).then(JSON.parse)));
    for (const retry of retries) assert.deepEqual(retry, bundle, 'An exact concurrent retry changed pinned semantic inputs');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${search}';`), '1');
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_contexts where search_id='${search}';`), '1');
    assert.equal(sql('select count(*) from public.opportunities;'), opportunityCount, 'Startup wrote canonical opportunities');
    assert.equal(sql('select count(*) from public.opportunity_search_schedule_bindings;'), scheduleCount, 'Startup changed a scheduled-task binding');
  } finally {
    sql(`delete from auth.users where id='${owner}';
      update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  }
});

test('the current SQL bundle passes the same complete DTO projector used for preview', async () => {
  reset();
  assert.equal(sql("select to_regprocedure('private.begin_adaptive_opportunity_search(uuid,uuid)') is not null;"), 't', 'Install startup prerequisites before creating fixtures');
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), project = 'abcdefghijklmnopqrst';
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','PRIVATE_SEARCH_NAME_CANARY',
        '{"opportunityTypes":"Funded research opportunities","topicsAndMethods":"Acoustic sensing; BCI","fundingAndConditions":"Start around 2027-01-01; funding EUR 50000–70000 per year"}',
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    select set_config('request.jwt.claims','{"sub":"${owner}","is_anonymous":false}',false);
    set role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    reset role;`);
  try {
    const proof = JSON.parse(sql(`select jsonb_build_object('authorization_epoch',a.authorization_epoch,'authorization_revision',a.authorization_revision,
      'release_revision',technical_release.release_revision,'protocol_version',p.version,'protocol_hash',p.protocol_hash)
      from public.opportunity_search_runner_authorizations a cross join public.opportunity_search_adaptive_release technical_release
      cross join private.opportunity_search_settings settings join private.opportunity_search_protocols p on p.version=settings.active_protocol_version
      where a.user_id='${owner}' and a.search_id='${search}' and technical_release.singleton;`));
    const actual = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${search}','${run}');`));
    assert.equal(actual.compatible, true, JSON.stringify(actual));
    const authorizedSourceIds = JSON.parse(sql(`select coalesce(jsonb_agg(registry_id::text order by registry_id),'[]')
      from public.opportunity_search_sources where user_id='${owner}' and search_id='${search}' and enabled and not owner_disabled;`));
    const projected = await projectAdaptiveSearchStartup(actual, { expected_run_id: run,
      binding: { ...proof, project_ref: project, user_id: owner, search_id: search, enabled: true, authorized: true },
      privacy: { adaptation_enabled: false, adaptation_paused: false,
        successful_source_reuse_enabled: false, privacy_scope_changed: false,
        excluded_opportunity_ids: [], included_summaries: [], authorized_source_ids: authorizedSourceIds } });
    assert.equal(projected.compatible, true, JSON.stringify(projected));
    for (const field of Object.keys(actual)) assert.deepEqual(projected[field as keyof typeof projected], actual[field], `Server and preview disagreed on ${field}`);
    assert.doesNotMatch(JSON.stringify(actual), /PRIVATE_SEARCH_NAME_CANARY/u);
    assert.ok(Buffer.byteLength(JSON.stringify(actual)) <= 262_144);
  } finally {
    sql(`delete from auth.users where id='${owner}';
      update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  }
});

test('AF-07 owner revocation and startup use a consistent lock order and fail closed', async () => {
  assert.equal(sql("select to_regprocedure('private.begin_adaptive_opportunity_search(uuid,uuid)') is not null;"), 't');
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), project = 'abcdefghijklmnopqrst';
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic revocation race','{"topicsAndMethods":"Acoustic sensing"}',
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    select set_config('request.jwt.claims','{"sub":"${owner}","is_anonymous":false}',false);
    set role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    reset role;`);
  let locked!: () => void;
  const ownerHasTemplateLock = new Promise<void>(resolve => { locked = resolve; });
  let ownerFinished = false;
  const revocation = sqlAsync(`begin;
    select set_config('request.jwt.claims','{"sub":"${owner}","is_anonymous":false}',true);
    set local role authenticated;
    select id from public.opportunity_search_templates where id='${search}' for update;
    select 'owner_has_template_lock';
    select pg_sleep(0.75);
    select public.set_opportunity_search_runner_authorization('${search}','${project}',false,1);
    commit;`, chunk => { if (chunk.includes('owner_has_template_lock')) locked(); })
    .finally(() => { ownerFinished = true; });
  let starter: Promise<string> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([ownerHasTemplateLock, revocation.then(() => { throw new Error('Owner transaction ended before the lock barrier'); }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owner lock barrier timed out')), 5000); })]);
    clearTimeout(timer);
    assert.equal(ownerFinished, false, 'The concurrency fixture did not overlap transactions');
    starter = sqlAsync(`select private.begin_adaptive_opportunity_search('${search}','${run}');`);
    const [, reply] = await Promise.all([revocation, starter]);
    const result = JSON.parse(reply);
    assert.equal(result.compatible, false); assert.equal(result.error.code, 'authorization_revoked');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${search}';`), '0');
  } finally {
    clearTimeout(timer);
    await Promise.allSettled([revocation, ...(starter ? [starter] : [])]);
    sql(`delete from auth.users where id='${owner}';
      update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  }
});
