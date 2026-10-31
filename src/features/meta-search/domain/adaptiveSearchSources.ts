import { opportunityFeedbackTextIsSafe, sanitizeOpportunityFeedbackUrl } from '../../opportunities/domain/opportunityFeedbackPrivacy';
import type { OpportunityFeedbackOutcome } from '../../opportunities/domain/opportunityFeedback';

export const ADAPTIVE_SOURCE_KINDS = ['university', 'lab', 'program', 'job_board', 'other'] as const;
export const ADAPTIVE_SOURCE_STATUSES = ['pending_identification', 'ready', 'checked', 'blocked', 'incomplete'] as const;
export const SUCCESSFUL_SOURCE_REUSE_VERSION = 'successful-source-reuse-v1';
export const DEFAULT_SOURCE_CHECK_INTERVAL_HOURS = 168;
export const MIN_SOURCE_CHECK_INTERVAL_HOURS = 24;
export const MAX_SOURCE_CHECK_INTERVAL_HOURS = 720;
export const EXPLICIT_HIGH_SOURCE_INTEREST = 8;

export interface AdaptiveSourceScope { user_id: string; search_id: string }

/** Registry identity describes a reusable discovery path, never a vacancy or evidence source_id. */
export interface AdaptiveSearchSource extends AdaptiveSourceScope {
  registry_id: string;
  listing_url: string | null;
  vacancy_url: string | null;
  kind: typeof ADAPTIVE_SOURCE_KINDS[number];
  institution: string | null;
  topics: string[];
  priority: number;
  enabled: boolean;
  pinned: boolean;
  mandatory: boolean;
  check_interval_hours: number;
  last_attempted_at: string | null;
  last_successful_at: string | null;
  status: typeof ADAPTIVE_SOURCE_STATUSES[number];
  owner_disabled: boolean;
  provenance: 'explicit' | 'evidenced_listing' | 'candidate';
  listing_verified_at: string | null;
}

export interface SuccessfulSourceReusePolicy {
  adaptation_enabled: boolean;
  adaptation_paused: boolean;
  successful_source_reuse_enabled: boolean;
  reuse_check_interval_hours: number;
}

export const DEFAULT_SUCCESSFUL_SOURCE_REUSE_POLICY: Readonly<SuccessfulSourceReusePolicy> = Object.freeze({
  adaptation_enabled: false, adaptation_paused: false,
  successful_source_reuse_enabled: false, reuse_check_interval_hours: DEFAULT_SOURCE_CHECK_INTERVAL_HOURS,
});

export type AdaptiveSourceSeed = {
  role: 'explicit_listing' | 'verified_listing' | 'vacancy_page' | 'verification_page' | 'legacy_candidate';
  url?: string | null;
  verified_at?: string | null;
  kind?: AdaptiveSearchSource['kind'];
  institution?: string | null;
  topics?: string[];
};

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new TypeError('Invalid source identity');
  return value.toLowerCase();
}
function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid source setting');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Invalid source setting');
  return value;
}
function instant(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Invalid source timestamp');
  const match = value.match(/^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.([0-9]{1,6}))?(?:Z|[+-](?:0[0-9]|1[0-5]):[0-5][0-9])$/u);
  if (!match || Number(match[1]) === 0) throw new TypeError('Invalid source timestamp');
  const day = new Date(0); day.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = Date.parse(value.replace(/\.[0-9]+(?=Z|[+-][0-9]{2}:[0-9]{2}$)/u, ''));
  if (!Number.isFinite(parsed) || day.getUTCFullYear() !== Number(match[1]) || day.getUTCMonth() !== Number(match[2]) - 1 || day.getUTCDate() !== Number(match[3])) {
    throw new TypeError('Invalid source timestamp');
  }
  return BigInt(parsed) * 1000n + BigInt((match[5] ?? '').padEnd(6, '0'));
}
function timestamp(value: unknown): string | null { instant(value); return value === undefined || value === null ? null : value as string; }

/** URL normalization does not remove filters, reorder duplicate parameters, or lowercase paths. */
export function canonicalAdaptiveListingUrl(value: unknown): string | null { return sanitizeOpportunityFeedbackUrl(value); }

