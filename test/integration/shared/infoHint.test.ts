import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, markRaw, nextTick, type Component } from 'vue';

const filename = new URL('../../../src/shared/ui/InfoHint.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'InfoHintTest', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)(requireComponent, exports);
const InfoHint = exports.default!;
type Node = {
  tag?: string; text?: string; parent?: Node; children: Node[]; props: Record<string, any>;
  style: { left?: string; top?: string; setProperty(name: string, value: string): void }; visible: boolean; matches: () => boolean;
  showPopover: () => void; hidePopover: () => void; contains: (target: Node) => boolean;
  getBoundingClientRect: () => { left: number; top: number; bottom: number; width: number; height: number };
};
function node(tag?: string, text?: string): Node {
  const result: Node = { tag, text, props: {}, children: [], style: { setProperty(name, value) { result.props[name] = value; } }, visible: false,
    matches: () => result.visible,
    showPopover: () => { result.visible = true; }, hidePopover: () => { result.visible = false; },
    contains: target => target === result || result.children.some(child => child.contains(target)),
    getBoundingClientRect: () => tag === 'button' ? { left: 350, top: 580, bottom: 608, width: 28, height: 28 }
      : { left: 0, top: 0, bottom: 120, width: 300, height: 120 },
  };
  return markRaw(result);
}
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: () => node(),
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
  patchProp(node, key, _previous, value) { node.props[key] = value; }, parentNode: node => node.parent || null, nextSibling: () => null,
});
function find(root: Node, predicate: (node: Node) => boolean): Node[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => find(child, predicate))];
}
function mount(t: TestContext) {
  const listeners = new Map<string, (event: any) => void>();
  const events = {
    addEventListener: (key: string, listener: (event: any) => void) => listeners.set(key, listener),
    removeEventListener: (key: string) => listeners.delete(key),
  };
  const restore: (() => void)[] = [];
  for (const [key, value] of Object.entries({ document: events, window: { ...events, innerWidth: 390, innerHeight: 640 } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  const root = node('root');
  const app = renderer.createApp({ render: () => h('div', [
    h(InfoHint, { label: 'Language', text: 'Your own text is not translated.' }),
    h(InfoHint, { label: 'Sprache', text: 'Eigene Texte werden nicht übersetzt.', lang: 'de' }),
  ]) });
  app.mount(root);
  let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  t.after(() => { unmount(); restore.forEach(run => run()); });
  return { unmount, listeners, buttons: find(root, child => child.tag === 'button'), panels: find(root, child => child.props.role === 'tooltip') };
}

test('help buttons have localized names, unique descriptions and never submit their enclosing form', t => {
  const { buttons, panels } = mount(t);
  assert.equal(buttons[0].props.type, 'button');
  assert.equal(buttons[0].props['aria-label'], 'Information: Language');
  assert.equal(buttons[1].props['aria-label'], 'Informationen: Sprache');
  assert.notEqual(panels[0].props.id, panels[1].props.id);
  for (let i = 0; i < 2; i++) {
    assert.equal(buttons[i].props['aria-describedby'], panels[i].props.id);
    assert.equal(panels[i].props.hidden, true);
  }
});

test('keyboard focus opens help inside the viewport and Escape dismisses only the tooltip', async t => {
  const { buttons, panels, listeners } = mount(t);
  buttons[0].props.onFocus(); await nextTick(); await nextTick();
  assert.equal(panels[0].props.hidden, false);
  assert.equal(panels[0].visible, true);
  assert.equal(panels[0].style.left, '78px', 'help at the right edge stays within a narrow viewport');
  assert.equal(panels[0].style.top, '454px', 'help flips above a button near the bottom');
  assert.equal(panels[0].props['data-placement'], 'top');
  assert.equal(panels[0].props['--info-hint-pointer-left'], '286px', 'the pointer stays aligned with the trigger when the panel shifts away from the screen edge');
  let prevented = false, stopped = false;
  listeners.get('keydown')!({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  await nextTick();
  assert.equal(panels[0].props.hidden, true);
  assert.ok(prevented && stopped, 'Escape must not also dismiss an enclosing dialog');
  assert.equal(listeners.size, 0);
});

test('hover help remains available when the pointer crosses from the button into the tooltip', async t => {
  const { buttons, panels } = mount(t);
  buttons[0].props.onPointerenter(); await nextTick();
  buttons[0].props.onPointerleave();
  panels[0].props.onPointerenter();
  await new Promise(resolve => setTimeout(resolve, 170));
  assert.equal(panels[0].props.hidden, false);
  panels[0].props.onPointerleave();
  await new Promise(resolve => setTimeout(resolve, 170));
  assert.equal(panels[0].props.hidden, true);
});

test('tap opens help without activating a parent label or disclosure, and an outside tap dismisses it', async t => {
  const { buttons, panels, listeners } = mount(t);
  let stopped = false, prevented = false;
  buttons[0].props.onClick({ stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
  await nextTick();
  assert.ok(stopped && prevented);
  assert.equal(panels[0].props.hidden, false);
  listeners.get('pointerdown')!({ target: panels[0] }); await nextTick();
  assert.equal(panels[0].props.hidden, false);
  listeners.get('pointerdown')!({ target: node('outside') }); await nextTick();
  assert.equal(panels[0].props.hidden, true);
  assert.equal(listeners.size, 0);
});

test('scrolling the containing panel dismisses help and unmount cleans up global listeners', async t => {
  const { unmount, buttons, panels, listeners } = mount(t);
  buttons[0].props.onFocus(); await nextTick();
  listeners.get('scroll')!({ target: panels[0] });
  assert.equal(panels[0].visible, true, 'long tooltips may scroll without dismissing themselves');
  listeners.get('scroll')!({ target: panels[0].children[0] });
  assert.equal(panels[0].visible, true, 'scrolling the tooltip content must also keep it open');
  listeners.get('scroll')!({ target: node('scroll-panel') }); await nextTick();
  assert.equal(panels[0].props.hidden, true);
  buttons[0].props.onFocus(); await nextTick();
  assert.ok(listeners.size > 0);
  unmount();
  assert.equal(listeners.size, 0);
});
