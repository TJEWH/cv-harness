import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES, DEFAULT_REFINEMENT_SYSTEM_PROMPT } from '../src/documents/letter/motivationLetters';
import type { LetterFormatting, LetterTemplate } from '../src/documents/letter/letterTypes';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { useSharedSearchSource } from '../src/features/meta-search/composables/useSharedSearchSource';
import { createSearchTemplate, createSearchTemplateRepository } from '../src/features/meta-search/data/searchTemplateRepository';
import { useToasts, useToastWatch } from '../src/shared/ui/useToasts';
import * as textareaCommit from '../src/shared/editing/textareaCommit';
import * as editorSession from '../src/shared/editing/editorSession';

const filename = new URL('../src/features/letter-templates/components/LetterTemplateEditor.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'letter-template-autosave' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : path.endsWith('/useToasts') ? { useToasts, useToastWatch } : path.endsWith('/textareaCommit') ? textareaCommit : path.endsWith('/editorSession') ? editorSession : requireComponent(path), exports);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
interface Editor {
  form: LetterTemplate; selectedId: string; saveStatus: string; error: string; isImporting: boolean;
  select(id: string): void; create(): void; flushSave(): boolean; flush(): boolean;
  updateFormatting(value: LetterFormatting | undefined): void;
  sharedSearchSource: ReturnType<typeof useSharedSearchSource>; sharedInterestsState: string;
  reloadSharedResearchInterests(): Promise<void>; updateResearchInterestSource(): void;
  importLibrary(event: Event): Promise<void>;
}

function importFixture(t: TestContext, templates?: LetterTemplate[]) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const data = new Map<string, string>();
  if (templates) data.set('cv.letters.v1:owner:templates', JSON.stringify(templates));
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const restoreGlobals: (() => void)[] = [];
  for (const [name, value] of Object.entries({ localStorage: storage, window: new EventTarget() })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restoreGlobals.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  const props = reactive({ userId: 'owner', lang: 'en', client: null as SupabaseClient | null });
  let instance: unknown;
  const component = { ...exports.default, render: () => null };
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { instance = value; } }) });
  app.mount({});
  let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  t.after(() => { try { unmount(); useToasts().clear(); } finally { restoreGlobals.forEach(restore => restore()); } });
  const owner = createLetterRepository(storage, 'owner');
  return { exposed: instance as { flush(): boolean }, storage, editor: (instance as { $: { setupState: Editor } }).$.setupState, props, owner, data, unmount };
}

function pendingImport() {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>(finish => { resolve = finish; });
  const input = { files: [{ text: () => pending }], value: 'library.json' };
  return { event: { target: input } as unknown as Event, input, resolve };
}

test('template formatting autosaves, survives selection and resets to general defaults', t => {
  const { editor, owner } = importFixture(t);
  const formatting = { marginMm: 25, fontSizePt: 12, lineHeight: 1.5, headerNameSizePt: 22 };
  editor.updateFormatting(formatting);
  t.mock.timers.tick(250);
  assert.deepEqual(owner.defaultTemplate()?.formatting, formatting);
  editor.select('industry'); editor.select('research');
  assert.deepEqual(editor.form.formatting, formatting);
  editor.updateFormatting(undefined);
  t.mock.timers.tick(250);
  assert.equal(owner.defaultTemplate()?.formatting, undefined);
  editor.select('industry'); editor.select('research');
  assert.equal(editor.form.formatting, undefined);
});

