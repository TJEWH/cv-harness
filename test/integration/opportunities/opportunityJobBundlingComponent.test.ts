import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, type Component } from 'vue';
import { buildOpportunityJobBundling, type OpportunityJobBundlingDiagram } from '../../../src/features/opportunities/domain/opportunityJobBundling';
import type { OpportunityInsightJob, OpportunityInsightTopicNode } from '../../../src/features/opportunities/domain/opportunityInsights';
import type { OpportunityGraphNode } from '../../../src/features/opportunities/domain/opportunityGraphLayout';

const filename = new URL('../../../src/features/opportunities/components/OpportunityJobBundling.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'bundling-test' });
const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id: 'bundling-test', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const requireComponent = createRequire(filename), componentExports: { default?: Component } = {}, renderExports: { render?: () => unknown } = {};
const module = (path: string) => path.endsWith('InfoHint.vue') ? { default: defineComponent({ setup: () => () => h('span') }) } : requireComponent(path);
new Function('require', 'exports', transpile(script.content))(module, componentExports);
new Function('require', 'exports', transpile(template.code))(module, renderExports);
const component = { ...componentExports.default, render: renderExports.render };
interface HostNode {
  tag?: string; text?: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode; focused: boolean;
  clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number; scrollLeft: number; scrollTop: number;
  bounds: { left: number; top: number; width: number; height: number };
  style: Record<string, any>; popoverOpen: boolean; showPopover(): void; hidePopover(): void; matches(selector: string): boolean;
  focus(): void; contains(other: unknown): boolean; closest(tag: string): HostNode | null; querySelectorAll(selector: string): HostNode[];
  getBoundingClientRect(): DOMRect;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  dispatch(type: string, event: Record<string, any>): void;
  listenerCount(type?: string): number;
}
const descendants = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(descendants)];
const text = (root: HostNode): string => descendants(root).map(item => item.text ?? '').join(' ').replace(/\s+/gu, ' ').trim();
function node(tag?: string, content?: string): HostNode {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const result: HostNode = { tag, text: content, props: {}, children: [], focused: false,
    clientWidth: 960, clientHeight: 600, scrollWidth: 2200, scrollHeight: 2200, scrollLeft: 0, scrollTop: 0,
    bounds: { left: 40, top: 80, width: 960, height: 600 },
    style: {}, popoverOpen: false,
    showPopover() { result.popoverOpen = true; }, hidePopover() { result.popoverOpen = false; }, matches(selector) { return selector === ':popover-open' && result.popoverOpen; },
    focus() { result.focused = true; result.props.onFocus?.({ currentTarget: result, target: result }); },
    contains(other) { return descendants(result).includes(other as HostNode); },
    closest(target) { let current: HostNode | undefined = result; while (current && current.tag !== target) current = current.parent; return current ?? null; },
    querySelectorAll(selector) { return descendants(result).filter(item => selector.startsWith('.') && String(item.props.class).split(' ').includes(selector.slice(1))); },
    getBoundingClientRect() { const { left, top, width, height } = result.bounds; return { ...result.bounds, x: left, y: top, right: left + width, bottom: top + height, toJSON() {} } as DOMRect; },
    addEventListener(type, listener) { const registered = listeners.get(type) ?? new Set(); registered.add(listener); listeners.set(type, registered); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event) { for (const listener of listeners.get(type) ?? []) { if (typeof listener === 'function') listener(event as Event); else listener.handleEvent(event as Event); } },
    listenerCount(type) { return type ? listeners.get(type)?.size ?? 0 : [...listeners.values()].reduce((count, registered) => count + registered.size, 0); },
  };
  return result;
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: value => node(undefined, value), createComment: value => node(undefined, value),
  insert(child, parent, anchor) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); child.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText(target, value) { target.text = value; }, setElementText(target, value) { target.text = value; target.children = []; },
  patchProp(target, key, _previous, value) { target.props[key] = value; }, parentNode: target => target.parent ?? null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
});
const job = (id: string, topicIds: string[], title: string | null = `Role ${id}`): OpportunityInsightJob => ({ id, title, institution: null, country: null, addedAt: null, currentFit: 8, interestScore: 9,
  explicitInterest: true, highInterest: true, mismatch: false, topicIds, avoidedTopicIds: [], reasons: [] });
