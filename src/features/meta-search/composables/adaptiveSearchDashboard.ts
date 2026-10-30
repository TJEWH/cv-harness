import { reactive } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { opportunityFeedbackTimestamp } from '../../opportunities/domain/opportunityFeedback';
import { opportunityFeedbackTextIsSafe, sanitizeOpportunityFeedbackUrl } from '../../opportunities/domain/opportunityFeedbackPrivacy';
import { readAdaptiveSearchFeedbackPacket, type AdaptiveStartupFeedback } from '../domain/adaptiveSearchStartup';
import { readAdaptiveSearchRunnerState, requireSearchTaskScope, type AdaptiveSearchRunnerState } from '../domain/adaptiveSearchTask';
import type { AdaptiveSearchPlanBasis } from '../domain/adaptiveSearchPlans';
import { validateAdaptiveSearchPolicy, validateApprovedAdaptiveRules, type AdaptiveSearchPolicy, type ApprovedAdaptiveRule } from '../domain/adaptiveSearchPlanner';
import { ADAPTIVE_SOURCE_KINDS, ADAPTIVE_SOURCE_STATUSES, type AdaptiveSearchSource } from '../domain/adaptiveSearchSources';

export interface AdaptiveDashboardScope { ownerId: string; searchId: string; projectRef: string }
export interface AdaptiveDashboardSettings {
  adaptation_enabled: boolean; adaptation_paused: boolean;
  successful_source_reuse_enabled: boolean; reuse_check_interval_hours: number;
  search_breadth_percent: number | null; breadth_revision: number | null;
  institution_sources_omitted: number | null;
  adaptation_revision: number; source_reuse_revision: number; feedback_revision: number;
  preference_revision: number; query_plan_revision: number; query_plan_dirty: boolean;
}
export type AdaptiveSettingsPatch = Partial<Pick<AdaptiveDashboardSettings, 'adaptation_enabled' | 'adaptation_paused' | 'successful_source_reuse_enabled' | 'reuse_check_interval_hours'>> & { search_breadth_percent?: number };
export type AdaptiveSourcePatch = Partial<Pick<AdaptiveSearchSource, 'enabled' | 'pinned' | 'check_interval_hours'>>;
export interface AdaptiveDashboardSuggestion {
  suggestion_id: string; rule: ApprovedAdaptiveRule; origin: 'owner' | 'runner';
  state: 'pending' | 'approved' | 'rejected' | 'undone'; created_at: string; decided_at: string | null;
}
export interface AdaptiveDashboardSource extends AdaptiveSearchSource {
  source_revision: number;
  coverage: { last_status: string | null; last_attempted_at: string | null; last_failure_reason: string | null };
  outcomes: { sample_size: number; reviewed: number; with_interest: number; mean_interest: number | null; explicit_high_interest: number; confirmed_submissions: number };
}
export interface AdaptiveDashboardExecution {
  run_id: string; check_id: string; kind: 'query' | 'source'; query_id: string | null; text_hash: string | null;
  source_registry_id: string | null; attempted_at: string; status: 'complete' | 'blocked' | 'failed' | 'partial' | 'paginated' | 'dynamic'; results_count: number | null; failure_reason: string | null;
}
export interface AdaptiveDashboardQuery { query_id: string; query: string | null; text_hash: string; role: 'core' | 'adaptive' | 'exploration'; manual: boolean; source_registry_id: string | null; withheld: boolean; outcomes: AdaptiveDashboardSource['outcomes'] }
export interface AdaptiveDashboardPlan {
  id: string; revision: number; plan_hash: string; created_at: string; basis: AdaptiveSearchPlanBasis; planning_policy: AdaptiveSearchPolicy | null; queries: AdaptiveDashboardQuery[];
}
export interface AdaptiveDashboardRun {
  run_id: string; status: 'running' | 'complete' | 'failed'; started_at: string; completed_at: string | null;
  basis: { base_revision: number; feedback_revision: number | null; preference_revision: number | null; protocol_version: string };
  query_plan_id: string | null; adaptive_contract_version: number | null; execution_report_status: 'unreported' | 'complete' | 'partial' | 'failed';
  backlog_candidates: number | null; backlog_omitted: number | null; backlog_overflow: boolean | null;
  counts: { new: number; updated: number; unchanged: number; verified: number; unresolved: number | null; incomplete_sources: number; failed_checks: number };
  deadline: { late_discoveries: number; possible_late_discoveries: number; unknown: number; exact_lead_time_hours: number | null; lower_lead_time_hours: number | null; upper_lead_time_hours: number | null; uncertain: boolean };
  delivery_status: 'unknown';
}
export interface AdaptiveDashboardProposal {
  suggestion_id: string; kind: 'source' | 'query' | 'preference'; state: 'pending' | 'awaiting_verification' | 'deferred';
  reason: 'needs_verified_evidence' | 'needs_reviewed_evidence' | 'adaptation_disabled' | null; created_at: string; evidence_refs: string[]; listing_url: string | null; vacancy_url: string | null; query: string | null;
}
export interface AdaptiveSearchDashboardData {
  dashboard_version: 1; user_id: string; search_id: string; project_ref: string;
  settings: AdaptiveDashboardSettings; policy: AdaptiveSearchPolicy; readiness: AdaptiveSearchRunnerState;
  planning_capacity: { core_queries: number; discretionary: number } | null;
  runner_authorization: { enabled: boolean; authorization_revision: number; project_ref: string | null };
  feedback_preview: AdaptiveStartupFeedback;
  preferences: { revision: number; approved_rules: readonly ApprovedAdaptiveRule[]; suggestions: AdaptiveDashboardSuggestion[]; proposals: AdaptiveDashboardProposal[] };
  sources: AdaptiveDashboardSource[]; queries: { plan: AdaptiveDashboardPlan | null; executions: AdaptiveDashboardExecution[] };
  runs: AdaptiveDashboardRun[];
  omitted: { sources: number; preference_suggestions: number; proposals: number; queries: number; executions: number; runs: number; withheld_fields: number };
  bounds: { maximum_dashboard_bytes: number; maximum_feedback_bytes: number; maximum_sources: number; maximum_queries: number; maximum_executions: number; maximum_runs: number; maximum_suggestions: number; maximum_proposals: number };
}

