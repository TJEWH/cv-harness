import { resolveDeadline } from '../../opportunities/domain/opportunityDeadline';
import { opportunityFeedbackTimestamp, type OpportunityFeedbackOutcome } from '../../opportunities/domain/opportunityFeedback';
import type { OpportunityReviewState } from '../../../app/cloudTypes';
import { adaptiveFeedbackScoreStatistics, validOpportunityInterestEvidence } from './adaptiveFeedbackSnapshots';
import { opportunityFeedbackTextIsSafe } from '../../opportunities/domain/opportunityFeedbackPrivacy';

export const ADAPTIVE_SEARCH_QUALITY_VERSION = 'opportunity-search-quality-v1';
export const RECOMMENDATION_MINIMUM_LEAD_HOURS = 72;
export const ADAPTIVE_QUALITY_MAX_CHECKS = 128;
export const ADAPTIVE_QUALITY_MAX_BACKLOG = 64;
export const ADAPTIVE_QUALITY_MAX_REPORT_BYTES = 524_288;
export const ADAPTIVE_QUALITY_MAX_GROUPS = 64;

export interface AdaptiveQualityScope { user_id: string; search_id: string }
export type AdaptiveExecutionStatus = 'complete' | 'blocked' | 'failed' | 'partial' | 'paginated' | 'dynamic';
export interface AdaptiveQualityExecution extends AdaptiveQualityScope {
  run_id: string; check_id: string; kind: 'query' | 'source'; query_id: string | null; text_hash: string | null;
  source_registry_id: string | null; attempted_at: string; status: AdaptiveExecutionStatus; results_count: number | null;
}
export interface AdaptiveQualityDiscovery extends AdaptiveQualityScope {
  discovery_id: string; run_id: string; item_id: string; opportunity_id: string; primary_discovery: boolean;
  discovered_at: string | null; encountered_at: string | null; execution_refs: readonly string[]; primary_check_id: string | null;
  topics: readonly string[]; institution: string | null;
  recommendation_eligible: boolean | null; recommendation_generated: boolean; updated_only: boolean;
  /** The canonical result receipt's verification time, independent of whether an AI assessment exists. */
  verified_at: string | null;
  original_assessment?: Readonly<{ score: number | null; scale_min: 0; scale_max: 10 }> | null;
  assessment_recorded_at?: string | null;
  assessment_verified_at?: string | null;
  assessment_version?: string | null;
}
export interface AdaptiveQualityFeedback extends OpportunityFeedbackOutcome { review_state: OpportunityReviewState }
export interface AdaptivePlannedQuery extends AdaptiveQualityScope { run_id: string; query_id: string; text_hash: string }
export interface AdaptivePlannedSource extends AdaptiveQualityScope { run_id: string; registry_id: string }
export interface AdaptiveQualityInput extends AdaptiveQualityScope {
  executions: readonly AdaptiveQualityExecution[];
  discoveries: readonly AdaptiveQualityDiscovery[];
  feedback: readonly AdaptiveQualityFeedback[];
  planned_queries?: readonly AdaptivePlannedQuery[];
  required_sources?: readonly AdaptivePlannedSource[];
  report_complete: boolean;
  unresolved_candidates?: readonly { candidate_key: string; reason: string }[];
  unresolved_total?: number;
  report_bytes?: number;
  report_overflow?: boolean;
}
export interface AdaptiveOutcomeMetrics {
  unique_discoveries: number; unique_encounters: number; reviewed: number; with_interest: number;
  mean_interest: number | null; explicit_high_interest: number; confirmed_submissions: number;
  explicit_rating: number; categorical_review: number; application?: number; submission_fallback: number; high_interest_rate: number | null;
}
export interface AdaptiveQualityCoverage {
  executed_checks: number; complete_checks: number; empty_successes: number; blocked_checks: number; failed_checks: number;
  partial_checks: number; paginated_checks: number; dynamic_checks: number; missing_checks: number;
  unresolved_checks: number; report_overflow: boolean; incomplete: boolean;
  status: 'unreported' | 'complete_empty' | 'complete_with_results' | 'incomplete';
}
export interface AdaptiveSearchQuality {
  metric_version: typeof ADAPTIVE_SEARCH_QUALITY_VERSION;
  overall: AdaptiveOutcomeMetrics;
  sources: (AdaptiveOutcomeMetrics & { registry_id: string; executions: number })[];
  queries: (AdaptiveOutcomeMetrics & { query_id: string; text_hash: string; executions: number })[];
  topics: (AdaptiveOutcomeMetrics & { key: string })[];
  institutions: (AdaptiveOutcomeMetrics & { key: string })[];
  coverage: AdaptiveQualityCoverage;
  backlog: { retained: number; omitted: number; incomplete: boolean };
  recommendations: { eligible: number; generated: number; updated_only: number; delivery_status: 'unknown' };
  groups_overlap: true;
  attribution: { primary: number; secondary_only: number; unknown: number };
  omitted_groups: { sources: number; queries: number; topics: number; institutions: number };
}
export interface AdaptiveDeadlineEvidence {
  deadline: string | null;
  deadline_time_local?: string | null;
  deadline_timezone?: string | null;
  /** Actual verification from an official deadline source, not inferred from a catalogue date. */
  official_verified: boolean;
  precision: 'instant' | 'date' | 'unknown';
  rolling_confirmed?: boolean;
}
export interface AdaptiveDiscoveryLeadTime {
  precision: 'exact_offset' | 'official_local' | 'ambiguous_bound' | 'date_only_conservative' | 'provisional' | 'unknown' | 'rolling';
  first_evidenced_discovery_at: string | null;
  recommendation_checked_at: string | null;
  official_deadline_at: string | null;
  /** Calculation endpoints; provisional/precision distinguish bounds from an official instant. */
  deadline_at: string | null;
  deadline_latest_at: string | null;
  deadline_lower_bound_at: string | null;
  deadline_upper_bound_at: string | null;
  provisional: boolean;
  upper_bound_exclusive: boolean;
  lead_time_hours: number | null;
  lead_time_lower_hours: number | null;
  lead_time_upper_hours: number | null;
  recommendation_eligible: boolean | null;
  recommendation_remaining_hours: number | null;
  recommendation_status: 'eligible' | 'insufficient_lead' | 'unknown' | 'rolling';
  late_discovery: boolean | null;
  late_discovery_status: 'confirmed' | 'possible' | 'not_late' | 'unknown';
  assumption: 'none' | 'date_only_00_local' | 'ambiguous_local_time' | 'unverified_deadline';
}

