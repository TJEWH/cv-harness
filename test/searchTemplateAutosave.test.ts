import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { createSearchTemplateRepository, DEFAULT_SEARCH_TEMPLATES, searchTemplateContentKey } from '../src/features/meta-search/data/useSearchTemplates';
import { importCloudSearchTemplate, searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../src/features/meta-search/data/searchTemplateCloud';
import { isSearchTemplateSaved, type SearchPromptOptions } from '../src/features/meta-search/domain/searchPrompts';
import type { AdaptiveSearchRunnerState } from '../src/features/meta-search/domain/adaptiveSearchTask';
import type { SearchCloudTemplate, SearchTemplate } from '../src/features/meta-search/searchTypes';
import * as textareaCommit from '../src/shared/editing/textareaCommit';
import { flushEditorSession } from '../src/shared/editing/editorSession';
import { clearSearchDraft, recoverSearchDraft, retainSearchDraft } from '../src/features/meta-search/data/searchTemplateRecovery';

interface Editor {
  form: SearchTemplate; status: string; error: string; copiedFallback: string; loadingCloud: boolean;
  flushSave(): Promise<boolean>; flushTextareas(): Promise<boolean>; flush(): Promise<boolean>;
  adaptiveDashboard: { flush(): Promise<boolean> } | null; copy(): Promise<void>; retrySave(): Promise<unknown>;
  onDraftInput(): void;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const ownerId = '90000000-0000-4000-8000-000000000001';
const otherOwnerId = '90000000-0000-4000-8000-000000000002';
const cloudId = 'a0000000-0000-4000-8000-000000000001';
const projectRef = 'bbbbbbbbbbbbbbbbbbbb';
const filename = new URL('../src/features/meta-search/components/SearchTemplates.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'search-template-autosave' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const requireComponent = createRequire(filename);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(finish => { release = finish; });
  return { promise, release };
}
async function settle() { for (let i = 0; i < 12; i++) await nextTick(); }
function cloudRow(template: SearchTemplate, revision = 3): SearchCloudTemplate {
  return { id: cloudId, user_id: ownerId, name: template.name, revision, criteria: searchTemplateCloudCriteria(template), schedule: searchTemplateCloudSchedule(template),
    created_at: template.updatedAt, updated_at: template.updatedAt,
    meta_search: { version: 1, active: template.active, editor: clone(template), systemPrompt: 'System', userPrompt: 'User', recurringPrompt: 'Recurring' } };
}
function legacyRunner(patch: Partial<AdaptiveSearchRunnerState> = {}): AdaptiveSearchRunnerState {
  return { setup_contract_version: 1, user_id: ownerId, search_id: cloudId, project_ref: projectRef,
    revision: 0, mode: 'legacy', migration_requested: false, ready: false, readiness_code: 'release_disabled',
    setup_id: null, binding: null, ...patch };
}
async function fixture(t: TestContext, options: { linked?: boolean; readGate?: ReturnType<typeof gate>; rows?: SearchCloudTemplate[]; emptyLocal?: boolean;
  readiness?: AdaptiveSearchRunnerState; readinessError?: { code: string; message: string } } = {}) {
  const data = new Map<string, string>(); const recoveryData = new Map<string, string>();
  let failWrites = false; let failCloud = false; let failRead = false;
  let saveGate: ReturnType<typeof gate> | null = null;
  let readinessGate: ReturnType<typeof gate> | null = null;
  let readinessState = options.readiness ?? null;
  let readinessError: { code: string; message: string } | null = options.readinessError
    ?? (options.readiness ? null : { code: 'PGRST202', message: 'Synthetic workspace has no additive readiness helper.' });
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrites) throw new Error('Storage full'); data.set(key, value); } };
  const restoreGlobals: (() => void)[] = [];
  for (const account of [ownerId, otherOwnerId]) { const old = recoverSearchDraft(account); if (old) clearSearchDraft(account, old.form.id); }
  for (const [name, value] of Object.entries({ localStorage: storage, window: new EventTarget(), sessionStorage: {
    getItem: (key: string) => recoveryData.get(key) ?? null,
    setItem: (key: string, value: string) => { recoveryData.set(key, value); }, removeItem: (key: string) => { recoveryData.delete(key); },
  } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restoreGlobals.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  const owner = createSearchTemplateRepository(storage, ownerId);
  const initial = owner.listTemplates()[0]!;
  const rows = options.rows || (options.linked ? [cloudRow(initial)] : []);
  if (options.linked) initial.cloud = { id: cloudId, revision: 3, contentKey: searchTemplateContentKey(initial) };
  if (!options.emptyLocal) owner.saveTemplate(initial);
  const saves: SearchTemplate[] = []; const reads: string[] = []; const copied: string[] = [];
  const readinessCalls: { name: string; args: Record<string,unknown> }[] = [];
  const copyPrompts: SearchPromptOptions[] = [];
  const exports: { default?: Component } = {};
  new Function('require', 'exports', code)((path: string) => {
    if (path.endsWith('.vue')) return { default: {} };
    if (path.endsWith('/useToasts')) return { useToastWatch: () => {}, useSaveStateToast: () => {} };
    if (path.endsWith('/textareaCommit')) return textareaCommit;
    if (path.endsWith('/editorSession')) return { flushEditorSession };
    if (path.endsWith('/searchTemplateRecovery')) return { clearSearchDraft, recoverSearchDraft, retainSearchDraft };
    if (path.endsWith('/searchPrompts')) return {
      isSearchTemplateSaved, buildSearchSystemPrompt: () => 'System', buildSearchUserPrompt: () => 'User',
      buildReplaceSearchPrompt: (template: SearchTemplate, options: SearchPromptOptions = {}) => {
        copyPrompts.push(clone(options));
        return `Read saved search ${template.cloud!.id} and replace its task using setup ${options.setupId || 'legacy'}`;
      },
    };
    if (path.endsWith('/searchTemplateCloud')) return {
      importCloudSearchTemplate,
      listCloudSearchTemplates: async (_client: unknown, owner: string) => {
        reads.push(owner); if (options.readGate) await options.readGate.promise;
        if (failRead) throw new Error('Read unavailable');
        return owner === ownerId ? clone(rows) : [];
      },
      saveSearchTemplate: async (_client: unknown, _owner: string, value: SearchTemplate) => {
        saves.push(clone(value)); if (saveGate) await saveGate.promise;
        if (failCloud) throw new Error('Cloud save failed');
        return { ...clone(value), cloud: { id: value.cloud?.id || cloudId, revision: (value.cloud?.revision || 0) + 1, contentKey: searchTemplateContentKey(value) } };
      },
    };
    if (path.endsWith('/preparedClipboard')) return {
      copyPreparedText: async (prepare: () => Promise<string | null>) => {
        const value = await prepare(); if (value === null) return null;
        copied.push(value); return { value, copied: true };
      },
    };
    return requireComponent(path);
  }, exports);
  const props = reactive({ userId: ownerId, lang: 'en', projectId: projectRef, client: {
    rpc: async (name: string, args: Record<string,unknown>) => {
      assert.equal(name,'read_adaptive_search_readiness','the autosave harness permits only the additive readiness read');
      readinessCalls.push({ name,args: clone(args) });
      if (readinessGate) await readinessGate.promise;
      return { data: readinessState && clone(readinessState),error: readinessError };
    },
  } });
  let instance: unknown;
  const component = { ...exports.default, render: () => null };
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { instance = value; } }) });
  app.mount({}); let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  t.after(() => { try {
    unmount(); for (const account of [ownerId, otherOwnerId]) { const old = recoverSearchDraft(account); if (old) clearSearchDraft(account, old.form.id); }
  } finally { restoreGlobals.forEach(restore => restore()); } });
  if (!options.readGate) await settle();
  return { editor: (instance as { $: { setupState: Editor } }).$.setupState, owner, props, saves, reads, copied, copyPrompts, readinessCalls, unmount,
    holdSave: () => { saveGate = gate(); return saveGate; },
    holdReadiness: () => { readinessGate = gate(); return readinessGate; },
    setReadiness: (value: AdaptiveSearchRunnerState | null, error: { code: string; message: string } | null = null) => { readinessState = value; readinessError = error; },
    failWrites: (value: boolean) => { failWrites = value; }, failCloud: (value: boolean) => { failCloud = value; }, failRead: (value: boolean) => { failRead = value; } };
}

