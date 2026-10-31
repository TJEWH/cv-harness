import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, onBeforeUnmount, reactive, ref, type Component } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, Opportunity, OpportunityReview } from '../src/app/cloudTypes';
import { useOpportunityInsightsSearch } from '../src/features/opportunities/composables/useOpportunityInsightsSearch';
import { buildOpportunityInsights, prepareOpportunityInsights, type OpportunityInsightsAnalysis, type OpportunityInsightsAnalysisInput } from '../src/features/opportunities/domain/opportunityInsights';
import { useToasts, useToastWatch } from '../src/shared/ui/useToasts';
import { opportunityAssessmentFixture, opportunityFixture } from './fixtures/opportunity';

const filename = new URL('../src/features/opportunities/components/OpportunityInsights.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'opportunity-insights-component-test' });
const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname,
  id: 'opportunity-insights-component-test', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const requireComponent = createRequire(filename);
const owner = '92000000-0000-4000-8000-000000000001';
const searchId = '92000000-0000-4000-8000-000000000002';
const opportunityId = '92000000-0000-4000-8000-000000000003';
const safePrompt: OpportunityInsightsAnalysis = { text: 'SAFE SYNTHETIC ANALYSIS\n{"examples":[]}', exampleCount: 1,
  eligibleExampleCount: 1, omittedExamples: 0, withheldFields: 0 };

interface HostNode { tag?: string; text?: string; props: Record<string, unknown>; children: HostNode[]; parent?: HostNode; value?: unknown; options?: HostNode[]; addEventListener(): void; removeEventListener(): void }
function node(tag?: string, text?: string): HostNode {
  const value: HostNode = { tag, text, props: {}, children: [], addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(value, 'options', { get: () => value.children.filter(child => child.tag === 'option') });
  Object.defineProperty(value, 'value', { get: () => value.props.value ?? value.text ?? '', set: next => { value.props.value = next; } });
  return value;
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: text => node(undefined, text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText(target, value) { target.text = value; },
  setElementText(target, value) { target.text = value; target.children = []; },
  patchProp(target, key, _previous, value) { target.props[key] = value; },
  parentNode: target => target.parent ?? null,
  nextSibling: target => target.parent?.children[(target.parent.children.indexOf(target) + 1)] ?? null,
});
const descendants = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(descendants)];
const InfoHint = defineComponent({ setup: () => () => h('span') });
const AutosaveTextarea = defineComponent({ props: { modelValue: String, readonly: Boolean },
  setup: (props, context) => () => h('textarea', { ...context.attrs, value: props.modelValue, readonly: props.readonly }) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function savedSearchNetwork() {
  const reads: { owner: string; reply: ReturnType<typeof deferred<{ data: unknown[]; error: null }>> }[] = [];
  const client = { from(table: string) {
    assert.equal(table, 'opportunity_search_templates');
    let account = '';
    const query = { select() { return query; }, eq(key: string, value: string) {
      assert.equal(key, 'user_id'); account = value; return query;
    }, order() { const reply = deferred<{ data: unknown[]; error: null }>(); reads.push({ owner: account, reply }); return reply.promise; } };
    return query;
  }, rpc() { throw new Error('Insights must not request dashboard history.'); } } as unknown as SupabaseClient;
  const resolve = (index: number, id = searchId, account = owner) => reads[index]!.reply.resolve({ data: [{
    id, user_id: account, name: 'Synthetic saved search', revision: 1, criteria: {}, schedule: {}, meta_search: { version: 1 },
  }], error: null });
  return { client, reads, resolve };
}
async function settleSearch() { for (let index = 0; index < 12; index++) await Promise.resolve(); await nextTick(); }
interface Editor { copyAnalysis(): Promise<void>; copying: boolean; preparedText: string; preparedExamples: number; copyFailed: boolean }
type ChartEvent = 'update:aggregation' | 'update:view';
type BrushEvent = 'update:range' | 'brush-active';
type NetworkEvent = 'selectTopic' | 'selectJob' | 'availability' | 'focusTopics';

function localDay(daysAgo = 0): string {
  const value = new Date();
  value.setDate(value.getDate() - daysAgo);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function startOfDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!).toISOString();
}
function endOfDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(new Date(year!, month! - 1, day! + 1).getTime() - 1).toISOString().replace(/999Z$/u, '999999Z');
}
function changeControl(control: HostNode | undefined, event: 'onInput' | 'onChange', value: string): void {
  assert(control, 'the requested control is rendered');
  assert.equal(typeof control.props[event], 'function');
  (control.props[event] as (event: Event) => void)({ target: { value } } as unknown as Event);
}
function setCurrentOnly(control: HostNode | undefined, checked: boolean): void {
  assert(control, 'the current-opportunities checkbox is rendered');
  const update = control.props['onUpdate:modelValue'];
  if (typeof update === 'function') update(checked);
  else {
    assert.equal(typeof control.props.onChange, 'function');
    (control.props.onChange as (event: Event) => void)({ target: { checked } } as unknown as Event);
  }
}
const isChecked = (control: HostNode) => Boolean(control.props.checked ?? (control as HostNode & { checked?: boolean }).checked);
const nodeText = (root: HostNode) => descendants(root).map(value => value.text ?? '').join(' ').replace(/\s+/gu, ' ').trim();
const fixtureId = (index: number) => `92000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function job(index: number, title: string, topics: string[], daysAgo: number, fit = 9): Opportunity {
  return opportunityFixture({ id: fixtureId(index), title, topics, created_at: startOfDay(localDay(daysAgo)), updated_at: new Date().toISOString(), personal_fit: opportunityAssessmentFixture(fit) });
}
function jobReview(index: number, rating: 2 | 6 | 8 | 9, reasons: OpportunityReview['interest_reasons'] = []): OpportunityReview {
  const state: OpportunityReview['state'] = ({ 2: 'not_interested', 6: 'interested', 8: 'strong_interest', 9: 'very_high_interest' } as const)[rating];
  return { user_id: owner, opportunity_id: fixtureId(index), state, interest_rating: rating, interest_reasons: reasons, feedback_revision: 1,
    feedback_updated_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reviewed_updated_at: null };
}

function mount(t: TestContext, initial: { opportunities?: Opportunity[]; reviews?: OpportunityReview[]; currentTime?: Date; loading?: boolean; sidebarActive?: boolean; client?: SupabaseClient | null; projectRef?: string } = {},
  connection: { configuredProject?: string; realSearch?: boolean } = {}) {
  useToasts().clear();
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null } });
  const calls: OpportunityInsightsAnalysisInput[] = [], publications: string[] = [], openedOpportunities: string[] = [];
  const handlers = { build: async (_input: OpportunityInsightsAnalysisInput): Promise<OpportunityInsightsAnalysis> => safePrompt,
    copied: true, clipboardCalls: 0 };
  let search = { searchId: ref<string | null>(searchId),
    loading: ref(false), error: ref(''), hasSavedSearch: ref(true), refresh: async () => true };
  let searchOptions: Parameters<typeof useOpportunityInsightsSearch>[0];
  const componentExports: { default?: Component } = {};
  const renderExports: { render?: () => unknown } = {};
  let chartProps: Record<string, any> | null = null, brushProps: Record<string, any> | null = null, controlsProps: Record<string, any> | null = null;
  let chartEmit: (event: ChartEvent, ...args: unknown[]) => void = () => {}, brushEmit: (event: BrushEvent, ...args: unknown[]) => void = () => {}, controlsEmit: (event: 'update:view', ...args: unknown[]) => void = () => {};
  let preparations = 0;
  const preparedBuilds: unknown[] = [];
  let networkProps: Record<string, any> | null = null, networkMounts = 0, networkUnmounts = 0;
  let networkEmit: (event: NetworkEvent, ...args: unknown[]) => void = () => {};
  const Timeline = defineComponent({ props: ['timeline', 'topics', 'selectedTopicIds', 'selectedJob', 'lang', 'aggregation', 'view', 'showControls', 'panelId'],
    emits: ['update:aggregation', 'update:view'], setup: (props, { emit }) => {
      chartProps = props; chartEmit = emit; onBeforeUnmount(() => { chartProps = null; });
      return () => h('section', { 'data-mock': 'chart' });
    } });
  const Brush = defineComponent({ props: ['overview', 'rangeStart', 'rangeEnd', 'domainStart', 'domainEnd', 'lang'],
    emits: ['update:range', 'brush-active'], setup: (props, { emit }) => {
      brushProps = props; brushEmit = emit; onBeforeUnmount(() => { brushProps = null; });
      return () => h('section', { 'data-mock': 'brush' });
    } });
  const Controls = defineComponent({ props: ['view', 'lang', 'panelId'], emits: ['update:view'], setup: (props, { emit }) => {
    controlsProps = props; controlsEmit = emit; onBeforeUnmount(() => { controlsProps = null; });
    return () => h('nav', { 'data-mock': 'fixed-timeline-controls' });
  } });
  const DesktopSidebarPortal = defineComponent({ props: { area: String, active: { type: Boolean, default: true } },
    setup: (props, { slots }) => () => h('div', { 'data-mock': 'sidebar-portal', 'data-area': props.area, 'data-active': props.active }, slots.default?.()) });
  const Network = defineComponent({ props: ['graph', 'selectedTopicIds', 'selectedJobId', 'ownerId', 'layoutPaused', 'lang', 'visibleTopicIds', 'matchingJobCounts', 'interestMode', 'interestThreshold', 'viewMode', 'jobMinimumInterest', 'jobClusterCount', 'jobExcludedTopicIds', 'presentationControlsTarget', 'cameraControlsTarget'],
    emits: ['selectTopic', 'selectJob', 'availability', 'focusTopics'], setup: (props, { emit }) => {
      networkProps = props; networkEmit = emit; networkMounts++; onBeforeUnmount(() => { networkProps = null; networkUnmounts++; });
      return () => h('section', { 'data-mock': 'network' });
    } });
  const module = (path: string) => path.endsWith('AutosaveTextarea.vue') ? { default: AutosaveTextarea }
    : path.endsWith('DesktopSidebarPortal.vue') ? { default: DesktopSidebarPortal }
    : path.endsWith('OpportunityInsightsTimeline.vue') ? { default: Timeline }
      : path.endsWith('OpportunityInsightsBrush.vue') ? { default: Brush }
      : path.endsWith('OpportunityInsightsTimelineControls.vue') ? { default: Controls }
      : path === 'vue' ? { ...requireComponent(path), defineAsyncComponent: () => Network }
    : path.endsWith('.vue') ? { default: InfoHint }
      : path === '@fortawesome/vue-fontawesome' ? { FontAwesomeIcon: InfoHint }
        : path === '../../../platform/supabase/supabase' ? { supabaseConfiguration: connection.configuredProject
          ? { status: 'ready', url: `https://${connection.configuredProject}.supabase.co`, publishableKey: 'sb_publishable_synthetic' } : { status: 'missing' } }
        : path === '../composables/useOpportunityInsightsSearch' ? { useOpportunityInsightsSearch: (options: Parameters<typeof useOpportunityInsightsSearch>[0]) => {
          searchOptions = options;
          if (connection.realSearch) search = useOpportunityInsightsSearch(options);
          return search;
        } }
          : path === '../domain/opportunityInsights' ? { ...requireComponent(path), buildOpportunityInsights, prepareOpportunityInsights: (input: Parameters<typeof prepareOpportunityInsights>[0]) => {
            preparations++; const prepared = prepareOpportunityInsights(input);
            return { build: (selection?: Parameters<ReturnType<typeof prepareOpportunityInsights>['build']>[0]) => { preparedBuilds.push(selection); return prepared.build(selection); } };
          }, buildOpportunityInsightsAnalysisPrompt: async (input: OpportunityInsightsAnalysisInput) => {
            calls.push(input); return handlers.build(input);
          } }
            : path === '../../../shared/lib/preparedClipboard' ? { copyPreparedText: async (prepare: () => Promise<string | null>) => {
              handlers.clipboardCalls++;
              const value = await prepare();
              if (value === null) return null;
              if (handlers.copied) publications.push(value);
              return { value, copied: handlers.copied };
            } }
              : path === '../../../shared/ui/useToasts' ? { useToasts, useToastWatch } : requireComponent(path);
  new Function('require', 'exports', transpile(script.content))(module, componentExports);
  new Function('require', 'exports', transpile(template.code))(module, renderExports);
  const component = { ...componentExports.default, render: renderExports.render };
  const props = reactive({ ownerId: owner, client: null as SupabaseClient | null, projectRef: 'abcdefghijklmnopqrst' as string | undefined, lang: 'en', loading: false,
    opportunities: [opportunityFixture({ id: opportunityId, title: 'Synthetic acoustic research', topics: ['Acoustics'],
      created_at: startOfDay(localDay(20)), personal_fit: opportunityAssessmentFixture(8.5) })] as Opportunity[],
    reviews: [{ user_id: owner, opportunity_id: opportunityId, state: 'interested', interest_rating: 7,
      feedback_updated_at: null, feedback_revision: 1,
      reviewed_updated_at: null, created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z' }] as OpportunityReview[],
    applications: [] as Application[], currentTime: undefined as Date | undefined, sidebarActive: true, ...initial });
  let instance: unknown;
  const root = node('root');
  const app = renderer.createApp({ render: () => h(component, { ...props, onOpenOpportunity: (id: string) => openedOpportunities.push(id), ref: (value: unknown) => { instance = value; } }) });
  app.mount(root);
  const editor = (instance as { $: { setupState: Editor } }).$.setupState;
  let closed = false;
  const close = () => { if (!closed) {
    closed = true; app.unmount();
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else Reflect.deleteProperty(globalThis, 'document');
  } };
  t.after(() => { close(); useToasts().clear(); });
  const button = (label: string) => descendants(root).find(item => item.tag === 'button'
    && (item.props['aria-label'] === label || nodeText(item) === label));
  return { props, editor, handlers, calls, publications, openedOpportunities, search, searchOptions: searchOptions!, close,
    prompt: () => descendants(root).find(value => value.tag === 'textarea'),
    dateInput: (bound: 'start' | 'end') => descendants(root).find(value => value.tag === 'input'
      && value.props.type === 'date' && String(value.props.id).endsWith(`-${bound}-date`)),
    timeline: () => brushProps!, chart: () => chartProps ?? undefined, controls: () => controlsProps, network: () => networkProps,
    preparations: () => preparations, preparedBuilds,
    timelineEmit: (event: BrushEvent, ...args: unknown[]) => brushEmit(event, ...args),
    chartEmit: (event: ChartEvent, ...args: unknown[]) => chartEmit(event, ...args),
    controlsEmit: (event: 'update:view', ...args: unknown[]) => controlsEmit(event, ...args),
    networkLifecycle: () => ({ mounts: networkMounts, unmounts: networkUnmounts }),
    networkEmit: (event: NetworkEvent, ...args: unknown[]) => networkEmit(event, ...args),
    byClass: (value: string) => descendants(root).find(item => item.props.class === value),
    byId: (value: string) => descendants(root).find(item => item.props.id === value),
    sidebarPortal: (area: 'major' | 'minor') => descendants(root).find(item => item.props['data-mock'] === 'sidebar-portal' && item.props['data-area'] === area),
    button,
    showBody: async (label: 'Trends' | 'Clusters' | 'Interest patterns') => {
      const target = button(label); assert(target); (target.props.onClick as () => void)(); await nextTick();
    },
    showTopicClusters: async () => {
      const target = button('Topic clusters'); assert(target); (target.props.onClick as () => void)(); await nextTick();
    },
    control: (label: string) => {
      const target = descendants(root).find(item => item.tag === 'label' && nodeText(item.children.find(child => child.tag === 'span') ?? item).startsWith(label));
      return target && descendants(target).find(item => item.tag === 'select' || item.tag === 'input');
    },
    bodyTabs: () => descendants(root).filter(item => item.tag === 'button' && item.props.role === 'tab'),
    copyButton: () => descendants(root).find(item => item.tag === 'button' && item.props.class === 'btn insights-copy')!,
    renderedText: () => descendants(root).map(value => value.text ?? '').join(' '),
    promptDisclosure: () => descendants(root).find(value => value.tag === 'details' && value.props.class === 'insights-prompt') };
}

test('configured Insights resolves saved-search copying when the app omits the optional project prop', async t => {
  const service = savedSearchNetwork();
  const view = mount(t, { client: service.client, projectRef: undefined }, { configuredProject: 'abcdefghijklmnopqrst', realSearch: true });
  assert.equal(view.searchOptions.projectRef(), 'abcdefghijklmnopqrst');
  assert.equal(service.reads.length, 1, 'the normal app path must load the saved-search identity');
  assert.equal(service.reads[0]!.owner, owner);
  assert.equal(view.copyButton().props.disabled, true, 'copying waits for the optional context request');
  service.resolve(0); await settleSearch();
  assert.equal(view.search.searchId.value, searchId);
  assert.equal(view.copyButton().props.disabled, false);
  await view.editor.copyAnalysis();
  assert.equal(view.calls[0]!.searchId, searchId, 'the resolved identity enables the existing qualitative and hierarchy copy path');
  assert.equal(view.publications.length, 1);
});

test('unconfigured Insights retains aggregate-only copying without requesting saved-search metadata', async t => {
  const service = savedSearchNetwork(), view = mount(t, { client: service.client, projectRef: undefined }, { realSearch: true });
  assert.equal(view.searchOptions.projectRef(), undefined);
  assert.equal(service.reads.length, 0);
  assert.equal(view.search.searchId.value, null);
  assert.equal(view.search.error.value, '');
  await view.editor.copyAnalysis();
  assert.equal(view.calls[0]!.searchId, null);
  assert.equal(view.publications.length, 1);
});

test('explicit project overrides and account changes reject obsolete metadata and pending copies', async t => {
  const service = savedSearchNetwork(), configuredProject = 'abcdefghijklmnopqrst';
  const view = mount(t, { client: service.client, projectRef: 'tsrqponmlkjihgfedcba' }, { configuredProject, realSearch: true });
  assert.equal(view.searchOptions.projectRef(), 'tsrqponmlkjihgfedcba', 'an explicit project wins over configured fallback');
  view.props.projectRef = 'bcdefghijklmnopqrstu'; await nextTick();
  assert.equal(service.reads.length, 2);
  service.resolve(0); await settleSearch();
  assert.equal(view.search.searchId.value, null, 'the previous explicit project cannot restore context');
  service.resolve(1); await settleSearch();
  assert.equal(view.search.searchId.value, searchId);
  const pending = deferred<OpportunityInsightsAnalysis>();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  view.props.projectRef = undefined; await nextTick();
  assert.equal(view.searchOptions.projectRef(), configuredProject);
  assert.equal(view.calls[0]!.signal?.aborted, true, 'returning to configured scope aborts the old pending copy');
  assert.equal(view.search.searchId.value, null);
  view.props.ownerId = fixtureId(99); await nextTick();
  assert.equal(service.reads.length, 4);
  assert.equal(service.reads[3]!.owner, fixtureId(99));
  service.resolve(2); await settleSearch();
  assert.equal(view.search.searchId.value, null, 'the previous account cannot restore context in the configured scope');
  service.resolve(3, fixtureId(98), fixtureId(99)); await settleSearch();
  assert.equal(view.search.searchId.value, fixtureId(98));
  pending.resolve(safePrompt); await copying;
  assert.deepEqual(view.publications, []);
  assert.equal(view.editor.preparedText, '');
});

test('copy prepares one safe scoped analysis for the selected addition window without search activity', async t => {
  const view = mount(t);
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0]!.ownerId, owner);
  assert.equal(view.calls[0]!.searchId, searchId);
  assert.equal(view.calls[0]!.windowDays, null);
  assert.equal(view.calls[0]!.rangeStart ?? null, null);
  assert.equal(view.calls[0]!.rangeEnd ?? null, null);
  assert.deepEqual(view.calls[0]!.topicFilter, { mode: 'high', interestThreshold: 8, minimumJobCount: 1 });
  assert.equal(Number.isFinite(Date.parse(view.calls[0]!.now!)), true);
  assert.equal(view.publications.length, 1);
  assert.match(view.publications[0]!, /^SAFE SYNTHETIC ANALYSIS/u);
  assert.doesNotMatch(view.publications[0]!, /RECENT SEARCH CONTEXT|Search history unavailable/u);
  assert.doesNotMatch(view.renderedText(), /Search activity/u);
  assert.equal(view.editor.preparedText, view.publications[0]);
  assert.equal(view.editor.preparedExamples, 1);
  assert.equal(view.editor.copying, false);
  assert.equal(view.editor.copyFailed, false);
  assert.equal(view.prompt()!.props.readonly, true);
  assert.equal(useToasts().toasts.value[0]?.tone, 'success');
});

