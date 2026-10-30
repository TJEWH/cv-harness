import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, markRaw, nextTick, reactive, type Component, type VNodeChild } from 'vue';

function compile(path: string, replacements: Record<string, unknown> = {}): Component {
  const filename = new URL(path, import.meta.url);
  const script = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: path, inlineTemplate: true });
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result: { default?: Component } = {};
  const require = createRequire(filename);
  new Function('require', 'exports', code)((name: string) => replacements[name] ?? require(name), result);
  return result.default!;
}
const SectionHeading = compile('../src/shared/ui/SectionHeading.vue');
const Frame = compile('../src/features/cv-studio/components/CvSectionFrame.vue', {
  '../../../shared/ui/SectionHeading.vue': { default: SectionHeading },
});

class RenderNode {
  props: Record<string, unknown> = {};
  children: RenderNode[] = [];
  parent: RenderNode | null = null;
  constructor(readonly tag: string, public text = '') {}
  closest(selector: string): RenderNode | null {
    const matches = selector.split(',').some(value => {
      const part = value.trim();
      if (part === '.p-select') return hasClass(this, 'p-select');
      if (part === '[contenteditable="true"]') return this.props.contenteditable === 'true';
      return this.tag === part;
    });
    return matches ? this : this.parent?.closest(selector) ?? null;
  }
}
const renderer = createRenderer<RenderNode, RenderNode>({
  createElement: tag => markRaw(new RenderNode(tag)), createText: text => new RenderNode('#text', text), createComment: text => new RenderNode('#comment', text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; node.children = []; },
  patchProp(node, key, _previous, value) { node.props[key] = value; }, parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});
const hasClass = (node: RenderNode, name: string) => String(node.props.class || '').split(/\s+/).includes(name);
function find(root: RenderNode, predicate: (node: RenderNode) => boolean): RenderNode[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => find(child, predicate))];
}
const elementChildren = (node: RenderNode) => node.children.filter(child => !child.tag.startsWith('#'));
function dispatch(node: RenderNode, name: string, details: Record<string, unknown> = {}) {
  let stopped = 0;
  const event = { target: node, stopPropagation() { stopped++; }, preventDefault() { assert.fail('Section controls must preserve native defaults'); }, ...details };
  const handlers = node.props[name] as ((event: object) => void) | ((event: object) => void)[] | undefined;
  assert(handlers, `Missing ${name} handler on ${node.tag}`);
  for (const handler of Array.isArray(handlers) ? handlers : [handlers]) handler(event);
  return stopped;
}
const InputText = defineComponent({
  inheritAttrs: false, props: ['modelValue', 'placeholder'], emits: ['update:modelValue'],
  setup(props, { attrs, emit }) { return () => h('input', { ...attrs, value: props.modelValue, placeholder: props.placeholder,
    onInput: (event: { target: { value: string } }) => emit('update:modelValue', event.target.value) }); },
});
const Select = defineComponent({
  inheritAttrs: false, props: ['modelValue', 'options', 'optionLabel', 'optionValue'], emits: ['update:modelValue'],
  setup(props, { attrs, emit }) { return () => h('select', { ...attrs, value: props.modelValue,
    onChange: (event: { target: { value: string } }) => emit('update:modelValue', event.target.value) },
  (props.options as { label: string; value: string }[]).map(option => h('option', { value: option.value }, option.label))); },
});

interface FrameProps {
  contentId: string; lang: string; title: string; collapsed: boolean; disabled: boolean; completed: boolean;
  toggleable: boolean; visibilityLocked: boolean; visibilityLabel?: string;
  modes: { config?: boolean; reorder?: boolean; versions?: boolean; todos?: boolean };
  titleEditor?: { editable: boolean; editing: boolean; value: string; placeholder?: string };
  headerSize?: string; keepTogether?: boolean;
}
function mount(t: TestContext, overrides: Partial<FrameProps> = {}, slots: Record<string, (scope: { controls: string }) => VNodeChild> = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: RenderNode });
  const props = reactive<FrameProps>({ contentId: 'research-content', lang: 'en', title: 'Research', collapsed: false,
    disabled: false, completed: false, toggleable: true, visibilityLocked: false, modes: {}, ...overrides });
  const events: { name: string; args: unknown[] }[] = [];
  const listeners = Object.fromEntries(['toggle-section', 'toggle-collapse', 'toggle-complete', 'toggle-keep-together', 'start-edit-title',
    'finish-edit-title', 'cancel-edit-title', 'update-editing-value', 'header-size-change'].map(name => [
    `on${name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`,
    (...args: unknown[]) => events.push({ name, args }),
  ]));
  const root = new RenderNode('root');
  let instance: { getElement(): RenderNode } | null = null;
  const app = renderer.createApp({ render: () => h(Frame, { ...props, ...listeners, class: 'content-section', 'data-section': 'research',
    ref: (value: unknown) => { instance = value as typeof instance; } }, slots) });
  app.component('InputText', InputText); app.component('Select', Select);
  app.component('font-awesome-icon', { render: () => h('svg', { 'aria-hidden': true }) });
  app.mount(root);
  t.after(() => {
    app.unmount();
    if (previous) Object.defineProperty(globalThis, 'Element', previous);
    else Reflect.deleteProperty(globalThis, 'Element');
  });
  const section = root.children.find(node => node.tag === 'section')!;
  const byClass = (name: string) => find(section, node => hasClass(node, name));
  return { props, events, section, byClass, getElement: () => instance!.getElement() };
}

