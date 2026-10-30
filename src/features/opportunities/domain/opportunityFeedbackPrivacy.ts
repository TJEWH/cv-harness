import type { OpportunityInterestReason, OpportunityPredictionBaseline, OpportunityReview } from '../../../app/cloudTypes';
import {
  deriveOpportunityFeedback, normalizeOpportunityInterestReasons,
  type OpportunityFeedbackOutcome, type OpportunitySubmissionEvidence,
} from './opportunityFeedback';
import { safeWebUrl } from '../../../shared/lib/safeUrl';
import { MAX_OPPORTUNITY_EVALUATION_LENGTH } from './opportunityEvaluation';

export const MAX_SEARCH_FEEDBACK_SUMMARY_LENGTH = 600;
export const OPPORTUNITY_FEEDBACK_ALLOWLIST_VERSION = 'opportunity-feedback-safe-v1';

const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const phone = /\+?[0-9][0-9 ()/.-]{5,}[0-9]/u;
const contactScheme = /(?:mailto|tel):/iu;
const credential = /(?:bearer\s+[A-Za-z0-9._~+/-]+|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session[_ -]?id)\s*[:=]\s*\S+)/iu;
const secretToken = /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)/iu;
const instruction = /(?:ignore\s+(?:(?:all|any)\s+)?(?:previous|prior|system)|execute_sql|(?:drop|alter)\s+(?:table|role|schema)|service_role)/iu;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const privateParameter = '(?:access[_-]?token|refresh[_-]?token|token|key|api[_-]?key|auth(?:entication|orization)?|password|passwd|pwd|secret|session(?:[_-]?id)?|jwt|code|email(?:[_-]?address)?|e[_-]?mail|phone(?:[_-]?number)?|mobile|tel|telephone|address|street|name|first[_-]?name|last[_-]?name|full[_-]?name|user(?:[_-]?id|[_-]?name)?|candidate(?:[_-]?id)?|applicant(?:[_-]?id)?|person(?:[_-]?id)?|contact(?:[_-]?id)?)';
const personalQueryKey = new RegExp(`^${privateParameter}$`, 'iu');
const embeddedPersonalParameter = new RegExp(`[?&#]${privateParameter}=`, 'iu');
const credentialPath = /\/(?:login|log-in|signin|sign-in|signup|sign-up|auth|oauth|authorize|password|reset-password|session)(?:\/|$)/iu;
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function decoded(value: string): string | null {
  let result = value;
  for (let index = 0; index < 3; index++) {
    try {
      const next = decodeURIComponent(result);
      if (next === result) return result;
      result = next;
    } catch { return null; }
  }
  return /%[0-9a-f]{2}/iu.test(result) ? null : result;
}

