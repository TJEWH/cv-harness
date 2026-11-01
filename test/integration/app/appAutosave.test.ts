import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, nextTick, ref } from 'vue';
import type { Component } from 'vue';
import type { CvState, SaveStatus } from '../../../src/documents/cv/types';

const filename = new URL('../../../src/app/App.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'app-autosave-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireFromApp = createRequire(filename);
const { useToasts } = requireFromApp('../shared/ui/useToasts') as typeof import('../../../src/shared/ui/useToasts');
const { registerTextareaCommit, markTextareaDraftChanged } = requireFromApp('../shared/editing/textareaCommit') as typeof import('../../../src/shared/editing/textareaCommit');
new Function('require', 'exports', code)((path: string) => {
  if (path.endsWith('.vue')) return { default: {} };
  if (path.endsWith('/useSupabaseAuth')) return { useSupabaseAuth: () => ({ user: ref(null), client: null }) };
  if (path.endsWith('/useCvDesign')) return { useCvDesign() {} };
  if (path.endsWith('/usePdfExport')) return { usePdfExport: () => ({ exportToPdf() {}, renderPreview: async () => ({ pages: [] }), revokeDownloads() {} }) };
  return requireFromApp(path);
}, exports);
const component = { ...exports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

test('CV Studio reports pending edits immediately, updates the saved time, and flushes the final edit before leaving', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 8, 20, 12, 0, 0) });
  const { toasts, clear } = useToasts();
  clear();
  t.after(clear);
  const listeners = new Map<string, () => void>();
  const storage = new Map<string, string>();
  class ElementStub { matches(selector: string) { return selector === 'input[type="range"]'; } }
  for (const [name, value] of Object.entries({
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    sessionStorage: { getItem: () => null, setItem() {} },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      addEventListener: (event: string, handler: () => void) => listeners.set(event, handler),
      removeEventListener: (event: string) => listeners.delete(event),
    },
    document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
    Element: ElementStub,
    HTMLElement: ElementStub,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  let saved = true;
  let throwOnSave = false;
  const snapshots: CvState[] = [];
  const app = renderer.createApp(component);
  const instance = app.mount({}) as unknown as { $: { setupState: {
    state: CvState; saveStatus: SaveStatus; saveStatusLabel: string; sectionSaveStatus: SaveStatus; combinedSaveStatus: SaveStatus;
    cvVariantManager: unknown; cvContentEditor: unknown; pdfRenderSource: unknown; onPreviewSliderPointerDown(event: PointerEvent): void;
    activeBuilderGroup: string; selectBuilderGroup(group: string): void;
  } } };
  const setup = instance.$.setupState;
  setup.pdfRenderSource = { querySelector: () => ({}) };
  setup.cvVariantManager = { saveCurrent: () => {
    if (throwOnSave) throw new Error('Local storage is unavailable');
    snapshots.push(JSON.parse(JSON.stringify(setup.state))); return saved;
  } };
  try {
    setup.state.contact.name = 'A pending edit';
    assert.equal(setup.saveStatus, 'saving', 'status must change before Vue renders the next frame');
    t.mock.timers.tick(250);
    await nextTick();
    assert.equal(setup.saveStatus, 'saved');
    const firstLabel = setup.saveStatusLabel;

    t.mock.timers.tick(1000);
    setup.state.contact.name = 'The final edit before navigation';
    listeners.get('pagehide')!();
    assert.equal(snapshots.at(-1)?.contact.name, 'The final edit before navigation');
    assert.equal(setup.saveStatus, 'saved');
    assert.notEqual(setup.saveStatusLabel, firstLabel, 'successful saves update the visible save time');

    setup.onPreviewSliderPointerDown({ target: new ElementStub() } as unknown as PointerEvent);
    setup.state.design.h1 = '44px';
    const beforeRelease = snapshots.length;
    t.mock.timers.tick(300);
    assert.equal(snapshots.length, beforeRelease, 'slider editing remains deferred during the drag');
    assert.equal(setup.saveStatus, 'saving');
    listeners.get('blur')!();
    t.mock.timers.tick(250);
    assert.equal(setup.saveStatus, 'saved', 'losing the window during a drag must not leave Saving stuck');
    assert.equal(snapshots.at(-1)?.design.h1, '44px');

    saved = false;
    setup.state.contact.name = 'Cannot be persisted';
    t.mock.timers.tick(250);
    assert.equal(setup.saveStatus, 'error');
    const failedToast = toasts.value.find(toast => toast.key === 'cv-autosave')!;
    assert.equal(failedToast.tone, 'error');
    const retry = failedToast.action!.run;
    assert.equal(await retry(), false, 'a repeated failure must keep the toaster retry unresolved');
    assert.equal(toasts.value.find(toast => toast.id === failedToast.id)?.tone, 'error');

    const warning = t.mock.method(console, 'warn', () => {});
    throwOnSave = true;
    assert.equal(await retry(), false, 'thrown storage errors must also keep the retry unresolved');
    assert.equal(warning.mock.callCount(), 1);
    throwOnSave = false;

    let sectionsSaved = false;
    let sectionFlushes = 0;
    setup.sectionSaveStatus = 'error';
    setup.cvContentEditor = { flushSectionSaves: () => {
      sectionFlushes++;
      setup.sectionSaveStatus = sectionsSaved ? 'saved' : 'error';
      return sectionsSaved;
    } };
    saved = true;
    assert.equal(await retry(), false, 'saving the active CV cannot resolve unsaved alternate sections');
    assert.equal(setup.saveStatus, 'saved');
    assert.equal(setup.combinedSaveStatus, 'error');
    assert.equal(toasts.value.find(toast => toast.id === failedToast.id)?.tone, 'error');
    sectionsSaved = true;
    assert.equal(await retry(), true);
    assert.equal(sectionFlushes, 2, 'each retry must flush alternate-section saves as well');
    assert.equal(setup.combinedSaveStatus, 'saved');
    t.mock.timers.tick(1500);
    await nextTick();
    const recoveredToast = toasts.value.find(toast => toast.key === 'cv-autosave')!;
    assert.equal(recoveredToast.tone, 'success');
    assert.equal(recoveredToast.message, setup.saveStatusLabel, 'complete recovery announces the saved result');
    setup.state.contact.name = 'Recovered';
    t.mock.timers.tick(250);
    assert.equal(setup.saveStatus, 'saved');

    let textareaDraft = '';
    const unregister = registerTextareaCommit(() => {
      if (!textareaDraft) return;
      setup.state.about.text = textareaDraft;
      textareaDraft = '';
    });
    t.after(unregister);
    const beforeTyping = snapshots.length;
    const savedAbout = setup.state.about.text;
    textareaDraft = 'The last textarea edit before a programmatic tab change';
    t.mock.timers.tick(5000);
    assert.equal(snapshots.length, beforeTyping, 'local textarea drafts must not trigger the CV save debounce');
    assert.equal(setup.state.about.text, savedAbout);
    setup.selectBuilderGroup('design');
    assert.equal(snapshots.at(-1)?.about.text, 'The last textarea edit before a programmatic tab change');
    assert.equal(setup.activeBuilderGroup, 'design');
    assert.equal(setup.saveStatus, 'saved');

    textareaDraft = 'The final textarea edit before pagehide';
    listeners.get('pagehide')!();
    assert.equal(snapshots.at(-1)?.about.text, 'The final textarea edit before pagehide');

    saved = false;
    textareaDraft = 'Retain this draft after a failed tab-change save';
    setup.selectBuilderGroup('content');
    assert.equal(setup.activeBuilderGroup, 'design', 'a failed local save must keep the current studio tab');
    assert.equal(setup.state.about.text, 'Retain this draft after a failed tab-change save');
    saved = true;
  } finally {
    app.unmount();
  }
});

