import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, type Component } from 'vue';
import type { OpportunityAlignmentStats, OpportunityInsightTimeline } from '../../../src/features/opportunities/domain/opportunityInsights';

const components = new URL('../../../src/features/opportunities/components/', import.meta.url);
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const compiled = new Map<string, Component>();
function loadComponent(name: string): Component {
  const existing = compiled.get(name); if (existing) return existing;
  const filename = new URL(`${name}.vue`, components), requireComponent = createRequire(filename);
  const { descriptor } = parse(readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: name });
  const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id: name, compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const componentExports: { default?: Component } = {}, renderExports: { render?: () => unknown } = {};
  const module = (path: string) => path.endsWith('InfoHint.vue') ? { default: defineComponent({ setup: () => () => h('span') }) }
    : path.endsWith('.vue') ? { default: loadComponent(path.split('/').at(-1)!.replace('.vue', '')) } : requireComponent(path);
  new Function('require', 'exports', transpile(script.content))(module, componentExports);
  new Function('require', 'exports', transpile(template.code))(module, renderExports);
  const component = { ...componentExports.default, render: renderExports.render };
  compiled.set(name, component); return component;
}
interface HostNode {
  tag?: string; text?: string; props: Record<string, unknown>; children: HostNode[]; parent?: HostNode;
  clientWidth: number; boundsReads: number; getBoundingClientRect(): { left: number; width: number };
  setPointerCapture(id: number): void; hasPointerCapture(id: number): boolean; releasePointerCapture(id: number): void;
}
function node(tag?: string, text?: string): HostNode {
  const captured = new Set<number>();
  const value: HostNode = { tag, text, props: {}, children: [], clientWidth: 900, boundsReads: 0,
    getBoundingClientRect() { value.boundsReads++; return { left: 0, width: 900 }; },
    setPointerCapture: id => { captured.add(id); }, hasPointerCapture: id => captured.has(id), releasePointerCapture: id => { captured.delete(id); } };
  return value;
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
  nextSibling: target => target.parent?.children[(target.parent.children.indexOf(target) + 1)] ?? null,
});
const descendants = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(descendants)];
const alignment = (patch: Partial<OpportunityAlignmentStats> = {}): OpportunityAlignmentStats => ({ pairedCount: 0, highFitCount: 0, alignedHighCount: 0, highFitHitRate: null, highFitHitInterval: null,
  falsePositiveCount: 0, falsePositiveRate: null, ownerHighCount: 0, missedHighInterestCount: 0, lowFitCount: 0, missedHighInterestRate: null, spearman: null, meanAbsoluteGap: null, meanSignedGap: null, ...patch });
