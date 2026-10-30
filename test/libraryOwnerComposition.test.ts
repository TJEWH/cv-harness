import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setMaxListeners } from 'node:events';
import { fileURLToPath } from 'node:url';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, getCurrentInstance, h, nextTick, reactive, type Component, type ComponentInternalInstance } from 'vue';
import { DEFAULT_LETTER_TEMPLATES } from '../src/documents/letter/motivationLetters';
import type { LocalDocumentStorage } from '../src/features/attachments/data/localDocuments';
import * as textareaCommit from '../src/shared/editing/textareaCommit';
import * as editorSession from '../src/shared/editing/editorSession';

const noopComponent = { render: () => null };
type TextareaInstance = ComponentInternalInstance & { setupState: Record<string, unknown> };
class HostNode extends EventTarget {
  children: HostNode[] = [];
  parent: HostNode | null = null;
  props: Record<string, any> = {};
  style: Record<string, string> = {};
  value = '';
  type = '';
  multiple = false;
  disabled = false;
  checked = false;
  selected = false;
  selectedIndex = -1;
  text = '';
  constructor(readonly tagName: string) { super(); }
  get options() { return descendants(this).filter(node => node.tagName === 'OPTION'); }
  get ownerDocument() { return document; }
  get textContent(): string { return this.text + this.children.map(node => node.textContent).join(''); }
  set textContent(value: string) { this.text = value; this.children = []; }
  getAttribute(name: string) { return this.props[name] ?? null; }
  setAttribute(name: string, value: string) { this.props[name] = value; }
  removeAttribute(name: string) { delete this.props[name]; }
  querySelector(selector: string) { return descendants(this).find(node => node.tagName === selector.toUpperCase()) || null; }
  focus() { Object.assign(document, { activeElement: this }); }
  scrollIntoView() {}
  getClientRects() { return [{}]; }
}
function descendants(node: HostNode): HostNode[] { return node.children.flatMap(child => [child, ...descendants(child)]); }
function remove(node: HostNode) {
  if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = null;
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => new HostNode(tag.toUpperCase()), createText: text => Object.assign(new HostNode('#TEXT'), { text }),
  createComment: text => Object.assign(new HostNode('#COMMENT'), { text }),
  insert(node, parent, anchor) { remove(node); const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent; },
  remove, setText(node, text) { node.text = text; }, setElementText(node, text) { node.textContent = text; },
  parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  patchProp(node, key, _previous, value) { node.props[key] = value; if (!key.startsWith('on')) Reflect.set(node, key, value); },
});
type Compiled = { setup: (...args: any[]) => any };
function compile(path: string, inlineTemplate: boolean, override: (name: string) => unknown) {
  const filename = new URL(`../src/${path}`, import.meta.url);
  const source = process.env.CV_OWNER_TEMPLATE_ROOT && inlineTemplate
    ? readFileSync(`${process.env.CV_OWNER_TEMPLATE_ROOT}/src/${path}`, 'utf8') : readFileSync(filename, 'utf8');
  const script = compileScript(parse(source).descriptor, { id: 'library-owner-composition', inlineTemplate,
    templateOptions: { compilerOptions: { hoistStatic: false } } });
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requireHere = createRequire(fileURLToPath(filename)), result: { default?: Compiled } = {};
  new Function('require', 'exports', code)((name: string) => override(name) ?? requireHere(name), result);
  return result.default!;
}
async function settle() { for (let index = 0; index < 12; index++) await nextTick(); }
function invoke(node: HostNode, name: string) {
  const handlers = node.props[name];
  for (const handler of Array.isArray(handlers) ? handlers : [handlers]) handler?.(new Event(name.slice(2).toLowerCase()));
}
function input(node: HostNode, value: string) { node.value = value; node.dispatchEvent(new Event('input')); invoke(node, 'onInput'); }

