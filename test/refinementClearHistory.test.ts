import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRefinementRepository, refinementSignature } from '../src/features/refinement/applicationRefinement';
import { createRefinementFixture } from './refinementFixture';
import { stub } from './helpers';
import { EMPTY_LETTER } from '../src/documents/letter/motivationLetters';
import { refinementMatchesScope } from '../src/features/refinement/domain/refinementHistory';
import { account, applicationId, documents, idle, mount, prepare, refinementKey, type Workspace } from './refinementWorkflowHarness';

const documentFingerprint = (setup: Workspace) => refinementSignature(JSON.parse(documents(setup)));
const scopedRequests = (setup: Workspace) => setup.requests.filter(row => refinementMatchesScope(row.request_json.scope, setup.pane, row.cleared_scopes));

function assertEmptyHistory(setup: Workspace) {
  assert.deepEqual(scopedRequests(setup), []);
  assert.equal(Object.values(setup.localRequests).some(local => !local.publishedAt && refinementMatchesScope(local.request.scope, setup.pane)), false);
  assert.deepEqual(setup.feedbackHistory(), []); assert.deepEqual(setup.resetRequestIds, []);
  assert.equal(setup.parentProposalId, null); assert.equal(setup.selectedProposalId, ''); assert.equal(setup.reviewActive, false);
  assert.deepEqual(setup.proposalAnnotations, []); assert.equal(setup.canClearHistory, false);
  assert.equal(setup.showInitialRefinement, true);
}

function assertFreshInitialRequest(setup: Workspace) {
  assert.equal(scopedRequests(setup).length, 1);
  const request = scopedRequests(setup)[0];
  assert.equal(setup.cloudState!.current_letter_request_id, request.id);
  assert.ok(setup.localRequests[request.id]);
  assert.equal(setup.localRequests[request.id].publishedAt, request.created_at);
  assert.equal(request.request_json.parentProposalId, null); assert.deepEqual(request.request_json.feedback, []);
  assert.equal(setup.proposals.some(row => row.request_id === request.id), false);
  assert.deepEqual(setup.feedbackHistory(), []); assert.deepEqual(setup.resetRequestIds, []);
  assert.equal(setup.parentProposalId, null); assert.equal(setup.selectedProposalId, ''); assert.equal(setup.reviewActive, false);
  assert.deepEqual(setup.proposalAnnotations, []); assert.equal(setup.showInitialRefinement, true);
}

test('clear history resets the letter to its template before deleting iterations and creates a fresh next task', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const firstId = setup.requests[0].id;
  fixture.cloud.seedProposal(firstId, { letterText: 'Current draft to keep after clearing history.' });
  await setup.syncRefinement(); assert.equal(setup.error, '');
  assert.equal(setup.showInitialRefinement, false);
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Previous iteration answer.', null), true);
  assert.equal(setup.feedbackHistory().length, 1);
  await setup.checkProposals(); setup.openProposal();
  assert.equal(setup.reviewActive, false); assert.equal(setup.canClearHistory, true);
  assert.equal(setup.feedbackHistory().length, 1, 'the letter round retains its saved question answer');
  const originalLetter = { ...EMPTY_LETTER };
  const cvBefore = refinementSignature(setup.record), state = JSON.parse(JSON.stringify(setup.cloudState));
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let restoredBeforeClear = false;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'clear_refinement_history') restoredBeforeClear = refinementSignature(setup.letter!.working) === refinementSignature(originalLetter);
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.clearRefinementHistory();

  assert.equal(setup.error, ''); assertEmptyHistory(setup);
  assert.equal(restoredBeforeClear, true);
  assert.deepEqual(setup.letter!.working, originalLetter);
  assert.equal(refinementSignature(setup.record), cvBefore);
  const restored = documentFingerprint(setup);
  assert.equal(setup.reviews.every(row => row.kind === 'cv_decisions'), true, 'historical CV decision sources remain available');
  assert.equal(setup.cloudState!.revision, state.revision + 1);
  assert.equal(setup.cloudState!.current_letter_request_id, null);
  assert.deepEqual(setup.cloudState!.setup_json, state.setup_json);
  assert.deepEqual(setup.cloudState!.approvals_json, state.approvals_json);
  const stored = JSON.parse(fixture.storage.getItem(refinementKey)!);
  assert.deepEqual(Object.keys(stored.requests).sort(), setup.requests.map(row => row.id).sort());

  setup = fixture.reopen(); await idle(setup); await setup.checkProposals();
  assert.equal(setup.error, ''); assertFreshInitialRequest(setup); assert.equal(documentFingerprint(setup), restored);
  const loadedRequestId = scopedRequests(setup)[0].id;
  await setup.copyIterationTask();
  assert.equal(setup.error, ''); assert.equal(scopedRequests(setup).length, 1);
  assert.equal(scopedRequests(setup)[0].id, loadedRequestId, 'copying reuses the initial request automatically published on load');
  assert.equal(setup.showInitialRefinement, true, 'the first task after clearing history awaits an initial proposal');
  const next = scopedRequests(setup)[0].request_json;
  assert.notEqual(next.requestId, firstId); assert.equal(next.parentProposalId, null); assert.deepEqual(next.feedback, []);
  assert.equal(next.letter.text, '');
  assert.equal(documentFingerprint(setup), restored);
});

