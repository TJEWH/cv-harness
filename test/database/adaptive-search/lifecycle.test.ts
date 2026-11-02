import { resetHistoricalAdaptiveBatchFixture } from '../../support/database/historicalAdaptiveBatch';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, sql, sqlAsync } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => resetHistoricalAdaptiveBatchFixture());

test('lifecycle contract preserves partial work, pins owner scope and fences stale workers', () => {
  sql(file('supabase/tests/opportunity_search_lifecycle.sql'));
});

const project = 'llllllllllllllllllll';
function fixture() {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), operation = randomUUID();
  const batch = randomUUID(), query = randomUUID(), check = randomUUID();
  sql(`do $$ begin
    insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic lifecycle race','{"topicsAndMethods":"Synthetic race"}',
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    perform set_config('request.jwt.claims','{"sub":"${owner}","is_anonymous":false}',true);
    execute 'set local role authenticated';
    perform public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    execute 'reset role';
    insert into public.opportunity_search_runner_config(user_id,search_id,project_ref,mode,migration_requested,setup_id)
      values('${owner}','${search}','${project}','adaptive',false,gen_random_uuid());
    insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
      values('${search}','${owner}','synthetic-${search}',
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}',
        1,'opportunity-search-v1-canonical-6','adaptive-batch-v1');
  end $$;`);
  const startup = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${search}','${run}');`));
  assert.equal(startup.compatible, true, JSON.stringify(startup));
  const attempted = new Date().toISOString();
  const payload = { schema_version: 1, query_plan: { schema_version: 2, queries: [{ query_id: query,
    query: 'synthetic lifecycle race query', role: 'core', manual: false }] }, opportunities: [],
  execution: { checks: [{ check_id: check, kind: 'query', query_id: query, attempted_at: attempted, status: 'complete', results_count: 0 },
    ...(startup.due_sources as { registry_id: string }[]).map(source => ({ check_id: randomUUID(), kind: 'source',
      source_registry_id: source.registry_id, attempted_at: attempted, status: 'complete', results_count: 0 }))], complete: true } };
  return { owner, search, run, operation, batch, payload, checkCount: payload.execution.checks.length,
    batchSql: `select private.submit_adaptive_search_batch('${run}','${batch}',${adaptiveJsonSqlLiteral(payload)});`,
    abortSql: `select private.apply_adaptive_search_lifecycle('${operation}');`,
    cleanup: () => sql(`delete from auth.users where id='${owner}';`) };
}
type Fixture = ReturnType<typeof fixture>;
function prepare(f: Fixture, mode = 'abort') {
  return JSON.parse(sql(`do $$ begin perform set_config('request.jwt.claims','{"sub":"${f.owner}","is_anonymous":false}',false);end $$;
    set role authenticated;
    select public.prepare_adaptive_search_lifecycle('${f.search}','${project}','${mode}','${f.operation}');
    reset role;`));
}
function ownerCall(f: Fixture, expression: string) {
  return JSON.parse(sql(`do $$ begin perform set_config('request.jwt.claims','{"sub":"${f.owner}","is_anonymous":false}',false);end $$;
    set role authenticated;select ${expression};reset role;`));
}
function jsonRow(output: string) { return JSON.parse(output.split('\n').find(line => line.startsWith('{'))!); }

/** Start the second real transaction only after the first holds its mutation lock. */
async function overlap(firstStatement: string, secondStatement: string) {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const first = sqlAsync(`begin;set local statement_timeout='10s';${firstStatement}
    select 'lifecycle_mutation_lock_held';select pg_sleep(0.3);commit;`,
  chunk => { if (chunk.includes('lifecycle_mutation_lock_held')) release(); });
  let second: Promise<string> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([barrier, first.then(() => { throw new Error('Transaction ended before lock overlap'); }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Lifecycle lock barrier timed out')), 5000); })]);
    clearTimeout(timer);
    second = sqlAsync(`set statement_timeout='10s';${secondStatement}`);
    return await Promise.all([first, second]);
  } finally {
    clearTimeout(timer);
    await Promise.allSettled([first, ...(second ? [second] : [])]);
  }
}

for (const winner of ['batch', 'abort'] as const) test(`a ${winner} winning the cancellation race cannot leave post-abort work`, async () => {
  const f = fixture();
  try {
    assert.equal(prepare(f).outcome, 'prepared');
    const [first, second] = await overlap(winner === 'batch' ? f.batchSql : f.abortSql, winner === 'batch' ? f.abortSql : f.batchSql);
    const batch = jsonRow(winner === 'batch' ? first : second), abort = jsonRow(winner === 'abort' ? first : second);
    if (winner === 'batch') assert.equal(batch.verification_required, true, JSON.stringify(batch));
    else assert.equal(batch.accepted, false, JSON.stringify(batch));
    assert.equal(abort.outcome, 'aborted');
    assert.equal(sql(`select status from public.opportunity_search_runs where id='${f.run}';`), 'failed');
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_batches where run_id='${f.run}';`), winner === 'batch' ? '1' : '0');
    assert.equal(sql(`select count(*) from public.opportunity_search_executions where run_id='${f.run}';`), winner === 'batch' ? String(f.checkCount) : '0');
    const readback = JSON.parse(sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`));
    assert.equal(readback.abort.verified, true); assert.equal(readback.abort.lease_released, true);
  } finally { f.cleanup(); }
});