/** Public job links only. Do not strip a secret and then accidentally publish its enclosing URL. */
export function sanitizeOpportunityFeedbackUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  const safe = safeWebUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!url.hostname.includes('.') || url.hostname === 'localhost' || /\.(?:localhost|local)$/iu.test(url.hostname)
    || /^[0-9.]+$/u.test(url.hostname) || url.hostname.includes(':')) return null;
  const plain = decoded(safe);
  const path = decoded(url.pathname);
  if (plain === null || path === null || /[\u0000-\u001f\u007f\\]/u.test(plain) || email.test(plain) || contactScheme.test(plain)
    || credential.test(plain) || secretToken.test(plain) || credentialPath.test(path) || credentialPath.test(plain)
    || embeddedPersonalParameter.test(plain)) return null;
  for (const match of plain.matchAll(/[?&#]([^?&#=]+)=/gu)) {
    if (personalQueryKey.test(match[1]!.replace(/[+\s_-]+/gu, ''))) return null;
  }
  for (const [key, entry] of url.searchParams) {
    const plainKey = decoded(key);
    const plainValue = decoded(entry);
    if (plainKey === null || plainValue === null || personalQueryKey.test(plainKey.replace(/[\s_-]+/gu, ''))
      || email.test(plainValue) || contactScheme.test(plainValue) || credential.test(plainValue)
      || secretToken.test(plainValue) || /https?:\/\/[^\s/]+@/iu.test(plainValue)) return null;
  }
  // Fragments can be meaningful public SPA vacancy identifiers, but never credentials.
  const fragment = decoded(url.hash);
  if (fragment === null || /(?:^|[?&#])(?:token|access_token|refresh_token|email|session|password|code)=/iu.test(fragment)) return null;
  return safe;
}

/** Conservative defense in depth. This does not establish anonymity. */
export function opportunityFeedbackTextIsSafe(value: unknown, maxLength = MAX_SEARCH_FEEDBACK_SUMMARY_LENGTH): value is string {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 12000
    || !value.trim() || Array.from(value).length > maxLength || controls.test(value)
    || email.test(value) || phone.test(value) || contactScheme.test(value)
    || credential.test(value) || secretToken.test(value) || instruction.test(value) || /(?:https?:\/\/|\/\/[a-z0-9])/iu.test(value)) return false;
  return true;
}

/** Same SHA-256 UTF-8 hash as the database; never transmits or stores the source text. */
export async function opportunityFeedbackTextHash(value: string | null | undefined): Promise<string> {
  if (value !== null && value !== undefined && typeof value !== 'string') throw new TypeError('Invalid feedback text');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value ?? ''));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface AdaptiveSummaryInclusion {
  policy_version: 'included-unless-excluded-v1'; summary_hash: string; source_hash: string;
  summary_revision: number; truncated: boolean; source_length: number;
}
export function validateAdaptiveSummaryInclusion(value: unknown): AdaptiveSummaryInclusion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proof = value as Record<string, unknown>;
  if (Object.keys(proof).some(key => !['policy_version','summary_hash','source_hash','summary_revision','truncated','source_length'].includes(key))
    || proof.policy_version !== 'included-unless-excluded-v1' || typeof proof.summary_hash !== 'string' || !/^[a-f0-9]{64}$/u.test(proof.summary_hash)
    || typeof proof.source_hash !== 'string' || !/^[a-f0-9]{64}$/u.test(proof.source_hash)
    || typeof proof.summary_revision !== 'number' || !Number.isSafeInteger(proof.summary_revision) || proof.summary_revision < 0
    || typeof proof.source_length !== 'number' || !Number.isSafeInteger(proof.source_length) || proof.source_length < 1 || proof.source_length > 12000
    || proof.truncated !== (proof.source_length > 600)) return null;
  return { policy_version: 'included-unless-excluded-v1', summary_hash: proof.summary_hash, source_hash: proof.source_hash,
    summary_revision: proof.summary_revision, truncated: proof.truncated as boolean, source_length: proof.source_length };
}
/** The saved evaluation is included by default; exclusions and content safeguards still apply. */
export async function includedOpportunitySearchSummary(review: OpportunityReview | null | undefined): Promise<{ text: string; proof: AdaptiveSummaryInclusion } | null> {
  if (!review || review.feedback_excluded || !Number.isSafeInteger(review.evaluation_revision) || review.evaluation_revision! < 0) return null;
  const source = review.comment, revision = review.evaluation_revision!;
  if (!opportunityFeedbackTextIsSafe(source, MAX_OPPORTUNITY_EVALUATION_LENGTH)) return null;
  const points = Array.from(source), summary = points.slice(0, MAX_SEARCH_FEEDBACK_SUMMARY_LENGTH).join('');
  if (!opportunityFeedbackTextIsSafe(summary)) return null;
  const [summaryHash, sourceHash] = await Promise.all([opportunityFeedbackTextHash(summary), opportunityFeedbackTextHash(source)]);
  if (review.feedback_excluded || revision !== review.evaluation_revision || source !== review.comment) return null;
  return { text: summary, proof: { policy_version: 'included-unless-excluded-v1', summary_hash: summaryHash, source_hash: sourceHash,
    summary_revision: revision, truncated: points.length > MAX_SEARCH_FEEDBACK_SUMMARY_LENGTH, source_length: points.length } };
}

export interface OpportunityFeedbackProjectionInput {
  user_id: string;
  search_id: string;
  opportunity: Record<string, unknown>;
  review?: OpportunityReview | null;
  applications?: readonly OpportunitySubmissionEvidence[];
  verified_prediction?: OpportunityPredictionBaseline | null;
}

export interface SafeOpportunityFeedbackExample {
  opportunity_id: string;
  opportunity_key?: string;
  title?: string;
  institution?: string;
  official_url?: string;
  source_url?: string;
  research_summary?: string;
  topics: string[];
  metric_version: string;
  interest_score: number | null;
  interest_origin: OpportunityFeedbackOutcome['interest_origin'];
  interest_gap: number | null;
  baseline_status: OpportunityFeedbackOutcome['baseline_status'];
  original_prediction?: OpportunityPredictionBaseline;
  feedback_revision: number;
  feedback_updated_at: string | null;
  review_state: OpportunityReview['state'];
  confirmed_submission: boolean;
  submission_at: string | null;
  reasons: OpportunityInterestReason[];
  search_feedback_summary?: string;
  summary_inclusion?: AdaptiveSummaryInclusion;
  manually_archived?: boolean;
  technical_issue_category?: 'closed' | 'requirements' | 'application_problem' | 'other';
}

export type FeedbackWithheldField = 'example' | 'opportunity_key' | 'title' | 'institution' | 'official_url' | 'source_url'
  | 'research_summary' | 'topics' | 'reasons' | 'search_feedback_summary';
export interface OpportunityFeedbackProjection {
  allowlist_version: typeof OPPORTUNITY_FEEDBACK_ALLOWLIST_VERSION;
  example: SafeOpportunityFeedbackExample | null;
  withheld: { field: FeedbackWithheldField; reason: 'not_authorized' | 'excluded' | 'invalid_value' | 'unsafe_value' | 'limit' }[];
}

/** Build a new fixed-shape object, never clone a catalogue/application/review row into runner input. */
export async function projectOpportunityFeedback(input: OpportunityFeedbackProjectionInput): Promise<OpportunityFeedbackProjection> {
  const result: OpportunityFeedbackProjection = { allowlist_version: OPPORTUNITY_FEEDBACK_ALLOWLIST_VERSION, example: null, withheld: [] };
  const withhold = (field: FeedbackWithheldField, reason: OpportunityFeedbackProjection['withheld'][number]['reason']) => { result.withheld.push({ field, reason }); };
  if (typeof input.user_id !== 'string' || !identifier.test(input.user_id) || typeof input.search_id !== 'string' || !identifier.test(input.search_id)) {
    withhold('example', 'not_authorized'); return result;
  }
  const id = input.opportunity.id;
  if (typeof id !== 'string' || !identifier.test(id)
    || input.review && (input.review.user_id !== input.user_id || input.review.opportunity_id !== id)) {
    withhold('example', 'not_authorized'); return result;
  }
  if (input.review?.feedback_excluded) { withhold('example', 'excluded'); return result; }
  const capturedReview = input.review;
  const capturedOwner = input.user_id;
  const capturedSearch = input.search_id;
  const outcome = deriveOpportunityFeedback({ user_id: input.user_id, opportunity_id: id,
    review: input.review, applications: input.applications, verified_prediction: input.verified_prediction });
  const example: SafeOpportunityFeedbackExample = {
    opportunity_id: id, topics: [], metric_version: outcome.metric_version,
    interest_score: outcome.interest_score, interest_origin: outcome.interest_origin, interest_gap: outcome.interest_gap,
    baseline_status: outcome.baseline_status, feedback_revision: outcome.feedback_revision, feedback_updated_at: outcome.feedback_updated_at,
    review_state: input.review?.state ?? 'unreviewed', confirmed_submission: outcome.confirmed_submission,
    submission_at: outcome.submission_at, reasons: [],
  };
  if (outcome.baseline_status === 'available' && input.verified_prediction) {
    const prediction = input.verified_prediction;
    example.original_prediction = { user_id: input.user_id, opportunity_id: id, score: prediction.score,
      scale_min: 0, scale_max: 10, predicted_at: prediction.predicted_at, source_kind: prediction.source_kind, source_ref: prediction.source_ref };
  }
  const publicTextFields = { opportunity_key: 200, title: 240, institution: 200, research_summary: 1000 } as const;
  for (const [field, limit] of Object.entries(publicTextFields) as [keyof typeof publicTextFields, number][]) {
    const value = input.opportunity[field];
    if (value === undefined || value === null || value === '') continue;
    if (opportunityFeedbackTextIsSafe(value, limit)) example[field] = value;
    else withhold(field, 'unsafe_value');
  }
  for (const field of ['official_url', 'source_url'] as const) {
    const value = input.opportunity[field];
    if (value === undefined || value === null || value === '') continue;
    const url = sanitizeOpportunityFeedbackUrl(value);
    if (url) example[field] = url; else withhold(field, 'unsafe_value');
  }
  if (input.opportunity.topics !== undefined) {
    if (!Array.isArray(input.opportunity.topics)) withhold('topics', 'invalid_value');
    else {
      for (const topic of input.opportunity.topics) {
        if (opportunityFeedbackTextIsSafe(topic, 120)) {
          if (!example.topics.includes(topic) && example.topics.length < 16) example.topics.push(topic);
          else if (!example.topics.includes(topic)) withhold('topics', 'limit');
        } else withhold('topics', 'unsafe_value');
      }
      example.topics.sort();
    }
  }
  try {
    for (const reason of normalizeOpportunityInterestReasons(input.review?.interest_reasons)) {
      if (reason.target === undefined || opportunityFeedbackTextIsSafe(reason.target, 120)) example.reasons.push(reason);
      else withhold('reasons', 'unsafe_value');
    }
  } catch { withhold('reasons', 'invalid_value'); }
  const summary = await includedOpportunitySearchSummary(input.review);
  if (input.user_id !== capturedOwner || input.search_id !== capturedSearch || input.opportunity.id !== id
    || input.review !== capturedReview || input.review && (input.review.user_id !== capturedOwner || input.review.opportunity_id !== id)) {
    withhold('example', 'not_authorized'); return result;
  }
  if (input.review?.feedback_excluded) { withhold('example', 'excluded'); return result; }
  if (input.review?.manually_archived) example.manually_archived = true;
  if (['closed','requirements','application_problem','other'].includes(input.review?.technical_issue_category ?? '')) example.technical_issue_category = input.review!.technical_issue_category!;
  if (summary !== null) {
    example.search_feedback_summary = summary.text;
    example.summary_inclusion = summary.proof;
  }
  else if (input.review?.comment) withhold('search_feedback_summary', 'invalid_value');
  result.example = example;
  return result;
}
