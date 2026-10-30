import type { SearchCriteria } from '../searchTypes';
import { SEARCH_CRITERIA_KEYS } from '../searchTypes';
import { OPPORTUNITY_INTEREST_REASON_CATEGORIES, type OpportunityInterestReason } from '../../../app/cloudTypes';
import type { AdaptiveFeedbackSnapshot, ApprovedAdaptivePreference } from './adaptiveFeedbackSnapshots';
import { createAdaptiveSearchPlan, replaceAdaptiveSearchSlice, validateAdaptiveSearchPlanTransition, type AdaptiveSearchPlan, type AdaptiveSearchPlanBasis, type AdaptiveSearchQuery, type AdaptiveSearchQueryInput } from './adaptiveSearchPlans';
import { opportunityFeedbackTextHash, opportunityFeedbackTextIsSafe, sanitizeOpportunityFeedbackUrl } from '../../opportunities/domain/opportunityFeedbackPrivacy';

export const ADAPTIVE_SEARCH_POLICY_VERSION = 'adaptive-query-v3';
export interface AdaptiveSearchPolicy {
  readonly policy_version: 'adaptive-query-v1' | 'adaptive-query-v2' | typeof ADAPTIVE_SEARCH_POLICY_VERSION;
  readonly minimum_observations: number;
  readonly exploration_ratio: number;
  readonly maximum_queries: number;
  readonly minimum_exploration_queries: number;
  readonly positive_interest_threshold: number;
  readonly exploration_guidance?: string;
  readonly institution_policy?: 'source-only-v1';
  readonly institution_guidance?: string;
}
export const LEGACY_ADAPTIVE_SEARCH_POLICY: Readonly<AdaptiveSearchPolicy> = Object.freeze({
  policy_version: 'adaptive-query-v1', minimum_observations: 3, exploration_ratio: 0.2,
  maximum_queries: 30, minimum_exploration_queries: 1, positive_interest_threshold: 6,
});
const explorationGuidance = Object.freeze({
  off: 'Do not generate exploration queries. Preserve the shared profile, protected core/manual queries and all hard criteria.',
  focused: 'Explore underrepresented named interests, alternative terminology and new official sources. Research directions are alternatives, not cumulative requirements. Preserve the shared profile and all hard criteria; interests do not establish qualifications.',
  balanced: 'Explore interdisciplinary combinations and plausible adjacent research directions, different role titles and new official sources. Keep a clear connection to the shared research profile. Research directions are alternatives. Preserve all hard criteria; interests do not establish qualifications.',
  adventurous: 'Prioritize plausible adjacent fields, unusual research combinations and role titles, and unfamiliar institutions or official sources. Each exploration query must connect clearly to at least one shared research interest or method. Research directions are alternatives. Preserve all hard criteria; interests do not establish qualifications.',
});
/** Structured owner preference only: this never enables adaptation or changes a scheduled task. */
export function createLegacySearchBreadthPolicy(percent = 20): Readonly<AdaptiveSearchPolicy> {
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100 || percent % 5 !== 0) throw new TypeError('Search breadth must be a multiple of five from 0 to 100.');
  const level = percent === 0 ? 'off' : percent <= 20 ? 'focused' : percent <= 50 ? 'balanced' : 'adventurous';
  return Object.freeze({ ...LEGACY_ADAPTIVE_SEARCH_POLICY, policy_version: 'adaptive-query-v2',
    exploration_ratio: percent / 100, minimum_exploration_queries: percent === 0 ? 0 : 1,
    exploration_guidance: explorationGuidance[level] });
}
export function createSearchBreadthPolicy(percent = 20): Readonly<AdaptiveSearchPolicy> {
  return Object.freeze({ ...createLegacySearchBreadthPolicy(percent), policy_version: ADAPTIVE_SEARCH_POLICY_VERSION,
    institution_policy: 'source-only-v1', institution_guidance: 'Retain institution listings as reusable sources only. Screen each project independently against the shared profile, funding, requirements and deadlines. Do not add an institution-wide fit bonus or infer qualifications from university-level outcomes.' });
}
export const DEFAULT_ADAPTIVE_SEARCH_POLICY = createSearchBreadthPolicy();