test('clearing letter history resets to its template and removes only its approval, preserving letter revisions through reload', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Approved final draft.' });
  await setup.syncRefinement(); await setup.approve('letter'); await setup.approve('cv');
  assert.equal(setup.error, ''); assert.equal(setup.cvApproved, true); assert.equal(setup.letterApproved, true);
  const cvBefore = refinementSignature(setup.record), cvApproval = setup.approvals.cv;
  const oldRevisions = setup.letter!.revisions.map(revision => revision.id);
  assert.ok(setup.letter!.revisions.length);

  setup.feedbackScope = 'letter'; await idle(setup);
  await setup.clearRefinementHistory();

  const assertLetterHistoryCleared = () => {
    assert.equal(setup.error, ''); assert.equal(setup.canClearHistory, false);
    assert.equal(setup.requests.some(row => refinementMatchesScope(row.request_json.scope, 'letter', row.cleared_scopes)), false);
    assert.equal(setup.reviews.some(row => row.kind === 'approve_letter'), false);
    assert.equal(setup.reviews.some(row => row.kind === 'approve_cv'), true, 'CV approval history survives clearing letter history');
    assert.equal(refinementSignature(setup.record), cvBefore);
    assert.equal(setup.letter!.working.body, '');
    assert.ok(oldRevisions.every(id => setup.letter!.revisions.some(revision => revision.id === id)));
  };
  assertLetterHistoryCleared();
  assert.deepEqual(setup.approvals, { cv: cvApproval, letter: null });
  assert.equal(setup.cvApproved, true); assert.equal(setup.letterApproved, false);
  setup = fixture.reopen(); await idle(setup);
  assertFreshInitialRequest(setup);
  assert.equal(setup.letter!.working.body, '');
  assert.equal(refinementSignature(setup.record), cvBefore);
  assert.deepEqual(setup.approvals, { cv: cvApproval, letter: null });
  assert.equal(setup.cvApproved, true); assert.equal(setup.letterApproved, false);
});

for (const failure of [
  { error: { message: 'Cloud history is temporarily unavailable.' }, expected: /temporarily unavailable/ },
  { error: { code: 'PGRST202', message: 'Function not found.' }, expected: /database setup is incomplete/i },
]) test(`failed history clear preserves local and cloud history: ${failure.error.message}`, async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Saved proposed draft.' });
  await setup.checkProposals(); setup.openProposal();
  const requests = refinementSignature(setup.requests), proposals = refinementSignature(setup.proposals);
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => name === 'clear_refinement_history'
    ? { data: null, error: failure.error } : rpc(name, args)) as unknown as typeof fixture.cloud.client.rpc;

  await setup.clearRefinementHistory();

  assert.match(setup.error, failure.expected);
  assert.equal(setup.letter!.working.body, '');
  assert.equal(refinementSignature(setup.requests), requests);
  assert.equal(refinementSignature(setup.proposals), proposals);
  assert.equal(refinementSignature(fixture.database.application_refinement_requests), requests);
  assert.equal(setup.canClearHistory, true, 'failed deletion can be retried with the original snapshot retained');
});

