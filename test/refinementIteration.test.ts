import { EMPTY_LETTER } from '../src/documents/letter/motivationLetters';
import assert from 'node:assert/strict';
import test from 'node:test';
import { refinementSignature } from '../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from './refinementFixture';
import { documents, idle, seedLegacyRound, mount, prepare } from './refinementWorkflowHarness';

test('initial task copying publishes and copies one immutable request without a separate sync', async t => {
  const fixture = mount(t), setup = fixture.setup;
  await idle(setup); await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.feedbackScope = 'letter'; setup.tab = 'refinement'; await idle(setup);
  assert.equal(setup.showInitialRefinement, true);
  let copied = '';
  navigator.clipboard.writeText = async value => { copied = value; };

  await setup.copyIterationTask();

  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.showInitialRefinement, true, 'publishing the first request still waits for an initial proposal');
  assert.equal(setup.requests[0].request_json.letter.text, '');
  assert.ok(copied.includes(setup.requests[0].id));
  assert.match(copied, /initial motivation-letter draft/);
  await setup.copyIterationTask();
  assert.equal(setup.requests.length, 1, 'copying an unchanged initial task must reuse its request');
});

test('refinement phase follows document history through pending requests, scope changes and reload', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  assert.equal(setup.showInitialRefinement, true);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First letter refinement.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.showInitialRefinement, false, 'the first proposal starts subsequent refinements');

  setup.selectedProposalId = '';
  assert.equal(setup.showInitialRefinement, false, 'deselecting a proposal does not erase earlier refinement');
  setup.feedbackScope = 'cv';
  assert.equal(setup.showInitialRefinement, true, 'letter history does not hide the initial CV refinement');
  setup.feedbackScope = 'letter';
  assert.equal(setup.showInitialRefinement, false);

  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 2);
  assert.equal(setup.proposals.some(row => row.request_id === setup.cloudState!.current_letter_request_id), false);
  assert.equal(setup.showInitialRefinement, false, 'a pending subsequent proposal does not restart initial refinement');
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.selectedProposalId, '', 'the pending request has no current proposal to select after reload');
  assert.equal(setup.showInitialRefinement, false, 'historical proposals still determine the phase after reload');
});

test('legacy combined proposals do not start an active refinement for either document', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' });
  seedLegacyRound(fixture);
  await setup.checkProposals();
  assert.equal(setup.error, '');
  setup.feedbackScope = 'cv';
  assert.equal(setup.showInitialRefinement, true);
  setup.feedbackScope = 'letter';
  assert.equal(setup.showInitialRefinement, true);
});

test('sync automatically applies the latest current letter proposal once and preserves the source snapshot', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const request = setup.requests[0], original = refinementSignature(setup.localRequests[request.id].letterBaseline);
  const cv = refinementSignature(setup.record!.state);
  fixture.cloud.seedProposal(request.id, { letterText: 'First returned draft.' });
  const latest = fixture.cloud.seedProposal(request.id, { letterText: 'Latest returned draft.' });

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(setup.letter!.working.body, 'Latest returned draft.');
  assert.equal(setup.selectedProposalId, latest.id);
  assert.equal(setup.reviewActive, false);
  assert.equal(refinementSignature(setup.record!.state), cv);
  assert.equal(refinementSignature(setup.localRequests[request.id].letterBaseline), original);
  const applied = documents(setup);
  await setup.syncRefinement();
  assert.equal(setup.requests.length, 1, 'Sync must not start the next iteration');
  assert.equal(documents(setup), applied);
  assert.equal(setup.localRequests[request.id].acceptances?.length, 1);
  assert.equal(setup.letter!.revisions.filter(revision => revision.cloudDraftId === latest.id).length, 1);
});

