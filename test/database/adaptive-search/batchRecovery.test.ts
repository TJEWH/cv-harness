import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, reset, sql, sqlAsync } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());

const project = 'kkkkkkkkkkkkkkkkkkkk';
const json = adaptiveJsonSqlLiteral;
const query = (statement: string) => JSON.parse(sql(statement));
const lookupSql = (run: string, batch: string) => `select private.submit_adaptive_search_batch('${run}','${batch}',NULL::jsonb);`;
const lookup = (run: string, batch: string) => query(lookupSql(run, batch));

function fixture() {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), batch = randomUUID(), check = randomUUID(), queryId = randomUUID();
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic receipt recovery','{"topicsAndMethods":"Synthetic acoustic sensing"}',
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
    set local role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    reset role;commit;`);
  const startup = query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
  assert.equal(startup.compatible, true, JSON.stringify(startup));
  const now = new Date().toISOString();
  const payload = { schema_version: 1, query_plan: { schema_version: 2, queries: [
    { query_id: queryId, query: 'synthetic acoustic sensing researcher', role: 'core', manual: false },
  ] }, opportunities: [] as Record<string, unknown>[], execution: { checks: [
    { check_id: check, kind: 'query', query_id: queryId, attempted_at: now, status: 'complete', results_count: 1 },
    ...startup.due_sources.map((source: { registry_id: string }) => ({ check_id: randomUUID(), kind: 'source',
      source_registry_id: source.registry_id, attempted_at: now, status: 'complete', results_count: 0 })),
  ], backlog: [], complete: true } };
  const item = (index = 0) => {
    const url = `https://example.invalid/BatchRecovery/${run}/${index}`;
    return { item_id: randomUUID(), opportunity: {
      opportunity_key: `batch-recovery-${run}-${index}`, title: 'Synthetic preserved acoustic researcher', official_url: url,
      last_checked_at: now, sources: [{ url, kind: 'official', checked_at: now, precision: 'instant', supports: ['title', 'official_url'] }],
    }, attribution: { execution_refs: [check], primary_check_id: check, discovered_at: now, encountered_at: now } };
  };
  payload.opportunities.push(item());
  const submitSql = (body: unknown = payload, id = batch) =>
    `select private.submit_adaptive_search_batch('${run}','${id}',${json(body, 1024 * 1024)});`;
  return { owner, search, run, batch, check, payload, item, submitSql,
    cleanup: () => sql(`delete from private.opportunity_search_merge_audit where run_id='${run}';
      delete from auth.users where id='${owner}';
      delete from private.opportunity_search_merge_state where opportunity_id in(select id from public.opportunities where opportunity_key like 'batch-recovery-${run}-%');
      delete from public.opportunities where opportunity_key like 'batch-recovery-${run}-%';
      update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`) };
}
type Fixture = ReturnType<typeof fixture>;

function snapshot(f: Fixture) {
  const relations = [
    ['public.opportunity_search_templates', `id='${f.search}'`],
    ['public.opportunity_search_schedule_bindings', `search_id='${f.search}'`],
    ['public.opportunity_search_runner_config', `search_id='${f.search}'`],
    ['public.opportunity_search_runner_authorizations', `search_id='${f.search}'`],
    ['public.opportunity_search_adaptive_release', 'singleton'],
    ['public.opportunity_search_runs', `search_id='${f.search}'`],
    ['private.opportunity_search_adaptive_contexts', `search_id='${f.search}'`],
    ['private.opportunity_search_adaptive_batches', `run_id='${f.run}'`],
    ['private.opportunity_search_adaptive_items', `run_id='${f.run}'`],
    ['public.opportunity_search_receipts', `run_id='${f.run}'`],
    ['public.opportunity_search_executions', `run_id='${f.run}'`],
    ['public.opportunity_search_query_plans', `search_id='${f.search}'`],
    ['public.opportunity_search_query_revisions', `search_id='${f.search}'`],
    ['public.opportunity_search_adaptive_settings', `search_id='${f.search}'`],
    ['public.opportunity_search_sources', `search_id='${f.search}'`],
    ['public.opportunity_search_feedback_snapshots', `search_id='${f.search}'`],
    ['public.opportunities', `opportunity_key like 'batch-recovery-${f.run}-%'`],
  ];
  return sql('select jsonb_build_object(' + relations.map(([table, where]) =>
    `'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t where ${where})`).join(',') + ');');
}
function assertMissing(value: any) {
  assert.deepEqual(value, { adaptive_contract_version: 1, batch_schema_version: 1, accepted: false,
    error: { code: 'batch_not_found', retryable: false } });
}

