import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral, buildAdaptiveSearchSqlCall } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());

const project = 'abcdefghijklmnopqrst';
const json = adaptiveJsonSqlLiteral;
const actor = (owner: string, statement: string) => `begin;
  select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
  set local role authenticated; ${statement} reset role; commit;`;

function fixture(exampleCount = 0, adaptation = false) {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), registry = randomUUID();
  const opportunities = Array.from({ length: exampleCount }, () => randomUUID());
  const criteria = {
    opportunityTypes: 'Funded doctoral and applied research positions.',
    topicsAndMethods: 'Physical sensing; 音響; 🧠; "quoted" methods; \\ signal processing.\n',
    locationsAndLanguages: 'Europe; English or German.',
    fundingAndConditions: 'Solid funding; start by agreement in 2027.',
    fitAndExclusions: 'Research directions are alternatives; interests do not establish qualifications.',
    sourcesAndQueries: 'Preserve protected manual queries and check every due source.',
    researchAndReporting: 'Verify official evidence and keep unresolved questions explicit.',
  };
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic single response startup',${json(criteria)},
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    ${opportunities.map((id, index) => `insert into public.opportunities(id,opportunity_key,title,topics,personal_fit)
      values('${id}','brief-${id}','Synthetic sensing role ${index}',array['Acoustics','BCI'],
        '{"score":9,"scale_min":0,"scale_max":10,"summary":"Synthetic project alignment."}');
      insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,comment)
        values('${owner}','${id}','${index < 8 ? 'strong_interest' : 'not_interested'}',${index < 8 ? 9 : 2},
          'SYNTHETIC_BRIEF_FEEDBACK_${index}: Prefer physical sensing with evidence of practical prototypes.');`).join('\n')}`);
  sql(actor(owner, `select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    ${adaptation ? `select public.save_opportunity_search_adaptation('${search}',true,false,0);` : ''}
    select public.save_opportunity_search_source('${search}','${registry}',
      '{"listing_url":"https://example.invalid/ResearchJobs","enabled":true,"pinned":true}');`));
  return { owner, search, run, registry, opportunities, criteria, scope: { project_ref: project, search_id: search, run_id: run } };
}
function cleanup(f: ReturnType<typeof fixture>) {
  sql(`delete from auth.users where id='${f.owner}';
    ${f.opportunities.length ? `delete from public.opportunities where id in(${f.opportunities.map(id => `'${id}'`).join(',')});` : ''}
    update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
}
function begin(f: ReturnType<typeof fixture>) {
  return JSON.parse(sql(`select private.begin_adaptive_search_brief('${f.search}','${f.run}');`));
}
function full(f: ReturnType<typeof fixture>) {
  return JSON.parse(sql(`select private.begin_adaptive_opportunity_search('${f.search}','${f.run}');`));
}