test('body tabs mount only their active visualization while retaining one shared footer brush', async t => {
  const view = mount(t), brush = view.timeline();
  assert.equal(view.dateInput('start'), undefined);
  assert.equal(view.dateInput('end'), undefined);
  assert.equal(view.bodyTabs().length, 3);
  assert.equal(view.bodyTabs()[0]!.props['aria-selected'], true);
  assert.equal(view.bodyTabs()[0]!.props.tabindex, 0);
  assert.equal(view.chart()!.showControls, false);
  assert.equal(view.controls()!.panelId, view.chart()!.panelId);
  assert.equal(view.button('All history'), undefined);
  assert.equal(view.button('Last 30 days'), undefined);
  assert.equal(view.network(), null);
  assert.deepEqual(view.networkLifecycle(), { mounts: 0, unmounts: 0 });
  const selected = { start: localDay(25), end: localDay(5) };
  view.timelineEmit('update:range', selected); await nextTick();
  await view.showBody('Clusters');
  assert.equal(view.chart(), undefined, 'the timeline chart is unmounted outside its tab');
  assert(view.network());
  assert.equal(view.timeline(), brush, 'the footer brush is not recreated when the body changes');
  assert.equal(view.timeline().rangeStart, selected.start);
  assert.deepEqual(view.networkLifecycle(), { mounts: 1, unmounts: 0 });
  await view.showBody('Interest patterns');
  assert.equal(view.network(), null, 'leaving Topics disposes its renderer and worker through unmount');
  assert.equal(view.chart(), undefined);
  assert.equal(view.timeline(), brush);
  assert.equal(view.timeline().rangeEnd, selected.end);
  assert.match(view.renderedText(), /Where your high interest clusters/u);
  assert.deepEqual(view.networkLifecycle(), { mounts: 1, unmounts: 1 });
  await view.showBody('Trends');
  assert.equal(view.chart()!.timeline.start, startOfDay(selected.start));
  assert.equal(view.chart()!.timeline.end, endOfDay(selected.end));
  assert.equal(view.network(), null);
  assert.equal(view.timeline(), brush);
});

