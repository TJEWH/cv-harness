import assert from 'node:assert/strict';
import test from 'node:test';
import type { RefinementProposalV2 } from '../src/features/refinement/refinementTypes';
import { createPrivateRefinementCv } from './refinementFixture';
import { documents, idle, mount, prepare } from './refinementWorkflowHarness';

const question = 'The opportunity lists robot calibration as beneficial, but the CV does not document it. Have you calibrated a robot? If so, describe one example; otherwise, would learning it support your research interests?';
const response = 'I calibrated a research robot at E2E North Lab and recorded its repeatability.';

test('connected resolved contextual question automatically feeds a fresh privacy-safe request without changing documents', async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.letter!.templateSnapshot!.useMetaSearchInterests = false;
  setup.letter!.templateSnapshot!.researchInterests = 'Reliable robot sensing and reproducible calibration, inspired by E2E North Lab.';
  setup.letter!.templateSnapshot!.questionGuidance = 'Ask about undocumented robot calibration experience when a required or beneficial qualification is relevant to the letter.';
  setup.letter!.templateSnapshot!.refinementSystemPrompt = 'Evaluate whether answers from E2E North Lab support the research narrative; ask a focused follow-up when a detail is missing.';
  await setup.publishSources(); assert.equal(setup.error, '');
  const source = setup.requests[0];
  assert.match(source.request_json.letter.template.researchInterests!, /Reliable robot sensing/);
  assert.doesNotMatch(JSON.stringify(source.request_json), /E2E North Lab/);
  assert.match(source.request_json.letter.template.questionGuidance!, /undocumented robot calibration/);
  assert.match(source.request_json.letter.template.refinementSystemPrompt!, /support the research narrative; ask a focused follow-up/);
  const incoming = fixture.cloud.seedProposal(source.id, { letterText: 'A proposed motivation letter based on documented evidence.' });
  const payload = incoming.proposal_json as RefinementProposalV2;
  payload.annotations = [{ id: 'annotation-1', type: 'question', document: 'letter', location: null, text: question }];
  fixture.database.application_refinement_proposals[0].proposal_json = payload;
  await setup.checkProposals();
  await setup.syncRefinement(); await idle(setup); assert.equal(setup.error, '');
  assert.equal(setup.letter!.working.body, 'A proposed motivation letter based on documented evidence.');
  const before = documents(setup), previewBefore = JSON.stringify(setup.previewLetterContent), savedCloud = JSON.stringify(fixture.database);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', response, null), true);
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.match(setup.proposalAnnotations[0].response!, /calibrated a research robot/);
  assert.doesNotMatch(setup.proposalAnnotations[0].response!, /E2E North Lab/);
  assert.equal(setup.feedbackHistory().length, 1, 'resolving saves and includes the answer automatically');
  assert.notEqual(JSON.stringify(fixture.database), savedCloud, 'resolved answers create a saved feedback receipt');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
  assert.equal(JSON.stringify(setup.previewLetterContent), previewBefore);
  await setup.includeAnnotationFeedback('annotation-1'); await setup.includeAnnotationFeedback('annotation-1');
  assert.equal(setup.error, '');
  assert.equal(setup.feedbackHistory().length, 1);
  const shared = setup.feedbackHistory()[0];
  assert.match(shared.text, /robot calibration as beneficial/);
  assert.match(shared.text, /User response: I calibrated a research robot/);
  assert.doesNotMatch(shared.text, /E2E North Lab/);
  assert.ok(shared.annotation, 'connected answers retain their verified proposal and review references');
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'feedback').length, 1);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(setup.proposalAnnotations[0].included, true);
  assert.equal(setup.feedbackHistory().length, 1, 'refresh and reload do not duplicate saved feedback');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
  setup.discardReview(); await setup.publishSources();
  assert.equal(setup.error, '');
  const next = setup.requests[0].request_json;
  assert.notEqual(next.requestId, source.id);
  assert.deepEqual(JSON.parse(JSON.stringify(next.feedback)), [shared]);
  assert.equal(next.letter.template.researchInterests, source.request_json.letter.template.researchInterests);
  assert.equal(next.letter.template.questionGuidance, source.request_json.letter.template.questionGuidance);
  assert.equal(next.letter.template.refinementSystemPrompt, source.request_json.letter.template.refinementSystemPrompt);
  assert.doesNotMatch(JSON.stringify(next), /E2E North Lab|E2E South Lab|E2E Omit Lab|structureBindings|baselineState/);
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});