test('single startup response preserves the executable contract, 16 feedback examples and all required scope', context => {
  const f = fixture(16, true);
  try {
    const opportunityCount = sql('select count(*) from public.opportunities;');
    const scheduleCount = sql('select count(*) from public.opportunity_search_schedule_bindings;');
    const brief = begin(f);
    assert.equal(brief.compatible, true, JSON.stringify(brief));
    assert.equal(brief.brief_version, 1);
    assert.equal(brief.response_limit_bytes, 65_536);
    assert.ok(Buffer.byteLength(JSON.stringify(brief)) <= brief.response_limit_bytes);
    context.diagnostic(`Populated 16-example response: ${Buffer.byteLength(JSON.stringify(brief))} compact JSON bytes; server limit ${brief.response_limit_bytes}.`);
    assert.deepEqual(brief.base, { revision: 1, criteria: f.criteria });
    assert.equal(brief.query_plan, null);
    assert.equal(brief.legacy_core_queries, null);
    const original = full(f); // Test oracle only; the runtime consumes the one brief above.
    for (const field of ['scope', 'release', 'base', 'protocol_text', 'result_schema', 'query_plan', 'legacy_core_queries',
      'due_sources', 'source_context', 'preferences', 'refresh', 'lease', 'execution_contract']) {
      assert.deepEqual(brief[field], original[field], `${field} changed at the response boundary`);
    }
    assert.equal(brief.feedback.examples.length, 16);
    assert.deepEqual(brief.feedback.examples, original.feedback.examples, 'The transport must not reallocate or truncate examples');
    assert.deepEqual(brief.feedback.counts, original.feedback.counts);
    for (const field of ['policy', 'allocation', 'priorities', 'blocked_core_queries', 'refresh_required']) {
      assert.deepEqual(brief.planning[field], original.planning[field], `Planning ${field} lost research obligations`);
    }
    assert.equal('approved_rules' in brief.planning, false);
    assert.equal('approved_preferences' in brief.planning, false);
    assert.equal('approved_preferences' in brief.feedback, false);
    assert.equal('groups' in brief.feedback.aggregates, false);
    assert.equal(brief.capabilities.allowed_helpers.includes('private.begin_adaptive_search_brief(uuid,uuid)'), true);
    assert.equal(brief.capabilities.allowed_helpers.includes('private.begin_adaptive_opportunity_search(uuid,uuid)'), false);
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}';`), '1');
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_contexts where search_id='${f.search}';`), '1');
    assert.equal(sql('select count(*) from public.opportunities;'), opportunityCount);
    assert.equal(sql('select count(*) from public.opportunity_search_schedule_bindings;'), scheduleCount);
  } finally { cleanup(f); }
});

test('brief retries keep one UUID and lease while respecting feedback revocation and lease expiry', () => {
  const f = fixture(1, true);
  try {
    const first = begin(f);
    assert.equal(first.compatible, true, JSON.stringify(first));
    assert.deepEqual(begin(f), first);
    assert.match(JSON.stringify(first.feedback), /SYNTHETIC_BRIEF_FEEDBACK_0/u);
    sql(actor(f.owner, `select public.save_opportunity_feedback('${f.opportunities[0]}','{"feedback_excluded":true}');`));
    const redacted = begin(f);
    assert.equal(redacted.compatible, true, JSON.stringify(redacted));
    assert.doesNotMatch(JSON.stringify(redacted), /SYNTHETIC_BRIEF_FEEDBACK_0/u);
    assert.equal(redacted.scope.run_id, f.run);
    assert.deepEqual(redacted.lease, first.lease, 'A retry must not renew the lease');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}';`), '1');
    sql(`update private.opportunity_search_adaptive_contexts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id='${f.run}';`);
    const expired = begin(f);
    assert.equal(expired.compatible, false);
    assert.equal(expired.error.code, 'lease_expired');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}';`), '1');
  } finally { cleanup(f); }
});

test('brief retains protected manual queries and explicit blocked-source skips without rewriting them', () => {
  const f = fixture(1, true), legacy = randomUUID(), core = randomUUID(), suggestion = randomUUID(), rule = randomUUID();
  try {
    const packet = JSON.parse(sql(`select private.compile_opportunity_feedback_snapshot('${f.owner}','${f.search}');`));
    sql(`select private.begin_opportunity_search('${f.search}','${legacy}');`);
    const anchor = JSON.parse(sql(`select private.save_opportunity_search_queries('${legacy}',
      '[{"query":"synthetic protected acoustic core"}]');`)).id;
    const query = { query_id: core, query: 'synthetic protected acoustic core', role: 'core', manual: true,
      source_registry_id: f.registry, text_hash: createHash('sha256').update('synthetic protected acoustic core').digest('hex') };
    const exploration = { query_id: randomUUID(), query: 'synthetic adjacent sensing', role: 'exploration', manual: false,
      text_hash: createHash('sha256').update('synthetic adjacent sensing').digest('hex') };
    sql(`select private.publish_opportunity_search_plan('${f.owner}','${f.search}','${anchor}',
      ${json({ schema_version: 2, queries: [query, exploration] })},1,${packet.feedback_revision},0,
      (select active_protocol_version from private.opportunity_search_settings where singleton));
      select private.complete_opportunity_search('${legacy}',
        '{"status":"failed","notes":"Synthetic query seed only.","unresolvedCount":0}');`);
    sql(actor(f.owner, `select public.propose_opportunity_search_preference('${f.search}','${suggestion}',
      ${json({ rule_id: rule, kind: 'source_exclusion', source_registry_id: f.registry, evidence_refs: [] })});
      select public.decide_opportunity_search_preference('${f.search}','${suggestion}','approve',0,'${randomUUID()}');`));
    const brief = begin(f);
    assert.equal(brief.compatible, true, JSON.stringify(brief));
    assert.deepEqual(brief.query_plan.document.queries.find((entry: { query_id: string }) => entry.query_id === core), query);
    assert.deepEqual(brief.planning.blocked_core_queries, [{ query_id: core, rule_id: rule }]);
    assert.equal(brief.preferences.approved_rules.some((entry: { rule_id: string }) => entry.rule_id === rule), true);
    assert.equal(brief.due_sources.some((entry: { registry_id: string }) => entry.registry_id === f.registry), false);
    assert.equal(brief.source_context.some((entry: { registry_id: string }) => entry.registry_id === f.registry), false);
    assert.deepEqual(brief.query_plan, full(f).query_plan);
  } finally { cleanup(f); }
});