function mount(t: TestContext, jobs: OpportunityInsightJob[], diagram = buildOpportunityJobBundling(jobs, [])) {
  const nodes: OpportunityGraphNode[] = jobs.map(record => ({ id: `job:${record.id}`, label: record.title ?? '', kind: 'job', radius: 5, highInterestCount: 1, interestScore: 9, topicCount: record.topicIds.length, avoided: false, mismatch: false }));
  const topics: OpportunityInsightTopicNode[] = [{ id: 'robotics', label: 'Robotics', highInterestCount: 3, reviewedCount: 3, jobCount: 3, lowInterestCount: 0, avoidedCount: 0, positiveReasonCount: 0 }];
  const props = reactive({ diagram: diagram as OpportunityJobBundlingDiagram | null, nodes, topics, selectedId: null as string | null, lang: 'en', busy: false });
  const root = node('root'), selected: string[] = [], app = renderer.createApp({ render: () => h(component, { ...props, onSelect: (id: string) => selected.push(id) }) });
  let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  app.mount(root); t.after(unmount);
  const values = () => descendants(root), byClass = (className: string) => values().filter(item => String(item.props.class).split(' ').includes(className));
  return { root, props, selected, values, byClass, unmount, buttons: () => byClass('bundling-job'), leaves: () => byClass('bundling-leaf'), edges: () => byClass('bundling-edge') };
}

function gestureEvent(values: Record<string, any> = {}) {
  const result = { cancelable: true, defaultPrevented: false, immediateStopped: false, propagationStopped: false, detail: 1, ctrlKey: false, deltaMode: 0,
    preventDefault() { result.defaultPrevented = true; },
    stopImmediatePropagation() { result.immediateStopped = true; },
    stopPropagation() { result.propagationStopped = true; },
    ...values,
  };
  return result;
}
const settleZoom = async () => { await nextTick(); await nextTick(); };

test('native job controls preserve selection and exact shared-topic descriptions for pointer and keyboard inspection', async t => {
  const jobs = [job('A', ['robotics']), job('B', ['robotics']), job('C', ['robotic learning'])];
  const view = mount(t, jobs); await nextTick();
  assert.equal(view.buttons().length, 3);
  assert.equal(view.edges().length, 1, 'similar wording cannot invent an observed shared-topic edge');
  assert.match(view.edges()[0]!.props['aria-label'], /Role A · Role B: Shared topics: Robotics/u);
  const a = view.buttons().find(button => text(button) === 'Role A')!;
  assert.equal(a.props.type, 'button'); assert.equal(a.props['aria-pressed'], false);
  assert.match(a.props['aria-label'], /Role A; interest 9\/10; 1 connected job/u);
  a.props.onClick(); assert.deepEqual(view.selected, ['job:A']);
  view.props.selectedId = 'job:A'; await nextTick();
  assert.equal(a.props['aria-pressed'], true);
  assert(!String(view.leaves()[1]!.props.class).includes('is-muted'));
  assert.match(view.leaves()[2]!.props.class, /is-muted/u);
  assert.notEqual(view.buttons()[2]!.props.disabled, true, 'unrelated jobs remain selectable');
  const inspectedEdge = view.edges()[0]!;
  inspectedEdge.props.onPointerenter(gestureEvent({ currentTarget: inspectedEdge, target: inspectedEdge, clientX: 260, clientY: 240 })); await settleZoom();
  assert.match(text(view.byClass('bundling-edge-topics')[0]!), /Robotics/u);
  inspectedEdge.props.onKeydown(gestureEvent({ key: 'Escape', currentTarget: inspectedEdge, target: inspectedEdge })); await nextTick();
  assert.match(text(view.byClass('bundling-record')[0]!), /Role A · 1 connected job/u);
  a.props.onFocus(); await nextTick();
  const key = (value: string) => { let prevented = false; a.props.onKeydown({ key: value, currentTarget: a, preventDefault() { prevented = true; } }); return prevented; };
  assert.equal(key('ArrowRight'), true); assert(view.buttons()[1]!.focused);
  assert.equal(key('End'), true); assert(view.buttons()[2]!.focused);
  assert.equal(key('Home'), true); assert(a.focused);
  assert.equal(key('Tab'), false, 'native Tab remains available');
});