test('typing does not save; one commit autosaves to Supabase and repeated commits are deduplicated', async t => {
  const { editor, saves, reads } = await fixture(t);
  editor.form.userPrompt = 'Committed strategy'; editor.onDraftInput();
  await settle(); assert.equal(saves.length, 0); assert.equal(editor.status, 'unsaved');
  assert.equal(await editor.flushSave(), true);
  assert.equal(saves.length, 1); assert.equal(saves[0]!.userPrompt, 'Committed strategy');
  assert.equal(editor.status, 'saved');
  assert.equal(await editor.flushSave(), true); assert.equal(saves.length, 1);
  assert.equal(reads.length, 1, 'only initialization reads; each commit is one save');
});

test('a clean server-backed editor performs no save when opened or flushed', async t => {
  const { editor, saves, reads, readinessCalls } = await fixture(t, { linked: true });
  assert.equal(editor.status, 'saved'); assert.equal(await editor.flushSave(), true);
  assert.equal(saves.length, 0); assert.equal(reads.length, 1);
  assert.deepEqual(readinessCalls,[{ name: 'read_adaptive_search_readiness',args: { p_search_id: cloudId,p_project_ref: projectRef } }]);
});

test('a missing additive readiness helper keeps legacy copy/navigation usable without additional saves', async t => {
  const { editor,saves,copied,readinessCalls } = await fixture(t,{ linked: true });
  assert.equal(await editor.flushTextareas(),true);
  await editor.copy();
  assert.equal(editor.error,''); assert.equal(editor.status,'saved');
  assert.equal(copied.length,1); assert.ok(copied[0]!.includes(cloudId));
  assert.equal(saves.length,0); assert.equal(readinessCalls.length,2);
});