test('oversized required criteria fail atomically without creating a run, lease or context', () => {
  const f = fixture();
  try {
    const oversized = Object.fromEntries(Object.keys(f.criteria).map(key => [key, 'Synthetic scope '.repeat(740)]));
    sql(`update public.opportunity_search_templates set criteria=${json(oversized)},revision=revision+1 where id='${f.search}';`);
    const rejected = begin(f);
    assert.equal(rejected.compatible, false);
    assert.equal(rejected.error.code, 'scope_oversized');
    assert.deepEqual(Object.keys(rejected.size_diagnostics).sort(),
      ['response_bytes', 'context_bytes', 'planning_bytes', 'protocol_bytes', 'schema_bytes', 'feedback_bytes'].sort());
    for (const bytes of Object.values(rejected.size_diagnostics)) {
      assert.ok(Number.isSafeInteger(bytes) && Number(bytes) >= 0, 'Size diagnostics must contain only bounded numeric metadata');
    }
    assert.ok(rejected.size_diagnostics.response_bytes > 65_536);
    assert.doesNotMatch(JSON.stringify(rejected), /Synthetic scope|topicsAndMethods|opportunityTypes/u);
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${f.run}';`), '0');
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_contexts where run_id='${f.run}';`), '0');
    assert.equal(sql(`select count(*) from public.opportunity_search_feedback_snapshots where user_id='${f.owner}' and search_id='${f.search}';`), '0');
    assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id='${f.owner}' and search_id='${f.search}';`), '1', 'Rejected startup retained auto-seeded source writes');

    // Model a pre-existing run created by the older, larger internal contract.
    // A brief rejection must neither cancel it nor rewrite its cache or lease.
    const existing = full(f);
    assert.equal(existing.compatible, true, JSON.stringify(existing));
    const snapshot = () => sql(`select jsonb_build_object(
      'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${f.run}'),
      'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${f.run}'));`);
    const beforeRejectedRecovery = snapshot();
    const recovery = begin(f);
    assert.equal(recovery.compatible, false);
    assert.equal(recovery.error.code, 'scope_oversized');
    assert.equal(snapshot(), beforeRejectedRecovery, 'Oversized recovery changed the existing run, cache or lease');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}';`), '1');
  } finally { cleanup(f); }
});

test('brief preserves explicit startup rejection and remains inaccessible to application roles', () => {
  const f = fixture();
  try {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}','private.begin_adaptive_search_brief(uuid,uuid)','execute');`), 'f');
      assert.throws(() => sql(`begin;set local role ${role};select private.begin_adaptive_search_brief('${f.search}','${f.run}');commit;`), /permission denied|Management startup/iu);
    }
    sql('update public.opportunity_search_adaptive_release set enabled=false where singleton;');
    const rejected = begin(f);
    assert.equal(rejected.compatible, false);
    assert.equal(rejected.error.code, 'runner_disabled');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${f.run}';`), '0');
  } finally { cleanup(f); }
});

