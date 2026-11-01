import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import type { LetterTemplate } from '../../../src/documents/letter/letterTypes';
import { cloneCv } from '../../../src/features/applications/applicationCv';
import { createLetterRepository } from '../../../src/documents/letter/motivationLetters';
import { account, applicationId, idle, mount, prepare, seedLegacyRound } from '../../support/workflows/refinement';

type Fixture = ReturnType<typeof mount>;
const requireComponent = createRequire(new URL('../../../src/features/applications/components/ApplicationWorkspace.vue', import.meta.url));
const { registerTextareaCommit } = requireComponent('../../../shared/editing/textareaCommit') as typeof import('../../../src/shared/editing/textareaCommit');

function pauseNextHistoryLoad(fixture: Fixture) {
  let release = () => {}, started = () => {}, paused = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const loading = new Promise<void>(resolve => { started = resolve; });
  const from = fixture.cloud.client.from.bind(fixture.cloud.client);
  fixture.cloud.client.from = ((table: string) => {
    const result = from(table);
    if (table === 'application_refinement_requests' && !paused) {
      paused = true;
      const query = result as unknown as { then(resolve: (value: unknown) => unknown, reject?: (cause: unknown) => unknown): Promise<unknown> };
      const then = query.then.bind(query);
      query.then = (resolve, reject) => then(async value => { started(); await gate; return value; }).then(resolve, reject);
    }
    return result;
  }) as typeof fixture.cloud.client.from;
  return { loading, release };
}

function updateSourceCv(fixture: Fixture, text = 'The latest reusable CV content.') {
  const source = cloneCv(fixture.states.get('base')!);
  source.about.text = text;
  fixture.states.set('base', source);
  return source;
}

function updateSourceTemplate(fixture: Fixture, updates: Partial<LetterTemplate> = {}) {
  const repository = createLetterRepository(fixture.storage, account);
  const current = repository.listTemplates().find(template => template.id === 'research')!;
  return repository.saveTemplate({ ...current, researchInterests: 'Updated research interests from the reusable template.', ...updates });
}

test('reopening replaces both pristine snapshots from their selected sources despite existing published requests', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  const originalRequest = setup.requests[0];
  const originalLocal = JSON.parse(JSON.stringify(setup.localRequests[originalRequest.id]));
  const revision = setup.record!.revision;
  const source = updateSourceCv(fixture);
  const template = updateSourceTemplate(fixture, { language: 'de', maxWords: 650 });

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, source);
  assert.deepEqual(setup.record!.baseState, source);
  assert.equal(setup.selectedCvId, 'base');
  assert.ok(setup.record!.revision > revision);
  assert.deepEqual(setup.letter!.templateSnapshot, template);
  assert.equal(setup.selectedTemplateId, 'research');
  assert.equal(setup.letter!.language, 'de');
  assert.equal(setup.letter!.maxWords, 650);
  assert.equal(setup.letterText, '');
  assert.deepEqual(setup.requests.find(row => row.id === originalRequest.id), originalRequest, 'historical published requests stay immutable');
  assert.deepEqual(setup.localRequests[originalRequest.id], originalLocal, 'historical private reconstruction snapshots stay immutable');
  assert.equal(fixture.creations.length, 0, 'refreshing an application does not create another library variant');
});

test('reopening unchanged sources is idempotent for document snapshots and published requests', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  updateSourceCv(fixture); updateSourceTemplate(fixture);
  setup = fixture.reopen(); await idle(setup);
  const record = JSON.parse(JSON.stringify(setup.record));
  const letter = JSON.parse(JSON.stringify(setup.letter));
  const requests = JSON.parse(JSON.stringify(setup.requests));

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record, record);
  assert.deepEqual(setup.letter, letter);
  assert.deepEqual(setup.requests, requests);
});

