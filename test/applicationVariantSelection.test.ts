import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import type { Application } from '../src/app/cloudTypes';
import type { CvState, SavedConfiguration } from '../src/documents/cv/types';
import { createSampleDocument } from '../src/features/cv-studio/domain/builtinConfigurations';
import { cloneCv, createApplicationCv, loadApplicationCv, saveApplicationCv } from '../src/features/applications/applicationCv';
import type { ApplicationCvRecord } from '../src/features/applications/applicationCv';
import { createCloudCvSnapshot } from '../src/documents/privacy/domain/cloudCvPrivacy';
import { createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES } from '../src/documents/letter/motivationLetters';
import { createRefinementFixture } from './refinementFixture';
import type { ApplicationLetter, LetterFormatting } from '../src/documents/letter/letterTypes';
import type { AnnotationStatus, LocalRefinementRequest, RefinementRequestRow, RefinementProposalRow, RefinementScope, RefinementSetup } from '../src/features/refinement/refinementTypes';

const account = '90000000-0000-4000-8000-000000000001';
const applicationId = '10000000-0000-4000-8000-000000000001';
interface WorkspaceSetup {
  record: ApplicationCvRecord | null; selectedCvId: string; letter: ApplicationLetter | null;
  busy: boolean; refreshing: boolean; syncing: boolean; error: string; saveError: string; letterText: string;
  baselineSignature: string; letterRevision: string;
  selectedTemplateId: string; missingLetterTemplate: boolean;
  cvApproved: boolean; letterApproved: boolean; feedbackScope: RefinementScope;
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; selectedProposalId: string;
  shortInstruction: string; shortInstructionNotice: string; shortInstructionError: string;
  preparedSource: LocalRefinementRequest | null; sourceError: string; outgoingFeedback: string;
  privacyContexts: import('../src/features/refinement/refinementTypes').ApprovedPrivacyContexts;
  effectiveSettings: { setup: RefinementSetup; provenance: unknown };
  currentPublishedRequest: RefinementRequestRow | null; publishedSource: RefinementRequestRow | null;
  publicationStatus: 'unpublished' | 'current' | 'outdated' | 'unverifiable';
  selectCv(id: string): Promise<void>; selectLetterTemplate(id: string): Promise<void>; saveSetup(): Promise<void>;
  publishSources(): Promise<void>; checkProposals(): Promise<void>; syncRefinement(): Promise<void>; openProposal(): void; selectReviewProposal(id: string): void;
  acceptSelectedChanges(): Promise<void>; toggleProposedChange(id: string, included: boolean): void; toggleProposedLetter(included: boolean): void; discardReview(): void;
  selectedChangeIds: string[]; includeProposedLetter: boolean; reviewActive: boolean; previewCvState: CvState | null;
  tab: 'preparation' | 'refinement' | 'review' | 'tracking'; reviewComparison: 'original' | 'proposed';
  previewLetterCvState: CvState | null; previewLetterLanguage: string; localRequests: Record<string, LocalRefinementRequest>;
  previewLetterContent: ApplicationLetter['working'] | undefined; temporaryReview: { result: { state: CvState; letterText: string } | null; error: string }; reviewAcceptanceError: string;
  proposalChanges: { id: string; type: string; status: 'proposed' | 'accepted' | 'rejected'; before: string; after: string; target: string }[];
  proposalAnnotations: (import('../src/features/refinement/domain/refinementAnnotations').AnnotationView & { referenceChanged: boolean; included: boolean })[];
  saveAnnotation(id: string, status: AnnotationStatus, response: string, previousReviewId: string | null): Promise<boolean>;
  includeAnnotationFeedback(id: string): Promise<void>;
  copyShortInstruction(): Promise<void>;
  updateLetter(text: string): void; updateLetterFormatting(formatting?: LetterFormatting): void; approve(kind: 'cv' | 'letter', reopen?: boolean): Promise<void>;
  iterationNoteEditor: { key: string; value: string; update(value: string): void };
  iterationNotes: Record<'cv' | 'letter', Record<'tone' | 'structure' | 'content', string>>;
  selectStage(stage: WorkspaceSetup['tab']): Promise<void>;
  flushTextareas(): Promise<boolean>;
}
async function idle(setup: WorkspaceSetup) {
  for (let count = 0; count < 30; count++) {
    await nextTick(); await new Promise<void>(resolve => setImmediate(resolve));
    if (!setup.busy && !setup.refreshing && !setup.syncing) return;
  }
  assert.fail('Workspace did not become idle.');
}