const timeline: OpportunityInsightTimeline = { aggregation: 'week', start: '2026-10-01T00:00:00', end: '2026-10-31T23:59:59.999', requiredBucketCount: 2, bucketLimit: 4096, unavailableReason: null, buckets: [
  { start: '2026-10-01T00:00:00', end: '2026-10-15T23:59:59.999', addedCount: 3, reviewedCount: 2, highInterestCount: 1, mismatchCount: 1, pairedCount: 2, alignment: alignment({ pairedCount: 2, highFitCount: 2, alignedHighCount: 1, highFitHitRate: .5, highFitHitInterval: { lower: .095, upper: .905 } }), topicHighCounts: { acoustics: 1 } },
  { start: '2026-10-16T00:00:00', end: '2026-10-31T23:59:59.999', addedCount: 5, reviewedCount: 3, highInterestCount: 2, mismatchCount: 1, pairedCount: 3, alignment: alignment({ pairedCount: 3 }), topicHighCounts: { acoustics: 2 } },
] };
function event(pointerId: number, clientX: number, clientY = 20, pointerType = 'mouse') {
  return { pointerId, clientX, clientY, pointerType, button: 0, stopPropagation() {}, preventDefault() {} };
}
function call(target: HostNode, handler: string, value: unknown) {
  assert(target, 'the requested rendered control exists');
  assert.equal(typeof target.props[handler], 'function', `${handler} should be attached to ${target.props.class}`);
  (target.props[handler] as (value: unknown) => void)(value);
}
function mount(t: TestContext, kind: 'brush' | 'chart' | 'controls' = 'brush', range: { start: string; end: string } | null = null) {
  const previous = new Map(['window', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map<string, Set<(event?: KeyboardEvent) => void>>(), frames = new Map<number, FrameRequestCallback>();
  let disconnects = 0, frameId = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: (name: string, fn: (event?: KeyboardEvent) => void) => { const values = listeners.get(name) ?? new Set(); values.add(fn); listeners.set(name, values); }, removeEventListener: (name: string, fn: (event?: KeyboardEvent) => void) => listeners.get(name)?.delete(fn) } });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() { disconnects++; } } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => { frames.delete(id); } });
  const props = reactive({ timeline, overview: timeline, topics: [{ id: 'acoustics', label: 'Acoustics', highInterestCount: 3 }], selectedTopicIds: ['acoustics'], selectedJob: null,
    rangeStart: range?.start ?? null, rangeEnd: range?.end ?? null, domainStart: '2026-10-01T00:00:00', domainEnd: '2026-10-31T23:59:59.999', lang: 'en', aggregation: 'auto' as const,
    view: 'outcomes' as 'outcomes' | 'topics' | 'alignment', showControls: true, panelId: 'test-development-plot' });
  const ranges: ({ start: string; end: string } | null)[] = [], active: boolean[] = [], views: string[] = [];
  const root = node('root');
  const component = loadComponent(kind === 'brush' ? 'OpportunityInsightsBrush' : kind === 'controls' ? 'OpportunityInsightsTimelineControls' : 'OpportunityInsightsTimeline');
  const app = renderer.createApp({ render: () => h(component, { ...props,
    'onUpdate:range': (value: { start: string; end: string } | null) => { ranges.push(value); props.rangeStart = value?.start ?? null; props.rangeEnd = value?.end ?? null; },
    'onUpdate:view': (value: typeof props.view) => { props.view = value; views.push(value); },
    onBrushActive: (value: boolean) => active.push(value) }) });
  app.mount(root);
  let closed = false;
  const close = () => { if (!closed) { closed = true; app.unmount(); } };
  t.after(() => {
    close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { props, ranges, active, views, close, listeners, frames, disconnects: () => disconnects,
    flushFrames: () => { const pending = [...frames]; frames.clear(); for (const [, callback] of pending) callback(performance.now()); },
    byClass: (value: string) => descendants(root).find(item => item.props.class === value)!,
    byRole: (value: string) => descendants(root).filter(item => item.props.role === value),
    tab: (name: string) => descendants(root).find(item => item.props.role === 'tab' && item.text === name)!,
    text: () => descendants(root).map(item => item.text ?? '').join(' ') };
}

test('the shared footer contains only the inclusive selection span and brush controls', t => {
  const view = mount(t);
  assert.equal(view.byClass('insights-brush').props['aria-label'], 'Shared addition date brush');
  assert.match(view.text(), /2026-10-01 – 2026-10-31 · 31 days/u);
  assert.equal(view.byRole('button').length, 0);
  assert.equal(view.byRole('tab').length, 0);
  assert.equal(view.byClass('timeline-heading'), undefined);
  assert.deepEqual(view.byRole('slider').map(item => item.props['aria-label']), ['Move selected date range', 'Brush start date', 'Brush end date']);
});

test('rapid dragging previews locally once per frame and commits one cohort change on release', async t => {
  const view = mount(t), svg = view.byClass('timeline-brush'), selection = view.byClass('timeline-brush-selection');
  const started = performance.now();
  call(selection, 'onPointerdown', event(1, 225));
  for (let i = 0; i < 1000; i++) call(svg, 'onPointermove', event(1, 225 + i * .45));
  const elapsed = performance.now() - started;
  assert.equal(view.ranges.length, 0, 'expensive parent-cohort updates never run during pointer movement');
  assert.deepEqual(view.active, [true]);
  assert.equal(svg.boundsReads, 1, 'the gesture caches geometry rather than forcing layout on each pointer event');
  assert.equal(view.frames.size, 1, 'a burst schedules one latest-value preview');
  view.flushFrames(); await nextTick();
  assert.match(view.text(), /2026-10-08 – 2026-10-24 · 17 days/u);
  call(svg, 'onPointerup', event(1, 675)); await nextTick();
  assert.deepEqual(view.ranges, [{ start: '2026-10-08', end: '2026-10-24' }]);
  assert.deepEqual(view.active, [true, false]);
  assert.equal(view.frames.size, 0);
  t.diagnostic(`1,000 pointer updates: ${elapsed.toFixed(2)} ms; 0 cohort emissions while dragging, 1 on release (previous path emitted 1,002 across this gesture).`);
});

test('cancelling an uncommitted drag restores All history without a rollback computation', async t => {
  const view = mount(t), svg = view.byClass('timeline-brush');
  call(view.byClass('timeline-brush-selection'), 'onPointerdown', event(1, 225));
  call(svg, 'onPointermove', event(1, 675)); view.flushFrames(); await nextTick();
  call(svg, 'onPointercancel', event(1, 675)); await nextTick();
  assert.deepEqual(view.ranges, []);
  assert.match(view.text(), /2026-10-01 – 2026-10-31 · 31 days/u);
  assert.deepEqual(view.active, [true, false]);
});

test('touch brushing leaves vertical scrolling native and accepts the next horizontal gesture', async t => {
  const view = mount(t), selection = view.byClass('timeline-brush-selection'), svg = view.byClass('timeline-brush');
  call(selection, 'onPointerdown', event(1, 200, 20, 'touch'));
  call(svg, 'onPointermove', event(1, 202, 70, 'touch'));
  assert.deepEqual(view.active, []); assert.deepEqual(view.ranges, []);
  assert.equal(svg.hasPointerCapture(1), false);
  call(selection, 'onPointerdown', event(2, 200, 20, 'touch'));
  call(svg, 'onPointermove', event(2, 600, 22, 'touch'));
  call(svg, 'onPointerup', event(2, 600, 22, 'touch')); await nextTick();
  assert.deepEqual(view.active, [true, false]);
  assert.equal(view.ranges.length, 1);
});

test('lost capture and window blur discard previews without changing the last committed range', async t => {
  const initial = { start: '2026-10-10', end: '2026-10-20' };
  const view = mount(t, 'brush', initial), svg = view.byClass('timeline-brush');
  for (const interruption of ['capture', 'blur']) {
    call(view.byClass('timeline-brush-selection'), 'onPointerdown', event(1, 450));
    call(svg, 'onPointermove', event(1, 700)); view.flushFrames(); await nextTick();
    if (interruption === 'capture') call(svg, 'onLostpointercapture', event(1, 700));
    else for (const listener of view.listeners.get('blur') ?? []) listener();
    await nextTick();
    assert.deepEqual(view.ranges, []);
    assert.match(view.text(), /2026-10-10 – 2026-10-20 · 11 days/u);
    assert.equal(svg.hasPointerCapture(1), false);
  }
  assert.deepEqual(view.active, [true, false, true, false]);
});

test('Escape from an unrelated focused control cancels a ground-created range without committing it', async t => {
  const view = mount(t), svg = view.byClass('timeline-brush');
  call(view.byClass('timeline-brush-ground'), 'onPointerdown', event(1, 225));
  call(svg, 'onPointermove', event(1, 675)); view.flushFrames(); await nextTick();
  let prevented = false;
  for (const listener of view.listeners.get('keydown') ?? []) listener({ key: 'Escape', preventDefault() { prevented = true; }, target: { tagName: 'INPUT' } } as unknown as KeyboardEvent);
  call(svg, 'onPointerup', event(1, 675)); await nextTick();
  assert.equal(prevented, true);
  assert.deepEqual(view.ranges, []);
  assert.deepEqual(view.active, [true, false]);
  assert.equal(view.frames.size, 0);
  assert.equal(svg.hasPointerCapture(1), false);
  assert.match(view.text(), /2026-10-01 – 2026-10-31 · 31 days/u);
  view.close();
  assert.equal(view.listeners.get('keydown')?.size, 0);
});

test('handle arrow keys cannot commit an in-progress pointer selection before release', async t => {
  const view = mount(t), svg = view.byClass('timeline-brush');
  call(view.byClass('timeline-brush-selection'), 'onPointerdown', event(1, 225));
  call(svg, 'onPointermove', event(1, 675));
  call(view.byRole('slider')[1]!, 'onKeydown', { key: 'ArrowRight', shiftKey: false, preventDefault() {} }); await nextTick();
  assert.deepEqual(view.ranges, []);
  assert.deepEqual(view.active, [true]);
  call(svg, 'onPointerup', event(1, 675)); await nextTick();
  assert.deepEqual(view.ranges, [{ start: '2026-10-08', end: '2026-10-24' }]);
  assert.deepEqual(view.active, [true, false]);
});

test('a second pointer cannot hijack the gesture and outside release commits the last clamped preview', async t => {
  const view = mount(t), svg = view.byClass('timeline-brush'), selection = view.byClass('timeline-brush-selection');
  call(selection, 'onPointerdown', event(1, 200));
  call(selection, 'onPointerdown', event(2, 500)); call(svg, 'onPointermove', event(2, 700)); call(svg, 'onPointerup', event(2, 700));
  assert.deepEqual(view.active, [true]); assert.deepEqual(view.ranges, []);
  call(svg, 'onPointermove', event(1, 1000)); call(svg, 'onPointerup', event(1, 1000)); await nextTick();
  assert.deepEqual(view.active, [true, false]);
  assert.deepEqual(view.ranges.at(-1), { start: '2026-10-07', end: '2026-10-31' });
});

test('keyboard endpoint adjustments commit exactly and boundary steps remain available without buttons', async t => {
  const view = mount(t), start = view.byRole('slider')[1]!;
  call(start, 'onKeydown', { key: 'ArrowRight', shiftKey: false, preventDefault() {} }); await nextTick();
  assert.deepEqual(view.ranges.at(-1), { start: '2026-10-02', end: '2026-10-31' });
  call(start, 'onKeydown', { key: 'Home', shiftKey: false, preventDefault() {} }); await nextTick();
  assert.equal(view.ranges.at(-1), null, 'reaching both domain bounds restores All history, including undated jobs');
  assert.equal(view.frames.size, 0);
});

test('unmount cancels pending frames and releases gesture resources without publishing stale account data', async t => {
  const view = mount(t), svg = view.byClass('timeline-brush');
  call(view.byClass('timeline-brush-selection'), 'onPointerdown', event(1, 200)); call(svg, 'onPointermove', event(1, 600));
  assert.equal(view.frames.size, 1); view.close(); await nextTick();
  assert.deepEqual(view.ranges, []); assert.equal(view.frames.size, 0);
  assert.equal(view.listeners.get('blur')?.size, 0); assert.equal(view.listeners.get('keydown')?.size, 0); assert.equal(view.disconnects(), 1); assert.equal(svg.hasPointerCapture(1), false);
});

test('an external range replacement cancels a gesture before its old preview can be committed', async t => {
  const view = mount(t), svg = view.byClass('timeline-brush');
  call(view.byClass('timeline-brush-selection'), 'onPointerdown', event(1, 200));
  call(svg, 'onPointermove', event(1, 600));
  view.props.rangeStart = '2026-10-12'; view.props.rangeEnd = '2026-10-18'; await nextTick();
  call(svg, 'onPointerup', event(1, 600)); await nextTick();
  assert.deepEqual(view.ranges, []);
  assert.deepEqual(view.active, [true, false]);
  assert.equal(view.frames.size, 0);
  assert.match(view.text(), /2026-10-12 – 2026-10-18 · 7 days/u);
});

test('unavailable overview volume does not block exact keyboard or pointer date selection', async t => {
  const view = mount(t);
  view.props.overview = { ...timeline, requiredBucketCount: 9000, unavailableReason: 'too_many_buckets', buckets: [] }; await nextTick();
  call(view.byClass('timeline-brush-selection'), 'onPointerdown', event(1, 225));
  call(view.byClass('timeline-brush'), 'onPointermove', event(1, 675)); call(view.byClass('timeline-brush'), 'onPointerup', event(1, 675)); await nextTick();
  assert.deepEqual(view.ranges.at(-1), { start: '2026-10-08', end: '2026-10-24' });
  assert.equal(view.byClass('timeline-overview').children.filter(child => child.tag === 'rect').length, 0);
});

test('the chart omits brush state and can use fixed controls owned by its parent', async t => {
  const view = mount(t, 'chart');
  view.props.showControls = false; await nextTick();
  assert.equal(view.byRole('slider').length, 0); assert.equal(view.byRole('tab').length, 0);
  assert(view.byClass('timeline-plot')); assert(view.byClass('timeline-readout'));
  assert.equal(view.byRole('tabpanel')[0]!.props.id, 'test-development-plot');
  assert.equal(view.byRole('tabpanel')[0]!.props['aria-labelledby'], 'test-development-plot-outcomes');
});

test('topic trends automatically show current high-interest topics when a filter cleared graph selection', async t => {
  const view = mount(t, 'chart'); view.props.selectedTopicIds = []; view.props.view = 'topics'; await nextTick();
  assert.match(view.text(), /Acoustics: 2/u);
  assert.doesNotMatch(view.text(), /Select up to five topics/u);
  assert.match(String(view.byClass('timeline-line').props.d), /^M.+ L/u);
  assert.doesNotMatch(String(view.byClass('timeline-line').props.d), /NaN|undefined/u);
});

test('alignment preserves unavailable values as gaps with visible sample explanations', async t => {
  const view = mount(t, 'chart'); view.props.view = 'alignment'; await nextTick();
  assert.match(view.text(), /3 score pairs/u); assert.match(view.text(), /No high-fit pairs/u);
});

test('fixed timeline controls expose controlled keyboard navigation with matching chart panel IDs', async t => {
  const view = mount(t, 'controls');
  assert.deepEqual(view.byRole('tab').map(tab => tab.text), ['Outcomes', 'Topics', 'Alignment']);
  call(view.tab('Topics'), 'onClick', {}); await nextTick();
  assert.equal(view.props.view, 'topics'); assert.equal(view.tab('Topics').props['aria-selected'], true);
  call(view.tab('Topics'), 'onKeydown', { key: 'End', preventDefault() {}, currentTarget: {} }); await nextTick();
  assert.equal(view.props.view, 'alignment');
  assert.equal(view.tab('Alignment').props['aria-controls'], 'test-development-plot');
  assert.equal(view.tab('Alignment').props.id, 'test-development-plot-alignment');
});

test('an over-limit chart reports unavailable periods rather than fake empty counts', async t => {
  const view = mount(t, 'chart');
  view.props.timeline = { ...timeline, aggregation: 'day', requiredBucketCount: 6000, bucketLimit: 4096, unavailableReason: 'too_many_buckets', buckets: [] }; await nextTick();
  assert.match(view.text(), /6,000 periods exceed the 4,096-period display limit/u);
  assert.doesNotMatch(view.text(), /No jobs with a known Added date/u);
  assert.equal(view.byClass('timeline-plot'), undefined);
});