test('reactivating an open application refreshes its untouched snapshots', async t => {
  const fixture = mount(t);
  const setup = await prepare(fixture, 'base', { letterText: '' });
  const props = fixture.props as typeof fixture.props & { active?: boolean };
  props.active = false; await idle(setup);
  const source = updateSourceCv(fixture);
  const template = updateSourceTemplate(fixture);

  props.active = true; await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, source);
  assert.deepEqual(setup.letter!.templateSnapshot, template);
});

for (const scope of ['cv', 'letter'] as const) {
  test(`an existing ${scope} proposal protects only its own source snapshot on reopen`, async t => {
    const fixture = mount(t);
    let setup = await prepare(fixture, 'base', { letterText: '', scope });
    const originalCv = cloneCv(setup.record!.state);
    const originalTemplate = JSON.parse(JSON.stringify(setup.letter!.templateSnapshot));
    fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'The existing refined letter.' });
    const source = updateSourceCv(fixture);
    const template = updateSourceTemplate(fixture);

    setup = fixture.reopen(); await idle(setup);

    assert.equal(setup.error, '');
    assert.deepEqual(setup.record!.state, scope === 'cv' ? originalCv : source);
    assert.deepEqual(setup.letter!.templateSnapshot, scope === 'letter' ? originalTemplate : template);
  });
}

test('an uncleared legacy combined proposal protects both source snapshots', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  const originalCv = cloneCv(setup.record!.state);
  const originalTemplate = JSON.parse(JSON.stringify(setup.letter!.templateSnapshot));
  seedLegacyRound(fixture);
  updateSourceCv(fixture); updateSourceTemplate(fixture);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, originalCv);
  assert.deepEqual(setup.letter!.templateSnapshot, originalTemplate);
});

test('manual application content protects its own document when the reusable sources change', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: 'My manually written application letter.' });
  setup.record!.state.about.text = 'A manual application-specific CV adjustment.';
  setup.persist();
  const originalCv = cloneCv(setup.record!.state);
  const originalTemplate = JSON.parse(JSON.stringify(setup.letter!.templateSnapshot));
  updateSourceCv(fixture); updateSourceTemplate(fixture);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, originalCv);
  assert.deepEqual(setup.letter!.templateSnapshot, originalTemplate);
  assert.equal(setup.letterText, 'My manually written application letter.');
});

test('refreshing a pristine letter preserves application instructions, formatting, and nondefault settings', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  setup.letter!.instructions = 'Keep my application-specific instruction.';
  setup.letter!.language = 'fr';
  setup.letter!.maxWords = 325;
  setup.letter!.formatting = { marginMm: 22, fontSizePt: 12, lineHeight: 1.4 };
  setup.persist();
  const template = updateSourceTemplate(fixture, { language: 'de', maxWords: 650, formatting: { marginMm: 18, fontSizePt: 11, lineHeight: 1.2 } });

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.letter!.templateSnapshot, template);
  assert.equal(setup.letter!.instructions, 'Keep my application-specific instruction.');
  assert.equal(setup.letter!.language, 'fr');
  assert.equal(setup.letter!.maxWords, 325);
  assert.deepEqual(setup.letter!.formatting, { marginMm: 22, fontSizePt: 12, lineHeight: 1.4 });
});

test('an approved CV stays frozen while an untouched letter can refresh', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  await setup.approve('cv');
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true);
  const originalCv = cloneCv(setup.record!.state);
  updateSourceCv(fixture);
  const template = updateSourceTemplate(fixture);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, originalCv);
  assert.deepEqual(setup.letter!.templateSnapshot, template);
});

test('a successful CV history reset allows replacing a restored pre-request manual baseline on reopen', async t => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup); await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.record!.state.about.text = 'The manual baseline captured before the first refinement.';
  setup.feedbackScope = 'cv'; await setup.publishSources();
  fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.syncRefinement(); await setup.clearRefinementHistory();
  assert.equal(setup.error, '');
  assert.equal(setup.record!.state.about.text, 'The manual baseline captured before the first refinement.');
  const source = updateSourceCv(fixture);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, source);
  assert.deepEqual(setup.record!.baseState, source);
});

