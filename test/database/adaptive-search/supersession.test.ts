import { resetHistoricalAdaptiveBatchFixture } from '../../support/database/historicalAdaptiveBatch';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, sql, sqlAsync } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => resetHistoricalAdaptiveBatchFixture());

const project = 'ssssssssssssssssssss';
const json = adaptiveJsonSqlLiteral;
const uuid = (value: string) => "'" + value + "'::uuid";
const query = (statement: string) => JSON.parse(sql(statement));
const actor = (owner: string, statement: string) => 'begin;select set_config(\'request.jwt.claims\','
  + json({ sub: owner, is_anonymous: false }) + '::text,true);set local role authenticated;'
  + statement + 'reset role;commit;';
const startupSql = (search: string, run: string) =>
  'select private.begin_adaptive_search_brief(' + uuid(search) + ',' + uuid(run) + ');';
const begin = (search: string, run: string) => query(startupSql(search, run));
const runRow = (run: string) => query('select to_jsonb(r) from public.opportunity_search_runs r where id=' + uuid(run) + ';');
const snapshot = (run: string) => sql("select jsonb_build_object('run',(select to_jsonb(r) from public.opportunity_search_runs r where id="
  + uuid(run) + "),'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id=" + uuid(run) + '));');
const activeCount = (search: string) => sql('select count(*) from public.opportunity_search_runs where search_id=' + uuid(search) + " and status='running';");

function fixture(kind: 'adaptive' | 'legacy' = 'adaptive') {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), next = randomUUID();
  const queryId = randomUUID(), check = randomUUID(), batch = randomUUID();
  const schedule = { frequency: 'hourly', intervalHours: 12, weekdays: [], time: '09:00', timezone: 'Europe/Berlin', runImmediately: false };
  sql([
    'insert into auth.users(id) values(' + uuid(owner) + ');',
    'insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('
      + [uuid(search), uuid(owner), "'Synthetic automatic supersession'", json({ topicsAndMethods: 'Synthetic acoustic sensing' }), json(schedule)].join(',') + ');',
    "update public.opportunity_search_adaptive_release set enabled=true,project_ref='" + project + "' where singleton;",
    "select set_config('request.jwt.claims'," + json({ sub: owner, is_anonymous: false }) + '::text,false);',
    'set role authenticated;',
    'select public.set_opportunity_search_runner_authorization(' + uuid(search) + ",'" + project + "',true,0);",
    'reset role;',
    'insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability) values('
      + [uuid(search), uuid(owner), "'synthetic-supersession-" + search + "'", json(schedule), '1', "'opportunity-search-v1-canonical-6'", "'adaptive-batch-v1'"].join(',') + ');',
  ].join('\n'));
  const start = kind === 'adaptive' ? begin(search, run) : query('select private.begin_opportunity_search(' + uuid(search) + ',' + uuid(run) + ');');
  assert.equal(start.compatible, true, JSON.stringify(start));
  const attempted = new Date().toISOString();
  const checks = [{ check_id: check, kind: 'query', query_id: queryId, attempted_at: attempted, status: 'complete', results_count: 0 },
    ...(start.due_sources ?? []).map((source: { registry_id: string }) => ({ check_id: randomUUID(), kind: 'source',
      source_registry_id: source.registry_id, attempted_at: attempted, status: 'complete', results_count: 0 }))];
  const payload = { schema_version: 1, query_plan: { schema_version: 2, queries: [{ query_id: queryId,
    query: 'synthetic supersession acoustic sensing', role: 'core', manual: false }] },
  opportunities: [] as Array<Record<string, unknown>>, execution: { checks, backlog: [], complete: true } };
  return { owner, search, run, next, batch, check, payload,
    batchSql: () => 'select private.submit_adaptive_search_batch(' + uuid(run) + ',' + uuid(batch) + ',' + json(payload) + ');',
    cleanup: () => sql('delete from private.opportunity_search_merge_audit where run_id=' + uuid(run)
      + ';delete from auth.users where id=' + uuid(owner)
      + ';delete from private.opportunity_search_merge_state where opportunity_id in(select id from public.opportunities where opportunity_key='
      + "'supersession-" + run + "');delete from public.opportunities where opportunity_key="
      + "'supersession-" + run + "';update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;") };
}
type Fixture = ReturnType<typeof fixture>;
function setAuthorization(f: Fixture, enabled: boolean) {
  sql(actor(f.owner, 'select public.set_opportunity_search_runner_authorization('
    + uuid(f.search) + ",'" + project + "'," + enabled
    + ',(select authorization_revision from public.opportunity_search_runner_authorizations where search_id=' + uuid(f.search) + '));'));
}