test('section frame preserves native direct-child structure, caller attributes, stable content and collapse accessibility', async t => {
  const f = mount(t, { disabled: true, completed: true, collapsed: true, modes: { todos: true } }, {
    'before-header': () => h('aside', { 'data-dialog': 'existing-confirmation' }), default: () => h('textarea', { value: 'Retained draft' }),
  });
  assert.equal(f.getElement(), f.section, 'focus owners receive the actual section element');
  assert.equal(f.section.props['data-section'], 'research');
  for (const name of ['section-group', 'content-section', 'disabled', 'completed', 'collapsed']) assert(hasClass(f.section, name), name);
  const [before, header, content] = elementChildren(f.section);
  assert.equal(before.tag, 'aside'); assert(hasClass(header, 'section-head')); assert(hasClass(content, 'section-content'));
  assert.equal(content.props.id, 'research-content'); assert.equal(content.props.inert, true);
  const inner = elementChildren(content)[0]; assert(hasClass(inner, 'section-content__inner'));
  const draft = elementChildren(inner)[0]; assert.equal(draft.props.value, 'Retained draft');
  f.props.collapsed = false; f.props.disabled = false; f.props.modes = {}; await nextTick();
  assert.equal(content.props.inert, false);
  for (const name of ['disabled', 'completed', 'collapsed']) assert(!hasClass(f.section, name), name);
  assert.equal(elementChildren(content)[0], inner); assert.equal(elementChildren(inner)[0], draft, 'collapse updates must retain editor DOM');
  const heading = f.byClass('section-heading-button')[0];
  assert.equal(heading.props['aria-controls'], content.props.id); assert.equal(heading.props['aria-expanded'], true);
});

test('header collapse ignores native and composite controls including descendants without intercepting selection defaults', t => {
  const f = mount(t, {}, { heading: () => h('div', { class: 'custom-heading' }, [
    h('span', { 'data-target': 'text' }, 'Research'), h('button', [h('svg')]), h('input'), h('select'), h('textarea'), h('a', [h('span')]),
    h('div', { contenteditable: 'true' }, [h('span')]), h('div', { class: 'p-select' }, [h('span')]),
  ]) });
  const header = f.byClass('section-head')[0];
  dispatch(header, 'onClick');
  const heading = f.byClass('custom-heading')[0];
  dispatch(header, 'onClick', { target: find(heading, node => node.props['data-target'] === 'text')[0] });
  assert.deepEqual(f.events.map(event => event.name), ['toggle-collapse', 'toggle-collapse']);
  for (const control of elementChildren(heading).slice(1)) {
    dispatch(header, 'onClick', { target: control });
    for (const child of elementChildren(control)) dispatch(header, 'onClick', { target: child });
  }
  assert.equal(f.events.length, 2, 'controls and their icons/text must not collapse their parent section');
});