test('a successful letter history reset can refresh the template despite retained revision backups', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'The refined letter before resetting history.' });
  await setup.syncRefinement(); await setup.clearRefinementHistory();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, '');
  assert.ok(setup.letter!.revisions.length > 0);
  const revisions = JSON.parse(JSON.stringify(setup.letter!.revisions));
  const template = updateSourceTemplate(fixture);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.letter!.templateSnapshot, template);
  assert.deepEqual(setup.letter!.revisions, revisions);
  assert.equal(setup.letterText, '');
});

test('missing reusable sources retain the existing application snapshots', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  const record = JSON.parse(JSON.stringify(setup.record));
  const letter = JSON.parse(JSON.stringify(setup.letter));
  fixture.props.configurations = [];
  fixture.states.delete('base');
  const templatesKey = [...fixture.data.keys()].find(key => key.endsWith(':templates'));
  // Materialize the library first when it still uses the built-in defaults.
  if (templatesKey) fixture.storage.setItem(templatesKey, '[]');
  else {
    updateSourceTemplate(fixture);
    fixture.storage.setItem([...fixture.data.keys()].find(key => key.endsWith(':templates'))!, '[]');
  }

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record, record);
  assert.deepEqual(setup.letter, letter);
});

test('failed cloud history loading preserves both snapshots until eligibility can be checked', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  const record = JSON.parse(JSON.stringify(setup.record));
  const letter = JSON.parse(JSON.stringify(setup.letter));
  updateSourceCv(fixture); updateSourceTemplate(fixture);
  const from = fixture.cloud.client.from.bind(fixture.cloud.client);
  fixture.cloud.client.from = ((table: string) => {
    if (table === 'application_refinement_requests') throw new Error('History temporarily unavailable.');
    return from(table);
  }) as typeof fixture.cloud.client.from;

  setup = fixture.reopen(); await idle(setup);

  assert.match(setup.error, /History temporarily unavailable/);
  assert.deepEqual(setup.record, record);
  assert.deepEqual(setup.letter, letter);
});

test('pending textarea drafts typed during history loading commit before either snapshot can refresh', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  const originalBase = cloneCv(setup.record!.baseState);
  const originalTemplate = JSON.parse(JSON.stringify(setup.letter!.templateSnapshot));
  updateSourceCv(fixture); updateSourceTemplate(fixture);
  const history = pauseNextHistoryLoad(fixture);
  setup = fixture.reopen();
  await history.loading;
  let pending = true;
  const unregister = registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    setup.record!.state.about.text = 'A CV draft typed while history was loading.';
    setup.updateLetter('A letter draft typed while history was loading.');
  });
  t.after(unregister);

  history.release(); await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(pending, false);
  assert.equal(setup.record!.state.about.text, 'A CV draft typed while history was loading.');
  assert.deepEqual(setup.record!.baseState, originalBase);
  assert.equal(setup.letterText, 'A letter draft typed while history was loading.');
  assert.deepEqual(setup.letter!.templateSnapshot, originalTemplate);
  const savedCv = JSON.parse(fixture.storage.getItem(`CV_APPLICATION:1:${account}:${applicationId}`)!);
  assert.equal(savedCv.state.about.text, setup.record!.state.about.text, 'the draft reaches persistence before the replacement decision');
});

