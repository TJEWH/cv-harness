import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { compileSfc } from '../../support/vue/compileSfc';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import type { CvState, FieldPrivacyType } from '../../../src/documents/cv/types';
import type { PrivacyEditorContext } from '../../../src/documents/privacy/composables/privacyEditorContext';
import { cvContent } from '../../../src/features/cv-studio/domain/cvJsonBackup';
import { normalizeAnonymizationState } from '../../../src/documents/privacy/domain/anonymization';
import { privacyFieldKey } from '../../../src/documents/privacy/domain/privacyOverrides';
import { createTestState } from '../../support/fixtures/cvState';

// Compile the actual setup script to exercise committed privacy changes,
// source refreshes, and the field-reset contract used by the shared editor.
function loadPanel(): Component {
  const filename = new URL('../../../src/documents/privacy/components/AnonymizationPanel.vue', import.meta.url);
  return compileSfc(filename, { id: 'PrivacyEditorTest',
    require: (path, fallback) => path.endsWith('.vue') ? { default: {} } : fallback(path),
  }).component;
}
type Node = { parent?: Node; children: Node[] };
const node = (): Node => ({ children: [] });
const renderer = createRenderer<Node, Node>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText() {}, setElementText() {}, patchProp() {},
  parentNode: value => value.parent || null, nextSibling: () => null,
});
const Panel = loadPanel();
interface PanelSetup {
  draft: CvState;
  hasEdits: boolean;
  resetEdits(): void;
  commitDraft(): void;
  draftFields: WeakMap<object, Map<string, string>>;
  setFieldProxy(field: FieldPrivacyType, enabled: boolean): void;
  isFieldProxyChecked(field: FieldPrivacyType): boolean;
  isFieldProxyMixed(field: FieldPrivacyType): boolean;
}
function state(name = 'John Doe') {
  return createTestState({
    contact: { ...createTestState().contact, name },
    about: { text: `Worked under supervision of ${name}.` },
    experience: { jobs: [{ id: 'job', company: 'Original company', title: 'Engineer' }] },
  });
}
function mountPanel(t: TestContext, initial = state()) {
  const selection = reactive({ state: initial, lang: initial.lang });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(Panel, {
    state: selection.state, lang: selection.lang, ref: (value: unknown) => { mounted = value; },
  }) });
  app.mount(node());
  t.after(() => app.unmount());
  const instance = (mounted as { $: { setupState: PanelSetup; provides: Record<symbol, unknown> } }).$;
  const contextKey = Object.getOwnPropertySymbols(instance.provides).find(key => key.description === 'privacy-editor')!;
  return { panel: instance.setupState, selection, context: instance.provides[contextKey] as PrivacyEditorContext };
}

test('typing keeps comparisons and highlights unchanged until commit, and identical commits do not write settings', t => {
  const { panel, selection, context } = mountPanel(t);
  const initialSettings = selection.state.anonymization;
  const fieldIndex = panel.draftFields;
  for (const text of ['P', 'Pu', 'Public profile']) {
    panel.draft.about.text = text;
    assert.equal(selection.state.anonymization, initialSettings);
    assert.equal(context.field(panel.draft.about, 'text')?.changed, false);
    assert.equal(panel.draftFields, fieldIndex, 'typing never rebuilds the field index');
  }
  panel.commitDraft();
  assert.equal(context.field(panel.draft.about, 'text')?.changed, true);
  const committedSettings = selection.state.anonymization;
  assert.notEqual(committedSettings, initialSettings);
  panel.draft.about.text = 'Temporary edit';
  panel.draft.about.text = 'Public profile';
  panel.commitDraft();
  assert.equal(selection.state.anonymization, committedSettings, 'net-zero edits trigger no reactive save or PDF update');
  panel.commitDraft();
  assert.equal(selection.state.anonymization, committedSettings);
  panel.draft.about.text = selection.state.about.text;
  assert.equal(context.field(panel.draft.about, 'text')?.changed, true, 'original equality is evaluated at commit');
  panel.commitDraft();
  assert.equal(context.field(panel.draft.about, 'text')?.changed, false);
  assert.equal(selection.state.anonymization.fieldOverrides, undefined);
});

test('committing the privacy draft persists sparse changes while leaving the original content untouched', t => {
  const { panel, selection, context } = mountPanel(t);
  const before = cvContent(selection.state);
  panel.draft.about.text = 'Worked under supervision of a qualified person.';
  panel.commitDraft();
  panel.draft.experience.jobs[0].company = '';
  panel.commitDraft();
  assert.deepEqual(selection.state.anonymization.fieldOverrides, {
    [privacyFieldKey('about', 'text')]: 'Worked under supervision of a qualified person.',
    [privacyFieldKey('item', 'job', 'company')]: '',
  });
  assert.deepEqual(cvContent(selection.state), before);
  assert.equal(context.field(panel.draft.about, 'text')?.changed, true);
  assert.equal(context.field(panel.draft.experience.jobs[0], 'title')?.changed, false);
  assert.equal(panel.hasEdits, true);
});

