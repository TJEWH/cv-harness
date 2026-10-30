import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneCv, loadApplicationCv } from '../src/features/applications/applicationCv';
import { finalizeLetter } from '../src/documents/letter/motivationLetters';
import type { ApplicationLetter } from '../src/documents/letter/letterTypes';
import type { ApplicationStage } from '../src/app/cloudTypes';
import { account, applicationId, refinementKey, seedLegacyRound, mount, prepare, idle, documents } from './refinementWorkflowHarness';

test('loading connected proposal history activates the complete temporary candidate without a cloud write or document save', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Connected proposed letter.' });
  const savedDocuments = documents(setup), savedPrivate = JSON.stringify(setup.localRequests), savedCloud = JSON.stringify(fixture.database);
  await setup.checkProposals();
  assert.equal(setup.error, '');
  assert.equal(setup.reviewActive, true);
  assert.ok(setup.selectedProposalId);
  assert.notDeepEqual(setup.previewCvState?.bodyOrder, setup.record?.state.bodyOrder);
  assert.equal(setup.previewLetterContent?.body, 'Original private working letter.');
  assert.equal(documents(setup), savedDocuments);
  assert.equal(JSON.stringify(setup.localRequests), savedPrivate);
  assert.equal(JSON.stringify(fixture.database), savedCloud);
});

for (const [heading, subject, salutation] of [
  ['Application for a PhD in Robotics', 'Application for a PhD in Robotics', 'Dear Selection Committee,'],
  ['Betreff: Bewerbung um eine Promotionsstelle', 'Bewerbung um eine Promotionsstelle', 'Sehr geehrte Damen und Herren,'],
]) test(`connected ChatGPT draft maps "${heading}" to the subject through preview, acceptance and reload`, async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { scope: 'letter' });
  const body = `${salutation}\n\nMy research experience fits this opportunity.\n\nYours sincerely,\n{{APPLICANT_NAME}}`;
  const incoming = `${heading}\n\n${body}`;
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: incoming });
  const original = documents(setup);
  await setup.checkProposals();
  const expected = { subject, salutation: '', body, closing: '' };
  assert.deepEqual(setup.previewLetterContent, expected);
  assert.equal(documents(setup), original, 'reading a proposal does not rewrite the working letter');
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.letter!.working, expected);
  assert.deepEqual(setup.letter!.revisions.find(revision => revision.cloudDraftId === proposal.id)?.content, expected);
  assert.equal(setup.letterText, `# ${subject}\n\n${body}`);
  assert.equal(setup.selectedProposalId, proposal.id);
  assert.equal(setup.proposals.find(row => row.id === proposal.id)?.proposal_json.letterText, incoming, 'the original returned proposal stays intact');
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.error, '');
  assert.deepEqual(setup.letter!.working, expected);
});

test('letter comparison stays available after acceptance while edits, approval and export use the working letter', async t => {
  const fixture = mount(t);
  const setup = await prepare(fixture, 'base', { scope: 'letter', letterText: 'Original letter before refinement.' });
  await setup.approve('cv');
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Returned letter proposal.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.previewLetterContent?.body, 'Returned letter proposal.');
  setup.reviewComparison = 'original';
  assert.equal(setup.previewLetterContent?.body, 'Original letter before refinement.');
  setup.reviewComparison = 'proposed';
  setup.updateLetter('Returned letter with a manual correction.');
  assert.equal(setup.previewLetterContent?.body, 'Returned letter with a manual correction.');
  await setup.approve('letter');
  assert.equal(setup.error, '');
  assert.equal(setup.letterApproved, true, 'persistent comparison must not lock approval');
  setup.reviewComparison = 'original';
  assert.equal(setup.previewLetterContent?.body, 'Original letter before refinement.');
  const exported: string[] = [];
  setup.letterPreview = { getPdfBlob: async () => { exported.push(setup.previewLetterContent!.body); return new Blob(['synthetic PDF']); } };
  await assert.rejects(setup.getLetterPdf(), /Attachments/);
  setup.tab = 'review'; await idle(setup);
  await setup.getLetterPdf();
  assert.deepEqual(exported, ['Returned letter with a manual correction.']);
  setup.tab = 'refinement'; await idle(setup);
  assert.equal(setup.previewLetterContent?.body, 'Original letter before refinement.', 'returning to the letter retains its comparison choice');
  await setup.approve('letter', true);
  assert.equal(setup.error, '');
  assert.equal(setup.letterApproved, false);
});