const filename = new URL('../src/features/applications/components/ApplicationWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'application-variant-selection' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireFromComponent = createRequire(filename);
const { registerTextareaCommit } = requireFromComponent('../../../shared/editing/textareaCommit') as typeof import('../src/shared/editing/textareaCommit');
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
  : path === '../../../platform/supabase/supabase' ? { supabaseConfiguration: { status: 'ready', url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture_only' } }
    : requireFromComponent(path), exports);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
function mount(t: TestContext, legacy?: 'unchanged' | 'tailored', missingLetterTemplate = false, defaultTemplateId?: string) {
  let unmount = () => {};
  t.after(() => unmount());
  const data = new Map<string, string>();
  const clipboardWrites: string[] = [];
  const clipboard = { writeText: async (value: string) => { clipboardWrites.push(value); } };
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  for (const [name, value] of Object.entries({ localStorage: storage, sessionStorage: storage,
    window: { addEventListener() {}, removeEventListener() {} }, navigator: { clipboard },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const base = cloneCv(createSampleDocument());
  const states = new Map([['base', base]]);
  if (legacy) {
    const record = createApplicationCv(account, applicationId, 'base', 'Research', base);
    if (legacy === 'tailored') record.state.about.text = 'Previously tailored application';
    saveApplicationCv(record);
  }
  if (missingLetterTemplate) {
    const letter = createApplicationLetter(account, applicationId, { ...DEFAULT_LETTER_TEMPLATES[0]!, id: 'removed-template' }, { content: 'legacy', theme: 'legacy' });
    delete letter.templateSnapshot;
    letter.working = { subject: 'Existing subject', salutation: 'Dear committee,', body: 'My original letter must remain available.', closing: 'Kind regards' };
    createLetterRepository(storage, account).save(letter);
  }
  const application: Application = { id: applicationId, user_id: account, opportunity_id: '20000000-0000-4000-8000-000000000001',
    context_json: { title: 'Robotics PhD', required_documents: ['CV', 'Motivation letter (maximum 400 words)', 'Transcript of records'] }, context_captured_at: new Date().toISOString(),
    cv_variant_id: null, completed_checklist_keys: [], status: 'preparation', workflow_stage: 'preparation', tracking_started: false, contact_email: null, notes: null, contacted_at: null, submitted_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const database: Record<string, Record<string, unknown>[]> = { applications: [{ ...application }], cv_variants: [] };
  const cloud = createRefinementFixture(database, account);
  const props = reactive({
    application,
    client: cloud.client, userId: account, lang: 'en', projectId: 'fixture', configurations: [{ id: 'base', name: 'Research' }] as SavedConfiguration[],
    readVersion: (id: string) => states.get(id) || null,
    publishCv: async (state: CvState) => {
      const snapshot = createCloudCvSnapshot(state);
      database.cv_variants.push({ ...snapshot, user_id: account });
      props.application = { ...props.application, cv_variant_id: snapshot.id };
      database.applications[0].cv_variant_id = snapshot.id;
      return props.application;
    },
    createVariant: (name: string, state: CvState) => {
      const id = `variant-${states.size}`;
      states.set(id, cloneCv(state)); props.configurations.push({ id, name }); return id;
    },
  });
  const component = { ...exports.default, render: () => null };
  function mountComponent() {
    let mounted: unknown;
    const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
    app.mount({}); unmount = () => app.unmount();
    return (mounted as { $: { setupState: WorkspaceSetup } }).$.setupState;
  }
  if (defaultTemplateId) createLetterRepository(storage, account).setDefaultTemplate(defaultTemplateId);
  const setup = mountComponent();
  const reopen = () => { unmount(); return mountComponent(); };
  return { setup, reopen, props, states, base, database, cloud, storage, clipboard, clipboardWrites };
}

test('application navigation commits pending textarea drafts before persisting and changing stage', async t => {
  const { setup, storage } = mount(t);
  await idle(setup);
  const unregister = registerTextareaCommit(() => { setup.iterationNotes.cv.structure = 'Move methods before education.'; });
  t.after(unregister);
  await setup.selectStage('review');
  assert.equal(setup.tab, 'review');
  assert.equal(JSON.parse(storage.getItem('CV_REFINEMENT:1:' + account + ':' + applicationId)!).iterationNotes.cv.structure, 'Move methods before education.');
});

test('a failed local textarea commit retains the application stage and pending value', async t => {
  const { setup, storage } = mount(t);
  await idle(setup);
  const originalStage = setup.tab;
  const unregister = registerTextareaCommit(() => { setup.iterationNotes.cv.structure = 'Keep this draft if storage is unavailable.'; });
  t.after(unregister);
  storage.setItem = () => { throw new Error('Synthetic storage failure'); };
  await setup.selectStage('review');
  assert.equal(setup.tab, originalStage);
  assert.equal(setup.iterationNotes.cv.structure, 'Keep this draft if storage is unavailable.');
  assert.match(setup.saveError, /Local save failed/);
});

test('an old iteration editor retains its document and field when its draft commits during a scope switch', async t => {
  const { setup } = mount(t);
  await idle(setup);
  const previousEditor = setup.iterationNoteEditor;
  assert.equal(previousEditor.key, 'cv:structure');
  setup.feedbackScope = 'letter';
  await nextTick();
  previousEditor.update('Only the CV structure should change.');
  assert.equal(setup.iterationNotes.cv.structure, 'Only the CV structure should change.');
  assert.equal(setup.iterationNotes.letter.tone, '');
  assert.equal(setup.iterationNotes.letter.structure, '');
});

test('applications freeze selected CVs and keep manual edits independent from the template library', async (t) => {
  const { setup, props, states, base, database } = mount(t);
  await idle(setup);
  await setup.selectCv('base');
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.record?.variantId, 'base');
  assert.equal(setup.record?.detached, true);
  assert.equal(database.cv_variants.length, 1, 'selection publishes an anonymized snapshot');
  assert.ok(setup.record?.publishedSnapshotId);
  assert.equal(states.size, 1);
  const edited = cloneCv(base); edited.about.text = 'Edited in CV Studio'; states.set('base', edited);
  props.configurations = [{ id: 'base', name: 'Research', mtime: 2 }];
  await nextTick();
  assert.equal(setup.record?.state.about.text, base.about.text, 'library updates cannot overwrite the application snapshot');
  setup.record!.state.about.text = 'Tailored manually for this application';
  await nextTick();
  assert.equal(states.get('base')?.about.text, 'Edited in CV Studio');
  assert.equal(states.size, 1, 'application edits never create library variants automatically');
  assert.equal(loadApplicationCv(account, applicationId)?.state.about.text, 'Tailored manually for this application');
});

test('saved CV contact changes refresh the letter header across comparisons without reselecting the template', async (t) => {
  const fixture = mount(t), { setup, states, props, cloud } = fixture;
  await idle(setup); await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.record!.state.about.text = 'Application-specific research experience.';
  setup.updateLetter('Original application letter.');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  cloud.seedProposal(setup.requests[0].id, { letterText: 'Refined application letter.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Refined application letter.', 'sync applies a letter while Preparation is open');
  await setup.approve('cv'); await setup.approve('letter');
  setup.tab = 'refinement'; await idle(setup);
  const cv = cloneCv(setup.record!.state), snapshots = JSON.stringify(setup.localRequests);
  const baseline = setup.baselineSignature, revision = setup.letterRevision;
  const source = cloneCv(states.get('base')!);
  source.contact.phone = '';
  source.contact.email = 'current-address@example.org';
  source.design.letterContactFields = ['name', 'email'];
  source.about.text = 'A library update must not replace the application copy.';
  states.set('base', source);
  props.configurations = [{ id: 'base', name: 'Research', mtime: 2 }];
  await idle(setup);
  assert.deepEqual(setup.record!.state, cv);
  assert.equal(setup.cvApproved, true);
  assert.equal(setup.letterApproved, false, 'changed sender data requires a fresh letter approval');
  assert.notEqual(setup.letterRevision, revision);
  assert.equal(setup.baselineSignature, baseline, 'header updates do not invalidate the published writing source');
  assert.equal(JSON.stringify(setup.localRequests), snapshots, 'private reconstruction snapshots remain immutable');
  for (const comparison of ['original', 'proposed'] as const) {
    setup.reviewComparison = comparison;
    assert.equal(setup.previewLetterCvState?.contact.phone, '');
    assert.equal(setup.previewLetterCvState?.contact.email, 'current-address@example.org');
    assert.deepEqual(setup.previewLetterCvState?.design.letterContactFields, ['name', 'email']);
  }
  setup.tab = 'review'; await idle(setup);
  assert.equal(setup.previewLetterCvState?.contact.phone, '');
  assert.equal(setup.previewLetterContent?.body, 'Refined application letter.');
  assert.equal(loadApplicationCv(account, applicationId)?.letterHeaderSource?.contact.phone, '');
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.previewLetterCvState?.contact.phone, '');
  assert.equal(reopened.letterApproved, false);
  assert.deepEqual(reopened.record!.state, cv);
});

test('opening an existing application refreshes its sender and retains the last header if its source is removed', async (t) => {
  const fixture = mount(t), { setup, states, props } = fixture;
  await idle(setup); await setup.selectCv('base');
  setup.record!.state.contact.role = 'Application-specific role';
  const source = cloneCv(states.get('base')!);
  source.contact.phone = '';
  source.contact.role = 'Updated general CV role';
  source.design.letterContactFields = [];
  states.set('base', source);
  let reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.previewLetterCvState?.contact.phone, '');
  assert.equal(reopened.previewLetterCvState?.contact.role, 'Application-specific role');
  assert.deepEqual(reopened.previewLetterCvState?.design.letterContactFields, []);
  states.delete('base'); props.configurations = [];
  await idle(reopened);
  reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.previewLetterCvState?.contact.phone, '', 'deleting the source must not restore a removed contact field');
  assert.deepEqual(reopened.previewLetterCvState?.design.letterContactFields, []);
  assert.equal(reopened.error, '');
});

test('tailored legacy application CVs remain intact as independent copies', async (t) => {
  const { setup, states } = mount(t, 'tailored');
  await idle(setup);
  assert.equal(setup.record?.variantId, undefined);
  assert.equal(setup.record?.detached, true);
  assert.equal(setup.record?.state.about.text, 'Previously tailored application');
  assert.equal(states.size, 1);
});

test('new applications select the preferred letter and reopening preserves that choice after the default changes', async (t) => {
  const fixture = mount(t, undefined, false, 'industry');
  await idle(fixture.setup);
  assert.equal(fixture.setup.selectedTemplateId, 'industry');
  assert.equal(fixture.setup.letter?.maxWords, 350);
  assert.equal(fixture.setup.letterText, '');
  assert.equal(fixture.setup.record, null);
  assert.equal(fixture.database.cv_variants.length, 0, 'default selection only creates a local letter');
  createLetterRepository(fixture.storage, account).setDefaultTemplate('research');
  const reopened = fixture.reopen();
  await idle(reopened);
  assert.equal(reopened.selectedTemplateId, 'industry');
});

test('letter selection saves immediately before a CV is chosen and survives reopening', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  assert.equal(setup.selectedCvId, '');
  assert.equal(setup.selectedTemplateId, 'research', 'a new application selects its default letter');
  await setup.selectLetterTemplate('industry');
  assert.equal(setup.error, '');
  assert.equal(setup.selectedTemplateId, 'industry');
  assert.equal(setup.letter?.templateSnapshot?.id, 'industry');
  assert.equal(setup.record, null);
  setup.updateLetter('My existing letter must survive choosing a CV.');
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.selectedTemplateId, 'industry');
  assert.equal(setup.letterText, 'My existing letter must survive choosing a CV.');
  await setup.selectCv('base');
  assert.equal(setup.error, '');
  assert.equal(setup.selectedCvId, 'base');
  assert.equal(fixture.database.application_refinement_state.length, 1);
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.selectedCvId, 'base');
  assert.equal(setup.selectedTemplateId, 'industry');
  assert.equal(setup.letterText, 'My existing letter must survive choosing a CV.');
});

