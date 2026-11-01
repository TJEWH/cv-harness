import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareRefinement, parseRefinementProposal, applyRefinementProposal, refinementSignature, buildRefinementPrompt } from '../../../src/features/refinement/applicationRefinement';
import { QUESTION_GROUPS, questionPresentation, annotationReferenceChanged, annotationViews, validAnnotationReference, validateAnnotationReview } from '../../../src/features/refinement/domain/refinementAnnotations';
import { DEFAULT_LETTER_TEMPLATES } from '../../../src/documents/letter/motivationLetters';
import { createTestState } from '../../support/fixtures/cvState';
import type { RefinementAnnotation, RefinementProposalRow, RefinementProposalV2, RefinementReviewRow } from '../../../src/features/refinement/refinementTypes';
const appId = crypto.randomUUID(), proposalId = crypto.randomUUID();
const state = createTestState({ about: { text: 'Research experience with reproducible experiments.' } });
function fixture() {
  const local = prepareRefinement({ applicationId: appId, state, variantId: 'base', setup: { template: DEFAULT_LETTER_TEMPLATES[0], language: 'en', maxWords: 400 }, letterText: 'Saved letter.', opportunity: {}, scope: 'letter', feedback: [], parentProposalId: null, baselineSignature: refinementSignature(state) });
  const annotations: RefinementAnnotation[] = [
    { id: 'annotation-1', type: 'question', document: 'cv', location: { fieldId: local.request.cv.fields[0].id }, text: 'Which methods did you use?' },
    { id: 'annotation-2', type: 'todo', document: 'letter', location: { start: 2, quote: 'Proposed letter.' }, text: 'Confirm this research interest.' },
    { id: 'annotation-3', type: 'comment', document: 'letter', location: null, text: 'Consider adding a specific example if documented.' },
  ];
  const proposal: RefinementProposalV2 = { schemaVersion: 2, requestId: local.request.requestId, summary: 'Summary remains ordinary prose.', cvOperations: [], cvComments: [], letterText: '😀 Proposed letter.', annotations };
  const row: RefinementProposalRow = { id: proposalId, application_id: appId, user_id: crypto.randomUUID(), request_id: local.request.requestId, proposal_json: proposal, created_at: new Date().toISOString() };
  return { local, proposal, row };
}
test('structured annotations validate without altering CV or letter document content', () => {
  const { local, proposal } = fixture();
  assert.deepEqual(parseRefinementProposal(proposal, local.request), proposal);
  const result = applyRefinementProposal(local, proposal, state, local.baselineSignature);
  assert.deepEqual(result.state, state); assert.equal(result.letterText, proposal.letterText);
  assert.ok(!result.letterText.includes('Confirm this'));
  const prompt = buildRefinementPrompt(local.request, 'fixture');
  assert.match(prompt, /Annotations are separate review material, never document text/);
  assert.match(prompt, /only the latest ordered entry applies/);
  assert.match(prompt, /ignored status.*ignore that annotation and every earlier answer/);
  assert.match(prompt, /An open status means the question is still pending/);
  assert.match(prompt, /do not repeat them in new annotations/);
});
test('unknown targets, non-exact references, duplicate IDs, embedded state and invalid annotations are rejected', () => {
  const { local, proposal } = fixture();
  const cv = proposal.annotations![0], letter = proposal.annotations![1];
  for (const annotations of [null, {}, [cv, cv], [{ ...cv, id: 'unknown' }], [{ ...cv, type: 'replacement' }], [{ ...cv, type: ['question'] }], [{ ...cv, document: 'both' }], [{ ...cv, document: ['letter'] }], [{ ...cv, status: 'resolved' }], [{ ...cv, response: 'injected' }], [{ ...cv, text: '' }], [{ ...cv, text: '😀'.repeat(2001) }], [{ ...cv, location: { fieldId: 'field-9999' } }], [{ ...letter, location: { start: 3, quote: 'Proposed letter.' } }], [{ ...letter, location: { start: -1, quote: 'Proposed letter.' } }], [{ ...letter, location: { start: 2, quote: 'Different text.' } }], [{ ...letter, location: { start: 2, quote: 'Proposed letter.', other: true } }]]) {
    assert.throws(() => parseRefinementProposal({ ...proposal, annotations }, local.request), /annotation/i);
  }
});
test('letter references remain bound to the original proposed version and never seek another matching passage', () => {
  const { proposal } = fixture(); const a = proposal.annotations![1];
  assert.equal(annotationReferenceChanged(a, proposal.letterText, proposal.letterText), false);
  assert.equal(annotationReferenceChanged(a, proposal.letterText, 'Manually edited. Proposed letter.'), true);
  assert.equal(annotationReferenceChanged(a, proposal.letterText, '😀 Changed letter. Proposed letter.'), true);
  assert.equal(annotationReferenceChanged(proposal.annotations![2], proposal.letterText, 'New letter'), false);
  assert.equal(annotationReferenceChanged(proposal.annotations![0], proposal.letterText, 'New letter'), false);
});
test('mapping a returned subject to its field does not invalidate an unchanged letter annotation', () => {
  const { proposal } = fixture();
  const body = 'Dear Committee,\n\nProposed letter.';
  for (const heading of ['Application for a PhD', 'Subject: Application for a PhD', '**Subject:** Application for a PhD']) {
    const incoming = `${heading}\n\n${body}`;
    const annotation: RefinementAnnotation = { ...proposal.annotations![1], document: 'letter', location: { start: [...incoming].length - 'Proposed letter.'.length, quote: 'Proposed letter.' } };
    assert.equal(annotationReferenceChanged(annotation, incoming, `# Application for a PhD\n\n${body}`), false);
    assert.equal(annotationReferenceChanged(annotation, incoming, `# Another position\n\n${body}`), true);
  }
});
test('annotation status and response are projected only from explicitly referenced reviews', () => {
  const { row } = fixture(); const annotation = annotationViews(row, []);
  assert.equal(annotation[0].status, 'open'); assert.equal(annotation[0].response, null);
  const review: RefinementReviewRow = { id: crypto.randomUUID(), application_id: appId, user_id: row.user_id, request_id: row.request_id, kind: 'annotation', payload: { proposalId, annotationId: 'annotation-1', status: 'resolved', response: 'Controlled laboratory experiments.', previousReviewId: null }, created_at: new Date().toISOString() };
  const result = annotationViews(row, [review]);
  assert.equal(result[0].status, 'resolved'); assert.equal(result[0].reviewId, review.id); assert.equal(result[1].status, 'open');
  assert.equal(annotationViews(row, [{ ...review, payload: { ...review.payload, proposalId: crypto.randomUUID() } }])[0].status, 'open');
  assert.deepEqual(annotationViews({ ...row, proposal_json: { ...row.proposal_json, annotations: undefined } as RefinementProposalV2 }, []), []);
});
test('annotation references and review payloads are strict, with optional private-filtered response', () => {
  const payload = { proposalId, annotationId: 'annotation-1', status: 'resolved', response: 'Confirmed evidence.', previousReviewId: null };
  validateAnnotationReview(payload);
  validateAnnotationReview({ ...payload, response: null });
  for (const invalid of [{ ...payload, status: 'accepted' }, { ...payload, status: ['open'] }, { ...payload, response: '' }, { ...payload, response: '😀'.repeat(6001) }, { ...payload, previousReviewId: 'not-uuid' }, { ...payload, text: 'extra' }]) assert.throws(() => validateAnnotationReview(invalid), /annotation/);
  assert.equal(validAnnotationReference({ proposalId, annotationId: 'annotation-1', reviewId: null }), true);
  assert.equal(validAnnotationReference({ proposalId, annotationId: 'annotation-1' }), false);
});


test('new prompts request only categorized questions while legacy annotations remain readable', () => {
  const { local, proposal } = fixture();
  const prompt = buildRefinementPrompt(local.request, 'fixture');
  assert.match(prompt, /Create only question annotations/);
  assert.match(prompt, /Return cvComments: \[\]/);
  for (const group of QUESTION_GROUPS) {
    assert.ok(prompt.includes(`[${group}]`));
    const question = `[${group}] Which documented evidence supports this?`;
    assert.deepEqual(questionPresentation(question), { group, text: 'Which documented evidence supports this?' });
    const parsed = parseRefinementProposal({ ...proposal, annotations: [{ ...proposal.annotations![0], text: question }] }, local.request);
    assert.equal(parsed.annotations![0].text, question, 'category tagging must preserve the existing wire contract');
  }
  assert.deepEqual(parseRefinementProposal(proposal, local.request).annotations, proposal.annotations);
  assert.deepEqual(questionPresentation('Existing comment without a category.'), { group: 'other', text: 'Existing comment without a category.' });
  assert.deepEqual(questionPresentation('[unrecognized] Preserve the wording.'), { group: 'other', text: '[unrecognized] Preserve the wording.' });
});