test('saving another field from an older editor preserves research interests saved in another tab', t => {
  const { editor, owner } = importFixture(t);
  const interests = 'Reliable sensing and learning from human demonstrations.';
  owner.saveTemplate({ ...owner.defaultTemplate()!, researchInterests: interests });
  assert.equal(editor.form.researchInterests, '', 'the open editor still has the old snapshot');

  editor.form.tone = 'Use concrete examples and direct language.';
  assert.equal(editor.flushSave(), true);
  assert.equal(owner.defaultTemplate()?.researchInterests, interests);
  assert.equal(editor.form.researchInterests, interests);
  assert.equal(owner.defaultTemplate()?.tone, editor.form.tone);

  editor.select('industry'); editor.select('research');
  assert.equal(editor.form.researchInterests, interests);
  editor.form.researchInterests = '';
  assert.equal(editor.flushSave(), true);
  assert.equal(owner.defaultTemplate()?.researchInterests, '', 'an explicit clear still saves');
});

test('selecting a template reads the latest saved research interests', t => {
  const { editor, owner } = importFixture(t);
  editor.select('industry');
  const interests = 'Reproducible robot learning.';
  owner.saveTemplate({ ...owner.defaultTemplate()!, researchInterests: interests });
  editor.select('research');
  assert.equal(editor.form.researchInterests, interests);
});

test('conflicting research-interest edits keep both the saved version and local draft', t => {
  const { editor, owner } = importFixture(t);
  const interests = 'Research interests saved in the other tab.';
  owner.saveTemplate({ ...owner.defaultTemplate()!, researchInterests: interests });
  editor.form.researchInterests = 'My pending research interests.';
  assert.equal(editor.flushSave(), false);
  assert.equal(editor.saveStatus, 'error');
  assert.match(editor.error, /another tab/i);
  assert.equal(owner.defaultTemplate()?.researchInterests, interests);
  assert.equal(editor.form.researchInterests, 'My pending research interests.');
  editor.select('industry');
  assert.equal(editor.selectedId, 'research', 'a conflict must keep the draft open');
});

test('a lazy research-interest draft is published before merging another field and switching templates', t => {
  const { editor, owner } = importFixture(t);
  owner.saveTemplate({ ...owner.defaultTemplate()!, tone: 'Tone saved in another tab.' });
  let pending = true;
  const unregister = textareaCommit.registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    editor.form.researchInterests = 'My research interests before navigating.';
    editor.flushSave();
  });
  try {
    editor.form.name = 'My research template';
    editor.select('industry');
    assert.equal(owner.defaultTemplate()?.researchInterests, 'My research interests before navigating.');
    assert.equal(owner.defaultTemplate()?.tone, 'Tone saved in another tab.');
    assert.equal(owner.defaultTemplate()?.name, 'My research template');
    assert.equal(editor.selectedId, 'industry');
  } finally { unregister(); }
});

test('refinement prompts default in the editor and retain custom or cleared values across autosave and selection', t => {
  const { refinementSystemPrompt: _prompt, ...legacy } = DEFAULT_LETTER_TEMPLATES[0]!;
  const { editor, owner } = importFixture(t, [legacy,
    { ...legacy, id: 'custom', refinementSystemPrompt: 'Prioritize evidence for the central research narrative.' },
    { ...legacy, id: 'empty', refinementSystemPrompt: '' },
  ]);
  assert.equal(editor.form.refinementSystemPrompt, DEFAULT_REFINEMENT_SYSTEM_PROMPT);
  t.mock.timers.tick(250);
  assert.equal(owner.defaultTemplate()?.refinementSystemPrompt, DEFAULT_REFINEMENT_SYSTEM_PROMPT);
  editor.select('custom');
  assert.equal(editor.form.refinementSystemPrompt, 'Prioritize evidence for the central research narrative.');
  editor.form.refinementSystemPrompt = 'Ask for a concrete example before including a vague answer.';
  editor.select('empty');
  assert.equal(owner.listTemplates().find(item => item.id === 'custom')?.refinementSystemPrompt, 'Ask for a concrete example before including a vague answer.');
  assert.equal(editor.form.refinementSystemPrompt, '');
  editor.select('custom'); editor.form.refinementSystemPrompt = '';
  editor.select('research'); editor.select('custom');
  assert.equal(editor.form.refinementSystemPrompt, '', 'an intentionally cleared prompt must not be reset');
  editor.create();
  assert.equal(owner.listTemplates().find(item => item.id === editor.selectedId)?.refinementSystemPrompt, DEFAULT_REFINEMENT_SYSTEM_PROMPT);
});