/** Closed source DTO: unknown fields, people arrays and raw evidence are never copied. */
export function normalizeAdaptiveSearchSource(value: unknown, scope: AdaptiveSourceScope): AdaptiveSearchSource {
  if (!record(value)) throw new TypeError('Invalid source record');
  const owner = uuid(scope.user_id); const search = uuid(scope.search_id);
  if (uuid(value.user_id) !== owner || uuid(value.search_id) !== search) throw new TypeError('Source scope mismatch');
  const listing = value.listing_url === null ? null : canonicalAdaptiveListingUrl(value.listing_url);
  const vacancy = value.vacancy_url === null ? null : canonicalAdaptiveListingUrl(value.vacancy_url);
  if (value.listing_url !== null && !listing || value.vacancy_url !== null && !vacancy) throw new TypeError('Unsafe source URL');
  if (!ADAPTIVE_SOURCE_KINDS.includes(value.kind as AdaptiveSearchSource['kind']) || !ADAPTIVE_SOURCE_STATUSES.includes(value.status as AdaptiveSearchSource['status'])
    || !['explicit', 'evidenced_listing', 'candidate'].includes(value.provenance as string)) throw new TypeError('Invalid source classification');
  const institution = value.institution;
  if (institution !== null && !opportunityFeedbackTextIsSafe(institution, 200)) throw new TypeError('Unsafe source institution');
  if (!Array.isArray(value.topics) || value.topics.length > 16 || value.topics.some(topic => !opportunityFeedbackTextIsSafe(topic, 120))) {
    throw new TypeError('Invalid source topics');
  }
  const result: AdaptiveSearchSource = {
    registry_id: uuid(value.registry_id), user_id: owner, search_id: search, listing_url: listing, vacancy_url: vacancy,
    kind: value.kind as AdaptiveSearchSource['kind'], institution: institution as string | null,
    topics: [...new Set(value.topics as string[])].sort(), priority: boundedInteger(value.priority, 0, 100),
    enabled: boolean(value.enabled), pinned: boolean(value.pinned), mandatory: boolean(value.mandatory),
    check_interval_hours: boundedInteger(value.check_interval_hours, MIN_SOURCE_CHECK_INTERVAL_HOURS, MAX_SOURCE_CHECK_INTERVAL_HOURS),
    last_attempted_at: timestamp(value.last_attempted_at), last_successful_at: timestamp(value.last_successful_at),
    status: value.status as AdaptiveSearchSource['status'], owner_disabled: boolean(value.owner_disabled),
    provenance: value.provenance as AdaptiveSearchSource['provenance'], listing_verified_at: timestamp(value.listing_verified_at),
  };
  if (!listing && (result.enabled || result.mandatory || result.status !== 'pending_identification' || result.listing_verified_at !== null)
    || result.owner_disabled && result.enabled) throw new TypeError('Inconsistent source availability');
  return result;
}

/** Explicit/evidenced URLs only; no guessed university homepage, parent path or jobs endpoint. */
export function createAdaptiveSourceCandidate(scope: AdaptiveSourceScope, registryId: string, seed: AdaptiveSourceSeed,
  checkIntervalHours = DEFAULT_SOURCE_CHECK_INTERVAL_HOURS): AdaptiveSearchSource {
  if (!['explicit_listing', 'verified_listing', 'vacancy_page', 'verification_page', 'legacy_candidate'].includes(seed.role)) throw new TypeError('Invalid source evidence');
  const reusable = seed.role === 'explicit_listing' || seed.role === 'verified_listing';
  const url = seed.url === undefined || seed.url === null ? null : canonicalAdaptiveListingUrl(seed.url);
  if (seed.url && !url || reusable && !url) throw new TypeError('A source requires a safe evidenced URL');
  const verifiedAt = seed.role === 'verified_listing' ? timestamp(seed.verified_at) : null;
  if (seed.role === 'verified_listing' && !verifiedAt) throw new TypeError('A verified listing requires its actual verification time');
  return normalizeAdaptiveSearchSource({ registry_id: registryId, user_id: scope.user_id, search_id: scope.search_id,
    listing_url: reusable ? url : null, vacancy_url: seed.role === 'vacancy_page' || seed.role === 'legacy_candidate' ? url : null,
    kind: seed.kind ?? 'other', institution: seed.institution ?? null, topics: seed.topics ?? [], priority: 50,
    enabled: seed.role === 'explicit_listing', pinned: false, mandatory: false, check_interval_hours: checkIntervalHours,
    last_attempted_at: null, last_successful_at: null, status: reusable ? 'ready' : 'pending_identification', owner_disabled: false,
    provenance: seed.role === 'explicit_listing' ? 'explicit' : seed.role === 'verified_listing' ? 'evidenced_listing' : 'candidate', listing_verified_at: verifiedAt }, scope);
}

export interface RetainedInstitutionListing { institution: string; listing_url: string }

/**
 * Prepare owner-selected discovery paths, never institutional fit rewards.
 * Existing paths win, including disabled sources and their chosen cadence/pins.
 * Keep the returned candidates for an action's exact retry; this does not save.
 */