test('job clusters are the first and default mode with each mode’s sliders beside the section title', async t => {
  const view = mount(t, { opportunities: [job(10, 'First acoustic job', ['Acoustics'], 20), job(11, 'Second acoustic job', ['Acoustics'], 15),
    job(12, 'Third acoustic job', ['Acoustics'], 10), job(13, 'Fourth acoustic job', ['Acoustics'], 5)],
    reviews: [10, 11, 12, 13].map(id => jobReview(id, 9)) });
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs');
  const switcher = view.byClass('insights-view-switch')!;
  assert.deepEqual(switcher.children.filter(item => item.tag === 'button').map(nodeText), ['Job clusters', 'Topic clusters']);
  assert.equal(view.button('Job clusters')!.props['aria-pressed'], true);
  assert.equal(view.byClass('insights-job-list is-job-explorer')!.children.filter(item => item.tag === 'li').length, 4);
  assert.equal(view.button('Topic clusters')!.props['aria-pressed'], false);
  assert.equal(view.control('Interest'), undefined);
  assert.equal(view.control('Minimum matching jobs'), undefined);
  assert.equal(view.control('Minimum interest')!.props.value, 8);
  assert.equal(view.control('Clusters')!.props.value, 4);
  const heading = view.byClass('insights-section-heading insights-explorer-heading')!;
  assert(heading);
  assert.equal(descendants(heading).includes(switcher), false, 'cluster mode navigation belongs to the sidebar group');
  const interest = view.control('Minimum interest')!, clusters = view.control('Clusters')!;
  const jobRow = view.byClass('insights-topic-filters insights-job-filters')!;
  assert(jobRow && descendants(jobRow).includes(interest) && descendants(jobRow).includes(clusters));
  assert.equal(jobRow.parent, heading, 'both job sliders sit in the heading beside its title');
  const headingChildren = heading.children.filter(item => item.tag);
  const filterPosition = headingChildren.indexOf(jobRow);
  assert.equal(filterPosition, headingChildren.findIndex(item => descendants(item).some(child => child.tag === 'h3')) + 1);
  await view.showTopicClusters();
  const topicRow = view.byClass('insights-topic-filters')!;
  assert(topicRow);
  assert.equal(topicRow.parent, heading);
  assert.equal(heading.children.filter(item => item.tag).indexOf(topicRow), filterPosition, 'topic filters occupy the same heading position');
  assert.equal(view.control('Minimum matching jobs')!.props.value, 3);
  assert.equal(view.control('Minimum matching jobs')!.props.max, 4);
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.calls.at(-1)!.topicFilter, { mode: 'high', interestThreshold: 8, minimumJobCount: 3 });
  (view.control('Minimum matching jobs')!.props['onUpdate:modelValue'] as (value: number) => void)(1); await nextTick();
  view.props.reviews = view.props.reviews.map(review => ({ ...review, user_id: fixtureId(99) }));
  view.props.ownerId = fixtureId(99); await nextTick();
  assert(view.chart(), 'changing account restores the Development body');
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs', 'the new account starts with the default job mode');
  assert.equal(view.network()!.selectedJobId, null);
  assert.equal(view.control('Minimum interest')!.props.value, 8);
  await view.showTopicClusters();
  assert.equal(view.control('Minimum matching jobs')!.props.value, 3, 'account changes restore the default count before cohort clamping');
});