test('cloud-confirmed history removal recovers on reload when persisting local cleanup initially fails', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const firstId = setup.requests[0].id;
  fixture.cloud.seedProposal(firstId, { letterText: 'Keep this working draft through cleanup recovery.' });
  await setup.syncRefinement(); assert.equal(setup.error, '');
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Keep this saved answer only until history is cleared.', null), true);
  const cvBefore = refinementSignature(setup.record);
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(name, args);
    if (name === 'clear_refinement_history') fixture.failSave(refinementKey);
    return result;
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.clearRefinementHistory();

  assert.equal(setup.letter!.working.body, '');
  assert.equal(fixture.database.application_refinement_requests.every(row => (row.cleared_scopes as string[]).includes('letter')), true);
  setup = fixture.reopen(); await idle(setup); await setup.checkProposals();
  assert.equal(setup.error, ''); assert.equal(setup.saveError, ''); assertFreshInitialRequest(setup);
  assert.notEqual(scopedRequests(setup)[0].id, firstId);
  assert.equal(scopedRequests(setup)[0].request_json.letter.text, '');
  assert.equal(refinementSignature(setup.record), cvBefore);
});

test('observed cloud publication recovers a missing receipt and remote clearing retains only genuinely unpublished work', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  const publishedId = setup.requests[0].id;
  setup.updateLetter('A new working draft awaiting its first publication.');
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => name === 'publish_refinement_request'
    ? { data: null, error: { message: 'Publication temporarily unavailable.' } } : rpc(name, args)) as unknown as typeof fixture.cloud.client.rpc;
  await setup.publishSources();
  assert.match(setup.error, /Publication temporarily unavailable/);
  const pendingId = Object.keys(setup.localRequests).find(id => id !== publishedId)!;
  assert.ok(pendingId); assert.equal(setup.localRequests[pendingId].publishedAt, undefined);
  const pending = refinementSignature(setup.localRequests[pendingId]);
  delete setup.localRequests[publishedId].publishedAt; setup.persist();
  fixture.cloud.client.rpc = rpc;

  await setup.checkProposals();

  assert.equal(setup.error, '');
  assert.equal(setup.localRequests[publishedId].publishedAt, setup.requests[0].created_at);
  assert.equal(refinementSignature(setup.localRequests[pendingId]), pending);
  const before = documentFingerprint(setup);
  await createRefinementRepository(fixture.cloud.client, () => account).clearHistory(applicationId, setup.cloudState!.revision, 'letter');
  await setup.checkProposals();
  assert.equal(setup.error, ''); assert.deepEqual(setup.requests, []);
  assert.deepEqual(Object.keys(setup.localRequests), [pendingId]);
  assert.equal(refinementSignature(setup.localRequests[pendingId]), pending);
  assert.equal(documentFingerprint(setup), before);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.error, ''); assert.deepEqual(Object.keys(setup.localRequests), [pendingId]);
  assert.equal(setup.requests.length, 1); assert.equal(setup.requests[0].id, pendingId);
  const { publishedAt, ...publishedPending } = setup.localRequests[pendingId];
  assert.equal(publishedAt, setup.requests[0].created_at);
  assert.equal(refinementSignature(publishedPending), pending, 'automatic sync publishes the same pending receipt without changing its frozen sources');
  assert.equal(documentFingerprint(setup), before);
});

test('clearing CV history restores its original state before deletion and keeps the letter intact', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'cv' });
  const originalCv = refinementSignature(setup.record!.state);
  fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement(); await setup.acceptSelectedChanges(); await setup.approve('cv');
  setup.feedbackScope = 'cv'; await idle(setup);
  assert.notEqual(refinementSignature(setup.record!.state), originalCv);
  const letterBefore = refinementSignature(setup.letter);
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let restoredBeforeClear = false;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'clear_refinement_history') restoredBeforeClear = refinementSignature(setup.record!.state) === originalCv && !setup.cvApproved;
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.clearRefinementHistory();

  assert.equal(setup.error, ''); assert.equal(restoredBeforeClear, true);
  assertEmptyHistory(setup);
  assert.equal(refinementSignature(setup.record!.state), originalCv);
  assert.equal(refinementSignature(setup.letter), letterBefore);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(refinementSignature(setup.record!.state), originalCv);
  assert.equal(refinementSignature(setup.letter), letterBefore);
});

