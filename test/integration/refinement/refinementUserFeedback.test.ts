import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefinementRepository, refinementSignature } from '../../../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from '../../support/fixtures/refinement';
import { account, applicationId, documents, idle, mount, prepare, type Workspace } from '../../support/workflows/refinement';

type Scope = 'cv' | 'letter';
type Notes = { tone: string; structure: string; content: string };
type FeedbackWorkspace = Workspace & {
  shortInstructionError: string;
  iterationNotes: Record<Scope, Notes>;
  iterationFeedbackSubmission: Record<Scope, { id: string; text: string; requestId: string | null } | null>;
};
const withFeedback = (setup: Workspace) => setup as FeedbackWorkspace;
const emptyNotes = (): Notes => ({ tone: '', structure: '', content: '' });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const documentVersion = (setup: Workspace) => refinementSignature(JSON.parse(documents(setup)));
const noteReviews = (fixture: ReturnType<typeof mount>) => fixture.database.application_refinement_reviews
  .filter(row => row.kind === 'feedback' && !(row.payload as { annotation?: unknown }).annotation);

test('next-iteration notes persist separately for CV and letter without changing either document', async t => {
  const fixture = mount(t); let setup = withFeedback(await prepare(fixture, 'base', { scope: 'letter' }));
  const before = documentVersion(setup);
  const cvNotes = { tone: 'Use direct CV bullets.', structure: 'Move methods before projects.', content: 'Emphasize reproducibility.' };
  const letterNotes = { tone: 'Use a warmer opening.', structure: 'Connect the middle paragraphs.', content: 'Explain the research question.' };
  Object.assign(setup.iterationNotes.cv, cvNotes);
  Object.assign(setup.iterationNotes.letter, letterNotes);
  await idle(setup);
  assert.equal(documentVersion(setup), before);
  assert.equal(noteReviews(fixture).length, 0, 'typing notes does not publish them');

  setup = withFeedback(fixture.reopen()); await idle(setup);

  assert.deepEqual(setup.iterationNotes.cv, cvNotes);
  assert.deepEqual(setup.iterationNotes.letter, letterNotes);
  assert.equal(documentVersion(setup), before);
  setup.feedbackScope = 'cv'; await idle(setup);
  assert.deepEqual(setup.iterationNotes.cv, cvNotes);
  setup.feedbackScope = 'letter'; await idle(setup);
  assert.deepEqual(setup.iterationNotes.letter, letterNotes);
});

test('selected notes are privacy-filtered and published alongside resolved answers and pending questions', async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  const setup = withFeedback(await prepare(fixture, 'base', { scope: 'letter' }));
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Applied letter with evidence.' });
  await setup.syncRefinement();
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'The research interest is reproducible sensing experiments.', null), true);
  const before = documentVersion(setup);
  const otherDraft = { tone: 'CV-only tone request.', structure: '', content: '' };
  Object.assign(setup.iterationNotes.cv, otherDraft);
  Object.assign(setup.iterationNotes.letter, {
    tone: "Use E2E Omit Lab's measured voice.",
    structure: 'Lead with methods, then outcomes.',
    content: 'Include work with E2E North Lab; contact rowan@example.invalid only if relevant.',
  });
  await idle(setup);
  const draft = clone(setup.iterationNotes.letter);

  await setup.copyIterationTask();

  assert.equal(setup.error, '');
  const reviews = noteReviews(fixture);
  assert.equal(reviews.length, 1);
  const payload = reviews[0].payload as { scope: string; text: string };
  assert.equal(payload.scope, 'letter');
  assert.match(payload.text, /Tone[\s\S]*measured voice/);
  assert.match(payload.text, /Structure[\s\S]*Lead with methods, then outcomes/);
  assert.match(payload.text, /Content[\s\S]*Include work/);
  assert.doesNotMatch(payload.text, /E2E Omit Lab|E2E North Lab|rowan@example\.invalid|CV-only/);
  assert.match(payload.text, /\{\{APPLICANT_NAME\}\}/);
  assert.match(payload.text, /\{\{APPLICANT_EMAIL\}\}/);
  const request = setup.requests[0].request_json;
  assert.equal(request.feedback.length, 3, 'Resolved answers, pending questions and direct refinement requests are all included');
  assert.ok(request.feedback.some(item => item.id === reviews[0].id && item.text === payload.text));
  const resolved = request.feedback.find(item => item.annotation?.annotationId === 'annotation-2');
  assert.ok(resolved, 'The saved answer accompanies the direct notes');
  assert.equal(resolved.annotation?.proposalId, proposal.id);
  assert.match(resolved.text, /Status: resolved.*User response: The research interest is reproducible sensing experiments/s);
  const pending = request.feedback.find(item => item.annotation?.annotationId === 'annotation-1');
  assert.ok(pending, 'The unanswered question accompanies the direct notes');
  assert.deepEqual(pending.annotation, { proposalId: proposal.id, annotationId: 'annotation-1', reviewId: null });
  assert.match(pending.text, /Status: open.*No answer is approved/s);
  assert.ok(request.feedback.every(item => item.scope === 'letter'));
  assert.doesNotMatch(JSON.stringify(request.feedback), /E2E Omit Lab|E2E North Lab|rowan@example\.invalid|CV-only/);
  assert.deepEqual(setup.iterationNotes.letter, draft);
  assert.deepEqual(setup.iterationNotes.cv, otherDraft);
  assert.equal(documentVersion(setup), before);
  const requestId = request.requestId;
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(noteReviews(fixture).length, 1);
  assert.equal(setup.requests[0].id, requestId, 'repeated copying reuses the published round');
});