test('field reset and reset-all restore originals and remove only the corresponding privacy edits', t => {
  const { panel, selection, context } = mountPanel(t);
  selection.state.anonymization.excludedSections = ['education'];
  panel.setFieldProxy('company', true);
  panel.draft.about.text = 'Public profile';
  panel.commitDraft();
  panel.draft.experience.jobs[0].desc = 'New public description';
  panel.commitDraft();
  context.field(panel.draft.about, 'text')!.reset();
  assert.equal(panel.draft.about.text, selection.state.about.text);
  assert.deepEqual(selection.state.anonymization.fieldOverrides, { [privacyFieldKey('item', 'job', 'desc')]: 'New public description' });
  context.field(panel.draft.experience.jobs[0], 'desc')!.reset();
  assert.equal(Object.hasOwn(panel.draft.experience.jobs[0], 'desc'), false);
  assert.equal(Object.hasOwn(selection.state.anonymization, 'fieldOverrides'), false);
  panel.draft.about.text = 'Another public profile';
  panel.commitDraft();
  panel.resetEdits();
  assert.equal(panel.draft.about.text, selection.state.about.text);
  assert.equal(panel.hasEdits, false);
  assert.deepEqual(selection.state.anonymization.proxyFields, ['company', 'institution']);
  assert.deepEqual(selection.state.anonymization.excludedSections, ['education']);
});

test('original Content updates rebuild the draft and retain independent privacy wording', t => {
  const { panel, selection } = mountPanel(t);
  panel.draft.about.text = 'Public profile';
  panel.commitDraft();
  const previousDraft = panel.draft;
  selection.state.experience.jobs[0].title = 'Lead engineer';
  selection.state.experience.jobs.push({ id: 'new-job', title: 'New role' });
  assert.notEqual(panel.draft, previousDraft);
  assert.equal(panel.draft.experience.jobs[0].title, 'Lead engineer');
  assert.equal(panel.draft.experience.jobs[1].title, 'New role');
  assert.equal(panel.draft.about.text, 'Public profile');
  assert.deepEqual(selection.state.anonymization.fieldOverrides, { [privacyFieldKey('about', 'text')]: 'Public profile' });
  assert.equal(selection.state.about.text, 'Worked under supervision of John Doe.');
});

test('switching variants or language states never carries draft wording into another document', async t => {
  const { panel, selection, context } = mountPanel(t);
  const first = selection.state;
  panel.draft.about.text = 'First public profile';
  panel.commitDraft();
  const firstDraft = panel.draft;
  const second = state('Maria Example');
  second.lang = 'de';
  selection.state = second;
  selection.lang = 'de';
  await nextTick();
  assert.equal(panel.draft.about.text, second.about.text);
  assert.equal(panel.hasEdits, false);
  assert.equal(context.language(), 'de');
  firstDraft.about.text = 'Discarded draft';
  assert.equal(selection.state.anonymization.fieldOverrides, undefined);
  panel.draft.about.text = 'Zweites öffentliches Profil';
  panel.commitDraft();
  assert.equal(first.anonymization.fieldOverrides?.[privacyFieldKey('about', 'text')], 'First public profile');
  selection.state = first;
  selection.lang = 'en';
  await nextTick();
  assert.equal(panel.draft.about.text, 'First public profile');
  assert.equal(second.anonymization.fieldOverrides?.[privacyFieldKey('about', 'text')], 'Zweites öffentliches Profil');
});

test('automatic mask switches preserve manual edits and keep the draft on original text', t => {
  const { panel, selection } = mountPanel(t);
  panel.draft.about.text = 'Public profile';
  panel.commitDraft();
  const overrides = { ...selection.state.anonymization.fieldOverrides };
  panel.setFieldProxy('company', true);
  panel.setFieldProxy('dates', true);
  panel.setFieldProxy('company', false);
  assert.deepEqual(selection.state.anonymization.proxyFields, ['dates']);
  assert.deepEqual(selection.state.anonymization.fieldOverrides, overrides);
  assert.equal(panel.draft.about.text, 'Public profile');
  assert.equal(panel.draft.experience.jobs[0].company, 'Original company');
  assert.equal(panel.draft.contact.name, 'John Doe');
});

