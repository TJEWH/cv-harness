import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import type { Application } from '../../../src/app/cloudTypes';
import { useToasts, useToastWatch } from '../../../src/shared/ui/useToasts';

interface HostNode {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
}
const node = (tag: string, text = ''): HostNode => ({ tag, text, props: {}, children: [], parent: null });
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
  setText(child, text) { child.text = text; },
  setElementText(child, text) { child.text = text; child.children = []; },
  patchProp(child, key, _previous, value) { child.props[key] = value; },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
const filename = new URL('../../../src/features/applications/components/ApplicationIdentifier.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'application-identifier-test', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('/useToasts') ? { useToasts, useToastWatch } : requireComponent(path), componentExports);
const uuid = '30000000-0000-4000-8000-000000000001';

function find(root: HostNode, predicate: (child: HostNode) => boolean): HostNode | undefined {
  if (predicate(root)) return root;
  for (const child of root.children) { const found = find(child, predicate); if (found) return found; }
}
function required(root: HostNode, predicate: (child: HostNode) => boolean) {
  const result = find(root, predicate);
  assert.ok(result, 'Expected rendered element to exist.');
  return result;
}
function content(child: HostNode): string { return child.tag === '#comment' ? '' : child.text + child.children.map(content).join(''); }
function mount(t: TestContext, options: { application?: Pick<Application, 'id' | 'application_code'>; writeText?: (value: string) => Promise<void> } = {}) {
  const notifications = useToasts();
  notifications.clear();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied: string[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: options.writeText || (async (value: string) => { copied.push(value); }) } } });
  const props = reactive({ application: options.application || { id: uuid, application_code: 'APP-7K4M9Q' }, lang: 'en' });
  const root = node('root');
  const app = renderer.createApp({ render: () => h(componentExports.default!, props) });
  app.mount(root);
  t.after(() => { app.unmount(); notifications.clear(); if (previous) Object.defineProperty(globalThis, 'navigator', previous); else Reflect.deleteProperty(globalThis, 'navigator'); });
  const button = () => required(root, child => child.tag === 'button');
  const toast = () => notifications.toasts.value.at(-1);
  const copy = () => (button().props.onClick as () => Promise<void>)();
  return { props, root, copied, button, toast, copy };
}

test('copying uses the complete server code and announces success through the shared toaster', async (t) => {
  const { root, copied, button, toast, copy } = mount(t);
  assert.equal(toast(), undefined, 'mounting an identifier must not announce a copy');
  assert.equal(content(required(root, child => child.tag === 'code')), 'APP-7K4M9Q');
  assert.equal(button().props['aria-label'], 'Copy application identifier: APP-7K4M9Q');
  await copy(); await nextTick();
  assert.deepEqual(copied, ['APP-7K4M9Q']);
  assert.equal(toast()?.message, 'Application identifier copied.');
  assert.equal(toast()?.tone, 'success');
  assert.equal(button().props['aria-label'], 'Copy application identifier: APP-7K4M9Q', 'the control keeps its accessible label after copying');
  assert.equal(find(root, child => child.props.role === 'status'), undefined, 'copy feedback belongs only to the shared toaster');
});

test('reactive application changes clear feedback and copy the full UUID when the code is absent', async (t) => {
  const { props, root, copied, button, toast, copy } = mount(t);
  await copy(); await nextTick();
  props.application = { id: uuid, application_code: null };
  props.lang = 'de';
  await nextTick();
  assert.equal(toast(), undefined, 'the old identifier’s feedback must be cleared');
  assert.equal(content(required(root, child => child.tag === 'code')), uuid);
  assert.equal(button().props['aria-label'], `Bewerbungskennung kopieren: ${uuid}`);
  await copy(); await nextTick();
  assert.deepEqual(copied, ['APP-7K4M9Q', uuid]);
  assert.equal(toast()?.message, 'Bewerbungskennung kopiert.');
  assert.equal(toast()?.tone, 'success');
});

test('clipboard failure exposes the full identifier in a selectable read-only fallback', async (t) => {
  const { props, root, toast, copy } = mount(t, { application: { id: uuid }, writeText: async () => { throw new Error('Permission denied'); } });
  await copy(); await nextTick();
  assert.equal(toast()?.message, 'Copy unavailable. Select and copy the identifier below.');
  assert.equal(toast()?.tone, 'error');
  const input = required(root, child => child.tag === 'input');
  assert.equal(input.props.value, uuid);
  assert.notEqual(input.props.readonly, undefined);
  assert.equal(input.props['aria-label'], 'Application identifier to copy');
  let selected = false;
  (input.props.onFocus as (event: unknown) => void)({ target: { select() { selected = true; } } });
  assert.equal(selected, true);
  props.application = { id: uuid, application_code: 'APP-8N5R2T' };
  await nextTick();
  assert.equal(find(root, child => child.tag === 'input'), undefined);
  assert.equal(toast(), undefined);
});

test('a pending copy cannot announce success for a different application identifier', async (t) => {
  let finish!: () => void;
  const written: string[] = [];
  const { props, button, toast, copy } = mount(t, { writeText: value => { written.push(value); return new Promise<void>(resolve => { finish = resolve; }); } });
  const pending = copy();
  await nextTick();
  assert.equal(button().props.disabled, true);
  props.application = { id: '30000000-0000-4000-8000-000000000002', application_code: 'APP-8N5R2T' };
  await nextTick();
  finish(); await pending; await nextTick();
  assert.deepEqual(written, ['APP-7K4M9Q']);
  assert.equal(toast(), undefined);
  assert.equal(button().props.disabled, false);
});
