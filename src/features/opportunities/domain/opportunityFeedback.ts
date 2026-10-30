import {
  OPPORTUNITY_INTEREST_REASON_CATEGORIES, OPPORTUNITY_REVIEW_STATES,
  type Application, type OpportunityInterestReason, type OpportunityPredictionBaseline,
  type OpportunityReview, type OpportunityReviewState,
} from '../../../app/cloudTypes';

export const OPPORTUNITY_INTEREST_METRIC_VERSION = 'opportunity-interest-v1';
export const MAX_OPPORTUNITY_INTEREST_REASONS = 16;
export const MAX_OPPORTUNITY_INTEREST_TARGET_LENGTH = 120;

/** Versioned product conventions, not probabilities or AI fit assessments. */
export interface OpportunityInterestMetricPolicy {
  version: string;
  review_scores: Readonly<Record<Exclude<OpportunityReviewState, 'unreviewed'>, number>>;
  submitted_score: number;
}

export const DEFAULT_OPPORTUNITY_INTEREST_POLICY: OpportunityInterestMetricPolicy = Object.freeze({
  version: OPPORTUNITY_INTEREST_METRIC_VERSION,
  review_scores: Object.freeze({ strong_interest: 8, interested: 6, not_interested: 2 }),
  submitted_score: 9,
});

/** Only these application fields can participate in the interest metric. */
export type OpportunitySubmissionEvidence = Pick<Application, 'user_id' | 'opportunity_id' | 'status' | 'submitted_at' | 'status_history'>;

export interface ConfirmedOpportunitySubmission {
  confirmed: boolean;
  /** Earliest explicitly recorded submission date; null when the date is unknown. */
  submitted_at: string | null;
}

export type OpportunityInterestOrigin = 'explicit_rating' | 'categorical_review' | 'confirmed_submission' | 'none' | 'excluded';

/** One current, owner-scoped outcome. No comments, documents, contacts, or application context. */
export interface OpportunityFeedbackOutcome {
  user_id: string;
  opportunity_id: string;
  metric_version: string;
  interest_score: number | null;
  interest_origin: OpportunityInterestOrigin;
  confirmed_submission: boolean;
  submission_at: string | null;
  feedback_revision: number;
  feedback_updated_at: string | null;
  baseline_status: 'available' | 'unavailable';
  interest_gap: number | null;
}

export interface OpportunityFeedbackInput {
  user_id: string;
  opportunity_id: string;
  review?: OpportunityReview | null;
  applications?: readonly OpportunitySubmissionEvidence[];
  /**
   * Independent trusted evidence, verified server-side against the exact owner-scoped receipt
   * and non-rolled-back immutable assessment or historical snapshot. Never populate from a client assertion,
   * current catalogue assessment, display string, or application context. Without it no gap exists.
   */
  verified_prediction?: OpportunityPredictionBaseline | null;
}

/** Strict numbers only: zero is a rating; strings, infinities and NaN are not. */
export function isOpportunityInterestRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
}

export function parseOpportunityInterestRating(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!isOpportunityInterestRating(value)) throw new RangeError('Interest rating must be a finite number from 0 to 10');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0)!);
  const rightPoints = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}