test('copy refreshes a cached unbound runner and resumes the server setup claim', async t => {
  const { editor, copied, copyPrompts, saves, setReadiness, readinessCalls } = await fixture(t, { linked: true, readiness: legacyRunner() });
  const setupId = 'a0000000-0000-4000-8000-000000000002';
  setReadiness(legacyRunner({ setup_id: setupId }));
  await editor.copy();
  assert.equal(copied.length, 1); assert.ok(copied[0]!.includes(setupId));
  assert.equal(copyPrompts[0]!.runner!.setup_id, setupId);
  assert.equal(copyPrompts[0]!.setupId, setupId);
  assert.equal(readinessCalls.length, 2); assert.equal(saves.length, 0);
});

test('repeat copies pin a setup UUID until the server reports its own pending identity', async t => {
  const { editor, copyPrompts, setReadiness } = await fixture(t, { linked: true, readiness: legacyRunner() });
  await editor.copy(); await editor.copy();
  const fresh = copyPrompts[0]!.setupId;
  assert.match(fresh!, /^[0-9a-f-]{36}$/u); assert.equal(copyPrompts[1]!.setupId, fresh);
  const serverSetup = 'a0000000-0000-4000-8000-000000000003';
  setReadiness(legacyRunner({ migration_requested: true, ready: true, readiness_code: 'ready', setup_id: serverSetup }));
  await editor.copy();
  assert.equal(copyPrompts[2]!.setupId, serverSetup);
});

test('unknown or denied copy-time readiness blocks clipboard publication', async t => {
  const { editor, copied, setReadiness, saves } = await fixture(t, { linked: true, readiness: legacyRunner() });
  for (const code of ['NETWORK_ERROR', '42501', 'PGRST202']) {
    setReadiness(null, { code, message: 'Synthetic readiness refresh failed.' });
    await editor.copy();
    assert.equal(copied.length, 0); assert.notEqual(editor.error, '');
  }
  assert.equal(saves.length, 0);
});

test('newer textarea typing during the readiness refresh prevents clipboard publication', async t => {
  const { editor, copied, holdReadiness, saves, readinessCalls } = await fixture(t, { linked: true, readiness: legacyRunner() });
  const hold = holdReadiness(); const copying = editor.copy(); await settle();
  assert.equal(readinessCalls.length, 2);
  editor.onDraftInput(); hold.release(); await copying;
  assert.equal(copied.length, 0); assert.equal(editor.status, 'unsaved'); assert.equal(saves.length, 0);
});

test('a newer committed model during the readiness refresh prevents clipboard publication', async t => {
  const { editor, copied, holdReadiness } = await fixture(t, { linked: true, readiness: legacyRunner() });
  const hold = holdReadiness(); const copying = editor.copy(); await settle();
  editor.form.userPrompt = 'New committed model while setup refreshes';
  assert.equal(await editor.flushSave(), true);
  hold.release(); await copying;
  assert.equal(copied.length, 0);
});