test('only one letter library import runs at a time and edits made during the read are saved', async t => {
  const { editor, owner } = importFixture(t);
  const library = owner.exportTemplates();
  const initialCount = owner.listTemplates().length;
  const selectedId = editor.selectedId;
  const first = pendingImport();
  const importing = editor.importLibrary(first.event);
  assert.equal(editor.isImporting, true);
  assert.equal(first.input.value, '', 'the same file can be selected again after this attempt');
  let extraReads = 0;
  for (let i = 0; i < 10; i++) await editor.importLibrary({ target: { files: [{ text: async () => { extraReads++; return library; } }], value: 'library.json' } } as unknown as Event);
  assert.equal(extraReads, 0);
  editor.form.researchInterests = 'Current edits made while the file is read';
  first.resolve(library); await importing;
  assert.equal(editor.isImporting, false);
  assert.equal(owner.listTemplates().length, initialCount * 2);
  assert.equal(owner.listTemplates().find(template => template.id === selectedId)?.researchInterests, editor.form.researchInterests);
  assert.equal(editor.form.researchInterests, 'Current edits made while the file is read');
});

test('failed library reads leave the editor intact and allow selecting the same file again', async t => {
  const { editor, owner } = importFixture(t);
  const original = JSON.stringify(editor.form);
  let failRead = true;
  const input = { files: [{ text: async () => { if (failRead) throw new Error('File is unavailable'); return owner.exportTemplates(); } }], value: 'library.json' };
  await editor.importLibrary({ target: input } as unknown as Event);
  assert.equal(editor.isImporting, false); assert.equal(input.value, '');
  assert.match(editor.error, /Select the file again to retry/);
  assert.equal(JSON.stringify(editor.form), original);
  assert.equal(owner.listTemplates().length, 2);
  failRead = false; input.value = 'library.json';
  await editor.importLibrary({ target: input } as unknown as Event);
  assert.equal(editor.error, ''); assert.equal(owner.listTemplates().length, 4);
});

test('closing the template editor cancels a pending import without later writes or errors', async t => {
  const { editor, owner, data, unmount } = importFixture(t);
  const library = owner.exportTemplates();
  const pending = pendingImport();
  const importing = editor.importLibrary(pending.event);
  unmount(); pending.resolve(library); await importing;
  assert.equal(data.size, 0); assert.equal(editor.error, '');
});

test('returning to the original account cannot revive an older import or unlock a newer one', async t => {
  const { editor, owner, props } = importFixture(t);
  const library = owner.exportTemplates();
  const old = pendingImport(), latest = pendingImport();
  const staleImport = editor.importLibrary(old.event);
  props.userId = 'other'; await nextTick();
  assert.equal(editor.isImporting, false);
  props.userId = 'owner'; await nextTick();
  const latestImport = editor.importLibrary(latest.event);
  old.resolve(library); await staleImport;
  assert.equal(owner.listTemplates().length, 2);
  assert.equal(editor.isImporting, true, 'stale completion must not clear the active import state');
  latest.resolve(library); await latestImport;
  assert.equal(owner.listTemplates().length, 4); assert.equal(editor.isImporting, false);
});