export function prepareRetainedInstitutionSources(scope: AdaptiveSourceScope, configured: readonly RetainedInstitutionListing[],
  existing: readonly AdaptiveSearchSource[], registryId: () => string = () => crypto.randomUUID()): AdaptiveSearchSource[] {
  const owner = uuid(scope.user_id), search = uuid(scope.search_id);
  if (!Array.isArray(configured) || configured.length > 64 || !Array.isArray(existing)) throw new TypeError('Use a bounded institution source selection.');
  const existingSources = existing.filter(source => typeof source.user_id === 'string' && typeof source.search_id === 'string'
    && source.user_id.toLowerCase() === owner && source.search_id.toLowerCase() === search)
    .map(source => normalizeAdaptiveSearchSource(source, scope));
  const paths = new Set(existingSources.flatMap(source => source.listing_url ? [source.listing_url] : []));
  const ids = new Set(existingSources.map(source => source.registry_id));
  const missing: AdaptiveSearchSource[] = [];
  for (const entry of configured) {
    if (!record(entry) || Object.keys(entry).some(key => !['institution', 'listing_url'].includes(key))
      || !opportunityFeedbackTextIsSafe(entry.institution, 200)) throw new TypeError('Use an institution name and official listing URL.');
    const listing = canonicalAdaptiveListingUrl(entry.listing_url);
    if (!listing) throw new TypeError('Use a safe official listing URL.');
    if (paths.has(listing)) continue;
    const id = uuid(registryId());
    if (ids.has(id)) throw new TypeError('Use a distinct source identity.');
    ids.add(id); paths.add(listing);
    missing.push(createAdaptiveSourceCandidate(scope, id, { role: 'explicit_listing', url: listing, kind: 'university', institution: entry.institution }));
  }
  if (existingSources.filter(source => source.enabled).length + missing.length > 64) throw new RangeError('Keep enabled reusable sources within the 64-source execution bound.');
  return missing;
}

export function adaptiveSourceIsDue(source: AdaptiveSearchSource, now: string): boolean {
  const valid = normalizeAdaptiveSearchSource(source, source);
  const current = instant(now);
  if (current === null) throw new TypeError('An actual check clock is required');
  if (!valid.enabled || valid.owner_disabled || !valid.listing_url || valid.status === 'pending_identification') return false;
  const attempted = instant(valid.last_attempted_at); const successful = instant(valid.last_successful_at);
  const last = attempted === null ? successful : successful === null || attempted >= successful ? attempted : successful;
  return last === null || current >= last + BigInt(valid.check_interval_hours) * 3_600_000_000n;
}

/** No web-result membership or result-count filter: due pinned/mandatory sources remain direct checks. */
export function dueAdaptiveSearchSources(sources: readonly AdaptiveSearchSource[], scope: AdaptiveSourceScope, now: string): AdaptiveSearchSource[] {
  const owner = uuid(scope.user_id); const search = uuid(scope.search_id);
  return sources.filter(source => typeof source.user_id === 'string' && typeof source.search_id === 'string'
    && source.user_id.toLowerCase() === owner && source.search_id.toLowerCase() === search)
    .map(source => normalizeAdaptiveSearchSource(source, scope)).filter(source => adaptiveSourceIsDue(source, now))
    .sort((left, right) => Number(right.mandatory) - Number(left.mandatory) || Number(right.pinned) - Number(left.pinned)
      || right.priority - left.priority || left.registry_id.localeCompare(right.registry_id, 'en'));
}

export interface AdaptiveSourceCoverage {
  registry_id: string;
  attempted_at: string;
  outcome: 'complete' | 'blocked' | 'paginated' | 'dynamic' | 'failed';
}

/** Actual coverage updates metadata only. Empty or blocked checks never remove the source. */
export function applyAdaptiveSourceCoverage(source: AdaptiveSearchSource, coverage: AdaptiveSourceCoverage): AdaptiveSearchSource {
  const before = normalizeAdaptiveSearchSource(source, source);
  if (uuid(coverage.registry_id) !== before.registry_id) throw new TypeError('Source check scope mismatch');
  const checkedAt = instant(coverage.attempted_at);
  if (checkedAt === null || !['complete', 'blocked', 'paginated', 'dynamic', 'failed'].includes(coverage.outcome)) throw new TypeError('Invalid source check');
  const previous = instant(before.last_attempted_at);
  const successful = instant(before.last_successful_at);
  if (previous !== null && checkedAt < previous || successful !== null && checkedAt < successful) return before;
  if (!before.listing_url) throw new TypeError('Identify a reusable listing before recording its coverage');
  return { ...before, last_attempted_at: coverage.attempted_at,
    last_successful_at: coverage.outcome === 'complete' ? coverage.attempted_at : before.last_successful_at,
    status: coverage.outcome === 'complete' ? 'checked' : coverage.outcome === 'blocked' ? 'blocked' : 'incomplete' };
}

