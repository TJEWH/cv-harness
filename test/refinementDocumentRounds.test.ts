import assert from 'node:assert/strict';
import test from 'node:test';
import { currentRefinementRequestId, reconstructRefinementProposal, refinementSignature } from '../src/features/refinement/applicationRefinement';
import { createRequire } from 'node:module';
const { registerTextareaCommit } = createRequire(new URL('../src/features/applications/components/ApplicationWorkspace.vue', import.meta.url))('../../../shared/editing/textareaCommit') as typeof import('../src/shared/editing/textareaCommit');
import { sameRefinementInputs } from '../src/features/refinement/domain/refinementSources';
import { idle, mount, prepare, type Workspace } from './refinementWorkflowHarness';
import { createPrivateRefinementCv } from './refinementFixture';

async function switchTo(setup: Workspace, scope: 'cv' | 'letter') {
  setup.reviewActive = false;
  setup.feedbackScope = scope;
  await idle(setup);
}
for (const first of ['cv', 'letter'] as const) test(`independent requests accept ${first} reply first without superseding the other round`, async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  let setup = await prepare(fixture, 'base', { scope: 'cv' });
  const cvId = currentRefinementRequestId(setup.cloudState, 'cv')!;
  await switchTo(setup, 'letter');
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  const letterId = currentRefinementRequestId(setup.cloudState, 'letter')!;
  assert.notEqual(cvId, letterId);
  assert.equal(currentRefinementRequestId(setup.cloudState, 'cv'), cvId);
  const cv = fixture.cloud.seedProposal(cvId), letter = fixture.cloud.seedProposal(letterId);
  for (const scope of [first, first === 'cv' ? 'letter' : 'cv'] as const) {
    await switchTo(setup, scope);
    await setup.syncRefinement();
    assert.equal(setup.error, '');
    assert.equal(setup.selectedProposalId, scope === 'cv' ? cv.id : letter.id);
    assert.equal(currentRefinementRequestId(setup.cloudState, 'cv'), cvId);
    assert.equal(currentRefinementRequestId(setup.cloudState, 'letter'), letterId);
  }
  assert.equal(setup.letterText.includes('human–robot collaboration'), true);
  setup = fixture.reopen(); await idle(setup);
  for (const scope of ['cv', 'letter'] as const) {
    await switchTo(setup, scope);
    assert.equal(setup.selectedProposalId, scope === 'cv' ? cv.id : letter.id);
  }
});

test('letter application preserves CV edits made after its captured source', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const id = currentRefinementRequestId(setup.cloudState, 'letter')!;
  setup.record!.state.about.text = 'Manual CV edit while waiting.';
  setup.persist();
  const savedCv = refinementSignature(setup.record!.state);
  fixture.cloud.seedProposal(id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.record!.state), savedCv);
  assert.ok(setup.letterText.includes('human–robot collaboration'));
});

test('a pending CV selection applies after a letter edit and a separate letter request', async t => {
  const fixture = mount(t, createPrivateRefinementCv()), setup = await prepare(fixture, 'base', { scope: 'cv' });
  const first = fixture.cloud.seedProposal(); await setup.syncRefinement();
  await setup.setCvChangeActive(setup.selectedChangeIds[0], false);
  const selected = [...setup.selectedChangeIds];
  const expected = reconstructRefinementProposal(setup.localRequests[first.request_id], first.proposal_json, selected).state;
  await setup.copyIterationTask(); assert.equal(setup.error, '');
  const cvId = currentRefinementRequestId(setup.cloudState, 'cv')!;
  await switchTo(setup, 'letter');
  setup.updateLetter('Manual letter while CV refinement runs.');
  await setup.copyIterationTask(); assert.equal(setup.error, '');
  const letterId = currentRefinementRequestId(setup.cloudState, 'letter');
  fixture.cloud.seedProposal(cvId);
  await switchTo(setup, 'cv'); await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, expected);
  assert.equal(setup.letterText.includes('Manual letter while CV refinement runs.'), true);
  assert.equal(currentRefinementRequestId(setup.cloudState, 'letter'), letterId);
});

test('feedback and parent proposals stay within the selected document', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' });
  setup.iterationNotes.cv.content = 'Prioritize research evidence.';
  await setup.copyIterationTask(); assert.equal(setup.error, '');
  const cv = setup.requests.find(row => row.id === currentRefinementRequestId(setup.cloudState, 'cv'))!;
  await switchTo(setup, 'letter');
  setup.iterationNotes.letter.tone = 'Use a direct opening.';
  await setup.copyIterationTask(); assert.equal(setup.error, '');
  const letter = setup.requests.find(row => row.id === currentRefinementRequestId(setup.cloudState, 'letter'))!;
  assert.deepEqual(cv.request_json.feedback.map(item => item.scope), ['cv']);
  assert.deepEqual(letter.request_json.feedback.map(item => item.scope), ['letter']);
  assert.ok(!JSON.stringify(letter.request_json.feedback).includes('Prioritize research'));
});

test('legacy combined proposals remain readable but cannot be applied, answered or used as a parent', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' });
  const id = setup.requests[0].id;
  // Simulate immutable records already present before the migration, not a new publication.
  (fixture.database.application_refinement_requests[0].request_json as { scope: string }).scope = 'both';
  setup.localRequests[id].request.scope = 'both'; delete setup.localRequests[id].baselineScope;
  fixture.database.application_refinement_state[0].current_cv_request_id = null;
  const legacy = fixture.cloud.seedProposal(id);
  const before = refinementSignature([setup.record, setup.letter]);
  await setup.checkProposals(); await setup.selectReviewProposal(legacy.id);
  assert.equal(setup.error, '');
  await setup.acceptSelectedChanges(); assert.match(setup.error, /separate request/);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Legacy answer.', null), false);
  assert.match(setup.error, /read-only history/);
  assert.equal(refinementSignature([setup.record, setup.letter]), before);
  setup.error = ''; setup.reviewActive = false;
  await setup.copyIterationTask(); assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.scope, 'cv');
  assert.equal(setup.requests[0].request_json.parentProposalId, null);
  assert.deepEqual(setup.requests[0].request_json.feedback, []);
});

test('same-document edits block pending letter application while captured CV context stays immutable', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const id = currentRefinementRequestId(setup.cloudState, 'letter')!;
  const local = JSON.parse(JSON.stringify(setup.localRequests[id]));
  fixture.cloud.seedProposal(id);
  setup.updateLetter('My newer wording.');
  await setup.syncRefinement();
  assert.ok(setup.letterText.includes('My newer wording.'));
  assert.deepEqual(setup.localRequests[id].cv.baselineState, local.cv.baselineState);
  assert.ok(!sameRefinementInputs(local, setup.localRequests[currentRefinementRequestId(setup.cloudState, 'letter')!]));
});


test('sync commits a pending letter textarea before considering a returned proposal', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id);
  const unregister = registerTextareaCommit(() => setup.updateLetter('Unsaved local typing must survive the reply.'));
  try { await setup.syncRefinement(); } finally { unregister(); }
  assert.match(setup.letterText, /Unsaved local typing must survive/);
  assert.equal(setup.letter!.revisions.length, 0, 'committing a draft cannot accept a stale reply');
});