test('connected feedback failure retries the saved answer without duplicates', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  await setup.syncRefinement(); await idle(setup); assert.equal(setup.error, '');
  const before = documents(setup), rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let fail = true;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'save_refinement_review' && args.p_kind === 'feedback' && fail) { fail = false; return { data: null, error: new Error('Feedback unavailable') }; }
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', null), false);
  assert.match(setup.error, /Feedback unavailable/);
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(setup.proposalAnnotations[0].included, false);
  setup = fixture.reopen(); await idle(setup);
  const reference = setup.proposalAnnotations[0].reviewId;
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', reference), true);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', reference), true);
  assert.equal(setup.feedbackHistory().length, 1);
  assert.equal(setup.proposalAnnotations[0].included, true);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Correction: I observed the calibration, but did not perform it.', reference), true);
  assert.equal(setup.feedbackHistory().length, 2);
  assert.match(setup.feedbackHistory()[1].text, /Correction: I observed/);
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});

for (const previouslyResolved of [false, true]) test(`ignored comments ${previouslyResolved ? 'cancel their earlier feedback' : 'never enter feedback'}`, async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.syncRefinement(); await idle(setup); assert.equal(setup.error, '');
  const before = documents(setup), request = setup.requests[0];
  if (previouslyResolved) assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Earlier response that must be ignored.', null), true);
  const reviewId = setup.proposalAnnotations[0].reviewId;
  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', 'Earlier response that must be ignored.', reviewId), true);
  assert.equal(setup.proposalAnnotations[0].included, false);
  assert.equal(setup.feedbackHistory().length, previouslyResolved ? 2 : 0);
  if (previouslyResolved) {
    assert.match(setup.feedbackHistory().at(-1)!.text, /Status: ignored.*Ignore this annotation/s);
    assert.doesNotMatch(setup.feedbackHistory().at(-1)!.text, /Earlier response/);
  }
  setup = fixture.reopen(); await idle(setup); setup.discardReview(); await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'ignored');
  const nextFeedback = setup.requests[0].request_json.feedback;
  assert.equal(nextFeedback.filter(item => item.text.startsWith(`Annotation: ${setup.proposals[0].id}/annotation-1\n`)).length, previouslyResolved ? 2 : 0);
  assert.ok(nextFeedback.some(item => item.annotation?.annotationId === 'annotation-2' && /Status: open/.test(item.text)), 'the separate unanswered question carries forward');
  assert.equal(request.request_json.feedback.length, 0, 'older published requests remain immutable');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});

test('clearing a resolved answer to open cancels the earlier feedback without rewriting its history', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  const originalRequest = JSON.parse(JSON.stringify(setup.requests[0]));
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.syncRefinement(); await idle(setup);
  const before = documents(setup);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Calibration answer to withdraw.', null), true);
  const originalFeedback = JSON.parse(JSON.stringify(setup.feedbackHistory()[0]));
  const resolvedReviewId = setup.proposalAnnotations[0].reviewId;

  assert.equal(await setup.saveAnnotation('annotation-1', 'open', '   ', resolvedReviewId), true);

  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'open');
  assert.equal(setup.proposalAnnotations[0].response, null);
  assert.equal(setup.proposalAnnotations[0].included, false);
  assert.notEqual(setup.proposalAnnotations[0].reviewId, resolvedReviewId);
  const history = setup.feedbackHistory();
  assert.equal(history.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(history[0])), originalFeedback);
  assert.match(history[1].text, /Status: open.*Keep this question pending.*disregard any earlier answer/s);
  assert.doesNotMatch(history[1].text, /Calibration answer to withdraw/);
  assert.equal(history[1].annotation?.reviewId, setup.proposalAnnotations[0].reviewId, 'the pending reference identifies the reopened question without approving an answer');
  assert.deepEqual(JSON.parse(JSON.stringify(setup.requests[0])), originalRequest);
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));

  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.proposalAnnotations[0].status, 'open');
  assert.equal(setup.proposalAnnotations[0].response, null);
  assert.equal(setup.feedbackHistory().length, 2);
  setup.discardReview(); await setup.publishSources();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.requests[0].request_json.feedback.slice(0, 2), history, 'the next round receives the reopened question after the historical answer');
});

