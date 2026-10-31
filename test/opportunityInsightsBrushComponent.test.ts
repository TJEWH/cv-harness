import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { opportunityCalendarDate, opportunityCalendarDay } from '../src/features/opportunities/domain/opportunityTimeBrush';

const filename = new URL('../src/features/opportunities/components/OpportunityInsightsBrush.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'brush-pointer-test' });
const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id: 'brush-pointer-test', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const requireComponent = createRequire(filename), componentExports: { default?: Component } = {}, renderExports: { render?: () => unknown } = {};
new Function('require', 'exports', transpile(script.content))(requireComponent, componentExports);
new Function('require', 'exports', transpile(template.code))(requireComponent, renderExports);
const component = { ...componentExports.default, render: renderExports.render };

interface HostNode {
  tag?: string; text?: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode;
  clientWidth: number;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture(id: number): void; hasPointerCapture(id: number): boolean; releasePointerCapture(id: number): void;
}
let viewportWidth = 280;
const left = 37, top = 73, height = 44;
function node(tag?: string, text?: string): HostNode {
  const captured = new Set<number>();
  return { tag, text, props: {}, children: [], clientWidth: viewportWidth,
    getBoundingClientRect: () => ({ left, top, width: viewportWidth, height }),
    setPointerCapture: id => { captured.add(id); }, hasPointerCapture: id => captured.has(id), releasePointerCapture: id => { captured.delete(id); } };
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: text => node(undefined, text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); },
  setText(target, value) { target.text = value; }, setElementText(target, value) { target.text = value; target.children = []; },
  patchProp(target, key, _previous, value) { target.props[key] = value; }, parentNode: target => target.parent ?? null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
});
const descendants = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(descendants)];
const min = opportunityCalendarDay('2026-07-01T00:00:00')!, max = opportunityCalendarDay('2026-10-31T00:00:00')!, span = max - min + 1;
type Range = { start: string; end: string };
const range = (start: number, end: number): Range => ({ start: opportunityCalendarDate(start), end: opportunityCalendarDate(end) });

function mount(t: TestContext, selected: Range, width = 280) {
  viewportWidth = width;
  const previous = new Map(['window', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map<number, FrameRequestCallback>(), listeners = new Map<string, Set<() => void>>();
  let frameId = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener(name: string, listener: () => void) { const values = listeners.get(name) ?? new Set(); values.add(listener); listeners.set(name, values); },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
  } });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => { frames.delete(id); } });
  const props = reactive({ overview: { start: '2026-07-01T00:00:00', end: '2026-10-31T23:59:59.999', buckets: [], unavailableReason: null },
    domainStart: '2026-07-01T00:00:00', domainEnd: '2026-10-31T23:59:59.999', rangeStart: selected.start, rangeEnd: selected.end, lang: 'en' });
  const root = node('root'), ranges: (Range | null)[] = [], active: boolean[] = [];
  const app = renderer.createApp({ render: () => h(component, { ...props,
    'onUpdate:range': (value: Range | null) => { ranges.push(value); props.rangeStart = value?.start ?? ''; props.rangeEnd = value?.end ?? ''; },
    onBrushActive: (value: boolean) => active.push(value) }) });
  app.mount(root);
  t.after(() => {
    app.unmount();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  const svg = descendants(root).find(item => item.tag === 'svg')!;
  const event = (pointerId: number, x: number, y: number, pointerType = 'mouse') => ({ pointerId, clientX: left + x, clientY: top + y, pointerType, button: 0, stopped: false,
    stopPropagation() { this.stopped = true; }, preventDefault() {} });
  const dispatch = (target: HostNode, name: string, value: ReturnType<typeof event>) => {
    for (let current: HostNode | undefined = target; current; current = current.parent) {
      current.props[name]?.(value);
      if (value.stopped) break;
    }
  };
  // SVG paint order decides the actual recipient, including transparent hit
  // rectangles. Calling each handle's handler directly would miss the bug.
  const hit = (x: number, y: number): HostNode => {
    const painted: HostNode[] = [];
    const visit = (item: HostNode) => {
      if (item.props['pointer-events'] === 'none') return;
      if (item.tag === 'rect') {
        const rx = Number(item.props.x ?? 0), ry = Number(item.props.y ?? 0);
        const rw = item.props.width === '100%' ? width : Number(item.props.width), rh = Number(item.props.height);
        if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) painted.push(item);
      }
      item.children.forEach(visit);
    };
    visit(svg);
    assert(painted.length, `the rendered brush has a pointer target at ${x}, ${y}`);
    return painted.at(-1)!;
  };
  const down = (pointerId: number, x: number, y: number, pointerType = 'mouse') => {
    const target = hit(x, y); dispatch(target, 'onPointerdown', event(pointerId, x, y, pointerType)); return target;
  };
  const move = (pointerId: number, x: number, y: number, pointerType = 'mouse') => dispatch(svg, 'onPointermove', event(pointerId, x, y, pointerType));
  const end = (pointerId: number, x: number, y: number, pointerType = 'mouse', name = 'onPointerup') => dispatch(svg, name, event(pointerId, x, y, pointerType));
  return { props, ranges, active, frames, svg, hit, down, move, end, listeners,
    x: (day: number) => (day - min + .5) / span * width,
    flush: async () => { const pending = [...frames]; frames.clear(); pending.forEach(([, callback]) => callback(performance.now())); await nextTick(); },
    current: () => ({ start: props.rangeStart, end: props.rangeEnd }),
    controls: () => descendants(root).filter(item => item.props.role === 'slider'),
    grips: () => descendants(svg).filter(item => item.tag === 'rect' && item.props['pointer-events'] === 'none'),
  };
}