test('a lost feedback-save acknowledgement retains the draft and retries its receipt after reload without duplicates', async t => {
  const fixture = mount(t); let setup = withFeedback(await prepare(fixture, 'base', { scope: 'letter' }));
  const draft = { tone: 'Use a restrained tone.', structure: '', content: 'Keep the measured result.' };
  Object.assign(setup.iterationNotes.letter, draft); await idle(setup);
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  const attempts: string[] = [];
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'save_refinement_review' && args.p_kind === 'feedback' && !(args.p_payload as { annotation?: unknown }).annotation) {
      attempts.push(String(args.p_id));
      const saved = await rpc(name, args);
      if (attempts.length === 1) return { data: null, error: new Error('Feedback acknowledgement lost') };
      return saved;
    }
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.copyIterationTask();

  assert.match(setup.error, /Feedback acknowledgement lost/);
  assert.deepEqual(setup.iterationNotes.letter, draft);
  assert.equal(noteReviews(fixture).length, 1, 'the server saved the review before its acknowledgement was lost');
  const receipt = clone(setup.iterationFeedbackSubmission.letter);
  assert.ok(receipt?.id);
  assert.equal(receipt.id, attempts[0]);
  setup = withFeedback(fixture.reopen()); await idle(setup);
  assert.deepEqual(setup.iterationNotes.letter, draft);
  assert.deepEqual(setup.iterationFeedbackSubmission.letter, receipt);

  await setup.copyIterationTask();

  assert.equal(setup.error, '');
  assert.equal(noteReviews(fixture).length, 1);
  assert.equal(new Set(attempts).size, 1, 'all save attempts retain the same review UUID');
  assert.equal(setup.requests[0].request_json.feedback.filter(item => item.id === receipt.id).length, 1);
  assert.deepEqual(setup.iterationNotes.letter, draft);
});

