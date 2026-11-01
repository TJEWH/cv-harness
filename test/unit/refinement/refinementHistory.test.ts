import assert from 'node:assert/strict';
import test from 'node:test';
import { refinementMatchesScope, refinementRunMetadata, visibleRefinementProposals } from '../../../src/features/refinement/domain/refinementHistory';
import { prepareRefinement, refinementSignature } from '../../../src/features/refinement/applicationRefinement';
import { DEFAULT_LETTER_TEMPLATES } from '../../../src/documents/letter/motivationLetters';
import type { RefinementProposalRow, RefinementRequestRow } from '../../../src/features/refinement/refinementTypes';
import { createTestState } from '../../support/fixtures/cvState';

function fixture() {
  const local = prepareRefinement({ applicationId: crypto.randomUUID(), variantId: 'original', state: createTestState(), setup: { template: DEFAULT_LETTER_TEMPLATES[0], language: 'en', maxWords: 400 }, letterText: 'Frozen letter.', instructions: 'Approved original instructions.', scope: 'cv', feedback: [], parentProposalId: null, opportunity: {}, baselineSignature: refinementSignature('original') });
  const row: RefinementRequestRow = { id: local.request.requestId, application_id: local.request.applicationId, user_id: crypto.randomUUID(), created_at: '2026-10-02T00:00:00Z', request_json: structuredClone(local.request), cv_snapshot: { snapshotId: 'snapshot', revision: 7 } };
  return { local, row };
}
test('history presents saved source versions, template, prompt and instructions', () => {
  const { local, row } = fixture();
  // Older runs retain their recorded prompt version after the generator changes.
  local.promptVersion = 'refinement-v2-2026-10-02';
  local.source = { cv: { name: 'Original', variantId: 'original', baseRevision: 3, hasApplicationEdits: true }, letter: { updatedAt: row.created_at, version: 'saved-letter-version' }, contextCapturedAt: row.created_at };
  const meta = refinementRunMetadata(row, local);
  assert.equal(meta.cvRevision, 3); assert.equal(meta.cvVersion, local.sourceSignatures!.cv);
  assert.equal(meta.letterVersion, 'saved-letter-version'); assert.equal(meta.promptVersion, 'refinement-v2-2026-10-02');
  assert.equal(meta.templateRevision, row.request_json.letter.template.revision);
  assert.equal(meta.instructions, 'Approved original instructions.');
});
test('missing or unrelated local metadata is unknown, with no fallback to current settings', () => {
  const { local, row } = fixture(); delete local.promptVersion; delete local.sourceSignatures;
  const old = refinementRunMetadata(row, local);
  assert.equal(old.cvRevision, 7); assert.equal(old.letterVersion, null); assert.equal(old.cvVersion, null); assert.equal(old.promptVersion, null);
  local.promptVersion = 'current-new-version'; local.request.cv.instructions = 'Different current instructions';
  const mismatch = refinementRunMetadata(row, local);
  assert.equal(mismatch.promptVersion, null); assert.equal(mismatch.instructions, 'Approved original instructions.');
  delete row.cv_snapshot;
  assert.equal(refinementRunMetadata(row).cvRevision, null);
});
test('primary view shows current proposals and an explicitly active historical proposal only', () => {
  const rows = ['current', 'older', 'current', 'oldest'].map((request_id, index) => ({ id: String(index), request_id }) as RefinementProposalRow);
  assert.deepEqual(visibleRefinementProposals(rows, 'current', '').map(row => row.id), ['0', '2']);
  assert.deepEqual(visibleRefinementProposals(rows, 'current', '1').map(row => row.id), ['0', '1', '2']);
  assert.deepEqual(visibleRefinementProposals(rows, null, '').map(row => row.id), []);
  assert.equal(rows.length, 4, 'older runs are retained for history');
});
test('scope filtering includes shared rounds only while the requested document history remains', () => {
  assert.equal(refinementMatchesScope('cv', 'cv'), true);
  assert.equal(refinementMatchesScope('letter', 'cv'), false);
  assert.equal(refinementMatchesScope('both', 'cv'), true);
  assert.equal(refinementMatchesScope('cv', 'letter'), false);
  assert.equal(refinementMatchesScope('letter', 'letter'), true);
  assert.equal(refinementMatchesScope('both', 'letter'), true);
  assert.equal(refinementMatchesScope('both', 'cv', ['cv']), false);
  assert.equal(refinementMatchesScope('both', 'letter', ['cv']), true);
  assert.equal(refinementMatchesScope('both', 'both', ['cv']), true);
  assert.equal(refinementMatchesScope('both', 'both', ['cv', 'letter']), false);
  assert.equal(refinementMatchesScope('cv', 'both', ['cv']), false);
  assert.equal(refinementMatchesScope('letter', 'both'), true);
});