/** A lifecycle label never overrides known coverage or separate-verification gaps. */
export function adaptiveDashboardRunState(run: AdaptiveDashboardRun): 'failed' | 'incomplete' | 'unknown' | 'running' | 'empty' | 'complete' {
  if (run.status === 'failed') return 'failed';
  if (run.counts.incomplete_sources > 0 || (run.counts.unresolved ?? 0)>0 || (run.backlog_candidates ?? 0)>0 || (run.backlog_omitted ?? 0)>0 || run.backlog_overflow === true
    || run.counts.new+run.counts.updated+run.counts.unchanged > run.counts.verified) return 'incomplete';
  if (run.status === 'running') return 'running';
  if (run.execution_report_status === 'unreported' || run.counts.unresolved === null || run.backlog_candidates === null || run.backlog_omitted === null || run.backlog_overflow === null) return 'unknown';
  if (run.execution_report_status !== 'complete') return 'incomplete';
  return run.counts.new+run.counts.updated+run.counts.unchanged === 0 ? 'empty' : 'complete';
}
type UnknownRecord = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hashPattern = /^[0-9a-f]{64}$/u;
function fail(): never { throw new Error('The adaptive dashboard response is invalid. Reload before changing it.'); }
function object(value: unknown): UnknownRecord { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : fail(); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fail();
}
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : fail(); }
function id(value: unknown): string { return typeof value === 'string' && uuidPattern.test(value) ? value.toLowerCase() : fail(); }
function text(value: unknown, maximum = 200): string { return opportunityFeedbackTextIsSafe(value, maximum) ? value : fail(); }
function protocolVersion(value: unknown): string {
  // Historical protocol IDs contain dates; prose privacy checks mistake them for phone numbers.
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value) ? value : fail();
}
function time(value: unknown, nullable = true): string | null {
  return nullable && value === null ? null : typeof value === 'string' && opportunityFeedbackTimestamp(value) !== null ? value : fail();
}
function list(value: unknown, maximum: number): unknown[] { return Array.isArray(value) && value.length <= maximum ? value : fail(); }
function publicUrl(value: unknown): string { return sanitizeOpportunityFeedbackUrl(value) ?? fail(); }
function queryText(value: unknown): string {
  if (typeof value !== 'string' || Array.from(value).length < 1 || Array.from(value).length > 2000 || /[\u0000-\u001f\u007f]/u.test(value)
    || /CV Harness meta-search context v1|"(?:contacts|supervisors|professionalContext|profiles|legacySearchArchive|systemPrompt|editor)"\s*:/iu.test(value)) fail();
  const rest = value.replace(/https?:\/\/[^\s<>"']+/giu, url => { publicUrl(url); return ' public-source '; });
  text(rest,2000); return value;
}
function readIntegerObject<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> {
  const row = object(value); return Object.fromEntries(keys.map(key => [key,integer(row[key])])) as Record<K,number>;
}
function enumeration<T extends string>(value: unknown, allowed: readonly T[]): T { return typeof value === 'string' && allowed.includes(value as T) ? value as T : fail(); }
function numberOrNull(value: unknown, minimum = 0, maximum = 10): number | null {
  return value === null ? null : typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fail();
}
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as UnknownRecord)[key])}`).join(',')}}` : JSON.stringify(value);
function scoped(scope: AdaptiveDashboardScope): AdaptiveDashboardScope {
  const task = requireSearchTaskScope(scope.searchId, scope.projectRef);
  return { ownerId: id(scope.ownerId), searchId: task.searchId, projectRef: task.projectRef };
}
function readSettings(value: unknown): AdaptiveDashboardSettings {
  const row = object(value);
  const upgraded = Object.hasOwn(row, 'search_breadth_percent') || Object.hasOwn(row, 'breadth_revision');
  const breadth = upgraded ? integer(row.search_breadth_percent, 0, 100) : null;
  if (breadth !== null && breadth % 5 !== 0) fail();
  return { adaptation_enabled: bool(row.adaptation_enabled),
    adaptation_paused: bool(row.adaptation_paused), successful_source_reuse_enabled: bool(row.successful_source_reuse_enabled),
    reuse_check_interval_hours: integer(row.reuse_check_interval_hours, 24, 720), search_breadth_percent: breadth,
    breadth_revision: upgraded ? integer(row.breadth_revision) : null,
    institution_sources_omitted: row.institution_sources_omitted === undefined ? null : integer(row.institution_sources_omitted,0,7),
    adaptation_revision: integer(row.adaptation_revision), source_reuse_revision: integer(row.source_reuse_revision), feedback_revision: integer(row.feedback_revision),
    preference_revision: integer(row.preference_revision), query_plan_revision: integer(row.query_plan_revision), query_plan_dirty: bool(row.query_plan_dirty) };
}
function readPolicy(value: unknown): AdaptiveSearchPolicy {
  try { return validateAdaptiveSearchPolicy(value as AdaptiveSearchPolicy); } catch { return fail(); }
}
function readOutcomes(value: unknown): AdaptiveDashboardSource['outcomes'] {
  const row = object(value);
  const result = { sample_size: integer(row.sample_size), reviewed: integer(row.reviewed), with_interest: integer(row.with_interest),
    mean_interest: numberOrNull(row.mean_interest), explicit_high_interest: integer(row.explicit_high_interest), confirmed_submissions: integer(row.confirmed_submissions) };
  if (result.reviewed > result.sample_size || result.with_interest > result.sample_size || result.explicit_high_interest > result.reviewed || result.confirmed_submissions > result.sample_size
    || (result.with_interest === 0) !== (result.mean_interest === null)) fail();
  return result;
}
function readSource(value: unknown, scope: AdaptiveDashboardScope, detailed = true): AdaptiveDashboardSource {
  const row = object(value);
  if (row.user_id !== undefined && row.user_id !== scope.ownerId || row.search_id !== undefined && row.search_id !== scope.searchId) fail();
  // This display projection preserves stored flags even when an unsafe URL is
  // withheld. It is never converted into a runnable registry source.
  const source: AdaptiveSearchSource = { registry_id: id(row.registry_id), user_id: scope.ownerId, search_id: scope.searchId,
    listing_url: row.listing_url === null ? null : publicUrl(row.listing_url), vacancy_url: row.vacancy_url === null ? null : publicUrl(row.vacancy_url),
    kind: enumeration(row.kind,ADAPTIVE_SOURCE_KINDS), institution: row.institution === null ? null : text(row.institution,200), topics: list(row.topics,16).map(value => text(value,120)),
    priority: integer(row.priority,0,100), enabled: bool(row.enabled), pinned: bool(row.pinned), mandatory: bool(row.mandatory), check_interval_hours: integer(row.check_interval_hours,24,720),
    last_attempted_at: time(row.last_attempted_at), last_successful_at: time(row.last_successful_at), status: enumeration(row.status,ADAPTIVE_SOURCE_STATUSES),
    owner_disabled: bool(row.owner_disabled), provenance: enumeration(row.provenance,['explicit','evidenced_listing','candidate']), listing_verified_at: time(row.listing_verified_at) };
  const coverage = detailed ? object(row.coverage) : { last_status: null, last_attempted_at: null, last_failure_reason: null };
  return { ...source, source_revision: integer(row.source_revision), coverage: {
    last_status: coverage.last_status === null ? null : enumeration(coverage.last_status, ['complete','blocked','failed','partial','paginated','dynamic']),
    last_attempted_at: time(coverage.last_attempted_at), last_failure_reason: coverage.last_failure_reason === null ? null : enumeration(coverage.last_failure_reason, ['access_denied','network_error','pagination_limit','dynamic_content','budget_exhausted','unknown']) },
    outcomes: detailed ? readOutcomes(row.outcomes) : { sample_size: 0, reviewed: 0, with_interest: 0, mean_interest: null, explicit_high_interest: 0, confirmed_submissions: 0 } };
}