test('historical letter comparisons show their own proposal and never lock or overwrite current edits', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const first = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First accepted letter.' });
  await setup.syncRefinement();
  await setup.publishSources();
  const second = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Second accepted letter.' });
  await setup.syncRefinement();
  setup.updateLetter('Second letter with manual corrections.');
  await setup.selectReviewProposal(first.id);
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.previewLetterContent?.body, 'First accepted letter.');
  assert.equal(setup.letter!.working.body, 'Second letter with manual corrections.');
  await setup.selectReviewProposal(second.id);
  assert.equal(setup.previewLetterContent?.body, 'Second letter with manual corrections.');
  setup.reviewComparison = 'original';
  assert.equal(setup.previewLetterContent?.body, 'First accepted letter.');
});

test('unaccepted letter comparison survives stage navigation without entering an editing lock', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Historical proposed letter.' });
  setup.updateLetter('Manual correction after publishing.');
  await setup.checkProposals();
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.previewLetterContent?.body, 'Historical proposed letter.');
  setup.tab = 'preparation'; await idle(setup);
  assert.equal(setup.previewLetterContent?.body, 'Manual correction after publishing.');
  setup.tab = 'refinement'; await idle(setup);
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.previewLetterContent?.body, 'Historical proposed letter.');
  assert.equal(setup.letter!.working.body, 'Manual correction after publishing.');
  assert.match(setup.reviewAcceptanceError, /changed|outdated/i);
});

test('refreshing proposal history preserves the active proposal and its selection when a newer return arrives', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  const first = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First proposal under review.' });
  await setup.checkProposals();
  setup.toggleProposedChange(setup.selectedChangeIds[0], false);
  const selection = [...setup.selectedChangeIds], candidate = JSON.stringify(setup.previewCvState);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'New proposal waiting in history.' });
  await setup.checkProposals();
  assert.equal(setup.error, '');
  assert.equal(setup.proposals.length, 2);
  assert.equal(setup.selectedProposalId, first.id);
  assert.deepEqual(setup.selectedChangeIds, selection);
  assert.equal(JSON.stringify(setup.previewCvState), candidate);
  assert.equal(setup.previewLetterContent?.body, 'Original private working letter.');
});

test('accepting a proposal saves only the application copy with exactly the reviewed content, including after reload', async t => {
  const fixture = mount(t);
  const source = cloneCv(fixture.base); source.about.text += '\nA manually tailored source sentence.';
  fixture.states.set('source-child', source);
  fixture.props.configurations.push({ id: 'source-child', name: 'Tailored source' });
  let setup = await prepare(fixture, 'source-child');
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Accepted reviewed letter.' });
  await setup.checkProposals();
  const candidate = cloneCv(setup.previewCvState!), privateBefore = JSON.stringify(setup.localRequests[proposal.proposal_json.requestId].cv);
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 0);
  assert.deepEqual(setup.record?.state, candidate);
  assert.equal(setup.record?.variantId, 'source-child', 'refinement retains the original source identity');
  assert.equal(setup.letterText, 'Original private working letter.');
  assert.deepEqual(fixture.states.get('source-child'), source);
  assert.equal(JSON.stringify(setup.localRequests[proposal.proposal_json.requestId].cv), privateBefore);
  assert.deepEqual(loadApplicationCv(account, applicationId)?.state, candidate);
  const acceptedDocuments = documents(setup);
  setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(fixture.creations.length, 0);
  assert.equal(documents(setup), acceptedDocuments);
  setup = fixture.reopen(); await idle(setup); setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(fixture.creations.length, 0, 'refinement never writes to the library');
  assert.equal(setup.localRequests[proposal.proposal_json.requestId].acceptances?.length, 1, 'the local receipt makes acceptance idempotent');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(acceptedDocuments));
});

