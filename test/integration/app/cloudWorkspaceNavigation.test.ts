import { opportunityFixture, opportunityAssessmentFixture } from '../../support/fixtures/opportunity';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, ref } from 'vue';
import type { Component } from 'vue';
import type { Application, ApplicationStage, Opportunity, OpportunityFeedbackPatch, OpportunityReview, OpportunityReviewState } from '../../../src/app/cloudTypes';
import { normalizeOpportunity as readOpportunity } from '../../../src/app/composables/useCloudWorkspace';
import { useSaveStateToast, useToasts, useToastWatch } from '../../../src/shared/ui/useToasts';
import { commitPendingTextareas, markTextareaDraftChanged, registerTextareaCommit } from '../../../src/shared/editing/textareaCommit';
import { flushEditorSession } from '../../../src/shared/editing/editorSession';
import { livingStandardFixture } from '../../support/fixtures/livingStandard';
import { migrateOpportunityEvaluationDrafts } from '../../../src/features/opportunities/domain/opportunityEvaluation';

const normalizeOpportunity = (input: Record<string, unknown> & { id: string }) => readOpportunity(opportunityFixture(input));

const filename = new URL('../../../src/app/components/CloudWorkspace.vue', import.meta.url);
const source = readFileSync(filename, 'utf8');
const { descriptor } = parse(source);
const compiled = compileScript(descriptor, { id: 'job-workspace-navigation-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

function mount(t: TestContext, options: { restoredOpportunityId?: string; active?: boolean; awaitNavigationFlush?: boolean } = {}) {
  useToasts().clear();
  t.after(() => useToasts().clear());
  const storage = new Map<string, string>();
  if (options.restoredOpportunityId) storage.set('CV_SELECTED_OPPORTUNITY:account-one', options.restoredOpportunityId);
  let unmount = () => {};
  t.after(() => unmount());
  for (const [key, value] of Object.entries({
    window: { setInterval: () => 1, clearInterval() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    localStorage: { get length() { return storage.size; }, key: (index: number) => [...storage.keys()][index] ?? null, getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  const opportunity = normalizeOpportunity({ id: 'opportunity-one', title: 'Robotics researcher', institution: 'Research University', deadline: null, topics: ['Robotics'], updated_at: '2026-09-20T12:00:00Z' });
  const application: Application = {
    id: 'application-one', user_id: 'account-one', opportunity_id: opportunity.id, cv_variant_id: null,
    contact_email: null, context_json: opportunity, context_captured_at: '2026-09-20T12:00:00Z',
    completed_checklist_keys: [], status: 'preparation', workflow_stage: 'preparation', tracking_started: false, notes: null, contacted_at: null, submitted_at: null,
    created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z',
  };
  const receipts: Opportunity[] = [];
  const reviews = ref<OpportunityReview[]>([]);
  const applications = ref<Application[]>([]);
  const opportunities = ref([opportunity]);
  let created = 0;
  const removed: string[] = [];
  const applicationUpdates: { id: string; changes: Partial<Application> }[] = [];
  const commentUpdates: { id: string; comment: string }[] = [];
  const feedbackUpdates: { id: string; patch: OpportunityFeedbackPatch }[] = [];
  const evaluationWrites: ('comment' | 'feedback')[] = [];
  const stageUpdates: { id: string; stage: ApplicationStage }[] = [];
  const historyResets: { id: string; notes: string | null }[] = [];
  const reviewUpdates: { id: string; state: OpportunityReviewState }[] = [];
  const saving = ref(false);
  const savingReview = ref(false);
  const handlers: {
    create?: () => Promise<Application | null>;
    review?: (id: string, state: OpportunityReviewState) => Promise<OpportunityReview | null>;
    comment?: (id: string, comment: string) => Promise<OpportunityReview | null>;
    feedback?: (id: string, patch: OpportunityFeedbackPatch) => Promise<OpportunityReview | null>;
  } = {};
  let failNotes = false;
  let failComment = false;
  let failFeedback = false;
  let failHistoryReset = false;
  const saveApplication = (id: string, changes: Partial<Application>) => {
    const current = applications.value.find(item => item.id === id);
    if (!current) return null;
    const saved = { ...current, ...changes };
    applications.value = applications.value.map(item => item.id === id ? saved : item);
    return saved;
  };
  const feedbackMetadata = (current: OpportunityReview | undefined, saved: OpportunityReview): OpportunityReview => ({
    ...saved, evaluation_revision: (current?.evaluation_revision ?? 0) + Number((current?.comment ?? null) !== (saved.comment ?? null)),
  });
  const workspace = {
    opportunities, applications, reviews,
    loading: ref(false), saving, savingReview, error: ref(''), opportunityCommentError: ref(''), opportunityReviewError: ref(''), refresh() {},
    markOpportunityReviewed: async (item: Opportunity) => { receipts.push(item); },
    createApplication: async () => {
      created++;
      const owner = props.userId;
      const saved = handlers.create ? await handlers.create() : application;
      if (owner !== props.userId) return null;
      if (saved) applications.value = [...applications.value.filter(item => item.id !== saved.id), saved];
      return saved;
    },
    updateApplication: async (id: string, changes: Partial<Application>) => {
      applicationUpdates.push({ id, changes });
      if (failNotes && 'notes' in changes) { failNotes = false; return null; }
      return saveApplication(id, { ...changes, ...(changes.status ? { tracking_started: true } : {}) });
    },
    setApplicationStage: async (id: string, stage: ApplicationStage) => {
      stageUpdates.push({ id, stage });
      const current = applications.value.find(item => item.id === id);
      const status = stage === 'tracking' ? current?.status : ({ preparation: 'preparation', refinement: 'refinement', review: 'attachments' } as const)[stage];
      return saveApplication(id, { workflow_stage: stage, ...(!current?.tracking_started ? { status } : {}) });
    },
    resetApplicationHistory: async (id: string) => {
      const current = applications.value.find(item => item.id === id);
      historyResets.push({ id, notes: current?.notes ?? null });
      if (failHistoryReset) { failHistoryReset = false; return null; }
      if (!current) return null;
      return saveApplication(id, { status_history: current.status_history?.slice(-1) });
    },
    setApplicationChecklistItem: async () => false,
    setOpportunityComment: async (id: string, comment: string) => {
      commentUpdates.push({ id, comment });
      evaluationWrites.push('comment');
      if (handlers.comment) return handlers.comment(id, comment);
      if (failComment) { failComment = false; return null; }
      const current = reviews.value.find(item => item.opportunity_id === id);
      if (Array.from(comment).length > 12000) return null;
      const saved = feedbackMetadata(current, { user_id: props.userId, opportunity_id: id, state: 'unreviewed', reviewed_updated_at: null, created_at: '', updated_at: '', ...current, comment: comment || null });
      reviews.value = [...reviews.value.filter(item => item.opportunity_id !== id), saved];
      return saved;
    },
    saveOpportunityFeedback: async (id: string, patch: OpportunityFeedbackPatch) => {
      feedbackUpdates.push({ id, patch }); evaluationWrites.push('feedback');
      if (handlers.feedback) return handlers.feedback(id, patch);
      if (failFeedback) { failFeedback = false; return null; }
      const current = reviews.value.find(item => item.opportunity_id === id);
      const saved = feedbackMetadata(current, { user_id: props.userId, opportunity_id: id, state: 'unreviewed', reviewed_updated_at: null, created_at: '', updated_at: '', ...current, ...patch });
      reviews.value = [...reviews.value.filter(item => item.opportunity_id !== id), saved];
      return saved;
    },
    saveOpportunityDisposition: async (id: string, patch: OpportunityFeedbackPatch) => workspace.saveOpportunityFeedback(id, patch),
    removeApplication: async (id: string) => { removed.push(id); applications.value = applications.value.filter((item) => item.id !== id); return true; },
    setOpportunityReview: async (id: string, state: OpportunityReviewState) => {
      const owner = props.userId;
      reviewUpdates.push({ id, state });
      const current = reviews.value.find(item => item.opportunity_id === id);
      const saved: OpportunityReview | null = handlers.review ? await handlers.review(id, state)
        : { user_id: owner, opportunity_id: id, reviewed_updated_at: null, created_at: '', updated_at: '', ...current, state };
      if (owner !== props.userId) return null;
      if (saved) reviews.value = [...reviews.value.filter(item => item.opportunity_id !== id), saved];
      return saved;
    },
    getApplicationContext: async () => null, refreshApplicationContext: async () => null,
  };
  const exports: { default?: Component } = {};
  const requireFromComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
    : path === '../composables/useCloudWorkspace' ? { useCloudWorkspace: () => workspace }
    : path === '../../shared/editing/textareaCommit' ? { commitPendingTextareas }
    : path === '../../shared/editing/editorSession' ? { flushEditorSession }
    : path === '../../shared/ui/useToasts' ? { useSaveStateToast, useToasts, useToastWatch } : requireFromComponent(path), exports);
  const component = { ...exports.default, render: () => null };
  const props = reactive({ client: null, userId: 'account-one', tab: 'opportunities' as 'opportunities' | 'applications', lang: 'en', configurations: [], selectedId: '', readVersion: () => null, ...(options.active === undefined ? {} : { active: options.active }) });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; }, onNavigate: async (tab: typeof props.tab) => {
    if (options.awaitNavigationFlush && !await setup.flushTextareas()) return;
    props.tab = tab;
  } }) });
  app.mount({});
  unmount = () => app.unmount();
  const setup = (mounted as { $: { setupState: {
    query: string; statusFilter: string; reviewFilter: string; showWithApplications: boolean; showLowInterest: boolean; sortBy: string; applicationSortBy: string; deadlineFilter: 'current' | 'past'; applicationDeadlineFilter: 'current' | 'past'; now: Date;
    statusLabel(status: string): string;
    reviewSelection(id: string): OpportunityReviewState;
    saveReviewSelection(item: Opportunity, state: OpportunityReviewState): Promise<boolean>;
    changeReview(item: Opportunity, event: Event): Promise<void>;
    pendingReviewSelections: Map<string, { state: OpportunityReviewState; status: 'saving' | 'error' }>;
    startingApplication: object | null;
    notes: string; notesStatus: string; notesError: string; flushNotes(): Promise<boolean>;
    applicationWorkspace: { flush(): Promise<boolean> } | null; flushTextareas(): Promise<boolean>; flush(): Promise<boolean>;
    searchTemplates: { flush(): Promise<boolean> } | null;
    opportunityView: 'catalogue' | 'searches' | 'insights'; showingInsights: boolean; showingOpportunitySubview: boolean;
    selectOpportunityView(view: 'catalogue' | 'searches' | 'insights'): Promise<boolean>;
    openInsightOpportunity(id: string): Promise<boolean>;
    opportunityFeedback: { flush(): Promise<boolean> } | null; applicationFeedback: { flush(): Promise<boolean> } | null;
    opportunityDisposition: { flush(): Promise<boolean> } | null;
    applicationDisposition: { flush(): Promise<boolean> } | null;
    opportunityComment: string; commentStatus: string; commentError: string; flushComment(): Promise<boolean>;
    recencyById: Map<string, 'new' | 'updated' | null>; unseenById: Map<string, 'new' | 'updated' | null>;
    fitScoreById: Map<string, number | undefined>; fitTone(score: number | undefined): string | undefined; fitLabel(score: number | undefined): string;
    showPersonalFitBadge(item: Opportunity): boolean;
    filteredOpportunities: Opportunity[]; filteredApplications: Application[]; selectedOpportunity?: Opportunity; showingDetail: boolean; editingApplication?: Application;
    opportunityGroups: { key: string; title: string; items: Opportunity[] }[];
    applicationGroups: { key: string; title: string; items: Application[] }[];
    removingId: string | null; removalDialog: { open?: boolean; showModal(): void; close(): void };
    openOpportunity(id: string): void; closeOpportunity(): Promise<void>; closeApplication(): Promise<void>; startApplication(item: Opportunity): Promise<void>;
    openApplication(item: Application): void; openList(kind: 'opportunities' | 'applications'): Promise<boolean>; navigateDetail(direction: -1 | 1): Promise<void>;
    changeApplicationStatus(item: Application, event: Event): Promise<void>;
    resetTrackingHistory(item: Application): Promise<void>; resettingHistory: boolean; historyResetError: string;
    statusHistory: NonNullable<Application['status_history']>;
    requestDetailRemoval(item: Application): Promise<void>; cancelRemoval(): void; confirmRemoval(item: Application): Promise<void>;
  } } }).$.setupState;
  const componentProps = (mounted as { $props: { active: boolean } }).$props;
  return { close: () => unmount(), migrateRecovery: () => migrateOpportunityEvaluationDrafts(props.userId, reviews.value as unknown as Record<string, unknown>[]), setup, props, componentProps, opportunity, opportunities, application, applications, receipts, reviews, storage, removed, applicationUpdates, commentUpdates, feedbackUpdates, evaluationWrites, stageUpdates, historyResets, reviewUpdates, saving, savingReview, handlers, failNextNotesSave: () => { failNotes = true; }, failNextCommentSave: () => { failComment = true; }, failNextFeedbackSave: () => { failFeedback = true; }, failNextHistoryReset: () => { failHistoryReset = true; }, created: () => created };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function settleUntil(check: () => boolean) {
  for (let pass = 0; pass < 40 && !check(); pass++) await nextTick();
  assert.ok(check(), 'the expected asynchronous operation should start');
}

const reviewEvent = (state: OpportunityReviewState) => ({ target: { value: state } }) as unknown as Event;

function applicationWithHistory(application: Application): Application {
  return { ...application, status: 'contacted', workflow_stage: 'tracking', tracking_started: true, status_history: [
    { status: 'ready', changedAt: '2026-10-11T09:00:00Z' },
    { status: 'contacted', changedAt: '2026-10-12T10:00:00Z' },
  ] };
}

test('tracking history reset saves pending notes first and retains the current status and timestamp', async t => {
  const f = mount(t);
  const item = applicationWithHistory(f.application);
  f.applications.value = [item];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(item);
  f.setup.notes = 'Confirm the funding before applying.';
  let nestedFlushed = false;
  f.setup.applicationWorkspace = { flush: async () => { nestedFlushed = true; return true; } };
  await f.setup.resetTrackingHistory(item);
  assert.equal(nestedFlushed, true);
  assert.deepEqual(f.historyResets, [{ id: item.id, notes: 'Confirm the funding before applying.' }]);
  assert.deepEqual(f.setup.statusHistory, [item.status_history![1]]);
  assert.equal(f.setup.editingApplication?.status, 'contacted');
  assert.equal(f.setup.editingApplication?.tracking_started, true);
  assert.equal(f.setup.historyResetError, '');
  assert.equal(f.setup.resettingHistory, false);
});

test('resetting history before choosing a tracking status preserves the preparation state', async t => {
  const f = mount(t);
  const currentEntry = { status: 'attachments' as const, changedAt: '2026-10-12T10:00:00Z' };
  const item: Application = { ...f.application, status: 'attachments', workflow_stage: 'tracking', tracking_started: false,
    status_history: [{ status: 'preparation', changedAt: '2026-10-11T09:00:00Z' }, currentEntry] };
  f.applications.value = [item];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(item);
  await f.setup.resetTrackingHistory(item);
  assert.deepEqual(f.setup.statusHistory, [currentEntry]);
  assert.equal(f.setup.editingApplication?.status, 'attachments');
  assert.equal(f.setup.editingApplication?.workflow_stage, 'tracking');
  assert.equal(f.setup.editingApplication?.tracking_started, false);
  assert.deepEqual(f.applicationUpdates, [], 'resetting history must not choose a tracking status');
  assert.deepEqual(f.stageUpdates, [], 'resetting history must not select another workflow tab');
});

test('tracking history reset stops when pending textarea saves fail and succeeds after retry', async t => {
  const f = mount(t);
  const item = applicationWithHistory(f.application);
  f.applications.value = [item];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(item);
  f.setup.notes = 'Unsaved follow-up note.';
  f.failNextNotesSave();
  await f.setup.resetTrackingHistory(item);
  assert.deepEqual(f.historyResets, []);
  assert.deepEqual(f.setup.statusHistory, item.status_history);
  assert.equal(f.setup.notes, 'Unsaved follow-up note.');
  assert.equal(f.setup.notesStatus, 'error');
  assert.equal(f.setup.historyResetError, 'Pending edits could not be saved. Please retry.');
  assert.equal(f.setup.resettingHistory, false);
  f.setup.applicationWorkspace = { flush: async () => false };
  await f.setup.resetTrackingHistory(item);
  assert.deepEqual(f.historyResets, [], 'a failed nested editor save must also stop the reset');
  assert.equal(f.setup.historyResetError, 'Pending edits could not be saved. Please retry.');
  f.setup.applicationWorkspace = { flush: async () => true };
  await f.setup.resetTrackingHistory(item);
  assert.deepEqual(f.historyResets, [{ id: item.id, notes: 'Unsaved follow-up note.' }]);
  assert.deepEqual(f.setup.statusHistory, [item.status_history![1]]);
  assert.equal(f.setup.historyResetError, '');
});

test('failed tracking history reset preserves history and reports an inline error until retry', async t => {
  const f = mount(t);
  const item = applicationWithHistory(f.application);
  f.applications.value = [item];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(item);
  f.failNextHistoryReset();
  await f.setup.resetTrackingHistory(item);
  assert.equal(f.historyResets.length, 1);
  assert.deepEqual(f.setup.statusHistory, item.status_history);
  assert.match(f.setup.historyResetError, /history/i);
  assert.equal(f.setup.resettingHistory, false);
  await f.setup.resetTrackingHistory(item);
  assert.equal(f.historyResets.length, 2);
  assert.deepEqual(f.setup.statusHistory, [item.status_history![1]]);
  assert.equal(f.setup.historyResetError, '');
});

test('changing applications while a history reset flushes cannot reset either record', async t => {
  const f = mount(t);
  const item = applicationWithHistory(f.application);
  const other = applicationWithHistory({ ...f.application, id: 'application-two' });
  f.applications.value = [item, other];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(item);
  let release!: (value: boolean) => void;
  f.setup.applicationWorkspace = { flush: () => new Promise(resolve => { release = resolve; }) };
  const pending = f.setup.resetTrackingHistory(item);
  assert.equal(f.setup.resettingHistory, true);
  f.setup.openApplication(other);
  release(true);
  await pending;
  assert.deepEqual(f.historyResets, []);
  assert.equal(f.setup.editingApplication?.id, other.id);
  assert.deepEqual(f.setup.statusHistory, other.status_history);
  assert.equal(f.setup.resettingHistory, false);
});

test('tracking history reset errors clear when selecting another application or account', async t => {
  const f = mount(t);
  const item = applicationWithHistory(f.application);
  const other = applicationWithHistory({ ...f.application, id: 'application-two' });
  f.applications.value = [item, other];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(item);
  f.failNextHistoryReset();
  await f.setup.resetTrackingHistory(item);
  assert.notEqual(f.setup.historyResetError, '');
  f.setup.openApplication(other);
  await nextTick();
  assert.equal(f.setup.historyResetError, '');
  f.failNextHistoryReset();
  await f.setup.resetTrackingHistory(other);
  assert.notEqual(f.setup.historyResetError, '');
  f.props.userId = 'account-two';
  await nextTick();
  assert.equal(f.setup.historyResetError, '');
});

test('opportunity navigation follows captured group order, skips removed results, and stops at either end', async (t) => {
  const { setup, opportunities, reviews } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, title: string, recent = false) => normalizeOpportunity({
    id, title, deadline: null,
    created_at: recent ? '2026-10-06T11:00:00Z' : '2026-10-01T12:00:00Z',
    updated_at: recent ? '2026-10-06T11:00:00Z' : '2026-10-01T12:00:00Z',
  });
  const alpha = make('alpha', 'Research Alpha');
  const bravo = make('bravo', 'Research Bravo', true);
  const charlie = make('charlie', 'Research Charlie');
  const delta = make('delta', 'Research Delta', true);
  opportunities.value = [charlie, delta, make('excluded', 'Other role', true), bravo, alpha];
  setup.query = 'Research';
  setup.sortBy = 'title';
  assert.deepEqual(setup.opportunityGroups.flatMap(group => group.items.map(item => item.id)), ['bravo', 'delta', 'alpha', 'charlie']);
  setup.openOpportunity(bravo.id);
  assert.deepEqual(setup.opportunityGroups.flatMap(group => group.items.map(item => item.id)), ['delta', 'alpha', 'bravo', 'charlie']);
  await setup.navigateDetail(-1);
  assert.equal(setup.selectedOpportunity?.id, bravo.id, 'the first result does not wrap to the last');
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, delta.id, 'read receipts do not change the captured navigation order');
  reviews.value = [{ user_id: 'account-one', opportunity_id: delta.id, state: 'not_interested', reviewed_updated_at: delta.updated_at, created_at: '', updated_at: '' }];
  assert.equal(setup.filteredOpportunities.some(item => item.id === delta.id), false);
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, alpha.id, 'a review that hides the current result still allows navigation');
  opportunities.value = opportunities.value.filter(item => item.id !== delta.id);
  await setup.navigateDetail(-1);
  assert.equal(setup.selectedOpportunity?.id, bravo.id, 'removed results are skipped');
  await setup.navigateDetail(1);
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, charlie.id);
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, charlie.id, 'the last result does not wrap to the first');
  assert.equal(setup.query, 'Research');
  assert.equal(setup.sortBy, 'title');
  assert.equal(setup.showLowInterest, false);
});