test('letter formatting persists locally, leaves writing requests unchanged and respects editing locks', async (t) => {
  const fixture = mount(t);
  const { setup } = fixture;
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  setup.updateLetter('My research experience supports this PhD application.');
  const requestContent = () => JSON.parse(JSON.stringify(setup.preparedSource?.request, (key, value) => key === 'requestId' ? 'request-id' : value));
  const source = requestContent();
  const baseline = setup.baselineSignature;
  const revision = setup.letterRevision;
  const formatting = { marginMm: 25, fontSizePt: 12, lineHeight: 1.5 };
  setup.updateLetterFormatting(formatting);
  await nextTick();
  assert.equal(setup.baselineSignature, baseline);
  assert.notEqual(setup.letterRevision, revision, 'PDF/approval revision tracks formatting');
  assert.deepEqual(requestContent(), source, 'AI request content excludes layout settings');
  assert.deepEqual(createLetterRepository(fixture.storage, account).load(applicationId)?.formatting, formatting);
  for (const lock of ['busy', 'reviewActive'] as const) {
    setup[lock] = true;
    setup.updateLetterFormatting();
    assert.deepEqual(setup.letter?.formatting, formatting);
    setup[lock] = false;
  }
  await setup.approve('letter');
  assert.equal(setup.error, '');
  assert.equal(setup.letterApproved, true);
  setup.updateLetterFormatting();
  assert.deepEqual(setup.letter?.formatting, formatting, 'approved letters are locked until reopened');
  await setup.approve('letter', true);
  setup.updateLetterFormatting();
  await nextTick();
  assert.equal(setup.letter?.formatting, undefined);
  assert.equal(setup.letter?.finalRevisionId, null);
  assert.equal(setup.letterRevision, revision, 'reset renders the original general defaults');
  setup.updateLetterFormatting(formatting);
  const reopened = fixture.reopen();
  await idle(reopened);
  assert.deepEqual(reopened.letter?.formatting, formatting);
  assert.equal(reopened.letterApproved, false);
});

test('letter approval follows sender visibility and selected contact fields without tracking unrelated CV sections', async (t) => {
  const { setup } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  setup.updateLetter('My research experience supports this PhD application.');
  const state = setup.record!.state;
  state.disabled = state.disabled.filter(section => section !== 'header');
  state.design.letterContactFields = ['name', 'email'];
  await nextTick();
  await setup.approve('letter');
  assert.equal(setup.error, '');
  assert.equal(setup.letterApproved, true);
  const visibleRevision = setup.letterRevision;

  state.disabled = state.disabled.includes('about') ? state.disabled.filter(section => section !== 'about') : [...state.disabled, 'about'];
  await nextTick();
  assert.equal(setup.letterRevision, visibleRevision, 'unrelated CV section visibility does not change the rendered letter');
  assert.equal(setup.letterApproved, true);

  state.disabled = [...state.disabled, 'header'];
  await nextTick();
  assert.notEqual(setup.letterRevision, visibleRevision, 'hiding the sender changes the letter revision');
  assert.equal(setup.letterApproved, false, 'a letter with a changed sender must be reviewed again');

  state.disabled = state.disabled.filter(section => section !== 'header');
  await nextTick();
  assert.equal(setup.letterApproved, false, 'restoring the sender does not silently restore approval');
  await setup.approve('letter');
  assert.equal(setup.error, '');
  assert.equal(setup.letterApproved, true);
  const approvedRevision = setup.letterRevision;
  setup.record!.state.design.letterContactFields = ['name'];
  await nextTick();
  assert.notEqual(setup.letterRevision, approvedRevision, 'changing selected sender details changes the letter revision');
  assert.equal(setup.letterApproved, false);
  assert.equal(setup.letterText, 'My research experience supports this PhD application.', 'header choices do not rewrite the letter');
});

test('unchanged legacy application copies stay pinned instead of rejoining their original variant', async (t) => {
  const { setup, states } = mount(t, 'unchanged');
  await idle(setup);
  assert.equal(setup.record?.variantId, undefined);
  assert.equal(setup.record?.detached, true);
  assert.equal(states.size, 1);
});

test('legacy letters whose original template is missing require an explicit replacement without losing wording', async (t) => {
  const { setup, database } = mount(t, 'unchanged', true);
  await idle(setup);
  const original = JSON.parse(JSON.stringify(setup.letter));
  assert.equal(setup.missingLetterTemplate, true);
  assert.equal(setup.selectedTemplateId, '');
  await assert.rejects(setup.saveSetup(), /original letter template is unavailable.*Select a template in Preparation/);
  assert.equal(database.cv_variants.length, 0, 'missing template blocks publishing preparation');
  assert.equal(database.application_refinement_state.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(setup.letter)), original, 'failed setup keeps the entire legacy record intact');
  await setup.selectLetterTemplate('research');
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.missingLetterTemplate, false);
  assert.equal(setup.letter?.templateSnapshot?.id, 'research');
  assert.deepEqual(JSON.parse(JSON.stringify(setup.letter?.working)), original.working);
  assert.equal(database.application_refinement_state.length, 1, 'explicit replacement can be saved normally');
});

