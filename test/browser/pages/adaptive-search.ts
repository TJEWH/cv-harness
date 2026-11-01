import { createApp, h, ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import MetaSearchEditor from '../../../src/features/meta-search/components/MetaSearchEditor.vue';
import { DEFAULT_SEARCH_TEMPLATES, searchTemplateContentKey } from '../../../src/features/meta-search/data/searchTemplateRepository';
import { buildRecurringSearchPrompt, buildSearchSystemPrompt, buildSearchUserPrompt } from '../../../src/features/meta-search/domain/searchPrompts';
import { searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../../../src/features/meta-search/data/searchTemplateCloud';
import type { SearchCloudTemplate } from '../../../src/features/meta-search/searchTypes';
import type { AdaptiveSearchRunnerState } from '../../../src/features/meta-search/domain/adaptiveSearchTask';
import type { AdaptiveSearchDashboardData } from '../../../src/features/meta-search/composables/adaptiveSearchDashboard';
import { createSearchBreadthPolicy } from '../../../src/features/meta-search/domain/adaptiveSearchPlanner';
import dashboardFixture from '../fixtures/adaptive-dashboard.fixture.json';
import '../../../src/assets/cv.css';

// Captured only from the isolated synthetic AF-10 SQL fixture, never production.
const dashboard = structuredClone(dashboardFixture) as unknown as AdaptiveSearchDashboardData;
const owner = dashboard.user_id, search = dashboard.search_id, project = dashboard.project_ref;
const template = structuredClone(DEFAULT_SEARCH_TEMPLATES[0]!);
template.name = 'Synthetic adaptive search'; template.researchInterests = 'BCI; acoustic sensing';
template.cloud = { id: search, revision: 1, contentKey: searchTemplateContentKey(template) };
let row: SearchCloudTemplate = { id: search, user_id: owner, name: template.name, revision: 1,
  criteria: searchTemplateCloudCriteria(template), schedule: searchTemplateCloudSchedule(template), created_at: template.updatedAt, updated_at: template.updatedAt,
  meta_search: { version: 1, active: true, editor: structuredClone(template), systemPrompt: buildSearchSystemPrompt(template),
    userPrompt: buildSearchUserPrompt(template), recurringPrompt: buildRecurringSearchPrompt(template) } };
let state: AdaptiveSearchRunnerState = { setup_contract_version: 1, user_id: owner, search_id: search, project_ref: project,
  revision: 0, mode: 'legacy', migration_requested: false, ready: true, readiness_code: 'ready', setup_id: null,
  binding: { task_id: 'synthetic-existing-task', schedule: row.schedule, runner_capability: null } };
if (new URLSearchParams(location.search).get('scenario') === 'legacy-empty') {
  // Synthetic legacy-only account: keep ordinary run history without inventing adaptive records.
  Object.assign(dashboard.settings, { adaptation_enabled: false, adaptation_paused: false, successful_source_reuse_enabled: false,
    institution_sources_omitted: 0, query_plan_dirty: false });
  dashboard.sources = [];
  dashboard.queries = { plan: null, executions: [] };
  dashboard.preferences = { revision: 0, approved_rules: [], suggestions: [], proposals: [] };
  dashboard.runner_authorization = { enabled: false, authorization_revision: 0, project_ref: null };
  dashboard.omitted = { sources: 0, preference_suggestions: 0, proposals: 0, queries: 0, executions: 0, runs: 0, withheld_fields: 0 };
  state = { ...state, ready: false, readiness_code: 'release_disabled',
    binding: { task_id: 'synthetic-legacy-task', schedule: row.schedule, runner_capability: 'legacy-v1' } };
  dashboard.readiness = structuredClone(state);
  const runShape = structuredClone(dashboard.runs[0]!);
  dashboard.runs = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(runShape),
    run_id: `84000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    status: index === 0 ? 'failed' : 'complete', started_at: new Date(Date.UTC(2026, 9, 31 - index, 8)).toISOString(),
    completed_at: new Date(Date.UTC(2026, 9, 31 - index, 8, 20)).toISOString(), query_plan_id: null,
    adaptive_contract_version: null, execution_report_status: 'unreported', backlog_candidates: null, backlog_omitted: null, backlog_overflow: null,
    counts: { new: index === 0 ? 3 : 0, updated: 0, unchanged: 0, verified: index === 0 ? 3 : 0,
      unresolved: null, failed_checks: 0, incomplete_sources: 0 },
    deadline: { late_discoveries: 0, possible_late_discoveries: 0, unknown: index === 0 ? 3 : 0,
      exact_lead_time_hours: null, lower_lead_time_hours: null, upper_lead_time_hours: null, uncertain: true },
  }));
}
const calls: { name: string; args: Record<string, unknown> }[] = [];
const copied = ref(''), saveCount = ref(0), requestCount = ref(0);
const lang = ref('en');
const actionReceipts = new Map<string, unknown>();
let loseSourceResponse = false;
let loseSettingsResponse = false;
let holdRequest = false, releaseRequest: (() => void) | null = null, failSave = false;
let failReadiness = new URLSearchParams(location.search).has('readinessFailure');
const client = { from: (name: string) => {
  if (name !== 'opportunity_search_templates') throw new Error('Unexpected fixture table');
  return { select: () => ({ eq: () => ({ order: async () => ({ data: [structuredClone(row)], error: null }) }) }) };
}, rpc: async (name: string, args: Record<string, unknown>) => {
  calls.push({ name, args: structuredClone(args) });
  if (name === 'read_opportunity_search_dashboard') return { data: { ...structuredClone(dashboard), readiness: structuredClone(state) }, error: null };
  if (name === 'patch_opportunity_search_settings') {
    const id = String(args.p_action_id);
    if (actionReceipts.has(id)) return { data: structuredClone(actionReceipts.get(id)), error: null };
    const patch = args.p_patch as Record<string, unknown>;
    Object.assign(dashboard.settings, patch);
    if ('adaptation_enabled' in patch || 'adaptation_paused' in patch) dashboard.settings.adaptation_revision++;
    if ('successful_source_reuse_enabled' in patch || 'reuse_check_interval_hours' in patch) dashboard.settings.source_reuse_revision++;
    if ('search_breadth_percent' in patch) {
      dashboard.settings.breadth_revision = (dashboard.settings.breadth_revision ?? 0) + 1;
      dashboard.settings.query_plan_dirty = true;
      dashboard.policy = createSearchBreadthPolicy(Number(patch.search_breadth_percent));
    }
    const receipt = { dashboard_version: 1, action_id: id, search_id: search, kind: 'settings', settings: structuredClone(dashboard.settings) };
    actionReceipts.set(id, receipt);
    if (loseSettingsResponse) { loseSettingsResponse = false; return { data: null, error: { code: 'NETWORK', message: 'Synthetic settings response lost after commit' } }; }
    return { data: receipt, error: null };
  }
  if (name === 'patch_opportunity_search_source') {
    const id = String(args.p_action_id);
    if (actionReceipts.has(id)) return { data: structuredClone(actionReceipts.get(id)), error: null };
    const source = dashboard.sources.find(source => source.registry_id === args.p_registry_id)!;
    Object.assign(source, args.p_patch); source.source_revision++;
    if (Object.hasOwn(args.p_patch as object, 'enabled')) source.owner_disabled = !source.enabled;
    const receipt = { dashboard_version: 1, action_id: id, search_id: search, kind: 'source', source: structuredClone(source) };
    actionReceipts.set(id, receipt);
    if (loseSourceResponse) { loseSourceResponse = false; return { data: null, error: { code: 'NETWORK', message: 'Synthetic source response lost after commit' } }; }
    return { data: receipt, error: null };
  }
  if (name === 'decide_opportunity_search_preference') {
    const suggestion = dashboard.preferences.suggestions.find(value => value.suggestion_id === args.p_suggestion_id)!;
    suggestion.state = args.p_action === 'approve' ? 'approved' : args.p_action === 'reject' ? 'rejected' : 'undone';
    dashboard.preferences.revision++; dashboard.settings.preference_revision = dashboard.preferences.revision;
    dashboard.preferences.approved_rules = suggestion.state === 'approved' ? [suggestion.rule] : [];
    return { data: { operation_id: args.p_operation_id, suggestion_id: args.p_suggestion_id, action: args.p_action,
      preference_revision: dashboard.preferences.revision, approved_rules: structuredClone(dashboard.preferences.approved_rules) }, error: null };
  }
  if (name === 'set_opportunity_search_runner_authorization') {
    dashboard.runner_authorization = { enabled: Boolean(args.p_enabled), project_ref: project, authorization_revision: dashboard.runner_authorization.authorization_revision + 1 };
    return { data: { search_id: search, ...dashboard.runner_authorization }, error: null };
  }
  if (name === 'read_adaptive_search_readiness') return failReadiness
    ? { data: null, error: { code: 'NETWORK', message: 'Synthetic readiness unavailable' } } : { data: structuredClone(state), error: null };
  if (name === 'request_adaptive_search_migration') {
    requestCount.value++;
    if (holdRequest) await new Promise<void>(resolve => { releaseRequest = resolve; });
    if (!state.migration_requested || state.setup_id !== args.p_setup_id) state = { ...state, revision: state.revision + 1, migration_requested: true, setup_id: String(args.p_setup_id) };
    return { data: structuredClone(state), error: null };
  }
  if (name === 'save_opportunity_meta_search') {
    if (failSave) { failSave = false; return { data: null, error: new Error('Synthetic save failed; draft retained') }; }
    saveCount.value++;
    row = { ...row, name: String(args.p_name), criteria: structuredClone(args.p_criteria) as SearchCloudTemplate['criteria'],
      schedule: structuredClone(args.p_schedule) as SearchCloudTemplate['schedule'], meta_search: structuredClone(args.p_meta_search) as SearchCloudTemplate['meta_search'],
      revision: Number(args.p_expected_revision) + 1 };
    return { data: structuredClone(row), error: null };
  }
  throw new Error('Unexpected synthetic RPC');
} } as unknown as SupabaseClient;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.value = value; } } });
Object.assign(window, { adaptiveFixture: {
  holdRequest: () => { holdRequest = true; }, releaseRequest: () => { holdRequest = false; releaseRequest?.(); },
  failSave: () => { failSave = true; }, failReadiness: (value: boolean) => { failReadiness = value; },
  loseSourceResponse: () => { loseSourceResponse = true; },
  loseSettingsResponse: () => { loseSettingsResponse = true; },
  snapshot: () => structuredClone({ row, state, dashboard, calls, copied: copied.value }),
} });
createApp({ setup() { return () => h('main', { style: 'height:100vh;display:flex;flex-direction:column' }, [
  h('p', { style: 'padding:8px;color:var(--ui-muted);font:13px system-ui' }, 'Synthetic fixture — no production connection or scheduled task operations.'),
  h('output', { 'data-testid': 'fixture-events', style: 'padding:8px;color:var(--ui-muted);font:13px system-ui' }, `Saves: ${saveCount.value}; requests: ${requestCount.value}`),
  h('button', { type: 'button', onClick: () => { lang.value = lang.value === 'en' ? 'de' : 'en'; } }, 'English / Deutsch'),
  h(MetaSearchEditor, { userId: owner, projectId: project, client, lang: lang.value, sidebarActive: false, style: 'flex:1;min-height:0' }),
]); } }).mount('#app');