test('focus retains complete exact neighbors when dense drawing omits curves and replacement diagrams clear transient inspection', async t => {
  const jobs = [job('A', ['robotics']), job('B', ['robotics']), job('C', ['robotics']), job('D', ['unrelated'])];
  const diagram = buildOpportunityJobBundling(jobs, [], { incidentLimit: 1 });
  assert.equal(diagram.relationshipCount, 3); assert.equal(diagram.edges.length, 2);
  const view = mount(t, jobs, diagram); await nextTick();
  assert.match(text(view.byClass('bundling-counts')[0]!), /4 jobs · 3 connections · 2 shown/u);
  view.buttons()[1]!.props.onFocus(); await nextTick();
  assert(view.leaves().slice(0, 3).every(leaf => !String(leaf.props.class).includes('is-muted')), 'B and C remain direct exact neighbors even though their curve is omitted');
  assert.match(view.leaves()[3]!.props.class, /is-muted/u);
  assert.match(text(view.byClass('bundling-record')[0]!), /Role B · 2 connected jobs/u);
  view.leaves()[2]!.props.onPointerenter(); await nextTick();
  assert.match(text(view.byClass('bundling-record')[0]!), /Role C/u);
  view.props.diagram = null; view.props.busy = true; await nextTick();
  assert.equal(view.buttons().length, 0); assert.equal(view.byClass('bundling-record').length, 0);
  assert.equal(view.byClass('job-bundling')[0]!.props['aria-busy'], true);
  view.props.diagram = buildOpportunityJobBundling(jobs, [], { excludedTopicIds: ['robotics'] }); view.props.busy = false; await nextTick();
  assert.equal(view.buttons().length, 4); assert.equal(view.byClass('bundling-record').length, 0);
  assert(view.leaves().every(leaf => !String(leaf.props.class).includes('is-muted')));
});

test('zero-overlap jobs remain available with localized withheld titles and a substantive empty relationship state', async t => {
  const jobs = [job('A', ['robotics']), job('B', ['robotics'], null), job('C', [])];
  const view = mount(t, jobs, buildOpportunityJobBundling(jobs, [], { excludedTopicIds: ['robotics'] })); await nextTick();
  assert.equal(view.buttons().length, 3); assert.equal(view.edges().length, 0);
  assert.match(text(view.byClass('bundling-empty')[0]!), /no shared topics after exclusions/u);
  assert.equal(text(view.buttons()[1]!), 'Title withheld');
  view.props.lang = 'de'; await nextTick();
  assert.equal(text(view.buttons()[1]!), 'Titel zurückgehalten');
  assert.match(view.buttons()[1]!.props['aria-label'], /Interesse 9\/10; 0 verbundene Stellen/u);
  assert.match(text(view.byClass('bundling-empty')[0]!), /keine gemeinsamen Themen/u);
  assert.match(text(view.byClass('bundling-counts')[0]!), /3 Stellen · 0 Verbindungen/u);
  assert.match(view.byClass('bundling-chart')[0]!.props['aria-label'], /Stellen verbunden durch gemeinsame Themen/u);
  view.buttons()[1]!.props.onClick(); assert.deepEqual(view.selected, ['job:B']);
});

test('narrow layouts keep the complete ring and full accessible job identities with fixed physical control sizes', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  let resize: ((entries: { contentRect: { width: number } }[]) => void) | undefined;
  let disconnects = 0;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback: typeof resize) { resize = callback; }
    observe() {}
    disconnect() { disconnects++; }
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous); else Reflect.deleteProperty(globalThis, 'ResizeObserver'); });
  const jobs = [job('A', ['robotics'], 'Research Engineer in Human–Robot Interaction'), job('B', ['robotics']), job('C', ['acoustics'])];
  const view = mount(t, jobs); await nextTick();
  const fullViewBox = view.byClass('bundling-chart')[0]!.props.viewBox.split(' ').map(Number);
  assert.match(text(view.buttons()[0]!), /Research Engineer in Human–Robot Interaction/u);
  resize!([{ contentRect: { width: 360 } }]); await nextTick();
  assert.deepEqual(view.buttons().map(text), ['1', '2', '3']);
  assert.match(view.buttons()[0]!.props['aria-label'], /^1\. Research Engineer in Human–Robot Interaction; interest/u);
  assert.equal(view.buttons()[0]!.props.type, 'button');
  const chart = view.byClass('bundling-chart')[0]!, bounds = chart.props.viewBox.split(' ').map(Number);
  const center = fullViewBox[2]! / 2, radius = view.props.diagram!.radius;
  assert(bounds[2]! < fullViewBox[2]!, 'narrow views crop the radial title margin so the complete circular plot can fit');
  assert(bounds[0]! <= center - radius && bounds[0]! + bounds[2]! >= center + radius);
  assert(bounds[1]! <= center - radius && bounds[1]! + bounds[3]! >= center + radius);
  const displayedWidth = Number.parseFloat(chart.props.style.minWidth), scale = displayedWidth / bounds[2]!;
  const marker = view.values().find(item => item.tag === 'foreignObject')!;
  assert(Math.abs(marker.props.width * scale - 32) < 1e-9, 'numbered native buttons preserve a 32px physical hit target');
  assert(Math.abs(Number.parseFloat(view.buttons()[0]!.props.style.fontSize) * scale - 12) < 1e-9, 'number labels remain 12px after SVG scaling');
  view.buttons()[0]!.props.onFocus(); await nextTick();
  assert.match(text(view.byClass('bundling-record')[0]!), /^1\. Research Engineer in Human–Robot Interaction · 1 connected job/u);
  view.buttons()[0]!.props.onClick(); assert.deepEqual(view.selected, ['job:A']);
  resize!([{ contentRect: { width: 960 } }]); await nextTick();
  assert.equal(text(view.buttons()[0]!), 'Research Engineer in Human–Robot Interaction');
  assert.equal(view.byClass('bundling-chart')[0]!.props.viewBox, fullViewBox.join(' '));
  assert.match(view.buttons()[0]!.props['aria-label'], /^Research Engineer in Human–Robot Interaction;/u);
  assert.match(text(view.byClass('bundling-record')[0]!), /Research Engineer in Human–Robot Interaction · 1 connected job/u);
  view.unmount(); assert.equal(disconnects, 1);
});