test('templates autosave edits, flush before navigation, and preserve account ownership and failed edits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notifications = useToasts();
  notifications.clear();
  t.after(() => notifications.clear());
  const data = new Map<string, string>();
  let failWrites = false;
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {
    if (failWrites) throw new Error('Storage full');
    data.set(key, value);
  } };
  const events = new EventTarget();
  for (const [name, value] of Object.entries({ localStorage: storage, window: events })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const props = reactive({ userId: 'owner', lang: 'en' });
  let instance: unknown;
  const component = { ...exports.default, render: () => null };
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { instance = value; } }) });
  app.mount({});
  const editor = (instance as { $: { setupState: Editor } }).$.setupState;
  const owner = createLetterRepository(storage, 'owner');
  try {
    t.mock.timers.tick(3000);
    assert.equal(notifications.toasts.value.length, 0, 'opening a saved template must not announce a save');
    const revision = editor.form.revision;
    editor.form.researchInterests = 'Early edit';
    editor.form.researchInterests = 'Latest research interests';
    assert.equal(editor.saveStatus, 'unsaved');
    t.mock.timers.tick(60000);
    assert.notEqual(owner.defaultTemplate()?.researchInterests, 'Latest research interests', 'typing must not persist after any debounce delay');
    assert.equal(editor.flushSave(), true);
    assert.equal(editor.saveStatus, 'saved');
    assert.equal(owner.defaultTemplate()?.researchInterests, 'Latest research interests');
    assert.equal(owner.defaultTemplate()?.revision, revision + 1, 'one revision per committed draft');
    assert.equal(notifications.toasts.value.length, 0, 'the saved notification stays quiet until the existing announcement delay');
    t.mock.timers.tick(1000);
    assert.equal(owner.defaultTemplate()?.revision, revision + 1, 'saving metadata must not trigger another autosave');
    assert.equal(notifications.toasts.value.length, 0, 'the notification waits for idle time');

    editor.form.researchInterests = 'Another editing batch';
    assert.equal(editor.flushSave(), true);
    t.mock.timers.tick(1250);
    assert.equal(notifications.toasts.value.length, 0, 'new input cancels the earlier pending save notification');
    t.mock.timers.tick(250);
    assert.equal(notifications.toasts.value.length, 1);
    assert.equal(notifications.toasts.value[0]?.message, 'All changes saved locally');
    assert.equal(notifications.toasts.value[0]?.tone, 'success');
    const saveToastId = notifications.toasts.value[0]?.id;

    editor.form.tone = 'The last edit before switching';
    editor.select('industry');
    assert.equal(owner.defaultTemplate()?.tone, 'The last edit before switching');
    editor.create();
    assert.ok(owner.listTemplates().some(template => template.id === editor.selectedId), 'new templates save immediately');
    t.mock.timers.tick(1500);
    assert.equal(notifications.toasts.value.length, 1, 'subsequent saves update the existing notification instead of adding a stack');
    assert.equal(notifications.toasts.value[0]?.id, saveToastId);

    failWrites = true;
    editor.form.name = 'Unsaved name';
    assert.equal(editor.flushSave(), false);
    assert.equal(editor.saveStatus, 'error');
    assert.equal(notifications.toasts.value.at(-1)?.message, 'Storage full');
    assert.equal(notifications.toasts.value.at(-1)?.tone, 'error');
    const unsavedId = editor.selectedId;
    editor.select('research');
    assert.equal(editor.selectedId, unsavedId, 'failed saves keep the editor on its unsaved template');
    assert.equal(editor.form.name, 'Unsaved name');
    failWrites = false;
    events.dispatchEvent(new Event('pagehide'));
    assert.equal(editor.saveStatus, 'saved');

    editor.form.name = 'Owner edit before account switch';
    props.userId = 'other'; await nextTick();
    assert.equal(owner.listTemplates().find(template => template.id === unsavedId)?.name, 'Owner edit before account switch');
    assert.equal(createLetterRepository(storage, 'other').listTemplates().length, 2, 'edits never cross accounts');
    editor.form.tone = 'Saved when the editor closes';
  } finally { app.unmount(); }
  assert.equal(createLetterRepository(storage, 'other').defaultTemplate()?.tone, 'Saved when the editor closes');
});