export interface AdaptiveEmphasisRule {
  rule_id: string;
  kind: 'emphasis';
  category: OpportunityInterestReason['category'];
  polarity: OpportunityInterestReason['polarity'];
  target: string;
  evidence_refs: readonly string[];
}
export interface AdaptiveHardExclusionRule {
  rule_id: string;
  kind: 'hard_exclusion';
  category: OpportunityInterestReason['category'];
  target: string;
  evidence_refs: readonly string[];
}
export interface AdaptiveSourceExclusionRule {
  rule_id: string;
  kind: 'source_exclusion';
  source_registry_id: string;
  evidence_refs: readonly string[];
}
export type ApprovedAdaptiveRule = AdaptiveEmphasisRule | AdaptiveHardExclusionRule | AdaptiveSourceExclusionRule;

export interface AdaptivePriority {
  category: OpportunityInterestReason['category'] | 'institution';
  target: string;
  observations: number;
  mean_interest: number | null;
  direction: 'increase' | 'decrease' | 'unchanged' | 'examples_only';
  provisional: boolean;
  basis: 'approved' | 'feedback';
  reason: 'approved_rule' | 'supported_mean' | 'sparse' | 'contradictory' | 'negative_requires_reason' | 'untargeted_reason' | 'source_only';
}
export interface AdaptivePlannerDueSource {
  registry_id: string;
  mandatory: boolean;
  pinned: boolean;
}
export interface AdaptiveSearchPlannerInput {
  user_id: string;
  search_id: string;
  base_criteria: Readonly<Partial<SearchCriteria>>;
  basis: AdaptiveSearchPlanBasis;
  feedback: AdaptiveFeedbackSnapshot | null;
  approved_rules: readonly ApprovedAdaptiveRule[];
  core_queries: readonly AdaptiveSearchQuery[];
  due_sources: readonly AdaptivePlannerDueSource[];
  adaptation_enabled: boolean;
  adaptation_paused: boolean;
  previous_plan?: AdaptiveSearchPlan | null;
  previous_policy?: Readonly<AdaptiveSearchPolicy>;
  adaptive_slice_dirty?: boolean;
  policy?: Readonly<AdaptiveSearchPolicy>;
}
export interface AdaptiveSearchPlanningContext {
  policy: Readonly<AdaptiveSearchPolicy>;
  enabled: boolean;
  paused: boolean;
  preference_revision: number;
  approved_rules: readonly ApprovedAdaptiveRule[];
  approved_preferences: readonly ApprovedAdaptivePreference[];
  priorities: readonly AdaptivePriority[];
  allocation: {
    maximum_queries: number; core_queries: number; mandatory_source_checks: number; source_obligations: number; discretionary: number;
    adaptive: number; exploration: number; capacity_limited: boolean;
  };
  blocked_core_queries: readonly { query_id: string; rule_id: string }[];
  refresh_required: boolean;
  basis: Readonly<AdaptiveSearchPlanBasis>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const key = (value: string) => value.replace(/^ +| +$/gu, '').replace(/[A-Z]/gu, character => character.toLowerCase());
const categoryKey = (category: string, target: string) => `${category}:${key(target)}`;
function identity(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new TypeError('Invalid adaptive planning identity.');
  return value.toLowerCase();
}
function compare(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!), b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}

