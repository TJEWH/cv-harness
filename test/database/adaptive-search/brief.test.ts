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
  const researchSummary = '音響🧠 acoustic sensing. '.repeat(18);
  const sharedFeedback = 'SYNTHETIC_BRIEF_FEEDBACK_0: ' + 'Prefer 音響🧠 with practical prototypes. '.repeat(20);
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
    ${opportunities.map((id, index) => `insert into public.opportunities(id,opportunity_key,title,topics,personal_fit,research_summary)
      values('${id}','brief-${id}','Synthetic sensing role ${index}',array['Acoustics','BCI'],
        '{"score":9,"scale_min":0,"scale_max":10,"summary":"Synthetic project alignment."}',${json(researchSummary)}#>>'{}');
      insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,comment)
        values('${owner}','${id}','${index < 8 ? 'strong_interest' : 'not_interested'}',${index < 8 ? 9 : 2},
          ${json(index === 0 ? sharedFeedback : `SYNTHETIC_BRIEF_FEEDBACK_${index}: Prefer physical sensing with evidence of practical prototypes.`)}#>>'{}');`).join('\n')}`);
  sql(actor(owner, `select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    ${adaptation ? `select public.save_opportunity_search_adaptation('${search}',true,false,0);` : ''}
    select public.save_opportunity_search_source('${search}','${registry}',
      '{"listing_url":"https://example.invalid/ResearchJobs","enabled":true,"pinned":true}');`));
  return { owner, search, run, registry, opportunities, criteria, researchSummary, sharedFeedback,
    scope: { project_ref: project, search_id: search, run_id: run } };
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
    assert.ok(brief.protocol_text.startsWith(original.protocol_text + '\n\nEVIDENCE FIELD NAMES\n'));
    for (const field of ['scope', 'release', 'base', 'result_schema', 'query_plan', 'legacy_core_queries',
      'due_sources', 'source_context', 'preferences', 'refresh', 'lease', 'execution_contract']) {
      assert.deepEqual(brief[field], original[field], `${field} changed at the response boundary`);
    }
    assert.equal(brief.feedback.examples.length, 16);
    const semanticFields = ['opportunity_id', 'title', 'institution', 'topics', 'interest_score', 'interest_origin', 'interest_gap',
      'review_state', 'metric_version', 'confirmed_submission', 'reasons', 'search_feedback_summary', 'technical_issue_category', 'manually_archived'];
    brief.feedback.examples.forEach((example: Record<string, unknown>, index: number) => {
      const complete = original.feedback.examples[index];
      for (const field of semanticFields) assert.deepEqual(example[field], complete[field], `Example ${index} lost ${field}`);
      assert.equal(example.predicted_interest_score, complete.original_prediction?.score ?? null);
      assert.equal(example.research_summary, Array.from(f.researchSummary).slice(0, 240).join(''));
      assert.equal(example.research_summary_truncated, true);
      assert.equal(complete.research_summary, f.researchSummary, 'Internal snapshots must retain the complete research context');
      assert.deepEqual(example.summary_inclusion, complete.summary_inclusion && {
        source_length: complete.summary_inclusion.source_length, truncated: complete.summary_inclusion.truncated,
      });
      for (const field of ['opportunity_key', 'official_url', 'source_url', 'original_prediction', 'feedback_updated_at']) {
        assert.equal(field in example, false, `Example ${index} unnecessarily exposed ${field}`);
      }
    });
    const shared = brief.feedback.examples.find((example: { opportunity_id: string }) => example.opportunity_id === f.opportunities[0]);
    assert.ok(Array.from(f.sharedFeedback).length > 600);
    const includedFeedback = Array.from(f.sharedFeedback).slice(0, 600).join('');
    assert.equal(shared.search_feedback_summary, includedFeedback, 'The brief must retain all included user feedback without applying its research-preview limit');
    assert.deepEqual(shared.summary_inclusion, { source_length: Array.from(f.sharedFeedback).length, truncated: true });
    const originalShared = original.feedback.examples.find((example: { opportunity_id: string }) => example.opportunity_id === f.opportunities[0]);
    assert.equal(originalShared.search_feedback_summary, includedFeedback);
    assert.equal(originalShared.summary_inclusion.source_hash, createHash('sha256').update(f.sharedFeedback).digest('hex'));
    assert.equal(originalShared.summary_inclusion.summary_hash, createHash('sha256').update(includedFeedback).digest('hex'));
    assert.equal(sql(`select comment=${json(f.sharedFeedback)}#>>'{}' from public.opportunity_reviews
      where user_id='${f.owner}' and opportunity_id='${f.opportunities[0]}';`), 't', 'The full private evaluation must remain stored');
    assert.deepEqual(brief.feedback.example_projection, {
      version: 1, selected_ids_and_order_preserved: true, research_summary_preview_max_characters: 240,
    });
    assert.deepEqual(brief.feedback.counts, original.feedback.counts);
    assert.deepEqual(brief.feedback.aggregates, Object.fromEntries(Object.entries(original.feedback.aggregates).filter(([key]) => key !== 'groups')));
    for (const field of ['policy', 'allocation', 'blocked_core_queries', 'refresh_required']) {
      assert.deepEqual(brief.planning[field], original.planning[field], `Planning ${field} lost research obligations`);
    }
    const actionable = original.planning.priorities.filter((priority: { basis: string; provisional: boolean; direction: string }) =>
      priority.basis === 'approved' || priority.provisional === false && ['increase', 'decrease'].includes(priority.direction));
    assert.deepEqual(brief.planning.priorities, actionable);
    assert.deepEqual(brief.planning.priority_projection, {
      policy: 'approved-and-supported-directions-v1', included_count: actionable.length,
      omitted_advisory_count: original.planning.priorities.length - actionable.length,
    });
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

test('hosted evidence guidance exposes accepted fields and a corrected support name saves and verifies', () => {
  const f = fixture(), query = randomUUID(), batch = randomUUID(), completion = randomUUID();
  try {
    const startup = begin(f);
    const fields: string[] = JSON.parse(startup.protocol_text.split('\n').at(-1));
    assert.deepEqual([...fields].sort(), Object.keys(startup.result_schema.properties).filter(key => key !== 'merge_control').sort());
    assert.equal(sql(`select bool_and(private.opportunity_search_support_field(value) is not null)
      from jsonb_array_elements_text(${json(fields)});`), 't');
    assert.match(startup.protocol_text, /sources\[\]\.supports[\s\S]*exact name[\s\S]*JSON pointer[\s\S]*no database discovery/u);
    assert.equal(sql("select private.opportunity_search_support_field('/data/funding');"), '/data/funding');
    const now = new Date().toISOString(), url = `https://example.invalid/evidence/${f.run}`;
    const opportunity = { opportunity_key: `evidence-${f.run}`, title: 'Synthetic verified sensing role', official_url: url,
      last_checked_at: now, sources: [{ url, kind: 'official', checked_at: now, precision: 'instant', supports: ['opportunity.title'] }] };
    assert.equal(sql(`select private.opportunity_search_schema_valid(${json(opportunity)},private.opportunity_search_result_schema());`), 't',
      'The historical string-only schema does not communicate the semantic support-name restriction');
    assert.throws(() => sql(`select private.validate_opportunity_search_result(${json(opportunity)});`), /Unknown evidence field/u);
    opportunity.sources[0]!.supports = ['title', 'official_url'];
    assert.ok(opportunity.sources[0]!.supports.every(field => fields.includes(field)));
    const receipt = JSON.parse(sql(buildAdaptiveSearchSqlCall({ action: 'batch', scope: f.scope, batch_id: batch,
      payload: { schema_version: 1, query_plan: { schema_version: 2,
        queries: [{ query_id: query, query: 'synthetic acoustic sensing research', role: 'core', manual: false }] },
      opportunities: [{ item_id: randomUUID(), opportunity }], execution: { checks: [
        { check_id: randomUUID(), kind: 'query', query_id: query, attempted_at: now, status: 'complete', results_count: 1 },
        ...startup.due_sources.map((source: { registry_id: string }) => ({ check_id: randomUUID(), kind: 'source',
          source_registry_id: source.registry_id, attempted_at: now, status: 'complete', results_count: 0 })),
      ], backlog: [], complete: true } } }).sql));
    assert.equal(receipt.items?.[0]?.outcome, 'saved', JSON.stringify(receipt));
    const result = JSON.parse(sql(buildAdaptiveSearchSqlCall({ action: 'complete', scope: f.scope,
      payload: { schema_version: 1, completion_id: completion, batch_ids: [batch], manifest_hash: receipt.manifest_hash, status: 'complete' } }).sql));
    assert.equal(result.historical_summary.status, 'complete', JSON.stringify(result));
    assert.equal(result.current_verification.saved_items, 1);
    assert.equal(result.current_verification.all_saved_items_verified, true);
  } finally { cleanup(f); }
});

