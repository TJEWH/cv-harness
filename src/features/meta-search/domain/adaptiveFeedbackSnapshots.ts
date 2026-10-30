import { OPPORTUNITY_INTEREST_REASON_CATEGORIES, OPPORTUNITY_REVIEW_STATES, type OpportunityInterestReason, type OpportunityPredictionBaseline } from '../../../app/cloudTypes';
import { OPPORTUNITY_INTEREST_METRIC_VERSION, isOpportunityInterestRating, normalizeOpportunityInterestReasons, opportunityFeedbackTimestamp } from '../../opportunities/domain/opportunityFeedback';
import { opportunityFeedbackTextHash, opportunityFeedbackTextIsSafe, sanitizeOpportunityFeedbackUrl, validateAdaptiveSummaryInclusion, type SafeOpportunityFeedbackExample } from '../../opportunities/domain/opportunityFeedbackPrivacy';

export const ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION = 'opportunity-feedback-selection-v2';
export const ADAPTIVE_FEEDBACK_FINGERPRINT_ENCODING = 'sha256-canonical-json-v1';
export const ADAPTIVE_FEEDBACK_MAX_EXAMPLES = 16;
export const ADAPTIVE_FEEDBACK_MAX_GROUPS = 64;
export const ADAPTIVE_FEEDBACK_MAX_BYTES = 65_536;

export interface ApprovedAdaptivePreference {
  preference_id: string;
  category: OpportunityInterestReason['category'];
  polarity: OpportunityInterestReason['polarity'];
  target: string;
}
export type AdaptiveFeedbackExample = SafeOpportunityFeedbackExample;
export interface AdaptiveFeedbackGroup {
  kind: 'topic' | 'institution' | OpportunityInterestReason['category'];
  key: string;
  polarity?: OpportunityInterestReason['polarity'];
  count: number;
  scored: number;
  score_sum: number;
  mean_interest: number | null;
}
export interface AdaptiveFeedbackSnapshot {
  metric_version: typeof OPPORTUNITY_INTEREST_METRIC_VERSION;
  selection_policy_version: typeof ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION;
  fingerprint_encoding: typeof ADAPTIVE_FEEDBACK_FINGERPRINT_ENCODING;
  feedback_revision: number;
  input_fingerprint: string;
  preference_revision: number;
  counts: {
    eligible: number; scored: number; confirmed_submissions: number; explicit_rating: number; categorical_review: number;
    submission_fallback: number; baseline_available: number; approved_summaries: number; selected: number;
    omitted_limit: number; omitted_bytes: number; omitted_groups: number;
  };
  aggregates: { score_sum: number; mean_interest: number | null; groups: AdaptiveFeedbackGroup[] };
  examples: AdaptiveFeedbackExample[];
  approved_preferences: ApprovedAdaptivePreference[];
  privacy_scope_changed: boolean;
}
export interface CompileAdaptiveFeedbackInput {
  user_id: string;
  search_id: string;
  /** Assigned by the server after comparing semantic fingerprints; excluded from the fingerprint. */
  feedback_revision: number;
  preference_revision?: number;
  /** Owner-filtered, authorized AF-02 projections only, never raw catalogue or application records. */
  examples: readonly (AdaptiveFeedbackExample | null)[];
  /** Exact, explicitly approved structured inputs; no inferred filters or prose. */
  approved_preferences?: readonly ApprovedAdaptivePreference[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): string | null => typeof value === 'string' && opportunityFeedbackTimestamp(value) !== null ? value : null;
const textKey = (value: string) => value.replace(/^ +| +$/gu, '').replace(/[A-Z]/gu, character => character.toLowerCase());
function compare(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!), b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}
/** Versioned reference encoding. PostgreSQL uses its separately named JSONB encoding. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Unsupported fingerprint value.');
  return encoded;
}
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Decimal sums and six-decimal, half-up means mirror PostgreSQL numeric, not binary float accumulation. */
function statistics(values: readonly number[]): { scored: number; score_sum: number; mean_interest: number | null } {
  let sum = 0n, scale = 0;
  for (const value of values) {
    const [mantissa, exponentText] = value.toString().split('e');
    const [whole, fraction = ''] = mantissa!.split('.');
    const exponent = Number(exponentText ?? 0);
    let coefficient = BigInt(`${whole}${fraction}`), nextScale = fraction.length - exponent;
    if (nextScale < 0) { coefficient *= 10n ** BigInt(-nextScale); nextScale = 0; }
    if (nextScale > scale) { sum *= 10n ** BigInt(nextScale - scale); scale = nextScale; }
    sum += coefficient * 10n ** BigInt(scale - nextScale);
  }
  const divisor = 10n ** BigInt(scale);
  const scoreSum = Number(`${sum}e-${scale}`);
  if (!values.length) return { scored: 0, score_sum: 0, mean_interest: null };
  const denominator = divisor * BigInt(values.length);
  const scaled = sum * 1_000_000n;
  const rounded = scaled / denominator + (scaled % denominator * 2n >= denominator ? 1n : 0n);
  return { scored: values.length, score_sum: scoreSum, mean_interest: Number(rounded) / 1_000_000 };
}