for (const winner of ['completion', 'abort'] as const) test(`a ${winner} winning the completion race leaves one terminal outcome`, async () => {
  const f = fixture();
  try {
    const batch = JSON.parse(sql(f.batchSql)); assert.equal(batch.verification_required, true, JSON.stringify(batch));
    const completion = { schema_version: 1, completion_id: randomUUID(), batch_ids: [f.batch], manifest_hash: batch.manifest_hash, status: 'complete' };
    const completionSql = `select private.verify_and_complete_adaptive_search('${f.run}',${adaptiveJsonSqlLiteral(completion)});`;
    assert.equal(prepare(f).outcome, 'prepared');
    const [first, second] = await overlap(winner === 'completion' ? completionSql : f.abortSql,
      winner === 'completion' ? f.abortSql : completionSql);
    const completed = jsonRow(winner === 'completion' ? first : second), abort = jsonRow(winner === 'abort' ? first : second);
    if (winner === 'completion') {
      assert.equal(completed.compatible, true); assert.equal(completed.historical_summary.status, 'complete', JSON.stringify(completed));
      assert.equal(abort.outcome, 'target_changed');
      assert.equal(sql(`select status from public.opportunity_search_runs where id='${f.run}';`), 'complete');
    } else {
      assert.equal(abort.outcome, 'aborted'); assert.equal(completed.compatible, false);
      assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_completions where run_id='${f.run}';`), '0');
      assert.equal(sql(`select status from public.opportunity_search_runs where id='${f.run}';`), 'failed');
    }
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_batches where run_id='${f.run}';`), '1');
  } finally { f.cleanup(); }
});

test('concurrent scheduled and reserved restart startup permits only one new active execution', async () => {
  const f = fixture();
  try {
    const prepared = prepare(f, 'abort_and_restart'), reserved = prepared.restart.run_id, scheduled = randomUUID();
    assert.ok(reserved); sql(f.abortSql);
    const verified = JSON.parse(sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`));
    assert.equal(verified.abort.verified, true);
    const replies = await Promise.all([reserved, scheduled].map(run =>
      sqlAsync(`set statement_timeout='10s';select private.begin_adaptive_opportunity_search('${f.search}','${run}');`).then(JSON.parse)));
    assert.equal(replies.filter(reply => reply.compatible === true).length, 1);
    assert.equal(replies.filter(reply => reply.compatible === false).length, 1);
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}' and status='running';`), '1');
    assert.equal(prepare(f, 'abort_and_restart').restart.run_id, reserved);
  } finally { f.cleanup(); }
});

test('a once-reserved restart needs committed abort readback and uses the current saved definition', () => {
  const f = fixture();
  try {
    const prepared = prepare(f, 'abort_and_restart'), reserved = prepared.restart.run_id;
    const aborted = JSON.parse(sql(f.abortSql));
    assert.equal(aborted.outcome, 'aborted'); assert.equal(aborted.abort.verified, false);
    assert.equal(aborted.restart.status, 'reserved_not_dispatched'); assert.equal(aborted.restart.dispatch_receipt, null);
    const tooEarly = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${reserved}');`));
    assert.equal(tooEarly.compatible, false);
    const verified = JSON.parse(sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`));
    assert.equal(verified.abort.verified, true); assert.equal(verified.abort.lease_released, true);
    sql(`update public.opportunity_search_templates set criteria='{"topicsAndMethods":"CURRENT_SAVED_RESTART_DEFINITION"}',revision=revision+1 where id='${f.search}';`);
    const start = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${reserved}');`));
    assert.equal(start.compatible, true); assert.equal(start.base.criteria.topicsAndMethods, 'CURRENT_SAVED_RESTART_DEFINITION');
    assert.equal(JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${reserved}');`)).compatible, true);
    assert.equal(prepare(f, 'abort_and_restart').restart.run_id, reserved);
    const readback = JSON.parse(sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`));
    assert.equal(readback.restart.status, 'startup_accepted'); assert.equal(readback.restart.dispatch_receipt, null);
    assert.equal(readback.worker_termination, 'unknown'); assert.equal(readback.delivery_status, 'unknown');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}' and status='running';`), '1');
  } finally { f.cleanup(); }
});