test('application navigation waits for nested textarea saves and retains the item on failure', async t => {
  const f = mount(t);
  const second = { ...f.application, id: 'application-two', context_json: { title: 'Second application' } };
  f.applications.value = [f.application, second];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(f.application);
  let release!: (saved: boolean) => void;
  f.setup.applicationWorkspace = { flush: () => new Promise<boolean>(resolve => { release = resolve; }) };
  const navigation = f.setup.navigateDetail(1);
  assert.equal(f.setup.editingApplication?.id, f.application.id);
  release(false);
  await navigation;
  assert.equal(f.setup.editingApplication?.id, f.application.id);
  assert.equal(f.applicationUpdates.length, 0, 'failed nested saves must stop later writes');
  f.setup.applicationWorkspace = { flush: async () => false };
  await f.setup.closeApplication();
  assert.equal(f.setup.editingApplication?.id, f.application.id);
  assert.equal(await f.setup.openList('applications'), false);
  f.setup.applicationWorkspace = { flush: async () => true };
  await f.setup.navigateDetail(1);
  assert.equal(f.setup.editingApplication?.id, second.id);
});

test('opportunity navigation saves evaluations and retains the current draft when saving fails', async (t) => {
  const { setup, opportunity, opportunities, reviews, failNextCommentSave } = mount(t);
  const other = normalizeOpportunity({ id: 'other', title: 'Second research role', deadline: null });
  opportunities.value = [opportunity, other];
  setup.sortBy = 'title';
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Ask about access to the robotics lab.';
  failNextCommentSave();
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.opportunityComment, 'Ask about access to the robotics lab.');
  assert.equal(setup.commentStatus, 'error');
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, other.id);
  assert.equal(setup.opportunityComment, '');
  assert.equal(reviews.value.find(item => item.opportunity_id === opportunity.id)?.comment, 'Ask about access to the robotics lab.');
  await setup.navigateDetail(-1);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.opportunityComment, 'Ask about access to the robotics lab.');
});

test('active applications show locked very high interest and removal restores the saved opportunity choice', async t => {
  const f = mount(t);
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'not_interested', reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.applications.value = [f.application];
  f.setup.showWithApplications = true;
  f.setup.reviewFilter = 'very_high_interest';
  await nextTick();
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'very_high_interest');
  assert.equal(f.setup.statusLabel('very_high_interest'), 'Very high');
  assert.deepEqual(f.setup.filteredOpportunities.map(item => item.id), [f.opportunity.id]);
  assert.equal(await f.setup.saveReviewSelection(f.opportunity, 'interested'), false);
  assert.deepEqual(f.reviewUpdates, []);
  assert.equal(f.reviews.value[0]?.state, 'not_interested');
  f.setup.reviewFilter = 'all';
  f.setup.showLowInterest = true;
  f.applications.value = [];
  await nextTick();
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'not_interested');
  assert.equal(await f.setup.saveReviewSelection(f.opportunity, 'very_high_interest'), true);
  assert.equal(f.reviews.value[0]?.state, 'very_high_interest');
});

