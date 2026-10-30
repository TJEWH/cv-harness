import type { CvState } from '../../documents/cv/types';

export interface CvAdjustmentField { id: string; label: string; text: string }
/** The complete upload boundary. Paths, CV identities and reconstruction data stay local. */
export interface CvAdjustmentRequest {
  schemaVersion: 1;
  requestId: string;
  fields: CvAdjustmentField[];
  opportunity: Record<string, unknown>;
  instructions: string;
}
export interface CvAdjustmentResponse {
  schemaVersion: 1;
  requestId: string;
  edits: { fieldId: string; text: string }[];
}
export interface LocalCvAdjustmentRequest {
  sourceVariantId: string;
  baselineState: CvState;
  publicRequest: CvAdjustmentRequest;
  /** Never upload this map or the baselineState. */
  bindings: { fieldId: string; path: (string | number)[]; tokens: Record<string, string> }[];
}