test('shared research interests are enabled by default and opting out preserves the custom draft', t => {
  const { editor, owner } = importFixture(t);
  assert.equal(editor.form.useMetaSearchInterests, true);
  editor.form.researchInterests = 'Custom research interests for this letter.';
  assert.equal(editor.flushSave(), true);
  editor.form.useMetaSearchInterests = false;
  assert.equal(editor.flushSave(), true);
  editor.select('industry'); editor.select('research');
  assert.equal(editor.form.useMetaSearchInterests, false);
  assert.equal(editor.form.researchInterests, 'Custom research interests for this letter.');
  editor.form.useMetaSearchInterests = true; assert.equal(editor.flushSave(), true);
  assert.equal(owner.defaultTemplate()?.useMetaSearchInterests, true);
  assert.equal(owner.defaultTemplate()?.researchInterests, 'Custom research interests for this letter.');
});

function savedSharedSearch(owner: string, interests: string) {
  const editor = createSearchTemplate(); editor.researchInterests = interests;
  return { id: '40000000-0000-4000-8000-000000000001', user_id: owner, name: editor.name, revision: 2,
    created_at: editor.updatedAt, updated_at: editor.updatedAt, criteria: {},
    schedule: { frequency: 'daily', intervalHours: 1, weekdays: [], time: '09:00', timezone: 'Europe/Tirane', runImmediately: true },
    meta_search: { version: 1, active: true, editor, systemPrompt: 'System', userPrompt: 'User', recurringPrompt: 'Recurring' } };
}
async function settlePreview() { for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve(); } }

test('the shared-interest preview reads the saved account source on a fresh device without any cloud writes', async t => {
  const { editor, props, owner, data } = importFixture(t);
  const queries: string[] = [];
  props.client = { from(table: string) {
    queries.push(table);
    const builder = { select: () => builder, eq: (_key: string, account: string) => { assert.equal(account, 'owner'); return builder; },
      order: () => Promise.resolve({ data: [savedSharedSearch('owner', 'Saved cloud acoustics; BCI')], error: null }) };
    return builder;
  } } as unknown as SupabaseClient;
  await settlePreview();
  assert.equal(editor.sharedSearchSource.templates.value[0]?.researchInterests || '', 'Saved cloud acoustics; BCI');
  assert.equal(editor.sharedInterestsState, 'ready');
  assert.deepEqual(queries, ['opportunity_search_templates']);
  assert.equal(data.has('cv.search-templates.v1:owner'), false);
  editor.form.useMetaSearchInterests = false; assert.equal(editor.flushSave(), true);
  assert.equal(owner.defaultTemplate()?.useMetaSearchInterests, false);
});

test('late preview results cannot cross account changes or replace a committed local search', async t => {
  const { editor, props, data } = importFixture(t);
  const finishes = new Map<string, (value: unknown) => void>();
  props.client = { from() {
    let account = '';
    const builder = { select: () => builder, eq: (_key: string, value: string) => { account = value; return builder; },
      order: () => new Promise(resolve => { finishes.set(account, resolve); }) };
    return builder;
  } } as unknown as SupabaseClient;
  await settlePreview(); assert.equal(editor.sharedInterestsState, 'loading');
  props.userId = 'next-owner'; await settlePreview();
  finishes.get('owner')!({ data: [savedSharedSearch('owner', 'Old account interests')], error: null });
  await settlePreview(); assert.equal(editor.sharedSearchSource.templates.value[0]?.researchInterests || '', '');
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const local = createSearchTemplate(); local.researchInterests = 'Newest committed local interests';
  createSearchTemplateRepository(storage, 'next-owner').saveTemplate(local);
  finishes.get('next-owner')!({ data: [savedSharedSearch('next-owner', 'Older cloud interests')], error: null });
  await settlePreview();
  assert.equal(editor.sharedSearchSource.templates.value[0]?.researchInterests || '', 'Newest committed local interests');
  assert.equal(editor.sharedInterestsState, 'ready');
});