test('explorer sidebar groups mount only for Topics with distinct ordered targets for child controls', async t => {
  const view = mount(t);
  assert.equal(view.sidebarPortal('major'), undefined);
  assert.equal(view.sidebarPortal('minor'), undefined);
  await view.showBody('Clusters');
  const major = view.sidebarPortal('major')!, minor = view.sidebarPortal('minor')!;
  assert(major && minor, 'standalone rendering preserves both portal slots inline');
  assert.equal(major.props['data-active'], true);
  assert.equal(minor.props['data-active'], true);
  const presentationTarget = view.network()!.presentationControlsTarget as string;
  const cameraTarget = view.network()!.cameraControlsTarget as string;
  assert.match(presentationTarget, /^#.+-presentation-controls$/u);
  assert.match(cameraTarget, /^#.+-camera-controls$/u);
  assert.notEqual(presentationTarget, cameraTarget);
  const presentation = view.byId(presentationTarget.slice(1))!, camera = view.byId(cameraTarget.slice(1))!;
  assert(presentation && camera, 'the active network receives two existing child destinations');
  const majorNodes = descendants(major), minorNodes = descendants(minor);
  assert(majorNodes.includes(presentation));
  assert(majorNodes.indexOf(view.byClass('insights-view-switch')!) < majorNodes.indexOf(presentation), 'presentation controls follow Job/Topic mode controls');
  assert(minorNodes.includes(camera));
  assert(minorNodes.indexOf(camera) < minorNodes.indexOf(view.control('Current opportunities only')!), 'camera controls precede the current-only checkbox');
  assert.equal(majorNodes.includes(view.control('Current opportunities only')!), false);
  assert.equal(minorNodes.includes(view.button('Topic clusters')!), false);
  await view.showTopicClusters();
  assert.equal(view.network()!.presentationControlsTarget, presentationTarget);
  assert.equal(view.network()!.cameraControlsTarget, cameraTarget);
  for (const label of ['Trends', 'Interest patterns'] as const) {
    await view.showBody(label);
    assert.equal(view.sidebarPortal('major'), undefined);
    assert.equal(view.sidebarPortal('minor'), undefined);
    assert.equal(view.byId(presentationTarget.slice(1)), undefined);
    assert.equal(view.byId(cameraTarget.slice(1)), undefined);
    assert.equal(view.button('Topic clusters'), undefined, 'inactive explorer controls do not remain in a sidebar slot');
    assert.equal(view.control('Current opportunities only'), undefined);
  }
});

test('sidebar activity and body switches preserve explorer evidence while account changes remove its controls and reset scope', async t => {
  const ids = [10, 11, 12, 13];
  const view = mount(t, { opportunities: ids.map(id => ({ ...job(id, `Acoustic job ${id}`, ['Acoustics'], 10), deadline: null })),
    reviews: ids.map(id => jobReview(id, 9)) });
  await view.showBody('Clusters');
  changeControl(view.control('Minimum interest'), 'onInput', '6');
  changeControl(view.control('Minimum interest'), 'onChange', '6');
  changeControl(view.control('Clusters'), 'onInput', '2');
  changeControl(view.control('Clusters'), 'onChange', '2');
  setCurrentOnly(view.control('Current opportunities only'), true); await nextTick();
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  await view.editor.copyAnalysis(); await nextTick();
  const prepared = view.editor.preparedText, lifecycle = view.networkLifecycle();
  for (const active of [false, true]) {
    view.props.sidebarActive = active; await nextTick();
    assert.equal(view.sidebarPortal('major')!.props['data-active'], active);
    assert.equal(view.sidebarPortal('minor')!.props['data-active'], active);
    assert.equal(view.network()!.jobMinimumInterest, 6);
    assert.equal(view.network()!.jobClusterCount, 2);
    assert.equal(view.network()!.selectedJobId, fixtureId(10));
    assert.equal(isChecked(view.control('Current opportunities only')!), true);
    assert.equal(view.editor.preparedText, prepared, 'moving controls between sidebar and inline fallback preserves the prepared copy');
    assert.deepEqual(view.networkLifecycle(), lifecycle, 'sidebar activity does not recreate the graph');
  }
  await view.showBody('Trends');
  assert.equal(view.sidebarPortal('major'), undefined);
  assert.equal(view.chart()!.selectedJob.id, fixtureId(10));
  assert.equal(view.editor.preparedText, prepared);
  await view.showBody('Clusters');
  assert.equal(view.network()!.jobMinimumInterest, 6);
  assert.equal(view.network()!.jobClusterCount, 2);
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  assert.equal(isChecked(view.control('Current opportunities only')!), true);
  await view.showTopicClusters();
  (view.control('Minimum matching jobs')!.props['onUpdate:modelValue'] as (value: number) => void)(2); await nextTick();
  view.networkEmit('selectTopic', 'acoustics');
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  await view.editor.copyAnalysis(); await nextTick();
  const topicPrepared = view.editor.preparedText;
  view.props.sidebarActive = false; await nextTick();
  await view.showBody('Interest patterns');
  assert.equal(view.sidebarPortal('minor'), undefined);
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'topics');
  assert.equal(view.control('Minimum matching jobs')!.props.value, 2);
  assert.deepEqual([...view.network()!.selectedTopicIds], ['acoustics']);
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  assert.equal(view.editor.preparedText, topicPrepared);
  assert.equal(view.sidebarPortal('major')!.props['data-active'], false);
  view.props.ownerId = fixtureId(99); await nextTick();
  assert.equal(view.sidebarPortal('major'), undefined, 'the former account cannot leave explorer controls in the sidebar');
  assert.equal(view.sidebarPortal('minor'), undefined);
  assert.equal(view.editor.preparedText, '');
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs');
  assert.equal(view.network()!.selectedJobId, null);
  assert.equal(view.control('Minimum interest')!.props.value, 8);
  assert.equal(isChecked(view.control('Current opportunities only')!), false);
  assert.equal(view.sidebarPortal('major')!.props['data-active'], false, 'account reset retains the workspace’s sidebar activity');
});

test('the topic matching minimum defaults to three, clamps to available jobs, and survives loading an initially empty catalogue', async t => {
  for (const count of [0, 1, 2, 3, 4]) {
    const ids = Array.from({ length: count }, (_, index) => index + 10);
    const view = mount(t, { opportunities: ids.map(id => job(id, `Acoustic job ${id}`, ['Acoustics'], 10)),
      reviews: ids.map(id => jobReview(id, 9)) });
    if (!count) {
      assert.equal(view.copyButton().props.disabled, true, 'an empty catalogue disables analysis copying');
    } else {
      await view.showBody('Clusters');
      await view.showTopicClusters();
      assert.equal(view.control('Minimum matching jobs')!.props.value, Math.min(3, count));
      assert.equal(view.control('Minimum matching jobs')!.props.max, count);
    }
    view.close();
  }
  const view = mount(t, { loading: true, opportunities: [], reviews: [] });
  view.props.opportunities = [10, 11, 12, 13].map(id => job(id, `Loaded acoustic job ${id}`, ['Acoustics'], 10));
  view.props.reviews = [10, 11, 12, 13].map(id => jobReview(id, 9));
  view.props.loading = false;
  await nextTick();
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.equal(view.control('Minimum matching jobs')!.props.value, 3, 'the loading placeholder does not reduce the requested default');
  assert.equal(view.control('Minimum matching jobs')!.props.max, 4);
});

test('low-interest filtering uses only maximum interest and preserves complete explicit-avoid context', async t => {
  const view = mount(t, { opportunities: [
    job(10, 'Strong acoustic sensing', ['Acoustic sensing', 'Robotics'], 20),
    job(11, 'High acoustics', ['Acoustics'], 18),
    job(12, 'Low simulation context', ['ACOUSTIC_SIMULATION', 'Robotics'], 15),
    job(13, 'Low rare experiments', ['Acoustics', 'Experiments'], 12),
    job(14, 'Medium acoustics', ['Acoustics'], 10),
    job(15, 'Unknown interest job', ['Unrated topic'], 8),
    job(16, 'Second low simulation', ['acoustic simulation'], 6),
  ], reviews: [jobReview(10, 9), jobReview(11, 8), jobReview(12, 2, [{ category: 'topic', polarity: 'negative', target: 'acoustic_simulation' }]),
    jobReview(13, 2), jobReview(14, 6), jobReview(16, 2)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  const setMode = async (value: 'all' | 'high' | 'low') => { (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)(value); await nextTick(); };
  await setMode('high');
  assert.equal(view.network()!.interestThreshold, 8);
  assert.deepEqual([...view.network()!.visibleTopicIds].sort(), ['acoustic sensing', 'acoustics', 'robotics']);
  assert.match(nodeText(view.byClass('insights-job-list')!), /High acoustics/u);
  assert.doesNotMatch(nodeText(view.byClass('insights-job-list')!), /Medium|Low|Unknown/u);
  changeControl(view.control('Minimum interest'), 'onInput', '9'); await nextTick();
  assert.equal(view.network()!.interestThreshold, 9);
  assert.deepEqual([...view.network()!.visibleTopicIds].sort(), ['acoustic sensing', 'robotics']);
  assert.equal(nodeText(view.byClass('insights-job-list')!), 'Strong acoustic sensing High interest');
  await setMode('low');
  assert.equal(view.network()!.interestThreshold, 4);
  assert.equal(view.control('Minimum matching jobs'), undefined, 'low-interest mode replaces the minimum control');
  assert.equal(view.control('Maximum high-interest jobs'), undefined, 'the extra outlier cap is removed');
  assert.deepEqual([...view.network()!.visibleTopicIds].sort(), ['acoustic simulation', 'experiments'], 'topics seen in any above-maximum job are excluded while rare low-only topics remain');
  assert.equal(view.network()!.matchingJobCounts['acoustic simulation'], 2, 'case and underscores do not split the occurrence count');
  changeControl(view.control('Maximum interest'), 'onInput', '2'); await nextTick();
  assert.deepEqual([...view.network()!.visibleTopicIds].sort(), ['acoustic simulation', 'experiments'], 'all low choices have score 2');
  view.networkEmit('selectJob', fixtureId(12)); await nextTick();
  assert.equal(view.network()!.selectedJobId, fixtureId(12));
  const selected = view.network()!.graph.jobs.find((value: { id: string }) => value.id === fixtureId(12));
  assert.deepEqual([...selected.topicIds].sort(), ['acoustic simulation', 'robotics'], 'a filtered-out topic remains in complete selected-job evidence');
  assert.deepEqual([...selected.avoidedTopicIds], ['acoustic simulation']);
  assert.match(nodeText(view.byClass('insights-context-topics')!), /Robotics/u);
  const avoided = view.byClass('insights-context-topics')!.children.filter(item => item.tag === 'li' && nodeText(item).includes('Explicitly avoided'));
  assert.equal(avoided.length, 1);
  assert.match(nodeText(avoided[0]!), /^Acoustic simulation/u);
  const acoustic = view.network()!.graph.topics.find((value: { id: string }) => value.id === 'acoustic simulation');
  assert.equal(acoustic.lowInterestCount, 2);
  assert.equal(acoustic.avoidedCount, 1);
});

test('topic filter changes invalidate pending and prepared analyses and project the current filter into copying', async t => {
  const view = mount(t, { opportunities: [job(10, 'Acoustic research', ['Acoustics'], 10), job(11, 'Acoustic robotics', ['Acoustics', 'Robotics'], 8)],
    reviews: [jobReview(10, 9), jobReview(11, 9)] }), pending = deferred<OpportunityInsightsAnalysis>();
  await view.showBody('Clusters');
  await view.showTopicClusters();
  (view.control('Minimum matching jobs')!.props['onUpdate:modelValue'] as (value: number) => void)(1); await nextTick();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('all'); await nextTick();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('high'); await nextTick();
  assert.equal(view.calls[0]!.signal?.aborted, true, 'a topic filter change cancels analysis preparation');
  pending.resolve(safePrompt); await copying; await nextTick();
  assert.deepEqual(view.publications, []);
  assert.equal(view.editor.preparedText, '');
  view.handlers.build = async () => safePrompt;
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.calls.at(-1)!.topicFilter, { mode: 'high', interestThreshold: 8, minimumJobCount: 1 });
  changeControl(view.control('Minimum interest'), 'onInput', '9'); await nextTick();
  assert.equal(view.editor.preparedText, '');
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls.at(-1)!.topicFilter!.interestThreshold, 9);
  (view.control('Minimum matching jobs')!.props['onUpdate:modelValue'] as (value: number) => void)(2); await nextTick();
  assert.equal(view.editor.preparedText, '');
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.calls.at(-1)!.topicFilter, { mode: 'high', interestThreshold: 9, minimumJobCount: 2 });
  assert.deepEqual([...view.network()!.visibleTopicIds], ['acoustics']);
});

test('matching-job maximum follows interest and date cohorts and clamps copied filters to available topics', async t => {
  const view = mount(t, { opportunities: [
    job(10, 'First acoustic research', ['Acoustics', 'Robotics'], 20),
    job(11, 'Second acoustic research', ['ACOUSTICS'], 15),
    job(12, 'Third acoustic research', ['Acoustics'], 8),
    job(13, 'Medium acoustic research', ['acoustics'], 4),
    job(14, 'Unrated acoustic research', ['Acoustics'], 2),
  ], reviews: [jobReview(10, 9), jobReview(11, 9), jobReview(12, 8), jobReview(13, 6)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  const minimum = () => view.control('Minimum matching jobs')!;
  const setMinimum = async (value: number) => { (minimum().props['onUpdate:modelValue'] as (value: number) => void)(value); await nextTick(); };
  const setMode = async (value: 'all' | 'high') => { (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)(value); await nextTick(); };
  assert.equal(minimum().props.max, 3, 'only jobs meeting the current minimum interest define the maximum');
  await setMinimum(3);
  assert.deepEqual([...view.network()!.visibleTopicIds], ['acoustics']);
  await view.editor.copyAnalysis(); await nextTick();
  changeControl(view.control('Minimum interest'), 'onInput', '9'); await nextTick();
  assert.equal(minimum().props.max, 2, 'the maximum is computed before applying the selected matching-job minimum');
  assert.equal(minimum().props.value, 2, 'raising interest clamps an unavailable count without hiding every topic');
  assert.deepEqual(view.network()!.matchingJobCounts, { acoustics: 2 });
  assert.equal(view.editor.preparedText, '', 'cohort changes invalidate the prepared analysis');
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.calls.at(-1)!.topicFilter, { mode: 'high', interestThreshold: 9, minimumJobCount: 2 });
  await setMode('all');
  assert.equal(minimum().props.max, 5, 'All topics includes lower and unknown interest');
  await setMinimum(5);
  view.timelineEmit('update:range', { start: localDay(10), end: localDay() }); await nextTick();
  assert.equal(minimum().props.max, 3, 'the selected Added-date window bounds matching counts');
  assert.equal(minimum().props.value, 3);
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.calls.at(-1)!.topicFilter, { mode: 'all', interestThreshold: 9, minimumJobCount: 3 });
  await setMode('high');
  assert.equal(minimum().props.max, 1, 'an empty cohort retains valid native range bounds');
  assert.equal(minimum().props.value, 1);
  assert.equal(minimum().props.disabled, true);
  assert.deepEqual([...view.network()!.visibleTopicIds], []);
});

test('changing account resets body, date selection and topic filters without retaining owner feedback', async t => {
  const view = mount(t);
  await view.showBody('Clusters');
  await view.showTopicClusters();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('low'); await nextTick();
  changeControl(view.control('Maximum interest'), 'onInput', '2'); await nextTick();
  view.timelineEmit('update:range', { start: localDay(25), end: localDay(5) }); await nextTick();
  view.props.ownerId = fixtureId(99); await nextTick();
  assert.equal(view.bodyTabs()[0]!.props['aria-selected'], true);
  assert(view.chart());
  assert.equal(view.network(), null);
  assert.equal(view.timeline().rangeStart, null);
  assert.equal(view.timeline().rangeEnd, null);
  assert.deepEqual([...view.chart()!.selectedTopicIds], []);
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs', 'account changes restore the job explorer');
  await view.showTopicClusters();
  assert.equal(view.network()!.ownerId, fixtureId(99));
  assert.equal(view.network()!.interestMode, 'high');
  assert.equal(view.network()!.interestThreshold, 8);
  assert.equal(view.control('Minimum matching jobs')!.props.value, 1);
  assert(view.network()!.graph.jobs.every((value: { explicitInterest: boolean }) => !value.explicitInterest));
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.calls.at(-1)!.topicFilter, { mode: 'high', interestThreshold: 8, minimumJobCount: 1 });
});

test('owner and feedback replacements cancel pending prompt publication when its sources change', async t => {
  for (const switchSource of ['owner', 'reviews'] as const) {
    const view = mount(t), pending = deferred<OpportunityInsightsAnalysis>();
    view.handlers.build = () => pending.promise;
    const copying = view.editor.copyAnalysis();
    assert.equal(view.editor.copying, true);
    if (switchSource === 'owner') view.props.ownerId = '92000000-0000-4000-8000-000000000099';
    else view.props.reviews = [{ ...view.props.reviews[0]!, feedback_excluded: true }];
    await nextTick();
    assert.equal(view.calls[0]!.signal?.aborted, true, 'replacing account evidence cancels analysis preparation');
    pending.resolve(safePrompt); await copying; await nextTick();
    assert.deepEqual(view.publications, []);
    assert.equal(view.editor.preparedText, '');
    assert.equal(view.editor.copyFailed, false);
    assert.equal(view.editor.copying, false);
    assert.equal(useToasts().toasts.value.length, 0);
    assert.equal(view.prompt(), undefined);
    view.close();
  }
});

test('in-place feedback exclusions and ratings cancel a pending analysis publication', async t => {
  for (const field of ['feedback_excluded', 'interest_rating'] as const) {
    const view = mount(t), pending = deferred<OpportunityInsightsAnalysis>();
    view.handlers.build = () => pending.promise;
    const copying = view.editor.copyAnalysis();
    assert.equal(view.editor.copying, true);
    const reviews = view.props.reviews;
    if (field === 'feedback_excluded') view.props.reviews[0]!.feedback_excluded = true;
    else view.props.reviews[0]!.interest_rating = 9;
    await nextTick();
    assert.equal(view.props.reviews, reviews, 'the feedback array was mutated without replacement');
    assert.equal(view.calls[0]!.signal?.aborted, true, 'in-place exclusions and ratings cancel analysis preparation');
    pending.resolve(safePrompt); await copying; await nextTick();
    assert.equal(view.calls.length, 1);
    assert.deepEqual(view.publications, []);
    assert.equal(view.editor.preparedText, '');
    assert.equal(view.editor.copyFailed, false);
    assert.equal(view.editor.copying, false);
    assert.equal(view.prompt(), undefined);
    assert.equal(useToasts().toasts.value.length, 0);
    view.close();
  }
});

test('an in-place exclusion clears failed-copy evidence and disables its captured retry action', async t => {
  const view = mount(t); view.handlers.copied = false;
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.editor.preparedText, safePrompt.text);
  assert.equal(view.editor.copyFailed, true);
  const retry = useToasts().toasts.value[0]!.action!;
  const review = view.props.reviews[0]!;
  review.feedback_excluded = true;
  await nextTick();
  assert.equal(view.props.reviews[0], review, 'the same review object changed in place');
  assert.equal(view.editor.preparedText, '');
  assert.equal(view.editor.copyFailed, false);
  assert.equal(view.prompt(), undefined);
  assert.equal(useToasts().toasts.value.length, 0);
  view.handlers.copied = true;
  await retry.run(); await nextTick();
  assert.equal(view.calls.length, 1);
  assert.equal(view.handlers.clipboardCalls, 1);
  assert.deepEqual(view.publications, []);
  assert.equal(useToasts().toasts.value.length, 0);
});

test('live catalogue additions refresh the analysis clock in All history and a range ending today', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-30T12:00:00Z') });
  for (const scope of ['all', 'today'] as const) {
    const view = mount(t);
    if (scope === 'today') {
      view.timelineEmit('update:range', { start: localDay(1), end: localDay() });
      await nextTick();
    }
    await view.showBody('Clusters');
    const mountedClock = Date.parse(view.timeline().domainEnd);
    t.mock.timers.tick(60_000);
    const addition = job(20, 'Live catalogue addition', ['Acoustics'], 0);
    addition.created_at = new Date().toISOString();
    view.props.opportunities.push(addition);
    view.props.reviews.push(jobReview(20, 9));
    await nextTick();
    assert.equal(view.timeline().domainEnd, addition.created_at);
    assert(Date.parse(view.timeline().domainEnd) > mountedClock);
    assert(view.network()!.graph.jobs.some((item: { id: string }) => item.id === addition.id), 'a newly added job must not be treated as future-dated by the mount clock');
    await view.editor.copyAnalysis(); await nextTick();
    const selected = buildOpportunityInsights(view.calls[0]!);
    assert.equal(selected.window.futureCount, 0);
    assert.equal(selected.summary.highInterestCount, 1);
    if (scope === 'today') assert.equal(view.calls[0]!.rangeEnd, addition.created_at, 'today’s inclusive endpoint advances with the live addition');
    view.close();
  }
});

