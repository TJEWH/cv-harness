import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { reset, sql } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());

const project = 'iiiiiiiiiiiiiiiiiiii';
const json = adaptiveJsonSqlLiteral;
const query = (statement: string) => JSON.parse(sql(statement));
const actor = (owner: string, statement: string) => `begin;
  select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
  set local role authenticated;${statement}reset role;commit;`;

function fixture(kind: 'adaptive' | 'legacy' = 'adaptive') {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), queryId = randomUUID(), checkId = randomUUID();
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic independent opportunity saves','{"topicsAndMethods":"Synthetic acoustic sensing"}',
        '{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;`);
  sql(actor(owner, `select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);`));
  const startup = query(`select private.${kind === 'adaptive' ? 'begin_adaptive_search_brief' : 'begin_opportunity_search'}('${search}','${run}');`);
  assert.equal(startup.compatible, true, JSON.stringify(startup));
  const now = new Date().toISOString();
  const opportunity = (index = 0) => {
    const url = `https://example.invalid/StandaloneSaves/${search}/${index}`;
    return { opportunity_key: `standalone-${search}-${index}`, title: 'Synthetic acoustic sensing research', official_url: url,
      last_checked_at: now, sources: [{ url, kind: 'official', checked_at: now, precision: 'instant', supports: ['title', 'official_url'] }] };
  };
  const coverage = () => ({ schema_version: 1, query_plan: { schema_version: 2, queries: [
    { query_id: queryId, query: 'synthetic acoustic sensing researcher', role: 'core', manual: false },
  ] }, opportunities: [] as Record<string, unknown>[], execution: { checks: [
    { check_id: checkId, kind: 'query', query_id: queryId, attempted_at: now, status: 'complete', results_count: 1 },
    ...(startup.due_sources ?? []).map((source: { registry_id: string }) => ({ check_id: randomUUID(), kind: 'source',
      source_registry_id: source.registry_id, attempted_at: now, status: 'complete', results_count: 0 })),
  ], backlog: [], complete: true } });
  const saveSql = (item: string, value: unknown = opportunity()) =>
    `select private.submit_adaptive_search_batch('${run}','${item}',${json(value)});`;
  const save = (item: string, value: unknown = opportunity()) => query(saveSql(item, value));
  const lookup = (item: string) => query(`select private.submit_adaptive_search_batch('${run}','${item}',NULL::jsonb);`);
  const complete = (value: unknown) => query(`select private.verify_and_complete_adaptive_search('${run}',${json(value)});`);
  const verify = (item: string) => complete({ schema_version: 2, action: 'verify_item', item_id: item });
  const finish = (completion = randomUUID(), status = 'complete') => complete({ schema_version: 2, action: 'finish', completion_id: completion, status });
  const cleanup = () => sql(`delete from private.opportunity_search_merge_audit where opportunity_id in
      (select id from public.opportunities where opportunity_key like 'standalone-${search}-%');
    delete from auth.users where id='${owner}';
    delete from private.opportunity_search_merge_state where opportunity_id in
      (select id from public.opportunities where opportunity_key like 'standalone-${search}-%');
    delete from public.opportunities where opportunity_key like 'standalone-${search}-%';
    update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  return { owner, search, run, startup, opportunity, coverage, saveSql, save, lookup, complete, verify, finish, cleanup };
}
type Fixture = ReturnType<typeof fixture>;

function researchState(f: Fixture) {
  const relations = [
    ['public.opportunity_search_templates', `id='${f.search}'`],
    ['public.opportunity_search_schedule_bindings', `search_id='${f.search}'`],
    ['public.opportunity_search_runs', `id='${f.run}'`],
    ['private.opportunity_search_adaptive_contexts', `run_id='${f.run}'`],
    ['public.opportunity_search_query_revisions', `search_id='${f.search}'`],
    ['public.opportunity_search_query_plans', `search_id='${f.search}'`],
    ['public.opportunity_search_executions', `run_id='${f.run}'`],
    ['public.opportunity_search_feedback_snapshots', `search_id='${f.search}'`],
  ];
  return sql('select jsonb_build_object(' + relations.map(([table, where]) =>
    `'${table}',(select coalesce(jsonb_agg(${table === 'public.opportunity_search_runs' ? "to_jsonb(t)-'last_batch_rejection'" : 'to_jsonb(t)'} order by to_jsonb(t)::text),'[]') from ${table} t where ${where})`).join(',') + ');');
}
function savedCount(f: Fixture) {
  return Number(sql(`select count(*) from public.opportunity_search_receipts where run_id='${f.run}';`));
}
function assertSaved(value: any, f: Fixture, item: string) {
  assert.equal(value.error, undefined, JSON.stringify(value));
  assert.equal(value.run_id, f.run);
  assert.equal(value.item_id, item);
  assert.equal(value.verification_required, true);
  assert.equal(value.outcome, 'saved');
  assert.match(value.payload_hash, /^[a-f0-9]{64}$/u);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 4096, 'Save acknowledgements must stay bounded and exclude canonical snapshots');
  assert.doesNotMatch(JSON.stringify(value), /Synthetic acoustic|example\.invalid|before_snapshot|normalized_payload|current_snapshot/u);
}

test('saving one found opportunity preserves the established startup and research-building functions', () => {
  // The startup helpers include the reviewed logging and 96-KiB bound upgrades.
  // startupLogging.test.ts verifies unchanged payloads across that upgrade.
  const expected = {
    'private.begin_adaptive_search_brief(uuid,uuid)': '68bcf3497ae0cc3517bf42f80568c0ac',
    'private.begin_adaptive_opportunity_search(uuid,uuid)': '2cdc9a739ca6a529dc86ab19562c31f9',
    'private.begin_opportunity_search(uuid,uuid)': '779fef6e8213a1081e786459e079875d',
    'private.compile_opportunity_feedback_snapshot(uuid,uuid)': '7083bc7b1f8abe99256c41b20ae6d2c2',
    'private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)': '2972f9fb39ad268660ecdf03dae4ffb2',
    'private.pin_opportunity_feedback_snapshot(uuid,uuid,uuid)': '9043a107795ab6c8cd0cab6e18585cbf',
    'private.opportunity_search_adaptive_protocol_text()': 'e054f66147e579e5ab618118eb947967',
    'private.opportunity_search_result_schema()': 'b4ea74f083861be98b755041f1cbce2c',
  };
  const actual = query(`select jsonb_object_agg(signature,md5(prosrc)) from jsonb_object_keys(${json(expected)}) signatures(signature)
    join pg_proc on oid=signature::regprocedure;`);
  assert.deepEqual(actual, expected, 'Saving must preserve the reviewed startup and research definitions');
});

test('cold startup saves canonical data without plan, checks, attribution or synthetic research state', () => {
  const f = fixture(), item = randomUUID();
  try {
    assert.equal(f.startup.query_plan, null);
    assert.equal(f.startup.legacy_core_queries, null);
    assert.equal(sql(`select queries is null from public.opportunity_search_runs where id='${f.run}';`), 't');
    const assessment = { score: 8.4, scale_min: 0, scale_max: 10, summary: 'Synthetic established acoustic research fit.' };
    const opportunity = { ...f.opportunity(), personal_fit: assessment };
    opportunity.sources[0]!.supports.push('personal_fit');
    const before = researchState(f), receipt = f.save(item, opportunity);
    assertSaved(receipt, f, item);
    assert.equal(savedCount(f), 1);
    assert.equal(sql(`select count(*) from private.opportunity_search_merge_audit where run_id='${f.run}' and item_id='${item}';`), '1');
    assert.equal(sql(`select batch_id is null from private.opportunity_search_adaptive_items where run_id='${f.run}' and item_id='${item}';`), 't');
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_batches where run_id='${f.run}';`), '0');
    assert.deepEqual(query(`select personal_fit from public.opportunities where opportunity_key='${opportunity.opportunity_key}';`), assessment);
    assert.deepEqual(query(`select jsonb_build_object('original_assessment',original_assessment,'query_plan_id',query_plan_id,
      'execution_refs',execution_refs,'primary_discovery',primary_discovery,'discovered_at',discovered_at,'encountered_at',encountered_at)
      from public.opportunity_search_discoveries where run_id='${f.run}' and item_id='${item}';`), {
      original_assessment: assessment, query_plan_id: null, execution_refs: [], primary_discovery: false, discovered_at: null, encountered_at: null,
    }, 'Saving must preserve the assessment without inventing a discovery time, path or plan');
    assert.equal(researchState(f), before, 'A canonical save must not construct a query plan or report coverage');
    assert.deepEqual(query(`select private.begin_adaptive_search_brief('${f.search}','${f.run}');`), f.startup);
    const proof = f.verify(item);
    assert.equal(proof.error, undefined, JSON.stringify(proof));
    assert.equal(proof.verified, true);
    assert.equal(proof.item_id, item);
    assert.equal(sql(`select verified_at is not null from public.opportunity_search_receipts where run_id='${f.run}' and item_id='${item}';`), 't');
    assert.equal(researchState(f), before);
  } finally { f.cleanup(); }
});