test('an application from another account cannot lock interest for the active account', async t => {
  const f = mount(t);
  f.applications.value = [{ ...f.application, user_id: 'other-owner' }];
  await nextTick();
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'unreviewed');
  assert.equal(await f.setup.saveReviewSelection(f.opportunity, 'very_high_interest'), true);
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'very_high_interest');
});

test('interest can remain pending or failed while navigating away and back without losing the choice', async t => {
  const f = mount(t);
  const other = normalizeOpportunity({ id: 'other', title: 'Second research role', deadline: null });
  f.opportunities.value = [f.opportunity, other];
  f.setup.sortBy = 'title';
  f.setup.openOpportunity(f.opportunity.id);
  const write = deferred<OpportunityReview | null>();
  f.handlers.review = () => write.promise;
  f.saving.value = true;
  f.savingReview.value = true;
  const selection = f.setup.changeReview(f.opportunity, reviewEvent('strong_interest'));
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'strong_interest');
  await f.setup.navigateDetail(1);
  assert.equal(f.setup.selectedOpportunity?.id, other.id, 'an interest request must not block the next opportunity');
  await f.setup.navigateDetail(-1);
  assert.equal(f.setup.selectedOpportunity?.id, f.opportunity.id);
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'strong_interest', 'returning during the request retains the choice');
  write.resolve(null);
  await selection;
  f.saving.value = false;
  f.savingReview.value = false;
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'strong_interest', 'a failed save retains the recoverable choice');
  assert.equal(f.setup.pendingReviewSelections.get(f.opportunity.id)?.status, 'error');
  await f.setup.navigateDetail(1);
  await f.setup.navigateDetail(-1);
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'strong_interest');
  delete f.handlers.review;
  await f.setup.changeReview(f.opportunity, reviewEvent('strong_interest'));
  assert.equal(f.reviews.value[0]?.state, 'strong_interest');
  assert.equal(f.setup.pendingReviewSelections.has(f.opportunity.id), false, 'a confirmed retry clears the pending draft');
});

test('interest-only saving still publishes and waits for dirty textarea drafts before swiping', async t => {
  const f = mount(t);
  const other = normalizeOpportunity({ id: 'other', title: 'Second research role', deadline: null });
  f.opportunities.value = [f.opportunity, other];
  f.setup.sortBy = 'title';
  f.setup.openOpportunity(f.opportunity.id);
  f.saving.value = true;
  f.savingReview.value = true;
  const comment = deferred<OpportunityReview | null>();
  f.handlers.comment = () => comment.promise;
  let unpublished = true;
  const unregister = registerTextareaCommit(() => {
    if (unpublished) { unpublished = false; f.setup.opportunityComment = 'Still need to confirm lab access.'; }
  });
  t.after(unregister);
  const navigation = f.setup.navigateDetail(1);
  await settleUntil(() => f.commentUpdates.length === 1);
  assert.equal(unpublished, false, 'navigation must publish textarea drafts before flushing');
  assert.equal(f.setup.selectedOpportunity?.id, f.opportunity.id, 'dirty evaluation text must finish saving before navigation');
  comment.resolve(null);
  await navigation;
  assert.equal(f.setup.selectedOpportunity?.id, f.opportunity.id);
  assert.equal(f.setup.opportunityComment, 'Still need to confirm lab access.');
  assert.equal(f.setup.commentStatus, 'error');
});

test('an older interest response or failure cannot replace a newer selection', async t => {
  const f = mount(t);
  const first = deferred<OpportunityReview | null>();
  const second = deferred<OpportunityReview | null>();
  f.handlers.review = (_id, state) => state === 'interested' ? first.promise : second.promise;
  const older = f.setup.changeReview(f.opportunity, reviewEvent('interested'));
  const latest = f.setup.changeReview(f.opportunity, reviewEvent('strong_interest'));
  first.resolve(null);
  await older;
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'strong_interest');
  assert.equal(f.setup.pendingReviewSelections.get(f.opportunity.id)?.status, 'saving');
  second.resolve({ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'strong_interest', reviewed_updated_at: null, created_at: '', updated_at: '' });
  await latest;
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'strong_interest');
  assert.equal(f.setup.pendingReviewSelections.has(f.opportunity.id), false);
});

test('a failed interest save from the old account cannot replace the next account’s choice', async t => {
  const f = mount(t);
  const oldWrite = deferred<OpportunityReview | null>();
  f.handlers.review = () => oldWrite.promise;
  const older = f.setup.changeReview(f.opportunity, reviewEvent('strong_interest'));
  f.props.userId = 'account-two';
  await nextTick();
  assert.equal(f.setup.pendingReviewSelections.size, 0);
  delete f.handlers.review;
  await f.setup.changeReview(f.opportunity, reviewEvent('interested'));
  oldWrite.resolve(null);
  await older;
  assert.equal(f.setup.reviewSelection(f.opportunity.id), 'interested');
  assert.equal(f.setup.pendingReviewSelections.size, 0);
  assert.equal(f.reviews.value[0]?.user_id, 'account-two');
});

test('Apply accepts the first tap during interest saving and deduplicates repeated taps', async t => {
  const f = mount(t);
  f.setup.openOpportunity(f.opportunity.id);
  f.saving.value = true;
  f.savingReview.value = true;
  const creation = deferred<Application | null>();
  f.handlers.create = () => creation.promise;
  const first = f.setup.startApplication(f.opportunity);
  const duplicate = f.setup.startApplication(f.opportunity);
  assert.ok(f.setup.startingApplication, 'the accepted tap must be visible synchronously');
  await settleUntil(() => f.created() === 1);
  await duplicate;
  assert.equal(f.created(), 1, 'repeated taps must not queue duplicate creation requests');
  creation.resolve(f.application);
  await first;
  assert.equal(f.props.tab, 'applications');
  assert.equal(f.setup.editingApplication?.id, f.application.id);
  assert.equal(f.setup.startingApplication, null);
});

test('Apply opens the created application when the parent activates its tab after flushing editors', async t => {
  const f = mount(t, { awaitNavigationFlush: true });
  f.setup.openOpportunity(f.opportunity.id);
  const parentFlush = deferred<boolean>();
  let flushingParentEditors = false;
  f.setup.applicationWorkspace = { flush: () => {
    flushingParentEditors = true;
    return parentFlush.promise;
  } };
  const creation = f.setup.startApplication(f.opportunity);
  await settleUntil(() => flushingParentEditors);
  await creation;
  assert.equal(f.props.tab, 'opportunities', 'the parent must finish its editor flush before switching tabs');
  assert.equal(f.created(), 1);
  parentFlush.resolve(true);
  await settleUntil(() => f.props.tab === 'applications');
  assert.equal(f.setup.editingApplication?.id, f.application.id, 'asynchronous tab activation must retain the requested application detail');
  assert.equal(f.setup.showingDetail, true);
});

test('late Apply completion cannot navigate after the account, tab, item, or list request changes', async t => {
  for (const change of ['account', 'tab', 'item', 'list'] as const) await t.test(change, async t => {
    const f = mount(t);
    const other = normalizeOpportunity({ id: 'other', title: 'Second research role', deadline: null });
    f.opportunities.value = [f.opportunity, other];
    f.setup.openOpportunity(f.opportunity.id);
    const creation = deferred<Application | null>();
    f.handlers.create = () => creation.promise;
    const pending = f.setup.startApplication(f.opportunity);
    await settleUntil(() => f.created() === 1);
    if (change === 'account') f.props.userId = 'account-two';
    if (change === 'tab') f.props.tab = 'applications';
    if (change === 'item') f.setup.openOpportunity(other.id);
    if (change === 'list') assert.equal(await f.setup.openList('opportunities'), true);
    await nextTick();
    creation.resolve(f.application);
    await pending;
    assert.equal(f.setup.editingApplication, undefined, 'a late result must not open an unsolicited application detail');
    assert.equal(f.props.tab, change === 'tab' ? 'applications' : 'opportunities');
    if (change === 'item') assert.equal(f.setup.selectedOpportunity?.id, other.id);
    if (change === 'list') assert.equal(f.setup.selectedOpportunity, undefined);
    assert.equal(f.setup.startingApplication, null);
  });
});

test('evaluations remain available while feedback controls are unavailable', async t => {
  const f = mount(t);
  f.setup.openOpportunity(f.opportunity.id);
  f.handlers.comment = async (id, comment) => {
    const saved: OpportunityReview = { user_id: f.props.userId, opportunity_id: id, state: 'unreviewed', comment,
      reviewed_updated_at: null, created_at: '', updated_at: '' };
    f.reviews.value = [saved];
    return saved;
  };
  f.setup.opportunityComment = 'Evaluation in a legacy workspace';
  assert.equal(await f.setup.flushComment(), true);
  assert.equal(f.reviews.value[0]?.comment, 'Evaluation in a legacy workspace');
  assert.equal(f.feedbackUpdates.length, 0);
});

test('application evaluations share opportunity drafts and block record navigation on save failure', async t => {
  const f = mount(t);
  const secondOpportunity = normalizeOpportunity({ id: 'opportunity-two', title: 'Second research role', deadline: null });
  const second = { ...f.application, id: 'application-two', opportunity_id: secondOpportunity.id, context_json: secondOpportunity };
  f.opportunities.value.push(secondOpportunity);
  f.applications.value = [f.application, second];
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'interested', comment: 'Existing personal evaluation.', reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(f.application);
  assert.equal(f.setup.opportunityComment, 'Existing personal evaluation.');
  f.setup.opportunityComment = 'Updated while preparing the application.';
  await nextTick();
  assert.equal(f.commentUpdates.length, 0, 'typing must remain a local draft');
  f.setup.applicationWorkspace = { flush: () => f.setup.flushComment() };
  f.failNextCommentSave();
  await f.setup.navigateDetail(1);
  assert.equal(f.setup.editingApplication?.id, f.application.id);
  assert.equal(f.setup.commentStatus, 'error');
  assert.equal(f.setup.opportunityComment, 'Updated while preparing the application.');
  await f.setup.navigateDetail(1);
  assert.equal(f.setup.editingApplication?.id, second.id);
  assert.equal(f.setup.opportunityComment, '', 'each opportunity has its own evaluation');
  assert.ok(f.commentUpdates.every(update => update.id === f.opportunity.id), 'evaluations save under opportunity IDs, never application IDs');
  assert.equal(f.reviews.value.find(review => review.opportunity_id === f.opportunity.id)?.comment, 'Updated while preparing the application.');
  f.props.tab = 'opportunities';
  await nextTick();
  f.setup.openOpportunity(f.opportunity.id);
  assert.equal(f.setup.opportunityComment, 'Updated while preparing the application.', 'both editors share the same evaluation');
});

test('application evaluation remains available without its live opportunity and is isolated by account', async t => {
  const f = mount(t);
  f.applications.value = [f.application];
  f.opportunities.value = [];
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.application.opportunity_id, state: 'interested', comment: 'Saved before the listing was removed.', reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.props.tab = 'applications';
  await nextTick();
  f.setup.openApplication(f.application);
  assert.equal(f.setup.opportunityComment, 'Saved before the listing was removed.');
  f.setup.opportunityComment = 'Private unsaved application evaluation.';
  f.props.userId = 'account-two';
  await nextTick();
  assert.equal(f.setup.opportunityComment, '');
  assert.deepEqual(f.commentUpdates, [], 'changing accounts cannot send the previous owner’s draft');
});