for (const pointerType of ['mouse', 'touch']) for (const side of ['left', 'right']) for (const days of [1, 2]) for (const action of ['start', 'move', 'end']) {
  test(`${pointerType} can ${action} a ${days}-day selection at the ${side} boundary of a 123-day narrow brush`, async t => {
    const start = side === 'left' ? min : max - days + 1, end = start + days - 1;
    const original = range(start, end), view = mount(t, original);
    await nextTick();
    const y = action === 'start' ? 11 : action === 'end' ? 33 : 22, origin = view.x(start);
    const target = view.down(1, origin, y, pointerType);
    assert.equal(target.props['aria-label'], 'Brush end date', 'paint order really sends the shared overlapping area to the final endpoint');
    const targetDay = side === 'left' ? min + 7 : max - 7, destination = view.x(targetDay);
    // Touch intent requires 8px even when a single calendar day is much narrower.
    view.move(1, origin + Math.sign(destination - origin) * 12, y + 1, pointerType);
    view.move(1, destination, y + 1, pointerType);
    assert.deepEqual(view.ranges, [], 'only the local selection changes before release');
    view.end(1, destination, y + 1, pointerType); await nextTick();
    const expected = action === 'start' ? range(Math.min(targetDay, end), end)
      : action === 'end' ? range(start, Math.max(targetDay, start))
        : range(targetDay, targetDay + days - 1);
    assert.deepEqual(view.current(), expected);
    assert.equal(view.ranges.length, JSON.stringify(original) === JSON.stringify(expected) ? 0 : 1);
    assert.deepEqual(view.active, [true, false]);
    assert.equal(view.svg.hasPointerCapture(1), false);
  });
}

test('compact grips expose distinct upper and lower resize lanes beside the center move lane', async t => {
  const view = mount(t, range(max, max), 900); await nextTick();
  const [start, end] = view.grips();
  assert(start && end);
  assert(Number(start.props.y) + Number(start.props.height) <= 44 / 3);
  assert(Number(end.props.y) >= 88 / 3);
  assert(view.controls().slice(1).every(control => control.props.width === '44' && control.props.height === '44'));
  assert.equal(view.svg.props.viewBox, '0 0 900 44');
  view.down(1, view.x(max), 11); view.move(1, view.x(max - 4), 11); view.end(1, view.x(max - 4), 11); await nextTick();
  assert.deepEqual(view.current(), range(max - 4, max));
});