const hourMicros = 3_600_000_000n;
const minimumLead = BigInt(RECOMMENDATION_MINIMUM_LEAD_HOURS) * hourMicros;
const timestamp = (value: unknown): string | null => typeof value === 'string' && opportunityFeedbackTimestamp(value) !== null ? value : null;
const utcOffset = /(?:Z|[+-](?:0\d|1[0-5])(?::?[0-5]\d)?)$/iu;

function isoMicros(value: bigint): string {
  const milliseconds = value < 0n ? (value - 999n) / 1000n : value / 1000n;
  const remainder = value - milliseconds * 1000n;
  const base = new Date(Number(milliseconds)).toISOString();
  return remainder ? base.replace(/(\.\d{3})Z$/u, `$1${remainder.toString().padStart(3, '0')}Z`) : base;
}
function wallParts(value: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (name: string) => Number(parts.find(item => item.type === name)?.value);
  return [part('year'), part('month'), part('day'), part('hour'), part('minute'), part('second'), ((value % 1000) + 1000) % 1000] as const;
}
function wallAsUtc(parts: ReturnType<typeof wallParts>) {
  const value = new Date(0); value.setUTCFullYear(parts[0], parts[1] - 1, parts[2]); value.setUTCHours(parts[3], parts[4], parts[5], parts[6]);
  return value.getTime();
}
/** Reuse UI conversion, then retain all actual local-time occurrences instead of treating its latest-occurrence policy as official evidence. */
function localCandidates(input: { deadline: string; deadline_time_local?: string | null; deadline_timezone: string }, defaultTime?: string): bigint[] {
  const resolved = resolveDeadline(input, defaultTime ?? null);
  if (!resolved) return [];
  try {
    const targetParts = wallParts(resolved.timestamp, input.deadline_timezone);
    const target = wallAsUtc(targetParts);
    const offsets = new Set([-36, 0, 36].map(hours => {
      const probe = resolved.timestamp + hours * 3_600_000;
      return wallAsUtc(wallParts(probe, input.deadline_timezone)) - probe;
    }));
    const rawTime = resolved.time ?? defaultTime ?? '';
    const micros = Number((rawTime.match(/\.(\d{1,6})$/u)?.[1] ?? '').padEnd(6, '0')) % 1000;
    return [...offsets].map(offset => target - offset)
      .filter(candidate => wallAsUtc(wallParts(candidate, input.deadline_timezone)) === target)
      .sort((a, b) => a - b).map(value => BigInt(value) * 1000n + BigInt(micros));
  } catch { return []; }
}