test('a deleted library source does not block acceptance or the next refinement round', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  fixture.props.configurations = [];
  fixture.states.delete('base');
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Refined independently from the library.' });
  await setup.checkProposals(); const candidate = cloneCv(setup.previewCvState!);
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.record?.state, candidate);
  assert.equal(setup.record?.variantId, 'base');
  assert.equal(setup.letterText, 'Original private working letter.');
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 2);
  assert.deepEqual(setup.localRequests[setup.requests[0].id].cv.baselineState, candidate);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Another independent refinement.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Original private working letter.');
  assert.equal(fixture.creations.length, 0);
});

test('explicitly saving the current CV creates a regular variant without approval or changing application provenance', async t => {
  const fixture = mount(t); let setup = await prepare(fixture);
  setup.record!.state.about.text += '\nCustom application wording.';
  assert.equal(setup.cvApproved, false);
  const before = documents(setup), approvals = JSON.stringify(setup.approvals), source = cloneCv(fixture.states.get('base')!);
  setup.variantName = '   ';
  await setup.saveCurrentVariant();
  assert.match(setup.error, /Enter a name/);
  setup.variantName = '  Robotics application  ';
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1);
  const created = fixture.creations[0];
  assert.equal(created.name, 'Robotics application');
  assert.deepEqual(created.state, setup.record!.state);
  assert.equal(Object.hasOwn(fixture.props.configurations.find(item => item.id === created.id)!, 'parentId'), false);
  assert.equal(setup.savedVariantId, created.id);
  assert.equal(setup.currentVariantSaved, true);
  assert.equal(documents(setup), before);
  assert.equal(JSON.stringify(setup.approvals), approvals);
  assert.deepEqual(fixture.states.get('base'), source);
  await setup.saveCurrentVariant();
  setup = fixture.reopen(); await idle(setup);
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1, 'repeated saving and reload reuse the recorded completed export');
  setup.record!.state.about.text += '\nA later application-only change.';
  assert.equal(setup.currentVariantSaved, false);
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 2);
  assert.deepEqual(fixture.creations[1].state, setup.record!.state);
  assert.deepEqual(fixture.states.get(created.id), created.state, 'later application edits leave the exported variant unchanged');
});

test('saving a new variant reports library failure without changing approved application documents', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  await setup.approve('cv'); await idle(setup); setup.feedbackScope = 'cv'; await idle(setup);
  const before = documents(setup), approvals = JSON.stringify(setup.approvals);
  fixture.failCreation();
  await setup.saveCurrentVariant();
  assert.match(setup.error, /variant could not be saved/i);
  assert.equal(fixture.creations.length, 0);
  assert.equal(documents(setup), before);
  assert.equal(JSON.stringify(setup.approvals), approvals);
  assert.equal(setup.cvApproved, true);
});

test('a completed variant save is recovered after its final receipt fails and the application reopens', async t => {
  const fixture = mount(t); let setup = await prepare(fixture);
  await setup.approve('cv'); await idle(setup); setup.feedbackScope = 'cv'; await idle(setup);
  setup.variantName = 'Custom approved snapshot';
  const before = documents(setup), create = fixture.props.createVariant;
  fixture.props.createVariant = (name, state) => {
    const id = create(name, state);
    fixture.failSave(refinementKey);
    return id;
  };
  await idle(setup);
  await setup.saveCurrentVariant();
  assert.match(setup.error, /variant was saved.*save record/i);
  assert.equal(fixture.creations.length, 1);
  assert.equal(documents(setup), before);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.variantName, 'Custom approved snapshot', 'the saved intent preserves the name across an interrupted receipt');
  assert.equal(setup.cvApproved, true);
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1, 'recovery reuses the exact completed snapshot');
  assert.equal(setup.savedVariantId, fixture.creations[0].id);
});

