import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, markRaw, nextTick, ref, type Component } from 'vue';
import * as textareaCommit from '../src/shared/editing/textareaCommit';

const filename = new URL('../src/shared/ui/AutosaveTextarea.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'autosave-textarea-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const localRequire = createRequire(filename);
new Function('require', 'exports', code)((name: string) => name === '../editing/textareaCommit' ? textareaCommit : localRequire(name), exports);
const { commitPendingTextareas } = textareaCommit;
const component = { ...exports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

interface TextareaSetup {
  value: string;
  onFocus(): void;
  onBlur(): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
  onKeydown(event: KeyboardEvent): void;
  onClick(event: MouseEvent): void;
  textarea: HTMLTextAreaElement | null;
}

function fixture(t: TestContext, lazy = false) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const addedWindow = t.mock.method(window, 'addEventListener');
  const removedWindow = t.mock.method(window, 'removeEventListener');
  const addedDocument = t.mock.method(document, 'addEventListener');
  const removedDocument = t.mock.method(document, 'removeEventListener');
  const previous = Object.entries({ window, document }).map(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    return [key, descriptor] as const;
  });
  const model = ref('Saved assessment');
  const updates: string[] = [];
  const commits: string[] = [];
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, {
    modelValue: model.value,
    modelModifiers: { lazy },
    'onUpdate:modelValue': (value: string) => { updates.push(value); model.value = value; },
    onCommit: () => commits.push(model.value),
    ref: (value: unknown) => { mounted = value; },
  }) });
  app.mount({});
  let unmounted = false;
  const unmount = () => { if (!unmounted) { app.unmount(); unmounted = true; } };
  t.after(() => {
    unmount();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const setup = (mounted as { $: { setupState: TextareaSetup } }).$.setupState;
  return { setup, model, updates, commits, window, document, unmount,
    addedWindow, removedWindow, addedDocument, removedDocument };
}

function keydown(values: Partial<Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing' | 'keyCode'>> = {}) {
  const event = new Event('keydown', { cancelable: true });
  for (const [key, value] of Object.entries({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, ...values })) {
    Object.defineProperty(event, key, { value });
  }
  return event as KeyboardEvent;
}

test('typing updates the model without committing, and blur commits the latest draft', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  assert.deepEqual(f.commits, [], 'opening the textarea must not save');
  f.setup.onFocus();
  f.setup.value = 'A';
  await nextTick();
  f.setup.value = 'A complete assessment';
  await nextTick();
  t.mock.timers.tick(5000);
  await nextTick();
  assert.deepEqual(f.updates, ['A', 'A complete assessment']);
  assert.equal(f.setup.value, 'A complete assessment');
  assert.deepEqual(f.commits, [], 'pausing between keystrokes must not commit');
  f.setup.onBlur();
  assert.deepEqual(f.commits, ['A complete assessment']);
});

test('Enter commits without inserting a newline, while Shift+Enter permits multiline editing', async t => {
  const f = fixture(t);
  f.setup.onFocus();
  f.setup.value = 'First line';
  await nextTick();
  const shifted = keydown({ shiftKey: true });
  f.setup.onKeydown(shifted);
  assert.equal(shifted.defaultPrevented, false, 'Shift+Enter must keep the native newline action');
  assert.deepEqual(f.commits, []);
  f.setup.value = 'First line\nSecond line';
  await nextTick();
  const enter = keydown();
  f.setup.onKeydown(enter);
  assert.equal(enter.defaultPrevented, true, 'Enter must prevent the native newline action');
  assert.deepEqual(f.commits, ['First line\nSecond line']);
  assert.equal(f.model.value, 'First line\nSecond line', 'commit must preserve existing newlines');
  const ordinaryKey = keydown({ key: 'a', keyCode: 65 });
  f.setup.onKeydown(ordinaryKey);
  assert.equal(ordinaryKey.defaultPrevented, false);
  assert.equal(f.commits.length, 1);
});

test('IME composition and keyCode 229 do not commit or intercept Enter', t => {
  const f = fixture(t);
  f.setup.onFocus();
  f.setup.onCompositionStart();
  const composing = keydown();
  f.setup.onKeydown(composing);
  assert.equal(composing.defaultPrevented, false);
  assert.deepEqual(f.commits, []);
  f.setup.onCompositionEnd();
  for (const event of [keydown({ isComposing: true }), keydown({ keyCode: 229 })]) {
    f.setup.onKeydown(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(f.commits, []);
  const enter = keydown();
  f.setup.onKeydown(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(f.commits, ['Saved assessment'], 'normal Enter must work after composition ends');
});

test('window blur and page hiding commit only while the textarea has focus', async t => {
  const f = fixture(t);
  f.window.dispatchEvent(new Event('blur'));
  f.document.hidden = true;
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.commits, [], 'unfocused textareas must not request saves from global events');
  f.document.hidden = false;
  f.setup.onFocus();
  f.setup.value = 'Focused draft';
  await nextTick();
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.commits, [], 'a visible page is not a commit boundary');
  f.window.dispatchEvent(new Event('blur'));
  assert.deepEqual(f.commits, ['Focused draft']);
  f.document.hidden = true;
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.commits, ['Focused draft', 'Focused draft']);
  f.setup.onBlur();
  const count = f.commits.length;
  f.window.dispatchEvent(new Event('blur'));
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.commits.length, count, 'blurred textareas must stop reacting to global commit events');
});

