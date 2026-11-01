import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cloneCv } from '../../../src/features/applications/applicationCv';
import { reconstructRefinementProposal } from '../../../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from '../../support/fixtures/refinement';
import { documents, idle, mount, prepare, refinementKey } from '../../support/workflows/refinement';

const { registerTextareaCommit } = createRequire(new URL('../../../src/features/applications/components/ApplicationWorkspace.vue', import.meta.url))('../../../shared/editing/textareaCommit') as typeof import('../../../src/shared/editing/textareaCommit');

async function pendingCv(t: Parameters<typeof mount>[0]) {
  const fixture = mount(t, createPrivateRefinementCv());
  const setup = await prepare(fixture);
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.reviewActive, true);
  return { fixture, setup, proposal };
}

test('saving a pending CV flattens exactly its selected changes without accepting, approving, or publishing', async t => {
  const { fixture, setup, proposal } = await pendingCv(t);
  const excluded = setup.selectedChangeIds[0];
  await setup.setCvChangeActive(excluded, false);
  const expected = reconstructRefinementProposal(setup.localRequests[proposal.request_id], proposal.proposal_json, setup.selectedChangeIds).state;
  assert.deepEqual(setup.previewCvState, expected);
  assert.notDeepEqual(expected, setup.record!.state);
  const before = documents(setup), approvals = JSON.stringify(setup.approvals), cloud = JSON.stringify(fixture.database);
  const requests = JSON.stringify(setup.localRequests);
  fixture.cloud.client.rpc = (() => { throw new Error('A library snapshot must not perform a cloud write.'); }) as unknown as typeof fixture.cloud.client.rpc;
  setup.variantName = 'Selected refinement';
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1);
  assert.deepEqual(fixture.creations[0].state, expected);
  assert.ok(!Object.hasOwn(fixture.props.configurations.find(item => item.id === setup.savedVariantId)!, 'parentId'));
  assert.equal(setup.currentVariantSaved, true);
  assert.equal(setup.reviewActive, true);
  assert.equal(setup.cvApproved, false);
  assert.equal(documents(setup), before);
  assert.equal(JSON.stringify(setup.approvals), approvals);
  assert.equal(JSON.stringify(setup.localRequests), requests);
  assert.equal(JSON.stringify(fixture.database), cloud);
  await setup.saveCurrentVariant();
  assert.equal(fixture.creations.length, 1, 'unchanged preview saves are idempotent');
  setup.toggleProposedChange(excluded, true);
  assert.equal(setup.currentVariantSaved, false);
  assert.deepEqual(fixture.states.get(fixture.creations[0].id), expected, 'later selection changes do not alter the saved base state');
});

test('saving Previous and Current uses the displayed CV in each case', async t => {
  const { fixture, setup, proposal } = await pendingCv(t);
  setup.record!.state.about.text = 'A later working edit that is absent from the proposal source.';
  setup.reviewComparison = 'original';
  const source = cloneCv(setup.localRequests[proposal.request_id].cv.baselineState);
  assert.deepEqual(setup.previewCvState, source);
  setup.variantName = 'Original comparison';
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.deepEqual(fixture.creations[0].state, source);
  await setup.selectComparison('proposed');
  const working = cloneCv(setup.record!.state);
  assert.deepEqual(setup.previewCvState, working);
  setup.variantName = 'Current working CV';
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.deepEqual(fixture.creations[1].state, working);
  assert.deepEqual(fixture.states.get(fixture.creations[0].id), source);
});

test('Current saves newer working edits instead of replaying an outdated historical candidate', async t => {
  const { fixture, setup } = await pendingCv(t);
  setup.record!.state.about.text = 'Current working content after publication.';
  const current = cloneCv(setup.record!.state);
  assert.match(setup.reviewAcceptanceError, /changed|outdated/i);
  setup.variantName = 'Current edited CV';
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.deepEqual(fixture.creations[0].state, current);
  assert.equal(setup.record!.state.about.text, 'Current working content after publication.');
  assert.equal(setup.localRequests[setup.requests[0].id].acceptances?.length || 0, 0);
});

test('a flattened variant survives CV history reset, reload, source deletion, and later application edits', async t => {
  const { fixture, setup } = await pendingCv(t);
  const expected = cloneCv(setup.previewCvState!), original = cloneCv(setup.record!.state);
  setup.variantName = 'Retained research CV';
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  const savedId = setup.savedVariantId;
  await setup.clearRefinementHistory();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, original);
  assert.equal(setup.proposals.length, 0);
  assert.deepEqual(fixture.states.get(savedId), expected);
  fixture.states.delete('base');
  fixture.props.configurations = fixture.props.configurations.filter(item => item.id !== 'base');
  const reopened = fixture.reopen(); await idle(reopened);
  reopened.record!.state.about.text = 'Independent application edit after a reset.';
  assert.deepEqual(fixture.states.get(savedId), expected);
  assert.ok(fixture.props.configurations.some(item => item.id === savedId && !item.parentId));
});

for (const damage of ['missing', 'mismatched'] as const) test(`a ${damage} private proposal source cannot silently save the working CV instead`, async t => {
  const { fixture, setup, proposal } = await pendingCv(t);
  if (damage === 'missing') delete setup.localRequests[proposal.request_id];
  else setup.localRequests[proposal.request_id].request.cv.fields[0].text += ' Unmatched request content.';
  assert.equal(setup.previewCvState, null);
  const before = documents(setup);
  await setup.saveCurrentVariant();
  assert.ok(setup.error);
  assert.equal(fixture.creations.length, 0);
  assert.equal(setup.savedVariantId, '');
  assert.equal(documents(setup), before);
});

test('saving the current CV commits pending textarea content before taking the independent snapshot', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const unregister = registerTextareaCommit(() => { setup.record!.state.about.text = 'A draft committed by the save action.'; });
  t.after(unregister);
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations[0].state.about.text, 'A draft committed by the save action.');
  assert.equal(setup.currentVariantSaved, true);
});

test('a failed textarea persistence flush prevents creating a variant', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const unregister = registerTextareaCommit(() => { setup.iterationNotes.cv.content = 'Keep this draft when saving fails.'; });
  t.after(unregister);
  fixture.storage.setItem = () => { throw new Error('Synthetic storage failure'); };
  await setup.saveCurrentVariant();
  assert.match(setup.saveError || setup.error, /Synthetic storage failure/);
  assert.equal(fixture.creations.length, 0);
  assert.equal(setup.iterationNotes.cv.content, 'Keep this draft when saving fails.');
});

test('a pending-preview snapshot is recovered after final receipt failure and reload', async t => {
  const { fixture, setup: first } = await pendingCv(t);
  let setup = first;
  setup.variantName = 'Recover pending snapshot';
  const expected = cloneCv(setup.previewCvState!), create = fixture.props.createVariant;
  fixture.props.createVariant = (name, state) => {
    const id = create(name, state);
    fixture.failSave(refinementKey);
    return id;
  };
  await idle(setup);
  await setup.saveCurrentVariant();
  assert.match(setup.error, /variant was saved.*save record/i);
  assert.equal(fixture.creations.length, 1);
  setup = fixture.reopen(); await idle(setup);
  setup.openProposal();
  assert.deepEqual(setup.previewCvState, expected);
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1);
  assert.equal(setup.savedVariantId, fixture.creations[0].id);
  assert.deepEqual(fixture.states.get(setup.savedVariantId), expected);
});
