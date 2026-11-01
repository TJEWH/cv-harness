import assert from 'node:assert/strict';
import test from 'node:test';
import { watch } from 'vue';
import { cloneCv } from '../../../src/features/applications/applicationCv';
import { letterToEditableText } from '../../../src/documents/letter/motivationLetters';
import type { RefinementProposalV2 } from '../../../src/features/refinement/refinementTypes';
import { createPrivateRefinementCv } from '../../support/fixtures/refinement';
import { applicationId, mount, prepare, idle, documents } from '../../support/workflows/refinement';

test('publishing existing and empty letters preserves exactly the approved source text', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter', letterText: '# Application\n\nDear committee,\n\nMy approved existing draft.\n\nKind regards' });
  const first = setup.requests[0].request_json;
  assert.equal(first.letter.text, letterToEditableText(setup.letter!.working));
  assert.match(first.letter.text, /My approved existing draft/);
  setup.updateLetter(''); await setup.publishSources();
  assert.equal(setup.error, ''); assert.equal(setup.requests[0].request_json.letter.text, '');
  assert.equal(setup.localRequests[setup.requests[0].id].letterBaseline?.text, '');
  assert.match(first.letter.text, /My approved existing draft/, 'an initial-draft request never clears the older frozen source');
});

for (const scope of ['cv', 'letter'] as const) test(`${scope} temporary proposal comparisons stay read-only before reloading the current proposal`, async t => {
  const fixture = mount(t, createPrivateRefinementCv()), setup = await prepare(fixture, 'base', { scope });
  const cv = cloneCv(setup.record!.state), letter = JSON.parse(JSON.stringify(setup.letter!.working)), before = documents(setup);
  const first = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First proposed letter.' });
  await setup.checkProposals();
  if (scope !== 'letter') assert.notDeepEqual(setup.previewCvState!.bodyOrder, cv.bodyOrder);
  else assert.deepEqual(setup.previewCvState, cv);
  assert.deepEqual(setup.previewLetterContent, scope === 'cv' ? letter : { subject: '', salutation: '', body: 'First proposed letter.', closing: '' });
  if (scope === 'cv') assert.deepEqual(setup.previewLetterCvState, cv, 'the letter layout also remains unchanged');
  const proposal = first.proposal_json as RefinementProposalV2;
  if (scope !== 'letter') {
    const reorder = proposal.cvOperations.find(op => op.type === 'reorder_sections')!;
    setup.toggleProposedChange(reorder.id, false); assert.deepEqual(setup.previewCvState!.bodyOrder, cv.bodyOrder);
    setup.toggleProposedChange(reorder.id, true); assert.notDeepEqual(setup.previewCvState!.bodyOrder, cv.bodyOrder);
  }
  const candidate = JSON.stringify(setup.previewCvState);
  setup.reviewComparison = 'original'; assert.deepEqual(setup.previewCvState, cv); assert.deepEqual(setup.previewLetterContent, letter);
  setup.reviewComparison = 'proposed'; assert.equal(JSON.stringify(setup.previewCvState), candidate);
  const next = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Second proposed letter.' });
  if (scope !== 'letter') (next.proposal_json as RefinementProposalV2).cvOperations = [];
  const row = fixture.database.application_refinement_proposals.find(row => row.id === next.id)!; row.proposal_json = next.proposal_json;
  await setup.checkProposals(); assert.equal(setup.selectedProposalId, first.id);
  await setup.selectReviewProposal(next.id); assert.deepEqual(setup.previewCvState, cv);
  assert.equal(setup.previewLetterContent?.body, scope === 'cv' ? letter.body : 'Second proposed letter.');
  assert.equal(documents(setup), before);
  const reopened = fixture.reopen(); await idle(reopened);
  if (scope === 'letter') {
    assert.equal(reopened.error, '');
    assert.equal(reopened.letter!.working.body, 'Second proposed letter.', 'reloading applies the newest compatible current proposal');
    assert.deepEqual(reopened.record!.state, cv, 'letter loading preserves the private CV');
    assert.ok(reopened.localRequests[next.request_id].acceptances?.some(receipt => receipt.proposalId === next.id));
    assert.ok(reopened.letter!.revisions.some(revision => JSON.stringify(revision.content) === JSON.stringify(letter)), 'the pre-proposal working letter remains recoverable');
    const applied = documents(reopened);
    const again = fixture.reopen(); await idle(again);
    assert.deepEqual(JSON.parse(documents(again)), JSON.parse(applied), 'reloading an applied proposal is idempotent');
  } else assert.deepEqual(JSON.parse(documents(reopened)), JSON.parse(before), 'an empty CV candidate or incompatible combined request cannot change the saved documents');
});