test('either shared-brush endpoint invalidates pending copies and independently scopes the next copy', async t => {
  for (const bound of ['start', 'end'] as const) {
    const view = mount(t), pending = deferred<OpportunityInsightsAnalysis>();
    const retained = { start: localDay(25), end: localDay(5) };
    view.timelineEmit('update:range', retained); await nextTick();
    const selected = { ...retained, [bound]: localDay(bound === 'start' ? 22 : 3) };
    view.handlers.build = () => pending.promise;
    const copying = view.editor.copyAnalysis();
    view.timelineEmit('update:range', selected); await nextTick();
    assert.equal(view.calls[0]!.signal?.aborted, true, 'either committed date endpoint cancels analysis preparation');
    pending.resolve(safePrompt); await copying; await nextTick();
    assert.deepEqual(view.publications, []);
    assert.equal(view.editor.preparedText, '');
    assert.equal(view.editor.copying, false);
    assert.equal(view.timeline().rangeStart, selected.start);
    assert.equal(view.timeline().rangeEnd, selected.end);
    assert.equal(view.dateInput('start'), undefined);
    assert.equal(view.dateInput('end'), undefined);
    view.handlers.build = async () => safePrompt;
    await view.editor.copyAnalysis(); await nextTick();
    assert.equal(view.calls.length, 2);
    assert.equal(view.calls[1]!.rangeStart, startOfDay(selected.start));
    assert.equal(view.calls[1]!.rangeEnd, endOfDay(selected.end));
    assert.equal(view.publications.length, 1);
    view.close();
  }
});

test('the footer brush shares both calendar bounds with the active chart and clears prepared copies', async t => {
  const view = mount(t);
  await view.editor.copyAnalysis(); await nextTick();
  const selected = { start: localDay(25), end: localDay(5) };
  view.timelineEmit('update:range', selected); await nextTick();
  assert.equal(view.timeline().rangeStart, selected.start);
  assert.equal(view.timeline().rangeEnd, selected.end);
  assert.equal(view.chart()!.timeline.start, startOfDay(selected.start));
  assert.equal(view.chart()!.timeline.end, endOfDay(selected.end));
  assert.equal(view.editor.preparedText, '');
  assert.equal(view.prompt(), undefined);
  assert.equal(useToasts().toasts.value.length, 0);
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls[1]!.rangeStart, startOfDay(selected.start));
  assert.equal(view.calls[1]!.rangeEnd, endOfDay(selected.end));
  view.timelineEmit('update:range', null); await nextTick();
  assert.equal(view.timeline().rangeStart, null);
  assert.equal(view.timeline().rangeEnd, null);
  assert.notEqual(view.chart()!.timeline.start, null);
  assert.equal(view.editor.preparedText, '');
});

test('a single-day brush is valid while malformed, crossed, and future ranges preserve the previous view', async t => {
  const view = mount(t), retained = { start: localDay(5), end: localDay(5) };
  view.timelineEmit('update:range', retained); await nextTick();
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls[0]!.rangeStart, startOfDay(retained.start));
  assert.equal(view.calls[0]!.rangeEnd, endOfDay(retained.end));
  for (const invalid of [
    { start: '2026-02-30', end: retained.end },
    { start: retained.start, end: localDay(-1) },
    { start: localDay(2), end: localDay(10) },
  ]) {
    view.timelineEmit('update:range', invalid); await nextTick();
    assert.equal(view.timeline().rangeStart, retained.start);
    assert.equal(view.timeline().rangeEnd, retained.end);
    assert.equal(view.editor.preparedText, safePrompt.text);
  }
});

test('a lower-calendar brush date in Europe/Berlin cannot replace a supported range or pending analysis', async t => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
  assert.match(new Date('0001-01-01T00:00:00').toISOString(), /^0000-12-31T/u);
  const view = mount(t), retained = { start: localDay(25), end: localDay(5) };
  view.timelineEmit('update:range', retained); await nextTick();
  await view.showBody('Clusters');
  const originalJobs = view.network()!.graph.jobs.map((item: { id: string }) => item.id);
  const pending = deferred<OpportunityInsightsAnalysis>();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  assert.doesNotThrow(() => view.timelineEmit('update:range', { start: '0001-01-01', end: retained.end }));
  await nextTick();
  assert.equal(view.timeline().rangeStart, retained.start);
  assert.equal(view.timeline().rangeEnd, retained.end);
  assert.deepEqual(view.network()!.graph.jobs.map((item: { id: string }) => item.id), originalJobs);
  pending.resolve(safePrompt); await copying; await nextTick();
  assert.deepEqual(view.publications, [safePrompt.text]);
  assert.equal(view.calls[0]!.rangeStart, startOfDay(retained.start));
  assert.equal(view.calls[0]!.rangeEnd, endOfDay(retained.end));
  assert.doesNotThrow(() => buildOpportunityInsights(view.calls[0]!));
});

test('addition dates retain categorical interest in a historical interval without using the review clock', async t => {
  const view = mount(t);
  const secondId = '92000000-0000-4000-8000-000000000004';
  const legacyId = '92000000-0000-4000-8000-000000000005';
  view.props.opportunities = [view.props.opportunities[0]!, opportunityFixture({ id: secondId,
    created_at: startOfDay(localDay(15)), personal_fit: opportunityAssessmentFixture(8.8) }), opportunityFixture({ id: legacyId,
    created_at: null, personal_fit: opportunityAssessmentFixture(9) })];
  view.props.reviews = [view.props.reviews[0]!, { ...view.props.reviews[0]!, opportunity_id: secondId,
    feedback_updated_at: null, state: 'very_high_interest', interest_rating: 9 }, { ...view.props.reviews[0]!, opportunity_id: legacyId,
    feedback_updated_at: null, state: 'very_high_interest', interest_rating: 10 }];
  await nextTick();
  view.timelineEmit('update:range', { start: localDay(18), end: localDay(10) });
  await nextTick();
  await view.editor.copyAnalysis(); await nextTick();
  const selected = buildOpportunityInsights(view.calls[0]!);
  assert.equal(selected.summary.scoredCount, 1);
  assert.equal(selected.alignment.current.pairedCount, 1);
  assert.equal(selected.alignment.current.highFitHitRate, 1);
  assert.equal(selected.alignment.current.meanAbsoluteGap, .2);
  assert.equal(selected.alignment.current.spearman, null, 'small samples do not manufacture rank agreement');
  assert.equal(selected.window.undatedCount, 1);
  assert.equal(selected.window.timeBasis, 'catalogue_added_at');
  assert.equal(view.chart()!.timeline.buckets.reduce((count: number, bucket: { addedCount: number }) => count + bucket.addedCount, 0), 1);
  await view.showBody('Clusters');
  assert.equal(view.network()!.graph.jobs.length, 1);
  assert.equal(view.network()!.graph.jobs[0]!.id, secondId);
  assert.equal(view.timeline().overview.buckets.reduce((count: number, bucket: { addedCount: number }) => count + bucket.addedCount, 0), 2, 'undated jobs remain outside dated overview volume');
  await view.showBody('Trends');
  assert.equal(view.byClass('insights-details'), undefined, 'Development does not duplicate detailed alignment statistics');
  assert.equal(view.chart()!.timeline.buckets[0].alignment.spearman, null, 'the timeline retains unavailable values as gaps');
});

test('timeline selection filters chart, network and job records together and cancels a pending copy', async t => {
  const view = mount(t, { opportunities: [job(10, 'Earlier cohort', ['Acoustics'], 30), job(11, 'Selected cohort', ['Acoustics'], 10), job(12, 'Later cohort', ['Acoustics'], 2)],
    reviews: [jobReview(10, 9), jobReview(11, 9), jobReview(12, 9)] });
  const pending = deferred<OpportunityInsightsAnalysis>();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  view.timelineEmit('update:range', { start: localDay(15), end: localDay(5) }); await nextTick();
  assert.equal(view.calls[0]!.signal?.aborted, true, 'the committed range cancels analysis preparation');
  pending.resolve(safePrompt); await copying; await nextTick();
  assert.deepEqual(view.publications, []);
  assert.equal(view.editor.preparedText, '');
  assert.equal(view.chart()!.timeline.buckets.reduce((sum: number, bucket: { addedCount: number }) => sum + bucket.addedCount, 0), 1);
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.deepEqual(view.network()!.graph.jobs.map((item: { id: string }) => item.id), [fixtureId(11)]);
  assert.equal(nodeText(view.byClass('insights-job-list')!), 'Selected cohort High interest');
  view.handlers.build = async () => safePrompt;
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls[1]!.rangeStart, startOfDay(localDay(15)));
  assert.equal(view.calls[1]!.rangeEnd, endOfDay(localDay(5)));
  await view.showBody('Trends');
  view.chartEmit('update:aggregation', 'month'); await nextTick();
  assert.equal(view.editor.preparedText, '');
  assert.equal(view.chart()!.aggregation, 'month');
  assert.equal(view.chart()!.timeline.aggregation, 'month');
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls[2]!.aggregation, 'month');
});

test('active brushing pauses network layout and blocks copying until the interaction finishes', async t => {
  const view = mount(t);
  await view.showBody('Clusters');
  view.timelineEmit('brush-active', true); await nextTick();
  assert.equal(view.copyButton().props.disabled, true);
  assert.equal(view.network()!.layoutPaused, true);
  await view.editor.copyAnalysis();
  assert.equal(view.calls.length, 0);
  view.timelineEmit('brush-active', false); await nextTick();
  assert.equal(view.copyButton().props.disabled, false);
  assert.equal(view.network()!.layoutPaused, false);
  await view.editor.copyAnalysis();
  assert.equal(view.calls.length, 1);
});

test('starting an uncommitted brush gesture clears prepared and pending copies immediately', async t => {
  const view = mount(t);
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.editor.preparedText, safePrompt.text);
  const pending = deferred<OpportunityInsightsAnalysis>();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  const overview = view.timeline().overview;
  view.timelineEmit('brush-active', true); await nextTick();
  assert.equal(view.editor.preparedText, '');
  assert.equal(view.copyButton().props.disabled, true);
  assert.equal(view.timeline().rangeStart, null, 'a preview has not committed a cohort yet');
  assert.equal(view.timeline().overview, overview);
  assert.equal(view.calls[1]!.signal?.aborted, true, 'the active gesture cancels analysis preparation before a range is committed');
  view.timelineEmit('brush-active', false); pending.resolve(safePrompt); await copying; await nextTick();
  assert.deepEqual(view.publications, [safePrompt.text], 'the old pending operation cannot publish after gesture cancellation');
  assert.equal(view.editor.preparedText, '');
});

test('committed range changes reuse prepared evidence and the all-history overview without advancing the analysis clock', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-30T12:00:00Z') });
  const view = mount(t, { opportunities: [job(10, 'Older acoustic job', ['Acoustics'], 20), job(11, 'Recent job', ['Robotics'], 10)],
    reviews: [jobReview(10, 9), jobReview(11, 8)] });
  const overview = view.timeline().overview, clock = view.timeline().domainEnd, preparations = view.preparations();
  for (const selection of [{ start: localDay(25), end: localDay(15) }, { start: localDay(15), end: localDay(5) }]) {
    t.mock.timers.tick(30_000);
    view.timelineEmit('update:range', selection); await nextTick();
    assert.equal(view.timeline().overview, overview, 'range changes do not rebuild the full-history brush dataset');
    assert.equal(view.timeline().domainEnd, clock);
    assert.equal(view.preparations(), preparations, 'safe labels and feedback are prepared once per source snapshot');
  }
  view.props.reviews[0]!.state = 'not_interested'; await nextTick();
  assert(view.preparations() > preparations, 'changing evidence creates a new prepared owner snapshot');
  assert.notEqual(view.timeline().domainEnd, clock);
});