test('wider selections retain normal endpoint actions at every height and center translation', async t => {
  const start = min + 30, end = max - 30, view = mount(t, range(start, end)); await nextTick();
  view.down(1, view.x(start), 33); view.move(1, view.x(start + 3), 33); view.end(1, view.x(start + 3), 33); await nextTick();
  assert.deepEqual(view.current(), range(start + 3, end), 'a lower start-handle press still adjusts the start when targets are separate');
  view.down(2, view.x(end), 11); view.move(2, view.x(end - 3), 11); view.end(2, view.x(end - 3), 11); await nextTick();
  assert.deepEqual(view.current(), range(start + 3, end - 3), 'an upper end-handle press still adjusts the end when targets are separate');
  const anchor = start + 20;
  view.down(3, view.x(anchor), 11); view.move(3, view.x(anchor + 4), 11); view.end(3, view.x(anchor + 4), 11); await nextTick();
  assert.deepEqual(view.current(), range(start + 7, end + 1));
});

test('compact touch lanes preserve vertical intent cancellation and accept the next horizontal drag', async t => {
  const original = range(max, max), view = mount(t, original); await nextTick();
  const x = view.x(max);
  view.down(1, x, 11, 'touch'); view.move(1, x - 2, 40, 'touch'); view.end(1, x - 50, 40, 'touch');
  assert.deepEqual(view.active, []); assert.deepEqual(view.ranges, []);
  assert.equal(view.svg.hasPointerCapture(1), false);
  view.down(2, x, 11, 'touch'); view.move(2, view.x(max - 7), 12, 'touch'); view.end(2, view.x(max - 7), 12, 'touch'); await nextTick();
  assert.deepEqual(view.current(), range(max - 7, max));
  assert.deepEqual(view.active, [true, false]);
});

for (const cancellation of ['onPointercancel', 'onLostpointercapture', 'blur']) {
  test(`${cancellation} restores a compact preview and leaves subsequent gestures usable`, async t => {
    const original = range(min, min), view = mount(t, original); await nextTick();
    const x = view.x(min), destination = view.x(min + 7);
    view.down(1, x, 33, 'touch'); view.move(1, destination, 34, 'touch'); await view.flush();
    if (cancellation === 'blur') view.listeners.get('blur')?.forEach(listener => listener());
    else view.end(1, destination, 34, 'touch', cancellation);
    view.end(1, destination, 34, 'touch'); await nextTick();
    assert.deepEqual(view.current(), original); assert.deepEqual(view.ranges, []);
    assert.equal(view.frames.size, 0); assert.equal(view.svg.hasPointerCapture(1), false);
    view.down(2, x, 22, 'touch'); view.move(2, destination, 23, 'touch'); view.end(2, destination, 23, 'touch'); await nextTick();
    assert.deepEqual(view.current(), range(min + 7, min + 7));
    assert.deepEqual(view.active, [true, false, true, false]);
  });
}

test('compact translation keeps capture outside the brush and ignores a second pointer', async t => {
  const view = mount(t, range(max, max)); await nextTick();
  const x = view.x(max);
  view.down(1, x, 22, 'touch'); view.down(2, x, 11, 'touch');
  view.move(2, view.x(max - 20), 11, 'touch'); view.end(2, view.x(max - 20), 11, 'touch');
  assert.deepEqual(view.ranges, []); assert.deepEqual(view.active, []);
  view.move(1, -50, 23, 'touch'); view.end(1, -50, 23, 'touch'); await nextTick();
  assert.deepEqual(view.current(), range(min, min));
  assert.deepEqual(view.active, [true, false]); assert.equal(view.svg.hasPointerCapture(1), false);
});

test('compact selections retain keyboard endpoint alternatives independently of pointer lanes', async t => {
  const view = mount(t, range(max, max)); await nextTick();
  const [, start, end] = view.controls();
  start!.props.onKeydown({ key: 'ArrowLeft', shiftKey: false, preventDefault() {} }); await nextTick();
  assert.deepEqual(view.current(), range(max - 1, max));
  end!.props.onKeydown({ key: 'ArrowLeft', shiftKey: false, preventDefault() {} }); await nextTick();
  assert.deepEqual(view.current(), range(max - 1, max - 1));
  assert.deepEqual(view.active, []);
});