test('shared visibility, keep-together, heading size and completion controls retain their independent events', async t => {
  const f = mount(t, { disabled: true, completed: true, visibilityLocked: true, visibilityLabel: 'Show: Research',
    modes: { config: true, todos: true }, keepTogether: false, headerSize: 'h3' });
  const visibility = f.byClass('visibility-toggle')[0];
  assert.equal(visibility.props.type, 'button'); assert.equal(visibility.props.disabled, true);
  assert.equal(visibility.props['aria-label'], 'Show: Research'); assert(hasClass(visibility, 'btn--success'));
  f.props.visibilityLocked = false; await nextTick();
  assert.equal(visibility.props.disabled, false); assert.equal(dispatch(visibility, 'onClick'), 1);
  const keep = f.byClass('section-break-toggle')[0];
  assert.equal(keep.props['aria-pressed'], false); assert.equal(dispatch(keep, 'onClick'), 1);
  f.props.keepTogether = true; await nextTick();
  assert.equal(keep.props['aria-pressed'], true); assert(hasClass(keep, 'section-break-toggle--active'));
  const size = f.byClass('header-size-select')[0];
  assert.equal(size.props.value, 'h3');
  assert.deepEqual(elementChildren(size).map(option => option.props.value), ['h2', 'h3', 'h4', 'null']);
  dispatch(size, 'onChange', { target: { value: 'h4' } });
  const completion = find(f.section, node => node.tag === 'input' && node.props.type === 'checkbox')[0];
  assert.equal(completion.props.checked, true); dispatch(completion, 'onChange');
  assert.deepEqual(f.events, [
    { name: 'toggle-section', args: [] }, { name: 'toggle-keep-together', args: [] },
    { name: 'header-size-change', args: ['h4'] }, { name: 'toggle-complete', args: [] },
  ]);
  f.props.toggleable = false; f.props.keepTogether = undefined; await nextTick();
  assert.equal(f.byClass('visibility-toggle').length, 0); assert.equal(f.byClass('section-break-toggle').length, 0);
});

test('title editing separates collapse from rename and preserves keyboard-versus-blur focus requests', async t => {
  const f = mount(t, { collapsed: true, titleEditor: { editable: true, editing: false, value: 'Research', placeholder: 'Section name' } });
  dispatch(f.byClass('section-heading-button')[0], 'onClick');
  assert.deepEqual(f.events.pop(), { name: 'toggle-collapse', args: [] });
  f.props.modes = { config: true }; await nextTick();
  const rename = f.byClass('section-heading-button')[0], collapse = f.byClass('section-collapse-button')[0];
  assert.match(String(rename.props['aria-label']), /Research/); assert.equal(rename.props['aria-expanded'], undefined);
  assert.equal(collapse.props['aria-controls'], 'research-content'); assert.equal(collapse.props['aria-expanded'], false);
  dispatch(rename, 'onClick'); dispatch(collapse, 'onClick');
  assert.deepEqual(f.events.splice(0), [{ name: 'start-edit-title', args: [] }, { name: 'toggle-collapse', args: [] }]);
  f.props.titleEditor!.editing = true; await nextTick();
  const input = f.byClass('section-name-input')[0];
  assert.equal(input.props.value, 'Research'); assert.equal(input.props.placeholder, 'Section name');
  dispatch(input, 'onInput', { target: { value: 'A renamed section' } });
  dispatch(input, 'onBlur'); dispatch(input, 'onKeyup', { key: 'Enter' }); dispatch(input, 'onKeyup', { key: 'Escape' });
  dispatch(input, 'onKeyup', { key: 'a' });
  assert.deepEqual(f.events.splice(0), [
    { name: 'update-editing-value', args: ['A renamed section'] }, { name: 'finish-edit-title', args: [false] },
    { name: 'finish-edit-title', args: [true] }, { name: 'cancel-edit-title', args: [true] },
  ]);
  f.props.modes = { config: true, reorder: true }; await nextTick();
  assert.equal(f.byClass('section-name-input').length, 0); assert.equal(f.byClass('section-heading-button').length, 0);
  assert.equal(f.byClass('section-collapse-button').length, 0, 'reordering keeps heading controls unavailable');
});

test('custom privacy headings receive the existing content id and version controls replace the action row', async t => {
  const f = mount(t, { modes: { versions: true, config: true, todos: true }, keepTogether: true }, {
    heading: ({ controls }) => h('h3', { class: 'privacy-section-heading', 'data-controls': controls }, 'Private section title'),
    'section-version': () => h('select', { class: 'section-version-select' }),
    actions: () => h('button', { class: 'custom-action', type: 'button' }, 'Configure fields'),
    default: () => h('p', 'Section content'),
  });
  const heading = f.byClass('privacy-section-heading')[0];
  assert.equal(heading.props['data-controls'], 'research-content'); assert.equal(f.byClass('section-heading-button').length, 0);
  const header = f.byClass('section-head')[0], version = f.byClass('section-version-select')[0];
  assert.equal(version.parent, header, 'version selector must remain a direct child for existing CSS and focus order');
  assert.equal(f.byClass('section-head__actions').length, 0); assert.equal(f.byClass('custom-action').length, 0);
  f.props.modes = { config: true, todos: true }; await nextTick();
  assert.equal(f.byClass('section-version-select').length, 0);
  const actions = f.byClass('section-head__actions')[0];
  assert.equal(actions.parent, header);
  assert(hasClass(elementChildren(actions)[0], 'custom-action'), 'caller actions retain their position before shared configuration controls');
  assert.equal(f.byClass('privacy-section-heading')[0], heading, 'mode changes retain the supplied privacy heading');
});