test('letter clear uses the currently selected template defaults without needing the first private snapshot', async t => {
  const fixture = mount(t); let setup = fixture.setup;
  await idle(setup); await setup.selectCv('base'); await setup.selectLetterTemplate('industry');
  setup.updateLetter('Original private working letter.');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  setup.tab = 'refinement'; await idle(setup);
  const firstRequest = setup.requests[0].id;
  fixture.cloud.seedProposal(firstRequest, { letterText: 'A refined draft from the first template.' });
  await setup.syncRefinement();
  const template = JSON.parse(JSON.stringify(setup.letter!.templateSnapshot!));
  setup.letter!.language = 'de'; setup.letter!.maxWords = 123;
  setup.letter!.instructions = 'Obsolete instructions from the previous draft.';
  setup.letter!.formatting = { marginMm: 30, fontSizePt: 14, headerNameSizePt: 24, lineHeight: 1.8 };
  delete setup.localRequests[firstRequest];
  await idle(setup);

  await setup.clearRefinementHistory();

  const assertTemplateDefaults = () => {
    assert.equal(setup.error, '');
    assert.deepEqual(setup.letter!.working, EMPTY_LETTER);
    assert.deepEqual(setup.letter!.templateSnapshot, template);
    assert.equal(setup.letter!.templateId, template.id);
    assert.equal(setup.letter!.language, template.language);
    assert.equal(setup.letter!.maxWords, template.maxWords);
    assert.equal(setup.letter!.formatting, undefined, 'formatting must inherit the template defaults');
    assert.equal(setup.letter!.instructions, '');
    assert.equal(setup.letter!.finalRevisionId, null);
  };
  assertTemplateDefaults();
  assertEmptyHistory(setup);
  setup = fixture.reopen(); await idle(setup);
  assertTemplateDefaults();
  assert.equal(scopedRequests(setup)[0].request_json.letter.text, '');
  assert.equal(scopedRequests(setup)[0].request_json.letter.template.id, template.id);
});

for (const failure of ['missing snapshot', 'local save'] as const) test(`history is not deleted when its original document cannot be restored: ${failure}`, async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: failure === 'missing snapshot' ? 'cv' : 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Keep this refined draft when reset fails.' });
  await setup.syncRefinement();
  const before = documentFingerprint(setup), cloud = refinementSignature(fixture.database);
  if (failure === 'missing snapshot') delete setup.localRequests[setup.requests[0].id];
  else fixture.failSave(refinementKey);

  await setup.clearRefinementHistory();

  assert.ok(setup.error);
  assert.equal(documentFingerprint(setup), before);
  assert.equal(refinementSignature(fixture.database), cloud);
});

test('repository clear targets only the owned application and rejects stale revisions', async t => {
  const source = mount(t), setup = await prepare(source, 'base', { scope: 'letter' });
  const state = JSON.parse(JSON.stringify(setup.cloudState!));
  const owned = '10000000-0000-4000-8000-000000000002', foreign = '10000000-0000-4000-8000-000000000003';
  const empty = '10000000-0000-4000-8000-000000000004';
  const database: Record<string, Record<string, unknown>[]> = {
    applications: [{ id: applicationId, user_id: account }, { id: owned, user_id: account }, { id: foreign, user_id: 'other' }, { id: empty, user_id: account }],
    application_refinement_state: [applicationId, owned, foreign].map(id => ({ ...state, application_id: id, user_id: id === foreign ? 'other' : account })),
    application_refinement_requests: [applicationId, owned, foreign].map(id => ({ id: crypto.randomUUID(), request_json: { scope: 'letter' }, kind: 'feedback', payload: { scope: 'letter' }, application_id: id, user_id: id === foreign ? 'other' : account })),
    application_refinement_proposals: [applicationId, owned, foreign].map(id => ({ id: crypto.randomUUID(), request_json: { scope: 'letter' }, kind: 'feedback', payload: { scope: 'letter' }, application_id: id, user_id: id === foreign ? 'other' : account })),
    application_refinement_reviews: [applicationId, owned, foreign].map(id => ({ id: crypto.randomUUID(), request_json: { scope: 'letter' }, kind: 'feedback', payload: { scope: 'letter' }, application_id: id, user_id: id === foreign ? 'other' : account })),
  };
  for (const row of database.application_refinement_proposals) row.request_id = database.application_refinement_requests.find(request => request.application_id === row.application_id)!.id;
  const fixture = createRefinementFixture(database, account), repository = createRefinementRepository(fixture.client, () => account);
  const before = refinementSignature(database);
  await assert.rejects(repository.clearHistory(applicationId, state.revision - 1, 'letter'), /changed|revision/i);
  await assert.rejects(repository.clearHistory(foreign, 0, 'letter'), /application/i);
  assert.equal(refinementSignature(database), before);
  assert.equal(await repository.clearHistory(empty, 0, 'letter'), null);
  assert.equal(refinementSignature(database), before);
  const cleared = await repository.clearHistory(applicationId, state.revision, 'letter');
  assert.equal(cleared!.revision, state.revision + 1); assert.equal(cleared!.current_letter_request_id, null);
  assert.deepEqual(database.application_refinement_state.slice(1), [owned, foreign].map(id => ({ ...state, application_id: id, user_id: id === foreign ? 'other' : account })));
  for (const table of ['application_refinement_requests', 'application_refinement_proposals', 'application_refinement_reviews']) {
    assert.deepEqual(database[table].map(row => row.application_id), [owned, foreign]);
  }
});