test('synthetic CV workflow keeps different secrets and linked omissions attached through selective acceptance and reload', async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'cv' });
  const request = setup.requests[0], local = setup.localRequests[request.id], originals = JSON.stringify(local.cv), base = cloneCv(fixture.base);
  const incoming = fixture.cloud.seedProposal(request.id, {});
  const cloudBefore = JSON.stringify(fixture.database);
  await setup.checkProposals(); await idle(setup);
  assert.equal(setup.error, ''); assert.equal(JSON.stringify(fixture.database), cloudBefore);
  const preview = setup.previewCvState!, job = preview.experience.jobs.find(job => job.id === 'local-private-job-a')!;
  assert.equal(job.bullets, '- Evaluated robots with E2E South Lab.\n- Built sensors with E2E North Lab.');
  assert.equal(preview.experience.jobs[0].id, 'local-private-job-b');
  const reorder = (incoming.proposal_json as RefinementProposalV2).cvOperations.find(op => op.type === 'reorder_sections')!;
  setup.toggleProposedChange(reorder.id, false); assert.deepEqual(setup.previewCvState!.bodyOrder, base.bodyOrder);
  const shown = cloneCv(setup.previewCvState!); await setup.acceptSelectedChanges(); assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, shown); assert.deepEqual(setup.previewCvState, shown); assert.equal(fixture.creations.length, 0);
  assert.deepEqual(fixture.states.get('base'), base); assert.equal(JSON.stringify(local.cv), originals);
  setup = fixture.reopen(); await idle(setup); setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(fixture.creations.length, 0); assert.deepEqual(setup.record!.state, shown);
  for (const secret of ['E2E North Lab', 'E2E South Lab', 'E2E Omit Lab', 'private.example.invalid', 'rowan@example.invalid', 'local-private-job', 'bindings', 'baselineState', 'sourceSignatures', 'structureBindings']) assert.equal(JSON.stringify(fixture.database).includes(secret), false, `published data leaked ${secret}`);
});

for (const initial of [true, false]) test(`synthetic ${initial ? 'initial' : 'existing'} letter flow loads, previews and explicitly accepts without changing the CV`, async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'letter', letterText: initial ? '' : 'My existing working letter.' });
  const cv = cloneCv(setup.record!.state), working = JSON.stringify(setup.letter!.working);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Proposed letter for {{APPLICANT_NAME}}.' });
  await setup.checkProposals(); await idle(setup);
  assert.equal(setup.error, ''); assert.equal(setup.previewLetterContent?.body, 'Proposed letter for {{APPLICANT_NAME}}.');
  assert.equal(JSON.stringify(setup.letter!.working), working); assert.deepEqual(setup.previewCvState, cv);
  const shown = JSON.stringify(setup.previewLetterContent); await setup.acceptSelectedChanges(); assert.equal(setup.error, '');
  assert.equal(JSON.stringify(setup.letter!.working), shown); assert.deepEqual(setup.record!.state, cv); assert.equal(fixture.creations.length, 0);
  setup = fixture.reopen(); await idle(setup); setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(JSON.stringify(setup.letter!.working), shown); assert.equal(fixture.creations.length, 0);
});

for (const defect of ['unknown target', 'altered token', 'unsupported operation', 'unknown selection', 'missing source', 'missing token mapping', 'missing element mapping'] as const) test(`${defect} blocks preview/acceptance before any document mutation`, async t => {
  const fixture = mount(t, createPrivateRefinementCv()), setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  const local = setup.localRequests[setup.requests[0].id], payload = setup.proposals[0].proposal_json as RefinementProposalV2;
  if (defect === 'unknown target') payload.cvOperations[0].targetId = 'unknown';
  if (defect === 'unsupported operation') Reflect.set(payload.cvOperations[0], 'type', 'invent_achievement');
  if (defect === 'altered token') {
    assert.equal(local.request.schemaVersion, 2); if (local.request.schemaVersion !== 2) throw new Error('Expected v2');
    const range = local.request.cvStructure.ranges.find(range => range.text.includes('{{PRIVATE_'))!;
    payload.cvOperations.push({ id: 'bad-token', type: 'shorten_text', targetId: range.id, text: range.text.replace(/\{\{PRIVATE_\d+\}\}/, '{{PRIVATE_999}}'), explanation: 'Invalid token change.' });
  }
  if (defect === 'unknown selection') setup.selectedChangeIds.push('not-a-change');
  if (defect === 'missing source') delete setup.localRequests[setup.requests[0].id];
  if (defect === 'missing token mapping') { const binding = local.cv.bindings.find(binding => Object.keys(binding.tokens).length)!; binding.tokens = {}; }
  if (defect === 'missing element mapping') delete local.structureBindings;
  const before = documents(setup);
  assert.ok(setup.temporaryReview.error); assert.equal(setup.previewCvState, null); assert.equal(setup.previewLetterContent?.body, 'Original private working letter.');
  await setup.acceptSelectedChanges(); assert.ok(setup.error); assert.equal(documents(setup), before); assert.equal(fixture.creations.length, 0);
});