/** First evidenced discovery is quality evidence; the 72-hour recommendation check uses its own actual check time. */
export function adaptiveDiscoveryLeadTime(discoveredAt: unknown, evidence: AdaptiveDeadlineEvidence, checkedAt?: unknown): AdaptiveDiscoveryLeadTime {
  const discovered = timestamp(discoveredAt), checked = timestamp(checkedAt);
  const result: AdaptiveDiscoveryLeadTime = {
    precision: 'unknown', first_evidenced_discovery_at: discovered, recommendation_checked_at: checked,
    official_deadline_at: null, deadline_at: null, deadline_latest_at: null, deadline_lower_bound_at: null, deadline_upper_bound_at: null,
    provisional: false, upper_bound_exclusive: false,
    lead_time_hours: null, lead_time_lower_hours: null, lead_time_upper_hours: null,
    recommendation_eligible: null, recommendation_remaining_hours: null, recommendation_status: 'unknown', late_discovery: null, late_discovery_status: 'unknown', assumption: 'none',
  };
  if (evidence.rolling_confirmed && evidence.official_verified && !evidence.deadline) return { ...result,
    precision: 'rolling', provisional: false, recommendation_eligible: true, recommendation_status: 'rolling' };
  if (evidence.precision === 'unknown' || typeof evidence.deadline !== 'string' || !evidence.deadline.trim()) return result;
  const raw = evidence.deadline.trim(), date = raw.slice(0, 10);
  const parsedDate = resolveDeadline({ deadline: date, deadline_time_local: '00:00:00', deadline_timezone: 'UTC' });
  if (!parsedDate || date.startsWith('0000-')) return result;
  let lower: bigint | null = null, upper: bigint | null = null;
  let exact = false;
  const onlyDate = evidence.precision === 'date' || raw === date && !evidence.deadline_time_local;
  if (!onlyDate && raw !== date && utcOffset.test(raw)) {
    const explicit = resolveDeadline({ deadline: raw });
    if (!explicit) return result;
    const full = raw.replace(' ', 'T').replace(/(T\d{2}:\d{2})(?=Z|[+-])/iu, '$1:00')
      .replace(/([+-]\d{2})$/u, '$1:00').replace(/([+-]\d{2})(\d{2})$/u, '$1:$2');
    lower = opportunityFeedbackTimestamp(full);
    if (lower === null) return result;
    upper = lower; exact = true; result.precision = 'exact_offset';
  } else {
    const zone = evidence.deadline_timezone?.trim();
    if (!zone) return result; // Never use resolveDeadline's browser/host timezone fallback for quality evidence.
    const candidates = localCandidates({ deadline: onlyDate ? date : raw, deadline_time_local: onlyDate ? '00:00:00' : evidence.deadline_time_local,
      deadline_timezone: zone }, onlyDate ? '00:00:00' : undefined);
    if (!candidates.length) return result;
    lower = candidates[0]!;
    if (onlyDate) {
      const tomorrow = new Date(parsedDate.timestamp + 86_400_000).toISOString().slice(0, 10);
      upper = localCandidates({ deadline: tomorrow, deadline_time_local: '00:00:00', deadline_timezone: zone }, '00:00:00')[0] ?? null;
      result.precision = 'date_only_conservative'; result.upper_bound_exclusive = true; result.assumption = 'date_only_00_local';
    } else if (candidates.length > 1) {
      upper = candidates.at(-1)!; result.precision = 'ambiguous_bound'; result.assumption = 'ambiguous_local_time';
    } else { upper = lower; exact = true; result.precision = 'official_local'; }
  }
  if (!evidence.official_verified) { result.precision = 'provisional'; result.assumption = 'unverified_deadline'; exact = false; }
  result.deadline_lower_bound_at = isoMicros(lower);
  result.deadline_upper_bound_at = upper === null ? null : isoMicros(upper);
  result.deadline_at = result.deadline_lower_bound_at;
  result.deadline_latest_at = result.deadline_upper_bound_at;
  result.provisional = !exact;
  if (exact) result.official_deadline_at = isoMicros(lower);
  if (discovered) {
    const first = opportunityFeedbackTimestamp(discovered)!;
    const low = lower - first, high = upper === null ? null : upper - first;
    result.lead_time_lower_hours = Number(low) / Number(hourMicros);
    result.lead_time_upper_hours = high === null ? null : Number(high) / Number(hourMicros);
    if (exact) result.lead_time_hours = result.lead_time_lower_hours;
    if (evidence.official_verified) {
      result.late_discovery_status = low >= minimumLead ? 'not_late'
        : high !== null && (high < minimumLead || result.upper_bound_exclusive && high === minimumLead) ? 'confirmed' : 'possible';
      result.late_discovery = result.late_discovery_status === 'confirmed' ? true : result.late_discovery_status === 'not_late' ? false : null;
    }
  }
  if (checked && evidence.official_verified) {
    const remaining = lower - opportunityFeedbackTimestamp(checked)!;
    result.recommendation_remaining_hours = Number(remaining) / Number(hourMicros);
    result.recommendation_eligible = remaining >= minimumLead;
    result.recommendation_status = result.recommendation_eligible ? 'eligible' : 'insufficient_lead';
  }
  return result;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const textHash = /^[0-9a-f]{64}$/u;
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const keyText = (value: string) => value.replace(/^ +| +$/gu, '').replace(/[A-Z]/gu, character => character.toLowerCase());
function compare(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!), b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new TypeError('Invalid quality report identity.');
  return value.toLowerCase();
}
function inScope(value: AdaptiveQualityScope, scope: AdaptiveQualityScope) {
  return typeof value.user_id === 'string' && typeof value.search_id === 'string'
    && value.user_id.toLowerCase() === scope.user_id && value.search_id.toLowerCase() === scope.search_id;
}
function queryKey(queryId: string, hash: string) { return `${queryId}:${hash}`; }
function executionKey(execution: AdaptiveQualityExecution) {
  return `${execution.run_id}:${execution.kind === 'query' ? `query:${queryKey(execution.query_id!, execution.text_hash!)}` : `source:${execution.source_registry_id}`}`;
}
function normalizeExecution(value: AdaptiveQualityExecution, scope: AdaptiveQualityScope): AdaptiveQualityExecution {
  const attempted = opportunityFeedbackTimestamp(value.attempted_at);
  if (!['query', 'source'].includes(value.kind) || !['complete', 'blocked', 'failed', 'partial', 'paginated', 'dynamic'].includes(value.status)
    || attempted === null || !(value.results_count === null || nonnegative(value.results_count))) throw new TypeError('Invalid structured execution report.');
  const result: AdaptiveQualityExecution = { ...scope, run_id: identity(value.run_id), check_id: identity(value.check_id), kind: value.kind,
    query_id: value.query_id === null ? null : identity(value.query_id), text_hash: value.text_hash,
    source_registry_id: value.source_registry_id === null ? null : identity(value.source_registry_id), attempted_at: isoMicros(attempted), status: value.status, results_count: value.results_count };
  if (result.kind === 'query' && (result.query_id === null || typeof result.text_hash !== 'string' || !textHash.test(result.text_hash))
    || result.kind === 'source' && (result.source_registry_id === null || result.query_id !== null || result.text_hash !== null)) throw new TypeError('Invalid executed query/source attribution.');
  return result;
}

