import type { LetterContent, LetterTemplate } from '../../../documents/letter/letterTypes';
import type { LocalRefinementRequest, RefinementSetup } from '../refinementTypes';
import { refinementSignature } from '../applicationRefinement';
import { letterToEditableText } from '../../../documents/letter/motivationLetters';

export type RefinementSettingSource = 'application' | 'template';
export interface RefinementSettingOverrides { language?: string | null; maxWords?: number | null }
export interface ResolvedRefinementSettings {
  setup: RefinementSetup;
  provenance: { language: RefinementSettingSource; maxWords: RefinementSettingSource };
}

/** Application overrides take precedence; the interface language is never a document default. */
export function resolveRefinementSettings(template: LetterTemplate, overrides?: RefinementSettingOverrides | null): ResolvedRefinementSettings {
  const applicationLanguage = typeof overrides?.language === 'string' && overrides.language.trim().length > 0;
  const applicationWords = overrides?.maxWords !== undefined && overrides.maxWords !== null;
  return {
    setup: {
      template,
      language: applicationLanguage ? overrides!.language! : template.language,
      // Preserve supplied values, including invalid ones, for validation during publication.
      maxWords: applicationWords ? overrides!.maxWords! : template.maxWords,
    },
    provenance: { language: applicationLanguage ? 'application' : 'template', maxWords: applicationWords ? 'application' : 'template' },
  };
}

/** Local serialization only. Send its text through prepareRefinement before displaying a shared preview or publishing. */
export function serializeRefinementDraft(working?: LetterContent | null): { text: string; empty: boolean } {
  const empty = !working || [working.subject, working.salutation, working.body, working.closing].every(part => part.trim().length === 0);
  return { text: empty ? '' : letterToEditableText(working!), empty };
}

/** Exclude generated request IDs when comparing inputs for immutable-request reuse. */
export function refinementInputsSignature(local: LocalRefinementRequest): string {
  // Captured context from the other document remains immutable while this round is pending.
  if (local.baselineScope === local.request.scope) return refinementSignature({
    applicationId: local.request.applicationId, scope: local.request.scope, baselineSignature: local.baselineSignature,
    feedback: local.request.feedback, parentProposalId: local.request.parentProposalId,
    privacyLegend: local.request.scope === 'cv' ? local.request.privacyLegend : undefined,
    pendingCvSelection: local.pendingCvSelection ? { ...local.pendingCvSelection, applied: undefined } : undefined,
  });
  const { requestId: _requestId, cv, ...request } = local.request;
  const { requestId: _cvRequestId, ...cvRequest } = cv;
  const { requestId: _localCvRequestId, ...localCvRequest } = local.cv.publicRequest;
  return refinementSignature({
    request: { ...request, cv: cvRequest },
    baselineSignature: local.baselineSignature,
    baselineState: local.cv.baselineState,
    sourceVariantId: local.cv.sourceVariantId,
    localCvRequest,
    bindings: local.cv.bindings,
    structureBindings: local.structureBindings,
    letterBaseline: local.letterBaseline,
    sourceSignatures: local.sourceSignatures,
    pendingCvSelection: local.pendingCvSelection ? { ...local.pendingCvSelection, applied: undefined } : undefined,
  });
}

/** A cloud row without the original local privacy baseline cannot prove that the current private documents still match. */
export function sameRefinementInputs(left: LocalRefinementRequest | null | undefined, right: LocalRefinementRequest | null | undefined): boolean {
  const consistentReferences = (local: LocalRefinementRequest) => local.request.requestId === local.request.cv.requestId
    && local.request.requestId === local.cv.publicRequest.requestId;
  return !!left && !!right && consistentReferences(left) && consistentReferences(right)
    && refinementInputsSignature(left) === refinementInputsSignature(right);
}
