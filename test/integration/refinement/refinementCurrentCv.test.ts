import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cloneCv } from '../../../src/features/applications/applicationCv';
import { refinementSignature } from '../../../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from '../../support/fixtures/refinement';
import { idle, mount, prepare, refinementKey } from '../../support/workflows/refinement';

const { registerTextareaCommit } = createRequire(new URL('../../../src/features/applications/components/ApplicationWorkspace.vue', import.meta.url))('../../../shared/editing/textareaCommit') as typeof import('../../../src/shared/editing/textareaCommit');

async function currentCv(t: Parameters<typeof mount>[0]) {
  const fixture = mount(t, createPrivateRefinementCv());
  const setup = await prepare(fixture);
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  return { fixture, setup, proposal };
}

test('Current and its manual editor include active changes without requiring a preview mode', async t => {
  const { setup } = await currentCv(t);
  const working = cloneCv(setup.record!.state);
  assert.deepEqual(setup.cvEditorState, setup.previewCvState);
  assert.notDeepEqual(setup.cvEditorState, working);
  setup.discardReview();
  assert.deepEqual(setup.previewCvState, setup.cvEditorState, 'closing the former mode cannot hide the current selection');
  await setup.setCvChangeActive(setup.selectedChangeIds[0], false);
  assert.deepEqual(setup.cvEditorState, setup.previewCvState);
  assert.deepEqual(setup.record!.state, working, 'displaying or toggling suggestions alone does not materialize them');
});

test('manual editing saves the displayed selection locally and preserves Previous, the library and letter', async t => {
  const { fixture, setup, proposal } = await currentCv(t);
  const expected = cloneCv(setup.previewCvState!), letter = JSON.stringify(setup.letter);
  const source = JSON.stringify(setup.localRequests[proposal.request_id]);
  const library = refinementSignature(fixture.states.get('base')), cloud = JSON.stringify(fixture.database);
  expected.about.text = 'Manually refined current research profile.';
  setup.cvEditorState!.about.text = expected.about.text;

  assert.deepEqual(setup.record!.state, expected);
  assert.deepEqual(setup.previewCvState, expected);
  assert.equal(JSON.stringify(setup.localRequests[proposal.request_id]), source);
  assert.equal(JSON.stringify(setup.letter), letter);
  assert.equal(refinementSignature(fixture.states.get('base')), library);
  assert.equal(JSON.stringify(fixture.database), cloud, 'manual commits do not publish or approve');
  assert.equal(setup.cvApproved, false);
  await setup.selectComparison('original');
  assert.deepEqual(setup.previewCvState, setup.localRequests[proposal.request_id].cv.baselineState);
  assert.deepEqual(setup.cvEditorState, expected, 'Previous never replaces the editable Current copy');
  setup.cvEditorState!.about.text = 'A further correction while viewing Previous.';
  assert.equal(setup.reviewComparison, 'proposed');
  assert.equal(setup.previewCvState!.about.text, 'A further correction while viewing Previous.');
});

test('manual Current survives scope changes, sync and reopening without replaying old suggestions', async t => {
  const { fixture, setup } = await currentCv(t);
  setup.cvEditorState!.about.text = 'Keep my manual Current wording.';
  const expected = cloneCv(setup.record!.state);
  setup.feedbackScope = 'letter'; await idle(setup);
  setup.feedbackScope = 'cv'; await idle(setup);
  assert.deepEqual(setup.previewCvState, expected);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.previewCvState, expected);
  const reopened = fixture.reopen(); await idle(reopened);
  assert.deepEqual(reopened.previewCvState, expected);
  assert.deepEqual(reopened.cvEditorState, expected);
  await reopened.copyIterationTask();
  assert.equal(reopened.error, '');
  assert.deepEqual(reopened.localRequests[reopened.requests[0].id].cv.baselineState, expected);
});

test('comparison switches commit the pending CV textarea before showing Previous', async t => {
  const { setup, proposal } = await currentCv(t);
  let pending = true;
  const unregister = registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    setup.cvEditorState!.about.text = 'Committed before comparison changes.';
  });
  t.after(unregister);
  await setup.selectComparison('original');
  assert.equal(setup.record!.state.about.text, 'Committed before comparison changes.');
  assert.deepEqual(setup.previewCvState, setup.localRequests[proposal.request_id].cv.baselineState);
  await setup.selectComparison('proposed');
  assert.equal(setup.previewCvState!.about.text, 'Committed before comparison changes.');
});

test('approving a pending CV approves Current even when viewing Previous', async t => {
  const { setup } = await currentCv(t);
  const current = cloneCv(setup.previewCvState!);
  await setup.selectComparison('original');
  await setup.approve('cv');
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true);
  assert.deepEqual(setup.record!.state, current);
});

test('failed local manual save retains Current for retry and prevents changing comparison', async t => {
  const { fixture, setup } = await currentCv(t);
  fixture.storage.setItem = () => { throw new Error('Synthetic local save failure'); };
  setup.cvEditorState!.about.text = 'Retain this unsaved Current text.';
  assert.match(setup.saveError, /Synthetic local save failure/);
  await setup.selectComparison('original');
  assert.equal(setup.reviewComparison, 'proposed');
  assert.equal(setup.cvEditorState!.about.text, 'Retain this unsaved Current text.');
  assert.equal(setup.record!.state.about.text, 'Retain this unsaved Current text.');
});

test('approving revised choices on an earlier acceptance keeps the displayed Current', async t => {
  const { setup } = await currentCv(t);
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  await setup.setCvChangeActive(setup.selectedChangeIds[0], false);
  const current = cloneCv(setup.previewCvState!);
  assert.notDeepEqual(current, setup.record!.state);
  await setup.approve('cv');
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true);
  assert.deepEqual(setup.record!.state, current);
});

test('without a proposal, manual edits update the current application preview and persist', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  setup.cvEditorState!.about.text = 'Manual CV before the first proposal.';
  assert.equal(setup.previewCvState!.about.text, 'Manual CV before the first proposal.');
  assert.equal(setup.record!.state.about.text, 'Manual CV before the first proposal.');
  assert.ok(fixture.storage.getItem(refinementKey));
});
