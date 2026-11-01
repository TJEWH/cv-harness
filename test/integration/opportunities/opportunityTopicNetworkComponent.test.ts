import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as three from 'three';
import { createRenderer, defineComponent, h, isProxy, nextTick, reactive, shallowReactive, type Component } from 'vue';
import { buildOpportunityInsights } from '../../../src/features/opportunities/domain/opportunityInsights';
import type { OpportunityReview } from '../../../src/app/cloudTypes';
import type { OpportunityGraphLayoutRequest } from '../../../src/features/opportunities/domain/opportunityGraphLayout';
import { useToasts } from '../../../src/shared/ui/useToasts';
import { opportunityFixture } from '../../support/fixtures/opportunity';

const filename = new URL('../../../src/features/opportunities/components/OpportunityTopicNetwork.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'network-worker-boundary-test' });
const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname,
  id: 'network-worker-boundary-test', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const transpile = (code: string) => ts.transpileModule(code.replaceAll('import.meta.url', JSON.stringify(filename.href)),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const requireComponent = createRequire(filename);

interface HostNode {
  tag?: string; text?: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode;
  clientWidth: number; clientHeight: number; style: Record<string, string>; tabIndex: number;
  addEventListener(): void; removeEventListener(): void; setAttribute(key: string, value: string): void;
  appendChild(child: HostNode): void; remove(): void;
}
function node(tag?: string, text?: string): HostNode {
  const result: HostNode = { tag, text, props: {}, children: [], clientWidth: 760, clientHeight: 390, style: {}, tabIndex: 0,
    addEventListener() {}, removeEventListener() {}, setAttribute(key, value) { result.props[key] = value; },
    appendChild(child) { child.parent = result; result.children.push(child); },
    remove() { if (result.parent) result.parent.children = result.parent.children.filter(child => child !== result); },
  };
  return result;
}
const teleportTargets = new Map<string, HostNode>();
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: text => node(undefined, text),
  insert(child, parent, anchor) { child.remove(); child.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child); },
  remove: child => child.remove(), setText(target, value) { target.text = value; },
  setElementText(target, value) { target.text = value; target.children = []; },
  patchProp(target, key, _previous, value) { target.props[key] = value; }, parentNode: target => target.parent ?? null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
  querySelector: selector => teleportTargets.get(selector) ?? null,
});