/** Shared exact-decimal score statistics for owner-scoped feedback/quality reports. */
export { statistics as adaptiveFeedbackScoreStatistics };

function originalPrediction(value: unknown, owner: string, id: string): OpportunityPredictionBaseline | undefined {
  if (!record(value) || typeof value.user_id !== 'string' || value.user_id.toLowerCase() !== owner
    || typeof value.opportunity_id !== 'string' || value.opportunity_id.toLowerCase() !== id || !isOpportunityInterestRating(value.score)
    || value.scale_min !== 0 || value.scale_max !== 10 || !timestamp(value.predicted_at)
    || typeof value.source_ref !== 'string') return undefined;
  const reference = value.source_ref.split(':');
  if (value.source_kind === 'historical_snapshot') {
    if (reference.length !== 3 || reference[0] !== 'opportunity-search-receipt' || !uuid.test(reference[1]!) || !uuid.test(reference[2]!)) return undefined;
  } else if (value.source_kind === 'discovery_assessment') {
    if (reference.length !== 2 || reference[0] !== 'opportunity-discovery-assessment' || !uuid.test(reference[1]!)) return undefined;
  } else return undefined;
  return { user_id: owner, opportunity_id: id, score: value.score, scale_min: 0, scale_max: 10,
    predicted_at: value.predicted_at as string, source_kind: value.source_kind, source_ref: `${reference[0]}:${reference.slice(1).map(part => part.toLowerCase()).join(':')}` };
}

