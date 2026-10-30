import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, type Component } from 'vue';
import type { PrivacyEditorContext } from '../src/documents/privacy/composables/privacyEditorContext';

const filename = new URL('../src/documents/privacy/components/PrivacyField.vue', import.meta.url);
const requireComponent = createRequire(filename);
const script = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'PrivacyFieldTest', inlineTemplate: true });
const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
// InfoHint's browser interactions are covered separately; inspect PrivacyField's help contract here.
const InfoHint = defineComponent({ props: ['id', 'text', 'label', 'lang'], setup: props => () => h('info-hint', { ...props }) });
new Function('require', 'exports', code)((path: string) => path === '../../../shared/ui/InfoHint.vue' ? { default: InfoHint } : requireComponent(path), componentExports);
const PrivacyField = componentExports.default!;
const { PRIVACY_EDITOR } = requireComponent('../composables/privacyEditorContext');

type Node = { tag?: string; text?: string; props: Record<string, unknown>; children: Node[]; parent?: Node };
const node = (tag?: string, text?: string): Node => ({ tag, text, props: {}, children: [] });
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: () => node(),
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText(node, value) { node.text = value; }, setElementText(node, value) { node.text = value; },
  patchProp(node, key, _previous, value) { node.props[key] = value; },
  parentNode: node => node.parent || null, nextSibling: () => null,
});
function find(root: Node, predicate: (node: Node) => boolean): Node[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => find(child, predicate))];
}
function mountFields(t: TestContext, owners: object[], context?: PrivacyEditorContext) {
  const root = node('root');
  const app = renderer.createApp({ render: () => h('section', owners.map(owner => h(PrivacyField, { owner, field: 'name' }, {
    default: ({ disabled }: { disabled: boolean }) => h('label', ['Name', h('input', { disabled })]),
  }))) });
  if (context) app.provide(PRIVACY_EDITOR, context);
  app.mount(root); t.after(() => app.unmount());
  return { root, fields: () => find(root, child => child.tag === 'div' && String(child.props.class).includes('editor-field')) };
}

test('ordinary Content fields remain enabled without privacy styling or extra controls', t => {
  const { root, fields } = mountFields(t, [{ name: 'Original name' }]);
  assert.equal(find(root, child => child.tag === 'input')[0].props.disabled, false);
  assert.doesNotMatch(String(fields()[0].props.class), /privacy-field--(?:edited|masked)/);
  assert.equal(fields()[0].props.role, undefined);
  assert.equal(fields()[0].props.tabindex, undefined);
  assert.equal(find(root, child => child.tag === 'button').length, 0);
});

test('automatic masks disable the scoped control and expose an explanation without a manual-edit highlight', async t => {
  const owner = { name: 'Original name' };
  const status = reactive({ original: owner.name, changed: false, automaticMask: 'header' as 'header' | undefined, reset() {} });
  const { root, fields } = mountFields(t, [owner], { language: () => 'en', field: () => status, hiddenInContent: () => false });
  const field = fields()[0];
  assert.equal(find(root, child => child.tag === 'input')[0].props.disabled, true);
  assert.match(String(field.props.class), /privacy-field--masked/);
  assert.doesNotMatch(String(field.props.class), /privacy-field--edited/);
  assert.equal(field.props.role, 'group');
  assert.equal(field.props.tabindex, 0, 'a disabled control retains a keyboard-accessible explanation');
  const help = find(root, child => child.props.id === field.props['aria-describedby'])[0];
  assert.equal(help.tag, 'info-hint');
  assert.match(String(help.props.text), /always automatically masked/);
  assert.equal(help.props.label, 'Automatic masking');
  assert.equal(help.props.lang, 'en');
  assert.equal(find(root, child => child.tag === 'button').length, 0);
  status.automaticMask = undefined; await nextTick();
  assert.equal(find(root, child => child.tag === 'input')[0].props.disabled, false);
  assert.equal(field.props['aria-describedby'], undefined);
});

test('a single labelled icon button reverts only its modified field and removes its highlight', async t => {
  const first = { name: 'First public name' }, second = { name: 'Second public name' };
  const resets: object[] = [];
  const statuses = [first, second].map((owner, index) => reactive({ original: `Original ${index}`, changed: true,
    reset() { resets.push(owner); owner.name = this.original; this.changed = false; } }));
  const language = reactive({ value: 'en' });
  const { fields } = mountFields(t, [first, second], {
    language: () => language.value, field: owner => statuses[owner === first ? 0 : 1], hiddenInContent: () => false,
  });
  for (const field of fields()) {
    assert.match(String(field.props.class), /privacy-field--edited/);
    assert.doesNotMatch(String(field.props.class), /privacy-field--masked/);
    const buttons = find(field, child => child.tag === 'button');
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].props.type, 'button');
    assert.equal(buttons[0].props['aria-label'], 'Revert privacy edit');
    assert.equal(buttons[0].props.title, 'Revert privacy edit');
    assert.equal(find(buttons[0], child => child.tag === 'svg')[0].props['aria-hidden'], 'true');
  }
  language.value = 'de'; await nextTick();
  const button = find(fields()[0], child => child.tag === 'button')[0];
  assert.equal(button.props['aria-label'], 'Datenschutzänderung zurücksetzen');
  let stopped = 0, prevented = 0;
  (button.props.onClick as (event: unknown) => void)({ stopPropagation() { stopped++; }, preventDefault() { prevented++; } });
  await nextTick();
  assert.deepEqual(resets, [first]);
  assert.equal(first.name, 'Original 0');
  assert.equal(second.name, 'Second public name');
  assert.equal(stopped, 1); assert.equal(prevented, 1);
  assert.doesNotMatch(String(fields()[0].props.class), /privacy-field--edited/);
  assert.equal(find(fields()[0], child => child.tag === 'button').length, 0);
  assert.equal(find(fields()[1], child => child.tag === 'button').length, 1);
});

test('a retained manual edit remains distinguishable and reversible while its automatic mask is active', t => {
  const owner = { name: 'Saved privacy wording' };
  let resets = 0;
  const { root, fields } = mountFields(t, [owner], { language: () => 'en', hiddenInContent: () => false,
    field: () => ({ original: 'Original company', changed: true, automaticMask: 'company', reset() { resets++; } }),
  });
  assert.match(String(fields()[0].props.class), /privacy-field--edited/);
  assert.match(String(fields()[0].props.class), /privacy-field--masked/);
  assert.equal(find(root, child => child.tag === 'input')[0].props.disabled, true);
  const help = find(root, child => child.tag === 'info-hint')[0];
  assert.match(String(help.props.text), /saved privacy edit is retained/);
  const button = find(root, child => child.tag === 'button' && child.props['aria-label'] === 'Revert privacy edit')[0];
  assert.equal(button.props.disabled, undefined, 'revert stays available when direct editing is disabled');
  (button.props.onClick as (event: unknown) => void)({ stopPropagation() {}, preventDefault() {} });
  assert.equal(resets, 1);
});