test('one CV selector accepts saved variants and library autosaves preserve the application copy', async (t) => {
  const { setup, props, states, base } = mount(t);
  await idle(setup);
  states.set('other', cloneCv(base)); states.set('other-child', cloneCv(base));
  props.configurations.push({ id: 'other', name: 'Other path' }, { id: 'other-child', name: 'Other application' });
  await setup.selectCv('base');
  await idle(setup);
  await setup.selectCv('other-child');
  const updated = cloneCv(base); updated.about.text = 'Saved while choosing another CV';
  states.set('other-child', updated);
  props.configurations = props.configurations.map(item => ({ ...item, mtime: 20 }));
  await nextTick();
  assert.equal(setup.record?.state.about.text, base.about.text, 'the application still uses its frozen CV snapshot');
  assert.equal(setup.selectedCvId, 'other-child');
  assert.equal(setup.record?.variantId, 'other-child');
});

test('refinement preserves manual fixes and accumulates letter-only feedback while retaining CV approval', async (t) => {
  const { setup, states, database, cloud, clipboardWrites } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.letter!.maxWords = 400;
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(clipboardWrites.length, 0, 'publishing sources must not copy a task');
  assert.equal(database.application_refinement_protocols.length, 0, 'publishing sources must not publish a protocol');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].request_json.letter.maxWords, 400);
  const firstProposal = cloud.seedProposal(setup.requests[0].id);
  await setup.checkProposals(); setup.selectedProposalId = firstProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(states.size, 1, 'accepting the reviewed CV leaves the variant library unchanged');
  assert.ok(setup.letterText.includes('Human-Centred Robotics'));
  setup.record!.state.about.text += '\nManual CV correction retained.';
  setup.updateLetter(setup.letterText + '\n\nManual letter correction retained.');
  await nextTick();
  await setup.approve('cv');
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true);
  assert.equal(setup.feedbackScope, 'letter');
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Avoid generic claims and retain my manual corrections.', null), true);
  await setup.publishSources();
  assert.equal(setup.error, '');
  const second = setup.requests[0];
  assert.equal(second.request_json.scope, 'letter');
  assert.equal(second.request_json.feedback.length, 2, 'include the resolved answer and the other pending question');
  assert.equal(second.request_json.feedback[0].scope, 'letter');
  assert.equal(second.request_json.feedback[0].annotation?.proposalId, firstProposal.id);
  assert.ok(second.request_json.letter.text.includes('Manual letter correction retained.'));
  assert.ok(second.request_json.cv.fields.some(field => field.text.includes('Manual CV correction retained.')));
  const secondProposal = cloud.seedProposal(second.id);
  assert.deepEqual(secondProposal.proposal_json.cvOperations, []);
  await setup.checkProposals(); setup.selectedProposalId = secondProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true, 'letter-only revisions preserve CV approval');
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Keep the closing concise as well.', null), true);
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.feedback.length, 4);
  assert.deepEqual(setup.requests[0].request_json.feedback.filter(item => /Status: resolved/.test(item.text)).map(item => item.annotation?.proposalId), [firstProposal.id, secondProposal.id]);
  const thirdProposal = cloud.seedProposal(setup.requests[0].id, { overLimit: true });
  await setup.checkProposals(); setup.selectedProposalId = thirdProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  await setup.approve('letter');
  assert.equal(setup.error, '', 'word count is advisory and does not block approval');
  assert.equal(setup.cvApproved, true);
  assert.equal(setup.letterApproved, true);
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'feedback').length, 4);
  setup.updateLetter(setup.letterText + '\nA further manual change.');
  await nextTick();
  assert.equal(setup.letterApproved, false, 'changing an approved letter reopens its review');
  assert.equal(setup.cvApproved, true);
});

test('CV-only refinement preserves private letter wording and its approval', async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  const originalText = `Dear selection committee,\n\nI am interested in the advertised research.\n\nKind regards,\n${setup.record!.state.contact.name}`;
  setup.updateLetter(originalText);
  setup.feedbackScope = 'cv'; await setup.publishSources();
  assert.equal(setup.error, '');
  const request = setup.requests[0];
  assert.equal(request.request_json.scope, 'cv');
  assert.notEqual(request.request_json.letter.text, originalText, 'published identity is anonymized');
  await setup.approve('letter');
  assert.equal(setup.letterApproved, true);
  const approved = JSON.stringify(setup.letter);
  const proposed = cloud.seedProposal(request.id, { letterText: request.request_json.letter.text });
  await setup.checkProposals(); setup.selectedProposalId = proposed.id; setup.openProposal(); await setup.acceptSelectedChanges();
  await nextTick();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, originalText, 'an unchanged public letter must not replace its private local wording');
  assert.equal(setup.letterApproved, true, 'a CV-only content change retains letter approval');
  assert.equal(JSON.stringify(setup.letter), approved, 'unchanged approved letters retain their exact final revision and history');
});

test('answering an annotation never applies an unopened proposal over newer manual corrections', async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('A manually drafted letter before the request.');
  setup.feedbackScope = 'letter';
  await setup.publishSources();
  const proposed = cloud.seedProposal(setup.requests[0].id);
  await setup.checkProposals(); setup.selectedProposalId = proposed.id;
  setup.discardReview();
  setup.updateLetter('Newer manual correction must be the starting point.');
  setup.record!.state.about.text += '\nNewer CV correction.';
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Keep my updated wording and make the closing more precise.', null), true);
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Newer manual correction must be the starting point.');
  assert.equal(setup.requests[0].request_json.letter.text, setup.letterText);
  assert.ok(setup.requests[0].request_json.cv.fields.some(field => field.text.includes('Newer CV correction.')));
  assert.equal(setup.requests[0].request_json.feedback.length, 2);
});

test('superseded feedback rounds remain viewable but cannot replace documents with the same baseline', async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('The current manual letter stays unchanged until I open an eligible proposal.');
  setup.feedbackScope = 'letter';
  await setup.publishSources();
  const firstRequest = setup.requests[0];
  const olderProposal = cloud.seedProposal(firstRequest.id);
  await setup.checkProposals(); setup.selectedProposalId = olderProposal.id;
  const baselineCv = JSON.stringify(setup.record!.state);
  const baselineLetter = JSON.stringify(setup.letter);

  // Feedback alone supersedes the request: the CV and letter baseline remains identical.
  setup.discardReview();
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Do not use the generic opening from the previous proposal.', null), true);
  await setup.publishSources();
  assert.equal(setup.error, '');
  const currentRequest = setup.requests[0];
  assert.notEqual(currentRequest.id, firstRequest.id);
  assert.equal(currentRequest.request_json.feedback.length, 2);
  assert.deepEqual(currentRequest.request_json.cv.fields, firstRequest.request_json.cv.fields);
  assert.equal(currentRequest.request_json.letter.text, firstRequest.request_json.letter.text);
  setup.selectedProposalId = olderProposal.id;
  setup.openProposal();
  assert.equal(setup.error, '', 'historical proposal previews remain available');
  assert.match(setup.reviewAcceptanceError, /superseded round/);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /superseded round/);
  assert.equal(JSON.stringify(setup.record!.state), baselineCv);
  assert.equal(JSON.stringify(setup.letter), baselineLetter);
  assert.ok(setup.proposals.some(item => item.id === olderProposal.id), 'the older proposal remains in review history');

  const currentProposal = cloud.seedProposal(currentRequest.id);
  await setup.checkProposals(); setup.selectedProposalId = currentProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '', 'the current proposal is still eligible for explicit application');
});