/** Reconstruct the AF-02 allowlist even when callers attach arbitrary extra properties. */
async function safeExample(value: unknown, owner: string, search: string): Promise<AdaptiveFeedbackExample | null> {
  if (!record(value) || typeof value.opportunity_id !== 'string' || !uuid.test(value.opportunity_id)
    || value.user_id !== undefined && value.user_id !== owner || value.search_id !== undefined && value.search_id !== search
    || value.metric_version !== OPPORTUNITY_INTEREST_METRIC_VERSION || !revision(value.feedback_revision)
    || !OPPORTUNITY_REVIEW_STATES.includes(value.review_state as typeof OPPORTUNITY_REVIEW_STATES[number])
    || typeof value.confirmed_submission !== 'boolean' || !['explicit_rating', 'categorical_review', 'confirmed_submission', 'none'].includes(value.interest_origin as string)
    || !(value.interest_score === null || isOpportunityInterestRating(value.interest_score))) return null;
  const result: AdaptiveFeedbackExample = {
    opportunity_id: value.opportunity_id.toLowerCase(), topics: [], metric_version: OPPORTUNITY_INTEREST_METRIC_VERSION,
    interest_score: value.interest_score as number | null, interest_origin: value.interest_origin as AdaptiveFeedbackExample['interest_origin'],
    interest_gap: null, baseline_status: 'unavailable', feedback_revision: value.feedback_revision,
    feedback_updated_at: timestamp(value.feedback_updated_at), review_state: value.review_state as AdaptiveFeedbackExample['review_state'],
    confirmed_submission: value.confirmed_submission, submission_at: value.confirmed_submission ? timestamp(value.submission_at) : null, reasons: [],
  };
  if (result.interest_origin === 'none' && result.interest_score !== null || result.interest_origin !== 'none' && result.interest_score === null) return null;
  if (result.interest_origin === 'none' && (result.review_state !== 'unreviewed' || result.confirmed_submission)) return null;
  if (result.interest_origin === 'confirmed_submission' && (!result.confirmed_submission || result.interest_score !== 9 || result.review_state !== 'unreviewed')) return null;
  if (result.interest_origin === 'categorical_review') {
    const expected = { strong_interest: 8, interested: 6, not_interested: 2, unreviewed: null }[result.review_state];
    if (result.interest_score !== expected || expected === null) return null;
  }
  for (const [key, limit] of Object.entries({ opportunity_key: 200, title: 240, institution: 200, research_summary: 1000 })) {
    if (opportunityFeedbackTextIsSafe(value[key], limit)) Object.assign(result, { [key]: value[key] });
  }
  for (const key of ['official_url', 'source_url'] as const) {
    const url = sanitizeOpportunityFeedbackUrl(value[key]);
    if (url) result[key] = url;
  }
  if (Array.isArray(value.topics)) result.topics = [...new Set(value.topics.filter(topic => opportunityFeedbackTextIsSafe(topic, 120)))].sort(compare).slice(0, 16);
  try { result.reasons = normalizeOpportunityInterestReasons(value.reasons).filter(reason => !reason.target || opportunityFeedbackTextIsSafe(reason.target, 120)); } catch { /* Malformed tags are withheld. */ }
  const prediction = value.baseline_status === 'available' ? originalPrediction(value.original_prediction, owner, result.opportunity_id) : undefined;
  const observedAt = opportunityFeedbackTimestamp(result.interest_origin === 'confirmed_submission' ? result.submission_at : result.feedback_updated_at);
  if (prediction && result.interest_score !== null && observedAt !== null && opportunityFeedbackTimestamp(prediction.predicted_at)! <= observedAt
    && typeof value.interest_gap === 'number' && Number.isFinite(value.interest_gap) && value.interest_gap >= -10 && value.interest_gap <= 10
    && Math.abs(result.interest_score - prediction.score - value.interest_gap) < 1e-12) {
    result.original_prediction = prediction; result.baseline_status = 'available'; result.interest_gap = value.interest_gap;
  }
  const summary = value.search_feedback_summary;
  const inclusion = validateAdaptiveSummaryInclusion(value.summary_inclusion);
  if (opportunityFeedbackTextIsSafe(summary) && inclusion && Array.from(summary).length === Math.min(600,inclusion.source_length)
    && await opportunityFeedbackTextHash(summary) === inclusion.summary_hash) {
    result.search_feedback_summary = summary; result.summary_inclusion = inclusion;
  }
  // A view-only unreviewed row is not a preference observation or a sampling candidate.
  if (value.manually_archived === true) result.manually_archived = true;
  if (['closed','requirements','application_problem','other'].includes(value.technical_issue_category as string)) result.technical_issue_category = value.technical_issue_category as NonNullable<AdaptiveFeedbackExample['technical_issue_category']>;
  return result.interest_score !== null || result.reasons.length || result.search_feedback_summary || result.manually_archived || result.technical_issue_category ? result : null;
}

/** Shared fixed allowlist for complete startup DTOs; this never recomputes whole-set statistics from samples. */
export { safeExample as projectSafeAdaptiveFeedbackExample };

function preferences(values: readonly ApprovedAdaptivePreference[]): ApprovedAdaptivePreference[] {
  if (!Array.isArray(values) || values.length > 32) throw new TypeError('At most 32 approved structured preferences are supported.');
  const unique = new Map<string, ApprovedAdaptivePreference>();
  for (const item of values) {
    if (!record(item) || typeof item.preference_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(item.preference_id)
      || typeof item.category !== 'string' || !(OPPORTUNITY_INTEREST_REASON_CATEGORIES as readonly string[]).includes(item.category)
      || typeof item.polarity !== 'string' || !['positive', 'negative'].includes(item.polarity)
      || !opportunityFeedbackTextIsSafe(item.target, 120)) throw new TypeError('Invalid approved structured preference.');
    const normalized: ApprovedAdaptivePreference = { preference_id: item.preference_id, category: item.category as ApprovedAdaptivePreference['category'],
      polarity: item.polarity as ApprovedAdaptivePreference['polarity'], target: item.target };
    if (unique.has(item.preference_id) && canonicalJson(unique.get(item.preference_id)) !== canonicalJson(normalized)) throw new TypeError('Conflicting approved structured preference.');
    unique.set(item.preference_id, normalized);
  }
  return [...unique.values()].sort((a, b) => compare(a.preference_id, b.preference_id));
}