test('a migrated evaluation opens one persisted value without a write', async t => {
  const f = mount(t), comment = 'Existing personal evaluation.\n\nExisting search feedback.';
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'interested', comment,
    evaluation_revision: 2, reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.setup.openOpportunity(f.opportunity.id);
  assert.equal(f.setup.opportunityComment, comment); assert.equal(f.setup.commentStatus, 'saved');
  await nextTick(); assert.deepEqual(f.commentUpdates, []); assert.deepEqual(f.feedbackUpdates, []);
  assert.equal(await f.setup.flushComment(), true); assert.deepEqual(f.evaluationWrites, []);
  await f.setup.closeOpportunity(); f.setup.openOpportunity(f.opportunity.id);
  assert.equal(f.setup.opportunityComment, comment); assert.deepEqual(f.evaluationWrites, []);
});

test('one full evaluation commit preserves exact text and independent review context', async t => {
  const f = mount(t);
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'strong_interest',
    comment: 'Existing evaluation.\n\nMigrated feedback.', interest_rating: 7.5, evaluation_revision: 4,
    reviewed_updated_at: f.opportunity.updated_at, created_at: '', updated_at: '' }];
  f.setup.openOpportunity(f.opportunity.id);
  const edited = '  Prefer physical sensing experiments.\n ';
  f.setup.opportunityComment = edited; await nextTick(); assert.deepEqual(f.evaluationWrites, []);
  assert.equal(await f.setup.flushComment(), true);
  assert.deepEqual(f.evaluationWrites, ['comment']); assert.deepEqual(f.feedbackUpdates, []);
  const saved = f.reviews.value[0];
  assert.equal(saved.comment, edited); assert.equal(saved.evaluation_revision, 5);
  assert.equal(saved.state, 'strong_interest'); assert.equal(saved.interest_rating, 7.5);
  assert.equal(saved.reviewed_updated_at, f.opportunity.updated_at);
  assert.equal('search_feedback_summary' in saved, false);
  assert.equal(await f.setup.flushComment(), true); assert.deepEqual(f.evaluationWrites, ['comment']);
  await f.setup.closeOpportunity(); f.setup.openOpportunity(f.opportunity.id);
  assert.equal(f.setup.opportunityComment, edited, 'removed text cannot reappear from a second field');
});

test('a full 12000-codepoint Unicode evaluation persists without a stored excerpt', async t => {
  const f = mount(t);
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'interested', comment: 'Existing evaluation.',
    evaluation_revision: 1, reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.setup.openOpportunity(f.opportunity.id);
  const edited = '🧪'.repeat(12000); f.setup.opportunityComment = edited;
  assert.equal(await f.setup.flushComment(), true); assert.equal(f.reviews.value[0].comment, edited);
  assert.equal('search_feedback_summary' in f.reviews.value[0], false); assert.deepEqual(f.feedbackUpdates, []);
  await f.setup.closeOpportunity(); f.setup.openOpportunity(f.opportunity.id);
  assert.equal(f.setup.opportunityComment, edited);
});

test('migrated maximum-length old values load as one complete saved evaluation without writes', async t => {
  const f = mount(t), comment = `${'🧪'.repeat(5000)}\n\n${'🦻'.repeat(600)}`;
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'interested', comment,
    evaluation_revision: 2, reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.setup.openOpportunity(f.opportunity.id);
  assert.equal(f.setup.opportunityComment, comment); assert.equal(Array.from(f.setup.opportunityComment).length, 5602);
  assert.equal(await f.setup.flushComment(), true); await nextTick(); assert.deepEqual(f.evaluationWrites, []);
  await f.setup.closeOpportunity(); assert.equal(f.reviews.value[0].comment, comment);
});

test('an atomic evaluation failure retains the draft and blocks navigation until retry', async t => {
  const f = mount(t);
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'interested', comment: 'Before.',
    evaluation_revision: 1, reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.setup.openOpportunity(f.opportunity.id); f.setup.opportunityComment = 'Only this new evaluation.'; f.failNextCommentSave();
  assert.equal(await f.setup.openList('opportunities'), false); assert.equal(f.setup.selectedOpportunity?.id, f.opportunity.id);
  assert.equal(f.setup.commentStatus, 'error'); assert.equal(f.setup.opportunityComment, 'Only this new evaluation.');
  assert.equal(f.reviews.value[0].comment, 'Before.', 'a failed request cannot partially write a second field');
  assert.equal(await f.setup.openList('opportunities'), true); assert.equal(f.setup.showingDetail, false);
  assert.deepEqual(f.evaluationWrites, ['comment','comment']); assert.deepEqual(f.feedbackUpdates, []);
  f.setup.openOpportunity(f.opportunity.id); assert.equal(f.setup.opportunityComment, 'Only this new evaluation.');
});

test('an owner change during comment persistence cannot write the old feedback into the new account', async t => {
  const f = mount(t), pending = deferred<OpportunityReview | null>();
  f.setup.openOpportunity(f.opportunity.id);
  f.setup.opportunityComment = 'Private original owner assessment.';
  f.handlers.comment = () => pending.promise;
  const flush = f.setup.flushComment();
  await settleUntil(() => f.commentUpdates.length === 1);
  f.props.userId = 'account-two'; await nextTick();
  pending.resolve({ user_id: 'account-one', opportunity_id: f.opportunity.id, state: 'interested',
    comment: 'Private original owner assessment.', reviewed_updated_at: null, created_at: '', updated_at: '' });
  assert.equal(await flush, false);
  assert.deepEqual(f.feedbackUpdates, []);
  assert.equal(f.setup.opportunityComment, '');
});

test('one-time local recovery preserves replacement edits through a failed atomic save', async t => {
  const f = mount(t), legacyKey = `CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:account-one:${f.opportunity.id}`;
  const currentKey = `CV_OPPORTUNITY_COMMENT_DRAFT:account-one:${f.opportunity.id}`;
  f.storage.set(currentKey, JSON.stringify({ value: 'Recovered edited evaluation.' }));
  f.storage.set(legacyKey, JSON.stringify({ value: 'Recovered feedback draft.' }));
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'interested',
    comment: 'Replaced server evaluation.\n\nSaved separate feedback.', evaluation_revision: 2,
    reviewed_updated_at: null, created_at: '', updated_at: '' }];
  f.migrateRecovery(); f.setup.openOpportunity(f.opportunity.id);
  const merged = 'Recovered edited evaluation.\n\nRecovered feedback draft.';
  assert.equal(f.setup.opportunityComment, merged); assert.equal(f.setup.commentStatus, 'unsaved');
  assert.equal(f.storage.has(legacyKey), false, 'the old key moves only after verifying the full current recovery');
  assert.equal(JSON.parse(f.storage.get(currentKey)!).value, merged);
  await nextTick(); assert.deepEqual(f.evaluationWrites, []); f.failNextCommentSave();
  assert.equal(await f.setup.flushComment(), false); assert.equal(f.setup.opportunityComment, merged);
  assert.equal(JSON.parse(f.storage.get(currentKey)!).value, merged);
  assert.equal(await f.setup.flushComment(), true); assert.equal(f.storage.has(currentKey), false);
  assert.equal(f.reviews.value[0].comment, merged);
  assert.doesNotMatch(f.setup.opportunityComment, /Replaced server evaluation|Saved separate feedback/u);
});

test('a newer retired draft from another tab survives a current evaluation save', async t => {
  const f = mount(t), legacyKey = `CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:account-one:${f.opportunity.id}`;
  f.storage.set(legacyKey, JSON.stringify({ value: 'Original recovered feedback.' }));
  f.migrateRecovery(); f.setup.openOpportunity(f.opportunity.id);
  assert.equal(f.setup.opportunityComment, 'Original recovered feedback.');
  f.storage.set(legacyKey, JSON.stringify({ value: 'Newer draft from another tab.' }));
  assert.equal(await f.setup.flushComment(), true);
  assert.equal(JSON.parse(f.storage.get(legacyKey)!).value, 'Newer draft from another tab.');
  assert.equal(f.reviews.value[0].comment, 'Original recovered feedback.');
});

test('application navigation follows sorted filtered results and saves notes before changing the selection', async (t) => {
  const { setup, props, application, applications, failNextNotesSave } = mount(t);
  const make = (id: string, title: string): Application => ({ ...application, id, context_json: { ...application.context_json, title, institution: 'Example University', university: 'Example University' } });
  const alpha = make('alpha', 'Research Alpha');
  const bravo = make('bravo', 'Research Bravo');
  const charlie = make('charlie', 'Research Charlie');
  applications.value = [charlie, { ...make('excluded-status', 'Research Between'), status: 'submitted' }, bravo, make('excluded-query', 'Other role'), alpha];
  props.tab = 'applications';
  await nextTick();
  setup.query = 'Research';
  setup.statusFilter = 'preparation';
  setup.applicationSortBy = 'title';
  assert.deepEqual(setup.filteredApplications.map(item => item.id), ['alpha', 'bravo', 'charlie']);
  setup.openApplication(alpha);
  await setup.navigateDetail(-1);
  assert.equal(setup.editingApplication?.id, alpha.id);
  setup.notes = 'Discuss the start date.';
  failNextNotesSave();
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, alpha.id);
  assert.equal(setup.notes, 'Discuss the start date.');
  assert.equal(setup.notesStatus, 'error');
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, bravo.id);
  assert.equal(applications.value.find(item => item.id === alpha.id)?.notes, 'Discuss the start date.');
  assert.equal(setup.notes, '');
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, charlie.id);
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, charlie.id, 'the last application does not wrap');
  applications.value = applications.value.filter(item => item.id !== bravo.id);
  await setup.navigateDetail(-1);
  assert.equal(setup.editingApplication?.id, alpha.id, 'removed applications are skipped');
  assert.equal(setup.notes, 'Discuss the start date.');
  assert.equal(setup.query, 'Research');
  assert.equal(setup.statusFilter, 'preparation');
  assert.equal(setup.applicationSortBy, 'title');
});

test('workspace list navigation clears same-tab and cross-tab details while internal application links still open details', async (t) => {
  const { setup, props, opportunity, application, storage, created } = mount(t);
  setup.query = 'Robotics';
  setup.openOpportunity(opportunity.id);
  assert.equal(await setup.openList('opportunities'), true);
  await nextTick();
  assert.equal(setup.showingDetail, false);
  assert.equal(storage.has('CV_SELECTED_OPPORTUNITY:account-one'), false);
  assert.equal(setup.query, 'Robotics');
  setup.openOpportunity(opportunity.id);
  await setup.startApplication(opportunity);
  assert.equal(props.tab, 'applications');
  assert.equal(setup.editingApplication?.id, application.id, 'internal creation opens the resulting application');
  setup.query = 'Research';
  assert.equal(await setup.openList('opportunities'), true);
  props.tab = 'opportunities';
  await nextTick();
  assert.equal(setup.showingDetail, false, 'switching to opportunities clears its remembered detail');
  assert.equal(setup.query, 'Robotics');
  assert.equal(await setup.openList('applications'), true);
  props.tab = 'applications';
  await nextTick();
  assert.equal(setup.showingDetail, false, 'switching to applications clears its remembered detail');
  assert.equal(setup.query, 'Research');
  assert.equal(storage.has('CV_SELECTED_APPLICATION:account-one'), false);
  await setup.startApplication(opportunity);
  assert.equal(created(), 1, 'an internal link reopens the existing application');
  assert.equal(setup.editingApplication?.id, application.id);
  assert.equal(await setup.openList('applications'), true);
  assert.equal(setup.showingDetail, false, 'clicking the active applications tab returns to its list');
});

test('workspace list navigation remains in the current detail until evaluation and notes saves succeed', async (t) => {
  const { setup, props, opportunity, application, reviews, applications, failNextCommentSave, failNextNotesSave } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Funding needs clarification.';
  failNextCommentSave();
  assert.equal(await setup.openList('applications'), false);
  assert.equal(props.tab, 'opportunities');
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.opportunityComment, 'Funding needs clarification.');
  assert.equal(await setup.openList('opportunities'), true);
  assert.equal(reviews.value[0].comment, 'Funding needs clarification.');
  await setup.startApplication(opportunity);
  setup.notes = 'Confirm funding before submitting.';
  failNextNotesSave();
  assert.equal(await setup.openList('applications'), false);
  assert.equal(setup.editingApplication?.id, application.id);
  assert.equal(setup.notes, 'Confirm funding before submitting.');
  assert.equal(await setup.openList('applications'), true);
  assert.equal(setup.showingDetail, false);
  assert.equal(applications.value[0].notes, 'Confirm funding before submitting.');
});