test('copying the short instruction follows server code and scope changes without publishing preparation or requests', async (t) => {
  const { setup, props, database, clipboardWrites } = mount(t);
  await idle(setup);
  const before = JSON.stringify(database);
  assert.equal(setup.shortInstruction, `phd-workflow: ${applicationId} — refine CV.`);
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), setup.shortInstruction);
  assert.ok(setup.shortInstructionNotice);
  assert.equal(setup.shortInstructionError, '');

  props.application = { ...props.application, application_code: 'SERVER-CaseSensitive_29' };
  setup.feedbackScope = 'cv'; await nextTick();
  assert.equal(setup.shortInstruction, 'phd-workflow: SERVER-CaseSensitive_29 — refine CV.');
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), 'phd-workflow: SERVER-CaseSensitive_29 — refine CV.');

  props.application = { ...props.application, context_json: { ...props.application.context_json, title: 'A renamed PhD opportunity' } };
  setup.feedbackScope = 'letter'; await nextTick();
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), 'phd-workflow: SERVER-CaseSensitive_29 — refine motivation letter.');
  assert.equal(JSON.stringify(database), before, 'copying must not save setup, publish snapshots, or start a refinement round');
  assert.equal(setup.requests.length, 0);
  assert.equal(database.application_refinement_protocols.length, 0, 'copying the short instruction is independent of publishing the full protocol');
});

test('clipboard failures remain local to the short instruction and can be retried without cloud mutations', async (t) => {
  const { setup, database, clipboard, clipboardWrites } = mount(t);
  await idle(setup);
  const before = JSON.stringify(database);
  setup.error = 'Existing application synchronization error.';
  clipboard.writeText = async () => { throw new Error('Clipboard permission denied.'); };
  await setup.copyShortInstruction();
  assert.ok(setup.shortInstructionError);
  assert.equal(setup.shortInstructionNotice, '');
  assert.equal(setup.error, 'Existing application synchronization error.');
  assert.equal(JSON.stringify(database), before);

  clipboard.writeText = async (value: string) => { clipboardWrites.push(value); };
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), setup.shortInstruction);
  assert.equal(setup.shortInstructionError, '');
  assert.ok(setup.shortInstructionNotice);
  assert.equal(JSON.stringify(database), before);
});

test('publishing an initial round uses the same selected scope as the copied short instruction', async (t) => {
  const { setup, clipboardWrites } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.feedbackScope = 'letter'; await nextTick();
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), `phd-workflow: ${applicationId} — refine motivation letter.`);
  assert.equal(setup.requests.length, 0, 'copy alone must not publish the selected scope');
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.scope, 'letter');
  const firstRequestId = setup.requests[0].id;

  setup.feedbackScope = 'cv'; await nextTick();
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), `phd-workflow: ${applicationId} — refine CV.`);
  assert.equal(setup.requests[0].id, firstRequestId, 'a different copy selection still must not mutate the published round');
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.scope, 'cv');
  assert.notEqual(setup.requests[0].id, firstRequestId, 'a scope change requires its own immutable request');
});

test('published sources contain the complete private-filtered working letter and effective application settings', async (t) => {
  const { setup } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.record!.state.contact.name = 'Dr Ada Example';
  setup.record!.state.contact.email = 'ada.private@example.org';
  setup.letter!.language = 'de';
  setup.letter!.maxWords = 400;
  setup.letter!.instructions = 'Focus on experiments; contact ada.private@example.org. Omit !!private instruction!!.';
  setup.letter!.templateSnapshot!.exampleText = 'Reference opening for Dr Ada Example. !!private example!!';
  const completeLetter = '# A specific research application\n\nDear committee,\n\n'
    + 'A documented experiment demonstrates careful research. '.repeat(320)
    + '\n\nKeep this final paragraph intact. Contact ada.private@example.org. !!confidential detail!!\n\nKind regards,\nDr Ada Example';
  setup.updateLetter(completeLetter);
  const privateWorking = JSON.stringify(setup.letter!.working);
  assert.equal(setup.sourceError, '');
  assert.equal(setup.effectiveSettings.setup.language, 'de');
  assert.equal(setup.effectiveSettings.setup.maxWords, 400);
  const sourcePreview = setup.preparedSource!.request;
  await setup.publishSources();
  assert.equal(setup.error, '');
  const request = setup.requests[0].request_json;
  assert.equal(request.letter.text, setup.letterText
    .replaceAll('ada.private@example.org', '{{APPLICANT_EMAIL}}')
    .replaceAll('Dr Ada Example', '{{APPLICANT_NAME}}'));
  assert.ok(request.letter.text.includes('Keep this final paragraph intact.'), 'the complete working letter is published, not an excerpt');
  assert.equal(request.letter.language, 'de');
  assert.equal(request.letter.maxWords, 400);
  assert.notEqual(request.letter.language, request.letter.template.language, 'application language overrides the template default');
  assert.equal(request.cv.instructions, 'Focus on experiments; contact {{APPLICANT_EMAIL}}. Omit !!private instruction!!.');
  assert.equal(request.letter.template.exampleText, 'Reference opening for {{APPLICANT_NAME}}. !!private example!!');
  assert.deepEqual(request.letter, sourcePreview.letter, 'the source overview matches the letter/settings actually published');
  assert.deepEqual(request.cv.fields, sourcePreview.cv.fields);
  assert.equal(request.cv.instructions, sourcePreview.cv.instructions);
  assert.equal(JSON.stringify(setup.letter!.working), privateWorking, 'publication never rewrites private working text');
});

test('reopening syncs corrected working sources while preserving documents and keeping stale proposals unapplied', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('The local working letter that survives reopening.');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  const previousRequest = JSON.parse(JSON.stringify(setup.requests[0]));
  fixture.cloud.seedProposal(previousRequest.id);
  setup.updateLetter('A newer local correction, independent of the pending proposal.');
  setup.record!.state.about.text += '\nA newer local CV correction.';
  await nextTick();
  const documents = JSON.parse(JSON.stringify({ cv: setup.record, letter: setup.letter }));
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  documents.cv.publishedState = documents.cv.state;
  documents.cv.publishedSnapshotId = fixture.props.application.cv_variant_id;
  assert.deepEqual(JSON.parse(JSON.stringify({ cv: setup.record, letter: setup.letter })), documents);
  assert.equal(setup.requests.length, 2);
  assert.notEqual(setup.requests[0].id, previousRequest.id);
  assert.equal(setup.requests[0].request_json.letter.text, 'A newer local correction, independent of the pending proposal.');
  assert.deepEqual(setup.requests[1], previousRequest, 'the older immutable request remains unchanged');
  assert.equal(setup.proposals.length, 1, 'a returned proposal remains available for explicit review');
  assert.ok(fixture.database.application_refinement_reviews.every(row => row.kind === 'feedback'), 'only pending questions are recorded; the stale proposal was not applied');
  assert.equal(setup.requests[0].request_json.feedback.length, 2);
  const database = JSON.stringify(fixture.database);
  await setup.checkProposals();
  assert.equal(setup.error, '');
  assert.deepEqual(JSON.parse(JSON.stringify({ cv: setup.record, letter: setup.letter })), documents);
  assert.equal(JSON.stringify(fixture.database), database, 'refreshing must not publish another request or change settings');
});