test('first explicit save creates a new variant even when its name and content match the source', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  await setup.approve('cv'); await idle(setup); setup.feedbackScope = 'cv'; await idle(setup);
  setup.variantName = 'Research';
  assert.deepEqual(setup.record!.state, fixture.states.get('base'));
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1);
  assert.notEqual(setup.savedVariantId, 'base');
  assert.equal(fixture.creations[0].name, 'Research');
});

test('failed persistence before saving a variant leaves the library untouched', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  await setup.approve('cv'); await idle(setup); setup.feedbackScope = 'cv'; await idle(setup);
  const before = documents(setup);
  fixture.failSave(refinementKey);
  await setup.saveCurrentVariant();
  assert.match(setup.error, /Local storage quota reached/);
  assert.equal(fixture.creations.length, 0);
  assert.equal(documents(setup), before);
});

test('an exported variant edited in the library no longer counts as the saved approved CV', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  await setup.approve('cv'); await idle(setup); setup.feedbackScope = 'cv'; await idle(setup);
  setup.variantName = 'Approved snapshot';
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  const first = fixture.creations[0];
  const edited = cloneCv(first.state); edited.about.text = 'A separate library edit.';
  fixture.states.set(first.id, edited);
  fixture.props.configurations.find(item => item.id === first.id)!.mtime = Date.now();
  await idle(setup);
  await setup.saveCurrentVariant();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 2);
  assert.deepEqual(fixture.creations[1].state, setup.record!.state);
  assert.equal(fixture.states.get(first.id)?.about.text, 'A separate library edit.');
});

test('a working edit during decision recording prevents either candidate document from being committed', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  const originalLetter = JSON.stringify(setup.letter);
  const client = fixture.props.client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
  const originalRpc = client.rpc.bind(client);
  client.rpc = async (name, args) => {
    const result = await originalRpc(name, args);
    if (name === 'save_refinement_review' && args.p_kind === 'cv_decisions') setup.record!.state.about.text = 'A manual edit arrived while saving.';
    return result;
  };
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /changed|conflict/i);
  assert.equal(setup.record?.state.about.text, 'A manual edit arrived while saving.');
  assert.equal(JSON.stringify(setup.letter), originalLetter);
  assert.equal(fixture.creations.length, 0);
  assert.equal(setup.reviewActive, true);
});

test('a finalized letter is not replaced merely because its cloud approval flag is absent', async t => {
  const fixture = mount(t); const setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.letter = finalizeLetter(setup.letter!, setup.letter!.workingContext, setup.record!.state.contact);
  const finalBefore = JSON.stringify(setup.letter);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Replacement for a finalized letter.' });
  await setup.checkProposals();
  assert.equal(setup.previewLetterContent?.body, 'Replacement for a finalized letter.');
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /final|reopen/i);
  assert.equal(JSON.stringify(setup.letter), finalBefore);
  assert.equal(fixture.creations.length, 0);
  const finalized = structuredClone(JSON.parse(finalBefore) as ApplicationLetter);
  setup.discardReview();
  await setup.approve('letter', true);
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.finalRevisionId, null);
  setup.openProposal();
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Replacement for a finalized letter.');
  assert.deepEqual(JSON.parse(JSON.stringify(setup.letter!.revisions.find(item => item.id === finalized.finalRevisionId))), finalized.revisions.find(item => item.id === finalized.finalRevisionId), 'explicit reopening preserves the finalized revision in history');
});

test('a failed local commit restores both documents and retries without any library writes', async t => {
  const fixture = mount(t); const setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Proposed document pair.' });
  await setup.checkProposals();
  const before = documents(setup), savedBefore = new Map(fixture.data);
  fixture.failSave(`cv.letters.v1:${account}:application:${applicationId}`);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /Local storage quota reached/);
  assert.equal(documents(setup), before);
  for (const [key, value] of savedBefore) assert.equal(fixture.storage.getItem(key), value, `${key} must be rolled back`);
  assert.equal(setup.reviewActive, false);
  assert.equal(fixture.creations.length, 0);
  setup.persist();
  assert.equal(setup.saveError, '');
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 0);
  assert.equal(setup.record?.variantId, 'base');
  assert.equal(setup.letterText, 'Proposed document pair.');
});