test('the latest list request wins and opening a detail cancels a pending list request', async (t) => {
  const { setup, opportunity } = mount(t);
  setup.openOpportunity(opportunity.id);
  const earlier = setup.openList('opportunities');
  const later = setup.openList('applications');
  assert.deepEqual(await Promise.all([earlier, later]), [false, true]);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  const pending = setup.openList('opportunities');
  setup.openOpportunity(opportunity.id);
  assert.equal(await pending, false);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
});

test('opportunity comments save before closing, reopen independently, and can be cleared', async (t) => {
  const { setup, opportunity, opportunities, reviews, commentUpdates } = mount(t);
  const other = normalizeOpportunity({ id: 'other-opportunity', title: 'Different research' });
  opportunities.value.push(other);
  reviews.value = [{ user_id: 'account-one', opportunity_id: opportunity.id, state: 'strong_interest', comment: 'Great supervisor match.', reviewed_updated_at: opportunity.updated_at, created_at: '', updated_at: '' }];
  setup.openOpportunity(opportunity.id);
  assert.equal(setup.opportunityComment, 'Great supervisor match.');
  setup.opportunityComment = 'Strong fit: hands-on robotics and funded research.';
  await setup.closeOpportunity();
  assert.equal(setup.showingDetail, false);
  assert.deepEqual(commentUpdates, [{ id: opportunity.id, comment: 'Strong fit: hands-on robotics and funded research.' }]);
  assert.equal(reviews.value[0].state, 'strong_interest');
  setup.openOpportunity(other.id);
  assert.equal(setup.opportunityComment, '');
  setup.openOpportunity(opportunity.id);
  assert.equal(setup.opportunityComment, commentUpdates[0].comment);
  setup.opportunityComment = '';
  assert.equal(await setup.flushComment(), true);
  assert.equal(reviews.value[0].comment, null);
  assert.equal(reviews.value[0].state, 'strong_interest');
});

test('failed opportunity comment saves retain the draft and detail until retry succeeds', async (t) => {
  const { setup, opportunity, reviews, failNextCommentSave } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Not interesting: the work is mostly theoretical.';
  failNextCommentSave();
  await setup.closeOpportunity();
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.commentStatus, 'error');
  assert.match(setup.commentError, /Could not save your evaluation/);
  assert.equal(setup.opportunityComment, 'Not interesting: the work is mostly theoretical.');
  await setup.closeOpportunity();
  assert.equal(setup.showingDetail, false);
  assert.equal(reviews.value[0].comment, 'Not interesting: the work is mostly theoretical.');
});

test('creating an application flushes opportunity comments and stops when saving fails', async (t) => {
  const { setup, opportunity, reviews, failNextCommentSave, created } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Ask about access to the robotics lab.';
  failNextCommentSave();
  await setup.startApplication(opportunity);
  assert.equal(created(), 0);
  await setup.startApplication(opportunity);
  assert.equal(created(), 1);
  assert.equal(reviews.value[0].comment, 'Ask about access to the robotics lab.');
});

test('switching accounts cancels pending opportunity comments and clears the editor', async (t) => {
  const { setup, props, opportunity, commentUpdates } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Private account-one reasoning.';
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.opportunityComment, '');
  assert.equal(setup.selectedOpportunity, undefined);
  assert.deepEqual(commentUpdates, []);
});

for (const tab of ['opportunities', 'applications'] as const) {
  test(`${tab}: evaluation save feedback starts on commit and stays quiet while typing`, async (t) => {
    const { setup, props, opportunity, application, applications, commentUpdates } = mount(t);
    const { toasts } = useToasts();
    if (tab === 'applications') {
      applications.value = [application];
      props.tab = tab;
      setup.openApplication(application);
    } else setup.openOpportunity(opportunity.id);
    await nextTick();
    assert.equal(toasts.value.length, 0);
    setup.opportunityComment = 'Strong match with my research.';
    await nextTick();
    assert.equal(toasts.value.length, 0);
    assert.deepEqual(commentUpdates, []);
    assert.equal(setup.commentStatus, 'unsaved');
    const commit = setup.flushComment();
    await nextTick();
    assert.equal(toasts.value.length, 1);
    assert.equal(toasts.value[0].message, 'Saving evaluation…');
    const toastId = toasts.value[0].id;
    await commit;
    await nextTick();
    assert.equal(toasts.value.length, 1);
    assert.equal(toasts.value[0].id, toastId);
    assert.equal(toasts.value[0].message, 'Evaluation saved.');
    assert.equal(toasts.value[0].tone, 'success');
    await (tab === 'opportunities' ? setup.closeOpportunity() : setup.closeApplication());
    await nextTick();
    assert.equal(toasts.value[0].message, 'Evaluation saved.', 'closing does not remove the success before it can be seen');
  });

  test(`${tab}: failed evaluation saves offer a toast retry and stale retries cannot save a different account`, async (t) => {
    const { setup, props, opportunity, application, applications, commentUpdates, failNextCommentSave } = mount(t);
    const { toasts } = useToasts();
    if (tab === 'applications') {
      applications.value = [application];
      props.tab = tab;
      setup.openApplication(application);
    } else setup.openOpportunity(opportunity.id);
    await nextTick();
    setup.opportunityComment = 'Funding is unclear.';
    failNextCommentSave();
    await setup.flushComment();
    await nextTick();
    assert.equal(toasts.value.length, 1);
    assert.equal(toasts.value[0].tone, 'error');
    assert.equal(toasts.value[0].action?.label, 'Retry');
    const retry = toasts.value[0].action!.run;
    await retry();
    await nextTick();
    assert.equal(toasts.value.length, 1);
    assert.equal(toasts.value[0].message, 'Evaluation saved.');
    setup.opportunityComment = 'A newer private evaluation.';
    failNextCommentSave();
    await setup.flushComment();
    await nextTick();
    const staleRetry = toasts.value[0].action!.run;
    props.userId = 'account-two';
    await nextTick();
    assert.equal(toasts.value.length, 0);
    const writes = commentUpdates.length;
    await staleRetry();
    assert.equal(commentUpdates.length, writes);
  });
}

test('application evaluation toast retries cannot commit after switching editors', async (t) => {
  const { setup, props, opportunity, application, applications, commentUpdates, failNextCommentSave } = mount(t);
  applications.value = [application];
  props.tab = 'applications';
  setup.openApplication(application);
  await nextTick();
  setup.opportunityComment = 'Keep this evaluation draft.';
  failNextCommentSave();
  await setup.flushComment();
  await nextTick();
  const { toasts } = useToasts();
  const staleRetry = toasts.value[0].action!.run;
  props.tab = 'opportunities';
  setup.openOpportunity(opportunity.id);
  await nextTick();
  const writes = commentUpdates.length;
  await staleRetry();
  assert.equal(commentUpdates.length, writes, 'the old editor cannot commit the shared draft');
  assert.equal(setup.opportunityComment, 'Keep this evaluation draft.');
  await toasts.value[0].action!.run();
  await nextTick();
  assert.equal(toasts.value[0].message, 'Evaluation saved.', 'the active editor can retry');
});

test('standalone workspaces activate sidebar controls by default while accepting explicit inactivity', async (t) => {
  const { props, componentProps } = mount(t);
  assert.equal(componentProps.active, true);
  props.active = false;
  await nextTick();
  assert.equal(componentProps.active, false);
});

test('strong-interest reviews remain filterable for current and past opportunities regardless of score', (t) => {
  const { setup, props, opportunity, opportunities, reviews } = mount(t);
  const past = normalizeOpportunity({ id: 'past', title: 'Materials discovery', deadline: '2025-01-01', personal_fit: opportunityAssessmentFixture(5.8), source_context: 'Materials' });
  opportunities.value.push(past);
  reviews.value = [opportunity, past].map(item => ({ user_id: props.userId, opportunity_id: item.id, state: 'strong_interest', reviewed_updated_at: item.updated_at, created_at: '', updated_at: '' }));
  setup.reviewFilter = 'strong_interest';
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [opportunity.id]);
  setup.deadlineFilter = 'past';
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [past.id]);
  reviews.value[1].state = 'interested';
  assert.equal(setup.filteredOpportunities.length, 0);
});

test('show checkboxes include low-interest and applied opportunities independently and combine with review filters', (t) => {
  const { setup, props, opportunity, opportunities, reviews, applications, application } = mount(t);
  const ignored = normalizeOpportunity({ id: 'ignored', title: 'Ignored opportunity', deadline: null });
  opportunities.value.push(ignored);
  reviews.value = [
    { user_id: props.userId, opportunity_id: opportunity.id, state: 'strong_interest', reviewed_updated_at: null, created_at: '', updated_at: '' },
    { user_id: props.userId, opportunity_id: ignored.id, state: 'not_interested', reviewed_updated_at: null, created_at: '', updated_at: '' },
  ];
  assert.equal(setup.reviewFilter, 'all');
  assert.equal(setup.showLowInterest, false);
  assert.equal(setup.showWithApplications, false);
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [opportunity.id]);
  setup.showLowInterest = true;
  assert.equal(setup.filteredOpportunities.length, 2);
  setup.reviewFilter = 'not_interested';
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [ignored.id]);
  applications.value = [{ ...application, opportunity_id: ignored.id }];
  assert.equal(setup.filteredOpportunities.length, 0);
  setup.showWithApplications = true;
  assert.equal(setup.filteredOpportunities.length, 0, 'the applied opportunity now belongs to Very high interest');
  setup.reviewFilter = 'very_high_interest';
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [ignored.id]);
  setup.showLowInterest = false;
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [ignored.id]);
  applications.value = [];
  assert.equal(setup.filteredOpportunities.length, 0);
  assert.equal(setup.reviewFilter, 'very_high_interest', 'the checkbox preserves the chosen review filter');
});

test('application search matches server codes and full IDs, including applications without a code', async (t) => {
  const { setup, props, application, applications } = mount(t);
  const coded = { ...application, id: '30000000-0000-4000-8000-000000000001', application_code: 'APP-7K4M9Q' };
  const legacy = { ...application, id: '30000000-0000-4000-8000-000000000002', application_code: null };
  applications.value = [coded, legacy];
  props.tab = 'applications';
  await nextTick();
  setup.query = ' app-7k4m9q ';
  assert.deepEqual(setup.filteredApplications.map(item => item.id), [coded.id]);
  setup.query = coded.id;
  assert.deepEqual(setup.filteredApplications.map(item => item.id), [coded.id]);
  setup.query = legacy.id;
  assert.deepEqual(setup.filteredApplications.map(item => item.id), [legacy.id]);
  setup.query = 'Robotics';
  assert.equal(setup.filteredApplications.length, 2, 'title search remains available');
});

test('application status filters include each preparation stage and Ready alongside tracking states', async (t) => {
  const { setup, props, application, applications } = mount(t);
  const statuses = ['preparation', 'refinement', 'attachments', 'ready', 'contacted', 'submitted'] as const;
  applications.value = statuses.map(status => ({ ...application, id: `application-${status}`, status }));
  props.tab = 'applications';
  await nextTick();
  for (const status of statuses) {
    setup.statusFilter = status;
    assert.deepEqual(setup.filteredApplications.map(item => item.id), [`application-${status}`]);
  }
  assert.deepEqual(statuses.slice(0, 4).map(status => setup.statusLabel(status)), ['Preparation', 'Refinement', 'Attachments', 'Ready']);
  setup.statusFilter = '';
  assert.equal(setup.filteredApplications.length, statuses.length);
});