test('publishing unchanged current sources reuses the same request without cloud mutations after reopening', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('The unchanged letter to reuse for the published round.');
  await setup.publishSources();
  assert.equal(setup.error, '');
  const originalRequest = JSON.stringify(setup.requests[0]);
  const originalInstruction = setup.shortInstruction;
  const database = JSON.stringify(fixture.database);
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(JSON.stringify(setup.requests[0]), originalRequest);
  assert.equal(setup.shortInstruction, originalInstruction);
  assert.equal(JSON.stringify(fixture.database), database, 'reusing a request must not increment the state revision or republish snapshots');
  setup = fixture.reopen();
  await idle(setup);
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(JSON.stringify(setup.requests[0]), originalRequest);
  assert.equal(setup.shortInstruction, originalInstruction);
  assert.equal(JSON.stringify(fixture.database), database);
});

test('changes mark the published source outdated without changing its immutable receipt', async (t) => {
  const { setup, database } = mount(t);
  await idle(setup);
  assert.equal(setup.publicationStatus, 'unpublished');
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  const originalText = 'Current letter with deliberate wording.';
  setup.updateLetter(originalText);
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.publicationStatus, 'current');
  const receipt = JSON.stringify(setup.publishedSource);
  const cloudBefore = JSON.stringify(database);

  setup.updateLetter(originalText + '\nA local amendment.');
  assert.equal(setup.publicationStatus, 'outdated');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  setup.updateLetter(originalText);
  assert.equal(setup.publicationStatus, 'current');

  const originalLanguage = setup.letter!.language;
  setup.letter!.language = originalLanguage === 'de' ? 'en' : 'de';
  assert.equal(setup.publicationStatus, 'outdated');
  setup.letter!.language = originalLanguage;
  assert.equal(setup.publicationStatus, 'current');
  setup.feedbackScope = 'cv';
  assert.equal(setup.publicationStatus, 'unpublished', 'CV has its own publication');
  setup.feedbackScope = 'letter';
  setup.letter!.instructions = 'Add more emphasis on reproducible experiments.';
  assert.equal(setup.publicationStatus, 'outdated');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  assert.equal(JSON.stringify(database), cloudBefore, 'source changes remain local until explicitly published');
});

test('proposal selection and explicit application keep the published source separate from returned drafts', async (t) => {
  const { setup, cloud, database } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('My published source letter.');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  const request = setup.requests[0];
  const first = cloud.seedProposal(request.id, { letterText: 'First returned draft.' });
  const second = cloud.seedProposal(request.id, { letterText: 'Second returned draft.' });
  await setup.checkProposals();
  const receipt = JSON.stringify(setup.publishedSource);
  const sourceRows = JSON.stringify(database.application_refinement_requests);
  const documents = JSON.stringify({ cv: setup.record, letter: setup.letter });
  setup.selectedProposalId = first.id;
  assert.equal(setup.publicationStatus, 'current');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  setup.selectedProposalId = second.id;
  assert.equal(JSON.stringify({ cv: setup.record, letter: setup.letter }), documents, 'selecting a proposal is read-only');
  assert.equal(setup.currentPublishedRequest?.id, request.id);
  assert.equal(setup.publishedSource?.request_json.letter.text, 'My published source letter.');
  setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Second returned draft.');
  assert.equal(setup.preparedSource?.request.letter.text, 'Second returned draft.');
  assert.equal(setup.publicationStatus, 'outdated');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  assert.equal(JSON.stringify(database.application_refinement_requests), sourceRows);
});

test('reopening preserves a deliberately empty local working letter instead of restoring old source text', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('An older source letter already published.');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  setup.updateLetter('');
  const previousRequest = JSON.parse(JSON.stringify(setup.requests[0]));
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, '');
  assert.equal(setup.publicationStatus, 'current');
  assert.equal(setup.requests.length, 2);
  assert.equal(setup.requests[0].request_json.letter.text, '');
  assert.deepEqual(setup.requests[1], previousRequest, 'syncing the empty draft preserves its older immutable source');
});

test('a missing working letter stays absent while its proposal previews from the exact local snapshot', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter(`The source text remains available when this device has no letter.\n\nKind regards,\n${setup.record!.state.contact.name}`);
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  const sourceText = setup.requests[0].request_json.letter.text;
  assert.notEqual(sourceText, setup.letterText, 'the saved source has identity placeholders');
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'A temporary proposed letter.' });
  const before = JSON.stringify(fixture.database);
  fixture.storage.removeItem(`cv.letters.v1:${account}:application:${applicationId}`);
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.letter, null, 'fetching history never promotes a public source to a local working draft');
  assert.equal(fixture.storage.getItem(`cv.letters.v1:${account}:application:${applicationId}`), null);
  setup.tab = 'refinement'; await idle(setup);
  assert.equal(setup.previewLetterContent?.body, 'A temporary proposed letter.');
  assert.match(setup.reviewAcceptanceError, /restore.*local source documents/);
  assert.equal(setup.requests.length, 1);
  assert.equal(JSON.stringify(fixture.database), before);
});

test('an unreadable local letter is reported and preserved instead of being replaced by cloud source text', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('Published letter before a local storage problem.');
  await setup.publishSources();
  assert.equal(setup.error, '');
  const before = JSON.stringify(fixture.database);
  const key = `cv.letters.v1:${account}:application:${applicationId}`;
  const refinementKey = `CV_REFINEMENT:1:${account}:${applicationId}`;
  const savedRefinement = fixture.storage.getItem(refinementKey);
  const unreadable = '{"working":"recoverable unfinished local text"';
  fixture.storage.setItem(key, unreadable);
  setup = fixture.reopen();
  await idle(setup);
  await setup.checkProposals();
  assert.ok(setup.saveError, 'a local read error must remain visible');
  assert.equal(setup.letter, null);
  assert.equal(fixture.storage.getItem(key), unreadable, 'cloud loading cannot overwrite recoverable local data');
  assert.equal(fixture.storage.getItem(refinementKey), savedRefinement, 'a failed load cannot discard saved private request bindings');
  assert.equal(JSON.stringify(fixture.database), before);
});

test('reverting to an older published baseline creates a new current request instead of reviving its old round', async (t) => {
  const { setup, database } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('Baseline A: retain this exact wording.');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  const first = JSON.parse(JSON.stringify(setup.requests[0])) as RefinementRequestRow;
  setup.updateLetter('Baseline B: a later deliberate revision.');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  const second = setup.requests[0];
  assert.notEqual(second.id, first.id);
  setup.updateLetter('Baseline A: retain this exact wording.');
  assert.equal(setup.publicationStatus, 'outdated');
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  const third = setup.requests[0];
  assert.notEqual(third.id, first.id, 'an old immutable round cannot become current again through idempotent replay');
  assert.notEqual(third.id, second.id);
  assert.equal(third.request_json.letter.text, first.request_json.letter.text);
  assert.equal(setup.requests.length, 3);
  assert.equal(setup.publicationStatus, 'current');
  assert.equal(setup.currentPublishedRequest?.id, third.id);
  assert.equal(database.application_refinement_state[0].current_letter_request_id, third.id);
  assert.deepEqual(JSON.parse(JSON.stringify(setup.requests.find(item => item.id === first.id))), first);
});

test('a cold reopen retains a letter-only published scope and reuses its current request', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('A letter-only round selected without locking the CV.');
  setup.feedbackScope = 'letter';
  await setup.publishSources();
  assert.equal(setup.error, '');
  const requestId = setup.requests[0].id;
  const before = JSON.stringify(fixture.database);
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.feedbackScope, 'letter');
  assert.equal(setup.publicationStatus, 'current');
  assert.equal(setup.currentPublishedRequest?.id, requestId);
  await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].id, requestId);
  assert.equal(JSON.stringify(fixture.database), before);
});