test('retired local refinement history is dropped while current snapshots, documents and approvals survive reload', async t => {
  const fixture = mount(t); let setup = await prepare(fixture);
  await setup.approve('cv'); await setup.approve('letter');
  assert.equal(setup.error, '');
  const requestId = setup.requests[0].id;
  const snapshot = JSON.stringify(setup.localRequests[requestId]);
  const before = documents(setup), approvals = JSON.stringify(setup.approvals);
  const saved = JSON.parse(fixture.storage.getItem(refinementKey)!);
  const retiredRequestId = crypto.randomUUID(), retiredProposalId = crypto.randomUUID();
  const retired = structuredClone(saved.requests[requestId]);
  retired.request = { ...retired.request, requestId: retiredRequestId, schemaVersion: 1 };
  delete retired.request.cvStructure;
  delete retired.structureBindings;
  saved.requests[retiredRequestId] = retired;
  saved.importedProposals = [{ id: retiredProposalId, request_id: retiredRequestId, proposal_json: { schemaVersion: 1 } }];
  saved.importedReviews = [{ id: crypto.randomUUID(), request_id: retiredRequestId, kind: 'feedback', payload: { text: 'Retired imported advice.', scope: 'cv' } }];
  saved.parentProposalId = retiredProposalId;
  fixture.storage.setItem(refinementKey, JSON.stringify(saved));

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, ''); assert.equal(setup.saveError, '');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before)); assert.equal(JSON.stringify(setup.approvals), approvals);
  assert.equal(JSON.stringify(setup.localRequests[requestId]), snapshot, 'the current full private reconstruction snapshot stays intact');
  assert.deepEqual(Object.keys(setup.localRequests), [requestId]);
  assert.deepEqual(setup.feedbackHistory(), []); assert.deepEqual(setup.proposals, []);
  assert.equal(setup.parentProposalId, null);
  const stored = JSON.parse(fixture.storage.getItem(refinementKey)!);
  assert.deepEqual(Object.keys(stored.requests), [requestId]);
  assert.equal('importedProposals' in stored, false); assert.equal('importedReviews' in stored, false);
});

test('refinement scope changes preserve working documents and independent application status', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const before = documents(setup), status = fixture.props.application.status;
  for (const scope of ['cv', 'letter'] as const) {
    setup.tab = 'refinement'; setup.feedbackScope = scope; await idle(setup);
    assert.equal(setup.feedbackScope, scope); assert.equal(setup.tab, 'refinement');
    assert.equal(documents(setup), before); assert.equal(fixture.props.application.status, status);
  }
  await setup.approve('cv'); await idle(setup);
  assert.equal(setup.feedbackScope, 'letter', 'approving the CV switches refinement to the letter');
  assert.equal(fixture.props.application.status, status);
});

test('history selection activates exact older proposal previews, and refresh keeps that review active', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const oldRequest = setup.requests[0];
  const old = fixture.cloud.seedProposal(oldRequest.id, { letterText: 'Earlier proposal.' });
  setup.updateLetter('New manual wording.'); await setup.publishSources();
  const current = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Current proposal.' });
  await setup.checkProposals();
  assert.equal(setup.selectedProposalId, current.id, 'the new current proposal is selected unless history was explicitly opened');
  await setup.selectReviewProposal(current.id);
  assert.equal(setup.previewLetterContent?.body, 'Current proposal.');
  const before = documents(setup), status = fixture.props.application.status;
  await setup.selectReviewProposal(old.id);
  assert.equal(setup.previewLetterContent?.body, 'Earlier proposal.');
  assert.match(setup.reviewAcceptanceError, /superseded/);
  await setup.checkProposals(); assert.equal(setup.selectedProposalId, old.id);
  setup.discardReview(); await setup.selectReviewProposal(old.id);
  assert.equal(setup.previewLetterContent?.body, 'Earlier proposal.', 'selecting the same proposal restores its letter comparison');
  assert.equal(documents(setup), before); assert.equal(fixture.props.application.status, status);
});