test('evidence guidance upgrade preserves pre-existing pinned runs, schema, prompt and access', () => {
  const signature = 'private.begin_adaptive_search_brief(uuid,uuid)';
  const previous = [...file('supabase/releases/adaptive-search-supersession-v1.sql').matchAll(
    /^CREATE OR REPLACE FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu,
  )].find(match => match[1]!.startsWith('private.begin_adaptive_search_brief('));
  assert.ok(previous);
  const f = fixture();
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${f.run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${f.run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${f.search}'),
    'prompt',private.adaptive_search_recurring_prompt('${f.search}','${project}'),
    'schema',private.opportunity_search_result_schema(),
    'properties',(select to_jsonb(p)-'prosrc' from pg_proc p where oid='${signature}'::regprocedure));`);
  try {
    sql(previous[0]);
    const old = begin(f), before = snapshot();
    assert.equal(old.compatible, true);
    assert.doesNotMatch(old.protocol_text, /EVIDENCE FIELD NAMES/u);
    const upgrade = file('supabase/releases/adaptive-search-evidence-fields-v1.sql');
    sql(upgrade);
    // This immutable historical upgrade predates startup logging. Verify its
    // exact reviewed body; the logging upgrade has its own ordered-upgrade test.
    const expectedBody = /AS \$\$([\s\S]*?)\$\$;/u.exec(upgrade)![1]!.trim();
    assert.equal(sql(`select prosrc from pg_proc where oid='${signature}'::regprocedure;`), expectedBody);
    assert.equal(snapshot(), before, 'Installation changed a historical pin, run, schema, recurring prompt or access');
    const refreshed = begin(f);
    assert.equal(refreshed.compatible, true, JSON.stringify(refreshed));
    assert.equal(refreshed.scope.run_id, f.run);
    assert.ok(refreshed.protocol_text.startsWith(old.protocol_text + '\n\nEVIDENCE FIELD NAMES\n'));
    assert.equal(snapshot(), before, 'Re-reading the same run changed its pinned contract or lease');
    assert.throws(() => sql(upgrade), /Expected the reviewed/iu);
  } finally {
    try { cleanup(f); } finally { reset(); }
  }
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