test('loaded structured changes immediately preview without accepting, and each toggle updates only temporary state', async (t) => {
  const { setup, cloud, database, base, storage } = mount(t);
  await idle(setup);
  await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research'); setup.updateLetter('Existing local letter.'); setup.feedbackScope = 'cv'; await setup.publishSources();
  const before = JSON.stringify({ record: setup.record, letter: setup.letter });
  const savedBefore = storage.getItem('CV_REFINEMENT:1:' + account + ':' + applicationId);
  const proposal = cloud.seedProposal(setup.requests[0].id, { letterText: 'Proposed letter immediately visible.' });
  assert.equal(proposal.proposal_json.schemaVersion, 2);
  await setup.checkProposals();
  assert.equal(setup.reviewActive, true, 'loading immediately enables the proposal preview');
  assert.notDeepEqual(setup.previewCvState?.bodyOrder, base.bodyOrder);
  assert.equal(setup.previewLetterContent?.body, 'Existing local letter.');
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), before);
  assert.ok(setup.proposalChanges.every(change => change.status === 'proposed'));
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 0);
  const reorder = setup.proposalChanges.find(change => change.type === 'reorder_sections')!;
  assert.ok(reorder);
  setup.toggleProposedChange(reorder.id, false);
  assert.deepEqual(setup.previewCvState?.bodyOrder, base.bodyOrder, 'deselecting immediately restores the original section order in preview');
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), before);
  assert.deepEqual(JSON.parse(storage.getItem('CV_REFINEMENT:1:' + account + ':' + applicationId)!).requests, JSON.parse(savedBefore!).requests, 'proposal selection only updates review navigation');
  assert.ok(setup.proposalChanges.every(change => change.status === 'proposed'), 'exclusion from preview is not rejection');
  const accepted = [...setup.selectedChangeIds];
  const result = cloneCv(setup.previewCvState!);
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.record?.state, result);
  assert.equal(setup.letterText, 'Existing local letter.');
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.cvApproved, false);
  const decision = database.application_refinement_reviews.find(row => row.kind === 'cv_decisions')!;
  assert.deepEqual((decision.payload as { accepted: string[] }).accepted, accepted);
  assert.deepEqual((decision.payload as { rejected: string[] }).rejected, [reorder.id]);
  assert.equal(setup.proposalChanges.find(change => change.id === reorder.id)?.status, 'rejected');
  assert.ok(setup.proposalChanges.filter(change => accepted.includes(change.id)).every(change => change.status === 'accepted'));
});

test('Current stays visible without a review mode and manual corrections block outdated application after reload', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup); await setup.selectCv('base'); await idle(setup); await setup.selectLetterTemplate('research');
  setup.updateLetter('Retained manual letter.'); await setup.publishSources(); const proposal = fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.checkProposals();
  const original = JSON.stringify({ record: setup.record, letter: setup.letter });
  const current = cloneCv(setup.previewCvState!);
  setup.discardReview();
  assert.equal(setup.reviewActive, false);
  assert.deepEqual(setup.previewCvState, current);
  setup.openProposal();
  assert.equal(setup.reviewActive, true);
  assert.deepEqual(JSON.parse(JSON.stringify({ record: setup.record, letter: setup.letter })), JSON.parse(original));
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 0);
  setup.discardReview(); setup.record!.state.about.text = 'New manual correction supersedes the request.'; await nextTick();
  const corrected = JSON.parse(JSON.stringify({ record: setup.record, letter: setup.letter }));
  setup = fixture.reopen(); await idle(setup);
  assert.deepEqual(JSON.parse(JSON.stringify({ record: setup.record, letter: setup.letter })), corrected, 'reloading preserves manual edits while the existing CV proposal stays pending');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].id, proposal.request_id);
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 0);
  await setup.selectReviewProposal(proposal.id);
  assert.ok(setup.temporaryReview.result, 'an old proposal remains viewable against its frozen source');
  assert.match(setup.reviewAcceptanceError, /changed after this request/);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /changed after this request/);
  assert.equal(setup.record!.state.about.text, 'New manual correction supersedes the request.');
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 0);
});

test('failed decision recording leaves selected changes proposed and working copies unchanged for retry', async (t) => {
  const { setup, cloud, database, props } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup); await setup.selectLetterTemplate('research');
  await setup.publishSources(); cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  const before = JSON.stringify({ record: setup.record, letter: setup.letter });
  const client = props.client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
  const rpc = client.rpc.bind(client);
  client.rpc = async (name, args) => name === 'save_refinement_review' && args.p_kind === 'cv_decisions' ? { data: null, error: new Error('Temporary connection failure') } : rpc(name, args);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /Temporary connection failure/);
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), before);
  assert.equal(setup.reviewActive, true);
  assert.ok(setup.proposalChanges.every(change => change.status === 'proposed'));
  client.rpc = rpc;
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 1);
});


test('invalid returned structural targets are rejected before preview rendering or document mutation', async (t) => {
  const { setup, cloud, database } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup); await setup.selectLetterTemplate('research');
  await setup.publishSources(); const row = cloud.seedProposal(setup.requests[0].id);
  const stored = database.application_refinement_proposals.find(item => item.id === row.id)!;
  (stored.proposal_json as { cvOperations: { targetId: string }[] }).cvOperations[0].targetId = 'unknown-area';
  const before = JSON.stringify({ cv: setup.record, letter: setup.letter });
  await setup.checkProposals();
  assert.match(setup.error, /permutation|target/);
  assert.equal(setup.proposals.length, 0);
  assert.equal(setup.reviewActive, false);
  assert.equal(JSON.stringify({ cv: setup.record, letter: setup.letter }), before);
});


test('answering and resolving annotations persists across reload without changing either document or its preview', async (t) => {
  const fixture = mount(t); let setup = fixture.setup;
  await idle(setup); await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research'); setup.updateLetter('Working letter.'); setup.feedbackScope = 'letter'; await setup.publishSources();
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.syncRefinement(); await idle(setup);
  assert.equal(setup.error, '');
  const reviewsBefore = fixture.database.application_refinement_reviews.length;
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 1);
  const before = JSON.parse(JSON.stringify({ record: setup.record, letter: setup.letter, cv: setup.previewCvState, previewLetter: setup.previewLetterContent }));
  assert.equal(setup.proposalAnnotations[0].status, 'open');
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Used controlled experiments with !!private lab!!.', null), true);
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].response, 'Used controlled experiments with !!private lab!!.');
  assert.deepEqual(JSON.parse(JSON.stringify({ record: setup.record, letter: setup.letter, cv: setup.previewCvState, previewLetter: setup.previewLetterContent })), before);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(setup.proposalAnnotations[0].response, 'Used controlled experiments with !!private lab!!.');
  assert.deepEqual(JSON.parse(JSON.stringify({ record: setup.record, letter: setup.letter })), { record: before.record, letter: before.letter });
  assert.equal(fixture.database.application_refinement_reviews.length, reviewsBefore + 2);
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 1, 'reloading annotation feedback does not apply the same proposal again');
});

