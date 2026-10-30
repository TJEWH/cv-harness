import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createRenderer, nextTick } from 'vue';
import { usePreviewInputCommit } from '../src/documents/pdf/composables/usePreviewInputCommit';

const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
function fixture(t: TestContext) {
  class Field { isConnected = true; visible = true; matches() { return true; } contains(target: unknown) { return target === this; } getClientRects() { return this.visible ? [{}] : []; } }
  const field = new Field();
  const document = Object.assign(new EventTarget(), { activeElement: field as Field | null, body: {}, hidden: false });
  const window = new EventTarget();
  let mutation = () => {};
  const globals = { document, window, Element: Field, HTMLElement: Field, Node: Field,
    MutationObserver: class { constructor(callback: () => void) { mutation = callback; } observe() {} disconnect() {} },
  };
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  let commits = 0;
  let gate!: ReturnType<typeof usePreviewInputCommit>;
  const app = renderer.createApp({ setup() { gate = usePreviewInputCommit(() => commits++); return () => null; } });
  app.mount({});
  t.after(() => {
    app.unmount();
    previous.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key));
  });
  function dispatch(type: string, values: Record<string, unknown> = {}) {
    const event = new Event(type);
    Object.entries({ target: field, ...values }).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
    document.dispatchEvent(event);
  }
  return { field, document, window, gate, dispatch, mutation: () => mutation(), commits: () => commits, unmount: () => app.unmount() };
}

test('text entry commits once after Enter and waits again for subsequent typing; IME Enter does not commit', async t => {
  const f = fixture(t);
  assert.equal(f.gate.defer(), true);
  await nextTick();
  assert.equal(f.commits(), 0);
  f.dispatch('keyup', { key: 'Enter', isComposing: true });
  await nextTick();
  assert.equal(f.commits(), 0);
  f.dispatch('keyup', { key: 'Enter', shiftKey: true });
  f.dispatch('keyup', { key: 'Enter', keyCode: 229 });
  await nextTick();
  assert.equal(f.commits(), 0, 'newlines and IME confirmation do not commit');
  f.dispatch('keyup', { key: 'Enter', isComposing: false });
  assert.equal(f.commits(), 0, 'allow the model and post-flush watchers to finish first');
  await nextTick();
  assert.equal(f.commits(), 1);
  f.dispatch('focusout');
  await nextTick();
  assert.equal(f.commits(), 1, 'blur after Enter does not render the same edit twice');
  f.gate.defer();
  f.dispatch('focusout');
  await nextTick();
  assert.equal(f.commits(), 2);
});

test('clicking outside commits even if focus stays in the field, and window blur also commits', async t => {
  const f = fixture(t);
  f.gate.defer();
  f.dispatch('pointerdown');
  await nextTick();
  assert.equal(f.commits(), 0, 'moving the caret within the input does not commit');
  f.dispatch('pointerdown', { target: new (f.field.constructor as new () => object)() });
  await nextTick();
  assert.equal(f.commits(), 1);
  f.gate.defer();
  f.window.dispatchEvent(new Event('blur'));
  await nextTick();
  assert.equal(f.commits(), 2);
});

test('removed or hidden inputs commit without relying on blur; disposal cancels queued work', async t => {
  const f = fixture(t);
  f.gate.defer();
  f.field.isConnected = false;
  f.mutation();
  await nextTick();
  assert.equal(f.commits(), 1);
  f.field.isConnected = true;
  f.gate.defer();
  f.field.visible = false;
  f.mutation();
  await nextTick();
  assert.equal(f.commits(), 2);
  f.gate.defer();
  f.dispatch('focusout');
  f.unmount();
  await nextTick();
  assert.equal(f.commits(), 2);
});