test('SQL NULL reports a missing exact batch without startup, pinning, writes or lease renewal', () => {
  const f = fixture();
  try {
    const before = snapshot(f);
    assertMissing(lookup(f.run, f.batch));
    assertMissing(lookup(f.run, f.batch));
    assert.equal(snapshot(f), before);
    const jsonNull = query(f.submitSql(null));
    assert.equal(jsonNull.error.code, 'invalid_batch', 'JSON null must not silently become receipt mode');
    assert.equal(query(`select private.submit_adaptive_search_batch('${f.run}',NULL::uuid,NULL::jsonb);`).error.code, 'invalid_batch');
    assert.equal(snapshot(f), before);
  } finally { f.cleanup(); }
});

test('receipt-only recovery preserves accepted work through retries and a rejected later batch', () => {
  const f = fixture();
  try {
    const receipt = query(f.submitSql());
    assert.equal(receipt.items[0].outcome, 'saved');
    assert.equal(receipt.verification_required, true);
    const before = snapshot(f);
    assert.deepEqual(lookup(f.run, f.batch), receipt);
    assert.deepEqual(query(f.submitSql()), receipt);
    const changed = { ...f.payload, execution: { ...f.payload.execution, complete: false } };
    assert.equal(query(f.submitSql(changed)).error.code, 'idempotency_conflict');
    const laterBatch = randomUUID(), laterItem = f.item(1);
    const rejected = query(f.submitSql({ schema_version: 1, plan_hash: receipt.plan_hash,
      opportunities: [{ ...laterItem, opportunity: { ...laterItem.opportunity, unexpected_field: 'Synthetic invalid later item' } }],
      execution: { checks: [], complete: false } }, laterBatch));
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.error.code, 'invalid_batch');
    assertMissing(lookup(f.run, laterBatch));
    assert.deepEqual(lookup(f.run, f.batch), receipt, 'A rejected later batch changed the previously committed receipt');
    assertMissing(lookup(f.run, randomUUID()));
    assert.equal(snapshot(f), before, 'A rejected later batch changed previously committed catalogue or execution records');
  } finally { f.cleanup(); }
});

test('one invalid record rolls back the whole batch and returns only bounded stage diagnostics', () => {
  const f = fixture();
  try {
    const broken = f.item(1);
    f.payload.opportunities.push({ ...broken, opportunity: { ...broken.opportunity,
      data: { forbidden_extension: 'PRIVATE_PAYLOAD_CANARY never echo this input' } } });
    f.payload.execution.checks[0]!.results_count = 2;
    const before = snapshot(f), result = query(f.submitSql());
    assert.equal(result.accepted, false);
    assert.deepEqual(result.error, { code: 'invalid_batch', retryable: false });
    assert.deepEqual(result.diagnostics, { stage: 'canonical_validation', sqlstate: '22023' });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PAYLOAD_CANARY|forbidden_extension|acoustic|example\.invalid/u);
    assertMissing(lookup(f.run, f.batch));
    assert.equal(snapshot(f), before, 'A rejected second record retained the first write, plan, check or batch');
  } finally { f.cleanup(); }
});

test('oversized requests retain the typed error and safe envelope diagnostics without side effects', () => {
  const f = fixture();
  try {
    const oversized = { ...f.payload, private_canary: 'PRIVATE_OVERSIZE_CANARY'.repeat(26000) };
    const before = snapshot(f), result = query(f.submitSql(oversized));
    assert.deepEqual(result.error, { code: 'scope_oversized', retryable: false });
    assert.deepEqual(result.diagnostics, { stage: 'envelope', sqlstate: '54000' });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OVERSIZE_CANARY|private_canary/u);
    assertMissing(lookup(f.run, f.batch));
    assert.equal(snapshot(f), before);
  } finally { f.cleanup(); }
});

for (const state of ['expired', 'superseded'] as const) test(state + ' runs retain authorized receipt lookup without reactivating research', () => {
  const f = fixture();
  try {
    const receipt = query(f.submitSql());
    assert.equal(receipt.verification_required, true);
    if (state === 'expired') sql(`update private.opportunity_search_adaptive_contexts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id='${f.run}';`);
    else assert.equal(query(`select private.begin_adaptive_search_brief('${f.search}','${randomUUID()}');`).compatible, true);
    const before = snapshot(f);
    assert.deepEqual(lookup(f.run, f.batch), receipt);
    assertMissing(lookup(f.run, randomUUID()));
    const refused = query(f.submitSql({ schema_version: 1, plan_hash: receipt.plan_hash, opportunities: [], execution: { checks: [], complete: true } }, randomUUID()));
    assert.equal(refused.error.code, 'inactive_run');
    assert.equal(snapshot(f), before);
  } finally { f.cleanup(); }
});