test('repository clear validates its returned revision, empty current request, owner, and session', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const state = JSON.parse(JSON.stringify(setup.cloudState!));
  const receipt = { ...state, revision: state.revision + 1, current_letter_request_id: null };
  for (const invalid of [{ ...receipt, application_id: crypto.randomUUID() }, { ...receipt, user_id: 'other' },
    { ...receipt, revision: state.revision }, { ...receipt, current_letter_request_id: setup.requests[0].id }, null]) {
    const client = stub<SupabaseClient>({ rpc: async () => ({ data: invalid, error: null }) });
    await assert.rejects(createRefinementRepository(client, () => account).clearHistory(applicationId, state.revision, 'letter'), /verif|confirm/i);
  }
  let current = account;
  const client = stub<SupabaseClient>({ rpc: async () => { current = 'other'; return { data: receipt, error: null }; } });
  await assert.rejects(createRefinementRepository(client, () => current).clearHistory(applicationId, state.revision, 'letter'), /Session changed/i);
});

test('scoped repository clearing retains the other document and clears legacy shared rounds one facet at a time', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  const letterId = setup.requests[0].id, cvId = crypto.randomUUID(), sharedId = crypto.randomUUID();
  const source = structuredClone(fixture.database.application_refinement_requests[0]);
  for (const [id, scope] of [[cvId, 'cv'], [sharedId, 'both']] as const) {
    const row = structuredClone(source);
    row.id = id;
    const request = row.request_json as typeof setup.requests[0]['request_json'];
    request.requestId = id; request.cv.requestId = id; request.scope = scope;
    fixture.database.application_refinement_requests.push(row);
  }
  for (const id of [letterId, cvId, sharedId]) fixture.cloud.seedProposal(id);
  const cvFeedback = await repository.saveReview(applicationId, null, 'feedback', { text: 'CV evidence.', scope: 'cv' });
  const letterFeedback = await repository.saveReview(applicationId, null, 'feedback', { text: 'Letter fit.', scope: 'letter' });
  const sharedFeedback = { ...letterFeedback, id: crypto.randomUUID(), payload: { text: 'Shared research.', scope: 'both' } };
  fixture.database.application_refinement_reviews.push(sharedFeedback);
  const cloudState = fixture.database.application_refinement_state[0];
  cloudState.current_cv_request_id = cvId;
  const originalState = structuredClone(cloudState);
  const originalLetter = refinementSignature(fixture.database.application_refinement_requests.find(row => row.id === letterId));

  const clearedCv = await repository.clearHistory(applicationId, Number(cloudState.revision), 'cv');

  assert.equal(clearedCv!.current_letter_request_id, letterId);
  assert.deepEqual(clearedCv!.setup_json, originalState.setup_json);
  assert.deepEqual(clearedCv!.approvals_json, originalState.approvals_json);
  const requests = await repository.listRequests(applicationId), reviews = await repository.listReviews(applicationId);
  assert.equal(requests.some(row => row.id === cvId), false);
  assert.deepEqual(requests.find(row => row.id === sharedId)!.cleared_scopes, ['cv']);
  assert.equal(refinementSignature(requests.find(row => row.id === letterId)), originalLetter);
  assert.equal((await repository.listProposals(applicationId)).some(row => row.request_id === cvId), false);
  assert.equal(reviews.some(row => row.id === cvFeedback.id), false);
  assert.deepEqual(reviews.find(row => row.id === letterFeedback.id), letterFeedback);
  assert.deepEqual(reviews.find(row => row.id === sharedFeedback.id)!.cleared_scopes, ['cv']);

  await assert.rejects(repository.clearHistory(applicationId, Number(originalState.revision), 'letter'), /changed|revision/i);
  const clearedLetter = await repository.clearHistory(applicationId, clearedCv!.revision, 'letter');
  assert.equal(clearedLetter!.current_letter_request_id, null);
  assert.deepEqual(await repository.listRequests(applicationId), []);
  assert.deepEqual(await repository.listProposals(applicationId), []);
  assert.deepEqual(await repository.listReviews(applicationId), []);
});