test('dense desktop charts preserve native label scale and scroll instead of shrinking job controls', async t => {
  const jobs = Array.from({ length: 75 }, (_, index) => job(String(index).padStart(2, '0'), ['robotics'], `Research position ${index + 1}`));
  const diagram = buildOpportunityJobBundling(jobs, [], { radius: 451 });
  const view = mount(t, jobs, diagram); await nextTick();
  assert.equal(view.buttons().length, 75);
  const chart = view.byClass('bundling-chart')[0]!, bounds = chart.props.viewBox.split(' ').map(Number);
  const displayedWidth = Number.parseFloat(chart.props.style.minWidth), scale = displayedWidth / bounds[2]!;
  assert.equal(displayedWidth, 1346, 'the full native viewBox width is the horizontal-scroll minimum');
  assert.equal(scale, 1, 'desktop labels are not downscaled with the plot radius');
  const markers = view.values().filter(item => item.tag === 'foreignObject');
  assert(markers.every(marker => marker.props.height * scale === 32), 'every dense job keeps its full physical button height');
  const fontRule = descriptor.styles.map(style => style.content).join('\n').match(/\.bundling-job\s*\{[^}]*font:\s*\d+\s+([\d.]+)px/u);
  assert(fontRule, 'desktop job labels use an explicit base font');
  assert(Number(fontRule[1]) * scale >= 11, 'native-scale desktop job labels remain at least 11px');
  assert.equal(text(view.buttons()[0]!), 'Research position 1');
  assert.match(view.buttons()[0]!.props['aria-label'], /^Research position 1;/u);
  view.buttons()[74]!.props.onClick(); assert.deepEqual(view.selected, ['job:74']);
});

test('trackpad pinch zoom keeps its focal point, clamps magnification and leaves ordinary scrolling native', async t => {
  const view = mount(t, [job('A', ['robotics']), job('B', ['robotics'])]); await settleZoom();
  const viewport = view.byClass('bundling-scroll')[0]!, chart = () => view.byClass('bundling-chart')[0]!;
  viewport.clientWidth = 360; viewport.clientHeight = 400; viewport.bounds = { left: 40, top: 80, width: 360, height: 400 };
  viewport.scrollLeft = 120; viewport.scrollTop = 180;
  const base = Number.parseFloat(chart().props.style.width), viewportHeight = viewport.props.style.height;
  const ordinary = gestureEvent({ deltaY: -80, clientX: 220, clientY: 280 });
  viewport.dispatch('wheel', ordinary); await settleZoom();
  assert.equal(ordinary.defaultPrevented, false);
  assert.equal(Number.parseFloat(chart().props.style.width), base);
  const pinch = gestureEvent({ ctrlKey: true, deltaY: -Math.log(2) * 100, clientX: 220, clientY: 280 });
  viewport.dispatch('wheel', pinch); await settleZoom();
  assert.equal(pinch.defaultPrevented, true);
  assert(Math.abs(Number.parseFloat(chart().props.style.width) / base - 2) < 1e-9);
  assert(Math.abs(viewport.scrollLeft - 420) < 1e-9, 'the content point under the horizontal gesture midpoint stays fixed');
  assert(Math.abs(viewport.scrollTop - 560) < 1e-9, 'the vertical focal point survives zoom without moving the outer viewport');
  assert.equal(viewport.props.style.height, viewportHeight, 'zoom does not resize the surrounding page');
  viewport.dispatch('wheel', gestureEvent({ ctrlKey: true, deltaY: -100000, clientX: 220, clientY: 280 })); await settleZoom();
  assert.equal(Number.parseFloat(chart().props.style.width) / base, 4);
  viewport.dispatch('wheel', gestureEvent({ ctrlKey: true, deltaY: 100000, clientX: 220, clientY: 280 })); await settleZoom();
  assert.equal(Number.parseFloat(chart().props.style.width) / base, .5);
  view.props.selectedId = 'job:A'; await nextTick();
  const reset = gestureEvent({ key: 'Home', target: viewport, currentTarget: viewport });
  viewport.props.onKeydown(reset); await settleZoom();
  assert.equal(Number.parseFloat(chart().props.style.width), base);
  assert.equal(viewport.scrollLeft, 0); assert.equal(viewport.scrollTop, 0);
  assert.equal(view.buttons()[0]!.props['aria-pressed'], true, 'resetting the view preserves the selected record');
});