test('job network worker requests clone reactive exclusion drafts on initial and subsequent layouts', async t => {
  const globals = ['document', 'window', 'Worker', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const setGlobal = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, value });
  setGlobal('document', { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {} });
  setGlobal('window', { devicePixelRatio: 1 });
  setGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // Drawing is independent of the worker serialization boundary under test.
  setGlobal('requestAnimationFrame', () => 1);
  setGlobal('cancelAnimationFrame', () => {});
  const channel = new MessageChannel(), requests: OpportunityGraphLayoutRequest[] = [];
  const workers: { onmessage?: (event: { data: unknown }) => void; terminated: boolean }[] = [];
  setGlobal('Worker', class {
    onmessage?: (event: { data: unknown }) => void; onerror: unknown; terminated = false;
    constructor() { workers.push(this); }
    postMessage(value: OpportunityGraphLayoutRequest) {
      channel.port1.postMessage(value);
      const received = receiveMessageOnPort(channel.port2);
      assert(received, 'the actual MessagePort accepted and cloned the complete request');
      requests.push(received.message as OpportunityGraphLayoutRequest);
    }
    terminate() { this.terminated = true; }
  });
  class Renderer {
    constructor() { rendererInstances.push(this); }
    domElement = node('canvas');
    disposed = false;
    setPixelRatio() {} setClearColor() {} setSize() {} dispose() { this.disposed = true; } forceContextLoss() {}
  }
  const rendererInstances: Renderer[] = [];
  class Controls {
    constructor() { controlInstances.push(this); }
    target = new three.Vector3(); mouseButtons: Record<string, unknown> = {}; touches: Record<string, unknown> = {};
    updates = 0;
    addEventListener() {} update() { this.updates++; } dispose() {}
  }
  const controlInstances: Controls[] = [];
  const Empty = defineComponent({ setup: () => () => h('span') });
  const Hierarchy = defineComponent({ props: ['forest', 'busy'], setup: props => () => h('hierarchy', { forest: props.forest, busy: props.busy }) });
  const Bundling = defineComponent({ props: ['diagram', 'entityKind', 'nodes', 'topics', 'jobs', 'selectedId', 'selectedIds', 'lang', 'busy'], emits: ['select'],
    setup: (props, { emit }) => () => h('bundling', { ...props, onSelect: (id: string) => emit('select', id) }) });
  const module = (path: string) => path === 'three' ? { ...three, WebGLRenderer: Renderer }
    : path === 'three/addons/controls/OrbitControls.js' ? { OrbitControls: Controls }
      : path.endsWith('OpportunityTopicHierarchy.vue') ? { default: Hierarchy }
      : path.endsWith('OpportunityJobBundling.vue') ? { default: Bundling }
      : path.endsWith('.vue') ? { default: Empty } : requireComponent(path);
  const componentExports: { default?: Component } = {}, renderExports: { render?: () => unknown } = {};
  new Function('require', 'exports', transpile(script.content))(module, componentExports);
  new Function('require', 'exports', transpile(template.code))(module, renderExports);
  const component = { ...componentExports.default, render: renderExports.render };
  const graph = buildOpportunityInsights({ ownerId: 'owner', now: '2026-10-31T12:00:00Z',
    opportunities: reactive([opportunityFixture({ id: 'a', title: 'Acoustic job', topics: ['Research', 'Acoustics'],
      created_at: '2026-10-30T12:00:00Z' })]),
    reviews: reactive<OpportunityReview[]>([{ user_id: 'owner', opportunity_id: 'a', state: 'very_high_interest',
      interest_reasons: [{ category: 'topic', polarity: 'positive', target: 'Acoustics' }], feedback_revision: 1,
      reviewed_updated_at: null, created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z' }]),
    applications: reactive([]), windowDays: null }).graph;
  // The parent computes graph evidence as plain objects, while its ref-held exclusions are reactive arrays.
  const props = shallowReactive({ graph, selectedTopicIds: [] as string[], selectedJobId: null, lang: 'en', ownerId: 'owner',
    viewMode: 'jobs', jobMinimumInterest: 8, jobClusterCount: 5, jobExcludedTopicIds: reactive<string[]>([]),
    interestMode: 'all' as 'all' | 'high' | 'low', interestThreshold: undefined as number | undefined,
    visibleTopicIds: undefined as string[] | undefined, layoutPaused: false,
    presentationControlsTarget: undefined as string | undefined, cameraControlsTarget: undefined as string | undefined });
  assert(isProxy(props.jobExcludedTopicIds));
  const topicFocus: (string[] | null)[] = [], topicSelections: string[] = [];
  const root = node('root'), app = renderer.createApp({ render: () => h(component, { ...props,
    onFocusTopics: (ids: string[] | null) => topicFocus.push(ids), onSelectTopic: (id: string) => topicSelections.push(id) }) });
  useToasts().clear();
  t.after(() => { app.unmount(); channel.port1.close(); channel.port2.close(); useToasts().clear(); teleportTargets.clear();
    for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } });
  app.mount(root); await nextTick();
  assert.equal(requests.length, 1, 'even an empty reactive exclusion array must cross the worker boundary');
  assert.deepEqual(requests[0]!.jobExcludedTopicIds, []);
  assert.deepEqual(requests[0]!.jobs, graph.jobs, 'complete job context crosses the same clone boundary');
  assert.deepEqual(requests[0]!.jobTopics, graph.topics, 'topic evidence derived from reactive records remains cloneable');
  props.jobExcludedTopicIds = reactive(['research']); await nextTick();
  assert.equal(requests.length, 2, 'a changed reactive exclusion draft must request the next layout');
  assert.deepEqual(requests[1]!.jobExcludedTopicIds, ['research']);
  assert.deepEqual(requests[1]!.jobs![0]!.topicIds, ['acoustics', 'research'], 'exclusions do not mutate full job evidence');
  props.jobExcludedTopicIds.push('acoustics'); await nextTick();
  assert.equal(requests.length, 3, 'reactive collection changes still produce a cloneable request');
  assert.deepEqual(requests[2]!.jobExcludedTopicIds, ['research', 'acoustics']);
  props.jobClusterCount = 3; await nextTick();
  assert.equal(requests.length, 4, 'a committed cluster count requests the matching network layout');
  assert.equal(requests[3]!.jobClusterCount, 3);
  const walk = (target: HostNode): HostNode[] => [target, ...target.children.flatMap(walk)];
  const content = (target: HostNode): string => (target.text ?? '') + target.children.map(content).join('');
  await t.test('optional targets relocate the existing controls without restarting network resources', async () => {
    const presentationControls = walk(root).find(target => target.props['aria-label'] === 'Job cluster view');
    const cameraControls = walk(root).find(target => target.props['aria-label'] === 'Network view');
    assert(presentationControls, 'standalone presentation controls render inline');
    assert(cameraControls, 'standalone camera controls render inline');
    const presentationTarget = node('presentation-target'), cameraTarget = node('camera-target'), sidebar = node('sidebar');
    sidebar.appendChild(presentationTarget); sidebar.appendChild(cameraTarget);
    teleportTargets.set('#presentation', presentationTarget); teleportTargets.set('#camera', cameraTarget);
    const activeRenderer = rendererInstances[0], activeWorker = workers.at(-1), requestCount = requests.length;
    assert(activeRenderer);
    props.presentationControlsTarget = '#presentation'; props.cameraControlsTarget = '#camera';
    await nextTick();
    assert.equal(presentationControls.parent, presentationTarget);
    assert.equal(cameraControls.parent, cameraTarget);
    assert(!walk(root).includes(presentationControls));
    assert(!walk(root).includes(cameraControls));
    assert.equal(walk(presentationTarget).filter(target => target.tag === 'button').length, 3);
    assert.equal(walk(cameraTarget).filter(target => target.tag === 'button').length, 3);
    // The parent's desktop/mobile portals move these hosts as a unit.
    const inlineControls = node('inline-controls');
    presentationTarget.remove(); cameraTarget.remove();
    inlineControls.appendChild(presentationTarget); inlineControls.appendChild(cameraTarget);
    await nextTick();
    assert.equal(presentationControls.parent, presentationTarget, 'moving the host preserves the presentation controls');
    assert.equal(cameraControls.parent, cameraTarget, 'moving the host preserves the camera controls');
    assert.equal(requests.length, requestCount, 'control placement does not request layout work');
    assert.equal(workers.at(-1), activeWorker);
    assert.equal(activeWorker?.terminated, false);
    assert.equal(rendererInstances.length, 1);
    assert.equal(activeRenderer.disposed, false, 'control placement preserves the renderer and current camera');
    props.presentationControlsTarget = undefined; props.cameraControlsTarget = undefined;
    await nextTick();
    assert(walk(root).includes(presentationControls), 'removing a target returns the same controls inline');
    assert(walk(root).includes(cameraControls));
    assert.equal(requests.length, requestCount);
    assert.equal(rendererInstances.length, 1);
  });
  const hierarchyButton = walk(root).find(target => target.tag === 'button' && content(target) === 'Hierarchy');
  assert(hierarchyButton);
  hierarchyButton.props.onClick(); await nextTick(); await nextTick();
  assert.equal(requests.length, 5);
  assert.equal(requests[4]!.view, 'hierarchy');
  const oldHierarchy = [{ id: 'old-group', topicIds: ['job:a'], children: [], similarity: 0 }];
  workers[4]!.onmessage?.({ data: { generation: requests[4]!.generation, positions: [], hierarchy: oldHierarchy } });
  await nextTick();
  assert.deepEqual(walk(root).find(target => target.tag === 'hierarchy')!.props.forest, oldHierarchy);
  props.jobClusterCount = 2; await nextTick();
  assert.equal(requests.length, 6, 'hierarchy count changes recompute the balanced partition in the worker');
  assert.equal(requests[5]!.jobClusterCount, 2);
  assert.deepEqual(walk(root).find(target => target.tag === 'hierarchy')!.props.forest, [], 'the previous partition is cleared while the new grouping is pending');
  assert.equal(walk(root).find(target => target.tag === 'hierarchy')!.props.busy, true);
  workers[4]!.onmessage?.({ data: { generation: requests[4]!.generation, positions: [], hierarchy: oldHierarchy } });
  await nextTick();
  assert.deepEqual(walk(root).find(target => target.tag === 'hierarchy')!.props.forest, [], 'a stale partition cannot overwrite the committed count');
  const currentHierarchy = [{ ...oldHierarchy[0]!, id: 'current-group' }];
  workers[5]!.onmessage?.({ data: { generation: requests[5]!.generation, positions: [], hierarchy: currentHierarchy } });
  await nextTick();
  assert.deepEqual(walk(root).find(target => target.tag === 'hierarchy')!.props.forest, currentHierarchy);
  await t.test('portaled presentation and camera buttons retain their interaction and reset behavior', async () => {
    const presentationTarget = teleportTargets.get('#presentation')!, cameraTarget = teleportTargets.get('#camera')!;
    props.presentationControlsTarget = '#presentation'; props.cameraControlsTarget = '#camera';
    await nextTick();
    const button = (target: HostNode, label: string) => {
      const result = walk(target).find(candidate => candidate.tag === 'button' && content(candidate) === label);
      assert(result, `${label} is reachable in its control target`);
      return result;
    };
    assert.equal(button(presentationTarget, 'Hierarchy').props['aria-pressed'], true, 'relocation keeps the active presentation');
    assert(!walk(cameraTarget).some(target => target.tag === 'button'), 'camera controls stay hidden in the hierarchy');
    const requestCount = requests.length;
    button(presentationTarget, 'Network').props.onClick(); await nextTick(); await nextTick();
    assert.equal(requests.length, requestCount + 1);
    assert.equal(requests.at(-1)!.view, 'network');
    assert.equal(button(cameraTarget, '2D').props['aria-pressed'], true);
    const activeRenderer = rendererInstances.at(-1)!;
    button(cameraTarget, '3D').props.onClick(); await nextTick();
    assert.equal(requests.length, requestCount + 2);
    assert.equal(requests.at(-1)!.dimensions, 3);
    assert.equal(button(cameraTarget, '3D').props['aria-pressed'], true);
    assert.equal(rendererInstances.at(-1), activeRenderer, 'dimension changes keep the same canvas');
    assert.equal(activeRenderer.domElement.style.touchAction, 'pan-y', 'the taller canvas keeps native vertical touch scrolling');
    const activeControls = controlInstances.at(-1)!;
    assert.equal(activeControls.mouseButtons.LEFT, three.MOUSE.ROTATE);
    const updates = activeControls.updates;
    button(cameraTarget, 'Reset view').props.onClick(); await nextTick();
    assert.equal(activeControls.updates, updates + 1, 'Reset view fits the current camera');
    assert.equal(requests.length, requestCount + 2, 'Reset view does not rebuild evidence or layout');
    button(cameraTarget, '2D').props.onClick(); await nextTick();
    assert.equal(requests.at(-1)!.dimensions, 2);
    assert.equal(button(cameraTarget, '2D').props['aria-pressed'], true);
    assert.equal(controlInstances.at(-1)!.mouseButtons.LEFT, three.MOUSE.PAN);
  });
  await t.test('job edge bundling uses the worker without WebGL and invalidates filtered evidence', async () => {
    const presentationTarget = teleportTargets.get('#presentation')!, cameraTarget = teleportTargets.get('#camera')!;
    const button = walk(presentationTarget).find(target => target.tag === 'button' && content(target) === 'Hierarchical edge bundling');
    assert(button);
    const rendererCount = rendererInstances.length, activeRenderer = rendererInstances.at(-1)!;
    button.props.onClick(); await nextTick(); await nextTick(); await nextTick();
    assert.equal(requests.at(-1)!.view, 'bundling');
    assert.equal(requests.at(-1)!.jobClusterCount, props.jobClusterCount);
    assert.deepEqual(requests.at(-1)!.jobExcludedTopicIds, props.jobExcludedTopicIds);
    assert.equal(rendererInstances.length, rendererCount, 'the SVG presentation creates no WebGL renderer');
    assert.equal(activeRenderer.disposed, true);
    assert(!walk(cameraTarget).some(target => target.tag === 'button'), 'network camera controls stay hidden');
    const pending = walk(root).find(target => target.tag === 'bundling')!;
    assert.equal(pending.props.busy, true);
    assert.equal(pending.props.diagram, null);
    const oldWorker = workers.at(-1)!, oldGeneration = requests.at(-1)!.generation;
    const oldDiagram = { radius: 240, leaves: [{ id: 'job:a' }], edges: [], groups: [], relationshipCount: 0 };
    oldWorker.onmessage?.({ data: { generation: oldGeneration, positions: [], bundling: oldDiagram } });
    await nextTick();
    assert.deepEqual(walk(root).find(target => target.tag === 'bundling')!.props.diagram, oldDiagram);
    props.jobMinimumInterest = 7; await nextTick();
    assert.equal(requests.at(-1)!.jobMinimumInterest, 7);
    assert.equal(walk(root).find(target => target.tag === 'bundling')!.props.diagram, null, 'changed filters clear old curves immediately');
    oldWorker.onmessage?.({ data: { generation: oldGeneration, positions: [], bundling: oldDiagram } });
    await nextTick();
    assert.equal(walk(root).find(target => target.tag === 'bundling')!.props.diagram, null, 'stale worker curves cannot overwrite the new cohort');
    const workerBeforeOwner = workers.at(-1)!, generationBeforeOwner = requests.at(-1)!.generation;
    props.ownerId = 'next-owner'; await nextTick();
    workerBeforeOwner.onmessage?.({ data: { generation: generationBeforeOwner, positions: [], bundling: oldDiagram } });
    await nextTick();
    assert.equal(walk(root).find(target => target.tag === 'bundling')!.props.diagram, null, 'previous-account curves remain discarded');
    props.viewMode = 'topics'; await nextTick(); await nextTick();
    assert.equal(requests.at(-1)!.view, 'bundling', 'topic mode keeps the selected presentation');
    assert.equal(requests.at(-1)!.jobs, undefined, 'topic layout never enters the job clustering pipeline');
    assert.deepEqual(requests.at(-1)!.topicJobs, graph.jobs);
    assert(walk(presentationTarget).some(target => target.tag === 'button' && content(target) === 'Hierarchical edge bundling'));
    assert.equal(walk(root).find(target => target.tag === 'bundling')!.props.entityKind, 'topic');
    assert.equal(rendererInstances.length, rendererCount, 'both bundling modes stay independent of WebGL');
  });
  await t.test('topic bundling uses the interest cohort, exact multi-selection focus, and mode-safe worker results', async () => {
    const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
    const baseJob = graph.jobs[0]!, baseTopic = graph.topics[0]!;
    props.graph = { ...graph, topics: [
      { ...baseTopic, id: 'a', label: 'Acoustics' }, { ...baseTopic, id: 'b', label: 'Audio analysis' },
      { ...baseTopic, id: 'c', label: 'Acoustic sensing' }, { ...baseTopic, id: 'd', label: 'Robotics' },
    ], jobs: [
      { ...baseJob, id: 'high', topicIds: ['a', 'b'], interestScore: 9, explicitInterest: true },
      { ...baseJob, id: 'boundary', topicIds: ['a', 'b'], interestScore: 8, explicitInterest: true },
      { ...baseJob, id: 'low', topicIds: ['a', 'c'], interestScore: 3, explicitInterest: true },
      { ...baseJob, id: 'unknown', topicIds: ['b', 'd'], interestScore: null, explicitInterest: false },
      { ...baseJob, id: 'implicit', topicIds: ['a', 'c'], interestScore: 9, explicitInterest: false },
    ], edges: [] };
    props.interestMode = 'high'; props.interestThreshold = 8;
    props.selectedTopicIds = ['a', 'd'];
    await nextTick();
    let request = requests.at(-1)!;
    assert.equal(request.view, 'bundling'); assert.equal(request.entityKind, 'topic');
    assert.deepEqual(request.topicJobs!.map(job => job.id), ['high', 'boundary'], 'high interest is inclusive and requires an explicit score');
    assert.equal(request.jobs, undefined);
    assert(request.links.some(link => link.kind === 'semantic' && [link.source, link.target].includes('topic:c')),
      'the routing hierarchy retains the incumbent local-wording evidence');
    const result = runOpportunityGraphTask(request); assert(!('error' in result));
    assert.equal(result.bundling!.entityKind, 'topic');
    assert.deepEqual(result.bundling!.edges.map(edge => [edge.source, edge.target, edge.sharedCount]), [['topic:a', 'topic:b', 2]]);
    workers.at(-1)!.onmessage?.({ data: result }); await nextTick();
    assert.deepEqual([...topicFocus.at(-1)!].sort(), ['a', 'b', 'd'], 'multi-topic focus unions complete exact neighbors and preserves isolated selections');
    let bundled = walk(root).find(target => target.tag === 'bundling')!;
    assert.deepEqual([...bundled.props.selectedIds].sort(), ['topic:a', 'topic:d']);
    assert.equal(bundled.props.selectedId, null);
    assert.deepEqual(bundled.props.jobs.map((job: { id: string }) => job.id), ['high', 'boundary']);
    bundled.props.onSelect('topic:c'); await nextTick();
    assert.equal(topicSelections.at(-1), 'c', 'SVG topic selection reuses the parent toggle route');
    props.interestMode = 'low'; props.interestThreshold = 3; await nextTick();
    request = requests.at(-1)!;
    assert.deepEqual(request.topicJobs!.map(job => job.id), ['low'], 'low interest is inclusive and excludes missing or implicit scores');
    props.interestMode = 'all'; await nextTick();
    assert.equal(requests.at(-1)!.topicJobs!.length, 5, 'all topics retains unknown-interest records');
    props.visibleTopicIds = ['a', 'd']; await nextTick();
    request = requests.at(-1)!;
    assert.deepEqual(request.nodes.map(node => node.id), ['topic:a', 'topic:d'], 'visible topic minimum and search cohort stays authoritative');
    const filtered = runOpportunityGraphTask(request); assert(!('error' in filtered));
    assert.equal(filtered.bundling!.leaves.length, 2);
    assert.equal(filtered.bundling!.relationshipCount, 0, 'a hidden topic cannot leave an edge or count behind');
    const previousWorker = workers.at(-1)!, previousGeneration = request.generation;
    props.layoutPaused = true; await nextTick();
    previousWorker.onmessage?.({ data: filtered }); await nextTick();
    assert.equal(previousWorker.terminated, true);
    assert.equal(walk(root).find(target => target.tag === 'bundling')!.props.diagram, null, 'brush pause rejects canceled pending curves');
    props.layoutPaused = false; await nextTick();
    assert(requests.at(-1)!.generation > previousGeneration, 'brush release requests the current cohort');
    const topicWorker = workers.at(-1)!, topicGeneration = requests.at(-1)!.generation;
    props.viewMode = 'jobs'; await nextTick();
    assert.equal(requests.at(-1)!.view, 'bundling');
    assert.equal(requests.at(-1)!.topicJobs, undefined);
    assert(requests.at(-1)!.jobs);
    topicWorker.onmessage?.({ data: { ...filtered, generation: topicGeneration } }); await nextTick();
    bundled = walk(root).find(target => target.tag === 'bundling')!;
    assert.equal(bundled.props.entityKind, 'job');
    assert.equal(bundled.props.diagram, null, 'topic curves cannot reappear in job mode');
  });
  assert(!useToasts().toasts.value.some(toast => toast.tone === 'error'), 'serialization must not fail the map');
});