/** Reject malformed scope and reconstruct a closed DTO; the preview must be byte-equivalent JSON data to the runner's validated packet. */
export async function readAdaptiveSearchDashboard(value: unknown, inputScope: AdaptiveDashboardScope | string, searchId?: string, projectRef?: string): Promise<AdaptiveSearchDashboardData> {
  const scope = scoped(typeof inputScope === 'string' ? { ownerId: inputScope, searchId: searchId ?? '', projectRef: projectRef ?? '' } : inputScope), raw = object(value);
  if (new TextEncoder().encode(JSON.stringify(value)).length > 262_144 || raw.dashboard_version !== 1 || raw.user_id !== scope.ownerId || raw.search_id !== scope.searchId || raw.project_ref !== scope.projectRef) fail();
  const preview = await readAdaptiveSearchFeedbackPacket(raw.feedback_preview, scope.ownerId, scope.searchId);
  if (canonical(preview) !== canonical(raw.feedback_preview)) fail();
  const prefs = object(raw.preferences), authorization = object(raw.runner_authorization), queries = object(raw.queries);
  const approved = validateApprovedAdaptiveRules(prefs.approved_rules);
  let plan: AdaptiveDashboardPlan | null = null;
  if (queries.plan !== null) {
    const row = object(queries.plan), basisRaw = object(row.basis);
    const basis = { base_revision: integer(basisRaw.base_revision, 1), feedback_revision: integer(basisRaw.feedback_revision), preference_revision: integer(basisRaw.preference_revision), protocol_version: protocolVersion(basisRaw.protocol_version) };
    plan = { id: id(row.id), revision: integer(row.revision, 1), plan_hash: typeof row.plan_hash === 'string' && hashPattern.test(row.plan_hash) ? row.plan_hash : fail(), created_at: time(row.created_at, false)!, basis,
      queries: list(row.queries, 30).map(value => { const query = object(value), withheld = bool(query.withheld);
        return { query_id: id(query.query_id), query: withheld ? query.query === null ? null : fail() : queryText(query.query),
          text_hash: typeof query.text_hash === 'string' && hashPattern.test(query.text_hash) ? query.text_hash : fail(), role: enumeration(query.role, ['core','adaptive','exploration']),
          manual: bool(query.manual), source_registry_id: query.source_registry_id === null ? null : id(query.source_registry_id), withheld, outcomes: readOutcomes(query.outcomes) }; }),
      planning_policy: row.planning_policy === null ? null : readPolicy(row.planning_policy) };
  }
  const currentPolicy = readPolicy(raw.policy);
  const settings = readSettings(raw.settings);
  if (currentPolicy.policy_version !== 'adaptive-query-v1' && settings.search_breadth_percent !== null
    && (currentPolicy.exploration_ratio !== settings.search_breadth_percent / 100
      || currentPolicy.minimum_exploration_queries !== (settings.search_breadth_percent === 0 ? 0 : 1))) fail();
  let capacity: AdaptiveSearchDashboardData['planning_capacity'] = null;
  if (raw.planning_capacity !== undefined && raw.planning_capacity !== null) {
    const row = object(raw.planning_capacity);
    capacity = { core_queries: integer(row.core_queries, 0, 30), discretionary: integer(row.discretionary, 0, 30) };
    if (capacity.discretionary !== Math.max(0, currentPolicy.maximum_queries - capacity.core_queries)) fail();
  }
  return { dashboard_version: 1, user_id: scope.ownerId, search_id: scope.searchId, project_ref: scope.projectRef,
    settings, policy: currentPolicy, planning_capacity: capacity, readiness: readAdaptiveSearchRunnerState(raw.readiness, scope.ownerId, scope.searchId, scope.projectRef),
    runner_authorization: { enabled: bool(authorization.enabled), authorization_revision: integer(authorization.authorization_revision),
      project_ref: authorization.project_ref === null ? null : authorization.project_ref === scope.projectRef ? scope.projectRef : fail() }, feedback_preview: preview,
    preferences: { revision: integer(prefs.revision), approved_rules: approved,
      proposals: list(prefs.proposals, 32).map(value => { const row = object(value); return { suggestion_id: id(row.suggestion_id), kind: enumeration(row.kind, ['source','query','preference']),
        state: enumeration(row.state, ['pending','awaiting_verification','deferred']), reason: row.reason === null ? null : enumeration<NonNullable<AdaptiveDashboardProposal['reason']>>(row.reason, ['needs_verified_evidence','needs_reviewed_evidence','adaptation_disabled']),
        created_at: time(row.created_at, false)!, evidence_refs: list(row.evidence_refs,16).map(id), listing_url: row.listing_url === null ? null : publicUrl(row.listing_url), vacancy_url: row.vacancy_url === null ? null : publicUrl(row.vacancy_url), query: row.query === null ? null : queryText(row.query) }; }),
      suggestions: list(prefs.suggestions, 64).map(value => { const row = object(value); return { suggestion_id: id(row.suggestion_id), rule: validateApprovedAdaptiveRules([row.rule])[0]!,
        origin: enumeration(row.origin, ['owner','runner']), state: enumeration(row.state, ['pending','approved','rejected','undone']), created_at: time(row.created_at, false)!, decided_at: time(row.decided_at) }; }) },
    sources: list(raw.sources, 64).map(row => readSource(row, scope)), queries: { plan, executions: list(queries.executions, 64).map(value => {
      const row = object(value); return { run_id: id(row.run_id), check_id: id(row.check_id), kind: enumeration(row.kind, ['query','source']), query_id: row.query_id === null ? null : id(row.query_id),
        text_hash: row.text_hash === null ? null : typeof row.text_hash === 'string' && hashPattern.test(row.text_hash) ? row.text_hash : fail(),
        source_registry_id: row.source_registry_id === null ? null : id(row.source_registry_id), attempted_at: time(row.attempted_at, false)!,
        status: enumeration(row.status, ['complete','blocked','failed','partial','paginated','dynamic']), results_count: row.results_count === null ? null : integer(row.results_count),
        failure_reason: row.failure_reason === null ? null : enumeration(row.failure_reason, ['access_denied','network_error','pagination_limit','dynamic_content','budget_exhausted','unknown']) };
    }) }, runs: list(raw.runs, 10).map(value => {
      const row = object(value), basis = object(row.basis), counts = object(row.counts), deadline = object(row.deadline);
      return { run_id: id(row.run_id), status: enumeration(row.status, ['running','complete','failed']), started_at: time(row.started_at, false)!, completed_at: time(row.completed_at),
        basis: { base_revision: integer(basis.base_revision, 1), feedback_revision: basis.feedback_revision === null ? null : integer(basis.feedback_revision), preference_revision: basis.preference_revision === null ? null : integer(basis.preference_revision), protocol_version: protocolVersion(basis.protocol_version) },
        query_plan_id: row.query_plan_id === null ? null : id(row.query_plan_id), adaptive_contract_version: row.adaptive_contract_version === null ? null : integer(row.adaptive_contract_version,1),
        execution_report_status: enumeration(row.execution_report_status, ['unreported','complete','partial','failed']),
        backlog_candidates: row.backlog_candidates === null ? null : integer(row.backlog_candidates), backlog_omitted: row.backlog_omitted === null ? null : integer(row.backlog_omitted),
        backlog_overflow: row.backlog_overflow === null ? null : bool(row.backlog_overflow),
        counts: { new: integer(counts.new), updated: integer(counts.updated), unchanged: integer(counts.unchanged), verified: integer(counts.verified), unresolved: counts.unresolved === null ? null : integer(counts.unresolved), incomplete_sources: integer(counts.incomplete_sources), failed_checks: integer(counts.failed_checks) },
        deadline: { late_discoveries: integer(deadline.late_discoveries), possible_late_discoveries: integer(deadline.possible_late_discoveries), unknown: integer(deadline.unknown),
          exact_lead_time_hours: numberOrNull(deadline.exact_lead_time_hours, -1e9,1e9), lower_lead_time_hours: numberOrNull(deadline.lower_lead_time_hours,-1e9,1e9), upper_lead_time_hours: numberOrNull(deadline.upper_lead_time_hours,-1e9,1e9), uncertain: bool(deadline.uncertain) },
        delivery_status: enumeration(row.delivery_status, ['unknown']) };
    }), omitted: readIntegerObject(raw.omitted, ['sources','preference_suggestions','proposals','queries','executions','runs','withheld_fields']),
    bounds: readIntegerObject(raw.bounds, ['maximum_dashboard_bytes','maximum_feedback_bytes','maximum_sources','maximum_queries','maximum_executions','maximum_runs','maximum_suggestions','maximum_proposals']) };
}