test('touch pinch tracks fingers, suppresses its accidental click and releases listeners and pending gestures', async t => {
  const jobs = [job('A', ['robotics']), job('B', ['robotics'])], view = mount(t, jobs); await settleZoom();
  const viewport = view.byClass('bundling-scroll')[0]!, chart = () => view.byClass('bundling-chart')[0]!;
  viewport.clientWidth = 360; viewport.clientHeight = 400; viewport.bounds = { left: 40, top: 80, width: 360, height: 400 };
  const base = Number.parseFloat(chart().props.style.width);
  const finger = (identifier: number, clientX: number) => ({ identifier, clientX, clientY: 280 });
  const single = gestureEvent({ touches: [finger(3, 160)] });
  viewport.dispatch('touchstart', single); viewport.dispatch('touchmove', single);
  assert.equal(single.defaultPrevented, false, 'one finger retains native scrolling');
  const start = gestureEvent({ touches: [finger(3, 160), finger(7, 260)] });
  viewport.dispatch('touchstart', start); assert.equal(start.defaultPrevented, true);
  const move = gestureEvent({ touches: [finger(7, 310), finger(3, 110)] });
  viewport.dispatch('touchmove', move); await settleZoom();
  assert.equal(move.defaultPrevented, true);
  assert.equal(Number.parseFloat(chart().props.style.width), base * 2, 'touch-list reordering does not change finger identity or scale');
  viewport.dispatch('touchend', gestureEvent({ touches: [] }));
  const accidental = gestureEvent(); viewport.dispatch('click', accidental);
  if (!accidental.immediateStopped) view.buttons()[0]!.props.onClick(accidental);
  assert.equal(accidental.defaultPrevented, true); assert.deepEqual(view.selected, []);
  const keyboard = gestureEvent({ detail: 0 }); viewport.dispatch('click', keyboard);
  if (!keyboard.immediateStopped) view.buttons()[0]!.props.onClick(keyboard);
  assert.equal(keyboard.defaultPrevented, false); assert.deepEqual(view.selected, ['job:A']);
  viewport.dispatch('touchstart', gestureEvent({ touches: [finger(3, 160)] }));
  const intentional = gestureEvent(); viewport.dispatch('click', intentional);
  if (!intentional.immediateStopped) view.buttons()[1]!.props.onClick(intentional);
  assert.equal(intentional.defaultPrevented, false); assert.deepEqual(view.selected, ['job:A', 'job:B']);
  viewport.dispatch('touchstart', gestureEvent({ touches: [finger(3, 160), finger(7, 260)] }));
  viewport.dispatch('touchcancel', gestureEvent());
  const afterCancel = gestureEvent({ touches: [finger(3, 110), finger(7, 310)] });
  viewport.dispatch('touchmove', afterCancel); await settleZoom();
  assert.equal(afterCancel.defaultPrevented, false);
  assert.equal(Number.parseFloat(chart().props.style.width), base * 2, 'cancelled touch gestures cannot keep changing zoom');
  view.props.diagram = buildOpportunityJobBundling(jobs, []); await settleZoom();
  assert.equal(Number.parseFloat(chart().props.style.width), base, 'a replacement diagram resets its zoom state');
  assert(viewport.listenerCount() > 0);
  view.unmount(); assert.equal(viewport.listenerCount(), 0);
});