test('two owner commands pin the same target and cannot dispatch two eligible restarts', () => {
  const f = fixture(), duplicate = { ...f, operation: randomUUID() };
  try {
    const first = prepare(f, 'abort_and_restart'), second = prepare(duplicate, 'abort_and_restart');
    assert.equal(first.target.run_id, f.run); assert.equal(second.target.run_id, f.run);
    assert.notEqual(first.restart.run_id, second.restart.run_id);
    assert.equal(JSON.parse(sql(f.abortSql)).outcome, 'aborted');
    const rejected = JSON.parse(sql(`select private.apply_adaptive_search_lifecycle('${duplicate.operation}');`));
    assert.equal(rejected.outcome, 'target_changed');
    assert.equal(rejected.restart.status, 'blocked');
    sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`);
    const started = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${first.restart.run_id}');`));
    assert.equal(started.compatible, true);
    const denied = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${second.restart.run_id}');`));
    assert.equal(denied.compatible, false);
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}' and status='running';`), '1');
  } finally { f.cleanup(); }
});

test('a scheduled winner blocks the reserved restart without undoing cancellation', () => {
  const f = fixture();
  try {
    const prepared = prepare(f, 'abort_and_restart'), rival = randomUUID();
    sql(f.abortSql); sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`);
    assert.equal(JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${rival}');`)).compatible, true);
    const rejected = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${prepared.restart.run_id}');`));
    assert.equal(rejected.compatible, false);
    const receipt = JSON.parse(sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`));
    assert.equal(receipt.abort.verified, true); assert.equal(receipt.outcome, 'aborted'); assert.equal(receipt.restart.status, 'blocked');
    assert.equal(sql(`select status from public.opportunity_search_runs where id='${f.run}';`), 'failed');
    assert.equal(sql(`select status from public.opportunity_search_runs where id='${rival}';`), 'running');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${prepared.restart.run_id}';`), '0');
  } finally { f.cleanup(); }
});

test('the authenticated owner can perform and independently verify the native UI operation', () => {
  const f = fixture();
  try {
    assert.equal(prepare(f).outcome, 'prepared');
    const aborted = ownerCall(f, `public.apply_adaptive_search_lifecycle('${f.operation}')`);
    assert.equal(aborted.outcome, 'aborted'); assert.equal(aborted.abort.verified, false);
    const verified = ownerCall(f, `public.read_adaptive_search_lifecycle('${f.operation}')`);
    assert.equal(verified.abort.verified, true); assert.equal(verified.abort.lease_released, true);
    assert.deepEqual(ownerCall(f, `public.read_adaptive_search_lifecycle('${f.operation}')`), verified);
    assert.deepEqual(ownerCall(f, `public.apply_adaptive_search_lifecycle('${f.operation}')`), verified);
  } finally { f.cleanup(); }
});

test('a changed task binding blocks a previously reserved restart', () => {
  const f = fixture();
  try {
    const prepared = prepare(f, 'abort_and_restart');
    sql(f.abortSql); sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`);
    sql(`update public.opportunity_search_schedule_bindings set task_id='changed-synthetic-${f.search}' where search_id='${f.search}';`);
    const denied = JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${prepared.restart.run_id}');`));
    assert.equal(denied.compatible, false); assert.equal(denied.error.code, 'restart_unavailable');
    assert.equal(JSON.parse(sql(`select private.read_adaptive_search_lifecycle('${f.operation}');`)).restart.status, 'blocked');
    assert.equal(sql(`select status from public.opportunity_search_runs where id='${f.run}';`), 'failed');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${prepared.restart.run_id}';`), '0');
  } finally { f.cleanup(); }
});