interface SessionApp {
  state: CvState; activeWorkspace: string; activeBuilderGroup: string; previewMode: boolean;
  selectedConfigurationId: string; cloudUser: { id: string } | null;
  letterTemplates: { flush(): boolean } | null; localAttachments: { flush(): boolean } | null;
  cloudWorkspace: { flush(): Promise<boolean>; openList(kind: string): Promise<boolean> } | null;
  cvVariantManager: unknown; cvContentEditor: unknown;
  selectBuilderGroup(group: string): void; selectWorkspace(workspace: string): Promise<void>;
  selectWorkspaceList(workspace: string): Promise<void>; openFullPreview(): void;
  prepareConfigurationChange(): boolean; readCloudVersion(id: string): CvState | null;
  openStudioVariant(id: string): Promise<void>;
}
function sessionApp(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = new Map<string, string>();
  class ElementStub { matches() { return false; } }
  const restores: (() => void)[] = [];
  for (const [name, value] of Object.entries({
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    sessionStorage: { getItem: () => null, setItem() {} },
    window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }),
    document: Object.assign(new EventTarget(), { activeElement: null }), Element: ElementStub, HTMLElement: ElementStub,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restores.push(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const app = renderer.createApp(component);
  const instance = app.mount({}) as unknown as { $: { setupState: SessionApp } };
  const setup = instance.$.setupState;
  setup.cvVariantManager = { saveCurrent: () => true };
  setup.cvContentEditor = { flushSectionSaves: () => true, resetSectionVersions: () => true };
  t.after(() => { app.unmount(); useToasts().clear(); restores.forEach(restore => restore()); });
  return setup;
}
function pendingSave() {
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  return { promise, resolve };
}

test('Studio navigation and snapshots await the active template or private attachment recovery contract', async t => {
  const setup = sessionApp(t);
  await nextTick();
  let saved = false, published = '', pending = 'Newest library textarea draft', templateFlushes = 0, privateFlushes = 0;
  const unregister = registerTextareaCommit(() => { if (pending) { published = pending; pending = ''; } });
  t.after(unregister);
  setup.letterTemplates = { flush: () => { templateFlushes++; assert.equal(published, 'Newest library textarea draft'); return saved; } };
  setup.activeBuilderGroup = 'templates';
  setup.selectBuilderGroup('design');
  assert.equal(setup.activeBuilderGroup, 'templates');
  assert.equal(setup.prepareConfigurationChange(), false);
  assert.equal(setup.readCloudVersion('version'), null, 'a failed library save prevents taking a replacement snapshot');
  await setup.selectWorkspace('opportunities');
  await setup.selectWorkspaceList('applications');
  assert.equal(setup.activeWorkspace, 'cv-studio');
  setup.openFullPreview(); assert.equal(setup.previewMode, false);
  assert(templateFlushes >= 6, 'all programmatic exit boundaries consult the active owner');

  saved = true;
  setup.selectBuilderGroup('attachments');
  assert.equal(setup.activeBuilderGroup, 'attachments');
  saved = false;
  setup.localAttachments = { flush: () => { privateFlushes++; return saved; } };
  setup.selectBuilderGroup('content');
  await setup.selectWorkspace('opportunities');
  assert.equal(setup.activeBuilderGroup, 'attachments');
  assert.equal(setup.activeWorkspace, 'cv-studio');
  assert(privateFlushes >= 2);
  saved = true;
  setup.selectBuilderGroup('content');
  assert.equal(setup.activeBuilderGroup, 'content', 'successful private recovery allows leaving without submitting the attachment');
});

test('App retains newer uncommitted typing and rejects an account A–B–A transition during a child flush', async t => {
  const setup = sessionApp(t);
  await nextTick();
  setup.activeWorkspace = 'opportunities';
  let pending = '', published = '';
  const unregister = registerTextareaCommit(() => { if (pending) { published = pending; pending = ''; } });
  t.after(unregister);
  let save = pendingSave();
  setup.cloudWorkspace = { flush: () => save.promise, openList: () => save.promise };
  const leaving = setup.selectWorkspace('cv-studio');
  await nextTick();
  pending = 'Typing after the exit snapshot';
  markTextareaDraftChanged();
  save.resolve(true); await leaving;
  assert.equal(setup.activeWorkspace, 'opportunities');
  assert.equal(pending, 'Typing after the exit snapshot');
  assert.equal(published, '', 'completion must not republish a newer lazy draft');

  pending = '';
  setup.cloudUser = { id: 'owner-a' };
  save = pendingSave();
  const oldOwner = setup.selectWorkspace('cv-studio');
  await nextTick();
  setup.cloudUser = { id: 'owner-b' }; setup.cloudUser = { id: 'owner-a' };
  save.resolve(true); await oldOwner;
  assert.equal(setup.activeWorkspace, 'opportunities', 'matching final owner IDs cannot revive an obsolete exit');
  setup.cloudWorkspace = { flush: async () => true, openList: async () => true };
  await setup.selectWorkspace('cv-studio');
  assert.equal(setup.activeWorkspace, 'cv-studio');
});

test('opening a Studio variant waits for the cloud editor and retains it after a failed save', async t => {
  const setup = sessionApp(t);
  await nextTick();
  setup.activeWorkspace = 'applications';
  let saved = false;
  const selected: string[] = [];
  setup.cvVariantManager = { saveCurrent: () => true, selectConfiguration: (id: string) => { selected.push(id); return true; } };
  setup.cloudWorkspace = { flush: async () => saved, openList: async () => saved };
  await setup.openStudioVariant('target');
  assert.deepEqual(selected, []);
  assert.equal(setup.activeWorkspace, 'applications');
  saved = true; await setup.openStudioVariant('target');
  assert.deepEqual(selected, ['target']);
  assert.equal(setup.activeWorkspace, 'cv-studio');
  assert.equal(setup.activeBuilderGroup, 'content');
});