test('fixed development controls preserve their view and topic trends recover a selected-cohort fallback after filters clear graph selection', async t => {
  const view = mount(t, { opportunities: [job(10, 'Current acoustic interest', ['Acoustics'], 20), job(11, 'Rare low topic', ['Theory'], 10), job(12, 'Older robotics', ['Robotics'], 40)],
    reviews: [jobReview(10, 9), jobReview(11, 2), jobReview(12, 8)] });
  const fixed = view.byClass('insights-development-tabs')!;
  assert(fixed);
  assert.notEqual(fixed.parent, view.byClass('insights-body'), 'the second tab row sits outside the scrolling body');
  view.controlsEmit('update:view', 'topics'); await nextTick();
  assert.equal(view.chart()!.view, 'topics');
  await view.showBody('Clusters');
  await view.showTopicClusters();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('low'); await nextTick();
  assert.deepEqual([...view.network()!.selectedTopicIds], []);
  view.timelineEmit('update:range', { start: localDay(25), end: localDay(15) }); await nextTick();
  await view.showBody('Trends');
  assert.equal(view.controls()!.view, 'topics');
  assert.equal(view.chart()!.view, 'topics');
  assert.deepEqual([...view.chart()!.selectedTopicIds], ['acoustics']);
  assert.equal(view.chart()!.topics[0]!.label, 'Acoustics');
  const footer = view.byClass('insights-time-window')!;
  assert.equal(descendants(footer).filter(item => item.tag === 'button').length, 0, 'the footer contains only the shared brush');
});

test('interest distribution is visible in high-interest clusters outside detailed statistics', async t => {
  const view = mount(t);
  assert.doesNotMatch(view.renderedText(), /Interest distribution|What drives your feedback|Detailed statistics/u);
  await view.showBody('Interest patterns');
  assert.match(view.renderedText(), /Interest distribution/u);
  assert.match(view.renderedText(), /What drives your feedback/u);
  assert.match(view.renderedText(), /Where your high interest clusters/u);
  assert(view.byClass('insights-bars'));
  assert.equal(view.byClass('insights-details'), undefined);
  assert.equal(view.chart(), undefined);
  assert.equal(view.network(), null);
});