test('pending CV proposals preserve private originals without library writes across sync and reload', async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'cv' });
  setup.tab = 'refinement'; await idle(setup);
  const source = setup.requests[0], original = refinementSignature(setup.localRequests[source.id].cv);
  const letter = refinementSignature(setup.letter);
  fixture.cloud.seedProposal(source.id);

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 0);
  assert.equal(setup.record!.variantId, 'base');
  assert.deepEqual(setup.record!.state, fixture.states.get('base'));
  assert.notDeepEqual(setup.previewCvState, setup.record!.state);
  assert.equal(refinementSignature(setup.localRequests[source.id].cv), original);
  assert.equal(refinementSignature(setup.letter), letter);
  const applied = refinementSignature(setup.record!.state);
  await setup.syncRefinement();
  setup = fixture.reopen(); await idle(setup); await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 0);
  assert.equal(refinementSignature(setup.record!.state), applied);
  assert.equal(setup.requests.length, 1);
});

test('copying the next iteration closes comparison and publishes applied documents with resolved answers', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const first = setup.requests[0];
  const proposal = fixture.cloud.seedProposal(first.id, { letterText: 'Applied letter for the next iteration.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Confirmed research interest in reproducible experiments.', null), true);
  setup.openProposal(); setup.reviewComparison = 'original';
  assert.equal(setup.previewLetterContent?.body, 'Original private working letter.');
  let copied = '';
  navigator.clipboard.writeText = async value => { copied = value; };

  await setup.copyIterationTask();

  assert.equal(setup.error, '');
  assert.equal(setup.reviewActive, false);
  const next = setup.requests[0].request_json;
  assert.notEqual(next.requestId, first.id);
  assert.equal(next.letter.text, 'Applied letter for the next iteration.');
  assert.equal(next.feedback.length, 2, 'The resolved answer and the unanswered question both carry forward');
  const resolved = next.feedback.find(item => item.annotation?.annotationId === 'annotation-2');
  assert.ok(resolved, 'The saved answer remains in feedback');
  assert.equal(resolved.annotation?.proposalId, proposal.id);
  assert.match(resolved.text, /Status: resolved.*User response: Confirmed research interest/s);
  const pending = next.feedback.find(item => item.annotation?.annotationId === 'annotation-1');
  assert.ok(pending, 'The unanswered question remains in feedback');
  assert.deepEqual(pending.annotation, { proposalId: proposal.id, annotationId: 'annotation-1', reviewId: null });
  assert.match(pending.text, /Status: open.*No answer is approved/s);
  assert.ok(copied.includes(next.requestId));
  assert.equal(setup.letter!.working.body, 'Applied letter for the next iteration.');
  await setup.copyIterationTask();
  assert.equal(setup.requests.length, 2);
  assert.equal(setup.requests[0].request_json.requestId, next.requestId, 'Copying unchanged feedback reuses the published request');
});

test('pending CV refinement works when no library source remains', async t => {
  const fixture = mount(t, createPrivateRefinementCv()), setup = await prepare(fixture, 'base', { scope: 'cv' });
  setup.tab = 'refinement'; await idle(setup);
  fixture.cloud.seedProposal(setup.requests[0].id);
  const before = documents(setup);
  fixture.props.configurations = [];
  fixture.states.delete('base');

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(documents(setup), before);
  assert.notDeepEqual(setup.previewCvState, setup.record!.state);
  assert.equal(setup.record!.variantId, 'base');
  assert.equal(fixture.creations.length, 0);
});

test('sync retains historical proposals without applying them to a newer source round', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const originalId = setup.requests[0].id;
  setup.updateLetter('Manually corrected source for a new round.');
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  const currentId = setup.requests[0].id;
  assert.notEqual(currentId, originalId);
  fixture.cloud.seedProposal(originalId, { letterText: 'Late return for a superseded source.' });
  const working = documents(setup);

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].id, currentId);
  assert.equal(setup.proposals.length, 1, 'historical returns must remain available for comparison');
  assert.equal(documents(setup), working);
  assert.equal(setup.localRequests[originalId].acceptances?.length || 0, 0);
});

test('sync never applies a letter proposal while the selected scope is CV', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const letterRequest = setup.requests[0].id, letter = refinementSignature(setup.letter);
  fixture.cloud.seedProposal(letterRequest, { letterText: 'Letter return outside the selected scope.' });
  setup.feedbackScope = 'cv';

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.letter), letter);
  assert.equal(setup.localRequests[letterRequest].acceptances?.length || 0, 0);
  assert.equal(fixture.creations.length, 0);
});