/** Closed approved directives. Pending proposals must never be passed here as approved rules. */
export function validateApprovedAdaptiveRules(value: unknown): readonly ApprovedAdaptiveRule[] {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError('Use at most 32 explicitly approved search rules.');
  const seen = new Set<string>();
  const emphasisTargets = new Set<string>();
  return Object.freeze(value.map(item => {
    if (!record(item) || !['emphasis', 'hard_exclusion', 'source_exclusion'].includes(item.kind as string)
      || !Array.isArray(item.evidence_refs) || item.evidence_refs.length > 16) throw new TypeError('Invalid approved search rule.');
    const id = identity(item.rule_id);
    if (seen.has(id)) throw new TypeError('Approved rule identities must be unique.');
    seen.add(id);
    const evidence = Object.freeze([...new Set(item.evidence_refs.map(identity))].sort(compare));
    if (item.kind === 'source_exclusion') {
      if (Object.keys(item).some(field => !['rule_id', 'kind', 'source_registry_id', 'evidence_refs'].includes(field))) throw new TypeError('Invalid source exclusion rule.');
      return Object.freeze({ rule_id: id, kind: 'source_exclusion' as const, source_registry_id: identity(item.source_registry_id), evidence_refs: evidence });
    }
    const fields = item.kind === 'emphasis' ? ['rule_id', 'kind', 'category', 'polarity', 'target', 'evidence_refs'] : ['rule_id', 'kind', 'category', 'target', 'evidence_refs'];
    if (Object.keys(item).some(field => !fields.includes(field)) || !OPPORTUNITY_INTEREST_REASON_CATEGORIES.includes(item.category as OpportunityInterestReason['category'])
      || !opportunityFeedbackTextIsSafe(item.target, 120)) throw new TypeError('Invalid search preference rule.');
    const common = { rule_id: id, category: item.category as OpportunityInterestReason['category'], target: item.target, evidence_refs: evidence };
    if (item.kind === 'hard_exclusion') return Object.freeze({ ...common, kind: 'hard_exclusion' as const });
    if (!['positive', 'negative'].includes(item.polarity as string)) throw new TypeError('Invalid approved emphasis polarity.');
    const emphasisTarget = categoryKey(common.category, common.target);
    if (emphasisTargets.has(emphasisTarget)) throw new TypeError('Resolve conflicting approved emphasis before planning.');
    emphasisTargets.add(emphasisTarget);
    return Object.freeze({ ...common, kind: 'emphasis' as const, polarity: item.polarity as OpportunityInterestReason['polarity'] });
  }).sort((a, b) => compare(a.rule_id, b.rule_id)));
}

export function validateAdaptiveSearchPolicy(value: Readonly<AdaptiveSearchPolicy>): Readonly<AdaptiveSearchPolicy> {
  if (!record(value) || !['adaptive-query-v1', 'adaptive-query-v2', ADAPTIVE_SEARCH_POLICY_VERSION].includes(value.policy_version) || !integer(value.minimum_observations, 3, 100)
    || typeof value.exploration_ratio !== 'number' || !Number.isFinite(value.exploration_ratio) || value.exploration_ratio < 0 || value.exploration_ratio > 1
    || !integer(value.maximum_queries, 1, 30) || !integer(value.minimum_exploration_queries, value.policy_version === 'adaptive-query-v1' ? 1 : 0, 30)
    || typeof value.positive_interest_threshold !== 'number' || !Number.isFinite(value.positive_interest_threshold)
    || value.positive_interest_threshold < 0 || value.positive_interest_threshold > 10) throw new TypeError('Invalid versioned adaptive query policy.');
  if (value.policy_version !== 'adaptive-query-v1') {
    const expected = value.policy_version === 'adaptive-query-v2' ? createLegacySearchBreadthPolicy(Math.round(value.exploration_ratio * 100)) : createSearchBreadthPolicy(Math.round(value.exploration_ratio * 100));
    if (value.exploration_ratio !== expected.exploration_ratio || value.minimum_exploration_queries !== expected.minimum_exploration_queries
      || value.exploration_guidance !== expected.exploration_guidance || value.minimum_observations !== expected.minimum_observations
      || value.maximum_queries !== expected.maximum_queries || value.positive_interest_threshold !== expected.positive_interest_threshold
      || value.institution_policy !== expected.institution_policy || value.institution_guidance !== expected.institution_guidance
      || Object.keys(value).some(field => !Object.hasOwn(expected, field))) throw new TypeError('Invalid versioned adaptive query policy.');
    return expected;
  }
  return Object.freeze({ policy_version: value.policy_version, minimum_observations: value.minimum_observations,
    exploration_ratio: value.exploration_ratio, maximum_queries: value.maximum_queries,
    minimum_exploration_queries: value.minimum_exploration_queries, positive_interest_threshold: value.positive_interest_threshold });
}
const policy = validateAdaptiveSearchPolicy;
function basis(value: AdaptiveSearchPlanBasis): Readonly<AdaptiveSearchPlanBasis> {
  if (!integer(value.base_revision, 1) || !integer(value.feedback_revision) || !integer(value.preference_revision)
    || typeof value.protocol_version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value.protocol_version)) throw new TypeError('Invalid planning revision basis.');
  return Object.freeze({ base_revision: value.base_revision, feedback_revision: value.feedback_revision,
    preference_revision: value.preference_revision, protocol_version: value.protocol_version });
}