test('hovering an edge shows complete shared topic names beside the chart without selecting a job', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const topicPairs = [['robotics', 'Robotics'], ['acoustic measurement', 'Acoustic measurement and spatial listening'], ['human–robot interaction', 'Human–robot interaction'], ['long topic', 'Embodied interaction in participatory prototyping research']] as const;
  const jobs = [job('A', topicPairs.map(([id]) => id)), job('B', topicPairs.map(([id]) => id))];
  const view = mount(t, jobs);
  view.props.topics = topicPairs.map(([id, label]) => ({ ...view.props.topics[0]!, id, label })); await settleZoom();
  const edge = view.edges()[0]!;
  edge.props.onPointerenter(gestureEvent({ currentTarget: edge, target: edge, clientX: 300, clientY: 260 })); await settleZoom();
  const tooltip = view.byClass('bundling-edge-tooltip')[0]!;
  assert.equal(tooltip.props.role, 'tooltip'); assert.equal(tooltip.props.hidden, false);
  const topicNames = text(view.byClass('bundling-edge-topics')[0]!);
  for (const [, label] of topicPairs) assert(topicNames.includes(label), `shared label remains complete: ${label}`);
  assert.match(text(tooltip), /Shared topics/u);
  assert.deepEqual(view.selected, [], 'inspecting relationship evidence does not select or open either job');
  assert.equal(view.values().filter(item => item.tag === 'title').length, 0, 'the shared-topic data is visible without a native title delay');
  assert.equal(edge.props['aria-describedby'], tooltip.props.id);
  edge.props.onPointermove(gestureEvent({ currentTarget: edge, target: edge, clientX: 330, clientY: 290 })); await nextTick();
  edge.props.onPointerleave(); t.mock.timers.tick(100); await nextTick();
  assert.equal(tooltip.props.hidden, false, 'the tooltip survives the pointer crossing from its edge');
  tooltip.props.onPointerenter(); t.mock.timers.tick(200); await nextTick();
  assert.equal(tooltip.props.hidden, false, 'the pointer can inspect the tooltip itself');
  view.props.lang = 'de'; await nextTick();
  assert.match(text(tooltip), /Gemeinsame Themen/u);
  for (const [, label] of topicPairs) assert(text(view.byClass('bundling-edge-topics')[0]!).includes(label));
  tooltip.props.onPointerleave(); t.mock.timers.tick(141); await nextTick();
  assert.equal(tooltip.props.hidden, true);
});

test('edge keyboard inspection uses one roving tab stop and preserves job navigation and selection', async t => {
  const view = mount(t, [job('A', ['robotics']), job('B', ['robotics']), job('C', ['robotics'])]); await settleZoom();
  const edgeStops = () => view.edges().filter(edge => edge.props.tabindex === 0);
  assert.equal(view.edges().length, 3); assert.equal(edgeStops().length, 1);
  const first = edgeStops()[0]!;
  assert.equal(first.props.role, 'img'); assert.match(first.props['aria-label'], /Robotics/u);
  first.focus(); await settleZoom();
  const tooltip = view.byClass('bundling-edge-tooltip')[0]!;
  assert.equal(tooltip.props.hidden, false); assert.match(text(view.byClass('bundling-edge-topics')[0]!), /Robotics/u);
  const next = gestureEvent({ key: 'ArrowRight', target: first, currentTarget: first });
  first.props.onKeydown(next); await settleZoom();
  assert.equal(next.defaultPrevented, true); assert.equal(edgeStops().length, 1);
  assert.notEqual(edgeStops()[0], first); assert(edgeStops()[0]!.focused);
  const last = view.edges().at(-1)!;
  edgeStops()[0]!.props.onKeydown(gestureEvent({ key: 'End', target: edgeStops()[0], currentTarget: edgeStops()[0] })); await settleZoom();
  assert.equal(edgeStops()[0], last);
  last.props.onKeydown(gestureEvent({ key: 'Home', target: last, currentTarget: last })); await settleZoom();
  assert.equal(edgeStops()[0], first);
  first.props.onKeydown(gestureEvent({ key: 'Escape', target: first, currentTarget: first })); await nextTick();
  assert.equal(tooltip.props.hidden, true);
  first.focus(); await settleZoom(); first.props.onBlur(); await nextTick();
  assert.equal(tooltip.props.hidden, true, 'blur dismisses keyboard relationship inspection');
  const jobButton = view.buttons()[0]!, arrow = gestureEvent({ key: 'ArrowRight', currentTarget: jobButton, target: jobButton });
  jobButton.props.onKeydown(arrow); await nextTick();
  assert.equal(arrow.defaultPrevented, true); assert(view.buttons()[1]!.focused, 'job-arrow navigation remains separate from edge navigation');
  assert.deepEqual(view.selected, []);
});