for (const denial of ['grant', 'project', 'release', 'application_roles'] as const) test(denial + ' cannot use receipt mode to bypass current authorization', () => {
  const f = fixture();
  try {
    assert.equal(query(f.submitSql()).verification_required, true);
    if (denial === 'grant') sql(`begin;select set_config('request.jwt.claims',${json({ sub: f.owner, is_anonymous: false })}::text,true);
      set local role authenticated;select public.set_opportunity_search_runner_authorization('${f.search}','${project}',false,1);reset role;commit;`);
    if (denial === 'project') sql("update public.opportunity_search_adaptive_release set project_ref='vvvvvvvvvvvvvvvvvvvv' where singleton;");
    if (denial === 'release') sql('update public.opportunity_search_adaptive_release set enabled=false where singleton;');
    const before = snapshot(f);
    if (denial === 'application_roles') {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.throws(() => sql(`begin;set local role ${role};${lookupSql(f.run, f.batch)}commit;`), /permission denied/iu);
      }
    } else assert.equal(lookup(f.run, f.batch).error.code, 'authorization_revoked');
    assert.equal(snapshot(f), before);
  } finally { f.cleanup(); }
});

test('receipt lookup never returns another run or owner’s matching batch UUID', () => {
  const first = fixture(), other = fixture();
  try {
    const receipt = query(first.submitSql());
    assert.equal(receipt.verification_required, true);
    const before = snapshot(other);
    assertMissing(lookup(other.run, first.batch));
    assert.equal(lookup(randomUUID(), first.batch).error.code, 'authorization_revoked');
    assert.equal(snapshot(other), before);
    assert.deepEqual(lookup(first.run, first.batch), receipt);
  } finally { first.cleanup(); other.cleanup(); }
});

for (const outcome of ['commit', 'rollback'] as const) test('receipt mode waits for an in-flight batch to ' + outcome + ' before reporting its state', async () => {
  const f = fixture(), readerName = 'batch-receipt-' + randomUUID();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const before = snapshot(f);
  const writer = sqlAsync(`begin;set local statement_timeout='10s';${f.submitSql()}
    select 'batch_recovery_writer_ready';
    do $$declare deadline timestamptz:=clock_timestamp()+interval '5 seconds';begin loop
      perform pg_stat_clear_snapshot();
      exit when exists(select 1 from pg_stat_activity where application_name='${readerName}'
        and pg_backend_pid()=any(pg_blocking_pids(pid)));
      if clock_timestamp()>deadline then raise exception 'Receipt reader did not wait for the intake lock';end if;
      perform pg_sleep(0.01);
    end loop;end$$;${outcome};`, chunk => { if (chunk.includes('batch_recovery_writer_ready')) release(); });
  let reader: Promise<string> | undefined;
  try {
    await Promise.race([barrier, writer.then(() => { throw new Error('Writer ended before the receipt lookup started'); })]);
    reader = sqlAsync(`set application_name='${readerName}';set statement_timeout='10s';${lookupSql(f.run, f.batch)}`);
    const [written, read] = await Promise.all([writer, reader]);
    const submitted = JSON.parse(written.split('\n').find(line => line.startsWith('{'))!);
    if (outcome === 'commit') {
      assert.equal(submitted.items[0].outcome, 'saved');
      assert.deepEqual(JSON.parse(read), submitted);
    } else {
      assertMissing(JSON.parse(read));
      assert.equal(snapshot(f), before);
    }
  } finally {
    await Promise.allSettled([writer, ...(reader ? [reader] : [])]);
    f.cleanup();
  }
});

