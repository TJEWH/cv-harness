import type { AnnotationReference, AnnotationStatus, RefinementAnnotation, RefinementProposalRow, RefinementRequest, RefinementReviewRow } from '../refinementTypes';
import { letterFromEditableText, letterToEditableText } from '../../../documents/letter/motivationLetters';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const ID = /^annotation-[1-9][0-9]*$/;
export const QUESTION_GROUPS = ['application_requirements', 'experience', 'follow_up', 'other'] as const;
export type QuestionGroup = typeof QUESTION_GROUPS[number];
/** Category tags use the existing text contract so older saved proposals stay readable. */
export function questionPresentation(value: string): { group: QuestionGroup; text: string } {
  const match = /^\[(application_requirements|experience|follow_up|other)\]\s+([\s\S]+)$/.exec(value);
  return match ? { group: match[1] as QuestionGroup, text: match[2]! } : { group: 'other', text: value };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function validAnnotationReference(value: unknown): value is AnnotationReference {
  return exact(value, ['proposalId', 'annotationId', 'reviewId']) && typeof value.proposalId === 'string' && UUID.test(value.proposalId)
    && typeof value.annotationId === 'string' && ID.test(value.annotationId) && (value.reviewId === null || typeof value.reviewId === 'string' && UUID.test(value.reviewId));
}
export function validateAnnotationReview(value: unknown): void {
  if (!exact(value, ['proposalId', 'annotationId', 'status', 'response', 'previousReviewId'])
    || !validAnnotationReference({ proposalId: value.proposalId, annotationId: value.annotationId, reviewId: value.previousReviewId })
    || !['open', 'resolved', 'ignored'].includes(value.status as string)
    || !(value.response === null || validText(value.response, 12000) && !!value.response.trim())) throw new Error('Invalid annotation review.');
}
export function validateRefinementAnnotations(value: unknown, request: RefinementRequest, letterText: string): asserts value is RefinementAnnotation[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid refinement annotations.');
  const seen = new Set<string>();
  for (const annotation of value) {
    if (!exact(annotation, ['id', 'type', 'document', 'location', 'text']) || typeof annotation.id !== 'string' || !ID.test(annotation.id) || seen.has(annotation.id)
      || !['comment', 'todo', 'question'].includes(annotation.type as string) || !['cv', 'letter'].includes(annotation.document as string)
      || !validText(annotation.text, 4000) || !annotation.text.trim()) throw new Error('Invalid refinement annotation.');
    seen.add(annotation.id);
    if (annotation.location === null) continue;
    if (annotation.document === 'cv') {
      const location = annotation.location;
      if (!exact(location, ['fieldId']) || !request.cv.fields.some(field => field.id === location.fieldId)) throw new Error('Unknown CV annotation field.');
    } else {
      const location = annotation.location;
      if (!exact(location, ['start', 'quote']) || !Number.isInteger(location.start) || Number(location.start) < 0
        || !validText(location.quote, 2000) || !location.quote.trim()
        || [...letterText].slice(Number(location.start), Number(location.start) + [...location.quote].length).join('') !== location.quote) throw new Error('Invalid letter annotation reference.');
    }
  }
}
export interface AnnotationView {
  annotation: RefinementAnnotation; proposalId: string; requestId: string;
  status: AnnotationStatus; response: string | null; reviewId: string | null;
}
/** Status is projected from the same immutable review history used for feedback and approvals. */
export function annotationViews(proposal: RefinementProposalRow | undefined, reviews: RefinementReviewRow[]): AnnotationView[] {
  if (!proposal) return [];
  return (proposal.proposal_json.annotations || []).map(annotation => {
    const review = [...reviews].reverse().find(row => row.kind === 'annotation' && row.payload.proposalId === proposal.id && row.payload.annotationId === annotation.id);
    return { annotation, proposalId: proposal.id, requestId: proposal.request_id, status: (review?.payload.status as AnnotationStatus) || 'open', response: (review?.payload.response as string | null) || null, reviewId: review?.id || null };
  });
}
/** Keep carried questions on this round after a save, so their status and failed saves remain editable. */
export function retainedAnnotationViews(current: RefinementProposalRow | undefined, previous: RefinementProposalRow[], reviews: RefinementReviewRow[], roundStartedAt: string): AnnotationView[] {
  const started = Date.parse(roundStartedAt);
  const beforeRound = reviews.filter(review => Date.parse(review.created_at) < started);
  const carried = previous.filter(proposal => proposal.id !== current?.id && proposal.request_id !== current?.request_id
    && Date.parse(proposal.created_at) < started).flatMap(proposal => {
    const original = new Map(annotationViews(proposal, beforeRound).map(view => [view.annotation.id, view.status]));
    return annotationViews(proposal, reviews).filter(view => view.status === 'open' || original.get(view.annotation.id) === 'open');
  });
  return [...annotationViews(current, reviews), ...carried];
}
/** A conservative version anchor; never search a changed document for another matching passage. */
export function annotationReferenceChanged(annotation: RefinementAnnotation, proposalText: string, currentText: string): boolean {
  if (annotation.document !== 'letter' || !annotation.location) return false;
  const normalize = (text: string) => letterToEditableText(letterFromEditableText(text));
  return normalize(proposalText) !== normalize(currentText);
}
export function annotationFeedback(view: AnnotationView): string {
  const a = view.annotation;
  const prefix = `Annotation: ${view.proposalId}/${a.id}\nStatus: ${view.status}\n`;
  if (view.status === 'open') return prefix + `${a.document === 'cv' ? 'CV' : 'Motivation letter'} pending question: ${a.text}\nKeep this question pending until the user resolves or ignores it. It is already retained in the question list; do not duplicate it in new annotations. No answer is approved for use; disregard any earlier answer to this question.`;
  if (view.status !== 'resolved' || !view.response) return prefix + 'Ignore this annotation and all previous feedback associated with it. No answer is approved for use.';
  const location = a.location ? a.document === 'cv' ? ` (${a.location.fieldId})` : ` (original quote: ${a.location.quote})` : '';
  return prefix + `${a.document === 'cv' ? 'CV' : 'Motivation letter'} ${a.type}${location}: ${a.text}\nStatus: ${view.status}${view.response ? `\nUser response: ${view.response}` : ''}`;
}