function fixture(t: TestContext, kind: 'letter' | 'attachments') {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const values = new Map<string, string>();
  let failOwner: string | null = null, documentWrites = 0;
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { if (failOwner && key.includes(failOwner)) throw new Error('Synthetic private draft failure'); values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  for (const owner of ['owner-a', 'owner-b']) values.set(`cv.letters.v1:${owner}:templates`, JSON.stringify(DEFAULT_LETTER_TEMPLATES.map(template => ({ ...template, useMetaSearchInterests: false, tone: `Saved ${owner}` }))));
  const documentStorage: LocalDocumentStorage = { get: async () => undefined, list: async () => [],
    write: async () => { documentWrites++; }, remove: async () => { documentWrites++; } };
  const restores: (() => void)[] = [];
  for (const [name, value] of Object.entries({ localStorage: storage,
    window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }),
    document: Object.assign(new EventTarget(), { hidden: false, activeElement: null }), Element: HostNode, HTMLElement: HostNode,
  })) {
    if (value instanceof EventTarget) setMaxListeners(0, value);
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restores.push(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const instances: TextareaInstance[] = [];
  const textareaDefinition = compile('shared/ui/AutosaveTextarea.vue', false, name => name.endsWith('/textareaCommit') ? textareaCommit : undefined);
  const Textarea = { ...textareaDefinition, setup(props: object, context: unknown) { instances.push(getCurrentInstance()! as TextareaInstance); return textareaDefinition.setup(props, context); }, render: () => null };
  const definition = compile(kind === 'letter' ? 'features/letter-templates/components/LetterTemplates.vue' : 'features/attachments/components/LocalAttachments.vue', true,
    name => name.endsWith('/AutosaveTextarea.vue') ? { default: Textarea }
      : name.endsWith('.vue') ? { default: noopComponent }
        : name === '@fortawesome/vue-fontawesome' ? { FontAwesomeIcon: noopComponent }
          : name.endsWith('/textareaCommit') ? textareaCommit
            : name.endsWith('/editorSession') ? editorSession
              : name.endsWith('/useToasts') ? { useToasts: () => ({ notify: () => 1, dismiss() {} }), useToastWatch() {}, useSaveStateToast() {} }
                : undefined);
  const props = reactive({ userId: 'owner-a', lang: 'en', client: null, storage: documentStorage });
  let exposed: { flush(): boolean } | null = null;
  const app = renderer.createApp({ render: () => h(definition as unknown as Component, { ...props, ref: (value: unknown) => { exposed = value as { flush(): boolean }; } }) });
  app.component('font-awesome-icon', noopComponent);
  const host = new HostNode('ROOT');
  app.mount(host);
  t.after(() => { try { app.unmount(); } finally { restores.forEach(restore => restore()); } });
  const form = () => descendants(host).find(node => node.tagName === 'FORM')!;
  const field = () => instances.findLast(instance => !instance.isUnmounted && (kind !== 'letter' || String(instance.vnode.props?.id).endsWith('-tone')))!;
  return { props, values, form, field, host, flush: () => exposed!.flush(), setFailure: (owner: string | null) => { failOwner = owner; },
    get documentWrites() { return documentWrites; },
    async newAttachment() { const button = descendants(host).find(node => String(node.props.class).includes('add-attachment-row'))!; invoke(button, 'onClick'); await settle(); },
  };
}
type TextareaState = { value: string; onCompositionStart(): void; onCompositionEnd(): void; onBlur(): void };
const state = (instance: TextareaInstance) => instance.setupState as unknown as TextareaState;

test('the actual Letter template replaces a composing native editor and initializes a fresh owner', async t => {
  const f = fixture(t, 'letter'); await settle();
  const old = f.field(); state(old).onCompositionStart(); state(old).value = 'PRIVATE OWNER A COMPOSITION';
  f.props.userId = 'owner-b'; await settle();
  assert.ok(f.form(), 'the new owner must receive a populated editor despite the old composer being unready');
  const next = f.field(); assert.notEqual(next, old, 'the owner key must replace the actual textarea VNode');
  assert.equal(state(next).value, 'Saved owner-b');
  assert.equal(textareaCommit.canCommitTextareas(), true, 'the old native composition state must not block the new owner');
  state(next).onCompositionEnd(); state(next).onBlur(); await settle();
  assert.equal(JSON.parse(f.values.get('cv.letters.v1:owner-b:templates')!).find((template: { id: string }) => template.id === 'research').tone, 'Saved owner-b');
});

test('a retained Letter draft cannot inherit another owner’s composing textarea or save its private text', async t => {
  const f = fixture(t, 'letter'); await settle();
  f.props.userId = 'owner-b'; await settle();
  input(f.form().querySelector('input')!, 'Owner B retained template'); await settle();
  f.setFailure('owner-b'); assert.equal(f.flush(), false);
  f.props.userId = 'owner-a'; await settle(); f.setFailure(null);
  const old = f.field(); state(old).onCompositionStart(); state(old).value = 'PRIVATE OWNER A COMPOSITION';
  f.props.userId = 'owner-b'; await settle();
  const next = f.field(); assert.notEqual(next, old, 'the compiled owner key must remount the native editor even for a retained form');
  assert.equal(f.form().querySelector('input')!.value, 'Owner B retained template');
  assert.equal(state(next).value, 'Saved owner-b');
  state(next).onCompositionEnd(); state(next).onBlur(); await settle();
  const saved = JSON.parse(f.values.get('cv.letters.v1:owner-b:templates')!).find((template: { id: string }) => template.id === 'research');
  assert.equal(saved.name, 'Owner B retained template'); assert.equal(saved.tone, 'Saved owner-b');
});

test('the actual Attachment template gives a retained owner draft a fresh composition state without uploading', async t => {
  const f = fixture(t, 'attachments'); await settle();
  f.props.userId = 'owner-b'; await settle(); await f.newAttachment();
  input(f.form().querySelector('input')!, 'Owner B attachment');
  state(f.field()).value = 'Owner B private description'; await settle();
  f.setFailure('owner-b'); assert.equal(f.flush(), false);
  f.props.userId = 'owner-a'; await settle(); f.setFailure(null); await f.newAttachment();
  const old = f.field(); state(old).onCompositionStart(); state(old).value = 'PRIVATE OWNER A DESCRIPTION';
  f.props.userId = 'owner-b'; await settle();
  const next = f.field(); assert.notEqual(next, old, 'the compiled form key must replace its native editor');
  assert.equal(state(next).value, 'Owner B private description');
  assert.equal(f.form().querySelector('input')!.value, 'Owner B attachment');
  assert.equal(textareaCommit.canCommitTextareas(), true);
  state(next).onCompositionEnd(); assert.equal(f.flush(), true);
  assert.deepEqual(JSON.parse(f.values.get('cv-attachment-draft:v1:owner-b:new')!), { name: 'Owner B attachment', description: 'Owner B private description' });
  assert.equal(f.documentWrites, 0, 'recovering a private editor must not upload or save a file');
});
