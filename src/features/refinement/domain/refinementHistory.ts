import { refinementSignature } from '../applicationRefinement';
import type { LocalRefinementRequest, RefinementProposalRow, RefinementRequestRow, HistoricalRefinementScope } from '../refinementTypes';

export function refinementMatchesScope(requestScope: HistoricalRefinementScope, scope: HistoricalRefinementScope, clearedScopes: readonly Exclude<HistoricalRefinementScope, 'both'>[] = []) {
  return (['cv', 'letter'] as const).some(document => (requestScope === 'both' || requestScope === document)
    && (scope === 'both' || scope === document) && !clearedScopes.includes(document));
}

/** Historical facts come only from the captured request and its matching local receipt. */
export function refinementRunMetadata(row: RefinementRequestRow, local?: LocalRefinementRequest) {
  const source = local?.request.requestId === row.id && local.request.applicationId === row.application_id && refinementSignature(local.request) === refinementSignature(row.request_json) ? local : undefined;
  return {
    requestId: row.id, createdAt: row.created_at, scope: row.request_json.scope,
    cvRevision: source?.source?.cv.baseRevision ?? row.cv_snapshot?.revision ?? null,
    cvVersion: source?.sourceSignatures?.cv ?? null,
    letterVersion: source?.source?.letter.version ?? source?.sourceSignatures?.letter ?? null,
    templateName: row.request_json.letter.template.name,
    templateRevision: row.request_json.letter.template.revision,
    promptVersion: source?.promptVersion ?? null,
    protocolVersion: row.request_json.schemaVersion,
    instructions: row.request_json.cv.instructions,
  };
}
export function visibleRefinementProposals(proposals: RefinementProposalRow[], currentRequestId: string | null, activeId: string) {
  return proposals.filter(row => row.request_id === currentRequestId || row.id === activeId);
}