test('application deadline views are exclusive, use captured deadlines and preserve search/status filters', async (t) => {
  const { setup, props, application, applications, opportunities } = mount(t);
  props.tab = 'applications';
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, deadline: unknown, status: Application['status'] = 'preparation'): Application => ({
    ...application, id, status, context_json: { title: `Research ${id}`, deadline },
  });
  applications.value = [make('past', '2026-10-06T11:59:59Z'), make('exact', '2026-10-06T12:00:00Z'),
    make('future', '2026-10-07T12:00:00Z', 'submitted'), make('unknown', null), make('invalid', 'Until filled')];
  opportunities.value = opportunities.value.map(item => ({ ...item, deadline: '2025-01-01' }));
  await nextTick();
  const ids = () => setup.filteredApplications.map(item => item.id).sort();
  assert.equal(setup.applicationDeadlineFilter, 'current');
  assert.deepEqual(ids(), ['exact', 'future', 'invalid', 'unknown']);
  assert.deepEqual(setup.applicationGroups.map(group => group.title), ['']);
  setup.applicationDeadlineFilter = 'past';
  assert.deepEqual(ids(), ['past']);
  assert.equal(setup.deadlineFilter, 'current', 'application and opportunity views are independent');
  setup.statusFilter = 'submitted';
  assert.deepEqual(ids(), []);
  setup.applicationDeadlineFilter = 'current';
  assert.deepEqual(ids(), ['future']);
  setup.query = 'unknown';
  assert.deepEqual(ids(), []);
  setup.statusFilter = '';
  assert.deepEqual(ids(), ['unknown']);
  setup.query = '';
  setup.now = new Date('2026-10-06T12:00:00.001Z');
  assert.ok(!ids().includes('exact'), 'the application moves to Past as its precise deadline passes');
  setup.applicationDeadlineFilter = 'past';
  assert.deepEqual(ids(), ['exact', 'past']);
});

test('deadline sorting reverses only past opportunities and keeps current unknown deadlines last', (t) => {
  const { setup, opportunities } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, deadline: string | null) => normalizeOpportunity({ id, title: id, deadline });
  opportunities.value = [make('later', '2026-10-08T12:00:00Z'), make('a-oldest', '2026-09-01T12:00:00Z'),
    make('unknown', null), make('z-latest', '2026-10-06T11:59:59Z'), make('soon', '2026-10-07T12:00:00Z'),
    make('m-middle', '2026-10-01T12:00:00Z'), make('exact', '2026-10-06T12:00:00Z'), make('invalid', 'Until filled')];
  const ids = () => setup.filteredOpportunities.map(item => item.id);
  assert.deepEqual(ids(), ['exact', 'soon', 'later', 'unknown', 'invalid']);
  setup.deadlineFilter = 'past';
  assert.deepEqual(ids(), ['z-latest', 'm-middle', 'a-oldest']);
  assert.deepEqual(setup.opportunityGroups.flatMap(group => group.items.map(item => item.id)), ids());
  setup.sortBy = 'title';
  assert.deepEqual(ids(), ['a-oldest', 'm-middle', 'z-latest'], 'other sort choices keep their direction');
  setup.sortBy = 'deadline';
  setup.deadlineFilter = 'current';
  assert.deepEqual(ids(), ['exact', 'soon', 'later', 'unknown', 'invalid']);
});

test('deadline sorting shows latest past applications first within each group and keeps current order', async (t) => {
  const { setup, props, application, applications } = mount(t);
  props.tab = 'applications';
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, deadline: string | null, status: Application['status'] = 'preparation'): Application => ({
    ...application, id, status, context_json: { title: id, deadline },
  });
  applications.value = [make('old-applied', '2026-09-01T12:00:00Z', 'submitted'),
    make('later', '2026-10-08T12:00:00Z'), make('old-draft', '2026-08-01T12:00:00Z'),
    make('unknown', null), make('new-draft', '2026-10-04T12:00:00Z', 'ready'),
    make('soon', '2026-10-07T12:00:00Z'), make('new-applied', '2026-10-05T12:00:00Z', 'interview'),
    make('exact', '2026-10-06T12:00:00Z'), make('invalid', 'Until filled')];
  await nextTick();
  const ids = () => setup.filteredApplications.map(item => item.id);
  assert.deepEqual(ids(), ['exact', 'soon', 'later', 'unknown', 'invalid']);
  setup.applicationDeadlineFilter = 'past';
  assert.deepEqual(ids(), ['new-applied', 'new-draft', 'old-applied', 'old-draft']);
  assert.deepEqual(setup.applicationGroups.map(group => [group.key, group.items.map(item => item.id)]), [
    ['applied', ['new-applied', 'old-applied']], ['not-applied', ['new-draft', 'old-draft']],
  ]);
  setup.openApplication(applications.value.find(item => item.id === 'new-applied')!);
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, 'old-applied', 'detail navigation follows the descending group order');
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, 'new-draft');
  await setup.closeApplication();
  setup.applicationDeadlineFilter = 'current';
  assert.deepEqual(ids(), ['exact', 'soon', 'later', 'unknown', 'invalid']);
});

test('past application groups keep sorting within groups, omit empty groups and navigate in displayed order', async (t) => {
  const { setup, props, application, applications, applicationUpdates } = mount(t);
  props.tab = 'applications';
  setup.applicationDeadlineFilter = 'past';
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, status: Application['status']): Application => ({
    ...application, id, status, context_json: { title: id, deadline: '2026-10-01' },
  });
  applications.value = [make('A draft', 'preparation'), make('D submitted', 'submitted'),
    make('B ready', 'ready'), make('C interview', 'interview')];
  setup.applicationSortBy = 'title';
  await nextTick();
  const groups = () => setup.applicationGroups.map(({ key, title, items }) => ({ key, title, ids: items.map(item => item.id) }));
  assert.deepEqual(groups(), [
    { key: 'applied', title: 'Applied', ids: ['C interview', 'D submitted'] },
    { key: 'not-applied', title: 'Not applied', ids: ['A draft', 'B ready'] },
  ]);
  setup.openApplication(applications.value.find(item => item.id === 'D submitted')!);
  await nextTick();
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, 'A draft', 'next follows the group order');
  await setup.closeApplication();
  assert.equal(setup.applicationDeadlineFilter, 'past');
  assert.deepEqual(applicationUpdates, [], 'filtering and grouping do not write application state');
  setup.statusFilter = 'ready';
  assert.deepEqual(groups(), [{ key: 'not-applied', title: 'Not applied', ids: ['B ready'] }]);
  props.lang = 'de';
  await nextTick();
  assert.equal(setup.applicationGroups[0]?.title, 'Nicht beworben');
  setup.query = 'missing';
  assert.deepEqual(groups(), []);
});

test('opening an application from an expired opportunity selects Past and returns to its group', async (t) => {
  const { setup, opportunity, application, handlers } = mount(t);
  const context = { ...application.context_json, deadline: '2025-01-01' };
  const expired = { ...opportunity, deadline: '2025-01-01' };
  handlers.create = async () => ({ ...application, context_json: context });
  setup.deadlineFilter = 'past';
  setup.applicationDeadlineFilter = 'current';
  await setup.startApplication(expired);
  assert.equal(setup.editingApplication?.id, application.id);
  assert.equal(setup.applicationDeadlineFilter, 'past');
  await setup.closeApplication();
  assert.deepEqual(setup.applicationGroups.map(group => [group.key, group.items.map(item => item.id)]), [
    ['not-applied', [application.id]],
  ]);
});

test('tracking dropdown flushes pending notes and selecting Ready starts tracking even when already ready', async (t) => {
  const { setup, opportunity, applications, applicationUpdates } = mount(t);
  await setup.startApplication(opportunity);
  applications.value = applications.value.map(item => ({ ...item, workflow_stage: 'tracking', status: 'ready' }));
  await nextTick();
  setup.notes = 'Ask about the project start date.';
  const select = { value: 'ready' };
  await setup.changeApplicationStatus(setup.editingApplication!, { target: select } as unknown as Event);
  assert.deepEqual(applicationUpdates.map(update => update.changes), [{ notes: 'Ask about the project start date.' }, { status: 'ready' }]);
  assert.equal(setup.editingApplication?.notes, 'Ask about the project start date.');
  assert.equal(setup.editingApplication?.tracking_started, true);
  assert.equal(setup.notesStatus, 'saved');
});

test('closing an application flushes its latest notes and reopening restores the saved value', async (t) => {
  const { setup, opportunity, applications, applicationUpdates } = mount(t);
  await setup.startApplication(opportunity);
  setup.notes = 'A final note before leaving.';
  await setup.closeApplication();
  assert.equal(setup.editingApplication, undefined);
  assert.equal(applications.value[0].notes, 'A final note before leaving.');
  assert.equal(applicationUpdates.length, 1);
  await setup.startApplication(opportunity);
  assert.equal(setup.notes, 'A final note before leaving.');
});

test('failed note autosave keeps the application open and retains the draft for retry', async (t) => {
  const { setup, opportunity, failNextNotesSave } = mount(t);
  await setup.startApplication(opportunity);
  setup.notes = 'Keep this note when the connection fails.';
  failNextNotesSave();
  await setup.closeApplication();
  assert.ok(setup.editingApplication);
  assert.equal(setup.notes, 'Keep this note when the connection fails.');
  assert.equal(setup.notesStatus, 'error');
  await setup.closeApplication();
  assert.equal(setup.editingApplication, undefined);
});

test('opportunity detail preserves filters and stays open after its review removes it from results', async (t) => {
  const { setup, opportunity, receipts, reviews, storage } = mount(t);
  setup.query = 'Robotics';
  setup.openOpportunity(opportunity.id);
  await nextTick();
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.deepEqual(receipts.map(({ id }) => id), [opportunity.id]);
  assert.equal(storage.get('CV_SELECTED_OPPORTUNITY:account-one'), opportunity.id);
  reviews.value = [{ user_id: 'account-one', opportunity_id: opportunity.id, state: 'not_interested', reviewed_updated_at: opportunity.updated_at, created_at: '', updated_at: '' }];
  assert.equal(setup.filteredOpportunities.length, 0);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id, 'selection is independent of current list filters');
  setup.closeOpportunity();
  await nextTick();
  assert.equal(setup.showingDetail, false);
  assert.equal(setup.query, 'Robotics');
  assert.equal(setup.reviewFilter, 'all');
  assert.equal(setup.showLowInterest, false);
  assert.equal(storage.has('CV_SELECTED_OPPORTUNITY:account-one'), false);
});

test('creating and reopening an application preserves opportunity selection and account boundaries', async (t) => {
  const { setup, props, opportunity, application, created } = mount(t);
  setup.query = 'Robotics';
  setup.openOpportunity(opportunity.id);
  await setup.startApplication(opportunity);
  await nextTick();
  assert.equal(props.tab, 'applications');
  assert.equal(setup.editingApplication?.id, application.id);
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.query, '', 'application search remains independent');
  await setup.closeApplication();
  props.tab = 'opportunities';
  await nextTick();
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.query, 'Robotics');
  await setup.startApplication(opportunity);
  assert.equal(created(), 1, 'opening an existing application must not create a duplicate');
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.selectedOpportunity, undefined);
  assert.equal(setup.editingApplication, undefined);
  assert.equal(setup.showingDetail, false);
});