test('failed request publication preserves notes and retries the same pending request after reload', async t => {
  const fixture = mount(t); let setup = withFeedback(await prepare(fixture, 'base', { scope: 'cv' }));
  const draft = { tone: '', structure: 'Group related methods.', content: 'Keep the results quantified.' };
  Object.assign(setup.iterationNotes.cv, draft); await idle(setup);
  const before = documentVersion(setup), rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let failPublication = true;
  const attempts: string[] = [];
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'publish_refinement_request') {
      attempts.push((args.p_request as { requestId: string }).requestId);
      if (failPublication) return { data: null, error: new Error('Request publication unavailable') };
    }
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.copyIterationTask();

  assert.match(setup.error, /Request publication unavailable/);
  assert.deepEqual(setup.iterationNotes.cv, draft);
  assert.equal(noteReviews(fixture).length, 1);
  const reviewId = noteReviews(fixture)[0].id;
  setup = withFeedback(fixture.reopen()); await idle(setup);
  assert.deepEqual(setup.iterationNotes.cv, draft);
  failPublication = false;

  await setup.copyIterationTask();

  assert.equal(setup.error, '');
  assert.equal(noteReviews(fixture).length, 1);
  assert.equal(new Set(attempts).size, 1, 'the failed immutable request is reused after reload');
  assert.equal(setup.requests[0].request_json.scope, 'cv');
  assert.equal(setup.requests[0].request_json.feedback.filter(item => item.id === reviewId).length, 1);
  assert.deepEqual(setup.iterationNotes.cv, draft);
  assert.equal(documentVersion(setup), before);
});

for (const originalScope of ['letter'] as const) test(`notes retry after remote clearing of a ${originalScope} request keeps the draft and renews its feedback receipt`, async t => {
  const fixture = mount(t), setup = withFeedback(await prepare(fixture, 'base', { scope: originalScope }));
  setup.feedbackScope = 'letter';
  const originalId = setup.requests[0].id;
  const draft = { tone: 'Use a measured tone.', structure: '', content: 'Retain the evidence.' };
  Object.assign(setup.iterationNotes.letter, draft);
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let failPublication = true;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => name === 'publish_refinement_request' && failPublication
    ? { data: null, error: new Error('Request publication unavailable') } : rpc(name, args)) as unknown as typeof fixture.cloud.client.rpc;

  await setup.copyIterationTask();

  assert.match(setup.error, /Request publication unavailable/);
  const oldSubmission = clone(setup.iterationFeedbackSubmission.letter);
  assert.equal(oldSubmission!.requestId, originalId);
  await createRefinementRepository(fixture.cloud.client, () => account).clearHistory(applicationId, setup.cloudState!.revision, 'letter');
  assert.equal(fixture.database.application_refinement_requests.some(row => row.id === originalId), false);
  assert.deepEqual(setup.iterationNotes.letter, draft);
  failPublication = false;

  // Detect cleared cloud history on Copy without a separate Sync action.
  await setup.copyIterationTask();

  assert.equal(setup.error, '');
  const reviews = noteReviews(fixture);
  assert.equal(reviews.length, 1);
  assert.notEqual(reviews[0].id, oldSubmission!.id);
  assert.equal(reviews[0].request_id, null, 'cleared sources must not be reused for a fresh feedback receipt');
  const request = setup.requests[0].request_json;
  assert.equal(request.scope, 'letter');
  assert.equal(request.feedback.length, 1);
  assert.equal(request.feedback[0].id, reviews[0].id);
  assert.match(request.feedback[0].text, /Use a measured tone/);
  assert.deepEqual(setup.iterationNotes.letter, draft);
});

test('clipboard retry after successful publication neither resubmits notes nor creates another request', async t => {
  const fixture = mount(t), setup = withFeedback(await prepare(fixture, 'base', { scope: 'letter' }));
  setup.iterationNotes.letter.tone = 'Use shorter, calmer sentences.';
  await idle(setup);
  let failCopy = true;
  const copied: string[] = [];
  navigator.clipboard.writeText = async text => { if (failCopy) throw new Error('Clipboard unavailable'); copied.push(text); };
  await setup.copyIterationTask();

  assert.match(setup.shortInstructionError, /Copy unavailable/);
  assert.equal(copied.length, 0);
  assert.equal(setup.iterationNotes.letter.tone, 'Use shorter, calmer sentences.', 'publishing and copying must keep the notes until a proposal arrives');
  assert.equal(noteReviews(fixture).length, 1);
  const requestId = setup.requests[0].id, requestCount = setup.requests.length;
  failCopy = false;
  await setup.copyIterationTask();
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, requestCount);
  assert.equal(setup.requests[0].id, requestId);
  assert.equal(noteReviews(fixture).length, 1);
  assert.equal(copied.length, 2);
  assert.ok(copied.every(text => text.includes(requestId)));
});