test('a failed preview read does not block saving the checkbox or custom interests', async t => {
  const { editor, props, owner } = importFixture(t);
  props.client = { from() {
    const builder = { select: () => builder, eq: () => builder, order: () => Promise.resolve({ data: null, error: new Error('Unavailable') }) };
    return builder;
  } } as unknown as SupabaseClient;
  await settlePreview(); assert.equal(editor.sharedInterestsState, 'error');
  assert.equal(editor.error, '');
  editor.form.useMetaSearchInterests = false;
  editor.form.researchInterests = 'My custom robotics interests';
  assert.equal(editor.flushSave(), true);
  assert.equal(owner.defaultTemplate()?.researchInterests, 'My custom robotics interests');
  assert.equal(editor.saveStatus, 'saved');
});

test('the public letter flush publishes ready native drafts and blocks composition or invalid fields', t => {
  const { editor, exposed, owner, data } = importFixture(t);
  const before = new Map(data); const selected = editor.selectedId;
  let ready = false; let publications = 0;
  const unregister = textareaCommit.registerTextareaCommit(() => {
    if (publications++) return;
    editor.form.tone = 'Published only when the native draft is ready.';
  }, () => ready);
  t.after(unregister);

  assert.equal(exposed.flush(), false);
  editor.select('industry');
  assert.equal(publications, 0); assert.equal(editor.selectedId, selected);
  assert.deepEqual(data, before, 'composition cannot publish or persist an intermediate draft');
  ready = true;
  assert.equal(exposed.flush(), true);
  assert.equal(owner.defaultTemplate()?.tone, 'Published only when the native draft is ready.');
  editor.form.name = '';
  const saved = owner.defaultTemplate();
  assert.equal(exposed.flush(), false);
  editor.select('industry');
  assert.equal(editor.selectedId, selected); assert.equal(editor.form.name, '');
  assert.deepEqual(owner.defaultTemplate(), saved, 'invalid committed fields remain a local draft');
});

test('failed letter saves recover only for their owner with selection, revision and merge baseline intact', async t => {
  const { editor, exposed, owner, storage, props, data } = importFixture(t);
  editor.select('industry');
  const baseline = JSON.parse(JSON.stringify(editor.form)) as LetterTemplate; const selected = editor.selectedId;
  let failOwner = true;
  const originalSet = storage.setItem;
  t.mock.method(storage, 'setItem', (key: string, value: string) => {
    if (failOwner && key.startsWith('cv.letters.v1:owner:')) throw new Error('Owner storage full');
    originalSet(key, value);
  });
  editor.form.name = 'Private owner template'; editor.form.tone = 'Private wording awaiting recovery.';
  assert.equal(exposed.flush(), false);
  const staleRetry = useToasts().toasts.value.at(-1)?.action?.run;
  assert.ok(staleRetry);
  editor.form.tone = 'Latest private wording after the failed attempt.';
  props.userId = 'other'; await nextTick();
  assert.notEqual(editor.form.name, 'Private owner template');
  const otherBefore = new Map(data);
  assert.equal(await staleRetry(), false); assert.deepEqual(data, otherBefore);
  editor.form.name = 'Other account template'; assert.equal(exposed.flush(), true);

  failOwner = false;
  owner.saveTemplate({ ...baseline, researchInterests: 'A separate tab updated only this field.' });
  failOwner = true;
  props.userId = 'owner'; await nextTick();
  assert.equal(editor.selectedId, selected); assert.equal(editor.form.revision, baseline.revision);
  assert.equal(editor.form.name, 'Private owner template');
  assert.equal(editor.form.tone, 'Latest private wording after the failed attempt.');
  assert.equal(editor.saveStatus, 'error');
  assert.equal(await staleRetry(), false, 'returning to an owner cannot revive an older retry closure');
  const retry = useToasts().toasts.value.at(-1)?.action?.run; assert.ok(retry);
  failOwner = false;
  assert.equal(await retry(), true);
  const saved = owner.listTemplates().find(item => item.id === selected)!;
  assert.equal(saved.name, 'Private owner template'); assert.equal(saved.tone, editor.form.tone);
  assert.equal(saved.researchInterests, 'A separate tab updated only this field.', 'recovery retains the original three-way merge baseline');
  assert.ok(saved.revision > baseline.revision);
  editor.select('research');
  const afterSelection = new Map(data);
  assert.equal(await retry(), false, 'retry actions cannot follow a different template selection');
  assert.deepEqual(data, afterSelection);
  props.userId = 'other'; await nextTick();
  owner.saveTemplate({ ...saved, name: 'A later saved name' });
  props.userId = 'owner'; await nextTick();
  assert.equal(editor.selectedId, owner.defaultTemplate()?.id, 'a successful same-draft save removes the failed recovery editor');
  editor.select(selected);
  assert.equal(editor.form.name, 'A later saved name');
  assert.equal(createLetterRepository(storage, 'other').listTemplates().some(item => item.name === 'Private owner template'), false);
});