export interface VerifiedReusableSourceSignal {
  role: 'verified_listing';
  listing_url: string;
  verified_at: string;
  interest_origin: OpportunityFeedbackOutcome['interest_origin'];
  interest_score: number | null;
  confirmed_submission: boolean;
  /** Exact vacancy-specific reference; a shared application portal is insufficient. */
  vacancy_url?: string | null;
  vacancy_url_role?: 'vacancy' | 'listing' | 'application_portal' | 'context' | 'unknown';
}

export interface SourceRetentionResult {
  source: AdaptiveSearchSource;
  retained: boolean;
  reason: 'retained' | 'policy_disabled' | 'adaptation_disabled' | 'adaptation_paused' | 'owner_disabled' | 'unverified_listing' | 'not_useful' | 'listing_mismatch';
  policy_version: typeof SUCCESSFUL_SOURCE_REUSE_VERSION;
}

/** One verified useful discovery can retain a path; this makes no institution-wide statistical claim. */
export function retainSuccessfulAdaptiveSource(source: AdaptiveSearchSource, signal: VerifiedReusableSourceSignal,
  policy: SuccessfulSourceReusePolicy = DEFAULT_SUCCESSFUL_SOURCE_REUSE_POLICY): SourceRetentionResult {
  const before = normalizeAdaptiveSearchSource(source, source);
  const enabled = boolean(policy.successful_source_reuse_enabled);
  const adaptationEnabled = boolean(policy.adaptation_enabled), paused = boolean(policy.adaptation_paused);
  const interval = boundedInteger(policy.reuse_check_interval_hours, MIN_SOURCE_CHECK_INTERVAL_HOURS, MAX_SOURCE_CHECK_INTERVAL_HOURS);
  const result = (retained: boolean, reason: SourceRetentionResult['reason'], updated = before): SourceRetentionResult => ({ source: updated, retained, reason, policy_version: SUCCESSFUL_SOURCE_REUSE_VERSION });
  if (!enabled) return result(false, 'policy_disabled');
  if (!adaptationEnabled) return result(false, 'adaptation_disabled');
  if (paused) return result(false, 'adaptation_paused');
  if (before.owner_disabled) return result(false, 'owner_disabled');
  if (signal.role !== 'verified_listing' || !canonicalAdaptiveListingUrl(signal.listing_url) || instant(signal.verified_at) === null) return result(false, 'unverified_listing');
  if (!['explicit_rating', 'categorical_review', 'application', 'confirmed_submission', 'none', 'excluded'].includes(signal.interest_origin)
    || signal.interest_score !== null && (typeof signal.interest_score !== 'number' || !Number.isFinite(signal.interest_score)
      || signal.interest_score < 0 || signal.interest_score > 10)) throw new TypeError('Invalid source interest evidence');
  boolean(signal.confirmed_submission);
  const listing = canonicalAdaptiveListingUrl(signal.listing_url)!;
  if (before.listing_url !== null && before.listing_url !== listing) return result(false, 'listing_mismatch');
  if (before.listing_url === null && before.vacancy_url !== null
    && (signal.vacancy_url_role !== 'vacancy' || canonicalAdaptiveListingUrl(signal.vacancy_url) !== before.vacancy_url)) {
    return result(false, 'listing_mismatch');
  }
  const explicitHigh = ['explicit_rating', 'categorical_review', 'application', 'confirmed_submission'].includes(signal.interest_origin)
    && typeof signal.interest_score === 'number' && Number.isFinite(signal.interest_score) && signal.interest_score >= EXPLICIT_HIGH_SOURCE_INTEREST && signal.interest_score <= 10;
  if (signal.interest_origin === 'excluded' || !explicitHigh && signal.confirmed_submission !== true) return result(false, 'not_useful');
  const previousVerified = instant(before.listing_verified_at); const incomingVerified = instant(signal.verified_at)!;
  const newAutomaticSource = before.status === 'pending_identification' || !before.enabled && before.provenance === 'evidenced_listing'
    && before.last_attempted_at === null && before.last_successful_at === null;
  return result(true, 'retained', { ...before, listing_url: listing, enabled: true,
    provenance: before.provenance === 'explicit' ? 'explicit' : 'evidenced_listing',
    check_interval_hours: newAutomaticSource && !before.pinned && !before.mandatory ? interval : before.check_interval_hours,
    listing_verified_at: previousVerified !== null && previousVerified > incomingVerified ? before.listing_verified_at : signal.verified_at,
    status: before.status === 'pending_identification' ? 'ready' : before.status });
}