test('Current shows manual source changes while outdated suggestion acceptance stays blocked', async t => {
  const fixture = mount(t, createPrivateRefinementCv()), setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  setup.record!.state.about.text = 'Manual correction after publication.';
  setup.updateLetter('Manual letter correction after publication.'); await idle(setup);
  assert.deepEqual(setup.previewCvState, setup.record!.state); assert.match(setup.reviewAcceptanceError, /changed|outdated|match/i);
  const before = documents(setup); await setup.acceptSelectedChanges(); assert.match(setup.error, /changed|outdated|match/i);
  assert.equal(documents(setup), before); assert.equal(fixture.creations.length, 0);
});

test('answering an annotation changes only its saved review and leaves document/PDF inputs identical', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  const before = documents(setup), pdfInputs = JSON.stringify([setup.previewCvState, setup.previewLetterCvState, setup.previewLetterContent]);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed the synthetic experiment.', null), true);
  assert.equal(setup.proposalAnnotations.find(item => item.annotation.id === 'annotation-1')?.status, 'resolved');
  assert.equal(documents(setup), before); assert.equal(JSON.stringify([setup.previewCvState, setup.previewLetterCvState, setup.previewLetterContent]), pdfInputs);
  assert.equal(fixture.creations.length, 0);
});

test('normal export cannot serialize an unaccepted candidate and Attachments exports only approved working inputs', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  await setup.approve('cv'); await setup.approve('letter');
  const cv = cloneCv(setup.record!.state), letter = JSON.stringify(setup.letter!.working);
  setup.feedbackScope = 'cv'; await idle(setup);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Never export this unaccepted proposal.' }); await setup.checkProposals();
  const renderInputs: string[] = [];
  setup.preview = { getPdfBlob: async () => { renderInputs.push(JSON.stringify(setup.previewCvState)); return new Blob(['synthetic CV PDF']); } };
  setup.letterPreview = { getPdfBlob: async () => { renderInputs.push(JSON.stringify(setup.previewLetterContent)); return new Blob(['synthetic letter PDF']); } };
  await assert.rejects(setup.getCvPdf(), /temporary review|Attachments/);
  await setup.getLetterPdf();
  assert.deepEqual(renderInputs, [letter], 'CV review leaves the approved letter export usable');
  renderInputs.length = 0;
  assert.deepEqual(renderInputs, []);
  setup.tab = 'review'; await idle(setup); await setup.getCvPdf(); await setup.getLetterPdf();
  assert.deepEqual(renderInputs, [JSON.stringify(cv), letter]); assert.equal(setup.reviewActive, false);
  assert.equal(fixture.props.application.status, 'attachments'); assert.equal(setup.requests[0].application_id, applicationId);
});

test('attachment exports wait for the stage update to replace comparison sources before starting', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  await setup.approve('cv'); await setup.approve('letter');
  const cv = new Blob(['approved CV']), letter = new Blob(['approved letter']);
  const premature = async () => { throw new DOMException('The operation was aborted.', 'AbortError'); };
  setup.preview = { getPdfBlob: premature };
  setup.letterPreview = { getPdfBlob: premature };
  // Model Vue publishing the child sources in its pending render flush.
  const stop = watch(() => setup.tab, () => {
    setup.preview = { getPdfBlob: async () => cv };
    setup.letterPreview = { getPdfBlob: async () => letter };
  }, { flush: 'post' });
  t.after(stop);
  setup.tab = 'review';
  const exports = [setup.getCvPdf(), setup.getLetterPdf()];
  assert.deepEqual(await Promise.all(exports), [cv, letter]);
});