test('invalid letter drafts survive a forced account change without overwriting the saved record', async t => {
  const { editor, exposed, props, owner } = importFixture(t);
  const saved = structuredClone(owner.defaultTemplate());
  editor.form.name = ''; editor.form.structure = 'A private incomplete structure.';
  assert.equal(exposed.flush(), false);
  props.userId = 'other'; await nextTick();
  assert.notEqual(editor.form.structure, 'A private incomplete structure.');
  props.userId = 'owner'; await nextTick();
  assert.equal(editor.form.name, ''); assert.equal(editor.form.structure, 'A private incomplete structure.');
  assert.equal(exposed.flush(), false); assert.deepEqual(owner.defaultTemplate(), saved);
  editor.form.name = 'Recovered template'; assert.equal(exposed.flush(), true);
  assert.equal(owner.defaultTemplate()?.name, 'Recovered template');
});

test('letter flush rejects a synchronous record A–B–A change during native publication', t => {
  const { editor, exposed, owner } = importFixture(t);
  const selected = editor.selectedId; const saved = structuredClone(owner.defaultTemplate());
  let pending = true;
  const unregister = textareaCommit.registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    editor.select('industry'); editor.select(selected);
    editor.form.tone = 'A later draft from the replacement editor lifecycle.';
  });
  try {
    assert.equal(exposed.flush(), false);
    assert.equal(editor.selectedId, selected);
    assert.equal(owner.defaultTemplate()?.tone, saved?.tone, 'the outer flush cannot save a newer editor lifecycle merely because its record ID matches');
    assert.equal(editor.form.tone, 'A later draft from the replacement editor lifecycle.');
  } finally { unregister(); }
  assert.equal(exposed.flush(), true);
  assert.equal(owner.defaultTemplate()?.tone, editor.form.tone);
});

test('forced letter owner initialization remains visible when the old native editor cannot publish', async t => {
  const { editor, exposed, props, storage } = importFixture(t);
  const other = createLetterRepository(storage, 'other');
  const otherSaved = other.saveTemplate({ ...other.defaultTemplate()!, name: 'Other account saved template', tone: 'Other account saved tone.' });
  editor.form.tone = 'Original account committed draft awaiting a save.';
  const unregister = textareaCommit.registerTextareaCommit(() => {}, () => false);
  try {
    assert.equal(exposed.flush(), false);
    props.userId = 'other'; await nextTick();
    assert.ok(editor.form, 'new-owner initialization cannot depend on publishing the old composer again');
    assert.equal(editor.form.name, otherSaved.name); assert.equal(editor.form.tone, otherSaved.tone);
    assert.equal(editor.selectedId, otherSaved.id);
    props.userId = 'owner'; await nextTick();
    assert.equal(editor.form.tone, 'Original account committed draft awaiting a save.');
  } finally { unregister(); }
  assert.equal(exposed.flush(), true);
});