test('an older run is never automatically loaded when the current request has no proposal', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Older response.' });
  setup.updateLetter('Next round source.'); await setup.publishSources();
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.selectedProposalId, ''); assert.equal(reopened.reviewActive, false);
  assert.equal(reopened.proposals.length, 1, 'the old proposal remains accessible in history');
});

for (const scope of ['cv', 'letter'] as const) test(`short ${scope} task copies the application reference only after publishing the matching current sources`, async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  fixture.props.application.application_code = 'APP-SYNTHETIC';
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  setup.feedbackScope = scope;
  await setup.publishSources();
  assert.equal(copied.length, 0, 'publishing must not copy anything');
  await setup.copyTask();
  assert.equal(setup.error, '');
  const document = scope === 'cv' ? 'CV' : 'motivation letter';
  assert.ok(copied.at(-1)!.startsWith(`phd-workflow: APP-SYNTHETIC — refine ${document}.\n`));
  const current = fixture.database.application_refinement_state[0][`current_${setup.pane}_request_id`];
  assert.equal(typeof current, 'string');
  assert.equal(setup.requests.find(row => row.id === current)?.request_json.scope, scope);
  assert.ok(copied.at(-1)!.includes(`published request ${current}`));
  assert.ok(copied.at(-1)!.includes(`scope ${scope}`));
  assert.ok(!copied.at(-1)!.includes('Original private working letter.'));
  assert.equal(fixture.database.application_refinement_protocols.length, 0, 'copy needs no protocol publication');
  assert.match(copied.at(-1)!, /private.read_current_refinement_request/);
  assert.match(copied.at(-1)!, /private.save_refinement_proposal/);
  assert.match(copied.at(-1)!, /precisely this JSON contract/);
  assert.doesNotMatch(copied.at(-1)!, /read_refinement_protocol|resolve_application_reference|protocol_text|v1:[a-f0-9]{64}/);
  const count = setup.requests.length;
  await setup.copyTask(); assert.equal(setup.requests.length, count, 'unchanged sources reuse the published request');
  assert.equal(fixture.database.application_refinement_protocols.length, 0, 'copy retries never publish a protocol');
  if (scope === 'letter') setup.updateLetter('Manual correction for the next round.');
  else setup.record!.state.about.text = 'Manual correction for the next round.';
  await setup.copyTask(); assert.match(setup.error, /Publish the current sources/);
  assert.equal(copied.length, 2, 'copying changed sources must not publish or copy an old request');
  assert.equal(setup.requests.length, count);
  await setup.publishSources(); assert.equal(copied.length, 2);
  await setup.copyTask(); assert.equal(setup.requests.length, count + 1);
  assert.ok(copied.at(-1)!.includes(`published request ${fixture.database.application_refinement_state[0][`current_${setup.pane}_request_id`]}`));
  assert.ok(!copied.at(-1)!.includes(String(current)), 'the next task cannot retain a superseded request reference');
  if (scope === 'letter') setup.updateLetter('Unpublished changed source.');
  else setup.record!.state.about.text = 'Unpublished changed source.';
  fixture.cloud.client.rpc = (() => Promise.resolve({ data: null, error: new Error('Synthetic publication failure') })) as unknown as typeof fixture.cloud.client.rpc;
  await setup.publishSources(); assert.ok(setup.error); assert.equal(copied.length, 3);
  await setup.copyTask(); assert.ok(setup.error); assert.equal(copied.length, 3, 'failed publication must not copy an instruction for old sources');
});

test('copy task uses published sources without cloud writes and preserves historical protocols', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  const before = JSON.stringify(fixture.database);
  fixture.cloud.client.rpc = (() => { throw new Error('Copy must not perform a cloud write'); }) as unknown as typeof fixture.cloud.client.rpc;
  await setup.copyTask();
  assert.equal(setup.error, '');
  assert.equal(copied.length, 1);
  assert.match(copied[0], /read_current_refinement_request/);
  assert.equal(JSON.stringify(fixture.database), before);
});