test('scroll, pinch zoom and replacement evidence clear the edge tooltip and disposal removes its interaction state', async t => {
  const jobs = [job('A', ['robotics']), job('B', ['robotics'])], view = mount(t, jobs); await settleZoom();
  const viewport = view.byClass('bundling-scroll')[0]!;
  const inspect = async () => { const edge = view.edges()[0]!; edge.props.onPointerenter(gestureEvent({ currentTarget: edge, target: edge, clientX: 280, clientY: 260 })); await settleZoom(); assert.equal(view.byClass('bundling-edge-tooltip')[0]!.props.hidden, false); };
  await inspect(); viewport.props.onScroll(gestureEvent({ target: viewport, currentTarget: viewport })); await nextTick();
  assert.equal(view.byClass('bundling-edge-tooltip')[0]!.props.hidden, true);
  await inspect(); viewport.dispatch('wheel', gestureEvent({ ctrlKey: true, deltaY: -40, clientX: 280, clientY: 260 })); await settleZoom();
  assert.equal(view.byClass('bundling-edge-tooltip')[0]!.props.hidden, true, 'zoom cannot leave a tooltip anchored to old chart geometry');
  await inspect(); view.props.diagram = buildOpportunityJobBundling(jobs, []); await settleZoom();
  assert.equal(view.byClass('bundling-edge-tooltip')[0]!.props.hidden, true, 'new evidence cannot retain the previous relationship tooltip');
  await inspect(); const tooltip = view.byClass('bundling-edge-tooltip')[0]!; view.unmount();
  assert.equal(view.byClass('bundling-edge-tooltip').length, 0); assert.equal(viewport.listenerCount(), 0);
  assert.equal(tooltip.popoverOpen, false);
});

test('edge colors encode shared-topic counts independently of cluster colors and remain stable during inspection', async t => {
  const jobs = [job('A', ['one', 'two', 'three']), job('B', ['one', 'two', 'three']), job('C', ['one', 'two']), job('D', ['one']), job('E', ['other']), job('F', ['other'])];
  const diagram = buildOpportunityJobBundling(jobs, []), view = mount(t, jobs, diagram); await settleZoom();
  const rendered = (source: string, target: string) => {
    const record = diagram.edges.find(edge => edge.source === `job:${source}` && edge.target === `job:${target}`)!;
    assert(record, `shared-topic relationship ${source}–${target} exists`);
    return view.edges().find(edge => edge.props.d === record.path)!;
  };
  const one = rendered('A', 'D'), two = rendered('A', 'C'), three = rendered('A', 'B'), otherGroupOne = rendered('E', 'F');
  assert.equal(one.props.stroke, '#4d9fff', 'one shared topic uses the blue endpoint');
  assert.equal(three.props.stroke, '#ef5350', 'the current maximum of three shared topics uses the red endpoint');
  assert.notEqual(two.props.stroke, one.props.stroke); assert.notEqual(two.props.stroke, three.props.stroke);
  assert.equal(otherGroupOne.props.stroke, one.props.stroke, 'equal shared-topic counts have equal colors across different job groups');
  const groupBands = view.byClass('bundling-groups')[0]!.children.filter(item => item.tag === 'path');
  assert(new Set(groupBands.map(item => item.props.stroke)).size > 1, 'group bands preserve separate cluster colors');
  const strokes = () => view.edges().map(edge => [edge.props.d, edge.props.stroke]).sort(([a], [b]) => a.localeCompare(b));
  const original = strokes();
  two.props.onPointerenter(gestureEvent({ currentTarget: two, target: two, clientX: 300, clientY: 260 })); await settleZoom();
  assert.deepEqual(strokes(), original);
  two.focus(); await settleZoom(); assert.deepEqual(strokes(), original);
  view.props.selectedId = 'job:A'; await settleZoom(); assert.deepEqual(strokes(), original);
  const rules = [...descriptor.styles.map(style => style.content).join('\n').matchAll(/\.bundling-edge[^{}]*\{([^}]*)\}/gu)];
  assert(rules.length > 0);
  assert(rules.every(rule => !/(?:^|;)\s*stroke\s*:/u.test(rule[1]!)), 'interaction styles must not override the shared-topic count stroke color');
});

