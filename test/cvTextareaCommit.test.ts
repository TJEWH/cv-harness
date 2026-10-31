import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, provide, reactive, type Component } from 'vue';
import type { CvState } from '../src/documents/cv/types';
import { createTestState } from './helpers';

const requireFromComponents = createRequire(new URL('../src/features/cv-studio/components/CvContentEditor.vue', import.meta.url));
const { CV_TEXTAREA_COMMIT } = requireFromComponents('../../../documents/cv/composables/cvTextareaCommit') as typeof import('../src/documents/cv/composables/cvTextareaCommit');
const { registerTextareaCommit } = requireFromComponents('../../../shared/editing/textareaCommit') as typeof import('../src/shared/editing/textareaCommit');
const { privacyFieldKey } = requireFromComponents('../../../documents/privacy/domain/privacyOverrides') as typeof import('../src/documents/privacy/domain/privacyOverrides');

const componentPaths = {
  CvContentEditor: '../src/features/cv-studio/components/CvContentEditor.vue',
  AnonymizationPanel: '../src/documents/privacy/components/AnonymizationPanel.vue',
} as const;
function component(name: keyof typeof componentPaths) {
  const filename = new URL(componentPaths[name], import.meta.url);
  const { descriptor } = parse(readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: `cv-textarea-${name}` });
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { default?: Component } = {};
  const requireComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireComponent(path), exports);
  return { ...exports.default, render: () => null };
}
const CvContentEditor = component('CvContentEditor');
const AnonymizationPanel = component('AnonymizationPanel');
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

function mount<T>(t: TestContext, target: Component, props: Record<string, unknown>, parentCommit = () => {}) {
  class TextareaElement { matches() { return true; } }
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  const document = Object.assign(new EventTarget(), { activeElement: null as TextareaElement | null });
  const previous = Object.entries({ window, document, Element: TextareaElement, HTMLElement: TextareaElement }).map(([key, value]) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    return [key, old] as const;
  });
  let instance: unknown;
  const app = renderer.createApp({
    setup() {
      provide(CV_TEXTAREA_COMMIT, parentCommit);
      return () => h(target, { ...props, ref: (value: unknown) => { instance = value; } });
    },
  });
  app.mount({});
  t.after(() => {
    app.unmount();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const internal = (instance as { $: { setupState: T; provides: Record<symbol, () => void> } }).$;
  return { setup: internal.setupState, commit: internal.provides[CV_TEXTAREA_COMMIT], window,
    focusTextarea: () => { document.activeElement = new TextareaElement(); } };
}

interface FormSetup {
  versionMode: boolean;
  state: { about: { text?: string } };
  selectSectionVersion(key: string, id: string): void;
  sectionVersions: { versionId(key: string): string };
}

test('CV textarea commits flush alternate versions immediately and preserve the old owner before section switches', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = reactive(createTestState({ about: { text: 'Current CV' } }));
  const alternate = createTestState({ about: { text: 'Alternate CV' } });
  const saves: CvState[] = [];
  let fail = false;
  let parentCommits = 0;
  const f = mount<FormSetup>(t, CvContentEditor, {
    state, selectedId: 'current', configurations: [{ id: 'current', name: 'Current' }, { id: 'alternate', name: 'Alternate' }],
    readVersion: () => alternate,
    saveVersion: (_id: string, value: CvState) => { if (fail) return false; saves.push(value); return true; },
  }, () => { parentCommits++; });
  f.setup.versionMode = true;
  f.setup.selectSectionVersion('about', 'alternate');
  f.setup.state.about.text = 'Committed alternate paragraph';
  f.commit();
  assert.equal(saves.at(-1)?.about.text, 'Committed alternate paragraph', 'the commit must flush without waiting for the CV debounce');
  assert.equal(parentCommits, 1);
  assert.equal(state.about.text, 'Current CV');

  let localDraft = 'Final text before changing section owner';
  const unregister = registerTextareaCommit(() => {
    if (!localDraft) return;
    f.setup.state.about.text = localDraft;
    localDraft = '';
    f.commit();
  });
  t.after(unregister);
  f.setup.selectSectionVersion('about', 'current');
  assert.equal(saves.at(-1)?.about.text, 'Final text before changing section owner');
  assert.equal(state.about.text, 'Current CV', 'the draft must not be written into the newly selected CV');
  assert.equal(f.setup.sectionVersions.versionId('about'), 'current');

  f.setup.selectSectionVersion('about', 'alternate');
  fail = true;
  localDraft = 'Keep this failed draft in its owning alternate version';
  f.setup.selectSectionVersion('about', 'current');
  assert.equal(f.setup.sectionVersions.versionId('about'), 'alternate');
  assert.equal(f.setup.state.about.text, 'Keep this failed draft in its owning alternate version');
  fail = false;
});

test('privacy textarea commits apply overrides before the owning CV is saved', t => {
  const state = reactive(createTestState({ about: { text: 'Original paragraph' } }));
  const savedOverrides: unknown[] = [];
  const f = mount<{ draft: CvState; onDraftFieldChange(): void }>(t, AnonymizationPanel, { state, lang: 'en' }, () => {
    savedOverrides.push(structuredClone(state.anonymization.fieldOverrides && { ...state.anonymization.fieldOverrides }));
  });
  f.focusTextarea();
  f.setup.draft.about.text = 'Public paragraph';
  // PrivacyField normally reports the shared textarea's model publication here.
  f.setup.onDraftFieldChange();
  assert.equal(state.anonymization.fieldOverrides, undefined, 'the focused privacy draft should still be local before commit');
  f.commit();
  const key = privacyFieldKey('about', 'text');
  assert.equal((savedOverrides.at(-1) as Record<string, string>)[key], 'Public paragraph');
  assert.equal(state.about.text, 'Original paragraph', 'privacy text must remain a separate override');
});