test('an empty letter publishes an explicit first-draft task and switches to refinement after a working draft exists', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { letterText: '', scope: 'letter' });
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  const before = documents(setup);
  await setup.copyTask();
  assert.equal(setup.error, '');
  assert.match(copied.at(-1)!, /create an initial motivation-letter draft/);
  assert.match(copied.at(-1)!, /do not require a prior letter/);
  assert.equal(setup.requests[0].request_json.letter.text, '');
  assert.equal(documents(setup), before, 'copying the task must not generate or replace local letter content');
  setup.updateLetter('A complete manually written letter.');
  await setup.publishSources(); await setup.copyTask();
  assert.equal(setup.error, '');
  assert.match(copied.at(-1)!, /refine motivation letter/);
  assert.match(copied.at(-1)!, /Refine the complete existing letter/);
  assert.doesNotMatch(copied.at(-1)!, /source letter is intentionally empty/);
  assert.equal(setup.requests[0].request_json.letter.text, 'A complete manually written letter.');
});

test('the persisted application stage restores navigation and Tracking retains the status until explicitly chosen', async t => {
  const fixture = mount(t); await idle(fixture.setup);
  const navigationKey = `CV_APPLICATION_TAB:${account}:${applicationId}`;
  let setup = fixture.setup;
  for (const [stage, status] of [['tracking', 'preparation'], ['refinement', 'refinement'], ['tracking', 'refinement'], ['review', 'attachments'], ['tracking', 'attachments'], ['preparation', 'preparation']] as const) {
    setup.tab = stage; await idle(setup);
    assert.equal(fixture.props.application.workflow_stage, stage);
    assert.equal(fixture.props.application.status, status);
    assert.equal(fixture.props.application.tracking_started, false, 'navigation must not choose a tracking status');
    fixture.storage.setItem(navigationKey, stage === 'refinement' ? 'tracking' : 'refinement');
    setup = fixture.reopen(); await idle(setup);
    assert.equal(setup.tab, stage, 'the saved application stage takes precedence over an old session tab');
  }

  fixture.props.application = { ...fixture.props.application, status: 'ready', tracking_started: true };
  for (const stage of ['refinement', 'review', 'tracking', 'preparation'] as const) {
    setup.tab = stage; await idle(setup);
    assert.equal(fixture.props.application.status, 'ready', 'an explicitly chosen Ready state stays independent of navigation');
    assert.equal(fixture.props.application.workflow_stage, stage);
    setup = fixture.reopen(); await idle(setup); assert.equal(setup.tab, stage);
  }
  fixture.props.application.status = 'submitted'; await idle(setup);
  assert.equal(setup.tab, 'preparation', 'a tracking save must not move the active tab');
});

test('legacy applications restore their compatible local tab and persist the initial stage', async t => {
  const fixture = mount(t); await idle(fixture.setup);
  const navigationKey = `CV_APPLICATION_TAB:${account}:${applicationId}`;
  fixture.props.application = { ...fixture.props.application, workflow_stage: undefined, status: 'ready', tracking_started: false };
  fixture.storage.setItem(navigationKey, 'documents');
  let setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.tab, 'review');
  assert.equal(fixture.props.application.workflow_stage, 'review');
  assert.equal(fixture.props.application.status, 'attachments');
  fixture.props.application = { ...fixture.props.application, workflow_stage: undefined, status: 'contacted', tracking_started: true };
  fixture.storage.setItem(navigationKey, 'refinement');
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.tab, 'tracking');
  assert.equal(fixture.props.application.workflow_stage, 'tracking');
  assert.equal(fixture.props.application.status, 'contacted');
});