/** Validate and canonicalize explicit tags without interpreting arbitrary text. */
export function normalizeOpportunityInterestReasons(value: unknown): OpportunityInterestReason[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_OPPORTUNITY_INTEREST_REASONS) {
    throw new RangeError(`Interest reasons must be an array of at most ${MAX_OPPORTUNITY_INTEREST_REASONS} tags`);
  }
  const reasons = new Map<string, OpportunityInterestReason>();
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).some(key => !['category', 'polarity', 'target'].includes(key))
      || !OPPORTUNITY_INTEREST_REASON_CATEGORIES.includes(entry.category as OpportunityInterestReason['category'])
      || !['positive', 'negative'].includes(entry.polarity as string)) {
      throw new TypeError('Invalid structured interest reason');
    }
    const reason: OpportunityInterestReason = {
      category: entry.category as OpportunityInterestReason['category'],
      polarity: entry.polarity as OpportunityInterestReason['polarity'],
    };
    if (entry.target !== undefined) {
      // Match PostgreSQL btrim/char_length and C collation exactly, including non-BMP targets.
      const target = typeof entry.target === 'string' ? entry.target.replace(/^ +| +$/gu, '') : null;
      if (!['topic', 'method'].includes(reason.category) || typeof entry.target !== 'string'
        || !target || Array.from(target).length > MAX_OPPORTUNITY_INTEREST_TARGET_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(entry.target)) {
        throw new TypeError('Interest targets require an explicit bounded topic or method');
      }
      reason.target = target;
    }
    reasons.set(JSON.stringify(reason), reason);
  }
  return [...reasons.values()].sort((left, right) => compareCodePoints(left.category, right.category)
    || compareCodePoints(left.polarity, right.polarity) || compareCodePoints(left.target ?? '', right.target ?? ''));
}

function timestamp(value: unknown): bigint | null {
  // A date alone is not a known submission time. Do not accept Date.parse's numeric-string coercion.
  if (typeof value !== 'string') return null;
  const match = value.match(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d{1,6}))?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/u);
  if (!match || Number(value.slice(0, 4)) === 0) return null;
  const parsed = Date.parse(value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/u, ''));
  if (!Number.isFinite(parsed)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // PostgreSQL preserves microseconds; comparing Date.parse milliseconds can accept a later prediction.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? BigInt(parsed) * 1_000n + BigInt((match[1] ?? '').padEnd(6, '0')) : null;
}

/** Shared strict, microsecond-preserving parser for authorized feedback metadata. */
export { timestamp as opportunityFeedbackTimestamp };

function compareTimestamps(left: string, right: string): number {
  const leftTime = timestamp(left)!;
  const rightTime = timestamp(right)!;
  return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : compareCodePoints(left, right);
}

/** Unlike the UI's applied grouping, later employer statuses alone are never proof of submission. */
export function confirmedOpportunitySubmission(
  application: Pick<OpportunitySubmissionEvidence, 'status' | 'submitted_at' | 'status_history'>,
): ConfirmedOpportunitySubmission {
  const dates: string[] = [];
  if (timestamp(application.submitted_at) !== null) dates.push(application.submitted_at!);
  const submittedHistory = Array.isArray(application.status_history)
    ? application.status_history.filter(entry => entry && entry.status === 'submitted') : [];
  for (const entry of submittedHistory) if (timestamp(entry.changedAt) !== null) dates.push(entry.changedAt!);
  dates.sort(compareTimestamps);
  return {
    confirmed: application.status === 'submitted' || dates.length > 0 || submittedHistory.length > 0,
    submitted_at: dates[0] ?? null,
  };
}

function validatePolicy(policy: OpportunityInterestMetricPolicy): void {
  if (typeof policy.version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(policy.version)
    || !isOpportunityInterestRating(policy.submitted_score)
    || !['strong_interest', 'interested', 'not_interested'].every(state => isOpportunityInterestRating(policy.review_scores?.[state as keyof typeof policy.review_scores]))) {
    throw new TypeError('Invalid versioned interest metric policy');
  }
  if (policy.version === OPPORTUNITY_INTEREST_METRIC_VERSION && (policy.submitted_score !== 9
    || policy.review_scores.strong_interest !== 8 || policy.review_scores.interested !== 6 || policy.review_scores.not_interested !== 2)) {
    throw new TypeError('Changed interest conventions require a new metric version');
  }
}

function validBaseline(value: unknown, userId: string, opportunityId: string): value is OpportunityPredictionBaseline {
  if (!isRecord(value) || Object.keys(value).sort().join(',')
    !== 'opportunity_id,predicted_at,scale_max,scale_min,score,source_kind,source_ref,user_id') return false;
  const referenceMatches = typeof value.source_ref === 'string' && (value.source_kind === 'historical_snapshot'
    ? /^opportunity-search-receipt:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.source_ref)
    : value.source_kind === 'discovery_assessment'
      && /^opportunity-discovery-assessment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.source_ref));
  return value.user_id === userId && value.opportunity_id === opportunityId && isOpportunityInterestRating(value.score)
    && value.scale_min === 0 && value.scale_max === 10 && timestamp(value.predicted_at) !== null
    && referenceMatches;
}

