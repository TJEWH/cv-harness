import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, type Component } from 'vue';
import type { OpportunityTopicHierarchyNode } from '../src/features/opportunities/domain/opportunityTopicHierarchy';
import type { OpportunityGraphNode } from '../src/features/opportunities/domain/opportunityGraphLayout';

const filename = new URL('../src/features/opportunities/components/OpportunityTopicHierarchy.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'hierarchy-test' });
const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id: 'hierarchy-test', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const requireComponent = createRequire(filename), componentExports: { default?: Component } = {}, renderExports: { render?: () => unknown } = {};
const module = (path: string) => path.endsWith('InfoHint.vue') ? { default: defineComponent({ setup: () => () => h('span') }) } : requireComponent(path);
new Function('require', 'exports', transpile(script.content))(module, componentExports);
new Function('require', 'exports', transpile(template.code))(module, renderExports);
const component = { ...componentExports.default, render: renderExports.render };
interface HostNode { tag?: string; text?: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode; clientWidth: number; value?: unknown; addEventListener(): void; removeEventListener(): void }
function node(tag?: string, text?: string): HostNode {
  const result: HostNode = { tag, text, props: {}, children: [], clientWidth: 760, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(result, 'value', { get: () => result.props.value ?? '', set: next => { result.props.value = next; } });
  return result;
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: text => node(undefined, text),
  insert(child, parent, anchor) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); child.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText(target, value) { target.text = value; }, setElementText(target, value) { target.text = value; target.children = []; },
  patchProp(target, key, _previous, value) { target.props[key] = value; }, parentNode: target => target.parent ?? null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
});
const descendants = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(descendants)];
const text = (root: HostNode): string => descendants(root).map(item => item.text ?? '').join(' ').replace(/\s+/gu, ' ').trim();
function leaf(id: string, labels: string[]): OpportunityTopicHierarchyNode { return { id, topicId: id, label: id, count: 1, affinity: 1, children: null, sharedTopicIds: labels, sharedTopicCount: labels.length }; }
const a = leaf('job:A', ['acoustics', 'sensing', 'arrays', 'signal processing']), b = leaf('job:B', ['acoustics', 'sensing', 'experiments']), c = leaf('job:C', ['acoustics', 'theory']), d = leaf('job:D', ['robotics']);
const ab: OpportunityTopicHierarchyNode = { id: 'AB', topicId: null, label: 'A', count: 2, affinity: 2 / 4, sharedTopicIds: ['acoustics', 'sensing'], sharedTopicCount: 2, children: [a, b] };
const cd: OpportunityTopicHierarchyNode = { id: 'CD', topicId: null, label: 'C', count: 2, affinity: 0, sharedTopicIds: [], sharedTopicCount: 0, children: [c, d] };
const abc: OpportunityTopicHierarchyNode = { id: 'ABC', topicId: null, label: 'A', count: 3, affinity: 1 / 4, sharedTopicIds: ['acoustics'], sharedTopicCount: 1, children: [ab, c] };
const abcd: OpportunityTopicHierarchyNode = { id: 'ABCD', topicId: null, label: 'A', count: 4, affinity: 0, sharedTopicIds: [], sharedTopicCount: 0, children: [abc, d] };
const nodes: OpportunityGraphNode[] = [a, b, c, d].map(item => ({ id: item.id, label: item.label, kind: 'job', radius: 5, highInterestCount: 1, interestScore: 8.5, topicCount: item.sharedTopicCount, avoided: false, mismatch: false }));
function mount(t: TestContext, entityKind: 'job' | 'topic' = 'job') {
  const previous = new Map(['document', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null } });
  let disconnects = 0;
  let resize: ((entries: { contentRect: { width: number } }[]) => void) | undefined;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { constructor(callback: typeof resize) { resize = callback; } observe() {} disconnect() { disconnects++; } } });
  const props = reactive({ forest: [ab, cd], nodes, selectedIds: new Set<string>(), relatedIds: null as Set<string> | null, entityKind, lang: 'en', busy: false,
 });
  const root = node('root'), selected: string[] = [], app = renderer.createApp({ render: () => h(component, { ...props, onSelect: (id: string) => selected.push(id) }) });
  app.mount(root);
  t.after(() => { app.unmount(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const values = () => descendants(root);
  return { props, selected, root, values, disconnects: () => disconnects, resize: (width: number) => resize?.([{ contentRect: { width } }]),
    slider: () => values().find(item => item.tag === 'input' && item.props.type === 'range')!,
    leaves: () => values().filter(item => item.tag === 'g' && String(item.props.class).includes('dendrogram-leaf')),
    legend: () => values().find(item => item.props.class === 'hierarchy-job-groups'),
    bands: () => values().find(item => item.props.class === 'dendrogram-group-bands')?.children.filter(item => item.tag === 'g') ?? [],
    count: () => values().find(item => item.props.class === 'hierarchy-group-count')!,
  };
}

test('worker partition roots define visible job bands without hiding jobs or adding intergroup merges', async t => {
  const view = mount(t); await nextTick();
  assert.equal(view.slider(), undefined, 'the cluster-count control is shared by both parent views');
  assert.match(text(view.count()), /2 job clusters/u);
  assert.equal(view.legend(), undefined);
  assert.equal(view.bands().length, 2);
  assert.equal(new Set(view.bands().map(band => band.props.style['--job-group-color'])).size, 2, 'separate plot groups remain distinguishable without a legend');
  assert.equal(view.values().filter(item => item.props.class === 'dendrogram-branches is-job-group').length, 2);
  view.props.forest = [ab, c, d]; await nextTick();
  assert.match(text(view.count()), /3 job clusters/u);
  assert.equal(view.legend(), undefined);
  assert.equal(view.bands().length, 3);
  assert.equal(view.leaves().length, 4);
  assert.deepEqual(view.leaves().map(text), ['job:A 8.5/10', 'job:B 8.5/10', 'job:C 8.5/10', 'job:D 8.5/10']);
  assert.deepEqual(view.selected, [], 'receiving a replacement partition never selects a job');
  assert.deepEqual(view.values().filter(item => item.tag === 'text').map(text), ['0%', '25%', '50%', '75%', '100%']);
  assert(!view.values().some(item => item.props.class === 'dendrogram-cut'), 'balanced groups do not claim a single similarity cutoff');
});

test('job group markers preserve muted selection context and native selectable leaf controls', async t => {
  const view = mount(t); await nextTick();
  view.props.relatedIds = new Set(['job:A', 'job:B']); view.props.selectedIds = new Set(['job:A']); await nextTick();
  const selected = view.leaves().find(item => String(item.props.class).includes('is-selected'))!;
  assert.match(text(selected), /job:A/u);
  assert.match(view.bands()[1]!.props.class, /is-muted/u);
  const muted = view.leaves().find(item => text(item).includes('job:D'))!;
  assert.match(muted.props.class, /is-muted/u);
  const button = descendants(muted).find(item => item.tag === 'button')!;
  assert.notEqual(button.props.disabled, true); assert.notEqual(button.props['aria-hidden'], true);
  assert.match(button.props['aria-label'], /job:D: 1 topic group used for clustering; interest 8.5/u);
  button.props.onClick(); assert.deepEqual(view.selected, ['job:D']);
  view.props.relatedIds = null; await nextTick();
  assert(view.leaves().every(item => !String(item.props.class).includes('is-muted')));
});

test('job title controls expand with the full-width plot and use taller wrapped rows on narrow views', async t => {
  const view = mount(t); await nextTick();
  view.props.forest = [{ ...ab, children: [{ ...a, label: 'Research Engineer — Embedded Systems and Human–Robot Interaction' }, b] }, cd];
  view.resize(1088); await nextTick();
  const labels = () => view.values().filter(item => item.tag === 'foreignObject');
  assert(labels().every(item => item.props.width >= 500 && item.props.height === 30));
  view.resize(342); await nextTick();
  assert.equal(view.values().find(item => item.tag === 'svg')!.props.width, 342);
  assert(labels().every(item => item.props.width >= 200 && item.props.height === 52));
  assert.match(view.values().find(item => String(item.props.class).includes('topic-hierarchy'))!.props.class, /is-job is-narrow/u);
  const button = descendants(labels()[0]!).find(item => item.tag === 'button')!;
  assert.match(text(button), /Research Engineer — Embedded Systems and Human–Robot Interaction 8.5\/10/u);
  assert.match(button.props['aria-label'], /Research Engineer — Embedded Systems and Human–Robot Interaction:/u);
  assert.equal(button.props.type, 'button', 'native buttons retain keyboard activation after resizing');
  button.props.onClick(); assert.deepEqual(view.selected, ['job:A']);
  assert.deepEqual(view.values().filter(item => item.tag === 'text').map(text), ['0%', '50%', '100%']);
  view.props.entityKind = 'topic'; await nextTick();
  assert(labels().every(item => item.props.width < 180 && item.props.height === 44));
  assert(!String(view.values().find(item => String(item.props.class).includes('topic-hierarchy'))!.props.class).includes('is-job'));
});

test('smaller job cohorts limit groups while topic hierarchy shows every selectable leaf without a cutoff control', async t => {
  const view = mount(t); await nextTick();
  view.props.forest = [d]; await nextTick();
  assert.match(text(view.count()), /1 job cluster/u);
  assert.equal(view.bands().length, 1);
  assert.equal(view.leaves().length, 1);
  view.props.entityKind = 'topic'; view.props.forest = [abcd];
  view.props.nodes = nodes.map(item => ({ ...item, kind: 'topic', matchingJobCount: 1 }));
  view.props.relatedIds = new Set(['job:A', 'job:B']); view.props.selectedIds = new Set(['job:A']); await nextTick();
  assert.equal(view.legend(), undefined);
  assert.equal(view.bands().length, 0);
  assert.equal(view.slider(), undefined);
  assert.equal(view.count(), undefined, 'there is no arbitrary threshold-based group count');
  assert.equal(view.leaves().length, 4, 'removing the threshold control retains the complete topic tree');
  assert(view.values().filter(item => item.tag === 'text').every(item => text(item).endsWith('%')));
  assert(!view.values().some(item => item.props.class === 'dendrogram-cut'));
  const muted = view.leaves().find(item => text(item).includes('job:D'))!;
  assert.match(muted.props.class, /is-muted/u);
  const button = descendants(muted).find(item => item.tag === 'button')!;
  assert.notEqual(button.props.disabled, true); assert.notEqual(button.props['aria-hidden'], true);
  button.props.onClick(); assert.deepEqual(view.selected, ['job:D']);
});

test('loading clears stale groups and displays only the replacement worker partition', async t => {
  const view = mount(t); await nextTick();
  view.props.forest = []; view.props.busy = true; await nextTick();
  assert.equal(view.count(), undefined);
  assert.equal(view.bands().length, 0);
  assert.equal(view.leaves().length, 0);
  assert(!view.values().some(item => item.props.class === 'hierarchy-empty'), 'loading does not announce an empty cohort');
  view.props.forest = [a, b, cd]; view.props.busy = false; await nextTick();
  assert.match(text(view.count()), /3 job clusters/u);
  assert.equal(view.bands().length, 3);
  assert.equal(view.leaves().length, 4);
  view.props.forest = [abcd]; await nextTick();
  assert.match(text(view.count()), /1 job cluster/u);
  assert.equal(view.bands().length, 1);
  assert.equal(view.leaves().length, 4, 'a balanced group retains all its jobs even across a zero-similarity branch');
});
