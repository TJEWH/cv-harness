import { OPPORTUNITY_TECHNICAL_ISSUES, type OpportunityDispositionPatch, type OpportunityReview } from '../../../app/cloudTypes';
import { isOpportunityDeadlinePassed } from './opportunityDeadline';

const fields = ['manually_archived', 'technical_issue_category', 'technical_issue_note'] as const;
/** Older installations omit these columns; present metadata must use the closed contract. */
export function readOpportunityDisposition(value: Record<string, unknown>): OpportunityDispositionPatch {
  const selected = Object.fromEntries(Object.entries(value).filter(([key]) => (fields as readonly string[]).includes(key)));
  return Object.keys(selected).length ? normalizeOpportunityDispositionPatch(selected) : {};
}
export function normalizeOpportunityDispositionPatch(value: unknown): OpportunityDispositionPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length
    || Object.keys(value).some(key => !(fields as readonly string[]).includes(key))) throw new TypeError('Select only supported opportunity disposition fields.');
  const raw = value as Record<string, unknown>, patch: OpportunityDispositionPatch = {};
  if (Object.hasOwn(raw, 'manually_archived')) {
    if (typeof raw.manually_archived !== 'boolean') throw new TypeError('Choose whether to move the opportunity to Past.');
    patch.manually_archived = raw.manually_archived;
  }
  if (Object.hasOwn(raw, 'technical_issue_category')) {
    if (raw.technical_issue_category !== null && !(OPPORTUNITY_TECHNICAL_ISSUES as readonly unknown[]).includes(raw.technical_issue_category)) throw new TypeError('Select a supported technical issue.');
    patch.technical_issue_category = raw.technical_issue_category as OpportunityDispositionPatch['technical_issue_category'];
  }
  if (Object.hasOwn(raw, 'technical_issue_note')) {
    if (raw.technical_issue_note !== null && (typeof raw.technical_issue_note !== 'string'
      || Array.from(raw.technical_issue_note).length > 1000 || raw.technical_issue_note.includes('\0'))) throw new TypeError('Keep technical notes to 1,000 characters or fewer.');
    patch.technical_issue_note = raw.technical_issue_note === '' ? null : raw.technical_issue_note as string | null;
  }
  return patch;
}

/** A personal archive flag never changes the factual deadline or application outcome. */
export function isOpportunityInPast(details: Record<string, unknown>, review: Pick<OpportunityReview, 'manually_archived'> | undefined, now = new Date()): boolean {
  return review?.manually_archived === true || isOpportunityDeadlinePassed(details, now);
}