test('a same-field manual replacement survives automatic masking and unrelated edits until explicitly reverted', t => {
  const initial = state();
  const companyKey = privacyFieldKey('item', 'job', 'company');
  initial.anonymization.fieldOverrides = { [companyKey]: 'A qualified engineering company' };
  const { panel, selection, context } = mountPanel(t, initial);
  assert.equal(panel.draft.experience.jobs[0].company, 'A qualified engineering company');
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.automaticMask, undefined);
  panel.setFieldProxy('company', true);
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.automaticMask, 'company');
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.changed, true);
  panel.draft.about.text = 'Public profile';
  panel.commitDraft();
  assert.deepEqual(selection.state.anonymization.fieldOverrides, {
    [companyKey]: 'A qualified engineering company', [privacyFieldKey('about', 'text')]: 'Public profile',
  });
  panel.setFieldProxy('company', false);
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.automaticMask, undefined);
  assert.equal(panel.draft.experience.jobs[0].company, 'A qualified engineering company');
  panel.setFieldProxy('company', true);
  context.field(panel.draft.experience.jobs[0], 'company')!.reset();
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.automaticMask, 'company');
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.changed, false);
  assert.equal(panel.draft.experience.jobs[0].company, 'Original company');
  assert.deepEqual(selection.state.anonymization.fieldOverrides, { [privacyFieldKey('about', 'text')]: 'Public profile' });
  assert.deepEqual(selection.state.anonymization.proxyFields, ['company', 'institution']);
  assert.equal(selection.state.experience.jobs[0].company, 'Original company');
});

test('Header stays automatically masked without silently deleting older manual contact replacements', t => {
  const initial = state();
  const nameKey = privacyFieldKey('contact', 'name');
  initial.anonymization.fieldOverrides = { [nameKey]: 'Applicant initials' };
  const { panel, selection, context } = mountPanel(t, initial);
  assert.equal(context.field(panel.draft.contact, 'name')?.automaticMask, 'header');
  assert.equal(context.field(panel.draft.contact, 'role')?.automaticMask, 'header');
  assert.equal(context.field(panel.draft.contact, 'email')?.automaticMask, 'header');
  assert.equal(context.field(panel.draft.contact, 'name')?.changed, true);
  panel.draft.about.text = 'Public profile';
  panel.commitDraft();
  panel.setFieldProxy('company', true);
  panel.setFieldProxy('company', false);
  selection.state.experience.jobs[0].title = 'Lead engineer';
  assert.equal(panel.draft.contact.name, 'Applicant initials');
  assert.deepEqual(selection.state.anonymization.fieldOverrides, {
    [nameKey]: 'Applicant initials', [privacyFieldKey('about', 'text')]: 'Public profile',
  });
  assert.equal(selection.state.contact.name, 'John Doe');
  context.field(panel.draft.contact, 'name')!.reset();
  assert.equal(panel.draft.contact.name, 'John Doe');
  assert.equal(context.field(panel.draft.contact, 'name')?.automaticMask, 'header');
  assert.equal(context.field(panel.draft.contact, 'name')?.changed, false);
  assert.deepEqual(selection.state.anonymization.fieldOverrides, { [privacyFieldKey('about', 'text')]: 'Public profile' });
});

test('sidebar contact visibility remains a privacy exclusion through normalization and reopening', t => {
  const { panel, selection } = mountPanel(t);
  panel.draft.disabled.push('sidebar-contact');
  assert.deepEqual(selection.state.anonymization.excludedSections, ['sidebar-contact']);
  assert.deepEqual(selection.state.disabled, []);
  normalizeAnonymizationState(selection.state);
  assert.deepEqual(selection.state.anonymization.excludedSections, ['sidebar-contact']);
  assert.ok(panel.draft.disabled.includes('sidebar-contact'));
  panel.draft.disabled = panel.draft.disabled.filter(id => id !== 'sidebar-contact');
  assert.deepEqual(selection.state.anonymization.excludedSections, []);
});


test('Institution controls company and institution masks together and represents legacy partial selection', t => {
  const { panel, selection, context } = mountPanel(t);
  selection.state.education = [{ id: 'degree', institution: 'Original institution', sub: 'Legacy institution' }];
  selection.state.anonymization.proxyFields = ['company', 'place'];
  assert.equal(panel.isFieldProxyChecked('institution'), false);
  assert.equal(panel.isFieldProxyMixed('institution'), true);
  assert.deepEqual(selection.state.anonymization.proxyFields, ['company', 'place']);
  panel.setFieldProxy('institution', true);
  assert.equal(panel.isFieldProxyChecked('institution'), true);
  assert.equal(panel.isFieldProxyMixed('institution'), false);
  assert.deepEqual(selection.state.anonymization.proxyFields, ['company', 'institution', 'place']);
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.automaticMask, 'company');
  assert.equal(context.field(panel.draft.education[0], 'institution')?.automaticMask, 'institution');
  assert.equal(context.field(panel.draft.education[0], 'sub')?.automaticMask, 'institution');
  panel.setFieldProxy('institution', false);
  assert.deepEqual(selection.state.anonymization.proxyFields, ['place']);
  assert.equal(context.field(panel.draft.experience.jobs[0], 'company')?.automaticMask, undefined);
  assert.equal(context.field(panel.draft.education[0], 'institution')?.automaticMask, undefined);
});