const settingsKeys = ['adaptation_enabled','adaptation_paused','successful_source_reuse_enabled','reuse_check_interval_hours','search_breadth_percent'] as const;
const sourceKeys = ['enabled','pinned','check_interval_hours'] as const;
export function validateAdaptiveSettingsPatch(value: unknown): AdaptiveSettingsPatch {
  const raw = object(value), patch: AdaptiveSettingsPatch = {};
  if (!Object.keys(raw).length || Object.keys(raw).some(key => !(settingsKeys as readonly string[]).includes(key))) fail();
  for (const key of settingsKeys) if (Object.hasOwn(raw,key)) {
    if (key === 'reuse_check_interval_hours') patch[key] = integer(raw[key], 24, 720);
    else if (key === 'search_breadth_percent') { const value = integer(raw[key], 0, 100); if (value % 5 !== 0) fail(); patch[key] = value; }
    else patch[key] = bool(raw[key]);
  }
  return patch;
}
export function validateAdaptiveSourcePatch(value: unknown): AdaptiveSourcePatch {
  const raw = object(value), patch: AdaptiveSourcePatch = {};
  if (!Object.keys(raw).length || Object.keys(raw).some(key => !(sourceKeys as readonly string[]).includes(key))) fail();
  for (const key of sourceKeys) if (Object.hasOwn(raw,key)) {
    if (key === 'check_interval_hours') patch[key] = integer(raw[key], 24, 720);
    else patch[key] = bool(raw[key]);
  }
  return patch;
}
interface PendingRequest { name: string; args: UnknownRecord; scope: AdaptiveDashboardScope; generation: number; sourceId?: string; patch?: AdaptiveSourcePatch; authorization?: boolean }
export interface AdaptiveDashboardState {
  data: AdaptiveSearchDashboardData | null; loading: boolean; saving: boolean; error: string; errorKind: 'load' | 'conflict' | 'denied' | 'save' | null;
  drafts: Record<string, AdaptiveSourcePatch>; retryable: boolean;
}
const recovery = new Map<string, Record<string, AdaptiveSourcePatch>>();
const recoveryKey = (scope: AdaptiveDashboardScope) => `CV_ADAPTIVE_SOURCE_DRAFTS:${scope.ownerId}:${scope.searchId}:${scope.projectRef}`;

