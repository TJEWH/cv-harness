import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_LETTER } from '../../../src/documents/letter/motivationLetters';
import { refinementSignature } from '../../../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from '../../support/fixtures/refinement';
import { idle, seedLegacyRound, mount, prepare, refinementKey, type Workspace } from '../../support/workflows/refinement';

type ResetWorkspace = Workspace & {
  pendingResetFeedback: Record<'cv' | 'letter', { id: string; text: string; requestId: string } | null>;
  iterationNotes: Record<'cv' | 'letter', { tone: string; structure: string; content: string }>;
};

test('clearing letter history restores template defaults and preserves the approved CV after reload', async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  let setup = await prepare(fixture, 'base', { scope: 'cv', letterText: 'Incidental letter in the earlier CV request.' });
  const cvRequest = setup.requests[0];
  fixture.cloud.seedProposal(cvRequest.id); await setup.syncRefinement();
  assert.equal(setup.error, '');

  setup.updateLetter('The original source for letter refinement.');
  setup.feedbackScope = 'letter'; await setup.copyIterationTask();
  const letterRequest = setup.requests[0];
  const originalLetter = { ...EMPTY_LETTER };
  fixture.cloud.seedProposal(letterRequest.id, { letterText: 'The revised letter to reset.' });
  await setup.syncRefinement();
  await setup.approve('cv'); await setup.approve('letter');
  assert.equal(setup.error, '');
  setup.feedbackScope = 'letter';
  const approvedCv = refinementSignature(setup.record), cvApproval = setup.approvals.cv;
  const cvHistory = refinementSignature(setup.requests.find(row => row.id === cvRequest.id));

  await setup.clearRefinementHistory();

  assert.equal(setup.error, '');
  assert.deepEqual(setup.letter!.working, originalLetter);
  assert.deepEqual(setup.previewLetterContent, originalLetter, 'the inline preview must show the restored letter immediately');
  assert.equal(setup.letter!.finalRevisionId, null);
  assert.equal(setup.approvals.letter, null);
  assert.equal(refinementSignature(setup.record), approvedCv);
  assert.equal(setup.approvals.cv, cvApproval);
  assert.equal(setup.cvApproved, true);
  assert.equal(refinementSignature(setup.requests.find(row => row.id === cvRequest.id)), cvHistory);
  assert.equal(setup.requests.some(row => row.id === letterRequest.id && !row.cleared_scopes?.includes('letter')), false);
  assert.equal(setup.showInitialRefinement, true);

  setup = fixture.reopen(); await idle(setup); await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.letter!.working, originalLetter);
  assert.deepEqual(setup.previewLetterContent, originalLetter, 'sync must not replay the reset proposal');
  assert.equal(refinementSignature(setup.record), approvedCv);
  assert.equal(setup.cvApproved, true);
  setup.feedbackScope = 'cv';
  assert.equal(setup.showInitialRefinement, false, 'CV refinement history remains active');
});

test('clearing CV history preserves the finalized letter and its active refinement history', async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  const setup = await prepare(fixture, 'base', { scope: 'letter' });
  const letterRequest = setup.requests[0];
  fixture.cloud.seedProposal(letterRequest.id, { letterText: 'The approved letter must survive the CV reset.' });
  await setup.syncRefinement(); await setup.approve('letter');
  assert.equal(setup.error, '');
  setup.feedbackScope = 'cv'; await setup.copyIterationTask();
  const cvRequest = setup.requests[0], originalCv = refinementSignature(setup.record!.state);
  fixture.cloud.seedProposal(cvRequest.id); await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.record!.state), originalCv, 'new CV changes remain pending');
  const finalizedLetter = refinementSignature(setup.letter), letterApproval = setup.approvals.letter;

  await setup.clearRefinementHistory();

  assert.equal(setup.error, '');
  assert.equal(refinementSignature(setup.record!.state), originalCv);
  assert.equal(refinementSignature(setup.letter), finalizedLetter);
  assert.equal(setup.approvals.letter, letterApproval);
  assert.equal(setup.letterApproved, true);
  assert.equal(setup.showInitialRefinement, true);
  setup.feedbackScope = 'letter';
  assert.equal(setup.showInitialRefinement, false, 'letter refinement history remains active');
});