test('switching accounts during the readiness refresh cancels the old copy', async t => {
  const { editor, props, copied, holdReadiness, readinessCalls } = await fixture(t, { linked: true, readiness: legacyRunner() });
  const hold = holdReadiness(); const copying = editor.copy(); await settle();
  assert.equal(readinessCalls.length, 2);
  props.userId = otherOwnerId; await settle(); hold.release(); await copying;
  assert.equal(copied.length, 0);
});

test('missing readiness for a saved adaptive runner blocks copying rather than inventing a legacy fallback', async t => {
  const row = cloudRow(clone(DEFAULT_SEARCH_TEMPLATES[0]!));
  row.meta_search!.recurringPrompt = 'SELECT private.begin_adaptive_opportunity_search(saved_search, run);';
  const { editor,saves,copied,readinessCalls } = await fixture(t,{ linked: true,rows: [row] });
  assert.equal(editor.status,'error'); assert.match(editor.error,/saved adaptive runner is unavailable/);
  assert.equal(await editor.flushTextareas(),false); await editor.copy();
  assert.equal(copied.length,0); assert.equal(saves.length,0); assert.equal(readinessCalls.length,1);
});

test('a denied readiness read is not treated as a missing deployment and cannot copy or save through a fallback', async t => {
  const { editor,saves,copied,readinessCalls } = await fixture(t,{ linked: true,
    readinessError: { code: '42501',message: 'Synthetic owner readiness access denied.' } });
  assert.equal(editor.status,'error'); assert.notEqual(editor.error,'');
  assert.equal(await editor.flushTextareas(),false); await editor.copy();
  assert.equal(copied.length,0); assert.equal(saves.length,0); assert.equal(readinessCalls.length,1);
});

test('commits are serialized, with each newer snapshot saved once and the latest revision reused', async t => {
  const { editor, saves, holdSave } = await fixture(t); const hold = holdSave();
  editor.form.userPrompt = 'First';
  const first = editor.flushSave();
  editor.form.userPrompt = 'Second';
  const second = editor.flushSave(); const repeated = editor.flushSave();
  assert.equal(second, repeated);
  await settle(); assert.equal(saves.length, 1); hold.release();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(saves.length, 2);
  assert.equal(saves[0]!.userPrompt, 'First'); assert.equal(saves[1]!.userPrompt, 'Second');
  assert.equal(saves[1]!.cloud?.revision, 1); assert.equal(editor.form.cloud?.revision, 2);
});

test('newer typing during an active save remains unsaved until a subsequent commit', async t => {
  const { editor, saves, holdSave } = await fixture(t); const hold = holdSave();
  editor.form.userPrompt = 'Saved snapshot'; const saving = editor.flushSave(); await settle();
  editor.form.userPrompt = 'New typing'; editor.onDraftInput();
  hold.release(); assert.equal(await saving, false);
  assert.equal(editor.form.userPrompt, 'New typing'); assert.equal(editor.status, 'unsaved');
  await settle(); assert.equal(saves.length, 1);
  assert.equal(await editor.flushSave(), true); assert.equal(saves.length, 2);
});

test('navigation and copying await committed drafts; the clipboard receives only the short replacement pointer', async t => {
  const { editor, saves, copied, holdSave } = await fixture(t); const hold = holdSave();
  let dirtyTextarea = true;
  const unregister = textareaCommit.registerTextareaCommit(() => {
    if (!dirtyTextarea) return; dirtyTextarea = false; editor.form.researchInterests = 'BCI; acoustics; preferred: hardware evaluation; avoid: routine administration';
  });
  try {
    let settled = false; const copying = editor.copy().then(() => { settled = true; }); await settle();
    assert.equal(settled, false); assert.equal(copied.length, 0);
    hold.release(); await copying;
    assert.equal(saves[0]!.researchInterests, 'BCI; acoustics; preferred: hardware evaluation; avoid: routine administration');
    assert.equal(copied.length, 1); assert.ok(copied[0]!.includes(cloudId)); assert.ok(!copied[0]!.includes('hardware evaluation'));
  } finally { unregister(); }
});

test('a newer uncommitted textarea input prevents pending navigation and clipboard publication', async t => {
  const { editor, copied, holdSave } = await fixture(t); const hold = holdSave();
  editor.form.userPrompt = 'Current commit'; const copying = editor.copy(); await settle();
  editor.onDraftInput(); // The AutosaveTextarea still owns this newer text.
  hold.release(); await copying;
  assert.equal(copied.length, 0); assert.equal(editor.status, 'unsaved');
});