function groups(examples: readonly AdaptiveFeedbackExample[]): AdaptiveFeedbackGroup[] {
  const entries = new Map<string, { kind: AdaptiveFeedbackGroup['kind']; key: string; polarity?: AdaptiveFeedbackGroup['polarity']; observations: Map<string, number | null> }>();
  const add = (example: AdaptiveFeedbackExample, kind: AdaptiveFeedbackGroup['kind'], key: string, polarity?: AdaptiveFeedbackGroup['polarity']) => {
    const normalized = textKey(key); if (!normalized) return;
    const identity = canonicalJson([kind, normalized, polarity ?? null]);
    if (!entries.has(identity)) entries.set(identity, { kind, key: normalized, ...(polarity ? { polarity } : {}), observations: new Map() });
    entries.get(identity)!.observations.set(example.opportunity_id, example.interest_score);
  };
  for (const example of examples) {
    for (const topic of example.topics) add(example, 'topic', topic);
    if (example.institution) add(example, 'institution', example.institution);
    for (const reason of example.reasons) add(example, reason.category, reason.target ?? reason.category, reason.polarity);
  }
  return [...entries.values()].map(group => ({ kind: group.kind, key: group.key, ...(group.polarity ? { polarity: group.polarity } : {}),
    count: group.observations.size, ...statistics([...group.observations.values()].filter((value): value is number => value !== null)) }))
    .sort((a, b) => compare(a.kind, b.kind) || compare(a.key, b.key) || compare(a.polarity ?? '', b.polarity ?? ''));
}

function selectExamples(examples: readonly AdaptiveFeedbackExample[]): AdaptiveFeedbackExample[] {
  const selected: AdaptiveFeedbackExample[] = [], ids = new Set<string>(), institutions = new Set<string>(), topics = new Set<string>();
  const rank = (example: AdaptiveFeedbackExample) => ({ explicit_rating: 0, categorical_review: 1, confirmed_submission: 2, none: 3, excluded: 4 })[example.interest_origin];
  const best = (candidates: readonly AdaptiveFeedbackExample[]) => candidates.filter(example => !ids.has(example.opportunity_id)).sort((a, b) => rank(a) - rank(b)
    || Number(Boolean(b.institution && !institutions.has(textKey(b.institution)))) - Number(Boolean(a.institution && !institutions.has(textKey(a.institution))))
    || Number(b.topics.some(topic => !topics.has(textKey(topic)))) - Number(a.topics.some(topic => !topics.has(textKey(topic))))
    || compare(a.opportunity_id, b.opportunity_id))[0];
  const add = (example: AdaptiveFeedbackExample) => {
    selected.push(example); ids.add(example.opportunity_id);
    if (example.institution) institutions.add(textKey(example.institution));
    for (const topic of example.topics) topics.add(textKey(topic));
  };
  const buckets = [examples.filter(example => example.confirmed_submission),
    examples.filter(example => ['explicit_rating', 'categorical_review'].includes(example.interest_origin) && (example.interest_score ?? -1) >= 8),
    examples.filter(example => example.interest_gap !== null && example.interest_gap <= -2),
    examples.filter(example => example.interest_gap !== null && example.interest_gap >= 2)];
  while (selected.length < ADAPTIVE_FEEDBACK_MAX_EXAMPLES) {
    let found = false;
    for (const bucket of buckets) {
      const next = best(bucket);
      if (next && selected.length < ADAPTIVE_FEEDBACK_MAX_EXAMPLES) { add(next); found = true; }
    }
    if (!found) break;
  }
  while (selected.length < ADAPTIVE_FEEDBACK_MAX_EXAMPLES) { const next = best(examples); if (!next) break; add(next); }
  return selected;
}