test('topic exclusions and replacement cohorts recompute the edge-color maximum without stale colors', async t => {
  const jobs = [job('A', ['one', 'two', 'three']), job('B', ['one', 'two', 'three']), job('C', ['one', 'two']), job('D', ['one'])];
  const view = mount(t, jobs); await settleZoom();
  const colorFor = (source: string, target: string) => {
    const edge = view.props.diagram!.edges.find(record => record.source === `job:${source}` && record.target === `job:${target}`)!;
    return view.edges().find(path => path.props.d === edge.path)!.props.stroke;
  };
  const initialTwoColor = colorFor('A', 'C');
  assert.notEqual(initialTwoColor, '#ef5350');
  view.props.diagram = buildOpportunityJobBundling(jobs, [], { excludedTopicIds: ['three'] }); await settleZoom();
  assert.equal(colorFor('A', 'C'), '#ef5350', 'two shared topics become red when exclusions reduce the current maximum to two');
  assert.equal(colorFor('A', 'D'), '#4d9fff');
  view.props.diagram = buildOpportunityJobBundling(jobs, [], { excludedTopicIds: ['two', 'three'] }); await settleZoom();
  assert(view.edges().length > 0); assert(view.edges().every(edge => edge.props.stroke === '#4d9fff'), 'a cohort with only one shared topic keeps all edges blue');
  view.props.diagram = buildOpportunityJobBundling(jobs, [], { excludedTopicIds: ['one', 'two', 'three'] }); await settleZoom();
  assert.equal(view.edges().length, 0); assert.equal(view.buttons().length, 4);
  view.props.diagram = buildOpportunityJobBundling([jobs[0]!], []); await settleZoom();
  assert.equal(view.edges().length, 0); assert.equal(view.buttons().length, 1);
  view.props.diagram = buildOpportunityJobBundling([], []); await settleZoom();
  assert.equal(view.edges().length, 0); assert.equal(view.buttons().length, 0);
  view.props.diagram = buildOpportunityJobBundling(jobs, []); await settleZoom();
  assert.equal(colorFor('A', 'B'), '#ef5350'); assert.equal(colorFor('A', 'C'), initialTwoColor);
});

test('native scrolling reanchors a focused edge tooltip without changing its count color and dismisses stale focus', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = { activeElement: null as HostNode | null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const jobs = [job('A', ['one', 'two', 'three']), job('B', ['one', 'two', 'three']), job('C', ['one', 'two'])];
  const diagram = buildOpportunityJobBundling(jobs, []), view = mount(t, jobs, diagram);
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); });
  await settleZoom();
  const record = diagram.edges.find(edge => edge.source === 'job:A' && edge.target === 'job:C')!;
  const edge = view.edges().find(path => path.props.d === record.path)!, viewport = view.byClass('bundling-scroll')[0]!;
  const tooltip = view.byClass('bundling-edge-tooltip')[0]!, countColor = edge.props.stroke;
  tooltip.bounds = { left: 0, top: 0, width: 240, height: 80 };
  edge.bounds = { left: 200, top: 220, width: 120, height: 100 };
  document.activeElement = edge; edge.focus(); await settleZoom();
  assert.equal(tooltip.props.hidden, false);
  const oldPosition = { left: tooltip.style.left, top: tooltip.style.top };
  edge.bounds = { left: 100, top: 120, width: 120, height: 100 };
  viewport.props.onScroll(gestureEvent({ target: viewport, currentTarget: viewport })); await settleZoom();
  assert.equal(tooltip.props.hidden, false, 'native scroll that brings a keyboard-focused curve into view retains its shared-topic evidence');
  assert.notEqual(tooltip.style.left, oldPosition.left); assert.notEqual(tooltip.style.top, oldPosition.top);
  assert.equal(edge.props.stroke, countColor, 'the focused curve retains its shared-topic count color after scrolling');
  assert.match(text(view.byClass('bundling-edge-topics')[0]!), /one, two/u);
  document.activeElement = viewport;
  viewport.props.onScroll(gestureEvent({ target: viewport, currentTarget: viewport })); await nextTick();
  assert.equal(tooltip.props.hidden, true, 'stale component focus cannot retain a tooltip after actual DOM focus has moved');
  edge.props.onBlur();
  edge.props.onPointerenter(gestureEvent({ currentTarget: edge, target: edge, clientX: 300, clientY: 260 })); await settleZoom();
  assert.equal(tooltip.props.hidden, false);
  viewport.props.onScroll(gestureEvent({ target: viewport, currentTarget: viewport })); await nextTick();
  assert.equal(tooltip.props.hidden, true, 'pointer-only inspection still dismisses on chart scrolling');
});
