import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { watch } from 'vue';
import { compileAdaptiveFeedbackSnapshot } from '../../../src/features/meta-search/domain/adaptiveFeedbackSnapshots';
import { createSearchBreadthPolicy, DEFAULT_ADAPTIVE_SEARCH_POLICY, LEGACY_ADAPTIVE_SEARCH_POLICY } from '../../../src/features/meta-search/domain/adaptiveSearchPlanner';
import { adaptiveDashboardRunState, createAdaptiveSearchDashboardController, readAdaptiveSearchDashboard, validateAdaptiveSettingsPatch, validateAdaptiveSourcePatch } from '../../../src/features/meta-search/composables/adaptiveSearchDashboard';

const id = (index: number) => `81000000-0000-4000-8000-${index.toString(16).padStart(12,'0')}`;
const scope = { ownerId: id(1), searchId: id(2), projectRef: 'abcdefghijklmnopqrst' };
const now = '2026-10-29T12:00:00Z';
const clone = <T>(value: T): T => structuredClone(value);
async function fixture() {
  const feedback = await compileAdaptiveFeedbackSnapshot({ user_id: scope.ownerId, search_id: scope.searchId,
    feedback_revision: 0, examples: [] });
  return { dashboard_version: 1, user_id: scope.ownerId, search_id: scope.searchId, project_ref: scope.projectRef,
    settings: { adaptation_enabled: false, adaptation_paused: false, successful_source_reuse_enabled: false,
      reuse_check_interval_hours: 168, search_breadth_percent: 20, breadth_revision: 0, adaptation_revision: 0, source_reuse_revision: 0, feedback_revision: 0, preference_revision: 0, query_plan_revision: 1, query_plan_dirty: false },
    policy: { ...DEFAULT_ADAPTIVE_SEARCH_POLICY },
    planning_capacity: { core_queries: 1, discretionary: 29 } as { core_queries: number; discretionary: number } | null,
    readiness: { setup_contract_version: 1, user_id: scope.ownerId, search_id: scope.searchId, project_ref: scope.projectRef,
      revision: 0, mode: 'legacy', migration_requested: false, ready: false, readiness_code: 'owner_not_authorized', setup_id: null, binding: null },
    runner_authorization: { enabled: false, authorization_revision: 0, project_ref: null as string | null }, feedback_preview: feedback,
    preferences: { revision: 0, approved_rules: [], suggestions: [{ suggestion_id: id(5), rule: { rule_id: id(6), kind: 'emphasis', category: 'topic', polarity: 'positive', target: 'Acoustic sensing', evidence_refs: [id(7)] }, origin: 'runner', state: 'pending', created_at: now, decided_at: null }], proposals: [] },
    sources: [{ registry_id: id(3), listing_url: 'https://example.invalid/Jobs?topic=BCI' as string | null, vacancy_url: null, kind: 'university', institution: 'Synthetic Institute', topics: ['BCI'], priority: 50,
      enabled: true, pinned: false, mandatory: true, check_interval_hours: 168, last_attempted_at: now, last_successful_at: null, status: 'blocked', owner_disabled: false,
      provenance: 'explicit', listing_verified_at: null, source_revision: 1, coverage: { last_status: 'blocked', last_attempted_at: now, last_failure_reason: 'access_denied' },
      outcomes: { sample_size: 1, reviewed: 1, with_interest: 1, mean_interest: 0, explicit_high_interest: 0, confirmed_submissions: 0 } }],
    queries: { plan: { id: id(10), revision: 1, plan_hash: 'a'.repeat(64), created_at: now,
      basis: { base_revision: 1, feedback_revision: 0, preference_revision: 0, protocol_version: 'opportunity-search-v1-canonical-6' }, planning_policy: null,
      queries: [{ query_id: id(11), query: 'site:https://example.invalid/Jobs?topic=BCI acoustic sensing PhD' as string | null, text_hash: 'b'.repeat(64), role: 'core', manual: true, source_registry_id: id(3), withheld: false,
        outcomes: { sample_size: 1, reviewed: 1, with_interest: 1, mean_interest: 0, explicit_high_interest: 0, confirmed_submissions: 0 } }] },
      executions: [{ run_id: id(12), check_id: id(13), kind: 'source', query_id: null, text_hash: null, source_registry_id: id(3), attempted_at: now, status: 'blocked', results_count: null, failure_reason: 'access_denied' }] },
    runs: [{ run_id: id(12), status: 'failed', started_at: now, completed_at: now, basis: { base_revision: 1, feedback_revision: null, preference_revision: null, protocol_version: 'opportunity-search-v1-canonical-6' },
      query_plan_id: null, adaptive_contract_version: null, execution_report_status: 'unreported', backlog_candidates: null as number | null, backlog_omitted: null as number | null, backlog_overflow: null as boolean | null,
      counts: { new: 0, updated: 0, unchanged: 0, verified: 0, unresolved: null as number | null, incomplete_sources: 1, failed_checks: 1 },
      deadline: { late_discoveries: 0, possible_late_discoveries: 1, unknown: 1, exact_lead_time_hours: null, lower_lead_time_hours: 60, upper_lead_time_hours: 84, uncertain: true }, delivery_status: 'unknown' }],
    omitted: { sources: 0, preference_suggestions: 0, proposals: 0, queries: 0, executions: 0, runs: 0, withheld_fields: 0 },
    bounds: { maximum_dashboard_bytes: 262144, maximum_feedback_bytes: 65536, maximum_sources: 64, maximum_queries: 30, maximum_executions: 64, maximum_runs: 10, maximum_suggestions: 64, maximum_proposals: 32 } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const tick = async () => { for (let index=0;index<15;index++) await Promise.resolve(); };
type Reply = { data: unknown; error: null | { code: string; message?: string } };
function mock(data: Fixture) {
  const calls: { name: string; args: Record<string,any> }[] = [], receipts = new Map<string,unknown>();
  const hooks: { afterWrite?: (name: string, args: Record<string,any>, reply: Reply) => Promise<Reply> | Reply } = {};
  const client = { rpc: async (name: string, args: Record<string,any>): Promise<Reply> => {
    calls.push({ name,args: clone(args) });
    if (name === 'read_opportunity_search_dashboard') return { data: clone(data),error: null };
    const operation = args.p_action_id ?? args.p_operation_id;
    let result = receipts.get(operation);
    if (!result) {
      if (name === 'patch_opportunity_search_settings') {
        Object.assign(data.settings,args.p_patch);
        if (Object.hasOwn(args.p_patch,'search_breadth_percent')) {
          data.policy = { ...createSearchBreadthPolicy(args.p_patch.search_breadth_percent) };
          data.settings.query_plan_dirty = true;
        }
        for (const key of Object.keys(args.p_expected_revisions)) data.settings[key as keyof Fixture['settings']] = args.p_expected_revisions[key]+1 as never;
        result = { dashboard_version: 1,action_id: args.p_action_id,search_id: data.search_id,kind: 'settings',settings: clone(data.settings) };
      } else if (name === 'patch_opportunity_search_source') {
        const source = data.sources.find(row => row.registry_id === args.p_registry_id)!;
        Object.assign(source,args.p_patch); source.source_revision++;
        const { coverage: _coverage,outcomes: _outcomes,...saved } = source;
        result = { dashboard_version: 1,action_id: args.p_action_id,search_id: data.search_id,kind: 'source',source: clone(saved) };
      } else if (name === 'decide_opportunity_search_preference') {
        data.preferences.revision++; data.preferences.suggestions[0]!.state = args.p_action === 'approve' ? 'approved' : args.p_action === 'reject' ? 'rejected' : 'undone';
        result = { operation_id: args.p_operation_id,suggestion_id: args.p_suggestion_id,action: args.p_action,preference_revision: data.preferences.revision,approved_rules: [] };
      } else if (name === 'set_opportunity_search_runner_authorization') {
        data.runner_authorization = { enabled: args.p_enabled,authorization_revision: data.runner_authorization.authorization_revision+1,project_ref: data.project_ref };
        result = { search_id: data.search_id,...data.runner_authorization };
      } else throw new Error(`Unexpected synthetic RPC: ${name}`);
      if (operation) receipts.set(operation,clone(result));
    }
    const reply: Reply = { data: clone(result),error: null };
    return hooks.afterWrite ? hooks.afterWrite(name,args,reply) : reply;
  } } as unknown as Pick<SupabaseClient,'rpc'>;
  let sequence=100;
  return { client,calls,hooks,randomId: () => id(sequence++) };
}

test('AF-10 owner dashboard retains exact outgoing packet, honest unknowns and safe public URL queries', async () => {
  const raw = await fixture();
  const result = await readAdaptiveSearchDashboard(raw,scope.ownerId,scope.searchId,scope.projectRef);
  assert.deepEqual(result.feedback_preview,raw.feedback_preview);
  assert.equal(result.sources[0]!.outcomes.mean_interest,0);
  assert.equal(result.runs[0]!.counts.unresolved,null);
  assert.equal(result.runs[0]!.deadline.exact_lead_time_hours,null);
  assert.equal(result.queries.plan!.queries[0]!.query,raw.queries.plan.queries[0]!.query);
  assert.equal(result.queries.executions[0]!.results_count,null);
  assert.equal(result.queries.plan!.queries[0]!.outcomes.mean_interest,0);
  assert.equal(result.runs[0]!.backlog_candidates,null);
  const poisoned = Object.assign(clone(raw),{ contacts: [{ email: 'private@example.invalid' }],applications: [{ context_json: 'PRIVATE_CONTEXT' }] });
  Object.assign(poisoned.sources[0]!,{ private_comment: 'PRIVATE_COMMENT',contacts: [{ name: 'Private Person' }] });
  const projected = await readAdaptiveSearchDashboard(poisoned,scope);
  assert.doesNotMatch(JSON.stringify(projected),/private@example|PRIVATE_CONTEXT|PRIVATE_COMMENT|Private Person|contacts|context_json/);
});

test('dashboard loads historical protocol identifiers containing dates in runs and saved plans', async () => {
  const raw = await fixture();
  const historicalProtocol = 'opportunity-search-v1-2026-10-12-normalization-3';
  raw.runs.push({ ...clone(raw.runs[0]!), run_id: id(14) });
  raw.runs[0]!.basis.protocol_version = historicalProtocol;
  raw.queries.plan.basis.protocol_version = historicalProtocol;
  const service = mock(raw), controller = createAdaptiveSearchDashboardController(service.client, scope, service);
  try {
    assert.equal(await controller.load(), true);
    assert.equal(controller.state.error, '');
    assert.equal(controller.state.data!.runs[0]!.basis.protocol_version, historicalProtocol);
    assert.equal(controller.state.data!.runs[1]!.basis.protocol_version, 'opportunity-search-v1-canonical-6');
    assert.equal(controller.state.data!.queries.plan!.basis.protocol_version, historicalProtocol);
    assert.deepEqual(controller.state.data!.feedback_preview, raw.feedback_preview);
    assert.deepEqual(service.calls.map(call => call.name), ['read_opportunity_search_dashboard']);
  } finally { controller.dispose(); }
});

test('dashboard protocol identifiers reject prose, contacts, URLs, controls and oversized values', async () => {
  const raw = await fixture();
  for (const protocol of [null, 123, '', 'private@example.invalid', 'https://example.invalid/protocol',
    ' opportunity-search-v1', 'opportunity-search-v1 private context', 'opportunity-search-v1\ncanonical-6',
    'opportunity-search-v1-"contacts":{}', '<script>private</script>', 'a'.repeat(201)]) {
    const invalidRun = clone(raw); Object.assign(invalidRun.runs[0]!.basis, { protocol_version: protocol });
    await assert.rejects(readAdaptiveSearchDashboard(invalidRun, scope));
    const invalidPlan = clone(raw); Object.assign(invalidPlan.queries.plan.basis, { protocol_version: protocol });
    await assert.rejects(readAdaptiveSearchDashboard(invalidPlan, scope));
  }
});

test('AF-10 exact packet validation rejects hidden extra/private fields and malformed or foreign scope', async () => {
  const raw = await fixture();
  for (const patch of [{ user_id: id(99) },{ search_id: id(99) },{ project_ref: 'zyxwvutsrqponmlkjihg' },{ dashboard_version: 2 }]) {
    await assert.rejects(readAdaptiveSearchDashboard({ ...raw,...patch },scope));
  }
  await assert.rejects(readAdaptiveSearchDashboard({ ...raw,feedback_preview: { ...raw.feedback_preview,private_comment: 'PRIVATE' } },scope));
  const invalid = clone(raw); invalid.queries.plan.queries[0]!.query = 'site:https://example.invalid/Jobs?next=https%3A%2F%2Fexample.invalid%2Fgo%3Faccess_token%3Dsecret robotics';
  await assert.rejects(readAdaptiveSearchDashboard(invalid,scope));
  invalid.queries.plan.queries[0]!.query = 'person@example.invalid robotics';
  await assert.rejects(readAdaptiveSearchDashboard(invalid,scope));
  await assert.rejects(readAdaptiveSearchDashboard({ ...raw,runs: Array(11).fill(raw.runs[0]) },scope));
});

test('AF-10 display-only source flags and withheld query text never fabricate execution eligibility or text', async () => {
  const raw = await fixture(); raw.sources[0]!.listing_url = null; raw.queries.plan.queries[0]!.query = null; raw.queries.plan.queries[0]!.withheld = true;
  raw.omitted.withheld_fields = 2;
  const result = await readAdaptiveSearchDashboard(raw,scope);
  assert.equal(result.sources[0]!.enabled,true); assert.equal(result.sources[0]!.listing_url,null);
  assert.equal(result.sources[0]!.status,'blocked'); assert.equal(result.queries.plan!.queries[0]!.query,null);
  assert.equal(result.omitted.withheld_fields,2);
});

test('AF-10 structured patches are closed and cannot mutate base intent or implicitly approve preferences', () => {
  for (const value of [{ meta_search: {} },{ researchInterests: 'Rewrite letters' },{ adaptation_enabled: 'true' },{ reuse_check_interval_hours: 23 },{}]) assert.throws(() => validateAdaptiveSettingsPatch(value));
  for (const value of [{ source_revision: 1 },{ check_interval_hours: 721 },{ listing_url: 'https://example.invalid/Jobs' },{ mandatory: false },{ enabled: 'true' }]) assert.throws(() => validateAdaptiveSourcePatch(value));
  assert.deepEqual(validateAdaptiveSourcePatch({ pinned: false,check_interval_hours: 24 }),{ pinned: false,check_interval_hours: 24 });
});

test('search breadth accepts only whole five-point percentages and preserves canonical capacity', async () => {
  for (const value of [-5, 101, 21, 2.5, '20', null, NaN]) assert.throws(() => validateAdaptiveSettingsPatch({ search_breadth_percent: value }));
  for (const value of [0, 5, 20, 50, 100]) assert.deepEqual(validateAdaptiveSettingsPatch({ search_breadth_percent: value }), { search_breadth_percent: value });
  const raw = await fixture(), result = await readAdaptiveSearchDashboard(raw, scope);
  assert.equal(result.settings.search_breadth_percent, 20);
  assert.equal(result.settings.breadth_revision, 0);
  assert.deepEqual(result.planning_capacity, { core_queries: 1, discretionary: 29 });
  for (const capacity of [{ core_queries: 1, discretionary: 30 }, { core_queries: -1, discretionary: 30 }, { core_queries: 1.5, discretionary: 28.5 }]) {
    await assert.rejects(readAdaptiveSearchDashboard({ ...raw, planning_capacity: capacity }, scope));
  }
  await assert.rejects(readAdaptiveSearchDashboard({ ...raw, settings: { ...raw.settings, search_breadth_percent: 25 } }, scope), 'effective policy must match the saved setting');
  assert.equal((await readAdaptiveSearchDashboard({ ...raw, planning_capacity: null }, scope)).planning_capacity, null);
});

test('an older installed dashboard stays readable but cannot pretend to save breadth', async () => {
  const raw = await fixture(), legacy = clone(raw) as any;
  delete legacy.settings.search_breadth_percent; delete legacy.settings.breadth_revision; delete legacy.planning_capacity;
  legacy.policy = { ...LEGACY_ADAPTIVE_SEARCH_POLICY };
  const parsed = await readAdaptiveSearchDashboard(legacy, scope);
  assert.equal(parsed.settings.search_breadth_percent, null); assert.equal(parsed.settings.breadth_revision, null);
  assert.equal(parsed.planning_capacity, null); assert.equal(parsed.sources.length, raw.sources.length);
  const service = mock(legacy), controller = createAdaptiveSearchDashboardController(service.client, scope, service);
  await controller.load();
  assert.equal(await controller.patchSettings({ search_breadth_percent: 55 }), false);
  assert.equal(controller.state.error, 'breadth_upgrade_required'); assert.equal(controller.state.retryable, false);
  assert.equal(service.calls.filter(call => call.name === 'patch_opportunity_search_settings').length, 0);
  controller.dispose();
});

test('historical v1 plan policy remains readable with current v2 settings', async () => {
  const raw = await fixture();
  (raw.queries.plan as any).planning_policy = { ...LEGACY_ADAPTIVE_SEARCH_POLICY };
  const result = await readAdaptiveSearchDashboard(raw, scope);
  assert.equal(result.policy.policy_version, 'adaptive-query-v3');
  assert.equal(result.queries.plan!.planning_policy!.policy_version, 'adaptive-query-v1');
});

test('breadth saves independently while adaptation is off and never opts into feedback', async () => {
  const raw = await fixture(), service = mock(raw), controller = createAdaptiveSearchDashboardController(service.client, scope, service);
  await controller.load();
  assert.equal(await controller.patchSettings({ search_breadth_percent: 55 }), true);
  const write = service.calls.find(call => call.name === 'patch_opportunity_search_settings')!;
  assert.deepEqual(write.args.p_patch, { search_breadth_percent: 55 });
  assert.deepEqual(write.args.p_expected_revisions, { breadth_revision: 0 });
  assert.equal(controller.state.data!.settings.breadth_revision, 1);
  assert.equal(Object.hasOwn(controller.state.data!.settings, 'structured_feedback_enabled'), false);
  assert.equal(controller.state.data!.settings.adaptation_enabled, false);
  assert.equal(controller.state.data!.policy.exploration_ratio, 0.55);
  assert.equal(await controller.patchSettings({ search_breadth_percent: 0 }), true);
  assert.equal(controller.state.data!.policy.minimum_exploration_queries, 0);
  assert.equal(service.calls.some(call => /meta_search|schedule|request_adaptive/.test(call.name)), false);
  controller.dispose();
});

test('a lost breadth acknowledgement retries the identical request and detects a newer owner setting', async () => {
  const raw = await fixture(), service = mock(raw), controller = createAdaptiveSearchDashboardController(service.client, scope, service);
  await controller.load(); let writes = 0;
  service.hooks.afterWrite = (name, _args, reply) => name === 'patch_opportunity_search_settings' && ++writes === 1 ? { data: null, error: { code: 'NETWORK' } } : reply;
  assert.equal(await controller.patchSettings({ search_breadth_percent: 75 }), false);
  assert.equal(controller.state.retryable, true);
  raw.settings.search_breadth_percent = 35; raw.settings.breadth_revision++;
  raw.policy = { ...createSearchBreadthPolicy(35) };
  assert.equal(await controller.retry(), false);
  const calls = service.calls.filter(call => call.name === 'patch_opportunity_search_settings');
  assert.deepEqual(calls[0]!.args, calls[1]!.args);
  assert.equal(controller.state.data!.settings.search_breadth_percent, 35);
  assert.equal(controller.state.error, 'conflict'); assert.equal(controller.state.retryable, false);
  assert.equal(await controller.flush(), false); controller.dispose();
});

test('AF-10 malformed outcome denominators are rejected instead of presenting fabricated quality', async () => {
  const raw = await fixture(); raw.queries.plan.queries[0]!.outcomes.explicit_high_interest = 2;
  await assert.rejects(readAdaptiveSearchDashboard(raw,scope));
});

test('AF-10 run labels preserve incomplete/unknown coverage despite a complete lifecycle and keep resolved retries successful', async () => {
  const parsed = await readAdaptiveSearchDashboard(await fixture(),scope), original = parsed.runs[0]!;
  assert.equal(adaptiveDashboardRunState(original),'failed');
  const complete = { ...original,status: 'complete' as const,execution_report_status: 'complete' as const,backlog_candidates: 0,backlog_omitted: 0,backlog_overflow: false,
    counts: { ...original.counts,incomplete_sources: 0,unresolved: 0,failed_checks: 2 } };
  assert.equal(adaptiveDashboardRunState(complete),'empty','past failures may have a successful retry');
  assert.equal(adaptiveDashboardRunState({ ...complete,counts: { ...complete.counts,incomplete_sources: 1 } }),'incomplete');
  assert.equal(adaptiveDashboardRunState({ ...complete,counts: { ...complete.counts,unresolved: 1 } }),'incomplete');
  assert.equal(adaptiveDashboardRunState({ ...complete,counts: { ...complete.counts,new: 1,verified: 0 } }),'incomplete');
  assert.equal(adaptiveDashboardRunState({ ...complete,backlog_candidates: 1 }),'incomplete');
  assert.equal(adaptiveDashboardRunState({ ...complete,backlog_omitted: 1 }),'incomplete');
  assert.equal(adaptiveDashboardRunState({ ...complete,backlog_overflow: true }),'incomplete');
  assert.equal(adaptiveDashboardRunState({ ...complete,counts: { ...complete.counts,unresolved: null } }),'unknown');
  assert.equal(adaptiveDashboardRunState({ ...complete,backlog_candidates: null }),'unknown');
  assert.equal(adaptiveDashboardRunState({ ...complete,execution_report_status: 'unreported' }),'unknown');
  assert.equal(adaptiveDashboardRunState({ ...complete,counts: { ...complete.counts,new: 1,verified: 1 } }),'complete');
});

test('AF-10 explicit adaptation changes need no sharing opt-in and do not enable the runner', async () => {
  const raw = await fixture(), service = mock(raw), controller = createAdaptiveSearchDashboardController(service.client,scope,service); await controller.load();
  assert.equal(await controller.patchSettings({ adaptation_enabled: true, adaptation_paused: false }),true);
  assert.deepEqual(service.calls.find(call=>call.name.startsWith('patch_'))!.args.p_expected_revisions,{ adaptation_revision: 0 });
  assert.equal(controller.state.data!.runner_authorization.enabled, false);
  assert.equal(service.calls.some(call => /set_opportunity_search_runner_authorization|request_adaptive/.test(call.name)), false);
  assert.throws(() => validateAdaptiveSettingsPatch({ structured_feedback_enabled: false }));
  controller.dispose();
});

test('AF-10 sequential independent settings use only touched axes and acknowledged current revisions', async () => {
  const raw = await fixture(), service = mock(raw), controller = createAdaptiveSearchDashboardController(service.client,scope,service);
  assert.equal(await controller.load(),true);
  const first = controller.patchSettings({ successful_source_reuse_enabled: true });
  const second = controller.patchSettings({ adaptation_enabled: true });
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  const writes = service.calls.filter(call => call.name.startsWith('patch_'));
  assert.equal(writes.length,2);
  assert.deepEqual(writes[0]!.args.p_expected_revisions,{ source_reuse_revision: 0 });
  assert.deepEqual(writes[1]!.args.p_expected_revisions,{ adaptation_revision: 0 });
  assert.deepEqual(writes[1]!.args.p_patch,{ adaptation_enabled: true });
  assert.equal(controller.state.data!.settings.successful_source_reuse_enabled,true);
  assert.equal(service.calls.some(call => /meta_search|schedule|request_adaptive/.test(call.name)),false);
  controller.dispose();
});

test('AF-10 lost source response retries the exact identity/body and retains newer drafts until their own commit', async () => {
  const raw = await fixture(), service = mock(raw), firstWrite = deferred<Reply>(); let writes=0;
  service.hooks.afterWrite = async (_name,_args,reply) => ++writes===1 ? firstWrite.promise : reply;
  const controller = createAdaptiveSearchDashboardController(service.client,scope,service); await controller.load();
  controller.sourceDraft(id(3),{ pinned: true }); const saving = controller.saveSource(id(3)); await tick();
  controller.sourceDraft(id(3),{ check_interval_hours: 24 });
  firstWrite.resolve({ data: null,error: { code: 'NETWORK' } });
  assert.equal(await saving,false); assert.equal(controller.state.retryable,true);
  assert.equal(await controller.flush(),false);
  assert.equal(await controller.retry(),true);
  const retries = service.calls.filter(call => call.name==='patch_opportunity_search_source');
  assert.deepEqual(retries[1]!.args,retries[0]!.args);
  assert.deepEqual(controller.state.drafts[id(3)],{ pinned: true,check_interval_hours: 24 });
  assert.equal(await controller.flush(),true);
  assert.equal(controller.state.data!.sources[0]!.check_interval_hours,24);
  assert.equal(Object.keys(controller.state.drafts).length,0); controller.dispose();
});

test('AF-10 a historical source receipt cannot silently overwrite a newer current source after reload', async () => {
  const raw = await fixture(), isolated = { ...scope,searchId: id(500) };
  raw.search_id = isolated.searchId; raw.readiness.search_id = isolated.searchId;
  const service = mock(raw); let writes=0;
  service.hooks.afterWrite = async (_name,_args,reply) => {
    if (++writes===1) return { data: null,error: { code: 'NETWORK' } };
    raw.sources[0]!.check_interval_hours = 72; raw.sources[0]!.source_revision++;
    return reply;
  };
  const controller = createAdaptiveSearchDashboardController(service.client,isolated,service); await controller.load();
  controller.sourceDraft(id(3),{ check_interval_hours: 48 });
  assert.equal(await controller.saveSource(id(3)),false);
  controller.sourceDraft(id(3),{ pinned: true });
  assert.equal(await controller.retry(),false,'a historical exact acknowledgment is not current-value confirmation');
  assert.equal(controller.state.errorKind,'conflict');
  assert.equal(controller.state.data!.sources[0]!.check_interval_hours,72);
  assert.deepEqual(controller.state.drafts[id(3)],{ check_interval_hours: 48,pinned: true });
  const sent = service.calls.length;
  assert.equal(await controller.retry(),false); assert.equal(await controller.flush(),false);
  assert.equal(service.calls.length,sent,'no automatic corrective overwrite after the conflict');
  const writesSent = service.calls.filter(call=>call.name==='patch_opportunity_search_source');
  assert.deepEqual(writesSent[0]!.args,writesSent[1]!.args,'historical receipt retry remains exact');
  assert.equal(controller.discardSourceDraft(id(3)),true); assert.equal(await controller.flush(),true); controller.dispose();
});

test('AF-10 conflicts/permission denials block writes without automatic retries or alternate transports', async () => {
  for (const code of ['40001','42501']) {
    const raw = await fixture(), isolated = { ...scope,searchId: id(code === '40001' ? 401 : 402) };
    raw.search_id = isolated.searchId; raw.readiness.search_id = isolated.searchId;
    const service = mock(raw);
    service.hooks.afterWrite = async () => ({ data: null,error: { code,message: 'PRIVATE_DATABASE_DETAIL' } });
    const controller = createAdaptiveSearchDashboardController(service.client,isolated,service); await controller.load();
    controller.sourceDraft(id(3),{ pinned: false }); assert.equal(await controller.saveSource(id(3)),false);
    assert.equal(await controller.retry(),false); assert.equal(await controller.flush(),false);
    assert.equal(await controller.patchSettings({ adaptation_paused: true }),false);
    assert.equal(service.calls.filter(call=>call.name.startsWith('patch_')).length,1);
    assert.doesNotMatch(controller.state.error,/PRIVATE_DATABASE_DETAIL/); controller.dispose();
  }
});

test('AF-10 owner switches cancel stale reads and queued writes before applying data or authorization callbacks', async () => {
  const raw = await fixture(), pending = deferred<Reply>(), calls: string[]=[]; let authorizations=0;
  const client = { rpc: async (name: string) => { calls.push(name); return pending.promise; } } as unknown as Pick<SupabaseClient,'rpc'>;
  const controller = createAdaptiveSearchDashboardController(client,scope,{ randomId: () => id(100),onRunnerChanged: () => authorizations++ });
  const read = controller.load(); controller.setScope({ ...scope,ownerId: id(20),searchId: id(21) });
  pending.resolve({ data: raw,error: null }); assert.equal(await read,false); assert.equal(controller.state.data,null);
  assert.equal(authorizations,0); assert.deepEqual(calls,['read_opportunity_search_dashboard']); controller.dispose();
  const service = mock(await fixture()), queued = createAdaptiveSearchDashboardController(service.client,scope,service); await queued.load();
  const write = queued.patchSettings({ adaptation_paused: true }); queued.setScope({ ...scope,ownerId: id(20),searchId: id(21) });
  assert.equal(await write,false); assert.equal(service.calls.filter(call=>call.name.startsWith('patch_')).length,0); queued.dispose();
});

test('AF-10 source recovery is isolated by owner/search and a missing read-only deployment never blocks base navigation', async () => {
  const raw = await fixture(), service = mock(raw), storage = new Map<string,string>();
  const persistence = { getItem: (key: string) => storage.get(key) ?? null,setItem: (key: string,value: string) => { storage.set(key,value); },removeItem: (key: string) => { storage.delete(key); } };
  const first = createAdaptiveSearchDashboardController(service.client,scope,{ ...service,storage: persistence });
  await first.load(); first.sourceDraft(id(3),{ check_interval_hours: 48 }); first.dispose();
  const restored = createAdaptiveSearchDashboardController(service.client,scope,{ ...service,storage: persistence });
  assert.deepEqual(restored.state.drafts[id(3)],{ check_interval_hours: 48 });
  const other = createAdaptiveSearchDashboardController(service.client,{ ...scope,ownerId: id(91) },{ ...service,storage: persistence });
  assert.deepEqual(other.state.drafts,{}); other.dispose();
  await restored.load(); assert.equal(await restored.flush(),true); restored.dispose();
  const missingClient = { rpc: async () => ({ data: null,error: { code: 'PGRST202' } }) } as unknown as Pick<SupabaseClient,'rpc'>;
  const unavailable = createAdaptiveSearchDashboardController(missingClient,{ ...scope,searchId: id(92) });
  assert.equal(await unavailable.load(),false); assert.equal(await unavailable.flush(),true); unavailable.dispose();
});

test('AF-10 rule decisions and runner authorization occur only as explicit actions with exact CAS identities', async () => {
  const raw = await fixture(), service = mock(raw); let runnerChanges=0;
  const controller = createAdaptiveSearchDashboardController(service.client,scope,{ ...service,onRunnerChanged: () => runnerChanges++ }); await controller.load();
  assert.equal(await controller.flush(),true); assert.equal(service.calls.length,1);
  assert.equal(await controller.decide(id(5),'approve'),true);
  const approval = service.calls.find(call=>call.name==='decide_opportunity_search_preference')!;
  assert.equal(approval.args.p_expected_revision,0); assert.equal(typeof approval.args.p_operation_id,'string');
  assert.equal(await controller.authorize(true),true); assert.equal(runnerChanges,1);
  assert.equal(service.calls.find(call=>call.name==='set_opportunity_search_runner_authorization')!.args.p_expected_revision,0);
  assert.equal(controller.state.data!.runner_authorization.enabled,true); controller.dispose();
});

test('runner authorization reports an unconfigured project without exposing database details or retrying it', async () => {
  const raw = await fixture(), service = mock(raw);
  let unavailable = true;
  const client = { rpc: async (name: string, args: Record<string,unknown>) => name === 'set_opportunity_search_runner_authorization' && unavailable
    ? { data: null, error: { code: '22023', message: 'Configured project binding is required', details: 'PRIVATE_DATABASE_DETAIL' } }
    : service.client.rpc(name,args) } as unknown as Pick<SupabaseClient,'rpc'>;
  const controller = createAdaptiveSearchDashboardController(client,scope,service);
  try {
    assert.equal(await controller.load(),true);
    assert.equal(await controller.authorize(true),false);
    assert.equal(controller.state.error,'runner_unavailable');
    assert.equal(controller.state.retryable,false);
    assert.equal(controller.state.data!.runner_authorization.enabled,false);
    assert.equal(await controller.retry(),false);
    assert.equal(await controller.flush(),false,'unacknowledged authorization remains unresolved until an explicit reload');
    assert.doesNotMatch(controller.state.error,/Configured|PRIVATE/);
    unavailable = false;
    assert.equal(await controller.load(),true);
    assert.equal(await controller.authorize(true),true);
    assert.equal(controller.state.error,'');
    assert.equal(controller.state.data!.runner_authorization.enabled,true);
  } finally { controller.dispose(); }
});

test('synchronous error observers receive the current exact-retry availability', async () => {
  const raw = await fixture(), service = mock(raw);
  const controller = createAdaptiveSearchDashboardController(service.client,scope,service);
  const observed: { error: string; retryable: boolean }[] = [];
  const stop = watch(() => controller.state.error, error => {
    if (error) observed.push({ error, retryable: controller.state.retryable });
  }, { flush: 'sync' });
  try {
    await controller.load();
    service.hooks.afterWrite = () => ({ data: null, error: { code: 'NETWORK' } });
    assert.equal(await controller.patchSettings({ adaptation_enabled: true }),false);
    assert.deepEqual(observed,[{ error: 'save_failed', retryable: true }]);
  } finally { stop(); controller.dispose(); }
});

test('only the known authorization configuration failure receives the runner-unavailable message', async () => {
  for (const [name,message] of [['set_opportunity_search_runner_authorization','PRIVATE_DATABASE_DETAIL'],
    ['patch_opportunity_search_settings','Configured project binding is required']] as const) {
    const raw = await fixture(), service = mock(raw);
    const client = { rpc: async (requested: string, args: Record<string,unknown>) => requested === name
      ? { data: null, error: { code: '22023', message } } : service.client.rpc(requested,args) } as unknown as Pick<SupabaseClient,'rpc'>;
    const controller = createAdaptiveSearchDashboardController(client,scope,service);
    try {
      await controller.load();
      assert.equal(await (name === 'set_opportunity_search_runner_authorization' ? controller.authorize(true) : controller.patchSettings({ adaptation_enabled: true })),false);
      assert.equal(controller.state.error,'save_failed');
      assert.equal(controller.state.retryable,false);
    } finally { controller.dispose(); }
  }
});

test('AF-10 an explicit orphan-draft discard is local, chosen-only and cannot cancel queued or saving requests', async () => {
  const raw = await fixture(), service = mock(raw), response = deferred<Reply>();
  const controller = createAdaptiveSearchDashboardController(service.client,scope,service); await controller.load();
  controller.sourceDraft(id(99),{ check_interval_hours: 48 });
  assert.equal(await controller.flush(),false); assert.equal(controller.state.error,'source_unavailable');
  const beforeMissingDiscard = service.calls.length;
  assert.equal(controller.discardSourceDraft(id(99)),true);
  assert.equal(service.calls.length,beforeMissingDiscard); assert.equal(await controller.flush(),true);
  service.hooks.afterWrite = async () => response.promise;
  controller.sourceDraft(id(3),{ pinned: true }); const saving = controller.saveSource(id(3));
  assert.equal(controller.discardSourceDraft(id(3)),false,'queued writes cannot be locally canceled as though they were never sent');
  await tick(); assert.equal(controller.discardSourceDraft(id(3)),false,'in-flight writes remain blocked');
  response.resolve({ data: null,error: { code: 'NETWORK' } }); assert.equal(await saving,false);
  controller.state.data!.sources = [];
  controller.sourceDraft(id(98),{ pinned: false });
  const callsBeforeDiscard = service.calls.length, dataBeforeDiscard = JSON.stringify(controller.state.data);
  assert.equal(controller.discardSourceDraft(id(98)),true);
  assert.equal(await controller.flush(),false,'discarding another draft does not clear the failed source request');
  assert.equal(controller.discardSourceDraft(id(3)),true);
  assert.equal(await controller.flush(),true); assert.equal(Object.keys(controller.state.drafts).length,0);
  assert.equal(JSON.stringify(controller.state.data),dataBeforeDiscard,'a local discard makes no remote success claim or state replacement');
  assert.equal(service.calls.length,callsBeforeDiscard,'discard must issue no RPC'); controller.dispose();
});