interface OutcomeFacts { primary: boolean; known_attribution: boolean; eligible: boolean; generated: boolean; updated_only: boolean }
type Cohort = Map<string, OutcomeFacts>;
function addFact(cohort: Cohort, id: string, fact: OutcomeFacts) {
  const previous = cohort.get(id);
  cohort.set(id, previous ? { primary: previous.primary || fact.primary, known_attribution: previous.known_attribution || fact.known_attribution, eligible: previous.eligible || fact.eligible,
    generated: previous.generated || fact.generated, updated_only: previous.updated_only || fact.updated_only } : { ...fact });
}
function preferenceFeedback(values: readonly AdaptiveQualityFeedback[], owner: string): Map<string, AdaptiveQualityFeedback> {
  const current = new Map<string, AdaptiveQualityFeedback>();
  for (const value of values) {
    if (typeof value.user_id !== 'string' || value.user_id.toLowerCase() !== owner) continue;
    const id = identity(value.opportunity_id);
    if (!validOpportunityInterestEvidence(value) || !nonnegative(value.feedback_revision)) throw new TypeError('Invalid current quality feedback.');
    const safe: AdaptiveQualityFeedback = { user_id: owner, opportunity_id: id, metric_version: value.metric_version,
      interest_score: value.interest_score, interest_origin: value.interest_origin, confirmed_submission: value.confirmed_submission,
      submission_at: timestamp(value.submission_at), feedback_revision: value.feedback_revision, feedback_updated_at: timestamp(value.feedback_updated_at),
      baseline_status: value.baseline_status, interest_gap: value.interest_gap, review_state: value.review_state };
    const previous = current.get(id);
    if (!previous || safe.feedback_revision > previous.feedback_revision) current.set(id, safe);
    else if (safe.feedback_revision === previous.feedback_revision && JSON.stringify(safe) !== JSON.stringify(previous)) throw new TypeError('Conflicting current quality feedback.');
  }
  return current;
}
function outcomeMetrics(cohort: Cohort, feedback: ReadonlyMap<string, AdaptiveQualityFeedback>): AdaptiveOutcomeMetrics {
  const rows = [...cohort.keys()].flatMap(id => {
    const value = feedback.get(id); return value && value.interest_origin !== 'excluded' ? [value] : [];
  });
  const reviewed = rows.filter(row => (['explicit_rating', 'categorical_review'].includes(row.interest_origin) || row.metric_version === 'opportunity-interest-v2' && ['application', 'confirmed_submission'].includes(row.interest_origin)));
  const high = reviewed.filter(row => (row.interest_score ?? -1) >= 8);
  const scored = rows.flatMap(row => row.interest_score === null ? [] : [row.interest_score]);
  return { unique_discoveries: [...cohort.values()].filter(row => row.primary).length, unique_encounters: cohort.size,
    reviewed: reviewed.length, with_interest: scored.length, mean_interest: adaptiveFeedbackScoreStatistics(scored).mean_interest,
    explicit_high_interest: high.length, confirmed_submissions: rows.filter(row => row.confirmed_submission).length,
    explicit_rating: rows.filter(row => row.interest_origin === 'explicit_rating').length,
    categorical_review: rows.filter(row => row.interest_origin === 'categorical_review').length,
    ...(rows.some(row => row.metric_version === 'opportunity-interest-v2') ? { application: rows.filter(row => row.interest_origin === 'application').length } : {}),
    submission_fallback: rows.filter(row => row.interest_origin === 'confirmed_submission').length,
    high_interest_rate: reviewed.length ? Math.round(high.length / reviewed.length * 1_000_000) / 1_000_000 : null };
}