/** Serialized partial mutations. A failed request retains its exact ID/body; changing accounts invalidates all old continuations. */
export function createAdaptiveSearchDashboardController(client: Pick<SupabaseClient, 'rpc'>, initialScope: AdaptiveDashboardScope,
  options: { randomId?: () => string; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; onRunnerChanged?: () => void } = {}) {
  let scope = scoped(initialScope), generation = 0, readGeneration = 0, queue = Promise.resolve(true), failed: PendingRequest | null = null, disposed = false;
  const queued = new Map<number,number>();
  const state = reactive<AdaptiveDashboardState>({ data: null, loading: false, saving: false, error: '', errorKind: null, drafts: {}, retryable: false });
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  function recover() {
    try { const raw = recovery.get(recoveryKey(scope)) ?? JSON.parse(options.storage?.getItem(recoveryKey(scope)) ?? '{}');
      const saved: Record<string, AdaptiveSourcePatch> = {}; for (const [key,value] of Object.entries(object(raw))) saved[id(key)] = validateAdaptiveSourcePatch(value);
      state.drafts = saved;
    } catch { state.drafts = {}; }
  }
  function retain() {
    const copy = JSON.parse(JSON.stringify(state.drafts)) as Record<string, AdaptiveSourcePatch>;
    recovery.set(recoveryKey(scope), copy);
    try { Object.keys(copy).length ? options.storage?.setItem(recoveryKey(scope), JSON.stringify(copy)) : options.storage?.removeItem(recoveryKey(scope)); } catch { /* in-memory owner-scoped recovery remains */ }
  }
  function resetError() { state.error = ''; state.errorKind = null; state.retryable = false; }
  function error(cause: unknown, loading = false) {
    const code = typeof cause === 'object' && cause ? String((cause as { code?: unknown }).code ?? '') : '';
    state.errorKind = loading ? 'load' : code === '40001' ? 'conflict' : ['42501','PGRST301','PGRST302'].includes(code) ? 'denied' : 'save';
    state.error = code === 'SOURCE_UNAVAILABLE' ? 'source_unavailable' : code === 'BREADTH_UPGRADE_REQUIRED' ? 'breadth_upgrade_required' : state.errorKind === 'conflict' ? 'conflict' : state.errorKind === 'denied' ? 'denied' : loading ? 'load_failed' : 'save_failed';
    state.retryable = !loading && state.errorKind === 'save' && !['22023','BREADTH_UPGRADE_REQUIRED'].includes(code) && failed !== null;
  }
  async function load(clearFailure = true): Promise<boolean> {
    if (disposed) return false;
    const ownerGeneration = generation, read = ++readGeneration, captured = { ...scope };
    state.loading = true;
    try {
      const reply = await client.rpc('read_opportunity_search_dashboard', { p_search_id: captured.searchId, p_project_ref: captured.projectRef });
      if (reply.error) throw reply.error;
      const parsed = await readAdaptiveSearchDashboard(reply.data, captured);
      if (disposed || generation !== ownerGeneration || read !== readGeneration) return false;
      state.data = parsed; if (clearFailure) { failed = null; resetError(); }
      return true;
    } catch (cause) { if (generation === ownerGeneration && read === readGeneration) error(cause, true); return false; }
    finally { if (generation === ownerGeneration && read === readGeneration) state.loading = false; }
  }
  function sourceDraft(registryId: string, patch: AdaptiveSourcePatch) {
    const sourceId = id(registryId), clean = validateAdaptiveSourcePatch(patch);
    state.drafts[sourceId] = { ...state.drafts[sourceId], ...clean }; retain();
  }
  function discardSourceDraft(registryId: string): boolean {
    const sourceId = id(registryId);
    if (disposed || state.saving || (queued.get(generation) ?? 0)>0 || !Object.hasOwn(state.drafts,sourceId)) return false;
    delete state.drafts[sourceId]; retain();
    if (failed?.sourceId === sourceId) { failed = null; resetError(); }
    else if (!failed && state.error === 'source_unavailable' && !Object.keys(state.drafts).length) resetError();
    return true;
  }
  async function execute(request: PendingRequest): Promise<boolean> {
    if (request.generation !== generation || disposed) return false;
    state.saving = true; resetError();
    try {
      const reply = await client.rpc(request.name, request.args);
      if (reply.error) throw reply.error;
      if (request.generation !== generation || disposed) return false;
      const ack = object(reply.data);
      if (request.name !== 'decide_opportunity_search_preference' && ack.search_id !== request.scope.searchId) fail();
      if (request.name === 'patch_opportunity_search_settings') {
        if (ack.dashboard_version !== 1 || ack.kind !== 'settings' || ack.action_id !== request.args.p_action_id) fail();
        const saved = readSettings(ack.settings);
        for (const [key,value] of Object.entries(object(request.args.p_patch))) if (saved[key as keyof AdaptiveDashboardSettings] !== value) fail();
        if (state.data) state.data.settings = saved;
      } else if (request.name === 'patch_opportunity_search_source') {
        if (ack.dashboard_version !== 1 || ack.kind !== 'source' || ack.action_id !== request.args.p_action_id) fail();
        const saved = readSource(ack.source, request.scope, false); if (saved.registry_id !== request.sourceId) fail();
        for (const [key,value] of Object.entries(object(request.args.p_patch))) if (saved[key as keyof AdaptiveDashboardSource] !== value) fail();
        const existing = state.data?.sources.find(value => value.registry_id === saved.registry_id);
        if (existing) Object.assign(existing, { ...saved, coverage: existing.coverage, outcomes: existing.outcomes });
        if (canonical(state.drafts[saved.registry_id]) === canonical(request.patch)) { delete state.drafts[saved.registry_id]; retain(); }
      } else if (request.authorization !== undefined) {
        if (ack.project_ref !== request.scope.projectRef || ack.enabled !== request.authorization) fail();
        integer(ack.authorization_revision);
        if (state.data) state.data.runner_authorization = { enabled: request.authorization, authorization_revision: ack.authorization_revision as number, project_ref: request.scope.projectRef };
        options.onRunnerChanged?.();
      } else {
        if (ack.operation_id !== request.args.p_operation_id || ack.suggestion_id !== request.args.p_suggestion_id || ack.action !== request.args.p_action) fail();
        integer(ack.preference_revision); validateApprovedAdaptiveRules(ack.approved_rules);
      }
      failed = null;
      const loaded = await load(false);
      if (request.generation !== generation || disposed) return false;
      if (loaded && request.name === 'patch_opportunity_search_settings'
        && Object.entries(object(request.args.p_patch)).some(([key,value]) => state.data?.settings[key as keyof AdaptiveDashboardSettings] !== value)) {
        failed = request; error({ code: '40001' }); return false;
      }
      if (loaded && request.sourceId && request.patch) {
        const current = state.data?.sources.find(source => source.registry_id === request.sourceId);
        if (!current || Object.entries(request.patch).some(([key,value]) => current[key as keyof AdaptiveDashboardSource] !== value)) {
          // A replay may truthfully acknowledge an older receipt while a later
          // owner edit is now current. Keep both newer typing and the original
          // intent, but require an explicit reload/review before another write.
          state.drafts[request.sourceId] = { ...request.patch,...state.drafts[request.sourceId] }; retain();
          failed = request; error({ code: '40001' }); return false;
        }
      }
      return loaded;
    } catch (cause) { if (request.generation === generation) { failed = request; error(cause); } return false; }
    finally { if (request.generation === generation) state.saving = false; }
  }
  function enqueue(build: () => PendingRequest | null): Promise<boolean> {
    const token = generation;
    queued.set(token,(queued.get(token) ?? 0)+1);
    const task = queue.then(async () => {
      if (token !== generation || disposed || failed) return false;
      try { const request = build(); return request ? execute(request) : true; }
      catch (cause) { error(cause); return false; }
    });
    const completed = task.finally(() => { const left = (queued.get(token) ?? 1)-1; if (left) queued.set(token,left); else queued.delete(token); });
    queue = completed.catch(() => false); return completed;
  }
  function patchSettings(input: AdaptiveSettingsPatch) {
    const patch = validateAdaptiveSettingsPatch(input);
    return enqueue(() => {
      const settings = state.data?.settings; if (!settings) fail();
      const expected: UnknownRecord = {};
      if (Object.hasOwn(patch,'adaptation_enabled') || Object.hasOwn(patch,'adaptation_paused')) expected.adaptation_revision = settings.adaptation_revision;
      if (Object.hasOwn(patch,'successful_source_reuse_enabled') || Object.hasOwn(patch,'reuse_check_interval_hours')) expected.source_reuse_revision = settings.source_reuse_revision;
      if (Object.hasOwn(patch,'search_breadth_percent')) {
        if (settings.breadth_revision === null || settings.search_breadth_percent === null || state.data?.policy.policy_version === 'adaptive-query-v1') throw { code: 'BREADTH_UPGRADE_REQUIRED' };
        expected.breadth_revision = settings.breadth_revision;
      }
      return { name: 'patch_opportunity_search_settings', scope: { ...scope }, generation, args: {
        p_search_id: scope.searchId, p_action_id: id(randomId()), p_patch: patch, p_expected_revisions: expected } };
    });
  }
  function saveSource(registryId: string) {
    const sourceId = id(registryId), snapshot = state.drafts[sourceId] ? validateAdaptiveSourcePatch(state.drafts[sourceId]) : null;
    return enqueue(() => {
      if (!snapshot || !state.drafts[sourceId]) return null;
      const source = state.data?.sources.find(value => value.registry_id === sourceId); if (!source) throw { code: 'SOURCE_UNAVAILABLE' };
      return { name: 'patch_opportunity_search_source', scope: { ...scope }, generation, sourceId, patch: snapshot, args: {
        p_search_id: scope.searchId, p_registry_id: sourceId, p_action_id: id(randomId()), p_patch: snapshot, p_expected_source_revision: source.source_revision } };
    });
  }
  function decide(suggestionId: string, action: 'approve' | 'reject' | 'undo') {
    const suggestion = id(suggestionId); enumeration(action, ['approve','reject','undo']);
    return enqueue(() => ({ name: 'decide_opportunity_search_preference', scope: { ...scope }, generation, args: {
      p_search_id: scope.searchId, p_suggestion_id: suggestion, p_action: action, p_expected_revision: state.data?.preferences.revision ?? fail(), p_operation_id: id(randomId()) } }));
  }
  function authorize(enabled: boolean) {
    bool(enabled);
    return enqueue(() => ({ name: 'set_opportunity_search_runner_authorization', scope: { ...scope }, generation, authorization: enabled, args: {
      p_search_id: scope.searchId, p_project_ref: scope.projectRef, p_enabled: enabled, p_expected_revision: state.data?.runner_authorization.authorization_revision ?? fail() } }));
  }
  async function retry(): Promise<boolean> {
    await queue; if (!failed || !state.retryable) return false;
    const request = failed; failed = null; queue = execute(request); return queue;
  }
  async function flush(): Promise<boolean> {
    await queue; if (failed) return false;
    for (const sourceId of Object.keys(state.drafts)) if (!await saveSource(sourceId)) return false;
    await queue; return !failed && !Object.keys(state.drafts).length;
  }
  function setScope(next: AdaptiveDashboardScope) {
    retain(); generation++; readGeneration++; scope = scoped(next); failed = null; queue = Promise.resolve(true); state.data = null; state.loading = false; state.saving = false; resetError(); recover();
  }
  function dispose() { retain(); disposed = true; generation++; readGeneration++; }
  recover();
  return { state, load, sourceDraft, discardSourceDraft, saveSource, patchSettings, decide, authorize, retry, flush, setScope, dispose };
}