/** Deterministic current outcome; never inspect catalogue scores or mutate the supplied records. */
export function deriveOpportunityFeedback(
  input: OpportunityFeedbackInput,
  policy: OpportunityInterestMetricPolicy = DEFAULT_OPPORTUNITY_INTEREST_POLICY,
): OpportunityFeedbackOutcome {
  validatePolicy(policy);
  if (typeof input.user_id !== 'string' || !input.user_id.trim() || typeof input.opportunity_id !== 'string' || !input.opportunity_id.trim()) {
    throw new TypeError('Feedback requires an owner and opportunity');
  }
  const review = input.review;
  if (review && (review.user_id !== input.user_id || review.opportunity_id !== input.opportunity_id)) {
    throw new TypeError('Feedback review scope mismatch');
  }
  if (review && !OPPORTUNITY_REVIEW_STATES.includes(review.state)) throw new TypeError('Invalid opportunity review state');
  if (review?.feedback_excluded !== undefined && typeof review.feedback_excluded !== 'boolean') throw new TypeError('Invalid feedback exclusion flag');
  const revision = review?.feedback_revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Invalid feedback revision');
  const feedbackAt = timestamp(review?.feedback_updated_at);
  const submissions = (input.applications ?? []).filter(application => application.user_id === input.user_id
    && application.opportunity_id === input.opportunity_id).map(confirmedOpportunitySubmission);
  const submissionDates = submissions.flatMap(submission => submission.submitted_at ? [submission.submitted_at] : [])
    .sort(compareTimestamps);
  const confirmed = submissions.some(submission => submission.confirmed);
  const result: OpportunityFeedbackOutcome = {
    user_id: input.user_id, opportunity_id: input.opportunity_id, metric_version: policy.version,
    interest_score: null, interest_origin: 'none', confirmed_submission: confirmed,
    submission_at: submissionDates[0] ?? null, feedback_revision: revision,
    feedback_updated_at: feedbackAt === null ? null : review!.feedback_updated_at!,
    baseline_status: 'unavailable', interest_gap: null,
  };
  if (review?.feedback_excluded) return { ...result, interest_origin: 'excluded' };
  const rating = parseOpportunityInterestRating(review?.interest_rating);
  if (rating !== null) {
    result.interest_score = rating;
    result.interest_origin = 'explicit_rating';
  } else if (review && review.state !== 'unreviewed') {
    result.interest_score = policy.review_scores[review.state];
    result.interest_origin = 'categorical_review';
  } else if (confirmed) {
    result.interest_score = policy.submitted_score;
    result.interest_origin = 'confirmed_submission';
  }
  const verified = input.verified_prediction;
  // Submission is a current derived fallback, not an explicit feedback revision.
  // Its real, known time can match an independently verified ex-ante prediction.
  // Explicit ratings/categories never gain a retrospective baseline this way.
  const baseline = review?.prediction_baseline ?? (result.interest_origin === 'confirmed_submission' ? verified : null);
  const observedAt = result.interest_origin === 'confirmed_submission' ? timestamp(result.submission_at) : feedbackAt;
  if (result.interest_score !== null && observedAt !== null
    && validBaseline(baseline, input.user_id, input.opportunity_id) && validBaseline(verified, input.user_id, input.opportunity_id)
    && baseline.score === verified.score && baseline.source_kind === verified.source_kind
    && timestamp(baseline.predicted_at) === timestamp(verified.predicted_at) && baseline.source_ref === verified.source_ref
    && timestamp(baseline.predicted_at)! <= observedAt) {
    result.baseline_status = 'available';
    result.interest_gap = result.interest_score - baseline.score;
  }
  return result;
}
