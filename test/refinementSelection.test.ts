import assert from 'node:assert/strict';
import test from 'node:test';
import { reconstructRefinementProposal, refinementSignature } from '../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from './refinementFixture';
import { idle, mount, prepare, refinementKey, type Workspace } from './refinementWorkflowHarness';

const documents = (setup: Workspace) => refinementSignature([setup.record?.state, setup.letter]);

async function cvRound(t: Parameters<typeof mount>[0]) {
  const fixture = mount(t, createPrivateRefinementCv());
  const setup = await prepare(fixture, 'base', { scope: 'cv' });
  const before = documents(setup);
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(documents(setup), before, 'incoming changes remain a pending selection');
  return { fixture, setup, proposal, before };
}

test('CV activation changes only the preview and persists across sync and reload without accepting', async t => {
  const { fixture, setup, proposal, before } = await cvRound(t);
  const all = [...setup.selectedChangeIds], id = all[0];
  await setup.setCvChangeActive(id, false);
  assert.equal(setup.error, '');
  assert.equal(documents(setup), before);
  assert.deepEqual(setup.previewCvState, reconstructRefinementProposal(setup.localRequests[proposal.request_id], proposal.proposal_json, all.filter(value => value !== id)).state);
  assert.equal(setup.reviews.filter(row => row.kind === 'cv_decisions').length, 0);
  await setup.syncRefinement();
  const reopened = fixture.reopen(); await idle(reopened);
  assert.ok(!reopened.selectedChangeIds.includes(id));
  assert.equal(documents(reopened), before);
  await reopened.setCvChangeActive(id, true);
  assert.equal(reopened.error, '');
  assert.equal(reopened.selectedChangeIds.length, all.length);
  assert.equal(documents(reopened), before);
});

test('typo fixes follow the same preview, selection, next-round application and reload flow', async t => {
  const source = createPrivateRefinementCv(); source.about.text = 'I develop reserach tools.'; source.experience.jobs[0].title = 'Reserach assistant';
  const fixture = mount(t, source);
  const setup = await prepare(fixture, 'base', { scope: 'cv' });
  const request = setup.requests[0];
  const range = request.request_json.cvStructure.ranges.find(item => item.label === 'Profile')!;
  const title = request.request_json.cvStructure.ranges.find(item => item.text === 'Reserach assistant' && item.typoOnly)!;
  const proposal = fixture.cloud.seedProposal(request.id, { persist: false });
  proposal.proposal_json.cvOperations = [{ id: 'change-1', type: 'fix_typos', targetId: range.id,
    text: 'I develop research tools.', explanation: 'Correct the spelling of research.' },
  { id: 'change-2', type: 'fix_typos', targetId: title.id, text: 'Research assistant', explanation: 'Correct the spelling in the job title.' }];
  fixture.database.application_refinement_proposals.push(proposal);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.record!.state.about.text, source.about.text);
  assert.equal(setup.previewCvState!.about.text, 'I develop research tools.');
  assert.equal(setup.previewCvState!.experience.jobs[0].title, 'Research assistant');
  await setup.setCvChangeActive('change-1', false);
  assert.equal(setup.previewCvState!.about.text, source.about.text);
  await setup.setCvChangeActive('change-1', true);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(setup.record!.state.about.text, source.about.text);
  fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.record!.state.about.text, 'I develop research tools.');
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.record!.state.about.text, 'I develop research tools.');
  assert.equal(reopened.record!.state.experience.jobs[0].title, 'Research assistant');
});

test('copy freezes active and inactive choices; only the matching next reply applies them', async t => {
  const { fixture, setup, proposal, before } = await cvRound(t);
  const id = setup.selectedChangeIds[0];
  await setup.setCvChangeActive(id, false);
  const expected = JSON.stringify(setup.previewCvState), selection = [...setup.selectedChangeIds];
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(documents(setup), before, 'copying must not accept changes');
  const next = setup.requests[0];
  assert.notEqual(next.id, proposal.request_id);
  assert.equal(next.request_json.parentProposalId, proposal.id);
  assert.equal(JSON.stringify(setup.localRequests[next.id].cv.baselineState), expected);
  assert.deepEqual(setup.localRequests[next.id].pendingCvSelection?.selectedIds, selection);
  await setup.copyIterationTask();
  assert.equal(setup.requests[0].id, next.id, 'repeated copy reuses the immutable selection');
  const response = fixture.cloud.seedProposal(next.id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(JSON.stringify(setup.record!.state), expected, 'apply only the preceding active selection');
  assert.equal(setup.selectedProposalId, response.id);
  assert.equal(setup.localRequests[next.id].acceptances?.length || 0, 0, 'the new proposal stays pending');
  const decision = setup.localRequests[proposal.request_id].appliedCvSelection!;
  assert.equal(decision.proposalId, proposal.id);
  assert.deepEqual(decision.selectedIds, selection);
  assert.ok(!decision.selectedIds.includes(id));
  const applied = documents(setup);
  await setup.syncRefinement();
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(documents(reopened), applied);
  assert.ok(reopened.localRequests[next.id].pendingCvSelection!.applied);
});

test('an entirely inactive selection applies none of the previous suggestions', async t => {
  const { fixture, setup, proposal, before } = await cvRound(t);
  for (const id of [...setup.selectedChangeIds]) await setup.setCvChangeActive(id, false);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(documents(setup), before);
  assert.deepEqual(setup.localRequests[proposal.request_id].appliedCvSelection!.selectedIds, []);
});

test('previously accepted CV proposals can stage revised choices without changing the accepted working copy', async t => {
  const { fixture, setup, proposal } = await cvRound(t);
  setup.openProposal();
  await setup.acceptSelectedChanges(); // A saved acceptance from the earlier workflow.
  assert.equal(setup.error, '');
  const accepted = documents(setup), decisions = setup.reviews.filter(row => row.kind === 'cv_decisions').length;
  await setup.setCvChangeActive(setup.selectedChangeIds[0], false);
  assert.equal(setup.error, '');
  assert.equal(documents(setup), accepted);
  assert.equal(setup.reviews.filter(row => row.kind === 'cv_decisions').length, decisions);
  const expected = refinementSignature(setup.previewCvState);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(documents(setup), accepted);
  fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.record!.state), expected);
  assert.equal(setup.localRequests[proposal.request_id].appliedCvSelection!.selectedIds.length, proposal.proposal_json.cvOperations.length - 1);
});