test('deadline options show mutually exclusive current and past opportunities and keep other filters', async (t) => {
  const { setup, opportunities, reviews, applications, application } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, deadline: unknown, extra: Record<string, unknown> = {}) => normalizeOpportunity({
    id, title: `Research ${id}`, deadline, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', ...extra,
  });
  const past = make('past', '2026-10-06T11:59:59Z');
  const exact = make('exact', '2026-10-06T12:00:00Z');
  const current = make('future', '2026-10-07T12:00:00Z');
  const unknown = make('unknown', null);
  const invalid = make('invalid', 'Open until filled');
  const uninterested = make('not-interested', null);
  const applied = make('applied', null);
  opportunities.value = [past, exact, current, unknown, invalid, uninterested, applied];
  reviews.value = [{ user_id: 'account-one', opportunity_id: uninterested.id, state: 'not_interested', reviewed_updated_at: null, created_at: '', updated_at: '' }];
  applications.value = [{ ...application, opportunity_id: applied.id }];
  const ids = () => setup.filteredOpportunities.map(item => item.id).sort();
  assert.equal(setup.deadlineFilter, 'current');
  assert.deepEqual(ids(), ['exact', 'future', 'invalid', 'unknown']);
  setup.deadlineFilter = 'past';
  assert.deepEqual(ids(), ['past'], 'past excludes every current or unknown deadline');
  setup.query = 'unknown';
  assert.deepEqual(ids(), [], 'search still combines with the deadline choice');
  setup.deadlineFilter = 'current';
  assert.deepEqual(ids(), ['unknown']);
  setup.query = '';
  setup.reviewFilter = 'all';
  setup.showLowInterest = true;
  setup.showWithApplications = true;
  assert.deepEqual(ids(), ['applied', 'exact', 'future', 'invalid', 'not-interested', 'unknown']);
  setup.now = new Date('2026-10-06T12:00:00.001Z');
  assert.equal(ids().includes('exact'), false, 'current deadlines expire reactively');
  setup.deadlineFilter = 'past';
  assert.deepEqual(ids(), ['exact', 'past']);
  setup.openOpportunity(past.id);
  await nextTick();
  setup.closeOpportunity();
  assert.equal(setup.deadlineFilter, 'past', 'opening and closing does not reset the chosen deadline view');
});

test('personal fit sorts current numeric assessments high to low within groups, with zero before unknown', (t) => {
  const { setup, opportunities } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, score: number | null, extra: Record<string, unknown> = {}) => normalizeOpportunity({
    id, title: id, deadline: null,
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    personal_fit: opportunityAssessmentFixture(score), ...extra,
  });
  const missing = make('unknown', null), zero = make('zero', 0), nine = make('nine', 9.1), ten = make('ten', 10);
  const recent = make('recent-eight', 8, { created_at: '2026-10-06T11:00:00Z', updated_at: '2026-10-06T11:00:00Z' });
  opportunities.value = [missing, zero, nine, recent, ten];
  setup.sortBy = 'personal_fit';
  assert.deepEqual(setup.opportunityGroups.map(({ key, items }) => [key, items.map(item => item.id)]), [
    ['recent', ['recent-eight']], ['other', ['ten', 'nine', 'zero', 'unknown']],
  ]);
  for (const score of [-1, 11, NaN, Infinity, true, '', '9.8 / 10', 'high']) {
    assert.throws(() => normalizeOpportunity({ id: 'invalid', personal_fit: { score, scale_min: 0, scale_max: 10, summary: 'Invalid assessment' } }), /invalid canonical record/);
  }
  assert.throws(() => normalizeOpportunity({ id: 'nested-old-fit', data: { personal_fit: { score: 9.1 } } }), /invalid canonical record/);
});

test('salary sorting uses validated affordability scores, keeps zero above unknown, and preserves recency groups', (t) => {
  const { setup, opportunities } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const assessment = (score: number | null, otherScore = 5) => ({
    ...livingStandardFixture,
    factors: Object.fromEntries(Object.entries(livingStandardFixture.factors).map(([key, factor]) =>
      [key, { ...factor, score: key === 'affordability' ? score : otherScore }])),
  });
  const make = (id: string, living_standard: unknown, extra: Record<string, unknown> = {}) => normalizeOpportunity({
    id, title: id, deadline: null, salary: { amount: 999999 },
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    data: living_standard === undefined ? {} : { living_standard }, ...extra,
  });
  const high = make('high-salary', assessment(9, 0));
  const low = make('low-salary', assessment(5, 10));
  const zero = make('zero', assessment(0));
  const unknown = make('unknown', assessment(null));
  const missing = make('missing', undefined);
  const recent = make('recent-seven', assessment(7), { created_at: '2026-10-06T11:00:00Z', updated_at: '2026-10-06T11:00:00Z' });
  opportunities.value = [unknown, zero, low, missing, high, recent];
  setup.sortBy = 'salary_score';
  assert.deepEqual(setup.opportunityGroups.map(({ key, items }) => [key, items.map(item => item.id)]), [
    ['recent', ['recent-seven']], ['other', ['high-salary', 'low-salary', 'zero', 'unknown', 'missing']],
  ], 'the salary verdict, not total living standard or the raw salary, controls the order');
  for (const invalid of [assessment(-1), assessment(11), { ...assessment(10), version: 2 }]) {
    assert.throws(() => make('invalid', invalid), /invalid canonical record/);
  }
  opportunities.value = [make('unverified', { ...assessment(10), sources: [] }), zero, high];
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), ['high-salary', 'zero', 'unverified'], 'unverified salary assessments remain unrated');
});

test('strong-fit scores use the requested color boundaries without fabricating unknown values', async (t) => {
  const { setup, opportunities, props } = mount(t);
  for (const [score, tone] of [[10, 'red'], [9.6, 'red'], [9.5, 'yellow'], [9.1, 'yellow'], [9, undefined], [8.8, undefined], [0, undefined], [null, undefined]] as const) {
    const item = normalizeOpportunity({ id: 'strong-fit', title: 'Strong fit role', personal_fit: opportunityAssessmentFixture(score) });
    opportunities.value = [item];
    const parsed = setup.fitScoreById.get(item.id);
    assert.equal(setup.fitTone(parsed), tone, String(score));
    assert.equal(setup.fitLabel(parsed), score === null ? '' : String(score));
  }
  props.lang = 'de'; await nextTick();
  assert.equal(setup.fitLabel(9.6), '9,6');
});

test('personal-fit badges use only the canonical assessment', (t) => {
  const { setup, opportunities } = mount(t);
  for (const [score, visible] of [[9.01, true], [9.1, true], [9.5, true], [9.6, true], [10, true],
    [9, false], [8.8, false], [0, false], [null, false]] as const) {
    const item = normalizeOpportunity({ id: 'fit-badge', personal_fit: opportunityAssessmentFixture(score) });
    opportunities.value = [item];
    assert.equal(setup.showPersonalFitBadge(item), visible, String(score));
  }
  const unknown = normalizeOpportunity({ id: 'unknown' });
  opportunities.value = [unknown];
  assert.equal(setup.showPersonalFitBadge(unknown), false, 'unknown assessments cannot invent a numeric score');
  assert.throws(() => normalizeOpportunity({ id: 'retired-flag', particularly_suitable: true }), /invalid canonical record/);
});

test('only unseen additions and updates from the last 24 hours form a separate group', async (t) => {
  const { setup, opportunities, reviews, receipts } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const old = '2026-10-01T12:00:00Z';
  const recent = '2026-10-06T11:00:00Z';
  const make = (id: string, title: string, created: string, updated: string) => normalizeOpportunity({
    id, title, institution: title.startsWith('A') ? 'Zulu University' : 'Alpha University', deadline: null,
    created_at: created, updated_at: updated,
  });
  const added = make('added', 'Alpha engineering', recent, recent);
  const updated = make('updated', 'Zulu engineering', old, recent);
  const oldUnseen = make('old-unseen', 'Beta engineering', old, old);
  const oldChanged = make('old-changed', 'Gamma physics', old, '2026-10-04T12:00:00Z');
  const viewed = make('viewed', 'Delta physics', recent, recent);
  const boundary = make('exact-24h', 'Eta engineering', '2026-10-05T12:00:00Z', '2026-10-05T12:00:00Z');
  opportunities.value = [viewed, oldUnseen, updated, added, oldChanged, boundary];
  reviews.value = [
    { user_id: 'account-one', opportunity_id: updated.id, state: 'unreviewed', reviewed_updated_at: old, created_at: old, updated_at: old },
    { user_id: 'account-one', opportunity_id: oldChanged.id, state: 'unreviewed', reviewed_updated_at: old, created_at: old, updated_at: old },
    { user_id: 'account-one', opportunity_id: viewed.id, state: 'unreviewed', reviewed_updated_at: recent, created_at: recent, updated_at: recent },
  ];
  setup.sortBy = 'title';
  const groupedIds = () => setup.opportunityGroups.map(({ key, items }) => [key, items.map(item => item.id)]);
  assert.deepEqual(groupedIds(), [['recent', ['added', 'updated']], ['other', ['old-unseen', 'viewed', 'exact-24h', 'old-changed']]]);
  assert.deepEqual(setup.opportunityGroups.map(group => group.title), ['New & updated · 24h', 'Other opportunities']);
  assert.equal(setup.recencyById.get(boundary.id), null, 'exactly 24 hours is outside the recent group and tag');
  assert.equal(setup.recencyById.get(oldUnseen.id), null);
  assert.equal(setup.recencyById.get(oldChanged.id), null);
  assert.equal(setup.unseenById.get(oldUnseen.id), 'new', 'old unseen rows keep their left-border styling');
  assert.equal(setup.unseenById.get(oldChanged.id), 'updated', 'old unseen changes keep their updated left-border styling');
  assert.equal(setup.unseenById.get(viewed.id), null);
  setup.sortBy = 'institution';
  assert.deepEqual(groupedIds()[0], ['recent', ['updated', 'added']], 'other sorting applies within the recent group');
  setup.query = 'engineering';
  assert.deepEqual(groupedIds(), [['recent', ['updated', 'added']], ['other', ['old-unseen', 'exact-24h']]]);
  setup.openOpportunity(added.id);
  assert.deepEqual(groupedIds(), [['recent', ['updated']], ['other', ['old-unseen', 'exact-24h', 'added']]], 'opening removes the row from the recent group immediately, without waiting for its remote receipt');
  assert.equal(setup.unseenById.get(added.id), null);
  await nextTick();
  assert.deepEqual(receipts.map(({ id }) => id), [added.id]);
  setup.closeOpportunity();
  assert.equal(setup.query, 'engineering');
  assert.equal(setup.sortBy, 'institution');
  setup.now = new Date('2026-10-07T11:00:00Z');
  assert.deepEqual(groupedIds(), [['other', ['old-unseen', 'updated', 'exact-24h', 'added']]]);
  assert.equal(setup.opportunityGroups[0].title, '', 'a lone ordinary group has no heading');
  assert.equal(setup.recencyById.get(updated.id), null, 'the clock removes a stale 24h badge');
  assert.equal(setup.unseenById.get(updated.id), 'updated', 'expiration preserves its unread border until viewed');
});

test('opening timestamp-less opportunities acknowledges them locally until the account changes', async (t) => {
  const { setup, opportunities, props } = mount(t);
  const item = normalizeOpportunity({ id: 'without-version', title: 'Undated role' });
  opportunities.value = [item];
  assert.equal(setup.unseenById.get(item.id), 'new');
  setup.openOpportunity(item.id);
  assert.equal(setup.unseenById.get(item.id), null);
  assert.equal(setup.recencyById.get(item.id), null);
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.unseenById.get(item.id), 'new');
});

test('restoring opportunity detail records a visit and account changes clear local visits', async (t) => {
  const { setup, props, opportunity, receipts } = mount(t, { restoredOpportunityId: 'opportunity-one' });
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.unseenById.get(opportunity.id), null);
  assert.deepEqual(receipts.map(({ id }) => id), [opportunity.id]);
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.unseenById.get(opportunity.id), 'new');
  assert.equal(setup.showingDetail, false);
});

test('application detail removal requires confirmation and cancellation preserves the selected item', async (t) => {
  const { setup, opportunity, application, removed } = mount(t);
  let dialogOpened = false;
  setup.removalDialog = { showModal() { dialogOpened = true; }, close() { dialogOpened = false; } };
  await setup.startApplication(opportunity);
  await setup.requestDetailRemoval(application);
  assert.equal(dialogOpened, true);
  assert.equal(setup.removingId, application.id);
  assert.deepEqual(removed, []);
  setup.cancelRemoval();
  assert.equal(dialogOpened, false);
  assert.equal(setup.removingId, null);
  assert.equal(setup.editingApplication?.id, application.id);
  assert.deepEqual(removed, []);
  await setup.requestDetailRemoval(application);
  await setup.confirmRemoval(application);
  assert.deepEqual(removed, [application.id]);
  assert.equal(dialogOpened, false);
  assert.equal(setup.editingApplication, undefined);
});