/** The base is opaque, authoritative user intent. Nothing here edits or infers hard rules from its prose. */
function baseCriteria(value: Readonly<Partial<SearchCriteria>>): Readonly<SearchCriteria> {
  if (!record(value) || Object.keys(value).some(field => !(SEARCH_CRITERIA_KEYS as readonly string[]).includes(field))
    || SEARCH_CRITERIA_KEYS.some(field => value[field] !== undefined && (typeof value[field] !== 'string' || Array.from(value[field]).length > 12000))) throw new TypeError('Invalid authoritative base criteria.');
  return Object.freeze(Object.fromEntries(SEARCH_CRITERIA_KEYS.map(field => [field, value[field] ?? ''])) as unknown as SearchCriteria);
}

/** Deterministic priorities use whole-set aggregate inputs, never the sampled examples as statistical totals. */
export function buildAdaptiveSearchPlanningContext(input: AdaptiveSearchPlannerInput): AdaptiveSearchPlanningContext {
  identity(input.user_id); identity(input.search_id); baseCriteria(input.base_criteria);
  if (typeof input.adaptation_enabled !== 'boolean' || typeof input.adaptation_paused !== 'boolean'
    || input.adaptive_slice_dirty !== undefined && typeof input.adaptive_slice_dirty !== 'boolean') throw new TypeError('Adaptive settings require explicit booleans.');
  const current = basis(input.basis), settings = policy(input.policy ?? DEFAULT_ADAPTIVE_SEARCH_POLICY);
  const rules = validateApprovedAdaptiveRules(input.approved_rules);
  const hardKeys = new Set(rules.filter((rule): rule is AdaptiveHardExclusionRule => rule.kind === 'hard_exclusion').map(rule => categoryKey(rule.category, rule.target)));
  const exclusions = new Map(rules.filter((rule): rule is AdaptiveSourceExclusionRule => rule.kind === 'source_exclusion').map(rule => [rule.source_registry_id, rule.rule_id]));
  if (!Array.isArray(input.core_queries) || input.core_queries.length > 30
    || input.core_queries.some(query => !record(query) || query.role !== 'core' || typeof query.query_id !== 'string' || !uuid.test(query.query_id)
      || typeof query.query !== 'string' || Array.from(query.query.trim()).length < 3 || Array.from(query.query.trim()).length > 2000
      || /[\u0000-\u001f\u007f]/u.test(query.query) || typeof query.manual !== 'boolean'
      || typeof query.text_hash !== 'string' || !/^[0-9a-f]{64}$/u.test(query.text_hash)
      || query.source_registry_id !== undefined && (typeof query.source_registry_id !== 'string' || !uuid.test(query.source_registry_id))
      || query.sources !== undefined && (!Array.isArray(query.sources) || query.sources.length > 16 || query.sources.some(source => typeof source !== 'string'
        || !sanitizeOpportunityFeedbackUrl(source) && !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u.test(source))))
    || new Set(input.core_queries.map(query => query.query_id.toLowerCase())).size !== input.core_queries.length) throw new TypeError('Preserve the actual bounded core query plan.');
  const blocked = input.core_queries.flatMap(query => query.source_registry_id && exclusions.has(query.source_registry_id.toLowerCase())
    ? [Object.freeze({ query_id: query.query_id, rule_id: exclusions.get(query.source_registry_id.toLowerCase())! })] : []).sort((a, b) => compare(a.query_id, b.query_id));
  if (!Array.isArray(input.due_sources) || input.due_sources.length > 128 || input.due_sources.some(source => !record(source)
    || typeof source.registry_id !== 'string' || !uuid.test(source.registry_id) || typeof source.mandatory !== 'boolean' || typeof source.pinned !== 'boolean')
    || new Set(input.due_sources.map(source => source.registry_id.toLowerCase())).size !== input.due_sources.length) throw new TypeError('Use distinct prepared direct-source obligations.');
  const due = input.due_sources.filter(source => !exclusions.has(source.registry_id.toLowerCase()));
  const active = input.adaptation_enabled && !input.adaptation_paused;
  const priorities = new Map<string, AdaptivePriority>();
  if (active && input.feedback) {
    if (input.feedback.metric_version !== 'opportunity-interest-v1' || input.feedback.feedback_revision !== current.feedback_revision
      || input.feedback.preference_revision !== current.preference_revision || input.feedback.aggregates.groups.length > 64) throw new TypeError('Use the current bounded authorized feedback snapshot.');
    const groups = new Map<string, { general?: AdaptiveFeedbackSnapshot['aggregates']['groups'][number]; positive?: AdaptiveFeedbackSnapshot['aggregates']['groups'][number]; negative?: AdaptiveFeedbackSnapshot['aggregates']['groups'][number] }>();
    for (const group of input.feedback.aggregates.groups) {
      if (![...OPPORTUNITY_INTEREST_REASON_CATEGORIES, 'institution'].includes(group.kind) || !opportunityFeedbackTextIsSafe(group.key, 200)
        || !integer(group.count) || !integer(group.scored) || group.scored > group.count
        || group.mean_interest !== null && (typeof group.mean_interest !== 'number' || !Number.isFinite(group.mean_interest) || group.mean_interest < 0 || group.mean_interest > 10)
        || group.polarity !== undefined && !['positive', 'negative'].includes(group.polarity)) throw new TypeError('Invalid whole-set feedback group.');
      const id = categoryKey(group.kind, group.key), bucket = groups.get(id) ?? {};
      const slot = group.polarity ?? 'general';
      if (bucket[slot]) throw new TypeError('A feedback group cannot be duplicated.');
      bucket[slot] = group; groups.set(id, bucket);
    }
    for (const [id, group] of groups) {
      if (hardKeys.has(id)) continue;
      const opposite = Boolean(group.positive && group.negative);
      // A broad topic cohort cannot turn one topic-specific reason plus two
      // timing/location complaints into three relevant negative observations.
      const chosen = opposite ? group.general ?? (group.negative!.scored >= group.positive!.scored ? group.negative! : group.positive!)
        : group.negative ?? group.positive ?? group.general!;
      const mean = chosen.mean_interest;
      const observations = chosen.scored;
      const untargeted = ['topic', 'method'].includes(chosen.kind) && key(chosen.key) === chosen.kind;
      const contradicts = !untargeted && (opposite || mean !== null && (Boolean(group.negative) && mean >= settings.positive_interest_threshold
        || Boolean(group.positive) && mean < settings.positive_interest_threshold));
      let direction: AdaptivePriority['direction'] = 'examples_only', reason: AdaptivePriority['reason'] = 'sparse', provisional = true;
      // A university is a reusable discovery source, not evidence that each
      // project there fits. Keep diagnostics without rewarding or penalizing it.
      if (settings.policy_version === 'adaptive-query-v3' && chosen.kind === 'institution') reason = 'source_only';
      else if (untargeted) reason = 'untargeted_reason';
      else if (contradicts) { direction = 'unchanged'; reason = 'contradictory'; }
      else if (!untargeted && observations >= settings.minimum_observations && mean !== null) {
        if (mean >= settings.positive_interest_threshold) { direction = 'increase'; reason = 'supported_mean'; provisional = false; }
        else {
          const targeted = chosen.kind !== 'institution' && Boolean(group.negative)
            && (!['topic', 'method'].includes(chosen.kind) || key(chosen.key) !== chosen.kind);
          if (targeted) { direction = 'decrease'; reason = 'supported_mean'; provisional = false; }
          else { direction = 'unchanged'; reason = 'negative_requires_reason'; }
        }
      }
      priorities.set(id, { category: chosen.kind, target: key(chosen.key), observations, mean_interest: mean,
        direction, provisional, basis: 'feedback', reason });
    }
  }
  const approved: ApprovedAdaptivePreference[] = [];
  for (const rule of rules) if (rule.kind === 'emphasis' && !hardKeys.has(categoryKey(rule.category, rule.target))) {
    const id = categoryKey(rule.category, rule.target), observed = priorities.get(id);
    if (active) priorities.set(id, { category: rule.category, target: rule.target, observations: observed?.observations ?? 0,
      mean_interest: observed?.mean_interest ?? null, direction: rule.polarity === 'positive' ? 'increase' : 'decrease',
      provisional: false, basis: 'approved', reason: 'approved_rule' });
    approved.push({ preference_id: rule.rule_id, category: rule.category, polarity: rule.polarity, target: rule.target });
  }
  const discretionary = Math.max(0, settings.maximum_queries - input.core_queries.length);
  const exploration = active && discretionary ? Math.min(discretionary, Math.max(settings.minimum_exploration_queries, Math.ceil(discretionary * settings.exploration_ratio))) : 0;
  const previous = input.previous_plan?.basis;
  const previousPolicy = input.previous_policy === undefined ? null : policy(input.previous_policy);
  const refresh = input.adaptive_slice_dirty === true || !previous || previous.base_revision !== current.base_revision || previous.feedback_revision !== current.feedback_revision
    || previous.preference_revision !== current.preference_revision || previous.protocol_version !== current.protocol_version
    || previousPolicy === null || JSON.stringify(previousPolicy) !== JSON.stringify(settings);
  const ranked = [...priorities.values()].sort((a, b) => Number(b.basis === 'approved') - Number(a.basis === 'approved')
    || (b.mean_interest ?? -1) - (a.mean_interest ?? -1) || compare(a.category, b.category) || compare(key(a.target), key(b.target)));
  return Object.freeze({ policy: settings, enabled: active, paused: input.adaptation_paused,
    preference_revision: current.preference_revision, approved_rules: rules, approved_preferences: Object.freeze(approved.map(item => Object.freeze(item))),
    priorities: Object.freeze(ranked.map(item => Object.freeze(item))), allocation: Object.freeze({ maximum_queries: settings.maximum_queries,
      core_queries: input.core_queries.length, mandatory_source_checks: due.filter(source => source.mandatory || source.pinned).length,
      source_obligations: due.length, discretionary, adaptive: active ? discretionary - exploration : 0, exploration,
      capacity_limited: discretionary === 0 || input.core_queries.length > settings.maximum_queries }),
    blocked_core_queries: Object.freeze(blocked), refresh_required: refresh, basis: current });
}