test('save failures retain the draft and block navigation and copying; retry uses no read chain', async t => {
  const { editor, saves, reads, copied, failCloud } = await fixture(t);
  editor.form.userPrompt = 'Important draft'; failCloud(true);
  assert.equal(await editor.flushSave(), false); assert.equal(editor.status, 'error');
  assert.equal(await editor.flushTextareas(), false);
  await editor.copy(); assert.equal(copied.length, 0);
  failCloud(false); assert.equal(await editor.retrySave(), true, editor.error);
  assert.equal(reads.length, 1); assert.equal(editor.status, 'saved');
  assert.equal(saves.at(-1)!.userPrompt, 'Important draft');
});

test('local failures retain the editor without sending a cloud save', async t => {
  const { editor, saves, failWrites } = await fixture(t);
  editor.form.fundingConditions = 'Funded contract; start in early 2027'; failWrites(true);
  assert.equal(await editor.flushTextareas(), false);
  assert.equal(saves.length, 0); assert.match(editor.error, /Storage full/);
  assert.equal(recoverSearchDraft(ownerId)?.form.fundingConditions, 'Funded contract; start in early 2027');
  failWrites(false); assert.equal(await editor.flushSave(), true);
});

test('an old save response cannot overwrite a different account or revive after switching back', async t => {
  const { editor, props, owner, holdSave } = await fixture(t); const hold = holdSave();
  editor.form.userPrompt = 'Original account draft'; const saving = editor.flushSave(); await settle();
  props.userId = otherOwnerId; await settle(); assert.notEqual(editor.form.userPrompt, 'Original account draft');
  props.userId = ownerId; await settle(); hold.release(); await saving;
  assert.equal(editor.form.userPrompt, 'Original account draft');
  assert.equal(owner.listTemplates()[0]!.cloud, undefined, 'the stale response was not attached to the restored editor');
});

test('initial cloud hydration preserves edits entered while the initial read was pending', async t => {
  const reading = gate(); const remote = clone(DEFAULT_SEARCH_TEMPLATES[0]!); remote.userPrompt = 'Remote strategy';
  const { editor, saves } = await fixture(t, { readGate: reading, rows: [cloudRow(remote, 7)], emptyLocal: true });
  editor.form.userPrompt = 'My new strategy'; editor.onDraftInput(); const saving = editor.flushSave();
  reading.release(); assert.equal(await saving, true, editor.error);
  assert.equal(editor.form.userPrompt, 'My new strategy');
  assert.equal(saves[0]!.cloud?.id, cloudId); assert.equal(saves[0]!.cloud?.revision, 7);
});

test('all shared profile fields save as one always-active committed snapshot', async t => {
  const { editor, saves } = await fixture(t);
  editor.form.opportunityDescription = 'Funded PhD; applied research; official university job pages';
  editor.form.researchInterests = 'BCI; robot audition; preferred: prototyping; avoid: routine support';
  editor.form.fundingConditions = 'Salaried contract; full funding; start in early 2027';
  assert.equal(await editor.flushSave(), true, editor.error);
  assert.equal(saves.length, 1);
  assert.equal(saves[0]!.active, true);
  for (const key of ['opportunityDescription', 'researchInterests', 'fundingConditions'] as const) assert.equal(saves[0]![key], editor.form[key]);
  assert.equal(editor.status, 'saved');
});

test('retrying a failed snapshot precedes a newer committed draft without losing either revision', async t => {
  const { editor, saves, reads, failCloud } = await fixture(t);
  editor.form.researchInterests = 'Acoustics; signal processing';
  failCloud(true); assert.equal(await editor.flushSave(), false);
  editor.form.researchInterests = 'Acoustics; signal processing; BCI';
  failCloud(false); assert.equal(await editor.flushSave(), true, editor.error);
  assert.deepEqual(saves.map(value => value.researchInterests), ['Acoustics; signal processing', 'Acoustics; signal processing', 'Acoustics; signal processing; BCI']);
  assert.equal(saves.at(-1)!.cloud?.revision, 1);
  assert.equal(editor.form.cloud?.revision, 2);
  assert.equal(reads.length, 1);
});

test('the shared profile exposes committed textareas without language postfixes or multi-profile controls', () => {
  const template = parse(readFileSync(filename, 'utf8')).descriptor.template!.content;
  for (const key of ['opportunityDescription', 'researchInterests', 'fundingConditions']) {
    const textarea = template.match(new RegExp(`<AutosaveTextarea[^>]*v-model\\.lazy="form\\.${key}"[^>]*>`))?.[0];
    assert.ok(textarea, key);
    assert.match(textarea, /@commit="flushSave"/, `${key} must save on Enter as well as blur`);
  }
  assert.doesNotMatch(template, /· English|Shared professional context|Professional background and goals|form\.profiles|addProfile|removeProfile|selectProfile|Include in daily search|form\.active/);
});


