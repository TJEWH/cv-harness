import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { prepareRefinement, refinementSignature } from '../src/features/refinement/applicationRefinement';
import { DEFAULT_LETTER_TEMPLATES } from '../src/documents/letter/motivationLetters';
import { useToasts } from '../src/shared/ui/useToasts';
import type { PrivacyContextType } from '../src/features/refinement/refinementTypes';
import { createTestState } from './helpers';

const filename = new URL('../src/features/refinement/components/RefinementPrivacyPreview.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'privacy-context-autosave' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const result: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireComponent(path), result);
const component = { ...result.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
const target = { fieldId: 'field-1', token: '{{PRIVATE_1}}', sourceKey: 'target-1', label: 'Private field' };
type Target = typeof target;
type Draft = { type: PrivacyContextType; description: string };
interface Editor { draft(target: Target): Draft; persistDraft(key: string): boolean; approveDraft(target: Target): void; error: string }
function mount(t: TestContext) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const local = prepareRefinement({ applicationId: '10000000-0000-4000-8000-000000000001', variantId: 'original', state: createTestState(), setup: { template: DEFAULT_LETTER_TEMPLATES[0], language: 'en', maxWords: 400 }, letterText: 'Frozen letter.', instructions: '', scope: 'cv', feedback: [], parentProposalId: null, opportunity: {}, baselineSignature: refinementSignature('original') });
  const props = reactive({ userId: 'owner-one', request: { ...local.request, requestId: 'request-one' }, lang: 'en' });
  const approvals: unknown[][] = [];
  let instance: unknown;
  let app: ReturnType<typeof renderer.createApp> | undefined;
  const open = () => {
    app = renderer.createApp({ render: () => h(component, { ...props,
      onApprove: (...args: unknown[]) => approvals.push(args), ref: (value: unknown) => { instance = value; },
    }) });
    app.mount({});
    return (instance as { $: { setupState: Editor } }).$.setupState;
  };
  const close = () => { app?.unmount(); app = undefined; };
  const editor = open();
  t.after(() => {
    close(); useToasts().clear();
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  return { editor, props, approvals, storage, values, reopen() { close(); return open(); } };
}

test('privacy description drafts save only at commit and never approve disclosure implicitly', async t => {
  const { editor, values, approvals, reopen } = mount(t);
  editor.draft(target).description = 'General research organization context.';
  editor.draft(target).type = 'organization';
  await nextTick();
  assert.equal(values.size, 0, 'typing only changes the local editor draft');
  assert.equal(editor.persistDraft(target.sourceKey), true);
  assert.equal(values.size, 1);
  assert.equal(approvals.length, 0, 'blur and Enter do not grant disclosure consent');
  const restored = reopen();
  assert.deepEqual(restored.draft(target), { type: 'organization', description: 'General research organization context.' });
  restored.approveDraft(target);
  assert.deepEqual(approvals, [[target.sourceKey, 'organization', 'General research organization context.']]);
});

test('privacy draft recovery stays isolated by owner, application, request and exact target', async t => {
  const { editor, props } = mount(t);
  editor.draft(target).description = 'Only the first context should recover this text.';
  editor.persistDraft(target.sourceKey);
  assert.equal(editor.draft({ ...target, sourceKey: 'target-two' }).description, '');
  for (const field of ['userId', 'applicationId', 'requestId'] as const) {
    if (field === 'userId') props.userId = 'owner-two';
    else props.request = { ...props.request, [field]: `${field}-two` };
    await nextTick(); assert.equal(editor.draft(target).description, '', field);
    if (field === 'userId') props.userId = 'owner-one';
    else props.request = { ...props.request, [field]: field === 'applicationId' ? '10000000-0000-4000-8000-000000000001' : 'request-one' };
    await nextTick(); assert.equal(editor.draft(target).description, 'Only the first context should recover this text.');
  }
});

test('privacy drafts flush under their old owner when navigation replaces the request', async t => {
  const { editor, props, reopen } = mount(t);
  editor.draft(target).description = 'Last edit before changing accounts.';
  props.userId = 'owner-two'; await nextTick();
  assert.equal(editor.draft(target).description, '');
  props.userId = 'owner-one'; await nextTick();
  assert.equal(editor.draft(target).description, 'Last edit before changing accounts.');
  editor.draft(target).description = 'Last edit before closing the view.';
  assert.equal(reopen().draft(target).description, 'Last edit before closing the view.');
});

test('failed privacy commits retain the draft for retry without approving disclosure', t => {
  const { editor, storage, approvals } = mount(t);
  editor.draft(target).description = 'A context draft that still needs saving.';
  const writes = t.mock.method(storage, 'setItem', () => { throw new Error('Storage full'); });
  assert.equal(editor.persistDraft(target.sourceKey), false);
  assert.equal(editor.error, 'Storage full');
  editor.approveDraft(target); assert.equal(approvals.length, 0);
  assert.equal(editor.draft(target).description, 'A context draft that still needs saving.');
  writes.mock.restore(); assert.equal(editor.persistDraft(target.sourceKey), true);
});