test('exact retry and SQL NULL recover one compact receipt while conflicting evidence cannot overwrite it', () => {
  const f = fixture(), item = randomUUID();
  try {
    const receipt = f.save(item); assertSaved(receipt, f, item);
    const before = researchState(f);
    assert.deepEqual(f.save(item), receipt);
    assert.deepEqual(f.lookup(item), receipt);
    assert.equal(f.save(item, { ...f.opportunity(), title: 'Changed evidence under the same item UUID' }).error.code, 'idempotency_conflict');
    assert.deepEqual(f.lookup(item), receipt);
    assert.equal(savedCount(f), 1);
    assert.equal(researchState(f), before);
    const missing = f.lookup(randomUUID());
    assert.equal(missing.accepted, false);
    assert.equal(missing.error.code, 'batch_not_found');
  } finally { f.cleanup(); }
});

test('canonical rejection remains field-specific and cannot damage an earlier independent save', () => {
  const f = fixture(), saved = randomUUID(), invalid = randomUUID();
  try {
    const receipt = f.save(saved); assertSaved(receipt, f, saved);
    const before = researchState(f);
    const result = f.save(invalid, { ...f.opportunity(1), unknown_private_extension: 'PRIVATE_STANDALONE_CANARY' });
    assert.equal(result.accepted, false);
    assert.equal(result.error.code, 'invalid_opportunity');
    assert.equal(result.stored, false);
    assert.equal(result.correction_allowed, true);
    assert.equal(result.diagnostics.stage, 'canonical_validation');
    assert.equal(result.diagnostics.sqlstate, '22023');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_STANDALONE_CANARY|unknown_private_extension/u);
    const diagnostic = query(`select last_batch_rejection from public.opportunity_search_runs where id='${f.run}';`);
    assert.equal(diagnostic.code, 'invalid_batch', 'Stored diagnostics retain the existing bounded database contract');
    assert.equal(diagnostic.batch_id, invalid);
    assert.equal(diagnostic.diagnostics.stage, 'canonical_validation');
    assert.equal(diagnostic.diagnostics.sqlstate, '22023');
    assert.equal(diagnostic.diagnostics.field_path, result.diagnostics.field_path);
    assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 2048);
    assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_STANDALONE_CANARY|unknown_private_extension/u);
    assert.equal(savedCount(f), 1);
    assert.deepEqual(f.lookup(saved), receipt);
    assert.equal(researchState(f), before);
    assertSaved(f.save(invalid, f.opportunity(1)), f, invalid);
    assert.equal(savedCount(f), 2, 'A confirmed not-stored validation failure may be corrected under the original item UUID');
    assert.deepEqual(f.lookup(saved), receipt);
  } finally { f.cleanup(); }
});