test('six opportunities can commit in six small batches with one plan and independent completion', () => {
  const f = fixture(), batches = Array.from({ length: 6 }, () => randomUUID());
  try {
    f.payload.execution.checks[0]!.results_count = 6;
    f.payload.execution.complete = false;
    let receipt = query(f.submitSql(f.payload, batches[0]));
    assert.equal(receipt.items[0].outcome, 'saved');
    const plan = receipt.plan_hash;
    for (let index = 1; index < batches.length; index++) {
      receipt = query(f.submitSql({ schema_version: 1, plan_hash: plan, opportunities: [f.item(index)],
        execution: { checks: [], complete: index === batches.length - 1 } }, batches[index]));
      assert.equal(receipt.items[0].outcome, 'saved');
      assert.equal(receipt.plan_hash, plan);
    }
    const finished = query(`select private.verify_and_complete_adaptive_search('${f.run}',${json({ schema_version: 1,
      completion_id: randomUUID(), batch_ids: batches.toSorted(), manifest_hash: receipt.manifest_hash, status: 'complete' })});`);
    assert.equal(finished.compatible, true);
    assert.equal(finished.historical_summary.status, 'complete');
    assert.equal(finished.current_verification.verified_items, 6);
    assert.equal(finished.historical_summary.batch_count, 6);
  } finally { f.cleanup(); }
});

test('targeted incremental-save upgrade preserves active research and exactly matches the current helper definitions', () => {
  const signatures = ['private.adaptive_search_recurring_prompt(uuid,text)', 'private.adaptive_batch_error(text)',
    'private.submit_adaptive_search_batch(uuid,uuid,jsonb)'];
  const expectedPredecessorHashes = ['93ec8b2e2f566fbe8e775af933e099cf', '17ccb450941f65bf1639e71cd3044ade', 'a1c7d0cf1234333481d9f9650206b5ed'];
  const helpers = () => query(`select jsonb_agg(jsonb_build_object('signature',signature,
    'definition',pg_get_functiondef(signature::regprocedure),'source_hash',md5(prosrc),'properties',to_jsonb(p)-'prosrc') order by position)
    from unnest(array[${signatures.map(value => "'" + value + "'").join(',')}]) with ordinality s(signature,position)
    join pg_proc p on p.oid=signature::regprocedure;`);
  const others = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private') and p.oid<>all(array[${signatures.map(value => "'" + value + "'::regprocedure").join(',')}]);`);
  const current = helpers();
  const oldPrompt = [...file('supabase/releases/adaptive-search-response-handling-v1.sql').matchAll(
    /^CREATE OR REPLACE FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu,
  )].find(match => match[1]!.startsWith('private.adaptive_search_recurring_prompt('));
  assert.ok(oldPrompt);
  let f: Fixture | undefined;
  try {
    sql(oldPrompt[0] + '\n' + file('test/fixtures/meta-search/incremental-saves-predecessor.sql'));
    assert.deepEqual(helpers().map((entry: { source_hash: string }) => entry.source_hash), expectedPredecessorHashes,
      'The local predecessor fixture must match the three reviewed deployment guards');
    f = fixture();
    sql(`insert into public.opportunity_search_runner_config(user_id,search_id,project_ref,mode,migration_requested,setup_id)
      values('${f.owner}','${f.search}','${project}','adaptive',false,'${randomUUID()}');
      insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
      select id,user_id,'synthetic-incremental-upgrade',schedule,revision,'opportunity-search-v1-canonical-6','adaptive-batch-v1'
      from public.opportunity_search_templates where id='${f.search}';`);
    const receipt = query(f.submitSql());
    assert.equal(receipt.items[0].outcome, 'saved');
    assert.equal(lookup(f.run, f.batch).error.code, 'invalid_batch', 'The predecessor must not already support receipt-only mode');
    const before = snapshot(f), predecessorHelpers = helpers(), otherFunctions = others();
    const upgrade = file('supabase/releases/adaptive-search-incremental-saves-v1.sql');
    sql(upgrade);
    assert.deepEqual(helpers(), current, 'The targeted three-function upgrade differs from the current schema');
    assert.deepEqual(helpers().map((entry: { properties: unknown }) => entry.properties),
      predecessorHelpers.map((entry: { properties: unknown }) => entry.properties), 'The upgrade changed helper privileges or execution properties');
    assert.equal(others(), otherFunctions, 'The upgrade changed another function');
    assert.equal(snapshot(f), before, 'Deployment changed active research, receipts, schedule, grant or configuration');
    assert.deepEqual(lookup(f.run, f.batch), receipt);
    assertMissing(lookup(f.run, randomUUID()));
    assert.equal(snapshot(f), before, 'Receipt reconciliation mutated the pre-existing run');
    assert.throws(() => sql(upgrade), /Expected the reviewed/iu);
    assert.deepEqual(helpers(), current);
    assert.equal(snapshot(f), before);
  } finally {
    try { f?.cleanup(); } finally { reset(); }
  }
});