/** Pure, deterministic reference compiler. Authorization and immutable persistence remain server-side. */
export async function compileAdaptiveFeedbackSnapshot(input: CompileAdaptiveFeedbackInput): Promise<AdaptiveFeedbackSnapshot> {
  if (!uuid.test(input.user_id) || !uuid.test(input.search_id)
    || !revision(input.feedback_revision) || !revision(input.preference_revision ?? 0)) throw new TypeError('Invalid feedback snapshot scope or revision.');
  const owner = input.user_id.toLowerCase(), search = input.search_id.toLowerCase(), preferenceRevision = input.preference_revision ?? 0;
  const assignedRevision = input.feedback_revision;
  const approved = preferences(input.approved_preferences ?? []);
  const safe = await Promise.all(input.examples.map(example => safeExample(example, owner, search)));
  const unique = new Map<string, AdaptiveFeedbackExample>();
  for (const example of safe) {
    if (!example) continue;
    const previous = unique.get(example.opportunity_id);
    if (!previous || example.feedback_revision > previous.feedback_revision) unique.set(example.opportunity_id, example);
    else if (example.feedback_revision === previous.feedback_revision && canonicalJson(example) !== canonicalJson(previous)) throw new TypeError('Conflicting current feedback observations.');
  }
  const eligible = [...unique.values()].sort((a, b) => compare(a.opportunity_id, b.opportunity_id));
  const allGroups = groups(eligible);
  const selected = selectExamples(eligible);
  const inputFingerprint = await opportunityFeedbackTextHash(canonicalJson({ user_id: owner, search_id: search,
    metric_version: OPPORTUNITY_INTEREST_METRIC_VERSION, selection_policy_version: ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION,
    fingerprint_encoding: ADAPTIVE_FEEDBACK_FINGERPRINT_ENCODING,
    preference_revision: preferenceRevision, examples: eligible, approved_preferences: approved }));
  const total = statistics(eligible.flatMap(example => example.interest_score === null ? [] : [example.interest_score]));
  const packet: AdaptiveFeedbackSnapshot = {
    metric_version: OPPORTUNITY_INTEREST_METRIC_VERSION, selection_policy_version: ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION,
    fingerprint_encoding: ADAPTIVE_FEEDBACK_FINGERPRINT_ENCODING, feedback_revision: assignedRevision, input_fingerprint: inputFingerprint,
    preference_revision: preferenceRevision,
    counts: { eligible: eligible.length, scored: total.scored, confirmed_submissions: eligible.filter(example => example.confirmed_submission).length,
      explicit_rating: eligible.filter(example => example.interest_origin === 'explicit_rating').length,
      categorical_review: eligible.filter(example => example.interest_origin === 'categorical_review').length,
      submission_fallback: eligible.filter(example => example.interest_origin === 'confirmed_submission').length,
      baseline_available: eligible.filter(example => example.baseline_status === 'available').length,
      approved_summaries: eligible.filter(example => example.search_feedback_summary !== undefined).length,
      selected: selected.length, omitted_limit: Math.max(0, eligible.length - selected.length), omitted_bytes: 0,
      omitted_groups: Math.max(0, allGroups.length - ADAPTIVE_FEEDBACK_MAX_GROUPS) },
    aggregates: { score_sum: total.score_sum, mean_interest: total.mean_interest, groups: allGroups.slice(0, ADAPTIVE_FEEDBACK_MAX_GROUPS) },
    examples: selected, approved_preferences: approved, privacy_scope_changed: false,
  };
  while (byteLength(packet) > ADAPTIVE_FEEDBACK_MAX_BYTES && packet.examples.length) {
    packet.examples.pop(); packet.counts.selected--; packet.counts.omitted_bytes++;
  }
  while (byteLength(packet) > ADAPTIVE_FEEDBACK_MAX_BYTES && packet.aggregates.groups.length) { packet.aggregates.groups.pop(); packet.counts.omitted_groups++; }
  if (byteLength(packet) > ADAPTIVE_FEEDBACK_MAX_BYTES) throw new RangeError('Approved feedback metadata exceeds the bounded packet contract.');
  return packet;
}