test('semantic evidence-field rejection identifies its exact safe path and survives a missing response', () => {
  const f = fixture(), item = randomUUID();
  try {
    const opportunity = f.opportunity(); opportunity.sources[0]!.supports = ['opportunity.title'];
    assert.equal(sql(`select private.opportunity_search_schema_valid(${json(opportunity)},private.opportunity_search_result_schema());`), 't');
    const result = f.save(item, opportunity);
    assert.equal(result.error.code, 'invalid_opportunity');
    assert.equal(result.stored, false);
    assert.equal(result.correction_allowed, true);
    assert.deepEqual(result.diagnostics, { stage: 'canonical_validation', sqlstate: '22023',
      reason: 'unknown_evidence_field', field_path: '/sources/0/supports/0' });
    assert.doesNotMatch(JSON.stringify(result), /opportunity\.title|example\.invalid/u);
    // A separate action can recover bounded diagnosis even if the caller lost
    // the first response; the submitted opportunity is not copied into logs.
    const diagnostic = query(`select last_batch_rejection from public.opportunity_search_runs where id='${f.run}';`);
    assert.equal(diagnostic.code, 'invalid_batch');
    assert.deepEqual(diagnostic.diagnostics, { stage: 'canonical_validation', sqlstate: '22023', field_path: '/sources/0/supports/0' });
    assert.equal(diagnostic.batch_id, item);
    assert.equal(savedCount(f), 0);
    opportunity.sources[0]!.supports = ['title', 'official_url'];
    assertSaved(f.save(item, opportunity), f, item);
    assert.equal(f.verify(item).verified, true);
  } finally { f.cleanup(); }
});