test('empty next-iteration notes do not create feedback reviews', async t => {
  const fixture = mount(t), setup = withFeedback(await prepare(fixture, 'base', { scope: 'letter' }));
  Object.assign(setup.iterationNotes.letter, { tone: '  ', structure: '\n', content: '\t' });
  await idle(setup);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(noteReviews(fixture).length, 0);
  assert.equal(setup.requests[0].request_json.feedback.length, 0);
});

for (const scope of ['cv', 'letter'] as const) test(`${scope} notes clear only when a new proposal responding to them is loaded, including after reload`, async t => {
  const fixture = mount(t); let setup = withFeedback(await prepare(fixture, 'base', { scope }));
  const oldRequestId = setup.requests[0].id;
  const otherScope = scope === 'cv' ? 'letter' : 'cv';
  const draft = { tone: 'Use a measured voice.', structure: 'Lead with the method.', content: 'Explain the result.' };
  const otherDraft = { tone: 'Keep this other document draft.', structure: '', content: '' };
  Object.assign(setup.iterationNotes[scope], draft);
  Object.assign(setup.iterationNotes[otherScope], otherDraft);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  const requestId = setup.requests[0].id;
  assert.notEqual(requestId, oldRequestId);
  assert.deepEqual(setup.iterationNotes[scope], draft);

  setup = withFeedback(fixture.reopen()); await idle(setup);
  assert.deepEqual(setup.iterationNotes[scope], draft);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].id, requestId);
  assert.equal(noteReviews(fixture).length, 1, 're-copying after reload must not duplicate the feedback');

  fixture.cloud.seedProposal(oldRequestId, { letterText: 'A delayed response to an older request.' });
  await setup.checkProposals();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.iterationNotes[scope], draft, 'a proposal predating the submitted notes must not clear them');

  fixture.cloud.seedProposal(requestId, { letterText: 'A response to the submitted notes.' });
  setup = withFeedback(fixture.reopen()); await idle(setup);
  assert.equal(setup.error, '');
  assert.deepEqual(setup.iterationNotes[scope], emptyNotes());
  assert.equal(setup.iterationFeedbackSubmission[scope], null);
  assert.deepEqual(setup.iterationNotes[otherScope], otherDraft);

  setup.iterationNotes[scope].content = 'A new, unsent request.';
  await setup.checkProposals();
  assert.equal(setup.iterationNotes[scope].content, 'A new, unsent request.', 'reloading existing proposals must preserve new notes');
});

test('a returned proposal clears unchanged submitted fields and preserves edits made while waiting', async t => {
  const fixture = mount(t), setup = withFeedback(await prepare(fixture, 'base', { scope: 'letter' }));
  Object.assign(setup.iterationNotes.letter, { tone: 'Write more directly.', structure: 'Connect the paragraphs.', content: 'Explain the method.' });
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  const letterRequestId = setup.requests[0].id;
  setup.iterationNotes.letter.content = 'A newer idea for the next iteration.';
  setup.feedbackScope = 'cv'; await setup.publishSources();
  assert.equal(setup.error, '');
  fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.checkProposals();
  assert.equal(setup.iterationNotes.letter.tone, 'Write more directly.', 'a CV response must keep pending letter notes');

  fixture.cloud.seedProposal(letterRequestId, { letterText: 'A refined letter.' });
  await setup.checkProposals();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.iterationNotes.letter, { tone: '', structure: '', content: 'A newer idea for the next iteration.' });
});

test('an invalid returned proposal does not consume submitted notes', async t => {
  const fixture = mount(t), setup = withFeedback(await prepare(fixture, 'base', { scope: 'letter' }));
  setup.iterationNotes.letter.content = 'Explain the experimental evidence.';
  await setup.copyIterationTask();
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id, { persist: false });
  proposal.proposal_json.requestId = 'another-request';
  fixture.database.application_refinement_proposals.unshift(proposal);
  await setup.checkProposals();
  assert.equal(setup.error, 'Invalid refinement proposal.');
  assert.equal(setup.iterationNotes.letter.content, 'Explain the experimental evidence.');
  assert.ok(setup.iterationFeedbackSubmission.letter);
});