function assertFenced(f: Fixture, replacement = f.next) {
  const old = runRow(f.run);
  assert.equal(old.status, 'failed');
  assert.equal(old.execution_report_status, 'partial');
  assert.equal(old.superseded_by_run_id, replacement);
  assert.equal(old.adaptive_lease_expires_at, null);
  assert.equal(old.owner_cancel_operation_id, null, 'Automatic supersession must not fabricate an owner lifecycle operation');
  assert.equal(sql('select count(*) from private.opportunity_search_adaptive_contexts where run_id=' + uuid(f.run)
    + ' and lease_expires_at>clock_timestamp();'), '0');
  assert.equal(activeCount(f.search), '1');
  assert.equal(runRow(replacement).status, 'running');
}
function completionSql(f: Fixture, receipt: { manifest_hash: string }) {
  return 'select private.verify_and_complete_adaptive_search(' + uuid(f.run) + ',' + json({
    schema_version: 1, completion_id: randomUUID(), batch_ids: [f.batch], manifest_hash: receipt.manifest_hash, status: 'complete',
  }) + ');';
}
function jsonRow(output: string) { return JSON.parse(output.split('\n').find(line => line.startsWith('{'))!); }

/** Ensure the first operation holds its real mutation lock before the second starts. */
async function overlap(firstStatement: string, secondStatement: string) {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const first = sqlAsync("begin;set local statement_timeout='10s';" + firstStatement
    + "select 'supersession_lock_held';select pg_sleep(0.3);commit;",
  chunk => { if (chunk.includes('supersession_lock_held')) release(); });
  let second: Promise<string> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([barrier, first.then(() => { throw new Error('Transaction ended before overlap'); }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Supersession lock barrier timed out')), 5000); })]);
    clearTimeout(timer);
    second = sqlAsync("set statement_timeout='10s';" + secondStatement);
    return await Promise.all([first, second]);
  } finally {
    clearTimeout(timer);
    await Promise.allSettled([first, ...(second ? [second] : [])]);
  }
}

test('a new brief replaces an orphan legacy execution without changing another search or its schedule', () => {
  const f = fixture('legacy'), otherSearch = randomUUID(), otherRun = randomUUID();
  try {
    sql('insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) select '
      + uuid(otherSearch) + ",user_id,'Other synthetic search',criteria,schedule from public.opportunity_search_templates where id=" + uuid(f.search) + ';');
    query('select private.begin_opportunity_search(' + uuid(otherSearch) + ',' + uuid(otherRun) + ');');
    const otherBefore = snapshot(otherRun);
    const definition = () => sql("select jsonb_build_object('template',(select to_jsonb(t) from public.opportunity_search_templates t where id="
      + uuid(f.search) + "),'binding',(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id=" + uuid(f.search) + '));');
    const before = definition();
    assert.equal(begin(f.search, f.next).compatible, true);
    assertFenced(f);
    assert.equal(snapshot(otherRun), otherBefore);
    assert.equal(definition(), before);
    assert.equal(sql('select count(*) from private.opportunity_search_lifecycle_operations where search_id=' + uuid(f.search) + ';'), '0');
  } finally { f.cleanup(); }
});

test('one new brief fences every historical running execution in the same search', () => {
  const f = fixture('legacy'), another = randomUUID();
  try {
    // Model two historical legacy workers created before the runner grant was
    // enabled. Setup migration must not require choosing one arbitrary blocker.
    setAuthorization(f, false);
    query('select private.begin_opportunity_search(' + uuid(f.search) + ',' + uuid(another) + ');');
    setAuthorization(f, true);
    assert.equal(activeCount(f.search), '2');
    assert.equal(begin(f.search, f.next).compatible, true);
    assertFenced(f);
    assert.equal(runRow(another).superseded_by_run_id, f.next);
    assert.equal(runRow(another).status, 'failed');
    assert.equal(activeCount(f.search), '1');
  } finally { f.cleanup(); }
});

test('a previously failed terminal execution remains unchanged when a new brief starts', () => {
  const f = fixture('legacy');
  try {
    query('select private.complete_opportunity_search(' + uuid(f.run) + ',' + json({
      status: 'failed', notes: 'Synthetic prior terminal execution.', unresolvedCount: 0,
    }) + ');');
    const before = snapshot(f.run);
    assert.equal(begin(f.search, f.next).compatible, true);
    assert.equal(snapshot(f.run), before);
    assert.equal(runRow(f.run).superseded_by_run_id, null);
    assert.equal(activeCount(f.search), '1');
  } finally { f.cleanup(); }
});

test('replacement preserves accepted results and historical receipts while rejecting stale worker mutations', () => {
  const f = fixture();
  try {
    const checked = new Date().toISOString(), url = 'https://example.invalid/supersession/' + f.run;
    f.payload.opportunities.push({ item_id: randomUUID(), opportunity: {
      opportunity_key: 'supersession-' + f.run, title: 'Synthetic preserved acoustic researcher', official_url: url,
      last_checked_at: checked, personal_fit: { score: 8, scale_min: 0, scale_max: 10, summary: 'Synthetic fit evidence.' },
      sources: [{ url, kind: 'official', checked_at: checked, precision: 'instant', supports: ['title', 'official_url', 'personal_fit'] }],
    } });
    f.payload.execution.checks[0]!.results_count = 1;
    const receipt = query(f.batchSql());
    assert.equal(receipt.verification_required, true, JSON.stringify(receipt));
    assert.equal(receipt.items[0].outcome, 'saved');
    const saved = () => sql("select jsonb_build_object('opportunity',(select to_jsonb(o) from public.opportunities o where opportunity_key='supersession-"
      + f.run + "'),'batches',(select jsonb_agg(to_jsonb(b) order by batch_id) from private.opportunity_search_adaptive_batches b where run_id="
      + uuid(f.run) + "),'checks',(select jsonb_agg(to_jsonb(e) order by check_id) from public.opportunity_search_executions e where run_id=" + uuid(f.run) + '));');
    const before = saved();
    assert.equal(begin(f.search, f.next).compatible, true);
    assertFenced(f);
    assert.equal(saved(), before);
    assert.deepEqual(query(f.batchSql()), receipt, 'Committed exact batch receipts remain readable');
    const later = query('select private.submit_adaptive_search_batch(' + uuid(f.run) + ',' + uuid(randomUUID()) + ','
      + json({ schema_version: 1, plan_hash: receipt.plan_hash, opportunities: [], execution: { checks: [], complete: true } }) + ');');
    assert.equal(later.accepted, false);
    const completed = query(completionSql(f, receipt));
    assert.equal(completed.compatible, false);
    assert.equal(completed.error.code, 'run_aborted');
    assert.throws(() => sql('select private.prepare_opportunity_search_execution(' + uuid(f.run) + ');'), /cancelled or superseded/iu);
    assert.throws(() => sql('select private.pin_opportunity_feedback_snapshot(' + [uuid(f.owner), uuid(f.search), uuid(f.run)].join(',') + ');'), /cancelled or superseded/iu);
    assert.throws(() => sql("select private.complete_opportunity_search(" + uuid(f.run) + ","
      + json({ status: 'complete', notes: 'Stale worker', unresolvedCount: 0 }) + ');'), /cancelled or superseded/iu);
    assert.throws(() => sql("update public.opportunity_search_runs set summary='{}'::jsonb where id=" + uuid(f.run) + ';'), /Cancelled or superseded runs are immutable/iu);
    assert.equal(saved(), before, 'A rejected stale write changed preserved work');
    assert.equal(activeCount(f.search), '1');
  } finally { f.cleanup(); }
});

test('exact retries never create replacement chains and a superseded UUID cannot cancel its successor', async () => {
  const f = fixture();
  try {
    const original = begin(f.search, f.run), before = snapshot(f.run);
    const retries = await Promise.all([1, 2].map(() => sqlAsync(startupSql(f.search, f.run)).then(JSON.parse)));
    retries.forEach(reply => assert.deepEqual(reply, original));
    assert.equal(snapshot(f.run), before);
    assert.equal(sql('select count(*) from public.opportunity_search_runs where search_id=' + uuid(f.search) + ';'), '1');
    assert.equal(begin(f.search, f.next).compatible, true);
    const newer = snapshot(f.next);
    for (const statement of [startupSql(f.search, f.run), 'select private.begin_adaptive_opportunity_search(' + uuid(f.search) + ',' + uuid(f.run) + ');']) {
      const stale = query(statement);
      assert.equal(stale.compatible, false);
      assert.equal(stale.error.code, 'run_aborted');
    }
    assert.equal(snapshot(f.next), newer);
    assertFenced(f);
  } finally { f.cleanup(); }
});

test('two overlapping new brief requests serialize replacement and leave only the final execution active', async () => {
  const f = fixture(), last = randomUUID();
  try {
    const replies = await overlap(startupSql(f.search, f.next), startupSql(f.search, last));
    replies.forEach(output => assert.equal(jsonRow(output).compatible, true, output));
    assert.equal(runRow(f.run).superseded_by_run_id, f.next);
    assert.equal(runRow(f.next).superseded_by_run_id, last);
    assert.equal(runRow(last).status, 'running');
    assert.equal(activeCount(f.search), '1');
    const lastBefore = snapshot(last);
    assert.equal(begin(f.search, f.next).error.code, 'run_aborted');
    assert.equal(snapshot(last), lastBefore);
  } finally { f.cleanup(); }
});

for (const winner of ['batch', 'replacement'] as const) test('a ' + winner + ' winning the write race preserves only committed prior work', async () => {
  const f = fixture();
  try {
    const replacementSql = startupSql(f.search, f.next);
    const outputs = await overlap(winner === 'batch' ? f.batchSql() : replacementSql, winner === 'batch' ? replacementSql : f.batchSql());
    const batch = jsonRow(outputs[winner === 'batch' ? 0 : 1]!);
    const replacement = jsonRow(outputs[winner === 'batch' ? 1 : 0]!);
    assert.equal(replacement.compatible, true, JSON.stringify(replacement));
    if (winner === 'batch') assert.equal(batch.verification_required, true, JSON.stringify(batch));
    else assert.equal(batch.accepted, false, JSON.stringify(batch));
    assertFenced(f);
    assert.equal(sql('select count(*) from private.opportunity_search_adaptive_batches where run_id=' + uuid(f.run) + ';'), winner === 'batch' ? '1' : '0');
    assert.equal(sql('select count(*) from public.opportunity_search_executions where run_id=' + uuid(f.run) + ';'),
      winner === 'batch' ? String(f.payload.execution.checks.length) : '0');
  } finally { f.cleanup(); }
});

for (const winner of ['completion', 'replacement'] as const) test('a ' + winner + ' winning the terminal race leaves a consistent old result', async () => {
  const f = fixture();
  try {
    const receipt = query(f.batchSql());
    assert.equal(receipt.verification_required, true);
    const complete = completionSql(f, receipt), replacementSql = startupSql(f.search, f.next);
    const outputs = await overlap(winner === 'completion' ? complete : replacementSql, winner === 'completion' ? replacementSql : complete);
    const completion = jsonRow(outputs[winner === 'completion' ? 0 : 1]!);
    assert.equal(jsonRow(outputs[winner === 'completion' ? 1 : 0]!).compatible, true);
    if (winner === 'completion') {
      assert.equal(completion.compatible, true, JSON.stringify(completion));
      assert.equal(runRow(f.run).status, 'complete');
      assert.equal(runRow(f.run).superseded_by_run_id, null);
    } else {
      assert.equal(completion.compatible, false);
      assert.equal(completion.error.code, 'run_aborted');
      assertFenced(f);
    }
    assert.equal(activeCount(f.search), '1');
    assert.equal(sql('select count(*) from private.opportunity_search_adaptive_batches where run_id=' + uuid(f.run) + ';'), '1');
  } finally { f.cleanup(); }
});

for (const rejected of ['disabled_release', 'revoked_grant', 'wrong_project', 'uuid_collision', 'application_role'] as const) {
  test(rejected + ' cannot abort the current execution', () => {
    const f = fixture(), otherSearch = randomUUID();
    try {
      if (rejected === 'disabled_release') sql('update public.opportunity_search_adaptive_release set enabled=false where singleton;');
      if (rejected === 'revoked_grant') setAuthorization(f, false);
      if (rejected === 'wrong_project') sql("update public.opportunity_search_adaptive_release set project_ref='wwwwwwwwwwwwwwwwwwww' where singleton;");
      if (rejected === 'uuid_collision') {
        sql('insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) select '
          + uuid(otherSearch) + ",user_id,'Synthetic UUID collision',criteria,schedule from public.opportunity_search_templates where id=" + uuid(f.search) + ';');
        query('select private.begin_opportunity_search(' + uuid(otherSearch) + ',' + uuid(f.next) + ');');
      }
      const before = snapshot(f.run);
      if (rejected === 'application_role') {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          assert.throws(() => sql('begin;set local role ' + role + ';' + startupSql(f.search, f.next) + 'commit;'), /permission denied|Management startup/iu);
        }
      } else {
        const reply = begin(f.search, f.next);
        assert.equal(reply.compatible, false, JSON.stringify(reply));
        assert.notEqual(reply.error.code, 'run_in_progress');
      }
      assert.equal(snapshot(f.run), before, 'Rejected startup changed an existing execution');
      assert.equal(activeCount(f.search), '1');
    } finally { f.cleanup(); }
  });
}

for (const failure of ['typed_inner_rejection', 'brief_overflow'] as const) {
  test(failure + ' rolls back both supersession and replacement startup', () => {
    const f = fixture();
    try {
      // A legacy envelope is valid saved text, but deliberately requires
      // conversion before the adaptive runner can consume it.
      const criteria = failure === 'typed_inner_rejection' ? { topicsAndMethods: 'CV Harness meta-search context v1: synthetic legacy scope' }
        : Object.fromEntries(['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions',
          'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting'].map(key => [key, 'Synthetic scope 音響🧠 '.repeat(500)]));
      sql('update public.opportunity_search_templates set criteria=' + json(criteria) + ',revision=revision+1 where id=' + uuid(f.search) + ';');
      const before = snapshot(f.run);
      const reply = begin(f.search, f.next);
      assert.equal(reply.compatible, false, JSON.stringify(reply));
      assert.equal(reply.error.code, failure === 'typed_inner_rejection' ? 'setup_conversion_required' : 'scope_oversized');
      assert.equal(snapshot(f.run), before, 'Failed replacement cancelled or changed the previous execution');
      assert.equal(sql('select count(*) from public.opportunity_search_runs where id=' + uuid(f.next) + ';'), '0');
      assert.equal(sql('select count(*) from private.opportunity_search_adaptive_contexts where run_id=' + uuid(f.next) + ';'), '0');
      assert.equal(activeCount(f.search), '1');
    } finally { f.cleanup(); }
  });
}

test('an unbound explicitly authorized manual search also replaces its prior execution', () => {
  const f = fixture();
  try {
    sql('delete from public.opportunity_search_schedule_bindings where search_id=' + uuid(f.search) + ';');
    assert.equal(begin(f.search, f.next).compatible, true);
    assertFenced(f);
  } finally { f.cleanup(); }
});

test('targeted supersession upgrade preserves active state and installs its historical contract before replacing a run', () => {
  const signatures = [
    'private.adaptive_search_recurring_prompt(uuid,text)',
    'private.begin_adaptive_search_brief(uuid,uuid)',
    'private.begin_adaptive_opportunity_search(uuid,uuid)',
    'private.begin_opportunity_search(uuid,uuid)',
    'private.verify_and_complete_adaptive_search(uuid,jsonb)',
    'public.job_workspace_adaptive_run_pins()',
    'private.guard_search_run_not_aborted(uuid)',
  ];
  const definitions = (source: string) => new Map([...source.matchAll(
    /^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu,
  )].map(match => [match[1]!.split('(')[0]!, match[0].replace(/^CREATE FUNCTION/u, 'CREATE OR REPLACE FUNCTION')]));
  const predecessor = new Map([
    ...definitions(file('supabase/releases/adaptive-search-lifecycle-v1.sql')),
    ...definitions(file('supabase/releases/adaptive-search-brief-v1.sql')),
  ]);
  const catalog = () => query(`select jsonb_build_object(
    'helpers',(select jsonb_object_agg(signature,jsonb_build_object('definition',pg_get_functiondef(signature::regprocedure),
      'acl',(select proacl from pg_proc where oid=signature::regprocedure)))
      from unnest(array[${signatures.map(value => "'" + value + "'").join(',')}]) signature),
    'column',(select jsonb_build_object('type',format_type(atttypid,atttypmod),'not_null',attnotnull,'has_default',atthasdef)
      from pg_attribute where attrelid='public.opportunity_search_runs'::regclass and attname='superseded_by_run_id' and not attisdropped),
    'constraints',(select jsonb_object_agg(conname,jsonb_build_object('definition',pg_get_constraintdef(oid),
      'deferred',condeferred,'deferrable',condeferrable,'validated',convalidated)) from pg_constraint
      where conrelid='public.opportunity_search_runs'::regclass and conname in(
        'opportunity_search_runs_supersession_check','opportunity_search_runs_superseded_scope_fkey')));`);
  const freshCatalog = catalog();
  let f: Fixture | undefined;
  try {
    // These immutable historical artifacts are the immediately preceding
    // installed contract. No Git history or production capture is needed.
    const oldDefinitions = signatures.map(signature => {
      const definition = predecessor.get(signature.split('(')[0]!);
      assert.ok(definition, 'Missing predecessor helper ' + signature);
      assert.doesNotMatch(definition, /superseded_by_run_id/u);
      return definition;
    });
    sql('begin;set local check_function_bodies=false;' + oldDefinitions.join('\n')
      + 'alter table public.opportunity_search_runs drop constraint opportunity_search_runs_superseded_scope_fkey;'
      + 'alter table public.opportunity_search_runs drop constraint opportunity_search_runs_supersession_check;'
      + 'alter table public.opportunity_search_runs drop column superseded_by_run_id;commit;');
    assert.equal(catalog().column, null);
    f = fixture();
    const receipt = query(f.batchSql());
    assert.equal(receipt.verification_required, true);
    const blocked = begin(f.search, f.next);
    assert.equal(blocked.error.code, 'run_in_progress', 'The predecessor must reproduce the reported blocker');
    const state = () => {
      assert.ok(f);
      const tables = [
        ['public.opportunity_search_templates', 'id=' + uuid(f.search)],
        ['public.opportunity_search_schedule_bindings', 'search_id=' + uuid(f.search)],
        ['public.opportunity_search_runner_authorizations', 'search_id=' + uuid(f.search)],
        ['public.opportunity_search_runner_config', 'search_id=' + uuid(f.search)],
        ['public.opportunity_search_adaptive_release', 'singleton'],
        ['private.opportunity_search_adaptive_contexts', 'run_id=' + uuid(f.run)],
        ['private.opportunity_search_adaptive_batches', 'run_id=' + uuid(f.run)],
        ['public.opportunity_search_feedback_snapshots', 'search_id=' + uuid(f.search)],
        ['public.opportunity_search_executions', 'run_id=' + uuid(f.run)],
        ['public.opportunity_search_sources', 'search_id=' + uuid(f.search)],
        ['private.opportunity_search_lifecycle_operations', 'search_id=' + uuid(f.search)],
      ];
      return query("select jsonb_build_object('run',(select to_jsonb(r)-'superseded_by_run_id' from public.opportunity_search_runs r where id="
        + uuid(f.run) + '),' + tables.map(([table, where]) => "'" + table + "',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from "
          + table + ' t where ' + where + ')').join(',') + ');');
    };
    const before = state();
    const upgrade = file('supabase/releases/adaptive-search-supersession-v1.sql');
    sql(upgrade);
    const installedSupersession = catalog(), promptSignature = signatures[0]!, briefSignature = signatures[1]!, completionSignature = signatures[4]!;
    const bootstrapSignature = signatures[2]!;
    const laterReplaced = [promptSignature, briefSignature, bootstrapSignature, completionSignature];
    const historicalBodies = new Map(laterReplaced.map(signature => {
      const body = /\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/u.exec(
        definitions(upgrade).get(signature.split('(')[0]!)!)?.[2];
      assert.ok(body, 'Missing historical supersession definition: ' + signature);
      assert.equal(sql(`select prosrc from pg_proc where oid='${signature}'::regprocedure;`), body.trim());
      return [signature, body.trim()] as const;
    }));
    // Later prompt, evidence-guidance, standalone-save and startup-logging upgrades deliberately
    // replace these bodies. Check their immutable historical definitions above;
    // exclude only the bodies from the current comparison, retaining every ACL.
    const withoutLaterBodies = (value: typeof freshCatalog) => {
      const projected = structuredClone(value);
      for (const signature of laterReplaced) delete projected.helpers[signature].definition;
      return projected;
    };
    assert.deepEqual(withoutLaterBodies(installedSupersession), withoutLaterBodies(freshCatalog), 'Historical supersession helper or privilege changed');
    assert.deepEqual(state(), before, 'Installing the contract changed existing execution or schedule data');
    assert.equal(runRow(f.run).superseded_by_run_id, null);
    assert.throws(() => sql(upgrade), /Supersession installation already exists/iu);
    assert.deepEqual(state(), before, 'Refused repeated installation changed existing state');
    assert.deepEqual(catalog(), installedSupersession, 'Refused repeated installation changed the installed contract');
    const responseUpgrade = file('supabase/releases/adaptive-search-response-handling-v1.sql');
    sql(responseUpgrade);
    assert.deepEqual(withoutLaterBodies(catalog()), withoutLaterBodies(freshCatalog), 'Historical upgrades changed current helper or privilege definitions');
    for (const signature of [briefSignature, bootstrapSignature, completionSignature]) {
      assert.equal(sql(`select prosrc from pg_proc where oid='${signature}'::regprocedure;`), historicalBodies.get(signature));
    }
    const expectedPromptBody = /\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/u.exec(
      definitions(responseUpgrade).get('private.adaptive_search_recurring_prompt')!)?.[2];
    assert.ok(expectedPromptBody);
    assert.equal(sql(`select prosrc from pg_proc where oid='${promptSignature}'::regprocedure;`), expectedPromptBody.trim());
    assert.deepEqual(state(), before, 'Installing response handling changed existing execution or schedule data');
    assert.equal(begin(f.search, f.next).compatible, true);
    assertFenced(f);
    assert.deepEqual(query(f.batchSql()), receipt);
  } finally {
    try { f?.cleanup(); } finally { resetHistoricalAdaptiveBatchFixture(); }
  }
});