for (const mutation of ['changed', 'rolled_back'] as const) test(`independent verification detects ${mutation} evidence instead of trusting the write receipt`, () => {
  const f = fixture(), item = randomUUID();
  try {
    const receipt = f.save(item); assertSaved(receipt, f, item);
    assert.equal(f.verify(item).verified, true);
    if (mutation === 'changed') sql(`update public.opportunities set title='Synthetic later catalogue correction' where id='${receipt.opportunity_id}';`);
    else sql(`update private.opportunity_search_merge_audit set rolled_back_at=clock_timestamp() where run_id='${f.run}' and item_id='${item}';`);
    const proof = f.verify(item);
    assert.equal(proof.compatible, true, JSON.stringify(proof));
    assert.equal(proof.verified, false);
    assert.equal(proof.status, mutation === 'changed' ? 'changed_since_save' : 'rolled_back');
    assert.equal(proof.changed_since_save, mutation === 'changed');
    assert.equal(proof.rolled_back, mutation === 'rolled_back');
    assert.deepEqual(f.lookup(item), receipt, 'Historical acknowledgements must not replace live verification');
  } finally { f.cleanup(); }
});

test('malformed coverage leaves the opportunity saved and valid real coverage can finish the same run', () => {
  const f = fixture(), item = randomUUID(), report = randomUUID();
  try {
    const receipt = f.save(item); assertSaved(receipt, f, item);
    const before = researchState(f), malformed = f.coverage();
    malformed.execution.checks[0]!.status = 'invented_status';
    const rejection = f.save(report, malformed);
    assert.equal(rejection.accepted, false);
    assert.equal(rejection.error.code, 'invalid_batch');
    assert.deepEqual(f.lookup(item), receipt);
    assert.equal(savedCount(f), 1);
    assert.equal(researchState(f), before);
    assert.equal(f.verify(item).verified, true);
    const coverage = f.save(report, f.coverage());
    assert.equal(coverage.error, undefined, JSON.stringify(coverage));
    assert.equal(coverage.items.length, 0);
    const finished = f.finish();
    assert.equal(finished.compatible, true, JSON.stringify(finished));
    assert.equal(finished.persisted_summary_read, true);
    assert.equal(finished.historical_summary.status, 'complete');
    assert.equal(finished.historical_summary.coverage.complete, true);
    assert.equal(finished.current_verification.saved_items, 1);
    assert.equal(finished.current_verification.verified_items, 1);
  } finally { f.cleanup(); }
});