export const ADAPTIVE_SEED_GENERATOR_VERSION = 'base-criteria-seed-v1';
export interface AdaptiveColdStartSeedInput {
  user_id: string;
  search_id: string;
  base_criteria: Readonly<Partial<SearchCriteria>>;
  basis: AdaptiveSearchPlanBasis;
  approved_rules?: readonly ApprovedAdaptiveRule[];
  maximum_queries?: number;
}
export interface AdaptiveColdStartSeed {
  generator_version: typeof ADAPTIVE_SEED_GENERATOR_VERSION;
  plan: AdaptiveSearchPlan;
  omitted_directions: number;
}

function seedTerms(value: string): string[] {
  const terms = value.split(';').map(term => term.replace(/\s+/gu, ' ').trim()).filter(term => term.length >= 3
    && opportunityFeedbackTextIsSafe(term, 240)
    // A task qualifier or avoided activity is not a new positive research direction.
    && !/^(?:avoid(?:ed)?|exclude(?:d)?|no|not|preferred?\s+tasks?|preferred?\s+methods?|tasks?|methods?)\b/iu.test(term));
  return [...new Map(terms.map(term => [key(term), term])).values()];
}
function uuidFromHash(hash: string): string {
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}${(8 + parseInt(hash[16]!, 16) % 4).toString(16)}${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/**
 * Local cold-start composition inside an already authorized run. This makes no
 * discovery call, changes no base text and claims no prior executions. The full
 * base remains authoritative; these bounded seeds are not a substitute for it.
 */
export async function createColdStartAdaptiveSearchPlan(input: AdaptiveColdStartSeedInput): Promise<AdaptiveColdStartSeed> {
  const owner = identity(input.user_id), search = identity(input.search_id), base = baseCriteria(input.base_criteria), current = basis(input.basis);
  const rules = validateApprovedAdaptiveRules(input.approved_rules ?? []), maximum = input.maximum_queries ?? DEFAULT_ADAPTIVE_SEARCH_POLICY.maximum_queries;
  if (!integer(maximum, 1, DEFAULT_ADAPTIVE_SEARCH_POLICY.maximum_queries)) throw new RangeError('Cold-start queries must respect the query ceiling.');
  const excluded = new Set(rules.filter((rule): rule is AdaptiveHardExclusionRule => rule.kind === 'hard_exclusion'
    && ['topic', 'method'].includes(rule.category)).map(rule => key(rule.target)));
  const types = seedTerms(base.opportunityTypes), directions = seedTerms(base.topicsAndMethods).filter(term => !excluded.has(key(term)));
  const prefixes = types.length ? types : ['research opportunities'];
  const texts = prefixes.flatMap(prefix => directions.length ? directions.map(direction => `${prefix} ${direction}`) : [prefix]);
  const selected = texts.slice(0, maximum);
  const queries = await Promise.all(selected.map(async (query, index): Promise<AdaptiveSearchQueryInput> => ({
    query_id: uuidFromHash(await opportunityFeedbackTextHash(JSON.stringify([ADAPTIVE_SEED_GENERATOR_VERSION, owner, search, 'core', index]))),
    query, role: 'core', manual: false,
  })));
  const plan = await createAdaptiveSearchPlan(current, queries);
  return Object.freeze({ generator_version: ADAPTIVE_SEED_GENERATOR_VERSION, plan, omitted_directions: Math.max(0, texts.length - selected.length) });
}

export interface RecordedAdaptiveSearchPlan {
  generator_version: string;
  planning_policy: Readonly<AdaptiveSearchPolicy>;
  plan: AdaptiveSearchPlan;
  allocation: Readonly<{ core_queries: number; adaptive_queries: number; exploration_queries: number; source_obligations: number }>;
  blocked_core_queries: AdaptiveSearchPlanningContext['blocked_core_queries'];
}

/**
 * Record the exact proposed slice and its real allocation. Priorities are
 * deterministic; supplied query prose is explicitly versioned and hashed.
 * Publication/execution belongs to the authorized management workflow.
 */
export async function recordGeneratedAdaptiveSearchPlan(input: AdaptiveSearchPlannerInput, generated: {
  generator_version: string;
  queries: readonly AdaptiveSearchQueryInput[];
}): Promise<RecordedAdaptiveSearchPlan> {
  const context = buildAdaptiveSearchPlanningContext(input), generator = generated.generator_version;
  if (typeof generator !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(generator)
    || !Array.isArray(generated.queries) || generated.queries.length > context.allocation.discretionary) throw new TypeError('Use a bounded, versioned generated query slice.');
  const excluded = new Set(context.approved_rules.filter((rule): rule is AdaptiveSourceExclusionRule => rule.kind === 'source_exclusion').map(rule => rule.source_registry_id));
  const captured = generated.queries.map((query): AdaptiveSearchQueryInput => {
    if (!record(query) || !['adaptive', 'exploration'].includes(query.role as string) || query.manual === true
      || query.source_registry_id !== undefined && (typeof query.source_registry_id !== 'string' || excluded.has(query.source_registry_id.toLowerCase()))
      || query.sources !== undefined && (!Array.isArray(query.sources) || query.sources.some(source => typeof source !== 'string'))) throw new TypeError('Generated queries cannot replace core queries or target excluded sources.');
    return { ...query, ...(query.sources === undefined ? {} : { sources: [...query.sources as string[]] }) } as unknown as AdaptiveSearchQueryInput;
  });
  const exploration = captured.filter(query => query.role === 'exploration').length;
  const minimum = captured.length ? Math.min(captured.length, Math.max(context.policy.minimum_exploration_queries, Math.ceil(captured.length * context.policy.exploration_ratio))) : 0;
  if (!context.enabled && captured.length || context.enabled && context.allocation.discretionary > 0 && !captured.length
    || exploration < minimum || context.policy.policy_version !== 'adaptive-query-v1' && context.policy.exploration_ratio === 0 && exploration !== 0) throw new TypeError('The generated slice must preserve the active exploration policy.');
  // Hash validation snapshots the exact core fields before yielding; never read
  // a mutable source plan again after asynchronous hashing has started.
  const core = input.core_queries.map(query => ({ ...query, ...(query.sources === undefined ? {} : { sources: [...query.sources] }) }));
  const previous = input.previous_plan ? createAdaptiveSearchPlan(input.previous_plan.basis, input.previous_plan.queries) : Promise.resolve(null);
  const [anchor, previousPlan] = await Promise.all([createAdaptiveSearchPlan(context.basis, core), previous]);
  const plan = await replaceAdaptiveSearchSlice(anchor, captured, context.basis);
  if (previousPlan) validateAdaptiveSearchPlanTransition(previousPlan, plan);
  return Object.freeze({ generator_version: generator, planning_policy: context.policy, plan, allocation: Object.freeze({ core_queries: core.length,
    adaptive_queries: captured.length - exploration, exploration_queries: exploration, source_obligations: context.allocation.source_obligations }),
    blocked_core_queries: context.blocked_core_queries });
}

export interface PendingAdaptiveRuleSuggestion {
  suggestion_id: string;
  state: 'pending';
  rule: ApprovedAdaptiveRule;
}

/** Owner-scoped evidence references are authorized by the caller's bounded packet, never guessed from arbitrary IDs. */
export function validatePendingAdaptiveRuleSuggestion(value: unknown, authorizedOpportunityIds: readonly string[]): Readonly<PendingAdaptiveRuleSuggestion> {
  if (!Array.isArray(authorizedOpportunityIds) || authorizedOpportunityIds.length > 5000) throw new TypeError('Use bounded authorized suggestion evidence.');
  const authorized = new Set(authorizedOpportunityIds.map(identity));
  if (!record(value) || Object.keys(value).some(field => !['suggestion_id', 'state', 'rule'].includes(field)) || value.state !== 'pending') throw new TypeError('Invalid pending preference proposal.');
  const suggestion = identity(value.suggestion_id), rule = validateApprovedAdaptiveRules([value.rule])[0]!;
  if (!rule.evidence_refs.length || rule.evidence_refs.some(reference => !authorized.has(reference))) throw new TypeError('A pending proposal requires authorized opportunity evidence.');
  return Object.freeze({ suggestion_id: suggestion, state: 'pending', rule });
}