test('a failed local snapshot write rolls back both documents and allows a fresh reopen to retry', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  const originalRecord = JSON.parse(JSON.stringify(setup.record));
  const originalLetter = JSON.parse(JSON.stringify(setup.letter));
  const originalRequests = JSON.parse(JSON.stringify(setup.requests));
  const source = updateSourceCv(fixture);
  const template = updateSourceTemplate(fixture);
  const history = pauseNextHistoryLoad(fixture);
  setup = fixture.reopen();
  await history.loading;
  fixture.failSave(`cv.letters.v1:${account}:application:${applicationId}`);

  history.release(); await idle(setup);

  assert.match(setup.error || setup.saveError, /Local storage quota reached/);
  assert.deepEqual(setup.record, originalRecord);
  assert.deepEqual(setup.letter, originalLetter);
  assert.deepEqual(setup.requests, originalRequests, 'a failed replacement cannot publish a new request');
  assert.deepEqual(JSON.parse(fixture.storage.getItem(`CV_APPLICATION:1:${account}:${applicationId}`)!), originalRecord, 'the earlier CV write is rolled back when the letter write fails');
  assert.deepEqual(createLetterRepository(fixture.storage, account).load(applicationId), originalLetter);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, source);
  assert.deepEqual(setup.letter!.templateSnapshot, template);
});

test('successful history clearing retains reset eligibility when the following cloud read fails', async t => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup); await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.record!.state.about.text = 'The pre-request manual CV baseline.';
  setup.feedbackScope = 'cv'; await setup.publishSources();
  const requestId = setup.requests[0].id;
  fixture.cloud.seedProposal(requestId);
  await setup.syncRefinement();
  const from = fixture.cloud.client.from.bind(fixture.cloud.client);
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let cleared = false;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(name, args);
    if (name === 'clear_refinement_history' && !result.error) cleared = true;
    return result;
  }) as unknown as typeof fixture.cloud.client.rpc;
  fixture.cloud.client.from = ((table: string) => {
    if (cleared && table === 'application_refinement_requests') throw new Error('Read after successful clear failed.');
    return from(table);
  }) as typeof fixture.cloud.client.from;

  await setup.clearRefinementHistory();

  assert.equal(cleared, true);
  assert.match(setup.error, /Read after successful clear failed/);
  assert.equal(fixture.database.application_refinement_requests.some(row => row.id === requestId), false, 'the reset succeeded in the shared history');
  assert.equal(setup.record!.state.about.text, 'The pre-request manual CV baseline.');
  fixture.cloud.client.from = from;
  fixture.cloud.client.rpc = rpc;
  const source = updateSourceCv(fixture);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, source, 'a failed follow-up read does not discard the successful reset receipt');
  assert.deepEqual(setup.record!.baseState, source);
});

test('retrying Sync after a failed opening fetch refreshes sources in the same workspace', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: '' });
  const originalCv = cloneCv(setup.record!.state);
  const source = updateSourceCv(fixture);
  const template = updateSourceTemplate(fixture);
  const from = fixture.cloud.client.from.bind(fixture.cloud.client);
  fixture.cloud.client.from = ((table: string) => {
    if (table === 'application_refinement_requests') throw new Error('The opening history fetch failed.');
    return from(table);
  }) as typeof fixture.cloud.client.from;
  setup = fixture.reopen(); await idle(setup);
  assert.match(setup.error, /opening history fetch failed/);
  assert.deepEqual(setup.record!.state, originalCv);
  fixture.cloud.client.from = from;

  await setup.syncRefinement(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, source);
  assert.deepEqual(setup.letter!.templateSnapshot, template);
});

test('refreshing only the pristine CV body preserves an unrelated approved letter', async t => {
  const fixture = mount(t);
  let setup = await prepare(fixture, 'base', { letterText: 'An independently approved application letter.' });
  await setup.approve('letter');
  assert.equal(setup.error, '');
  assert.equal(setup.letterApproved, true);
  const letter = JSON.parse(JSON.stringify(setup.letter));
  const revision = (setup as typeof setup & { letterRevision: string }).letterRevision;
  const approval = setup.approvals.letter;
  const source = updateSourceCv(fixture, 'A newer CV research description that does not affect the letter header or layout.');

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.deepEqual(setup.record!.state, source);
  assert.equal((setup as typeof setup & { letterRevision: string }).letterRevision, revision);
  assert.deepEqual(setup.letter, letter);
  assert.equal(setup.approvals.letter, approval);
  assert.equal(setup.letterApproved, true);
});