test('combined finish saves real coverage once and verifies opportunities in the same final request', () => {
  const f = fixture(), item = randomUUID(), completion = randomUUID();
  try {
    assertSaved(f.save(item), f, item);
    const before = researchState(f), malformed = f.coverage();
    malformed.execution.checks[0]!.status = 'invented_status';
    const rejected = f.complete({ schema_version: 2, action: 'finish', completion_id: completion, status: 'complete', coverage: malformed });
    assert.ok(rejected.error, JSON.stringify(rejected));
    assert.equal(savedCount(f), 1);
    assert.equal(rejected.current_verification.verified_items, 1, 'A reporting error must still expose independently verified saved progress');
    assert.equal(researchState(f), before, 'Rejected reporting must not persist a partial query plan');
    const diagnostic = query(`select last_batch_rejection from public.opportunity_search_runs where id='${f.run}';`);
    assert.equal(diagnostic.batch_id, completion, 'Coverage diagnostics must survive the outer reporting rollback');
    assert.equal(diagnostic.code, 'invalid_batch');
    assert.deepEqual(diagnostic.diagnostics, rejected.diagnostics);
    const payload = { schema_version: 2, action: 'finish', completion_id: completion, status: 'complete', coverage: f.coverage() };
    const finished = f.complete(payload);
    assert.equal(finished.compatible, true, JSON.stringify(finished));
    assert.equal(finished.historical_summary.status, 'complete');
    assert.equal(finished.historical_summary.coverage.complete, true);
    assert.equal(finished.current_verification.verified_items, 1);
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_batches where run_id='${f.run}' and batch_id='${completion}';`), '1');
    assert.deepEqual(f.complete(payload).historical_summary, finished.historical_summary);
    assert.equal(savedCount(f), 1);
    const changed = structuredClone(payload); changed.coverage.execution.checks[0]!.results_count = 2;
    assert.ok(f.complete(changed).error, 'A terminal retry with changed coverage must not rewrite history');
  } finally { f.cleanup(); }
});

test('finishing without coverage preserves and verifies saves but records incomplete research', () => {
  const f = fixture(), item = randomUUID();
  try {
    assertSaved(f.save(item), f, item);
    const completion = randomUUID(), finished = f.finish(completion);
    assert.equal(finished.compatible, true, JSON.stringify(finished));
    assert.equal(finished.historical_summary.status, 'failed');
    assert.equal(finished.historical_summary.coverage.complete, false);
    assert.equal(finished.current_verification.verified_items, 1);
    assert.equal(savedCount(f), 1);
    const retry = f.finish(completion);
    assert.equal(retry.error, undefined, JSON.stringify(retry));
    assert.deepEqual(retry.historical_summary, finished.historical_summary);
    assert.equal(retry.manifest_hash, finished.manifest_hash);
  } finally { f.cleanup(); }
});

test('zero-result research completes through the same final coverage path without inventing an opportunity', () => {
  const f = fixture();
  try {
    const coverage = f.coverage(); coverage.execution.checks[0]!.results_count = 0;
    const finished = f.complete({ schema_version: 2, action: 'finish', completion_id: randomUUID(), status: 'complete', coverage });
    assert.equal(finished.compatible, true, JSON.stringify(finished));
    assert.equal(finished.historical_summary.status, 'complete');
    assert.equal(finished.historical_summary.coverage.complete, true);
    assert.equal(finished.current_verification.saved_items, 0);
    assert.equal(savedCount(f), 0);
    assert.equal(sql(`select count(*) from public.opportunities where opportunity_key like 'standalone-${f.search}-%';`), '0');
  } finally { f.cleanup(); }
});

test('mixed wrapped-batch and standalone saves all participate in independent final verification', () => {
  const f = fixture(), batch = randomUUID(), batchedItem = randomUUID(), standaloneItem = randomUUID();
  try {
    const body = f.coverage();
    body.opportunities.push({ item_id: batchedItem, opportunity: f.opportunity(0) });
    const oldReceipt = f.save(batch, body);
    assert.equal(oldReceipt.items[0].outcome, 'saved', JSON.stringify(oldReceipt));
    assertSaved(f.save(standaloneItem, f.opportunity(1)), f, standaloneItem);
    assert.deepEqual(f.lookup(batch), oldReceipt, 'A later standalone save must not rewrite an existing batch receipt');
    const finished = f.finish();
    assert.equal(finished.historical_summary.status, 'complete', JSON.stringify(finished));
    assert.equal(finished.current_verification.verified_items, 2);
    assert.deepEqual(finished.current_verification.items.map((item: { item_id: string }) => item.item_id).sort(), [batchedItem, standaloneItem].sort());
    assert.equal(savedCount(f), 2);
  } finally { f.cleanup(); }
});

test('a UUID cannot change between standalone item and wrapped batch receipt identities', () => {
  const f = fixture(), item = randomUUID(), batch = randomUUID();
  try {
    const itemReceipt = f.save(item); assertSaved(itemReceipt, f, item);
    assert.equal(f.save(item, f.coverage()).error.code, 'idempotency_conflict');
    assert.deepEqual(f.lookup(item), itemReceipt);
    const batchReceipt = f.save(batch, f.coverage());
    assert.equal(batchReceipt.error, undefined, JSON.stringify(batchReceipt));
    assert.equal(f.save(batch, f.opportunity(1)).error.code, 'idempotency_conflict');
    assert.deepEqual(f.lookup(batch), batchReceipt);
    assert.equal(savedCount(f), 1);
  } finally { f.cleanup(); }
});

test('batch-only manifests retain the historical hash and terminal completion payload contract', () => {
  const f = fixture(), batch = randomUUID(), item = randomUUID();
  try {
    const body = f.coverage(); body.opportunities.push({ item_id: item, opportunity: f.opportunity() });
    const receipt = f.save(batch, body);
    assert.equal(receipt.error, undefined, JSON.stringify(receipt));
    const historicalHash = sql(`select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object(
      'batch_id',batch_id,'payload_hash',payload_hash,'plan_hash',plan_hash,'item_ids',to_jsonb(item_ids)) order by batch_id),'[]')::text,'UTF8')),'hex')
      from private.opportunity_search_adaptive_batches where run_id='${f.run}';`);
    assert.equal(receipt.manifest_hash, historicalHash);
    const completion = { schema_version: 1, completion_id: randomUUID(), batch_ids: [batch], manifest_hash: historicalHash, status: 'complete' };
    const finished = f.complete(completion);
    assert.equal(finished.historical_summary.status, 'complete', JSON.stringify(finished));
    assert.equal(finished.manifest_hash, historicalHash);
    assert.deepEqual(f.complete(completion).historical_summary, finished.historical_summary);
  } finally { f.cleanup(); }
});

test('server-derived completion cannot silently omit an orphan canonical receipt', () => {
  const f = fixture(), item = randomUUID();
  try {
    assertSaved(f.save(item), f, item);
    sql(`delete from private.opportunity_search_adaptive_items where run_id='${f.run}' and item_id='${item}';`);
    const result = f.finish();
    assert.equal(result.compatible, false);
    assert.equal(result.error.code, 'manifest_mismatch');
    assert.equal(savedCount(f), 1);
    assert.equal(sql(`select status from public.opportunity_search_runs where id='${f.run}';`), 'running');
  } finally { f.cleanup(); }
});

for (const denial of ['grant', 'lease', 'supersession'] as const) test(`${denial} fences new standalone writes while preserving previously saved opportunities`, () => {
  const f = fixture(), saved = randomUUID(), rejected = randomUUID();
  try {
    assertSaved(f.save(saved), f, saved);
    if (denial === 'grant') sql(actor(f.owner,
      `select public.set_opportunity_search_runner_authorization('${f.search}','${project}',false,1);`));
    if (denial === 'lease') sql(`update private.opportunity_search_adaptive_contexts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id='${f.run}';`);
    if (denial === 'supersession') assert.equal(query(`select private.begin_adaptive_search_brief('${f.search}','${randomUUID()}');`).compatible, true);
    const before = researchState(f), result = f.save(rejected, f.opportunity(1));
    assert.equal(result.accepted, false);
    assert.equal(result.error.code, denial === 'grant' ? 'authorization_revoked' : denial === 'lease' ? 'lease_expired' : 'run_aborted');
    assert.equal(savedCount(f), 1);
    assert.equal(researchState(f), before);
    assert.equal(sql(`select count(*) from public.opportunities where opportunity_key='${f.opportunity().opportunity_key}';`), '1');
  } finally { f.cleanup(); }
});

test('application roles cannot call standalone save, receipt or independent verification helpers', () => {
  const f = fixture(), item = randomUUID();
  try {
    assertSaved(f.save(item), f, item);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const statement of [f.saveSql(randomUUID(), f.opportunity(1)),
        `select private.submit_adaptive_search_batch('${f.run}','${item}',NULL::jsonb);`,
        `select private.verify_and_complete_adaptive_search('${f.run}',${json({ schema_version: 2, action: 'verify_item', item_id: item })});`]) {
        assert.throws(() => sql(`begin;set local role ${role};${statement}commit;`), /permission denied/iu);
      }
    }
    assert.equal(savedCount(f), 1);
  } finally { f.cleanup(); }
});

test('item receipt lookup and verification remain scoped to the exact run and owner', () => {
  const first = fixture(), second = fixture(), item = randomUUID();
  try {
    const receipt = first.save(item); assertSaved(receipt, first, item);
    assert.equal(second.lookup(item).error.code, 'batch_not_found');
    const proof = second.verify(item);
    assert.notEqual(proof.verified, true);
    assert.ok(proof.error, JSON.stringify(proof));
    assert.equal(savedCount(second), 0);
    assert.deepEqual(first.lookup(item), receipt);
  } finally { first.cleanup(); second.cleanup(); }
});

test('standalone items are owned by a real run and cascade when that run is deleted', () => {
  const f = fixture(), item = randomUUID();
  try {
    assertSaved(f.save(item), f, item);
    assert.throws(() => sql(`insert into private.opportunity_search_adaptive_items
      select (jsonb_populate_record(null::private.opportunity_search_adaptive_items,to_jsonb(i)||jsonb_build_object('run_id','${randomUUID()}'))).*
      from private.opportunity_search_adaptive_items i where run_id='${f.run}' and item_id='${item}';`), /foreign key constraint/iu);
    sql(`delete from public.opportunity_search_runs where id='${f.run}';`);
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_items where run_id='${f.run}';`), '0');
    assert.equal(savedCount(f), 0);
    assert.equal(sql(`select count(*) from public.opportunities where opportunity_key='${f.opportunity().opportunity_key}';`), '1', 'Deleting run bookkeeping must preserve the catalogue');
  } finally { f.cleanup(); }
});

test('ordinary legacy runs still require saved queries before the shared canonical writer accepts results', () => {
  const f = fixture('legacy'), item = randomUUID();
  try {
    assert.equal(sql(`select queries is null from public.opportunity_search_runs where id='${f.run}';`), 't');
    assert.throws(() => sql(`select private.submit_opportunity_search_result('${f.run}','${item}',${json(f.opportunity())});`), /active run with saved queries/iu);
    assert.equal(savedCount(f), 0);
    assert.equal(f.save(item).error.code, 'authorization_revoked');
  } finally { f.cleanup(); }
});