test('a newer native draft during the search save prevents a later dashboard flush without publishing that draft', async t => {
  const { editor, saves, holdSave } = await fixture(t); const hold = holdSave();
  let dashboardFlushes = 0, pendingDraft = false;
  const unregister = textareaCommit.registerTextareaCommit(() => {
    if (pendingDraft) { pendingDraft = false; editor.form.userPrompt = 'Newer unpublished lazy draft'; }
  });
  try {
    editor.form.userPrompt = 'The committed strategy';
    const pending = editor.flush(); await settle();
    pendingDraft = true; textareaCommit.markTextareaDraftChanged(); editor.onDraftInput();
    editor.adaptiveDashboard = { flush: async () => { dashboardFlushes++; return true; } };
    hold.release();
    assert.equal(await pending, false); assert.equal(dashboardFlushes, 0);
    assert.equal(pendingDraft, true, 'a continuation must not publish typing that happened after its save began');
    assert.equal(editor.form.userPrompt, 'The committed strategy');
    assert.deepEqual(saves.map(value => value.userPrompt), ['The committed strategy']);
    assert.equal(editor.status, 'unsaved');
  } finally { unregister(); }
});

test('the uniform search flush preserves inactive saves and blocks navigation after a dashboard failure', async t => {
  const { editor, props, saves } = await fixture(t, { linked: true });
  Object.assign(props, { sidebarActive: false }); await settle();
  let succeeded = false;
  editor.adaptiveDashboard = { flush: async () => succeeded };
  assert.equal(editor.flush, editor.flushTextareas);
  assert.equal(await editor.flush(), false);
  succeeded = true;
  assert.equal(await editor.flush(), true, 'unchanged inactivity does not prevent persistence');
  assert.equal(saves.length, 0);
});

test('search session epochs reject client and activation A-B-A changes during dashboard persistence', async t => {
  for (const change of ['client', 'active'] as const) await t.test(change, async t => {
    const { editor, props, saves } = await fixture(t, { linked: true }); const hold = gate();
    const initialClient = props.client; let dashboardStarted = false;
    editor.adaptiveDashboard = { flush: async () => { dashboardStarted = true; await hold.promise; return true; } };
    const pending = editor.flush(); await settle(); assert.equal(dashboardStarted, true);
    Object.assign(props, change === 'client' ? { client: null } : { sidebarActive: false }); await settle();
    Object.assign(props, change === 'client' ? { client: initialClient } : { sidebarActive: true }); await settle();
    hold.release(); assert.equal(await pending, false); assert.equal(saves.length, 0);
  });
});


test('first search acknowledgement drains the dashboard it mounts before navigation completes', async t => {
  const { editor, saves, holdSave } = await fixture(t), saving = holdSave(), dashboardSave = gate();
  let dashboardFlushes = 0, finished = false;
  editor.form.userPrompt = 'First committed search';
  const pending = editor.flush().then(saved => { finished = true; return saved; }); await settle();
  assert.equal(editor.adaptiveDashboard, null);
  editor.adaptiveDashboard = { flush: async () => { dashboardFlushes++; await dashboardSave.promise; return true; } };
  saving.release(); await settle();
  assert.equal(dashboardFlushes, 1); assert.equal(finished, false, 'navigation awaits the intentionally mounted editor');
  dashboardSave.release(); assert.equal(await pending, true);
  assert.equal(saves.length, 1); assert.equal(editor.form.cloud?.id, cloudId);
});

test('a newly mounted search dashboard is identity-guarded after its flush begins', async t => {
  const { editor, holdSave } = await fixture(t), saving = holdSave(), dashboardSave = gate();
  let capturedFlushes = 0, replacementFlushes = 0;
  const pending = editor.flush(); await settle();
  editor.adaptiveDashboard = { flush: async () => { capturedFlushes++; await dashboardSave.promise; return true; } };
  saving.release(); await settle(); assert.equal(capturedFlushes, 1);
  editor.adaptiveDashboard = { flush: async () => { replacementFlushes++; return true; } };
  dashboardSave.release(); assert.equal(await pending, false); assert.equal(replacementFlushes, 0);
});