test('selecting the active tab retries a failed initial stage save', async t => {
  const fixture = mount(t); await idle(fixture.setup);
  const persistStage = fixture.props.onChangeStage;
  const attempts: ApplicationStage[] = [];
  let canSave = false;
  fixture.props.onChangeStage = stage => {
    attempts.push(stage);
    if (canSave) persistStage(stage);
  };
  fixture.props.application = { ...fixture.props.application, workflow_stage: undefined, status: 'ready', tracking_started: false };
  fixture.storage.setItem(`CV_APPLICATION_TAB:${account}:${applicationId}`, 'refinement');
  const setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.tab, 'refinement');
  assert.equal(fixture.props.application.status, 'ready');
  assert.deepEqual(attempts, ['refinement']);

  canSave = true;
  setup.selectStage('refinement'); await idle(setup);
  assert.deepEqual(attempts, ['refinement', 'refinement']);
  assert.equal(fixture.props.application.workflow_stage, 'refinement');
  assert.equal(fixture.props.application.status, 'refinement');
});

test('stage clicks emit once and reselecting a tab preserves explicitly chosen tracking status', async t => {
  const fixture = mount(t), setup = fixture.setup; await idle(setup);
  const persistStage = fixture.props.onChangeStage;
  const attempts: ApplicationStage[] = [];
  fixture.props.onChangeStage = stage => { attempts.push(stage); persistStage(stage); };
  setup.selectStage('refinement'); await idle(setup);
  assert.deepEqual(attempts, ['refinement']);
  assert.equal(fixture.props.application.status, 'refinement');

  fixture.props.application = { ...fixture.props.application, status: 'ready', tracking_started: true };
  setup.selectStage('refinement'); await idle(setup);
  assert.deepEqual(attempts, ['refinement', 'refinement']);
  assert.equal(fixture.props.application.status, 'ready');
  setup.selectStage('review'); await idle(setup);
  assert.deepEqual(attempts, ['refinement', 'refinement', 'review']);
  assert.equal(fixture.props.application.workflow_stage, 'review');
  assert.equal(fixture.props.application.status, 'ready');
  setup.tab = 'preparation'; await idle(setup);
  assert.deepEqual(attempts, ['refinement', 'refinement', 'review', 'preparation'], 'programmatic navigation keeps the same persistence path');
  assert.equal(fixture.props.application.status, 'ready');
});

test('stage navigation awaits personal evaluation persistence and stays in preparation on failure', async t => {
  const fixture = mount(t), setup = fixture.setup; await idle(setup);
  let release!: (saved: boolean) => void;
  let attempts = 0;
  const props = fixture.props as typeof fixture.props & { flushEvaluation?: () => Promise<boolean> };
  props.flushEvaluation = () => { attempts++; return new Promise<boolean>(resolve => { release = resolve; }); };
  await idle(setup);
  const navigation = setup.selectStage('refinement');
  await idle(setup);
  assert.equal(attempts, 1);
  assert.equal(setup.tab, 'preparation', 'the editor stays visible until its evaluation is saved');
  assert.equal(fixture.props.application.workflow_stage, 'preparation');
  release(false);
  await navigation;
  assert.equal(setup.tab, 'preparation', 'failed evaluation saving must prevent the stage change');
  const retry = setup.selectStage('refinement');
  await idle(setup);
  assert.equal(attempts, 2);
  release(true);
  await retry; await idle(setup);
  assert.equal(setup.tab, 'refinement');
  assert.equal(fixture.props.application.workflow_stage, 'refinement');
});

test('new applications and saved combined scopes select a separate document scope', async t => {
  const fixture = mount(t); await idle(fixture.setup);
  assert.equal(fixture.setup.feedbackScope, 'cv');
  await prepare(fixture, 'base', { scope: 'cv' });
  const historical = seedLegacyRound(fixture);
  const saved = JSON.parse(fixture.storage.getItem(refinementKey)!);
  saved.scope = 'both'; fixture.storage.setItem(refinementKey, JSON.stringify(saved));
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.feedbackScope, 'cv', 'an old combined scope must not return to the dropdown');
  await reopened.selectReviewProposal(historical.id);
  assert.match(reopened.reviewAcceptanceError, /separate request/);
  reopened.discardReview(); reopened.feedbackScope = 'letter'; await reopened.publishSources();
  assert.equal(reopened.error, '');
  assert.equal(reopened.requests[0].request_json.scope, 'letter');
  const again = fixture.reopen(); await idle(again);
  assert.equal(again.feedbackScope, 'letter');
});
