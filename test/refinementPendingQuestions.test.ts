import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRefinementPrompt } from '../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from './refinementFixture';
import { documents, idle, mount, prepare, type Workspace } from './refinementWorkflowHarness';
import type { RefinementScope } from '../src/features/refinement/refinementTypes';

function seed(fixture: ReturnType<typeof mount>, setup: Workspace, title: string) {
  const row = fixture.cloud.seedProposal(setup.requests[0].id);
  row.proposal_json.annotations = [{ id: 'annotation-1', type: 'question', document: setup.pane, location: null, text: title }];
  fixture.database.application_refinement_proposals.find(item => item.id === row.id)!.proposal_json = row.proposal_json;
  return row;
}

for (const scope of ['cv', 'letter'] as RefinementScope[]) test(`${scope}: unanswered questions survive multiple rounds, reload and colliding annotation IDs`, async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  let setup = await prepare(fixture, 'base', { scope });
  const first = seed(fixture, setup, '[experience] Which calibration methods did you use?');
  await setup.syncRefinement();
  const before = documents(setup);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.equal(documents(setup), before, 'carrying questions does not apply or approve documents');
  const request = setup.requests[0], pending = request.request_json.feedback;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].annotation?.proposalId, first.id);
  assert.equal(pending[0].annotation?.reviewId, null);
  assert.match(pending[0].text, /Status: open.*Which calibration methods.*No answer is approved/s);
  assert.doesNotMatch(pending[0].text, /User response:/);
  await setup.copyIterationTask();
  assert.equal(setup.requests[0].id, request.id, 'unchanged copies reuse the request');
  assert.equal(setup.feedbackHistory().length, 1, 'pending feedback is not duplicated');

  const second = seed(fixture, setup, '[experience] Which dataset did you evaluate?');
  await setup.syncRefinement();
  assert.deepEqual(new Set(setup.currentAnnotations.map(view => view.proposalId)), new Set([first.id, second.id]));
  assert.equal(setup.currentAnnotations.length, 2);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.currentAnnotations.length, 2);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'I compared repeatability in controlled experiments.', null, first.id), true);
  const carried = setup.currentAnnotations.find(view => view.proposalId === first.id)!;
  assert.equal(carried.status, 'resolved');
  assert.equal(setup.currentAnnotations.find(view => view.proposalId === second.id)!.status, 'open', 'same-numbered new question stays open');
  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', carried.response!, carried.reviewId, first.id), true);
  assert.match(setup.feedbackHistory().at(-1)!.text, /Status: ignored/);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.currentAnnotations.find(view => view.proposalId === first.id)!.status, 'ignored', 'saved carried choices stay editable in their current round');

  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  const third = seed(fixture, setup, '[other] Which research direction should the next draft emphasize?');
  await setup.syncRefinement();
  assert.deepEqual(new Set(setup.currentAnnotations.map(view => view.proposalId)), new Set([second.id, third.id]));
  assert.equal(setup.currentAnnotations.filter(view => view.proposalId === second.id).length, 1);
  assert.equal(setup.cvApproved, false);
  assert.equal(setup.letterApproved, false);
});

test('only open questions are carried; historical answers remain unapproved and scoped', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const proposal = seed(fixture, setup, 'Keep this unanswered question.');
  const annotations = proposal.proposal_json.annotations!;
  annotations.push(...['Resolved without an answer.', 'Explicitly ignored.', 'Legacy open answer.'].map((text, i) => ({
    id: `annotation-${i + 2}`, type: 'question' as const, document: 'letter' as const, location: null, text,
  })));
  await setup.syncRefinement();
  await setup.saveAnnotation('annotation-2', 'resolved', '', null);
  await setup.saveAnnotation('annotation-3', 'ignored', '', null);
  await setup.saveAnnotation('annotation-4', 'open', 'Historical unapproved text.', null);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  const pending = setup.requests[0].request_json.feedback.filter(item => /Status: open/.test(item.text));
  assert.deepEqual(new Set(pending.map(item => item.annotation?.annotationId)), new Set(['annotation-1', 'annotation-4']));
  assert.doesNotMatch(JSON.stringify(pending), /Historical unapproved text/);
  const prompt = buildRefinementPrompt(setup.requests[0].request_json, 'fixture');
  assert.match(prompt, /Only the user can resolve or ignore a pending question/);
  setup.feedbackScope = 'cv'; await idle(setup); await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.ok(setup.requests[0].request_json.feedback.every(item => item.scope === 'cv'));
  assert.doesNotMatch(JSON.stringify(setup.requests[0].request_json.feedback), /Keep this unanswered/);
});

test('partial pending-question feedback failure blocks publication and retries without duplicates', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.syncRefinement();
  const original = setup.requests[0].id, before = documents(setup);
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let writes = 0;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'save_refinement_review' && args.p_kind === 'feedback' && ++writes === 2) return { data: null, error: new Error('Pending questions unavailable') };
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;
  await setup.copyIterationTask();
  assert.match(setup.error, /Pending questions unavailable/);
  assert.equal(setup.requests[0].id, original);
  assert.equal(setup.feedbackHistory().length, 1);
  assert.equal(documents(setup), before);
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.notEqual(setup.requests[0].id, original);
  assert.equal(setup.feedbackHistory().length, 2);
  assert.equal(setup.requests[0].request_json.feedback.length, 2);
});

test('clearing history removes carried questions and their pending feedback only from that scope', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' });
  seed(fixture, setup, 'CV question to clear.'); await setup.syncRefinement(); await setup.copyIterationTask();
  setup.feedbackScope = 'letter'; await idle(setup); await setup.copyIterationTask();
  seed(fixture, setup, 'Letter question to retain.'); await setup.syncRefinement(); await setup.copyIterationTask();
  setup.feedbackScope = 'cv'; await idle(setup);
  await setup.clearRefinementHistory();
  assert.equal(setup.error, '');
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.doesNotMatch(JSON.stringify(setup.requests[0].request_json.feedback), /CV question to clear/);
  setup.feedbackScope = 'letter'; await idle(setup);
  assert.ok(setup.currentAnnotations.some(view => view.annotation.text === 'Letter question to retain.'));
  assert.ok(setup.feedbackHistory().some(item => item.text.includes('Letter question to retain.')));
});

test('a remotely ignored pending question is reconciled before publishing another request', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' });
  const first = seed(fixture, setup, 'A pending question later ignored on another device.');
  await setup.syncRefinement(); await setup.copyIterationTask();
  const saved = await fixture.cloud.rpc('save_refinement_review', {
    p_id: crypto.randomUUID(), p_application_id: fixture.props.application.id,
    p_request_id: first.request_id, p_kind: 'annotation',
    p_payload: { proposalId: first.id, annotationId: 'annotation-1', status: 'ignored', response: null, previousReviewId: null },
  });
  assert.equal(saved.error, null);
  // The other device saved the status but never completed its feedback step.
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  const history = setup.requests[0].request_json.feedback;
  assert.match(history[0].text, /Status: open/);
  assert.match(history.at(-1)!.text, /Status: ignored.*Ignore this annotation/s);
});