test('clearing letter history from a legacy combined round retains the CV history without reactivating it', async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  let setup = await prepare(fixture, 'base', { scope: 'cv', letterText: '' });
  seedLegacyRound(fixture);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  const cvAfterRefinement = refinementSignature(setup.record);
  setup.feedbackScope = 'letter';

  await setup.clearRefinementHistory();

  assert.equal(setup.error, '');
  assert.equal(setup.letterText, '');
  assert.equal(refinementSignature(setup.record), cvAfterRefinement);
  assert.equal(setup.showInitialRefinement, true);
  setup.feedbackScope = 'cv';
  assert.equal(setup.showInitialRefinement, true);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.showInitialRefinement, true);
  setup.feedbackScope = 'letter';
  assert.equal(setup.parentProposalId, null, 'a cleared letter parent must not be restored from the active CV lineage');
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, '');
  assert.equal(setup.showInitialRefinement, true);
  setup.feedbackScope = 'cv';
  assert.equal(setup.showInitialRefinement, true);
});

for (const saveBeforeFailure of [false, true]) test(`failed reset feedback ${saveBeforeFailure ? 'acknowledgement' : 'save'} retries after reload before publishing fresh notes`, async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { scope: 'letter', letterText: 'Original source letter.' }) as ResetWorkspace;
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'A refined letter to reset.' });
  await setup.syncRefinement();
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'An older answer to deactivate.', null), true);
  const requestCount = setup.requests.length;
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  const attempts: string[] = [];
  let failReset = true;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'save_refinement_review' && args.p_kind === 'feedback' && /^Workflow reset:/.test((args.p_payload as { text: string }).text)) {
      attempts.push(String(args.p_id));
      if (failReset) {
        if (saveBeforeFailure) await rpc(name, args);
        return { data: null, error: new Error('Reset feedback unavailable') };
      }
    }
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.clearRefinementHistory();

  assert.match(setup.error, /Reset feedback unavailable/);
  assert.equal(setup.letterText, '');
  assert.equal(setup.requests.length, requestCount, 'history must survive an unconfirmed reset');
  const pending = JSON.parse(JSON.stringify(setup.pendingResetFeedback.letter));
  assert.ok(pending?.id);
  assert.deepEqual(JSON.parse(fixture.storage.getItem(refinementKey)!).pendingResetFeedback.letter, pending);
  setup = fixture.reopen() as ResetWorkspace; await idle(setup);
  assert.deepEqual(setup.pendingResetFeedback.letter, pending);
  assert.equal(setup.letterText, '');
  setup.iterationNotes.letter.structure = 'Lead with the new research question.';

  await setup.copyIterationTask();

  assert.match(setup.error, /Reset feedback unavailable/);
  assert.equal(setup.requests.length, requestCount, 'publication is blocked while the reset marker is unconfirmed');
  assert.equal(setup.iterationNotes.letter.structure, 'Lead with the new research question.');
  failReset = false;
  await setup.copyIterationTask();

  assert.equal(setup.error, '');
  assert.equal(new Set(attempts).size, 1, 'every reset attempt reuses the persisted UUID');
  assert.equal(setup.pendingResetFeedback.letter, null);
  assert.equal(JSON.parse(fixture.storage.getItem(refinementKey)!).pendingResetFeedback.letter, null);
  const feedback = setup.requests[0].request_json.feedback;
  const resetIndex = feedback.findIndex(item => item.id === pending.id);
  assert.ok(resetIndex >= 0);
  assert.equal(feedback[resetIndex].scope, 'letter');
  assert.ok(feedback.findIndex(item => /new research question/.test(item.text)) > resetIndex, 'fresh requests must follow the reset marker');
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.id === pending.id).length, 1);
  assert.equal(setup.letterText, '');
});