/** Pure reporting over owner-scoped immutable facts plus current minimal interest outcomes. No private application data is read. */
export function calculateAdaptiveSearchQuality(input: AdaptiveQualityInput): AdaptiveSearchQuality {
  const scope = { user_id: identity(input.user_id), search_id: identity(input.search_id) };
  if (!Array.isArray(input.executions) || !Array.isArray(input.discoveries) || !Array.isArray(input.feedback)
    || typeof input.report_complete !== 'boolean' || input.report_bytes !== undefined && !nonnegative(input.report_bytes)) throw new TypeError('Invalid bounded quality report.');
  const executions = new Map<string, AdaptiveQualityExecution>();
  for (const value of input.executions) {
    if (!inScope(value, scope)) continue;
    const execution = normalizeExecution(value, scope), key = `${execution.run_id}:${execution.check_id}`;
    if (executions.has(key) && JSON.stringify(executions.get(key)) !== JSON.stringify(execution)) throw new TypeError('Conflicting execution check identity.');
    executions.set(key, execution);
  }
  const actual = [...executions.values()], expected = new Set<string>();
  const queries = new Map<string, { query_id: string; text_hash: string; cohort: Cohort; executions: Set<string> }>();
  const sources = new Map<string, { registry_id: string; cohort: Cohort; executions: Set<string> }>();
  const topicGroups = new Map<string, Cohort>(), institutionGroups = new Map<string, Cohort>(), overall: Cohort = new Map();
  const queryGroup = (queryId: string, hash: string) => {
    if (typeof hash !== 'string' || !textHash.test(hash)) throw new TypeError('Invalid pinned query text hash.');
    const key = queryKey(queryId, hash);
    if (!queries.has(key)) queries.set(key, { query_id: queryId, text_hash: hash, cohort: new Map(), executions: new Set() });
    return queries.get(key)!;
  };
  const sourceGroup = (registryId: string) => {
    if (!sources.has(registryId)) sources.set(registryId, { registry_id: registryId, cohort: new Map(), executions: new Set() });
    return sources.get(registryId)!;
  };
  for (const planned of input.planned_queries ?? []) if (inScope(planned, scope)) {
    const queryId = identity(planned.query_id); queryGroup(queryId, planned.text_hash);
    expected.add(`${identity(planned.run_id)}:query:${queryKey(queryId, planned.text_hash)}`);
  }
  for (const planned of input.required_sources ?? []) if (inScope(planned, scope)) {
    const registryId = identity(planned.registry_id); sourceGroup(registryId);
    expected.add(`${identity(planned.run_id)}:source:${registryId}`);
  }
  const logical = new Map<string, { complete: boolean; completed_at: bigint | null; failed_at: bigint | null }>();
  for (const execution of actual) {
    const key = `${execution.run_id}:${execution.check_id}`;
    if (execution.query_id) queryGroup(execution.query_id, execution.text_hash!).executions.add(key);
    if (execution.source_registry_id) sourceGroup(execution.source_registry_id).executions.add(key);
    const logicalKey = executionKey(execution), previous = logical.get(logicalKey);
    const attempted = opportunityFeedbackTimestamp(execution.attempted_at)!;
    let completed = previous?.completed_at ?? null, failed = previous?.failed_at ?? null;
    if (execution.status === 'complete') completed = completed === null || attempted > completed ? attempted : completed;
    else failed = failed === null || attempted > failed ? attempted : failed;
    logical.set(logicalKey, { complete: completed !== null && (failed === null || completed >= failed), completed_at: completed, failed_at: failed });
  }
  for (const value of input.discoveries) {
    if (!inScope(value, scope) || !timestamp(value.verified_at)) continue;
    const opportunityId = identity(value.opportunity_id), runId = identity(value.run_id);
    if (!Array.isArray(value.execution_refs) || !Array.isArray(value.topics) || typeof value.primary_discovery !== 'boolean'
      || typeof value.recommendation_generated !== 'boolean' || typeof value.updated_only !== 'boolean'
      || !(value.recommendation_eligible === null || typeof value.recommendation_eligible === 'boolean')) throw new TypeError('Invalid verified discovery report.');
    const checks = [...new Set(value.execution_refs)].flatMap(checkId => {
      const check = executions.get(`${runId}:${identity(checkId)}`);
      return check && ['complete', 'partial', 'paginated', 'dynamic'].includes(check.status) && (check.results_count === null || check.results_count > 0) ? [check] : [];
    });
    const discovered = opportunityFeedbackTimestamp(value.discovered_at);
    const primaryCheckId = value.primary_check_id ? identity(value.primary_check_id) : null;
    const fact: OutcomeFacts = { primary: value.primary_discovery && discovered !== null && checks.some(check => check.check_id === primaryCheckId && opportunityFeedbackTimestamp(check.attempted_at)! <= discovered),
      known_attribution: discovered !== null && checks.some(check => opportunityFeedbackTimestamp(check.attempted_at)! <= discovered),
      eligible: value.recommendation_eligible === true, generated: value.recommendation_generated, updated_only: value.updated_only };
    addFact(overall, opportunityId, fact);
    for (const check of checks) {
      const pathFact = { ...fact, primary: fact.primary && check.check_id === primaryCheckId };
      if (check.query_id) addFact(queryGroup(check.query_id, check.text_hash!).cohort, opportunityId, pathFact);
      if (check.source_registry_id) addFact(sourceGroup(check.source_registry_id).cohort, opportunityId, pathFact);
    }
    for (const raw of value.topics) if (opportunityFeedbackTextIsSafe(raw, 120)) {
      const topic = keyText(raw); if (!topicGroups.has(topic)) topicGroups.set(topic, new Map()); addFact(topicGroups.get(topic)!, opportunityId, fact);
    }
    if (opportunityFeedbackTextIsSafe(value.institution, 200)) {
      const institution = keyText(value.institution); if (!institutionGroups.has(institution)) institutionGroups.set(institution, new Map());
      addFact(institutionGroups.get(institution)!, opportunityId, fact);
    }
  }
  const feedback = preferenceFeedback(input.feedback, scope.user_id);
  const queryRows = [...queries.values()].sort((a, b) => compare(a.query_id, b.query_id) || compare(a.text_hash, b.text_hash));
  const sourceRows = [...sources.values()].sort((a, b) => compare(a.registry_id, b.registry_id));
  const topics = [...topicGroups].sort(([a], [b]) => compare(a, b)), institutions = [...institutionGroups].sort(([a], [b]) => compare(a, b));
  const omissions = { sources: Math.max(0, sourceRows.length - ADAPTIVE_QUALITY_MAX_GROUPS), queries: Math.max(0, queryRows.length - ADAPTIVE_QUALITY_MAX_GROUPS),
    topics: Math.max(0, topics.length - ADAPTIVE_QUALITY_MAX_GROUPS), institutions: Math.max(0, institutions.length - ADAPTIVE_QUALITY_MAX_GROUPS) };
  const backlogRows = input.unresolved_candidates?.length ?? 0, backlogTotal = input.unresolved_total ?? backlogRows;
  if (!nonnegative(backlogTotal) || backlogTotal < backlogRows) throw new TypeError('Invalid unresolved-candidate total.');
  const retained = Math.min(backlogRows, ADAPTIVE_QUALITY_MAX_BACKLOG), omitted = backlogTotal - retained;
  // This input can span many valid reports/runs. Only ingestion knows whether an
  // individual report exceeded its check bound; historical check totals do not.
  const overflow = input.report_overflow === true || backlogTotal > ADAPTIVE_QUALITY_MAX_BACKLOG
    || (input.report_bytes ?? 0) > ADAPTIVE_QUALITY_MAX_REPORT_BYTES || Object.values(omissions).some(value => value > 0);
  const missing = [...expected].filter(key => !logical.get(key)?.complete).length;
  const unresolved = [...logical.values()].filter(value => !value.complete).length;
  const incomplete = !actual.length || !input.report_complete || overflow || missing > 0 || unresolved > 0 || backlogTotal > 0;
  const result: AdaptiveSearchQuality = {
    metric_version: ADAPTIVE_SEARCH_QUALITY_VERSION, overall: outcomeMetrics(overall, feedback),
    sources: sourceRows.slice(0, ADAPTIVE_QUALITY_MAX_GROUPS).map(row => ({ registry_id: row.registry_id, ...outcomeMetrics(row.cohort, feedback), executions: row.executions.size })),
    queries: queryRows.slice(0, ADAPTIVE_QUALITY_MAX_GROUPS).map(row => ({ query_id: row.query_id, text_hash: row.text_hash, ...outcomeMetrics(row.cohort, feedback), executions: row.executions.size })),
    topics: topics.slice(0, ADAPTIVE_QUALITY_MAX_GROUPS).map(([key, cohort]) => ({ key, ...outcomeMetrics(cohort, feedback) })),
    institutions: institutions.slice(0, ADAPTIVE_QUALITY_MAX_GROUPS).map(([key, cohort]) => ({ key, ...outcomeMetrics(cohort, feedback) })),
    coverage: { executed_checks: actual.length, complete_checks: actual.filter(row => row.status === 'complete').length,
      empty_successes: actual.filter(row => row.status === 'complete' && row.results_count === 0).length,
      blocked_checks: actual.filter(row => row.status === 'blocked').length, failed_checks: actual.filter(row => row.status === 'failed').length,
      partial_checks: actual.filter(row => row.status === 'partial').length, paginated_checks: actual.filter(row => row.status === 'paginated').length,
      dynamic_checks: actual.filter(row => row.status === 'dynamic').length, missing_checks: missing, unresolved_checks: unresolved, report_overflow: overflow, incomplete,
      status: !actual.length ? 'unreported' : incomplete ? 'incomplete' : overall.size || actual.some(row => (row.results_count ?? 0) > 0) ? 'complete_with_results' : 'complete_empty' },
    backlog: { retained, omitted, incomplete: backlogTotal > 0 },
    recommendations: { eligible: [...overall.values()].filter(row => row.eligible).length, generated: [...overall.values()].filter(row => row.generated).length,
      updated_only: [...overall.values()].filter(row => row.updated_only).length, delivery_status: 'unknown' },
    groups_overlap: true, attribution: { primary: [...overall.values()].filter(row => row.primary).length,
      secondary_only: [...overall.values()].filter(row => !row.primary && row.known_attribution).length,
      unknown: [...overall.values()].filter(row => !row.known_attribution).length }, omitted_groups: omissions,
  };
  return result;
}