test('manual Past disposition filters opportunities and linked applications without changing their facts or outcomes', async t => {
  const f = mount(t), facts = JSON.stringify(f.opportunity), outcome = f.application.status;
  f.applications.value = [f.application]; f.setup.showWithApplications = true;
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'strong_interest', manually_archived: true,
    technical_issue_category: 'requirements', technical_issue_note: 'Required prior degree cannot be met.', reviewed_updated_at: null, created_at: '', updated_at: '' }];
  assert.equal(f.setup.filteredOpportunities.length, 0);
  assert.equal(f.setup.filteredApplications.length, 0);
  f.setup.deadlineFilter = 'past'; f.setup.applicationDeadlineFilter = 'past';
  assert.deepEqual(f.setup.filteredOpportunities.map((item: Opportunity) => item.id), [f.opportunity.id]);
  assert.deepEqual(f.setup.filteredApplications.map((item: Application) => item.id), [f.application.id]);
  assert.equal(JSON.stringify(f.opportunity), facts); assert.equal(f.application.status, outcome);
  assert.equal(f.reviews.value[0]?.state, 'strong_interest');
});

test('manual Past changes keep the open opportunity and Back follows the confirmed list status', async t => {
  const f = mount(t); f.setup.openOpportunity(f.opportunity.id);
  f.reviews.value = [{ user_id: f.props.userId, opportunity_id: f.opportunity.id, state: 'interested', manually_archived: true,
    reviewed_updated_at: null, created_at: '', updated_at: '' }];
  await nextTick(); assert.equal(f.setup.selectedOpportunity?.id, f.opportunity.id);
  f.setup.opportunityDisposition = { flush: async () => true };
  await f.setup.closeOpportunity(); assert.equal(f.setup.deadlineFilter, 'past'); assert.equal(f.setup.selectedOpportunity, undefined);
  f.setup.openOpportunity(f.opportunity.id);
  f.reviews.value = [{ ...f.reviews.value[0]!, manually_archived: false }]; await nextTick();
  await f.setup.closeOpportunity(); assert.equal(f.setup.deadlineFilter, 'current');
});

test('failed disposition drafts block opportunity and application navigation', async t => {
  const f = mount(t); f.setup.openOpportunity(f.opportunity.id);
  let saved = false; f.setup.opportunityDisposition = { flush: async () => saved };
  await f.setup.closeOpportunity(); assert.equal(f.setup.selectedOpportunity?.id, f.opportunity.id);
  assert.equal(await f.setup.openList('opportunities'), false);
  saved = true; assert.equal(await f.setup.openList('opportunities'), true);
  f.props.tab = 'applications'; f.applications.value = [f.application]; await nextTick(); f.setup.openApplication(f.application);
  f.setup.applicationDisposition = { flush: async () => false };
  await f.setup.closeApplication(); assert.equal(f.setup.editingApplication?.id, f.application.id);
});


test('the workspace flush contract preserves the complete evaluation and application child order', async t => {
  const f = mount(t, { active: false });
  const order: string[] = [];
  const child = (name: string) => ({ flush: async () => { order.push(name); return true; } });
  f.setup.searchTemplates = child('search');
  f.setup.opportunityFeedback = child('opportunity feedback');
  f.setup.opportunityDisposition = child('opportunity disposition');
  f.setup.applicationFeedback = child('application feedback');
  f.setup.applicationDisposition = child('application disposition');
  f.setup.applicationWorkspace = child('application');
  assert.equal(f.setup.flush, f.setup.flushTextareas, 'legacy callers retain the uniform flush implementation');
  assert.equal(await f.setup.flush(), true, 'an unchanged inactive workspace can still drain its editors');
  assert.deepEqual(order, ['search', 'opportunity feedback', 'opportunity disposition', 'application disposition', 'application feedback',
    'application', 'application feedback', 'application disposition']);
});

test('new native typing during a workspace child save stops later evaluation and application flushes', async t => {
  const f = mount(t);
  f.applications.value = [f.application]; f.props.tab = 'applications'; await nextTick(); f.setup.openApplication(f.application);
  f.setup.notes = 'The existing uncommitted application note';
  f.setup.opportunityComment = 'The existing private evaluation';
  const saving = deferred<boolean>(); let nextChild = 0;
  f.setup.searchTemplates = { flush: () => saving.promise };
  f.setup.applicationWorkspace = { flush: async () => { nextChild++; return true; } };
  const pending = f.setup.flush();
  markTextareaDraftChanged();
  saving.resolve(true);
  assert.equal(await pending, false);
  assert.equal(nextChild, 0); assert.deepEqual(f.commentUpdates, []); assert.deepEqual(f.applicationUpdates, []);
  assert.equal(f.setup.notes, 'The existing uncommitted application note');
  assert.equal(f.setup.opportunityComment, 'The existing private evaluation');
});

test('workspace session epochs reject account and activation A-B-A changes before later child saves', async t => {
  for (const change of ['owner', 'active'] as const) await t.test(change, async t => {
    const f = mount(t); const saving = deferred<boolean>(); let laterFlushes = 0;
    f.setup.searchTemplates = { flush: () => saving.promise };
    f.setup.applicationWorkspace = { flush: async () => { laterFlushes++; return true; } };
    const pending = f.setup.flush();
    if (change === 'owner') f.props.userId = 'another-owner'; else f.props.active = false;
    await nextTick();
    if (change === 'owner') f.props.userId = 'account-one'; else f.props.active = true;
    await nextTick();
    saving.resolve(true);
    assert.equal(await pending, false); assert.equal(laterFlushes, 0);
    assert.deepEqual(f.commentUpdates, []); assert.deepEqual(f.applicationUpdates, []);
  });
});

test('workspace replacement and disposal cannot flush a later child from an obsolete session', async t => {
  for (const change of ['replace-child', 'unmount'] as const) await t.test(change, async t => {
    const f = mount(t); const saving = deferred<boolean>(); let laterFlushes = 0;
    f.setup.searchTemplates = { flush: () => saving.promise };
    f.setup.applicationWorkspace = { flush: async () => { laterFlushes++; return true; } };
    const pending = f.setup.flush();
    if (change === 'replace-child') f.setup.searchTemplates = { flush: async () => true };
    else f.close();
    saving.resolve(true);
    assert.equal(await pending, false); assert.equal(laterFlushes, 0);
  });
});

test('Insights navigation commits pending textareas and awaits the current editor persistence', async t => {
  const f = mount(t), saved = deferred<boolean>();
  let commits = 0, started = 0;
  const unregister = registerTextareaCommit(() => { commits++; });
  t.after(unregister);
  f.setup.searchTemplates = { flush: () => { started++; return saved.promise; } };
  const navigation = f.setup.selectOpportunityView('insights');
  await settleUntil(() => started === 1);
  assert.equal(commits, 1);
  assert.equal(f.setup.opportunityView, 'catalogue');
  saved.resolve(true);
  assert.equal(await navigation, true);
  assert.equal(f.setup.opportunityView, 'insights');
  assert.equal(f.setup.showingInsights, true);
  assert.equal(f.setup.showingOpportunitySubview, true);
});

test('failed feedback persistence keeps the existing view instead of opening Insights', async t => {
  const f = mount(t);
  f.setup.opportunityFeedback = { flush: async () => false };
  assert.equal(await f.setup.selectOpportunityView('insights'), false);
  assert.equal(f.setup.opportunityView, 'catalogue');
  assert.equal(f.setup.showingInsights, false);
});

test('Insights navigation rejects an obsolete account save and clears the view on account changes', async t => {
  const f = mount(t), saved = deferred<boolean>();
  let started = false;
  f.setup.searchTemplates = { flush: () => { started = true; return saved.promise; } };
  const navigation = f.setup.selectOpportunityView('insights');
  await settleUntil(() => started);
  f.props.userId = 'account-two'; await nextTick();
  saved.resolve(true);
  assert.equal(await navigation, false);
  assert.equal(f.setup.opportunityView, 'catalogue');
  f.setup.searchTemplates = null;
  assert.equal(await f.setup.selectOpportunityView('insights'), true);
  f.props.userId = 'account-three'; await nextTick();
  assert.equal(f.setup.opportunityView, 'catalogue');
  assert.equal(f.setup.showingInsights, false);
});

test('opening an Insights job flushes drafts and opens its complete opportunity despite Results filters', async t => {
  const f = mount(t), saved = deferred<boolean>();
  assert.equal(await f.setup.selectOpportunityView('insights'), true);
  f.setup.query = 'A different opportunity';
  assert.equal(f.setup.filteredOpportunities.length, 0);
  let started = 0;
  const progress: string[] = [];
  const unregister = registerTextareaCommit(() => { progress.push('commit'); });
  t.after(unregister);
  f.setup.opportunityFeedback = { flush: () => { started++; progress.push('feedback'); return saved.promise; } };
  const navigation = f.setup.openInsightOpportunity(f.opportunity.id);
  await settleUntil(() => started === 1);
  assert(progress.indexOf('commit') >= 0 && progress.indexOf('commit') < progress.indexOf('feedback'));
  assert.equal(f.setup.opportunityView, 'insights');
  assert.equal(f.setup.showingDetail, false);
  saved.resolve(true);
  assert.equal(await navigation, true);
  await nextTick();
  assert.equal(f.setup.opportunityView, 'catalogue');
  assert.equal(f.setup.selectedOpportunity?.id, f.opportunity.id);
  assert.equal(f.setup.showingDetail, true);
  assert.equal(f.setup.query, 'A different opportunity', 'opening a selected job preserves Results filters');
  assert.equal(f.receipts.at(-1)?.id, f.opportunity.id, 'the standard opportunity visit path is retained');
});

test('failed persistence or missing records cannot leave Insights through its opportunity action', async t => {
  const f = mount(t);
  assert.equal(await f.setup.selectOpportunityView('insights'), true);
  let flushed = 0;
  f.setup.opportunityFeedback = { flush: async () => { flushed++; return false; } };
  assert.equal(await f.setup.openInsightOpportunity('not-in-this-catalogue'), false);
  assert.equal(flushed, 0, 'an unknown record cannot trigger navigation persistence');
  assert.equal(await f.setup.openInsightOpportunity(f.opportunity.id), false);
  assert.equal(flushed, 1);
  assert.equal(f.setup.opportunityView, 'insights');
  assert.equal(f.setup.selectedOpportunity, undefined);
  assert.equal(f.receipts.length, 0);
});

test('pending Insights opportunity navigation cannot outlive its account, view, or record', async t => {
  for (const changed of ['account', 'tab', 'active', 'record', 'newer navigation'] as const) {
    await t.test(changed, async current => {
      const f = mount(current), saved = deferred<boolean>();
      assert.equal(await f.setup.selectOpportunityView('insights'), true);
      let started = 0;
      f.setup.opportunityFeedback = { flush: () => { started++; return saved.promise; } };
      const navigation = f.setup.openInsightOpportunity(f.opportunity.id);
      await settleUntil(() => started === 1);
      let replacement: Promise<boolean> | undefined;
      if (changed === 'account') f.props.userId = 'account-two';
      else if (changed === 'tab') f.props.tab = 'applications';
      else if (changed === 'active') f.props.active = false;
      else if (changed === 'record') f.opportunities.value = [];
      else {
        replacement = f.setup.selectOpportunityView('searches');
        await settleUntil(() => started === 2);
      }
      await nextTick();
      saved.resolve(true);
      assert.equal(await navigation, false);
      if (replacement) assert.equal(await replacement, true);
      assert.equal(f.setup.selectedOpportunity, undefined);
      assert.equal(f.receipts.length, 0);
      assert.equal(f.setup.opportunityView, changed === 'account' ? 'catalogue' : changed === 'newer navigation' ? 'searches' : 'insights');
    });
  }
});


test('application interest is disabled in both result and detail selectors', () => {
  assert.match(source, /:value="reviewSelection\(item.id\)" :disabled="applicationByOpportunity.has\(item.id\)"/);
  assert.match(source, /:value="reviewSelection\(selectedOpportunity.id\)" :disabled="applicationByOpportunity.has\(selectedOpportunity.id\)"/);
});
