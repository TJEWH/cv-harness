import type { CvAdjustmentRequest, LocalCvAdjustmentRequest } from './cvAdjustmentTypes';
import type { LetterContent, LetterTemplate } from '../../documents/letter/letterTypes';
import type { CvStructure, CvOperation, CvComment, CvStructureBindings } from './cvStructuredTypes';

export type RefinementScope = 'cv' | 'letter';
/** Read-only compatibility for immutable rounds published before document separation. */
export type HistoricalRefinementScope = RefinementScope | 'both';
export interface AnnotationReference { proposalId: string; annotationId: string; reviewId: string | null }
export type AnnotationStatus = 'open' | 'resolved' | 'ignored';
export type RefinementAnnotation = {
  id: string; type: 'comment' | 'todo' | 'question'; text: string;
} & ({ document: 'cv'; location: { fieldId: string } | null }
  | { document: 'letter'; location: { start: number; quote: string } | null });
export interface RefinementFeedback { id: string; text: string; scope: HistoricalRefinementScope; createdAt: string; annotation?: AnnotationReference }
export interface RefinementSetup { template: LetterTemplate; language: string; maxWords: number }
export interface RefinementApprovals { cv: string | null; letter: string | null }
export type PrivacyContextType = 'person' | 'organization' | 'location' | 'link' | 'contact' | 'confidential' | 'other';
/** Public context only; never include the original value, local path or reverse mapping. */
export interface PrivacyLegendEntry { fieldId: string; token: string; type: PrivacyContextType; description: string }
/** Locally approved context keyed by an exact private source fingerprint, never by token numbering. */
export type ApprovedPrivacyContexts = Record<string, Pick<PrivacyLegendEntry, 'type' | 'description'>>;
export interface RefinementState {
  application_id: string; user_id: string; setup_json: RefinementSetup;
  approvals_json: RefinementApprovals; current_cv_request_id: string | null; current_letter_request_id: string | null; revision: number; updated_at: string;
}
interface RefinementRequestBase {
  requestId: string; applicationId: string;
  cv: CvAdjustmentRequest; letter: RefinementSetup & { text: string };
  scope: HistoricalRefinementScope; feedback: RefinementFeedback[]; parentProposalId: string | null;
  privacyLegend?: PrivacyLegendEntry[];
}
export interface RefinementRequestV2 extends RefinementRequestBase { schemaVersion: 2; cvStructure: CvStructure }
export type RefinementRequest = RefinementRequestV2;
export interface RefinementProposalV2 {
  schemaVersion: 2; requestId: string; summary: string;
  cvOperations: CvOperation[]; cvComments: CvComment[]; letterText: string;
  /** Optional extension: older v2 proposals remain readable without annotations. */
  annotations?: RefinementAnnotation[];
}
export type RefinementProposal = RefinementProposalV2;
export interface RefinementRequestRow {
  id: string; application_id: string; user_id: string; request_json: RefinementRequest; created_at: string;
  cv_snapshot?: { snapshotId?: string; revision?: number };
  /** A shared legacy round can be cleared for one document while retaining the other. */
  cleared_scopes?: ('cv' | 'letter')[];
}
export interface RefinementProposalRow {
  id: string; application_id: string; user_id: string; request_id: string;
  proposal_json: RefinementProposal; created_at: string;
}
export interface RefinementReviewRow {
  id: string; application_id: string; user_id: string; request_id: string | null;
  kind: 'feedback' | 'approve_cv' | 'approve_letter' | 'reopen_cv' | 'reopen_letter' | 'cv_decisions' | 'annotation';
  payload: Record<string, unknown>; created_at: string;
  cleared_scopes?: ('cv' | 'letter')[];
}
/** Full baseline and reconstruction bindings never cross the upload boundary. */
export interface LocalRefinementRequest {
  request: RefinementRequest; cv: LocalCvAdjustmentRequest; baselineSignature: string;
  /** New snapshots hash only the target document. Older snapshots require their original full hash. */
  baselineScope?: RefinementScope;
  structureBindings?: CvStructureBindings;
  /** Exact local letter source, including private wording; never upload or infer from request.letter. */
  letterBaseline?: { text: string; setup: RefinementSetup; content?: LetterContent };
  /** Integrity of the frozen local originals, independently of the current application version. */
  sourceSignatures?: { cv: string; letter: string };
  /** Local idempotency receipts for explicit acceptance; never part of request_json. */
  acceptances?: { key: string; proposalId: string; variantId: string | null; acceptedAt: string; reviewId: string }[];
  /** Private selection frozen for this round; applied only after a matching proposal arrives. */
  pendingCvSelection?: { requestId: string; proposalId: string; selectedIds: string[]; workingRevision: string; applied?: boolean };
  appliedCvSelection?: { proposalId: string; selectedIds: string[]; nextRequestId: string };
  /** Optional local provenance for the frozen source; never part of request_json. */
  source?: {
    cv: { name: string; variantId: string; baseRevision: number; hasApplicationEdits: boolean };
    letter: { updatedAt: string; version: string };
    contextCapturedAt: string;
  };
  /** Actual prompt implementation recorded for this request; older sources remain unknown. */
  promptVersion?: string;
  publishedAt?: string;
}