test('single response startup feeds one batch and independent completion in three database calls', () => {
  const f = fixture(), query = randomUUID(), batch = randomUUID(), completion = randomUUID();
  const calls: string[] = [];
  const api = (statement: string) => { calls.push(statement); return JSON.parse(sql(statement)); };
  try {
    const startup = api(`SELECT private.begin_adaptive_search_brief('${f.search}'::uuid,'${f.run}'::uuid) AS startup;`);
    assert.equal(startup.compatible, true, JSON.stringify(startup));
    const attempted = new Date().toISOString();
    const receipt = api(buildAdaptiveSearchSqlCall({ action: 'batch', scope: f.scope, batch_id: batch,
      payload: { schema_version: 1, query_plan: { schema_version: 2,
        queries: [{ query_id: query, query: 'synthetic acoustic sensing research', role: 'core', manual: false }] }, opportunities: [],
        execution: { checks: [{ check_id: randomUUID(), kind: 'query', query_id: query, attempted_at: attempted, status: 'complete', results_count: 0 },
          ...startup.due_sources.map((source: { registry_id: string }) => ({ check_id: randomUUID(), kind: 'source',
            source_registry_id: source.registry_id, attempted_at: attempted, status: 'complete', results_count: 0 }))], backlog: [], complete: true } } }).sql);
    assert.equal(receipt.batch_schema_version, 1, JSON.stringify(receipt));
    assert.equal(receipt.verification_required, true);
    const result = api(buildAdaptiveSearchSqlCall({ action: 'complete', scope: f.scope,
      payload: { schema_version: 1, completion_id: completion, batch_ids: [batch], manifest_hash: receipt.manifest_hash, status: 'complete' } }).sql);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(statement => /^SELECT private\.(begin_adaptive_search_brief|submit_adaptive_search_batch|verify_and_complete_adaptive_search)\(/u.test(statement)));
    assert.equal(result.compatible, true, JSON.stringify(result));
    assert.equal(result.persisted_summary_read, true);
    assert.equal(result.historical_summary.status, 'complete');
    assert.equal(result.historical_summary.incomplete, false);
    assert.equal(result.current_verification.all_saved_items_verified, true);
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_batches where run_id='${f.run}';`), '1');
  } finally { cleanup(f); }
});

test('targeted brief upgrade preserves active runs and schedules and revokes broad inherited function grants', () => {
  const f = fixture();
  const definition = (source: string, name: string) => {
    const match = [...source.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu)]
      .find(value => value[1]?.startsWith(`${name}(`));
    assert.ok(match, `Missing fixture function ${name}`);
    return match[0].replace(/^CREATE FUNCTION/u, 'CREATE OR REPLACE FUNCTION');
  };
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${f.run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${f.run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${f.search}'),
    'binding',(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id='${f.search}'));`);
  try {
    assert.equal(full(f).compatible, true);
    sql(`insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
      select id,user_id,'synthetic-brief-upgrade',schedule,revision,
        (select active_protocol_version from private.opportunity_search_settings where singleton),'adaptive-batch-v1'
        from public.opportunity_search_templates where id='${f.search}';`);
    const oldPrompt = definition(file('supabase/releases/adaptive-search-lifecycle-v1.sql'), 'private.adaptive_search_recurring_prompt');
    const oldReadiness = definition(file('supabase/schemas/12_search_support.sql'), 'public.adaptive_search_setup_capable')
      .replace("('begin_adaptive_search_brief','uuid, uuid'),", '');
    sql(`drop function private.begin_adaptive_search_brief(uuid,uuid);${oldPrompt}${oldReadiness}
      alter default privileges for role postgres in schema private grant execute on functions to anon,authenticated,service_role;`);
    assert.equal(sql('select public.adaptive_search_setup_capable();'), 't');
    assert.match(sql(`select private.adaptive_search_recurring_prompt('${f.search}','${project}');`), /startup_manifest/u);
    const beforeUpgrade = snapshot();
    const upgrade = file('supabase/releases/adaptive-search-brief-v1.sql');
    sql(upgrade);
    assert.equal(snapshot(), beforeUpgrade, 'Installing the new contract changed run or scheduled-task data');
    assert.equal(sql('select public.adaptive_search_setup_capable();'), 't');
    assert.doesNotMatch(sql(`select private.adaptive_search_recurring_prompt('${f.search}','${project}');`), /startup_manifest|startup_page/u);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}','private.begin_adaptive_search_brief(uuid,uuid)','execute');`), 'f');
    }
    assert.throws(() => sql(upgrade), /installation already exists/iu);
    assert.equal(snapshot(), beforeUpgrade, 'A refused repeated installation changed data');
    assert.equal(begin(f).scope.run_id, f.run, 'The upgraded contract replaced the active run UUID');
  } finally {
    sql('alter default privileges for role postgres in schema private revoke execute on functions from anon,authenticated,service_role;');
    cleanup(f);
  }
});