test('unmount removes the registered window and page listeners', t => {
  const f = fixture(t);
  const windowRegistration = f.addedWindow.mock.calls.find(call => call.arguments[0] === 'blur');
  const documentRegistration = f.addedDocument.mock.calls.find(call => call.arguments[0] === 'visibilitychange');
  assert.ok(windowRegistration);
  assert.ok(documentRegistration);
  f.setup.onFocus();
  f.unmount();
  assert.ok(f.removedWindow.mock.calls.some(call => call.arguments[0] === 'blur' && call.arguments[1] === windowRegistration.arguments[1]));
  assert.ok(f.removedDocument.mock.calls.some(call => call.arguments[0] === 'visibilitychange' && call.arguments[1] === documentRegistration.arguments[1]));
  f.window.dispatchEvent(new Event('blur'));
  f.document.hidden = true;
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.commits, []);
});

test('lazy models publish only on commit and publish before the save callback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, true);
  f.setup.onFocus();
  f.setup.value = 'Local draft';
  await nextTick();
  t.mock.timers.tick(60000);
  assert.equal(f.model.value, 'Saved assessment');
  assert.deepEqual(f.updates, []);
  assert.deepEqual(f.commits, []);
  f.setup.onKeydown(keydown());
  assert.equal(f.model.value, 'Local draft');
  assert.deepEqual(f.commits, ['Local draft']);
  await nextTick();
  f.setup.value = 'Second edit';
  f.setup.onBlur();
  assert.deepEqual(f.updates, ['Local draft', 'Second edit']);
  assert.deepEqual(f.commits, ['Local draft', 'Second edit']);
});

test('navigation flush publishes pending text synchronously and is safe to call repeatedly', async t => {
  const f = fixture(t, true);
  f.setup.value = 'Before navigation';
  commitPendingTextareas();
  assert.equal(f.model.value, 'Before navigation');
  assert.deepEqual(f.commits, ['Before navigation']);
  commitPendingTextareas();
  assert.equal(f.commits.length, 1);
  await nextTick();
  f.setup.value = 'Before unmount';
  f.unmount();
  assert.equal(f.model.value, 'Before unmount');
  const count = f.commits.length;
  commitPendingTextareas();
  assert.equal(f.commits.length, count, 'unmounted drafts must leave the registry');
});

test('live local-draft models still commit on navigation after the model echo', async t => {
  const f = fixture(t);
  f.setup.value = 'Local recovery draft';
  await nextTick();
  assert.equal(f.model.value, 'Local recovery draft');
  assert.deepEqual(f.commits, []);
  commitPendingTextareas();
  assert.deepEqual(f.commits, ['Local recovery draft']);
  commitPendingTextareas();
  assert.equal(f.commits.length, 1);
});

test('an older model acknowledgement preserves newer uncommitted typing', async t => {
  const f = fixture(t, true);
  f.setup.value = 'First version';
  f.setup.onKeydown(keydown());
  f.setup.value = 'Newer typing';
  await nextTick();
  assert.equal(f.setup.value, 'Newer typing');
  assert.equal(f.model.value, 'First version');
  f.setup.onBlur();
  assert.equal(f.model.value, 'Newer typing');
});

test('double click keeps native word selection, triple click selects all, and dragging never commits or prevents selection', async t => {
  const f = fixture(t, true);
  let selections = 0;
  const field = markRaw({ select: () => selections++ }) as unknown as HTMLTextAreaElement;
  f.setup.textarea = field;
  f.setup.onFocus();
  f.setup.value = 'Select this entire text';
  for (const detail of [1, 2, 3]) {
    const click = new Event('click', { cancelable: true });
    Object.defineProperties(click, { currentTarget: { value: field }, detail: { value: detail } });
    f.setup.onClick(click as MouseEvent);
    assert.equal(selections, detail === 3 ? 1 : 0);
    assert.equal(click.defaultPrevented, false, 'caret placement and word selection remain native');
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'target', { value: field });
    f.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  await nextTick();
  assert.deepEqual(f.commits, []);
  assert.deepEqual(f.updates, []);
  const outside = new Event('pointerdown', { cancelable: true });
  f.document.dispatchEvent(outside);
  assert.equal(f.model.value, 'Select this entire text');
  assert.equal(outside.defaultPrevented, false);
});

test('pagehide commits a focused lazy draft before the page is closed', t => {
  const f = fixture(t, true);
  f.setup.onFocus();
  f.setup.value = 'Last edit';
  f.window.dispatchEvent(new Event('pagehide'));
  assert.equal(f.model.value, 'Last edit');
  assert.deepEqual(f.commits, ['Last edit']);
});