test('only resolved answers enter feedback automatically, retaining references in subsequent requests', async (t) => {
  const { setup, cloud, database } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research'); await setup.publishSources(); cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed experiments.', null);
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'feedback').length, 1);
  await setup.includeAnnotationFeedback('annotation-1'); await setup.includeAnnotationFeedback('annotation-1');
  await setup.includeAnnotationFeedback('annotation-2');
  assert.equal(setup.error, '');
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'feedback').length, 1, 'resolved feedback is idempotent and open comments stay excluded');
  setup.discardReview(); await setup.publishSources();
  assert.equal(setup.error, '');
  const feedback = setup.requests[0].request_json.feedback;
  assert.equal(feedback.length, 1); assert.ok(feedback.every(item => item.annotation?.proposalId === setup.proposals[0].id));
  assert.equal(feedback[0].annotation?.reviewId, setup.proposalAnnotations[0].reviewId);
  assert.match(feedback[0].text, /Confirmed experiments/);
  assert.equal(setup.letterText, '', 'feedback never becomes working letter content');
});

test('manual letter edits invalidate annotation references without moving notes or adding them to the PDF content', async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research'); setup.feedbackScope = 'letter'; await setup.publishSources(); cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  assert.equal(setup.proposalAnnotations[1].referenceChanged, false);
  await setup.acceptSelectedChanges(); assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[1].referenceChanged, false);
  setup.updateLetter('Manually corrected wording.'); await nextTick();
  assert.equal(setup.proposalAnnotations[1].referenceChanged, true);
  assert.equal(setup.previewLetterContent?.body, 'Manually corrected wording.');
  assert.ok(!JSON.stringify(setup.previewLetterContent).includes('Confirm the project-specific'));
});

test('stale annotation updates and failed saves preserve documents and do not claim success', async (t) => {
  const { setup, cloud, database, props } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup);
  await setup.selectLetterTemplate('research'); setup.feedbackScope = 'letter'; await setup.publishSources(); cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  await setup.saveAnnotation('annotation-1', 'resolved', 'First answer.', null);
  const before = JSON.stringify({ record: setup.record, letter: setup.letter });
  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', 'Stale answer.', null), false);
  assert.match(setup.error, /changed elsewhere/);
  const rpc = props.client.rpc;
  props.client.rpc = (async () => ({ data: null, error: new Error('Offline') })) as unknown as typeof rpc;
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Unsaved response.', null), false);
  assert.equal(setup.proposalAnnotations[1].status, 'open');
  props.client.rpc = rpc;
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Unsaved response.', null), true);
  assert.equal(database.application_refinement_reviews.length, 4);
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), before);
});

test('Previous keeps the published baseline and Current preserves manual working edits', async (t) => {
  const { setup, cloud, storage } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup); await setup.selectLetterTemplate('research');
  setup.letter!.working = { subject: 'Research interest', salutation: 'To the research committee:', body: 'The original private working letter.', closing: 'With sincere interest,\nPrivate applicant' };
  setup.feedbackScope = 'cv'; await setup.publishSources();
  const baselineCv = cloneCv(setup.record!.state);
  setup.record!.state.about.text = 'A new manual CV correction.';
  setup.record!.state.contact.role = 'A newer local role';
  setup.updateLetter('A newer manual letter correction.');
  const working = JSON.stringify({ record: setup.record, letter: setup.letter });
  const stored = storage.getItem('CV_REFINEMENT:1:' + account + ':' + applicationId);
  const proposal = cloud.seedProposal(setup.requests[0].id, { letterText: 'Proposed letter from the original source.' });
  await setup.checkProposals();
  assert.equal(setup.selectedProposalId, proposal.id);
  assert.equal(setup.reviewComparison, 'proposed');
  assert.equal(setup.previewLetterContent?.body, 'A newer manual letter correction.');
  assert.equal(setup.previewLetterCvState?.contact.role, 'A newer local role', 'letter comparisons keep the current sender');
  assert.match(setup.reviewAcceptanceError, /changed after this request/);
  const candidate = cloneCv(setup.previewCvState!);
  setup.reviewComparison = 'original'; await nextTick();
  assert.deepEqual(setup.previewCvState, baselineCv);
  assert.deepEqual(setup.previewLetterContent, setup.letter!.working);
  setup.reviewComparison = 'proposed'; await nextTick();
  assert.deepEqual(setup.previewCvState, candidate);
  assert.deepEqual(setup.previewLetterContent, setup.letter!.working, 'the other document remains on its current saved content');
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), working);
  assert.deepEqual(JSON.parse(storage.getItem('CV_REFINEMENT:1:' + account + ':' + applicationId)!).requests, JSON.parse(stored!).requests);
});

for (const scope of ['cv', 'letter'] as const) test(`${scope}-only proposals leave the other document preview on its working source`, async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup); await setup.selectLetterTemplate('research');
  setup.updateLetter('Existing letter.'); setup.feedbackScope = scope; await setup.publishSources();
  const baselineCv = cloneCv(setup.record!.state);
  setup.record!.state.contact.role = 'Manual role after publication';
  setup.updateLetter('Manual letter after publication.');
  cloud.seedProposal(setup.requests[0].id, { letterText: 'Proposed letter.' }); await setup.checkProposals();
  assert.equal(setup.reviewActive, scope === 'cv', 'letter comparison remains available without locking the editor');
  if (scope === 'cv') {
    assert.deepEqual(setup.previewLetterContent, setup.letter!.working);
    assert.deepEqual(setup.previewLetterCvState, setup.record!.state);
    assert.deepEqual(setup.previewCvState, setup.record!.state, 'Current keeps manual edits instead of replaying outdated suggestions');
    setup.reviewComparison = 'original';
    assert.deepEqual(setup.previewLetterContent, setup.letter!.working);
    assert.deepEqual(setup.previewLetterCvState, setup.record!.state);
    assert.deepEqual(setup.previewCvState, baselineCv);
  } else {
    assert.deepEqual(setup.previewCvState, setup.record!.state);
    assert.equal(setup.previewLetterContent?.body, 'Proposed letter.');
    assert.equal(setup.previewLetterCvState?.contact.role, 'Manual role after publication');
    setup.reviewComparison = 'original';
    assert.deepEqual(setup.previewCvState, setup.record!.state);
    assert.equal(setup.previewLetterContent?.body, 'Existing letter.');
  }
});

test('missing private mappings remain a comparison error across scope revisits without altering documents', async (t) => {
  const { setup, cloud, database } = mount(t);
  await idle(setup); await setup.selectCv('base'); await idle(setup); await setup.selectLetterTemplate('research');
  setup.updateLetter('Existing letter.'); setup.feedbackScope = 'cv'; await setup.publishSources();
  const request = setup.requests[0]; cloud.seedProposal(request.id);
  setup.localRequests[request.id].cv.bindings = [];
  const original = JSON.stringify({ record: setup.record, letter: setup.letter });
  await setup.checkProposals();
  assert.equal(setup.reviewActive, true);
  assert.match(setup.temporaryReview.error, /mapping|binding/i);
  assert.equal(setup.previewCvState, null);
  assert.deepEqual(setup.previewLetterContent, setup.letter!.working);
  assert.ok(setup.reviewAcceptanceError);
  setup.reviewComparison = 'original';
  assert.equal(setup.previewCvState, null, 'invalid reconstruction is not disguised as an original/proposed comparison');
  setup.discardReview();
  assert.equal(setup.previewCvState, null);
  assert.deepEqual(setup.previewLetterContent, setup.letter!.working);
  setup.tab = 'review'; await nextTick(); setup.tab = 'refinement'; await idle(setup);
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.previewCvState, null);
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), original);
  assert.equal(database.application_refinement_reviews.length, 0);
});