test('scoped repository clearing preserves a current request belonging only to the other document', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  const requestId = setup.requests[0].id;
  const state = await repository.clearHistory(applicationId, setup.cloudState!.revision, 'cv');
  assert.equal(state!.current_letter_request_id, requestId);
  assert.equal((await repository.listRequests(applicationId))[0].id, requestId);
});

test('scoped clearing keeps historical opposite-document reviews and their original source request', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  const requestId = setup.requests[0].id;
  const proposal = fixture.cloud.seedProposal(requestId);
  const feedback = { id: crypto.randomUUID(), application_id: applicationId, user_id: account, request_id: requestId, kind: 'feedback', payload: { text: 'Letter motivation.', scope: 'letter' }, created_at: new Date().toISOString() };
  const annotation = { ...feedback, id: crypto.randomUUID(), kind: 'annotation', payload: { proposalId: proposal.id, annotationId: 'annotation-2', status: 'resolved', response: 'Confirmed motivation.', previousReviewId: null } };
  proposal.proposal_json.annotations!.push({ id: 'annotation-2', type: 'question', document: 'letter', location: null, text: 'Historical motivation question.' });
  fixture.database.application_refinement_proposals[0].proposal_json = proposal.proposal_json;
  fixture.database.application_refinement_reviews.push(feedback, annotation);
  const beforeProposal = refinementSignature(await repository.listProposals(applicationId));

  const state = await repository.clearHistory(applicationId, setup.cloudState!.revision, 'cv');

  assert.equal(state!.current_cv_request_id, null, 'cleared CV request must not remain active despite retained letter source');
  const requests = await repository.listRequests(applicationId);
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].cleared_scopes, ['cv']);
  assert.equal(refinementMatchesScope(requests[0].request_json.scope, 'cv', requests[0].cleared_scopes), false);
  assert.deepEqual(await repository.listReviews(applicationId), [feedback, annotation].sort((a,b) => a.id.localeCompare(b.id)));
  assert.equal(refinementSignature(await repository.listProposals(applicationId)), beforeProposal);

  await repository.clearHistory(applicationId, state!.revision, 'letter');
  assert.deepEqual(await repository.listRequests(applicationId), []);
  assert.deepEqual(await repository.listProposals(applicationId), []);
  assert.deepEqual(await repository.listReviews(applicationId), []);
});

test('repository readers reject malformed cleared history scopes', async t => {
  const fixture = mount(t); await prepare(fixture, 'base', { scope: 'letter' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  await repository.saveReview(applicationId, null, 'feedback', { text: 'Research evidence.', scope: 'letter' });
  for (const invalid of [null, 'cv', ['both'], ['cv', 'cv'], ['cv', 'letter', 'cv']]) {
    fixture.database.application_refinement_requests[0].cleared_scopes = invalid;
    await assert.rejects(repository.listRequests(applicationId), /scopes.*verified/i);
    fixture.database.application_refinement_reviews[0].cleared_scopes = invalid;
    await assert.rejects(repository.listReviews(applicationId), /scopes.*verified/i);
  }
});
