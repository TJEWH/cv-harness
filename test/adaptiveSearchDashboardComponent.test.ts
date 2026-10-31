import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, type Component } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdaptiveDashboardScope, AdaptiveDashboardState, AdaptiveSearchDashboardData, createAdaptiveSearchDashboardController } from '../src/features/meta-search/composables/adaptiveSearchDashboard';
import { createSearchBreadthPolicy } from '../src/features/meta-search/domain/adaptiveSearchPlanner';
import { useSaveStateToast, useToasts, useToastWatch } from '../src/shared/ui/useToasts';
import capturedDashboard from './browser/adaptive-dashboard.fixture.json';

const filename = new URL('../src/features/meta-search/components/AdaptiveSearchDashboard.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'adaptive-dashboard-component-test' });
const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname,
  id: 'adaptive-dashboard-component-test', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const transpile = (code: string) => ts.transpileModule(code,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const requireComponent = createRequire(filename);
const id = (value: number) => `83000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const scope = { ownerId: id(1), searchId: id(2), projectRef: 'abcdefghijklmnopqrst' };
const clone = <T,>(value: T): T => structuredClone(value);

interface HostNode {
  tag?: string; text?: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode;
  addEventListener(): void; removeEventListener(): void;
}
function node(tag?: string, text?: string): HostNode {
  return { tag, text, props: {}, children: [], addEventListener() {}, removeEventListener() {} };
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
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
});
const walk = (target: HostNode): HostNode[] => [target, ...target.children.flatMap(walk)];
const content = (target: HostNode): string => `${target.text ?? ''} ${target.children.map(content).join(' ')}`.replace(/\s+/gu, ' ').trim();
const Hint = defineComponent({ props: ['label', 'text'], setup: props => () => h('hint', { label: props.label, text: props.text }) });
const Textarea = defineComponent({ props: ['modelValue', 'readonly'], setup: props => () => h('textarea', { value: props.modelValue, readonly: props.readonly }) });
const Empty = defineComponent({ setup: () => () => h('span') });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); await nextTick(); }

function fixture(): AdaptiveSearchDashboardData {
  const value = clone(capturedDashboard) as unknown as AdaptiveSearchDashboardData;
  Object.assign(value, { user_id: scope.ownerId, search_id: scope.searchId, project_ref: scope.projectRef });
  Object.assign(value.readiness, { user_id: scope.ownerId, search_id: scope.searchId, project_ref: scope.projectRef });
  Object.assign(value.settings, { search_breadth_percent: 20, breadth_revision: 0, adaptation_enabled: false, adaptation_paused: false });
  value.policy = createSearchBreadthPolicy(20);
  value.planning_capacity = { core_queries: 20, discretionary: 10 };
  value.omitted = { sources: 0, preference_suggestions: 0, proposals: 0, queries: 0, executions: 0, runs: 0, withheld_fields: 0 };
  return value;
}
function emptyFixture(): AdaptiveSearchDashboardData {
  const value = fixture();
  value.sources = [];
  value.queries = { plan: null, executions: [] };
  value.preferences = { revision: 0, approved_rules: [], suggestions: [], proposals: [] };
  return value;
}

type Controller = ReturnType<typeof createAdaptiveSearchDashboardController>;
function mount(t: TestContext, initial: AdaptiveSearchDashboardData, options: { constructorFailures?: number; pendingLoads?: boolean; client?: SupabaseClient } = {}) {
  useToasts().clear();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null } });
  let attempts = 0;
  const actualControllers: Controller[] = [];
  const controllers: {
    state: AdaptiveDashboardState; scope: AdaptiveDashboardScope; disposed: boolean; loads: number;
    pending: ReturnType<typeof deferred<AdaptiveSearchDashboardData>>[]; decisions: { suggestion: string; action: string }[];
    retries: number; controller: Controller;
  }[] = [];
  const createController = (_client: SupabaseClient, captured: AdaptiveDashboardScope): Controller => {
    attempts++;
    if (attempts <= (options.constructorFailures ?? 0)) throw new Error('Synthetic constructor failure.');
    const state = reactive<AdaptiveDashboardState>({ data: null, loading: false, saving: false, error: '', errorKind: null, drafts: {}, retryable: false });
    const instance = { state, scope: { ...captured }, disposed: false, loads: 0,
      pending: [] as ReturnType<typeof deferred<AdaptiveSearchDashboardData>>[], decisions: [] as { suggestion: string; action: string }[], retries: 0, controller: null as unknown as Controller };
    const controller = {
      state,
      async load() {
        instance.loads++; state.loading = true;
        if (options.pendingLoads) {
          const pending = deferred<AdaptiveSearchDashboardData>(); instance.pending.push(pending);
          // Deliberately mutate this obsolete instance after disposal: the component
          // must retain its replacement controller rather than render the old reply.
          state.data = await pending.promise;
        } else state.data = clone(initial);
        state.loading = false; state.error = ''; state.errorKind = null;
        return true;
      },
      sourceDraft(registryId: string, patch: Record<string, unknown>) { state.drafts[registryId] = { ...state.drafts[registryId], ...patch }; },
      discardSourceDraft(registryId: string) { delete state.drafts[registryId]; return true; },
      saveSource: async () => true, patchSettings: async () => true,
      decide: async (suggestion: string, action: string) => { instance.decisions.push({ suggestion, action }); return true; },
      authorize: async () => true,
      retry: async () => { instance.retries++; return true; },
      flush: async () => true, setScope() {}, dispose() { instance.disposed = true; },
    } as Controller;
    instance.controller = controller; controllers.push(instance);
    return controller;
  };
  const componentExports: { default?: Component } = {}, renderExports: { render?: () => unknown } = {};
  const module = (path: string) => path.endsWith('AutosaveTextarea.vue') ? { default: Textarea }
    : path.endsWith('InfoHint.vue') ? { default: Hint }
    : path.endsWith('.vue') ? { default: Empty }
    : path === '@fortawesome/vue-fontawesome' ? { FontAwesomeIcon: Empty }
    : path === '../../../shared/ui/useToasts' ? { useToasts, useToastWatch, useSaveStateToast }
    : path === '../composables/adaptiveSearchDashboard' ? { ...requireComponent(path), createAdaptiveSearchDashboardController: (...args: Parameters<typeof createAdaptiveSearchDashboardController>) => {
      if (!options.client) return createController(args[0] as SupabaseClient, args[1]);
      const actual = requireComponent(path).createAdaptiveSearchDashboardController(...args) as Controller;
      actualControllers.push(actual); return actual;
    } }
    : requireComponent(path);
  new Function('require', 'exports', transpile(script.content))(module, componentExports);
  new Function('require', 'exports', transpile(template.code))(module, renderExports);
  const component = { ...componentExports.default, render: renderExports.render };
  const props = reactive({ ...scope, client: options.client ?? {} as SupabaseClient, lang: 'en' });
  const root = node('root'), app = renderer.createApp({ render: () => h(component, props) });
  app.mount(root);
  let closed = false;
  const close = () => { if (!closed) {
    closed = true; app.unmount(); useToasts().clear();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  } };
  t.after(close);
  const summary = (label: string) => walk(root).find(value => value.tag === 'summary' && content(value).startsWith(label));
  const section = (label: string) => summary(label)?.parent;
  const button = (label: string) => walk(root).find(value => value.tag === 'button' && content(value) === label);
  const click = async (label: string) => { const target = button(label); assert(target, `${label} is rendered`); await target.props.onClick(); await settle(); };
  return { props, controllers, actualControllers, attempts: () => attempts, root, close, summary, section, button, click,
    text: () => content(root), hints: () => walk(root).filter(value => value.tag === 'hint') };
}

type RpcReply = { data: unknown; error: null | { code: string; message: string } };
function rpcService(initial: AdaptiveSearchDashboardData) {
  const data = new Map([[initial.search_id, clone(initial)]]), calls: { name: string; args: Record<string, any> }[] = [];
  const receipts = new Map<string, unknown>();
  const hooks = { authorizationError: null as RpcReply['error'], loseSettingsResponse: false,
    pendingSettings: null as ReturnType<typeof deferred<RpcReply>> | null };
  const client = { rpc: async (name: string, args: Record<string, any>): Promise<RpcReply> => {
    calls.push({ name, args: clone(args) });
    const current = data.get(args.p_search_id)!;
    assert(current, 'only an explicitly provided synthetic search can be accessed');
    if (name === 'read_opportunity_search_dashboard') return { data: clone(current), error: null };
    if (name === 'set_opportunity_search_runner_authorization') {
      if (hooks.authorizationError) return { data: null, error: hooks.authorizationError };
      current.runner_authorization = { enabled: args.p_enabled, authorization_revision: current.runner_authorization.authorization_revision + 1, project_ref: current.project_ref };
      return { data: { search_id: current.search_id, ...current.runner_authorization }, error: null };
    }
    assert.equal(name, 'patch_opportunity_search_settings');
    if (hooks.pendingSettings) return hooks.pendingSettings.promise;
    let receipt = receipts.get(args.p_action_id);
    if (!receipt) {
      Object.assign(current.settings, args.p_patch);
      for (const key of Object.keys(args.p_expected_revisions)) current.settings[key as keyof typeof current.settings] = args.p_expected_revisions[key] + 1 as never;
      receipt = { dashboard_version: 1, action_id: args.p_action_id, search_id: current.search_id, kind: 'settings', settings: clone(current.settings) };
      receipts.set(args.p_action_id, receipt);
    }
    if (hooks.loseSettingsResponse) { hooks.loseSettingsResponse = false; return { data: null, error: { code: 'XX000', message: 'PRIVATE_DATABASE_DETAIL' } }; }
    return { data: clone(receipt), error: null };
  } } as unknown as SupabaseClient;
  return { data, calls, hooks, client };
}

test('legacy search keeps setup and real runs while hiding empty adaptive panels', async t => {
  const view = mount(t, emptyFixture()); await settle();
  assert.match(view.text(), /Legacy search/u);
  assert.match(view.text(), /Adaptation inactive/u);
  for (const label of ['Reviewed preferences', 'Reusable sources', 'Saved queries and actual checks']) assert.equal(view.section(label), undefined);
  assert(view.section('Automation authorization'));
  assert(view.section('Recent runs'));
  assert(view.button('Authorize this search in this project'), 'the existing explicit authorization action remains');
  assert(view.hints().some(value => /next active adaptive run/iu.test(String(value.props.text))), 'help must not promise adaptation on the next legacy run');
  view.controllers[0]!.state.drafts[id(50)] = { check_interval_hours: 48 }; await settle();
  assert(view.section('Reusable sources'), 'an unsaved retained source draft keeps its section available');
  assert(view.button('Discard local draft'), 'draft recovery remains available when no source records are loaded');
});

test('pending preferences remain actionable and count separately from active rules', async t => {
  const data = fixture(); data.preferences.suggestions[0]!.state = 'pending';
  const view = mount(t, data); await settle();
  assert.match(content(view.summary('Reviewed preferences')!), /0 active.*1 to review/u);
  assert(view.section('Reusable sources'));
  assert.match(content(view.summary('Reusable sources')!), /2 recorded.*1 pending/u);
  view.controllers[0]!.state.data!.sources[0]!.listing_url = null; await settle();
  assert.match(content(view.summary('Reusable sources')!), /2 recorded.*1 pending/u, 'a withheld URL does not prove that source identification is pending');
  await view.click('Approve rule');
  assert.deepEqual(view.controllers[0]!.decisions, [{ suggestion: data.preferences.suggestions[0]!.suggestion_id, action: 'approve' }]);
  data.preferences.suggestions = [];
  data.preferences.proposals = [{ suggestion_id: id(40), kind: 'preference', state: 'awaiting_verification',
    reason: 'needs_verified_evidence', created_at: '2026-10-29T12:00:00Z', evidence_refs: [], listing_url: null, vacancy_url: null, query: null }];
  view.controllers[0]!.state.data = data; await settle();
  assert(view.section('Reviewed preferences'), 'pending evidence is still substantive section data');
  assert.equal(view.button('Approve rule'), undefined, 'an inert proposal must not gain the active-rule approval control');
  assert.doesNotMatch(content(view.summary('Reviewed preferences')!), /1 active/u);
});

test('section-specific omissions retain panels and never turn omitted records into absolute empty claims', async t => {
  const data = emptyFixture();
  Object.assign(data.omitted, { sources: 2, preference_suggestions: 3, proposals: 1, queries: 4, executions: 5 });
  const view = mount(t, data); await settle();
  for (const label of ['Reviewed preferences', 'Reusable sources', 'Saved queries and actual checks']) {
    const section = view.section(label); assert(section, `${label} retains its omission information`);
    assert.match(content(section), /outside this view/iu);
  }
  assert.doesNotMatch(view.text(), /No reusable sources saved|No preference suggestions|No recorded checks/u);
});

test('runner confirmation and activation are distinct from pending setup, pause and authorization', async t => {
  const view = mount(t, emptyFixture()); await settle();
  const data = view.controllers[0]!.state.data!;
  data.readiness.migration_requested = true; await settle();
  assert.match(view.text(), /Legacy search/u);
  assert.match(view.text(), /Adaptive setup pending/u);
  assert.match(view.text(), /Adaptation inactive/u);
  Object.assign(data.readiness, { mode: 'adaptive', ready: true });
  data.runner_authorization.enabled = true; data.settings.adaptation_enabled = true; await settle();
  assert.match(view.text(), /Adaptive search/u);
  assert.match(view.text(), /Adaptive setup pending/u);
  assert.doesNotMatch(view.text(), /Adaptive task confirmed/u, 'a pending update is not a confirmed adaptive task');
  assert.match(view.text(), /Adaptation inactive/u);
  Object.assign(data.readiness, { mode: 'adaptive', migration_requested: false, ready: true });
  data.runner_authorization.enabled = true; data.settings.adaptation_enabled = true; await settle();
  assert.match(view.text(), /Adaptive task confirmed/u);
  assert.match(view.text(), /Adaptation active/u);
  data.settings.adaptation_paused = true; await settle();
  assert.match(view.text(), /Adaptation paused/u);
  data.settings.adaptation_paused = false; data.runner_authorization.enabled = false; await settle();
  assert.match(view.text(), /Adaptation inactive/u);
});

test('actual checks identify the query or source and preserve failure and successful-check chronology', async t => {
  const data = fixture(), source = data.sources[0]!;
  source.last_successful_at = '2026-10-18T10:00:00Z';
  source.coverage.last_attempted_at = '2026-10-20T12:00:00Z';
  const view = mount(t, data); await settle();
  const checks = view.section('Saved queries and actual checks')!;
  const row = (kind: string, status: string) => walk(checks).find(value => value.tag === 'article' && content(value).includes(kind) && content(value).includes(status));
  const sourceCheck = row('Source check', 'Blocked'); assert(sourceCheck);
  assert.match(content(sourceCheck), /Synthetic Institute/u);
  assert.match(content(sourceCheck), /Access denied/u);
  const queryCheck = row('Query execution', 'Complete'); assert(queryCheck);
  assert.match(content(queryCheck), /synthetic BCI opportunities/u);
  const sources = view.section('Reusable sources')!;
  const success = walk(sources).find(value => value.tag === 'p' && content(value).startsWith('Last successful check'));
  assert(success); assert.doesNotMatch(content(success), /Blocked/u, 'the most recent failure is not the successful check status');
  const attempt = walk(sources).find(value => value.tag === 'p' && /^Last (?:attempt|check)/u.test(content(value)) && !content(value).startsWith('Last successful'));
  assert(attempt); assert.match(content(attempt), /Blocked/u);
});

test('execution-only history and bounded saved plans remain inspectable independently', async t => {
  const data = fixture(); data.queries.plan = null;
  const view = mount(t, data); await settle();
  const checks = view.section('Saved queries and actual checks'); assert(checks);
  assert.match(content(checks), /Source check.*Blocked/u);
  assert.match(content(checks), /Access denied/u);
  const planned = fixture(); planned.omitted.queries = 2;
  view.controllers[0]!.state.data = planned; await settle();
  assert.match(content(view.section('Saved queries and actual checks')!), /synthetic BCI opportunities/u, 'omitted queries do not hide the loaded plan');
});

test('constructor-failure recovery recreates a controller while an existing-controller reload keeps its drafts', async t => {
  const view = mount(t, fixture(), { constructorFailures: 1 }); await settle();
  assert.equal(view.attempts(), 1);
  assert.equal(view.controllers.length, 0);
  assert(view.button('Reload latest'));
  await view.click('Refresh');
  assert.equal(view.attempts(), 2);
  assert.equal(view.controllers.length, 1);
  const active = view.controllers[0]!;
  assert.equal(active.loads, 1);
  active.state.drafts[id(50)] = { check_interval_hours: 48 };
  active.state.error = 'load_failed'; active.state.errorKind = 'load'; await settle();
  await view.click('Reload latest');
  assert.equal(view.attempts(), 2, 'normal reload preserves the existing controller and recovery state');
  assert.equal(active.loads, 2);
  assert.deepEqual(active.state.drafts[id(50)], { check_interval_hours: 48 });
});

test('account replacement keeps stale controller replies and captured retry actions out of the active view', async t => {
  const view = mount(t, emptyFixture(), { pendingLoads: true }); await settle();
  const previous = view.controllers[0]!;
  view.props.ownerId = id(90); view.props.searchId = id(91); await settle();
  const active = view.controllers[1]!;
  assert(previous.disposed);
  assert.equal(active.scope.ownerId, id(90));
  const currentData = fixture(); currentData.sources[0]!.institution = 'New account source';
  active.pending[0]!.resolve(currentData); await settle();
  assert.match(view.text(), /New account source/u);
  const obsoleteData = fixture(); obsoleteData.sources[0]!.institution = 'Obsolete account source';
  previous.pending[0]!.resolve(obsoleteData); await settle();
  assert.match(view.text(), /New account source/u);
  assert.doesNotMatch(view.text(), /Obsolete account source/u);
  active.state.error = 'load_failed'; active.state.errorKind = 'load'; await settle();
  const retry = useToasts().toasts.value[0]?.action?.run; assert(retry);
  view.props.ownerId = id(92); await settle();
  const replacement = view.controllers[2]!, before = replacement.loads;
  await retry(); await settle();
  assert.equal(replacement.loads, before, 'a retry captured for the previous account cannot reload the replacement');
});

test('authorization waits for configured readiness and refresh restores the explicit action without a task change', async t => {
  const initial = emptyFixture(); initial.readiness.readiness_code = 'release_disabled'; initial.readiness.ready = false;
  const service = rpcService(initial), view = mount(t, initial, { client: service.client }); await settle();
  const authorize = view.button('Authorize this search in this project'); assert(authorize);
  assert.equal(authorize.props.disabled, true);
  assert(view.hints().some(hint => /administrator must configure and enable adaptive execution/iu.test(String(hint.props.text))));
  await authorize.props.onClick(); await settle();
  assert.equal(service.calls.filter(call => call.name === 'set_opportunity_search_runner_authorization').length, 0, 'even a synthetic click cannot bypass the unavailable action');
  service.data.get(scope.searchId)!.readiness.readiness_code = 'owner_not_authorized';
  await view.click('Refresh');
  assert.equal(view.button('Authorize this search in this project')!.props.disabled, false);
  await view.click('Authorize this search in this project');
  assert(view.button('Revoke runner authorization'));
  const active = service.data.get(scope.searchId)!;
  active.readiness.readiness_code = 'release_disabled'; await view.click('Refresh');
  assert.equal(view.button('Revoke runner authorization')!.props.disabled, false, 'a deployment prerequisite never hides revocation');
  assert(service.calls.every(call => ['read_opportunity_search_dashboard', 'set_opportunity_search_runner_authorization'].includes(call.name)), 'authorization never requests task migration or creates a task');
});

test('a stale authorization prerequisite produces safe setup recovery instead of a generic save failure', async t => {
  const initial = emptyFixture(); initial.readiness.readiness_code = 'owner_not_authorized'; initial.readiness.ready = false;
  const service = rpcService(initial);
  service.hooks.authorizationError = { code: '22023', message: 'Configured project binding is required' };
  const view = mount(t, initial, { client: service.client }); await settle();
  await view.click('Authorize this search in this project');
  assert.equal(view.actualControllers[0]!.state.error, 'runner_unavailable');
  assert.equal(view.actualControllers[0]!.state.retryable, false);
  assert.equal(view.button('Retry exact request'), undefined);
  assert.equal(view.button('Authorize this search in this project')!.props.disabled, true);
  const toast = useToasts().toasts.value[0]; assert(toast);
  assert.match(toast.message, /administrator must configure and enable adaptive execution/iu);
  assert.doesNotMatch(toast.message, /22023|Configured project binding is required|change could not be saved/u);
  assert.equal(toast.action?.label, 'Reload latest');
  service.hooks.authorizationError = null;
  await view.click('Reload latest');
  assert.equal(view.button('Authorize this search in this project')!.props.disabled, false);
  await view.click('Authorize this search in this project');
  assert(view.button('Revoke runner authorization'));
});

test('checkbox settings use the touched revision and a structured failure keeps an identical recoverable retry', async t => {
  const initial = emptyFixture(), service = rpcService(initial);
  service.hooks.loseSettingsResponse = true;
  const view = mount(t, initial, { client: service.client }); await settle();
  const checkbox = walk(view.root).find(value => value.tag === 'label' && content(value) === 'Adapt query priorities')?.children.find(value => value.tag === 'input');
  assert(checkbox);
  await checkbox.props.onChange({ target: { checked: true } }); await settle();
  const first = service.calls.find(call => call.name === 'patch_opportunity_search_settings'); assert(first);
  assert.deepEqual(first.args.p_patch, { adaptation_enabled: true });
  assert.deepEqual(first.args.p_expected_revisions, { adaptation_revision: initial.settings.adaptation_revision });
  assert.equal(view.actualControllers[0]!.state.retryable, true);
  const toast = useToasts().toasts.value[0]; assert(toast);
  assert.match(toast.message, /change could not be saved/iu);
  assert.doesNotMatch(toast.message, /PRIVATE_DATABASE_DETAIL|XX000/u);
  assert.equal(toast.action?.label, 'Retry exact request');
  await view.click('Retry exact request');
  const writes = service.calls.filter(call => call.name === 'patch_opportunity_search_settings');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1]!.args, first.args, 'the retry preserves action identity, boolean patch and CAS revision');
  assert.equal(view.actualControllers[0]!.state.data!.settings.adaptation_enabled, true);
  assert.equal(view.actualControllers[0]!.state.data!.settings.adaptation_revision, initial.settings.adaptation_revision + 1, 'the committed response loss cannot apply the setting twice');
  assert.equal(view.actualControllers[0]!.state.error, '');
});

test('real-controller failure continuations and captured exact retries cannot act on a replacement account', async t => {
  const initial = emptyFixture(), service = rpcService(initial), view = mount(t, initial, { client: service.client }); await settle();
  const pending = deferred<RpcReply>(); service.hooks.pendingSettings = pending;
  const checkbox = walk(view.root).find(value => value.tag === 'label' && content(value) === 'Adapt query priorities')?.children.find(value => value.tag === 'input'); assert(checkbox);
  const saving = checkbox.props.onChange({ target: { checked: true } }); await settle();
  const next = emptyFixture();
  Object.assign(next, { user_id: id(90), search_id: id(91) });
  Object.assign(next.readiness, { user_id: id(90), search_id: id(91) });
  service.data.set(id(91), next);
  view.props.ownerId = id(90); view.props.searchId = id(91); await settle();
  pending.resolve({ data: null, error: { code: 'XX000', message: 'PRIVATE_DATABASE_DETAIL' } }); await saving; await settle();
  assert.equal(view.actualControllers[1]!.state.error, '');
  assert.equal(view.button('Retry exact request'), undefined);
  assert(!useToasts().toasts.value.some(toast => toast.tone === 'error'));
  service.hooks.pendingSettings = null; service.hooks.loseSettingsResponse = true;
  const currentCheckbox = walk(view.root).find(value => value.tag === 'label' && content(value) === 'Adapt query priorities')?.children.find(value => value.tag === 'input'); assert(currentCheckbox);
  await currentCheckbox.props.onChange({ target: { checked: true } }); await settle();
  const retry = useToasts().toasts.value[0]?.action?.run; assert(retry);
  view.props.ownerId = scope.ownerId; view.props.searchId = scope.searchId; await settle();
  const writes = service.calls.filter(call => call.name === 'patch_opportunity_search_settings').length;
  await retry(); await settle();
  assert.equal(service.calls.filter(call => call.name === 'patch_opportunity_search_settings').length, writes);
  view.close(); await retry();
  assert.equal(service.calls.filter(call => call.name === 'patch_opportunity_search_settings').length, writes, 'unmount also invalidates the captured retry');
});