test('clearing letter history retains the current CV and prevents automatic replay after reload', async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'cv', letterText: 'Original complete letter.' });
  setup.tab = 'refinement'; await idle(setup);
  const originalLetter = { ...EMPTY_LETTER };
  const first = setup.requests[0], originalSettings = JSON.parse(JSON.stringify(setup.letter!.templateSnapshot));
  fixture.cloud.seedProposal(first.id); await setup.syncRefinement();
  assert.equal(setup.error, '');
  setup.feedbackScope = 'letter'; await setup.copyIterationTask();
  const second = setup.requests[0];
  fixture.cloud.seedProposal(second.id, { letterText: 'Changed letter retained in revision history.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.showInitialRefinement, false);
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'An answer for the previous iteration.', null), true);
  setup.discardReview(); await setup.approve('letter'); setup.discardReview(); await setup.approve('cv');
  assert.equal(setup.error, '');
  setup.feedbackScope = 'letter';
  const currentCv = refinementSignature(setup.record), cvApproval = setup.approvals.cv;
  const acceptedRevisionIds = setup.letter!.revisions.map(revision => revision.id);

  await setup.clearRefinementHistory();

  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.record), currentCv);
  assert.equal(setup.approvals.cv, cvApproval);
  assert.deepEqual(setup.letter!.working, originalLetter);
  assert.deepEqual(setup.letter!.templateSnapshot, originalSettings);
  assert.equal(setup.letter!.finalRevisionId, null);
  assert.equal(setup.selectedProposalId, '');
  assert.equal(setup.showInitialRefinement, true, 'cleared letter proposals must no longer count as earlier refinement');
  assert.ok(setup.requests.some(row => row.id === first.id && !row.cleared_scopes?.includes('cv')), 'CV history must remain active');
  for (const id of acceptedRevisionIds) assert.ok(setup.letter!.revisions.some(revision => revision.id === id), 'reset must preserve every prior letter revision');
  assert.deepEqual(setup.feedbackHistory(), [], 'cleared letter feedback must not enter the next round');
  setup = fixture.reopen(); await idle(setup); await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.showInitialRefinement, true);
  assert.equal(refinementSignature(setup.record), currentCv);
  assert.deepEqual(setup.letter!.working, originalLetter);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(setup.showInitialRefinement, true, 'the first request after reset still waits for an initial proposal');
  assert.notEqual(setup.requests[0].id, first.id); assert.notEqual(setup.requests[0].id, second.id);
  assert.deepEqual(setup.requests[0].request_json.feedback, []);
  assert.equal(setup.requests[0].request_json.letter.text, '');
});

for (const scope of ['letter'] as const) test(`clearing history returns to an empty template draft after a ${scope} proposal was loaded`, async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope, letterText: '' });
  setup.tab = 'refinement'; await idle(setup);
  const originalLetter = JSON.parse(JSON.stringify(setup.letter!.working));
  const request = setup.requests[0];
  const proposal = fixture.cloud.seedProposal(request.id, { letterText: 'Generated initial letter draft.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.working.body, 'Generated initial letter draft.');
  const currentCv = refinementSignature(setup.record);
  setup.feedbackScope = 'letter';

  await setup.clearRefinementHistory();

  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.record), currentCv);
  assert.deepEqual(setup.letter!.working, originalLetter);
  assert.equal(setup.selectedProposalId, '');
  assert.ok(setup.letter!.revisions.some(revision => revision.cloudDraftId === proposal.id));
  assert.equal(setup.showInitialRefinement, true, 'the old proposal must no longer be active for the letter');
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.notEqual(setup.requests[0].id, request.id);
  assert.equal(setup.requests[0].request_json.letter.text, '');
});

test('clearing CV history without its private snapshot reports the missing source without changing documents', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  setup.localRequests = {};
  const before = documents(setup), cloud = refinementSignature(fixture.database);

  await setup.clearRefinementHistory();

  assert.match(setup.error, /original|snapshot|source/i);
  assert.equal(documents(setup), before);
  assert.equal(refinementSignature(fixture.database), cloud);
});