test('initial top-five topics and network selections synchronize trend topics and matching jobs', async t => {
  const view = mount(t, { opportunities: [job(10, 'Complete topic job', ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'], 20), job(11, 'Alpha-only job', ['Alpha'], 10)],
    reviews: [jobReview(10, 9), jobReview(11, 8)] });
  await nextTick();
  const initialTopics = [...view.chart()!.selectedTopicIds];
  assert.deepEqual(initialTopics, ['alpha', 'beta', 'delta', 'epsilon', 'gamma']);
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.deepEqual([...view.network()!.selectedTopicIds], initialTopics);
  const clear = view.button('Clear selection')!;
  assert(clear);
  (clear.props.onClick as () => void)(); await nextTick();
  (view.control('Minimum matching jobs')!.props['onUpdate:modelValue'] as (value: number) => void)(1); await nextTick();
  view.networkEmit('selectTopic', 'zeta'); await nextTick();
  assert.deepEqual([...view.network()!.selectedTopicIds], ['zeta']);
  assert.equal(nodeText(view.byClass('insights-job-list')!), 'Complete topic job High interest');
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  await view.showBody('Trends');
  assert.deepEqual([...view.chart()!.selectedTopicIds], ['zeta']);
  assert.equal(view.chart()!.selectedJob.id, fixtureId(10));
});

test('job clusters replace misalignment context with all high-interest jobs and complete selected evidence', async t => {
  const view = mount(t, { opportunities: [job(10, 'Low-interest mismatch', ['Acoustics', 'Theory', 'Simulation'], 20),
    job(11, 'High-interest prototypes', ['Acoustics', 'Prototypes'], 15), job(12, 'High-interest experiments', ['Theory', 'Experiments'], 12),
    job(13, 'Isolated high-interest job', ['Unrelated'], 10)],
    reviews: [jobReview(10, 2), jobReview(11, 9, [{ category: 'topic', polarity: 'negative', target: 'Prototypes' }]), jobReview(12, 8), jobReview(13, 9)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('low'); await nextTick();
  const switchView = view.button('Job clusters')!;
  assert(switchView);
  (switchView.props.onClick as () => void)(); await nextTick();
  assert.equal(view.network()!.viewMode, 'jobs');
  assert.equal(view.network()!.selectedJobId, null, 'switching does not auto-select a mismatch');
  assert.equal(view.control('Interest'), undefined, 'topic filters do not constrain the job cohort');
  assert.equal(view.byClass('insights-topic-list'), undefined);
  const jobList = view.byClass('insights-job-list is-job-explorer')!;
  assert.equal(jobList.children.filter(item => item.tag === 'li').length, 3);
  assert.match(nodeText(jobList), /Isolated high-interest job/u);
  assert.match(nodeText(jobList), /High-interest prototypes/u);
  assert.match(nodeText(jobList), /High-interest experiments/u);
  assert.doesNotMatch(nodeText(jobList), /Low-interest mismatch/u);
  view.networkEmit('selectJob', fixtureId(11)); await nextTick();
  assert.equal(view.network()!.selectedJobId, fixtureId(11));
  const bundle = view.byClass('insights-context-topics')!;
  assert.equal(bundle.children.filter(item => item.tag === 'li').length, 2);
  assert.match(nodeText(bundle), /Acoustics/u);
  assert.match(nodeText(bundle), /Prototypes Explicitly avoided/u);
  assert.doesNotMatch(view.renderedText(), /Misalignment context|Misaligned jobs|Closest high-interest jobs/u);
  await view.showBody('Trends');
  assert.equal(view.chart()!.selectedJob.id, fixtureId(11), 'job selection still links its Added date to the timeline');
  assert.doesNotMatch(view.renderedText(), /What drives your feedback|Detailed statistics|Current score alignment/u);
});

test('selected jobs open their opportunity from topic and job views without opening unselected records', async t => {
  const view = mount(t, { opportunities: [job(10, 'Acoustic research', ['Acoustics'], 20), job(11, 'Robot research', ['Robotics'], 10)],
    reviews: [jobReview(10, 9), jobReview(11, 8)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.equal(view.button('Open opportunity'), undefined);
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  const topicAction = view.button('Open opportunity')!;
  assert(topicAction); assert.equal(topicAction.props.type, 'button');
  (topicAction.props.onClick as () => void)();
  assert.deepEqual(view.openedOpportunities, [fixtureId(10)]);
  assert.equal(view.network()!.selectedJobId, fixtureId(10), 'navigation is delegated without changing feedback or selection');
  (view.button('Job clusters')!.props.onClick as () => void)(); await nextTick();
  const jobList = view.byClass('insights-job-list is-job-explorer')!;
  assert.equal(jobList.children.filter(item => item.tag === 'li').length, 2);
  assert.match(nodeText(jobList), /Acoustic research.*Robot research/u);
  assert.equal(view.button('Open opportunity'), undefined, 'changing cluster mode clears the selected record');
  view.networkEmit('selectJob', fixtureId(11)); await nextTick();
  (view.button('Open opportunity')!.props.onClick as () => void)();
  assert.deepEqual(view.openedOpportunities, [fixtureId(10), fixtureId(11)]);
  view.props.ownerId = fixtureId(99); await nextTick();
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.equal(view.button('Open opportunity'), undefined, 'account changes cannot expose the prior account action');
});

test('renderer fallback keeps topic and job lists usable and restores the standard layout after recovery', async t => {
  const view = mount(t, { opportunities: [job(10, 'Acoustic prototype job', ['Acoustics', 'Prototypes'], 20), job(11, 'Robotics job', ['Robotics'], 10)],
    reviews: [jobReview(10, 9), jobReview(11, 8)] });
  await nextTick();
  await view.showBody('Clusters');
  await view.showTopicClusters();
  view.networkEmit('availability', false); await nextTick();
  assert(view.byClass('insights-network-layout is-fallback'));
  assert(view.byClass('insights-topic-list'));
  assert(view.byClass('insights-job-list'));
  (view.button('Clear selection')!.props.onClick as () => void)(); await nextTick();
  const acousticTopic = descendants(view.byClass('insights-topic-list')!).find(item => item.tag === 'button' && /^Acoustics /u.test(nodeText(item)))!;
  assert(acousticTopic, 'the fallback exposes a real topic button');
  (acousticTopic.props.onClick as () => void)(); await nextTick();
  assert.deepEqual([...view.network()!.selectedTopicIds], ['acoustics']);
  const jobs = view.byClass('insights-job-list')!;
  assert.equal(nodeText(jobs), 'Acoustic prototype job High interest');
  const jobButton = descendants(jobs).find(item => item.tag === 'button')!;
  (jobButton.props.onClick as () => void)(); await nextTick();
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  assert.match(nodeText(view.byClass('insights-context-topics')!), /Acoustics/u);
  assert.match(nodeText(view.byClass('insights-context-topics')!), /Prototypes/u);
  view.networkEmit('availability', true); await nextTick();
  assert(view.byClass('insights-network-layout'));
  assert.equal(view.byClass('insights-network-layout is-fallback'), undefined);
  assert.equal(view.network()!.selectedJobId, fixtureId(10), 'renderer recovery preserves inspection context');
});

test('clipboard failure keeps the readonly prepared prompt open and offers a fresh-click retry', async t => {
  const view = mount(t); view.handlers.copied = false;
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.publications, []);
  assert.match(view.editor.preparedText, /^SAFE SYNTHETIC ANALYSIS/u);
  assert.equal(view.editor.copyFailed, true);
  assert.equal(view.prompt()!.props.value, view.editor.preparedText);
  assert.equal(view.prompt()!.props.readonly, true);
  assert.equal(view.promptDisclosure()!.props.open, true);
  const retry = useToasts().toasts.value[0]!.action!;
  assert.equal(retry.label, 'Retry copy');
  view.handlers.copied = true;
  await retry.run(); await nextTick();
  assert.equal(view.calls.length, 2);
  assert.equal(view.publications.length, 1);
  assert.equal(view.editor.copyFailed, false);
  assert.equal(useToasts().toasts.value[0]?.tone, 'success');
});

test('unmount dismisses recovery actions and an already-captured retry cannot copy a closed record', async t => {
  const view = mount(t); view.handlers.copied = false;
  await view.editor.copyAnalysis(); await nextTick();
  const retry = useToasts().toasts.value[0]!.action!;
  view.close();
  assert.equal(useToasts().toasts.value.length, 0);
  view.handlers.copied = true;
  await retry.run(); await nextTick();
  assert.equal(view.calls.length, 1);
  assert.equal(view.handlers.clipboardCalls, 1);
  assert.deepEqual(view.publications, []);
});

test('a retry captured before an owner or feedback switch cannot act on the replacement scope', async t => {
  for (const switchSource of ['owner', 'reviews'] as const) {
    const view = mount(t); view.handlers.copied = false;
    await view.editor.copyAnalysis(); await nextTick();
    const retry = useToasts().toasts.value[0]!.action!;
    if (switchSource === 'owner') view.props.ownerId = '92000000-0000-4000-8000-000000000099';
    else view.props.reviews = [{ ...view.props.reviews[0]!, feedback_excluded: true }];
    await nextTick();
    assert.equal(useToasts().toasts.value.length, 0);
    view.handlers.copied = true;
    await retry.run(); await nextTick();
    assert.equal(view.calls.length, 1);
    assert.equal(view.handlers.clipboardCalls, 1);
    assert.deepEqual(view.publications, []);
    view.close();
  }
});

test('unmount during prompt preparation cannot publish or announce a completed copy', async t => {
  const view = mount(t), pending = deferred<OpportunityInsightsAnalysis>();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  view.close();
  assert.equal(view.calls[0]!.signal?.aborted, true, 'unmount cancels analysis preparation');
  pending.resolve(safePrompt); await copying;
  assert.deepEqual(view.publications, []);
  assert.equal(useToasts().toasts.value.length, 0);
  assert.equal(view.editor.preparedText, '');
});


test('selection focus mutes unrelated topic rows without disabling them and clears on reset or owner change', async t => {
  const view = mount(t, { opportunities: [job(10, 'Acoustic control', ['Acoustics', 'Control'], 4), job(11, 'Robotics research', ['Robotics'], 3)],
    reviews: [jobReview(10, 9), jobReview(11, 6)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('all'); await nextTick();
  const clear = view.button('Clear selection');
  if (clear) (clear.props.onClick as () => void)();
  await nextTick();
  await view.editor.copyAnalysis(); await nextTick();
  view.networkEmit('focusTopics', ['acoustics', 'control']); await nextTick();
  assert.equal(view.editor.preparedText, safePrompt.text, 'presentation-only focus leaves copied analysis intact');
  const unrelated = view.button('Robotics 1 jobs')!;
  assert(unrelated);
  assert.equal(unrelated.parent?.props.class, 'is-muted');
  assert.equal(view.button('Acoustics 1 jobs')!.parent?.props.class, '');
  assert.notEqual(unrelated.props.disabled, true);
  assert.notEqual(unrelated.props['aria-hidden'], true);
  (unrelated.props.onClick as () => void)(); await nextTick();
  assert(view.network()!.selectedTopicIds.includes('robotics'), 'muted topics remain selectable');
  assert.equal(view.button('Robotics 1 jobs')!.parent?.props.class, '', 'a selected topic is emphasized immediately');
  view.networkEmit('focusTopics', null); await nextTick();
  assert.equal(view.button('Robotics 1 jobs')!.parent?.props.class, '');
  view.networkEmit('focusTopics', ['acoustics']); await nextTick();
  view.props.ownerId = '92000000-0000-4000-8000-000000000099'; await nextTick();
  await view.showBody('Clusters');
  await view.showTopicClusters();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('all'); await nextTick();
  assert.equal(view.button('Robotics 1 jobs')!.parent?.props.class, '', 'new owner does not inherit another account focus');
});


test('job minimum interest starts at 8.0, previews locally, commits both views and resets per account', async t => {
  const view = mount(t, { opportunities: [job(10, 'Low job', ['A'], 20), job(11, 'Interested job', ['B'], 15), job(12, 'Strong job', ['C'], 10)],
    reviews: [jobReview(10, 2), jobReview(11, 6), jobReview(12, 9)] });
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs');
  const slider = view.control('Minimum interest')!;
  assert(slider); assert.equal(slider.props.value, 8); assert.equal(slider.props.step, '0.5');
  assert.match(view.renderedText(), /Minimum interest\s+8\.0 \/ 10/u);
  assert.equal(view.network()!.jobMinimumInterest, 8);
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls.at(-1)!.jobClusterMinimumInterest, 8);
  view.networkEmit('selectJob', fixtureId(12)); await nextTick();
  changeControl(slider, 'onInput', '6'); await nextTick();
  assert.equal(view.network()!.jobMinimumInterest, 8, 'drag preview does not restart graph work');
  assert.equal(view.editor.preparedText, '', 'preview invalidates prior analysis immediately');
  assert.equal(view.copyButton().props.disabled, true);
  changeControl(slider, 'onChange', '6'); await nextTick();
  assert.equal(view.network()!.jobMinimumInterest, 6);
  assert.match(nodeText(view.byClass('insights-job-list is-job-explorer')!), /Interested job/u);
  assert.doesNotMatch(nodeText(view.byClass('insights-job-list is-job-explorer')!), /Low job/u);
  assert.equal(view.network()!.selectedJobId, fixtureId(12), 'an eligible selected job remains selected');
  changeControl(slider, 'onInput', '10'); changeControl(slider, 'onChange', '10'); await nextTick();
  assert.equal(view.network()!.selectedJobId, null, 'a job outside the new cohort is no longer selected');
  assert(view.button('Job clusters'));
  assert.equal(view.byClass('insights-job-list is-job-explorer')!.children.filter(item => item.tag === 'li').length, 0);
  assert.equal(view.control('Clusters')!.props.disabled, true);
  view.props.ownerId = fixtureId(99); await nextTick();
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs', 'account changes restore the default job view');
  assert.equal(view.control('Minimum interest')!.props.value, 8, 'account changes reset threshold');
});


test('updated feedback clears a selected job that leaves the job-cluster interest cohort', async t => {
  const view = mount(t, { opportunities: [job(10, 'Selected job', ['A'], 10)], reviews: [jobReview(10, 9)] });
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs');
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  view.props.reviews = [jobReview(10, 6)]; await nextTick();
  assert.equal(view.network()!.selectedJobId, null);
  assert.equal(view.byClass('insights-job-context'), undefined);
  assert(view.button('Job clusters'));
  assert.equal(view.byClass('insights-job-list is-job-explorer')!.children.filter(item => item.tag === 'li').length, 0);
  assert.equal(view.control('Clusters')!.props.disabled, true);
});

test('job cluster count commits on release, preserves jobs and selection, and scopes copied analysis', async t => {
  const ids = Array.from({ length: 12 }, (_, index) => index + 10);
  const view = mount(t, { opportunities: ids.map(id => job(id, `Cluster job ${id}`, [id % 2 ? 'Acoustics' : 'Robotics'], 10)),
    reviews: ids.map(id => jobReview(id, 9)) });
  await view.showBody('Clusters');
  assert.equal(view.network()!.viewMode, 'jobs');
  const slider = view.control('Clusters')!;
  assert.equal(slider.props.min, '1'); assert.equal(slider.props.max, 10); assert.equal(slider.props.step, '1');
  assert.equal(slider.props.value, 5); assert.equal(view.network()!.jobClusterCount, 5);
  await view.editor.copyAnalysis(); await nextTick();
  changeControl(slider, 'onInput', '3'); await nextTick();
  assert.equal(view.network()!.jobClusterCount, 5, 'preview does not recompute clustering');
  assert.equal(view.editor.preparedText, ''); assert.equal(view.copyButton().props.disabled, true);
  const copied = view.calls.length;
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls.length, copied, 'a draft cluster count cannot prepare an outdated copy');
  changeControl(slider, 'onChange', '3'); await nextTick();
  assert.equal(view.network()!.jobClusterCount, 3);
  assert.match(nodeText(view.byClass('insights-job-list is-job-explorer')!), /Cluster job 10/u);
  assert.equal(view.network()!.graph.jobs.length, 12);
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls.at(-1)!.jobClusterCount, 3);
  changeControl(slider, 'onInput', '1'); changeControl(slider, 'onChange', '1'); await nextTick();
  assert.equal(view.network()!.selectedJobId, fixtureId(10), 'changing groups preserves complete job inspection');
  await view.showBody('Trends'); await view.showBody('Clusters');
  assert.equal(view.network()!.jobClusterCount, 1, 'the chosen count survives body switches');
  view.props.ownerId = fixtureId(99); await nextTick();
  await view.showBody('Clusters');
  assert.equal(view.network()!.jobClusterCount, 5, 'account changes reset the requested count');
});


test('maximum-interest topic visibility rejects signal processing when another job rates it higher', async t => {
  const view = mount(t, { opportunities: [job(10, 'Low mixed job', ['SIGNAL_PROCESSING', 'Low-only topic'], 20), job(11, 'High job', ['Signal processing'], 10)],
    reviews: [jobReview(10, 2), jobReview(11, 8)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('high'); await nextTick();
  assert.deepEqual([...view.network()!.visibleTopicIds], ['signal processing']);
  (view.control('Interest')!.props['onUpdate:modelValue'] as (value: string) => void)('low'); await nextTick();
  changeControl(view.control('Maximum interest'), 'onInput', '2'); await nextTick();
  assert.deepEqual([...view.network()!.visibleTopicIds], ['low-only topic']);
  assert.equal(view.button('Signal processing 1 jobs'), undefined);
  assert.match(nodeText(view.byClass('insights-job-list')!), /Low mixed job/u);
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  assert.match(nodeText(view.byClass('insights-context-topics')!), /Signal processing/u, 'selected jobs still retain their complete topic evidence');
});


test('current opportunities is an optional shared explorer filter with Results disposition rules and full-cohort trends', async t => {
  const clock = new Date(), future = new Date(clock.getTime() + 86_400_000).toISOString(), past = new Date(clock.getTime() - 86_400_000).toISOString();
  const opportunities = [
    { ...job(10, 'Current shared topic', ['Acoustics'], 3), deadline: future },
    { ...job(11, 'Expired shared topic', ['Acoustics'], 3), deadline: past },
    { ...job(12, 'Archived job', ['Archived topic'], 3), deadline: future },
    { ...job(13, 'Unknown deadline', ['Acoustics'], 3), deadline: null },
    { ...job(14, 'Invalid deadline', ['Invalid deadline topic'], 3), deadline: 'not-a-date' },
    { ...job(15, 'Owner-scoped current job', ['Owner topic'], 5), deadline: future },
  ];
  const view = mount(t, { opportunities, currentTime: clock, reviews: [
    jobReview(10, 9), jobReview(11, 9), { ...jobReview(12, 9), manually_archived: true }, jobReview(13, 9), jobReview(14, 9),
    { ...jobReview(15, 9), feedback_revision: 1, manually_archived: true },
    { ...jobReview(15, 9), feedback_revision: 2, manually_archived: false },
    { ...jobReview(15, 9), user_id: fixtureId(99), feedback_revision: 99, manually_archived: true },
  ] });
  const totalAdded = () => view.chart()!.timeline.buckets.reduce((sum: number, bucket: { addedCount: number }) => sum + bucket.addedCount, 0);
  assert.equal(totalAdded(), 6);
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.equal(isChecked(view.control('Current opportunities only')!), false);
  assert.equal(view.network()!.graph.jobs.length, 6);
  assert.equal(view.control('Minimum matching jobs')!.props.max, 3);
  view.networkEmit('selectJob', fixtureId(11)); await nextTick();
  setCurrentOnly(view.control('Current opportunities only'), true); await nextTick();
  assert.equal(isChecked(view.control('Current opportunities only')!), true);
  assert.deepEqual(view.network()!.graph.jobs.map((item: { id: string }) => item.id).sort(), [10, 13, 14, 15].map(fixtureId));
  assert.equal(view.network()!.matchingJobCounts.acoustics, 2);
  assert.equal(view.control('Minimum matching jobs')!.props.max, 2);
  assert.equal(view.network()!.selectedJobId, null, 'a filtered-out selected job is cleared');
  assert.equal(view.button('Open opportunity'), undefined);
  assert.deepEqual([...view.network()!.selectedTopicIds], []);
  assert(!view.network()!.graph.topics.some((topic: { id: string }) => topic.id === 'archived topic'));
  (view.button('Job clusters')!.props.onClick as () => void)(); await nextTick();
  assert.equal(isChecked(view.control('Current opportunities only')!), true, 'the filter is shared with job clusters');
  assert.equal(view.network()!.graph.jobs.length, 4);
  assert.equal(view.byClass('insights-job-list is-job-explorer')!.children.filter(item => item.tag === 'li').length, 4);
  assert.equal(view.network()!.jobClusterCount, 4, 'the selected cluster count respects the filtered cohort');
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  view.props.reviews[0]!.manually_archived = true; await nextTick();
  assert.equal(view.network()!.selectedJobId, null, 'live archiving removes selected explorer evidence');
  assert.equal(view.network()!.graph.jobs.length, 3);
  await view.showBody('Trends');
  assert.equal(totalAdded(), 6, 'a view-only filter does not change the full addition timeline');
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.equal(isChecked(view.control('Current opportunities only')!), true);
  view.timelineEmit('update:range', { start: localDay(3), end: localDay(3) }); await nextTick();
  assert.deepEqual(view.network()!.graph.jobs.map((item: { id: string }) => item.id).sort(), [13, 14].map(fixtureId), 'current status and Added-date cohorts both constrain the explorer');
  view.timelineEmit('update:range', null); await nextTick();
  setCurrentOnly(view.control('Current opportunities only'), false); await nextTick();
  assert.equal(view.network()!.graph.jobs.length, 6, 'unchecking restores past opportunities without changing dispositions');
  setCurrentOnly(view.control('Current opportunities only'), true); await nextTick();
  view.props.ownerId = fixtureId(99); await nextTick();
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.equal(isChecked(view.control('Current opportunities only')!), false, 'an account switch resets the optional filter');
});

test('current-only changes invalidate copies and the live Results clock expires jobs without changing addition cohorts', async t => {
  const clock = new Date(), deadline = new Date(clock.getTime() + 60_000);
  const view = mount(t, { currentTime: clock, opportunities: [{ ...job(10, 'Expiring acoustic job', ['Acoustics'], 1), deadline: deadline.toISOString() }],
    reviews: [jobReview(10, 9)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  const pending = deferred<OpportunityInsightsAnalysis>();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  setCurrentOnly(view.control('Current opportunities only'), true); await nextTick();
  assert.equal(view.calls[0]!.signal?.aborted, true, 'changing current membership cancels analysis preparation');
  pending.resolve(safePrompt); await copying; await nextTick();
  assert.deepEqual(view.publications, [], 'enabling current-only cancels an older prepared copy');
  view.handlers.build = async () => safePrompt;
  await view.editor.copyAnalysis(); await nextTick();
  assert.equal(view.calls.at(-1)!.explorerCurrentOnly, true);
  assert.equal(view.calls.at(-1)!.explorerCurrentAt, clock.toISOString());
  assert.equal(view.calls.at(-1)!.opportunities.length, 1, 'copy receives the full cohort plus an explicit view filter');
  assert.equal(view.network()!.graph.jobs.length, 1);
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  const preparedBeforeClockTick = view.preparations();
  view.props.currentTime = deadline; await nextTick();
  assert.equal(view.network()!.graph.jobs.length, 1, 'the exact deadline remains current');
  assert.equal(view.editor.preparedText, safePrompt.text, 'a clock tick without status changes keeps the prepared copy');
  assert.equal(view.preparations(), preparedBeforeClockTick, 'unchanged current membership reuses the prepared evidence');
  view.props.currentTime = new Date(deadline.getTime() + 1); await nextTick();
  assert.equal(view.network()!.graph.jobs.length, 0);
  assert.equal(view.network()!.selectedJobId, null);
  assert.equal(view.editor.preparedText, '', 'a deadline crossing invalidates a prepared current-only packet');
  assert.equal(view.control('Minimum matching jobs')!.props.disabled, true);
  await view.showBody('Trends');
  assert.equal(view.chart()!.timeline.buckets.reduce((sum: number, bucket: { addedCount: number }) => sum + bucket.addedCount, 0), 1);
});

test('job topic exclusions are subtractive view controls that keep jobs and complete topic context', async t => {
  const view = mount(t, { opportunities: [job(10, 'Acoustic job', ['Research', 'Acoustics'], 20), job(11, 'Robotics job', ['Research', 'Robotics'], 10)],
    reviews: [jobReview(10, 9), jobReview(11, 8)] });
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.equal(view.byClass('insights-excluded-topic-list'), undefined);
  (view.button('Job clusters')!.props.onClick as () => void)(); await nextTick();
  assert.equal(view.byClass('insights-job-list is-job-explorer')!.children.filter(item => item.tag === 'li').length, 2);
  const checkbox = () => descendants(view.byClass('insights-excluded-topic-list')!).find(node => node.tag === 'input' && node.props['aria-label'] === 'Exclude Research')!;
  assert(checkbox()); assert.equal(checkbox().props.checked, false);
  await view.editor.copyAnalysis(); await nextTick();
  const pending = deferred<OpportunityInsightsAnalysis>();
  view.handlers.build = () => pending.promise;
  const copying = view.editor.copyAnalysis();
  (checkbox().props.onChange as () => void)(); await nextTick();
  assert.equal(view.calls.at(-1)!.signal?.aborted, true, 'excluding a clustering topic cancels analysis preparation');
  pending.resolve(safePrompt); await copying; await nextTick();
  view.handlers.build = async () => safePrompt;
  assert.equal(checkbox().props.checked, true);
  assert.deepEqual([...view.network()!.jobExcludedTopicIds], ['research']);
  assert.equal(view.editor.preparedText, '');
  assert.match(nodeText(view.byClass('insights-job-list is-job-explorer')!), /Acoustic job.*Robotics job/u);
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  assert.match(nodeText(view.byClass('insights-context-topics')!), /Research/u, 'full job context retains excluded cluster features');
  await view.editor.copyAnalysis(); await nextTick();
  assert.deepEqual(view.calls.at(-1)!.jobClusterExcludedTopicIds, ['research']);
  (view.button('Clear exclusions')!.props.onClick as () => void)(); await nextTick();
  assert.deepEqual([...view.network()!.jobExcludedTopicIds], []);
  (checkbox().props.onChange as () => void)(); await nextTick();
  view.props.ownerId = fixtureId(99); await nextTick();
  await view.showBody('Clusters');
  await view.showTopicClusters();
  assert.deepEqual([...view.network()!.jobExcludedTopicIds], [], 'account changes never inherit exclusions');
});


test('job explorer spans the layout while preserving controls and evidence, and topic clusters restore the sidebar', async t => {
  const view = mount(t, { opportunities: [job(10, 'Acoustic prototype job', ['Acoustics', 'Prototypes'], 20), job(11, 'Robotics job', ['Robotics'], 10)],
    reviews: [jobReview(10, 9), jobReview(11, 8)] });
  await view.showBody('Clusters');
  const layout = view.byClass('insights-network-layout is-job-explorer')!;
  assert(layout, 'both child presentations receive the full-width job layout from the selected mode');
  const visual = view.byClass('insights-network-visual')!, matching = view.byClass('insights-matching-jobs')!;
  const controls = view.byClass('insights-network-list')!;
  assert.equal(visual.parent, layout);
  assert.equal(matching.parent, layout);
  assert.equal(controls.parent, layout);
  assert.deepEqual(layout.children.filter(item => item.tag).map(item => item.props.class),
    ['insights-network-visual', 'insights-matching-jobs', 'insights-network-list']);
  const styles = descriptor.styles.map(style => style.content).join('\n');
  assert.match(styles, /\.insights-network-layout\.is-job-explorer\s*\{[^}]*grid-template-areas:\s*'visual visual' 'jobs controls'/u,
    'the graph spans both columns while matching jobs and controls share the row below');
  const searchInput = descendants(controls).find(item => item.tag === 'input' && item.props.type === 'search')!;
  (searchInput.props['onUpdate:modelValue'] as (value: string) => void)('Acoustic'); await nextTick();
  const excluded = descendants(controls).find(item => item.tag === 'input' && item.props['aria-label'] === 'Exclude Prototypes')!;
  (excluded.props.onChange as () => void)(); await nextTick();
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  await view.editor.copyAnalysis(); await nextTick();
  const prepared = view.editor.preparedText, graph = view.network()!.graph, lifecycle = view.networkLifecycle();
  view.networkEmit('focusTopics', ['acoustics']); await nextTick();
  assert.equal(view.byClass('insights-network-layout is-job-explorer'), layout);
  assert.equal(view.byClass('insights-network-list'), controls);
  assert.equal(searchInput.props.value, 'Acoustic');
  assert.deepEqual([...view.network()!.jobExcludedTopicIds], ['prototypes']);
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  assert.equal(view.network()!.graph, graph, 'presentation focus does not rebuild evidence');
  assert.equal(view.editor.preparedText, prepared, 'presentation focus does not invalidate prepared analysis');
  assert.deepEqual(view.networkLifecycle(), lifecycle);
  assert.equal(nodeText(view.byClass('insights-job-list is-job-explorer')!), 'Acoustic prototype job High interest');
  await view.showTopicClusters();
  assert(view.byClass('insights-network-layout'), 'topic clusters recover their sidebar layout');
  assert.equal(view.byClass('insights-network-layout is-job-explorer'), undefined);
  assert.equal(view.byClass('insights-network-list'), controls, 'mode changes keep a single control container');
  assert.equal(view.network()!.graph, graph);
  assert.deepEqual(view.networkLifecycle(), lifecycle, 'switching modes does not remount the graph');
  assert(view.byClass('insights-topic-list'));
  assert.equal(view.byClass('insights-excluded-topic-list'), undefined);
  assert.equal(searchInput.props.value, '', 'the topic search starts without the prior job query');
  assert.equal(view.network()!.selectedJobId, null, 'changing modes clears job inspection');
  (view.button('Job clusters')!.props.onClick as () => void)(); await nextTick();
  const jobList = view.byClass('insights-job-list is-job-explorer')!;
  assert.equal(jobList.children.filter(item => item.tag === 'li').length, 2);
  assert.match(nodeText(jobList), /Acoustic prototype job.*Robotics job/u);
  assert.equal(view.byClass('insights-network-layout is-job-explorer'), layout);
  assert.deepEqual([...view.network()!.jobExcludedTopicIds], ['prototypes'], 'returning to jobs preserves the chosen clustering features');
});

test('Interest patterns includes all new reason categories and names application and submission origins', async t => {
  const view = mount(t);
  view.props.reviews[0]!.interest_reasons = [
    { category: 'background_fit', polarity: 'positive' }, { category: 'project_context', polarity: 'positive' },
    { category: 'requirements', polarity: 'negative' }, { category: 'availability', polarity: 'negative' },
    { category: 'hardware', polarity: 'positive' }, { category: 'funding', polarity: 'negative' },
  ];
  view.props.applications = [{ id: fixtureId(900), user_id: owner, opportunity_id: opportunityId,
    cv_variant_id: null, contact_email: null, context_json: view.props.opportunities[0]!,
    context_captured_at: new Date().toISOString(), completed_checklist_keys: [], status: 'preparation',
    notes: null, contacted_at: null, submitted_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
  await view.showBody('Interest patterns');
  const reasons = view.byClass('insights-reasons'); assert(reasons);
  const labels = nodeText(reasons);
  for (const label of ['Background fit', 'Project context', 'Requirements', 'Availability', 'Tools+hardware', 'Salary']) assert.ok(labels.includes(label), label);
  assert.doesNotMatch(labels, /background_fit|project_context|Funding/);
  assert.match(nodeText(view.byClass('insights-origins')!), /Application 1.*Submission 0/u);
  view.props.applications[0]!.status = 'submitted';
  await nextTick();
  assert.match(nodeText(view.byClass('insights-origins')!), /Application 0.*Submission 1/u);
  view.props.lang = 'de';
  await nextTick();
  assert.match(nodeText(view.byClass('insights-reasons')!), /Passung zum Hintergrund.*Projektkontext.*Tools\+Hardware.*Gehalt.*Anforderungen.*Verfügbarkeit/u);
  assert.match(nodeText(view.byClass('insights-origins')!), /Bewerbung 0.*Einreichung 1/u);
});

test('retired numeric overrides do not alter a categorical interest cohort or selected job', async t => {
  const view = mount(t, { opportunities: [job(10, 'Categorically high job', ['Acoustics'], 10)], reviews: [jobReview(10, 8)] });
  await view.showBody('Clusters');
  view.networkEmit('selectJob', fixtureId(10)); await nextTick();
  view.props.reviews[0]!.interest_rating = 0; await nextTick();
  assert.equal(view.network()!.selectedJobId, fixtureId(10));
  assert.equal(view.network()!.graph.jobs.find((entry: { id: string }) => entry.id === fixtureId(10))?.interestScore, 8);
  assert.match(nodeText(view.byClass('insights-job-list is-job-explorer')!), /Categorically high job/u);
});