test('a delayed arrival cannot overwrite manual CV edits or a newer published round', async t => {
  const { fixture, setup, proposal } = await cvRound(t);
  await setup.copyIterationTask();
  const next = setup.requests[0];
  setup.record!.state.about.text = 'Manual correction while waiting.';
  const before = documents(setup);
  fixture.cloud.seedProposal(next.id);
  await setup.syncRefinement();
  assert.match(setup.error, /changed while waiting/);
  assert.equal(documents(setup), before);
  assert.equal(setup.reviews.filter(row => row.kind === 'cv_decisions').length, 0);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.notEqual(setup.requests[0].id, next.id);
  await setup.selectReviewProposal(proposal.id);
  await setup.setCvChangeActive(proposal.proposal_json.cvOperations[0].id, false);
  assert.match(setup.error, /superseded round/);
  assert.equal(documents(setup), before);
});

test('local failure while applying a returned round preserves documents and retries', async t => {
  const { fixture, setup, before } = await cvRound(t);
  const expected = JSON.stringify(setup.previewCvState);
  await setup.copyIterationTask();
  const next = setup.requests[0];
  fixture.cloud.seedProposal(next.id);
  await setup.checkProposals();
  fixture.failSave(refinementKey);
  await setup.syncRefinement();
  assert.match(setup.error || setup.saveError, /Local storage quota/);
  assert.equal(documents(setup), before);
  assert.ok(!setup.localRequests[next.id].pendingCvSelection!.applied);
  setup.persist(); await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(JSON.stringify(setup.record!.state), expected);
  assert.ok(setup.localRequests[next.id].pendingCvSelection!.applied);
});

test('failed activation storage keeps the previous toggle and working copy', async t => {
  const { fixture, setup, before } = await cvRound(t);
  const selection = [...setup.selectedChangeIds];
  fixture.failSave(refinementKey);
  await setup.setCvChangeActive(selection[0], false);
  assert.match(setup.error, /Local storage quota/);
  assert.deepEqual(setup.selectedChangeIds, selection);
  assert.equal(documents(setup), before);
});

test('Questions count combines all legacy annotation types and CV comments within the selected scope', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  (fixture.database.application_refinement_requests[0].request_json as { scope: string }).scope = 'both';
  setup.localRequests[setup.requests[0].id].request.scope = 'both'; delete setup.localRequests[setup.requests[0].id].baselineScope;
  fixture.database.application_refinement_state[0].current_cv_request_id = null;
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id, { persist: false });
  for (const document of ['cv', 'letter'] as const) for (const type of ['question', 'todo', 'comment'] as const) {
    proposal.proposal_json.annotations!.push({ id: `annotation-${proposal.proposal_json.annotations!.length + 1}`, document, type, location: null, text: `${document} ${type} for manual review.` });
  }
  fixture.database.application_refinement_proposals.push(proposal);
  await setup.checkProposals();
  const before = documents(setup);
  for (const scope of ['cv', 'letter'] as const) {
    setup.feedbackScope = scope;
    await setup.selectReviewProposal(proposal.id);
    assert.equal(setup.reviewCounts.question, proposal.proposal_json.annotations!.filter(item => item.document === scope).length + (scope === 'cv' ? proposal.proposal_json.cvComments.length : 0));
    assert.equal(await setup.selectReviewTab('question'), true);
    assert.equal(setup.reviewTab, 'question');
  }
  assert.equal(documents(setup), before);
  assert.equal(setup.reviewCounts.changes, 0);
});

test('incoming CV iterations preserve letter edits made while waiting', async t => {
  const { fixture, setup } = await cvRound(t);
  const expected = refinementSignature(setup.previewCvState);
  await setup.copyIterationTask();
  setup.updateLetter('Keep this manually corrected letter.');
  const letter = JSON.stringify(setup.letter);
  fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.record!.state), expected);
  assert.equal(JSON.stringify(setup.letter), letter);
});


test('one CV request preserves earlier grouped drafts and consumes them only on a matching reply', async t => {
  const { fixture, setup } = await cvRound(t);
  setup.iterationNotes.cv = { tone: '', structure: 'Keep the methods together.', content: 'Emphasize documented results.' };
  assert.equal(setup.cvIterationNote, 'Keep the methods together.\n\nEmphasize documented results.');
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.cvIterationNote, setup.cvIterationNote);
  reopened.cvIterationNote += '\n\nPrioritize the research experience.';
  const requestText = reopened.cvIterationNote;
  assert.deepEqual(reopened.iterationNotes.cv, { tone: '', structure: '', content: requestText });
  await reopened.copyIterationTask();
  assert.equal(reopened.error, '');
  assert.equal(reopened.cvIterationNote, requestText, 'copying retains the request draft until a reply arrives');
  assert.ok(reopened.requests[0].request_json.feedback.some(item => item.text === requestText));
  fixture.cloud.seedProposal(reopened.requests[0].id);
  await reopened.syncRefinement();
  assert.equal(reopened.error, '');
  assert.equal(reopened.cvIterationNote, '');
});