for (const previouslyResolved of [false, true]) test(`editing an ignored answer stays excluded ${previouslyResolved ? 'after cancelling an earlier answer' : 'without any earlier feedback'}`, async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.syncRefinement(); await idle(setup);
  const before = documents(setup);
  if (previouslyResolved) assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Previously included answer.', null), true);
  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', 'Retained ignored answer.', setup.proposalAnnotations[0].reviewId), true);
  const ignoredReviewId = setup.proposalAnnotations[0].reviewId;
  const feedbackBeforeEdit = setup.feedbackHistory().length;
  const updatedAnswer = 'Edited ignored answer that must not become refinement feedback.';

  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', updatedAnswer, ignoredReviewId), true);

  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'ignored');
  assert.equal(setup.proposalAnnotations[0].response, updatedAnswer);
  assert.equal(setup.proposalAnnotations[0].included, false);
  assert.notEqual(setup.proposalAnnotations[0].reviewId, ignoredReviewId);
  assert.equal(setup.feedbackHistory().length, feedbackBeforeEdit + (previouslyResolved ? 1 : 0));
  assert.doesNotMatch(JSON.stringify(setup.feedbackHistory()), /Edited ignored answer/);
  if (previouslyResolved) {
    assert.match(setup.feedbackHistory().at(-1)!.text, /Status: ignored.*Ignore this annotation/s);
    assert.equal(setup.feedbackHistory().at(-1)!.annotation, undefined);
  }
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));

  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.proposalAnnotations[0].status, 'ignored');
  assert.equal(setup.proposalAnnotations[0].response, updatedAnswer);
  setup.discardReview(); await setup.publishSources();
  assert.equal(setup.error, '');
  assert.doesNotMatch(JSON.stringify(setup.requests[0].request_json.feedback), /Edited ignored answer/);
});

test('failed ignore feedback cancellation retries the existing review and cancellation receipt idempotently', async t => {
  const fixture = mount(t); const setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.syncRefinement(); await idle(setup);
  const before = documents(setup), answer = 'The previously included answer is now ignored.';
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', answer, null), true);
  const resolvedReviewId = setup.proposalAnnotations[0].reviewId;
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  const cancellationAttempts: Record<string, unknown>[] = [];
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'save_refinement_review' && args.p_kind === 'feedback') {
      cancellationAttempts.push(JSON.parse(JSON.stringify(args)));
      if (cancellationAttempts.length === 1) return { data: null, error: new Error('Cancellation temporarily unavailable.') };
    }
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;

  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', answer, resolvedReviewId), false);

  assert.match(setup.error, /Cancellation temporarily unavailable/);
  const ignoredReviewId = setup.proposalAnnotations[0].reviewId;
  assert.notEqual(ignoredReviewId, resolvedReviewId);
  assert.equal(setup.proposalAnnotations[0].status, 'ignored');
  assert.equal(setup.proposalAnnotations[0].included, false);
  assert.equal(setup.feedbackHistory().length, 1, 'the failed cancellation has not yet reached shared feedback');
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'annotation').length, 2);

  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', answer, ignoredReviewId), true);
  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', answer, ignoredReviewId), true);

  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].reviewId, ignoredReviewId, 'retry reuses the persisted ignored review');
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'annotation').length, 2);
  assert.equal(cancellationAttempts.length, 2, 'successful retry and further saves do not duplicate cancellation writes');
  assert.deepEqual(cancellationAttempts[1], cancellationAttempts[0], 'uncertain writes retain their exact payload and UUID');
  assert.equal(setup.feedbackHistory().length, 2);
  assert.match(setup.feedbackHistory()[1].text, /Status: ignored.*Ignore this annotation/s);
  assert.doesNotMatch(setup.feedbackHistory()[1].text, /previously included answer is now ignored/);
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});
