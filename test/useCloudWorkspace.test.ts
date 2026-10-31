import { opportunityFixture, opportunityAssessmentFixture } from './fixtures/opportunity';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { effectScope, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, OpportunityReview } from '../src/app/cloudTypes';
import { createCloudCvSnapshot } from '../src/documents/privacy/domain/cloudCvPrivacy';
import { normalizeOpportunity as readOpportunity, useCloudWorkspace } from '../src/app/composables/useCloudWorkspace';
import { opportunityRecency } from '../src/features/opportunities/domain/opportunityRecency';
import { createTestState, stub } from './helpers';

const normalizeOpportunity = (input: Record<string, unknown> & { id: string }) => readOpportunity(opportunityFixture(input));

interface Query {
  table: string;
  operation: 'select' | 'update' | 'rpc' | 'upsert';
  fields?: string;
  filters: Record<string, unknown>;
  payload?: Record<string, unknown>;
  range?: [number, number];
  single?: boolean;
  signal?: AbortSignal;
  orderColumn?: string;
  onConflict?: string;
}
interface Result { data: unknown; error: unknown; count?: number }
function fakeClient(handler: (query: Query) => Result | Promise<Result>) {
  const queries: Query[] = [];
  function query(table: string, operation: Query['operation'] = 'select', payload?: Record<string, unknown>) {
    const request: Query = { table, operation, filters: {}, payload };
    const builder = {
      select(fields: string) { request.fields = fields; return builder; },
      order(column: string) { request.orderColumn = column; return builder; },
      range(from: number, to: number) { request.range = [from, to]; return builder; },
      eq(key: string, value: unknown) { request.filters[key] = value; return builder; },
      abortSignal(signal: AbortSignal) { request.signal = signal; return builder; },
      single() { request.single = true; return builder; },
      update(value: Record<string, unknown>) { request.operation = 'update'; request.payload = value; return builder; },
      upsert(value: Record<string, unknown>, options: { onConflict: string }) { request.operation = 'upsert'; request.payload = value; request.onConflict = options.onConflict; return builder; },
      then(resolve: (result: Result) => unknown, reject: (reason: unknown) => unknown) {
        queries.push(request);
        return Promise.resolve().then(() => handler(request)).then(result => request.table === 'opportunities' && Array.isArray(result.data)
          ? { ...result, data: result.data.map(value => opportunityFixture(value)) } : result).then(resolve, reject);
      },
    };
    return builder;
  }
  return { queries, client: stub<SupabaseClient>({ from: query, rpc: (name: string, parameters: Record<string, unknown>) => query(name, 'rpc', parameters) }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function settleUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('The asynchronous operation did not settle.');
}
function application(id = 'application-1', cvId: string | null = 'cv-1'): Application {
  return { id, user_id: 'account-a', opportunity_id: 'opportunity-1', cv_variant_id: cvId,
    contact_email: 'employer@example.org', status: 'preparation', completed_checklist_keys: [], notes: null, contacted_at: null, submitted_at: null,
    context_json: { title: 'Researcher', requirements: ['Degree'], supervisor_research_focus: { robotics: 'Applied robotics' }, supervisor_top_papers: [{ title: 'Paper', year: 2025 }] },
    context_captured_at: '2026-09-19T16:00:00.000Z',
    created_at: '2026-09-19T16:00:00.000Z', updated_at: '2026-09-19T16:00:00.000Z' };
}

function review(opportunityId = 'opportunity-1', state: OpportunityReview['state'] = 'interested'): OpportunityReview {
  return { user_id: 'account-a', opportunity_id: opportunityId, state, evaluation_revision: 0, reviewed_updated_at: null, created_at: '2026-09-19T16:00:00.000Z', updated_at: '2026-09-19T16:00:00.000Z' };
}

function localDrafts(t: TestContext) {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  return values;
}
const oldEvaluationDraft = (owner: string, id = 'opportunity-1') => `CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:${owner}:${id}`;
const evaluationDraft = (owner: string, id = 'opportunity-1') => `CV_OPPORTUNITY_COMMENT_DRAFT:${owner}:${id}`;
const recovery = (value: string) => JSON.stringify({ value });

test('workspace loading migrates local recovery once before publishing saved evaluations or opening records', async t => {
  const values = localDrafts(t);
  values.set(oldEvaluationDraft('account-a'), recovery('Recovered feedback.'));
  values.set(oldEvaluationDraft('account-a', 'opportunity-2'), recovery('Other recovered feedback.'));
  values.set(evaluationDraft('account-a', 'opportunity-2'), recovery('Newer local evaluation.'));
  values.set(oldEvaluationDraft('account-b'), recovery('Other account feedback.'));
  const stored = [{ ...review(), comment: 'Saved complete evaluation.' },
    { ...review('opportunity-2'), comment: 'Replaced server evaluation.' }];
  const { client, queries } = fakeClient(query => ({ data: query.table === 'opportunities'
    ? [{ id: 'opportunity-1' }, { id: 'opportunity-2' }] : query.table === 'opportunity_reviews'
      ? query.filters.user_id === 'account-a' ? stored : [{ ...review(), user_id: 'account-b', comment: 'Other account saved evaluation.' }]
      : [], error: null }));
  const scope = effectScope(); t.after(() => scope.stop());
  const account = ref('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  const published: { saved: string | null | undefined; draft: string | undefined }[] = [];
  scope.run(() => watch(workspace.opportunities, opportunities => {
    if (opportunities.length) published.push({ saved: workspace.reviews.value[0]?.comment, draft: values.get(evaluationDraft(account.value)) });
  }, { flush: 'sync' }));
  await settleUntil(() => !workspace.loading.value);
  assert.deepEqual(published[0], { saved: 'Saved complete evaluation.', draft: recovery('Saved complete evaluation.\n\nRecovered feedback.') });
  assert.equal(values.get(evaluationDraft('account-a', 'opportunity-2')), recovery('Newer local evaluation.\n\nOther recovered feedback.'));
  assert.equal(values.has(oldEvaluationDraft('account-a')), false);
  assert.equal(values.get(oldEvaluationDraft('account-b')), recovery('Other account feedback.'));
  const first = [...values];
  assert.equal(await workspace.refresh(), true);
  assert.deepEqual([...values], first, 'refresh does not duplicate already migrated recovery text');
  account.value = 'account-b'; await settleUntil(() => !workspace.loading.value);
  assert.equal(values.get(evaluationDraft('account-b')), recovery('Other account saved evaluation.\n\nOther account feedback.'));
  assert.equal(values.get(evaluationDraft('account-a')), recovery('Saved complete evaluation.\n\nRecovered feedback.'));
  assert.equal(queries.some(query => query.operation !== 'select'), false, 'recovery migration does not save or approve cloud data');
});

test('a stale account load cannot migrate or clear that account’s pending evaluation recovery', async t => {
  const values = localDrafts(t);
  values.set(oldEvaluationDraft('account-a'), recovery('Owner A unsaved feedback.'));
  values.set(oldEvaluationDraft('account-b'), recovery('Owner B unsaved feedback.'));
  const staleReviews = deferred<Result>();
  const { client, queries } = fakeClient(query => query.table === 'opportunity_reviews' && query.filters.user_id === 'account-a'
    ? staleReviews.promise : { data: query.table === 'opportunities' ? [{ id: 'opportunity-1' }] : query.table === 'opportunity_reviews'
      ? [{ ...review(), user_id: 'account-b', comment: 'Owner B saved evaluation.' }] : [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const account = ref('account-a'), workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => queries.some(query => query.table === 'opportunity_reviews' && query.filters.user_id === 'account-a'));
  account.value = 'account-b'; await settleUntil(() => !workspace.loading.value);
  staleReviews.resolve({ data: [{ ...review(), comment: 'Owner A saved evaluation.' }], error: null });
  await workspace.refresh();
  assert.equal(values.get(oldEvaluationDraft('account-a')), recovery('Owner A unsaved feedback.'));
  assert.equal(values.has(evaluationDraft('account-a')), false);
  assert.equal(values.get(evaluationDraft('account-b')), recovery('Owner B saved evaluation.\n\nOwner B unsaved feedback.'));
  assert.equal(workspace.reviews.value[0].user_id, 'account-b');
});

test('opportunity reader preserves the current structured catalogue without a second raw representation', () => {
  const row = opportunityFixture({ id: 'job', title: 'Researcher', institution: 'Institute',
    contacts: [{ entity_id: 'person', name: 'Professor Example', email: 'employer@example.org', roles: ['Scientific contact'] }],
    supervisors: [{ entity_id: 'supervisor', name: 'Professor Example', roles: ['Supervisor'] }],
    salary: { amount: 50000, currency: 'EUR' }, topics: ['Robotics'], personal_fit: opportunityAssessmentFixture(8.7),
    requirements: [{ entity_id: 'degree', text: 'Degree', status: 'required', stage: 'recruitment' }],
    supervisor_research_focus: { profiles: [{ entity_id: 'focus', name: 'Professor Example', topics: ['Applied robotics'] }] },
    supervisor_top_papers: [{ entity_id: 'paper', title: 'Paper', year: 2025 }] });
  const result = readOpportunity(row);
  assert.strictEqual(result, row);
  assert.equal(result.institution, 'Institute');
  assert.strictEqual(result.contacts, row.contacts);
  assert.strictEqual(result.supervisors, row.supervisors);
  assert.strictEqual(result.salary, row.salary);
  assert.strictEqual(result.personal_fit, row.personal_fit);
  for (const retired of ['university', 'contact', 'supervisor', 'salary_text', 'hardware_software_profile', 'details']) assert.equal(Object.hasOwn(result, retired), false);
});

test('current catalogue reader rejects retired aliases and malformed nested field shapes', () => {
  const row = opportunityFixture({ id: 'canonical', institution: 'Current institute' });
  for (const patch of [{ university: 'Retired alias' }, { contact: [] }, { supervisor: 'Old supervisor' },
    { salary_text: 'Retired salary' }, { personal_fit: '9 / 10' }, { personal_fit: { score: '9', scale_min: 0, scale_max: 10, summary: 'Legacy score' } },
    { contacts: ['Professor Example'] }, { requirements: ['Degree'] }, { data: { personal_fit: { score: 9 } } }, { metadata_schema_version: 4 }]) {
    assert.throws(() => readOpportunity({ ...row, ...patch }), /invalid canonical record/);
  }
});

test('standalone mode performs no cloud calls and pagination loads all shared opportunities', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.table === 'opportunities'
    ? Array.from({ length: query.range?.[0] === 0 ? 500 : 2 }, (_, index) => ({ id: String((query.range?.[0] ?? 0) + index), title: 'Researcher' })) : [], error: null }));
  const scope = effectScope();
  const account = ref<string | null>(null);
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  assert.equal(await workspace.refresh(), false);
  assert.equal(queries.length, 0);
  account.value = 'account-a';
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.opportunities.value.length, 502);
  assert.deepEqual(queries.filter(({ table }) => table === 'opportunities').map(({ range }) => range), [[0, 499], [500, 999]]);
  assert.ok(queries.filter(({ table }) => table === 'opportunities').every(({ filters }) => !('user_id' in filters)));
  const catalogueFields = queries.find(({ table }) => table === 'opportunities')?.fields?.split(',') || [];
  assert.ok(catalogueFields.includes('institution') && catalogueFields.includes('personal_fit'));
  assert.equal(catalogueFields.includes('*') || catalogueFields.includes('university') || catalogueFields.includes('details'), false);
  assert.ok(queries.filter(({ table }) => table !== 'opportunities').every(({ filters }) => filters.user_id === 'account-a'));
  assert.equal(queries.find(({ table }) => table === 'cv_variants')?.fields?.includes('content_json'), false);
  assert.equal(queries.find(({ table }) => table === 'opportunity_reviews')?.orderColumn, 'opportunity_id');
  scope.stop();
});

test('account changes clear old rows immediately and discard late network replies', async () => {
  const oldRead = deferred<Result>();
  let hold = false;
  const { client, queries } = fakeClient((query) => hold ? oldRead.promise : { data: query.table === 'opportunities'
    ? [{ id: 'job-a', title: 'Old catalogue row' }] : query.table === 'applications' ? [application()] : query.table === 'opportunity_reviews' ? [review()] : [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.applications.value.length, 1);
  assert.equal(workspace.reviews.value.length, 1);
  hold = true;
  const reading = workspace.refresh();
  await settleUntil(() => queries.length === 8);
  account.value = null;
  assert.deepEqual(workspace.applications.value, []);
  assert.deepEqual(workspace.opportunities.value, []);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.error.value, '');
  assert.ok(queries.slice(4).every(({ signal }) => signal?.aborted));
  oldRead.resolve({ data: [application('stale-application')], error: null });
  assert.equal(await reading, false);
  assert.deepEqual(workspace.applications.value, []);
  scope.stop();
});

test('pagination also honors projects with an API row limit below the requested page size', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.table === 'opportunities'
    ? Array.from({ length: Math.min(100, 230 - (query.range?.[0] ?? 0)) }, (_, index) => ({ id: String((query.range?.[0] ?? 0) + index), title: 'Researcher' })) : [],
  count: query.table === 'opportunities' ? 230 : 0, error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.opportunities.value.length, 230);
  assert.deepEqual(queries.filter(({ table }) => table === 'opportunities').map(({ range }) => range?.[0]), [0, 100, 200]);
  scope.stop();
});

test('one-click create retries reuse RPC IDs, preserve server context, and never upload CV data', async () => {
  let rpcAttempts = 0;
  let persisted: ReturnType<typeof application> | null = null;
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      rpcAttempts++;
      persisted = { ...application(String(query.payload?.p_application_id), null), contact_email: null };
      return rpcAttempts === 1 ? { data: null, error: { message: 'Network response lost' } } : { data: persisted.id, error: null };
    }
    return { data: query.single ? persisted : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const input = { opportunityId: 'opportunity-1' };
  assert.equal(await workspace.createApplication(input), null);
  assert.match(workspace.error.value, /Could not save/);
  const result = await workspace.createApplication(input);
  assert.ok(result);
  const rpcCalls = queries.filter(({ operation }) => operation === 'rpc');
  assert.deepEqual(rpcCalls[0].payload, rpcCalls[1].payload);
  assert.deepEqual(Object.keys(rpcCalls[0].payload!).sort(), ['p_application_id', 'p_opportunity_id']);
  assert.equal(result.cv_variant_id, null);
  assert.equal(result.contact_email, null);
  assert.deepEqual(result.context_json, application().context_json);
  assert.equal(workspace.applications.value.length, 1);
  assert.deepEqual(workspace.cvVariants.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('server application codes survive list, create, and update roundtrips without becoming client-generated writes', async (t) => {
  let persisted = { ...application('coded-application'), application_code: 'PHD-ServerAssigned_7A' };
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc' && query.table === 'create_job_application') return { data: persisted.id, error: null };
    if (query.operation === 'update' && query.table === 'applications') {
      persisted = { ...persisted, ...query.payload, context_json: { ...persisted.context_json, title: 'A renamed opportunity' } };
      return { data: persisted, error: null };
    }
    return { data: query.table === 'applications' ? query.single ? persisted : [persisted] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.applications.value[0].application_code, 'PHD-ServerAssigned_7A');
  const created = await workspace.createApplication({ opportunityId: 'opportunity-1' });
  assert.equal(created?.application_code, 'PHD-ServerAssigned_7A');
  const updated = await workspace.updateApplication(persisted.id, { notes: 'A local tracking note.', status: 'contacted' });
  assert.equal(updated?.application_code, 'PHD-ServerAssigned_7A');
  assert.equal(updated?.context_json.title, 'A renamed opportunity');
  assert.equal(workspace.applications.value[0].application_code, 'PHD-ServerAssigned_7A');
  const writes = queries.filter(query => query.operation !== 'select');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(query => !Object.hasOwn(query.payload || {}, 'application_code')));
  assert.ok(writes.every(query => !JSON.stringify(query.payload).includes('PHD-ServerAssigned_7A')));
});

test('logout during a write prevents follow-up reads and stale local rows; refresh cannot race a save', async () => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.createApplication({ opportunityId: 'job' });
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const count = queries.length;
  assert.equal(await workspace.refresh(), false);
  assert.equal(queries.length, count);
  account.value = null;
  writing.resolve({ data: 'application-id', error: null });
  assert.equal(await pending, null);
  assert.equal(queries.length, count, 'do not start an application read under the next account');
  assert.deepEqual(workspace.applications.value, []);
  assert.deepEqual(workspace.cvVariants.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('reassigning a CV sends metadata in the same atomic RPC and never overwrites existing CV content', async () => {
  let persisted = application();
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      persisted = { ...persisted, cv_variant_id: String(query.payload?.p_cv_variant_id), status: 'submitted' };
      return { data: persisted.cv_variant_id, error: null };
    }
    return { data: query.single ? persisted : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const updated = await workspace.updateApplication('application-1', { cvState: createTestState(), status: 'submitted', contactEmail: 'employer@example.org', notes: ' Follow up ' });
  assert.ok(updated);
  assert.notEqual(updated.cv_variant_id, 'cv-1');
  const rpc = queries.find(({ operation }) => operation === 'rpc');
  assert.equal(rpc?.table, 'assign_job_application_cv');
  assert.deepEqual(rpc?.payload?.p_changes, { status: 'submitted', contact_email: 'employer@example.org', notes: 'Follow up' });
  assert.equal(queries.some(({ operation }) => operation === 'update'), false);
  scope.stop();
});

test('repeated one-click creates use the existing application ID returned by the server', async () => {
  const existing = application('existing-application', null);
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? { data: existing.id, error: null } : { data: query.single ? existing : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.createApplication({ opportunityId: 'opportunity-1' }))?.id, existing.id);
  assert.equal((await workspace.createApplication({ opportunityId: 'opportunity-1' }))?.id, existing.id);
  assert.equal(workspace.applications.value.length, 1);
  assert.ok(queries.filter(({ single }) => single).every(({ filters }) => filters.id === existing.id && filters.user_id === 'account-a'));
  scope.stop();
});

test('opportunity review RPC updates the current user’s choice without writing the shared catalogue', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.operation === 'rpc'
    ? { ...review(), state: query.payload?.p_state } : query.table === 'opportunity_reviews' ? [review('other-opportunity')] : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.setOpportunityReview('opportunity-1', 'not_interested'))?.state, 'not_interested');
  assert.equal((await workspace.setOpportunityReview('opportunity-1', 'unreviewed'))?.state, 'unreviewed');
  assert.equal(workspace.reviews.value.length, 2);
  assert.equal(workspace.reviews.value.find(({ opportunity_id }) => opportunity_id === 'opportunity-1')?.state, 'unreviewed');
  const writes = queries.filter(({ operation }) => operation === 'rpc');
  assert.equal(writes[0].table, 'review_job_opportunity');
  assert.deepEqual(writes[0].payload, { p_opportunity_id: 'opportunity-1', p_observed_updated_at: null, p_state: 'not_interested' });
  assert.equal(queries.some(({ table, operation }) => table === 'opportunities' && operation !== 'select'), false);
  scope.stop();
});

test('interest saves identify their activity while preserving application order and refresh protection', async (t) => {
  const reviewWrite = deferred<Result>();
  const applicationWrite = deferred<Result>();
  const { client, queries } = fakeClient(query => {
    if (query.table === 'review_job_opportunity') return reviewWrite.promise;
    if (query.table === 'create_job_application') return applicationWrite.promise;
    return { data: query.table === 'applications' && query.single ? application() : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const interest = workspace.setOpportunityReview('opportunity-1', 'strong_interest');
  await settleUntil(() => queries.some(query => query.table === 'review_job_opportunity'));
  assert.equal(workspace.saving.value, true);
  assert.equal(workspace.savingReview.value, true);
  const readsBeforeRefresh = queries.filter(query => query.operation === 'select').length;
  assert.equal(await workspace.refresh(), false, 'a refresh must not replace an outstanding interest write');
  assert.equal(queries.filter(query => query.operation === 'select').length, readsBeforeRefresh);

  const creation = workspace.createApplication({ opportunityId: 'opportunity-1' });
  await Promise.resolve();
  assert.deepEqual(queries.filter(query => query.operation === 'rpc').map(query => query.table), ['review_job_opportunity']);
  assert.equal(workspace.savingReview.value, true, 'a queued application does not misidentify the active review write');
  reviewWrite.resolve({ data: review('opportunity-1', 'strong_interest'), error: null });
  assert.equal((await interest)?.state, 'strong_interest');
  await settleUntil(() => queries.some(query => query.table === 'create_job_application'));
  assert.equal(workspace.saving.value, true);
  assert.equal(workspace.savingReview.value, false, 'application writes keep their existing blocking behavior');
  applicationWrite.resolve({ data: 'application-1', error: null });
  assert.equal((await creation)?.id, 'application-1');
  assert.equal(workspace.reviews.value[0].state, 'strong_interest');
  assert.equal(workspace.saving.value, false);
  assert.equal(workspace.savingReview.value, false);
});

test('interest activity and queued work cannot cross account changes or disposal', async () => {
  const oldWrite = deferred<Result>();
  const newWrite = deferred<Result>();
  const { client, queries } = fakeClient(query => query.table === 'review_job_opportunity'
    ? query.payload?.p_opportunity_id === 'old-opportunity' ? oldWrite.promise : newWrite.promise
    : { data: [], error: null });
  const scope = effectScope();
  const account = ref('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const oldInterest = workspace.setOpportunityReview('old-opportunity', 'strong_interest');
  await settleUntil(() => queries.some(query => query.table === 'review_job_opportunity'));
  const queuedCreation = workspace.createApplication({ opportunityId: 'old-opportunity' });
  assert.equal(workspace.savingReview.value, true);
  account.value = 'account-b';
  assert.equal(workspace.savingReview.value, false);
  assert.equal(workspace.saving.value, false);
  assert.equal(workspace.opportunityReviewError.value, '');
  await settleUntil(() => !workspace.loading.value);

  const newInterest = workspace.setOpportunityReview('new-opportunity', 'interested');
  await settleUntil(() => queries.filter(query => query.table === 'review_job_opportunity').length === 2);
  oldWrite.resolve({ data: null, error: { message: 'Old account request failed' } });
  assert.deepEqual(await Promise.all([oldInterest, queuedCreation]), [null, null]);
  assert.equal(queries.some(query => query.table === 'create_job_application'), false);
  assert.equal(workspace.saving.value, true, 'the old request must not clear the new account’s active save');
  assert.equal(workspace.savingReview.value, true);
  assert.equal(workspace.opportunityReviewError.value, '');
  assert.deepEqual(workspace.reviews.value, []);

  scope.stop();
  assert.equal(workspace.saving.value, false);
  assert.equal(workspace.savingReview.value, false);
  newWrite.resolve({ data: { ...review('new-opportunity'), user_id: 'account-b' }, error: null });
  assert.equal(await newInterest, null);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.opportunityReviewError.value, '');
});

test('late strong-interest writes cannot restore a previous user’s choices after an account change', async () => {
  const saving = deferred<Result>();
  const { client } = fakeClient((query) => query.operation === 'rpc' ? saving.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.setOpportunityReview('opportunity-1', 'strong_interest');
  account.value = 'account-b';
  await settleUntil(() => !workspace.loading.value);
  saving.resolve({ data: review('opportunity-1', 'strong_interest'), error: null });
  assert.equal(await pending, null);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('opportunity comments persist across reloads, interest choices and receipts, and can be cleared', async (t) => {
  const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
  let stored: OpportunityReview = review(source.id, 'unreviewed');
  const { client, queries } = fakeClient((query) => {
    if (query.table === 'save_opportunity_comment') {
      stored = { ...stored, comment: query.payload?.p_comment as string | null, evaluation_revision: (stored.evaluation_revision ?? 0) + 1 };
      return { data: { ...stored }, error: null };
    }
    if (query.table === 'review_job_opportunity') {
      stored = { ...stored, state: (query.payload?.p_state ?? stored.state) as OpportunityReview['state'],
        reviewed_updated_at: query.payload?.p_observed_updated_at as string | null };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'opportunities' ? [source]
      : query.table === 'opportunity_reviews' ? [{ ...stored }] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const saved = await workspace.setOpportunityComment(source.id, '  Excellent research fit.\nDiscuss funding.  ');
  assert.equal(saved?.comment, '  Excellent research fit.\nDiscuss funding.  ');
  assert.equal(saved?.state, 'unreviewed', 'a comment does not choose an interest state');
  assert.equal(saved?.reviewed_updated_at, null, 'a comment does not acknowledge source changes');
  await workspace.markOpportunityReviewed(source);
  await workspace.setOpportunityReview(source.id, 'strong_interest');
  scope.stop();

  const nextScope = effectScope(); t.after(() => nextScope.stop());
  const reloaded = nextScope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !reloaded.loading.value);
  assert.equal(reloaded.reviews.value[0].comment, '  Excellent research fit.\nDiscuss funding.  ');
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.equal((await reloaded.setOpportunityComment(source.id, ' \n\t '))?.comment, ' \n\t ');
  assert.equal((await reloaded.setOpportunityComment(source.id, ''))?.comment, null);
  assert.equal(await reloaded.refresh(), true);
  assert.equal(reloaded.reviews.value[0].comment, null);
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.deepEqual(queries.filter(({ table }) => table === 'save_opportunity_comment').map(({ payload }) => payload), [
    { p_opportunity_id: source.id, p_comment: '  Excellent research fit.\nDiscuss funding.  ' },
    { p_opportunity_id: source.id, p_comment: ' \n\t ' },
    { p_opportunity_id: source.id, p_comment: null },
  ]);
  assert.ok(queries.filter(({ table }) => table === 'opportunities').every(({ operation }) => operation === 'select'));
});

test('invalid or failed comment saves preserve the saved comment and report a useful error', async (t) => {
  const original = { ...review(), comment: 'Location does not work for me.' };
  let response: Result = { data: null, error: { message: 'Offline' } };
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? response
    : { data: query.table === 'opportunity_reviews' ? [original] : [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.setOpportunityComment(original.opportunity_id, '🧪'.repeat(12001)), null);
  assert.match(workspace.opportunityCommentError.value, /12,000 characters/);
  assert.equal(workspace.error.value, '', 'comment errors do not trigger the generic workspace error toast');
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 0);
  assert.equal(await workspace.setOpportunityComment(original.opportunity_id, 'New comment'), null);
  assert.match(workspace.opportunityCommentError.value, /Could not save the opportunity comment/);
  response = { data: null, error: { code: 'PGRST202' } };
  assert.equal(await workspace.setOpportunityComment(original.opportunity_id, 'New comment'), null);
  assert.match(workspace.opportunityCommentError.value, /database setup is incomplete/);
  for (const invalid of [
    { ...original, user_id: 'account-b' },
    { ...original, opportunity_id: 'another-opportunity' },
    { ...original, comment: undefined },
    { ...original, comment: 'New comment', evaluation_revision: undefined },
    { ...original, comment: 'New comment', evaluation_revision: -1 },
    { ...original, comment: 'New comment', evaluation_revision: 0.5 },
    { ...original, comment: 'New comment ' },
  ]) {
    response = { data: invalid, error: null };
    assert.equal(await workspace.setOpportunityComment(original.opportunity_id, 'New comment'), null);
    assert.match(workspace.opportunityCommentError.value, /comment could not be saved/);
    assert.deepEqual(workspace.reviews.value, [original]);
  }
  response = { data: { ...original, comment: '🧪'.repeat(12000) }, error: null };
  assert.ok(await workspace.setOpportunityComment(original.opportunity_id, '🧪'.repeat(12000)));
  assert.equal(workspace.opportunityCommentError.value, '');
  assert.equal(workspace.error.value, '');
});

test('review, comment and application failures stay separate and clear on retry or account changes', async (t) => {
  let failReview = true;
  const { client } = fakeClient(query => query.operation === 'rpc'
    ? query.table === 'review_job_opportunity' && !failReview ? { data: review(), error: null }
      : { data: null, error: { message: 'Offline' } } : { data: [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.createApplication({ opportunityId: 'opportunity-1' }), null);
  assert.match(workspace.error.value, /Could not save the application/);
  const applicationFailure = workspace.error.value;
  assert.equal(await workspace.setOpportunityReview('opportunity-1', 'strong_interest'), null);
  assert.match(workspace.opportunityReviewError.value, /Could not save the opportunity review/);
  assert.equal(workspace.error.value, applicationFailure, 'review errors must not replace unrelated workspace failures');
  assert.equal(workspace.savingReview.value, false);
  const reviewFailure = workspace.opportunityReviewError.value;
  assert.equal(await workspace.setOpportunityComment('opportunity-1', 'Private evaluation'), null);
  assert.match(workspace.opportunityCommentError.value, /Could not save the opportunity comment/);
  assert.equal(workspace.error.value, applicationFailure, 'a comment save must neither replace nor dismiss an unrelated failure');
  assert.equal(workspace.opportunityReviewError.value, reviewFailure);
  const commentFailure = workspace.opportunityCommentError.value;
  failReview = false;
  assert.ok(await workspace.setOpportunityReview('opportunity-1', 'interested'));
  assert.equal(workspace.opportunityReviewError.value, '', 'retry clears its own error');
  assert.equal(workspace.opportunityCommentError.value, commentFailure);
  assert.equal(workspace.error.value, applicationFailure);
  failReview = true;
  assert.equal(await workspace.setOpportunityReview('opportunity-1', 'strong_interest'), null);
  account.value = 'account-b';
  assert.equal(workspace.opportunityReviewError.value, '');
  assert.equal(workspace.opportunityCommentError.value, '');
  assert.equal(workspace.error.value, '');
});

test('comment saves and interest changes share user order without sending unrelated fields', async (t) => {
  const firstWrite = deferred<Result>();
  let held = true;
  let stored: OpportunityReview = { ...review(), comment: null };
  const { client, queries } = fakeClient(async query => {
    if (query.operation === 'rpc') {
      if (held) { held = false; await firstWrite.promise; }
      stored = query.table === 'save_opportunity_comment' ? { ...stored, comment: query.payload?.p_comment as string | null }
        : { ...stored, state: query.payload?.p_state as OpportunityReview['state'] };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'opportunity_reviews' ? [{ ...stored }] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const comment = workspace.setOpportunityComment(stored.opportunity_id, 'Earlier thought');
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const interest = workspace.setOpportunityReview(stored.opportunity_id, 'not_interested');
  const revisedComment = workspace.setOpportunityComment(stored.opportunity_id, 'The location is too far away.');
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 1);
  firstWrite.resolve({ data: null, error: null });
  await Promise.all([comment, interest, revisedComment]);
  assert.equal(workspace.reviews.value[0].state, 'not_interested');
  assert.equal(workspace.reviews.value[0].comment, 'The location is too far away.');
  assert.deepEqual(queries.filter(({ operation }) => operation === 'rpc').map(({ table }) => table),
    ['save_opportunity_comment', 'review_job_opportunity', 'save_opportunity_comment']);
});

test('late and queued comment saves cannot cross account changes', async (t) => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const comment = workspace.setOpportunityComment('opportunity-1', 'Private reason');
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const queued = workspace.setOpportunityComment('opportunity-1', 'Another private reason');
  account.value = 'account-b';
  await settleUntil(() => !workspace.loading.value);
  assert.ok(queries.find(({ operation }) => operation === 'rpc')?.signal?.aborted);
  writing.resolve({ data: { ...review(), comment: 'Private reason' }, error: null });
  assert.deepEqual(await Promise.all([comment, queued]), [null, null]);
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 1);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.opportunityCommentError.value, '');
  assert.equal(workspace.error.value, '');
});

test('comments and concurrent receipts preserve both changes in either response order', async (t) => {
  for (const receiptFirst of [true, false]) await t.test(receiptFirst ? 'receipt finishes first' : 'comment finishes first', async () => {
    const comment = deferred<Result>();
    const receipt = deferred<Result>();
    const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
    const original = { ...review(source.id, 'strong_interest'), comment: 'Previous reason' };
    const { client, queries } = fakeClient(query => query.operation === 'rpc'
      ? query.table === 'save_opportunity_comment' ? comment.promise : receipt.promise
      : { data: query.table === 'opportunity_reviews' ? [original] : [], error: null });
    const scope = effectScope();
    try {
      const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
      await settleUntil(() => !workspace.loading.value);
      const pendingReceipt = workspace.markOpportunityReviewed(source);
      const pendingComment = workspace.setOpportunityComment(source.id, 'Funding confirmed.');
      await settleUntil(() => queries.filter(({ operation }) => operation === 'rpc').length === 2);
      const commentReply = { data: { ...original, comment: 'Funding confirmed.' }, error: null };
      const receiptReply = { data: { ...original, reviewed_updated_at: source.updated_at }, error: null };
      if (receiptFirst) {
        receipt.resolve(receiptReply); await pendingReceipt;
        comment.resolve(commentReply); await pendingComment;
      } else {
        comment.resolve(commentReply); await pendingComment;
        receipt.resolve(receiptReply); await pendingReceipt;
      }
      assert.equal(workspace.reviews.value[0].comment, 'Funding confirmed.');
      assert.equal(workspace.reviews.value[0].reviewed_updated_at, source.updated_at);
      assert.equal(workspace.reviews.value[0].state, 'strong_interest');
    } finally { scope.stop(); }
  });
});

test('strong interest survives a fresh workspace, updated-source receipt, and application creation', async (t) => {
  let source = { id: 'opportunity-1', title: 'Materials discovery', personal_fit: opportunityAssessmentFixture(6.4),
    deadline: '2025-01-01', source_context: 'Materials discovery', created_at: '2026-09-18T12:00:00Z', updated_at: '2026-09-20T10:00:00Z' };
  let stored = review('opportunity-1', 'unreviewed');
  let created: Application | null = null;
  const { client, queries } = fakeClient((query) => {
    if (query.table === 'review_job_opportunity') {
      stored = { ...stored, state: (query.payload?.p_state ?? stored.state) as OpportunityReview['state'],
        reviewed_updated_at: String(query.payload?.p_observed_updated_at) };
      return { data: { ...stored }, error: null };
    }
    if (query.table === 'create_job_application') {
      created = application(String(query.payload?.p_application_id), null);
      return { data: created.id, error: null };
    }
    return { data: query.table === 'opportunities' ? [{ ...source }]
      : query.table === 'opportunity_reviews' ? [{ ...stored }]
        : query.table === 'applications' ? query.single ? created : created ? [created] : [] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.setOpportunityReview(source.id, 'strong_interest'))?.state, 'strong_interest');
  assert.deepEqual(queries.at(-1)?.payload,
    { p_opportunity_id: source.id, p_observed_updated_at: source.updated_at, p_state: 'strong_interest' });
  scope.stop();

  const nextScope = effectScope(); t.after(() => nextScope.stop());
  const reloaded = nextScope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !reloaded.loading.value);
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);

  source = { ...source, updated_at: '2026-09-21T10:00:00Z' };
  assert.equal(await reloaded.refresh(), true);
  assert.equal((await reloaded.markOpportunityReviewed(reloaded.opportunities.value[0]))?.state, 'strong_interest');
  assert.deepEqual(queries.at(-1)?.payload,
    { p_opportunity_id: source.id, p_observed_updated_at: source.updated_at, p_state: null });
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);

  assert.ok(await reloaded.createApplication({ opportunityId: source.id }));
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(await reloaded.refresh(), true);
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(queries.filter(({ table }) => table === 'review_job_opportunity').length, 2,
    'creating an application does not write or weaken an explicit review preference');
  assert.ok(queries.filter(({ table }) => table === 'opportunities').every(({ operation }) => operation === 'select'));
});

test('opening and changing review state persist the viewed source version across fresh workspaces', async () => {
  const source = normalizeOpportunity({ id: 'opportunity-1', title: 'Researcher', created_at: '2026-09-18T12:00:00Z', updated_at: '2026-09-20T10:00:00Z' });
  let stored = review('opportunity-1', 'not_interested');
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      stored = { ...stored, state: (query.payload?.p_state ?? stored.state) as OpportunityReview['state'], reviewed_updated_at: String(query.payload?.p_observed_updated_at) };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'opportunities' ? [source] : query.table === 'opportunity_reviews' ? [{ ...stored }] : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.markOpportunityReviewed(source))?.state, 'not_interested');
  assert.equal(workspace.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.equal(await workspace.markOpportunityReviewed(source), null, 'reopening a reviewed version makes no redundant write');
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 1);
  await workspace.setOpportunityReview(source.id, 'interested');
  assert.deepEqual(queries.at(-1)?.payload, { p_opportunity_id: source.id, p_observed_updated_at: source.updated_at, p_state: 'interested' });
  scope.stop();
  const nextScope = effectScope();
  const reloaded = nextScope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !reloaded.loading.value);
  assert.equal(opportunityRecency(reloaded.opportunities.value[0], new Date('2026-09-20T12:00:00Z'), reloaded.reviews.value[0].reviewed_updated_at), null);
  assert.equal(reloaded.reviews.value[0].state, 'interested');
  nextScope.stop();
});

test('parallel row receipts do not block state changes or overwrite a newer strong-interest choice', async () => {
  const opening = deferred<Result>();
  const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
  const source2 = normalizeOpportunity({ id: 'opportunity-2', updated_at: source.updated_at });
  const feedback: OpportunityReview = { ...review('opportunity-1', 'strong_interest'), interest_rating: 0,
    interest_reasons: [{ category: 'method', polarity: 'negative', target: 'Simulation only' }], feedback_excluded: true,
    feedback_revision: 4, feedback_updated_at: '2026-09-20T09:00:00Z', prediction_baseline: {
      user_id: 'account-a', opportunity_id: 'opportunity-1', score: 7, scale_min: 0, scale_max: 10,
      predicted_at: '2026-09-19T09:00:00Z', source_kind: 'historical_snapshot',
      source_ref: 'opportunity-search-receipt:00000000-0000-4000-8000-000000000003:00000000-0000-4000-8000-000000000004',
    } };
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? query.payload?.p_state === null ? opening.promise
      : { data: { ...feedback, reviewed_updated_at: source.updated_at }, error: null }
    : { data: [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.markOpportunityReviewed(source);
  assert.equal(workspace.saving.value, false);
  const duplicate = workspace.markOpportunityReviewed(source);
  assert.equal(await duplicate, null);
  await workspace.setOpportunityReview(source.id, 'strong_interest');
  opening.resolve({ data: { ...review('opportunity-1', 'unreviewed'), reviewed_updated_at: source.updated_at }, error: null });
  await pending;
  assert.equal(workspace.reviews.value[0].state, 'strong_interest');
  assert.equal(workspace.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.deepEqual(workspace.reviews.value[0], { ...feedback, reviewed_updated_at: source.updated_at },
    'a late view receipt cannot erase a rating, tags, exclusion, revision, time or baseline');
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 2);
  // Reject a response for another opportunity and leave the second row unchanged.
  assert.equal(await workspace.markOpportunityReviewed(source2), null);
  assert.equal(workspace.reviews.value.length, 1);
  scope.stop();
});

test('failed receipts keep highlights and old receipts cannot cross account changes', async () => {
  const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
  const writing = deferred<Result>();
  let fail = true;
  const { client } = fakeClient((query) => query.operation === 'rpc'
    ? fail ? { data: null, error: { message: 'Offline' } } : writing.promise
    : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.markOpportunityReviewed(source), null);
  assert.equal(workspace.reviews.value.length, 0);
  assert.match(workspace.error.value, /Could not mark/);
  fail = false;
  const pending = workspace.markOpportunityReviewed(source);
  assert.equal(workspace.error.value, '', 'retry clears the previous failure');
  account.value = 'account-b';
  await settleUntil(() => !workspace.loading.value);
  writing.resolve({ data: { ...review(), reviewed_updated_at: source.updated_at }, error: null });
  assert.equal(await pending, null);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('rapidly opening different rows saves both receipts and an older refresh cannot restore highlights', async () => {
  const version = '2026-09-20T10:00:00Z';
  const first = deferred<Result>();
  const second = deferred<Result>();
  const reading = deferred<Result>();
  let holdReads = false;
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? query.payload?.p_opportunity_id === 'first' ? first.promise : second.promise
    : holdReads ? reading.promise : { data: [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const pendingFirst = workspace.markOpportunityReviewed(normalizeOpportunity({ id: 'first', updated_at: version }));
  const pendingSecond = workspace.markOpportunityReviewed(normalizeOpportunity({ id: 'second', updated_at: version }));
  await settleUntil(() => queries.filter(({ operation }) => operation === 'rpc').length === 2);
  holdReads = true;
  const refresh = workspace.refresh();
  await settleUntil(() => queries.filter(({ operation }) => operation === 'select').length === 8);
  second.resolve({ data: { ...review('second', 'unreviewed'), reviewed_updated_at: version }, error: null });
  first.resolve({ data: { ...review('first', 'unreviewed'), reviewed_updated_at: version }, error: null });
  await Promise.all([pendingFirst, pendingSecond]);
  reading.resolve({ data: [], error: null });
  assert.equal(await refresh, false);
  assert.deepEqual(workspace.reviews.value.map(({ opportunity_id }) => opportunity_id).sort(), ['first', 'second']);
  assert.ok(workspace.reviews.value.every(({ reviewed_updated_at }) => reviewed_updated_at === version));
  scope.stop();
});

test('metadata can be saved before CV assignment and employer contact email is optional', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.operation === 'update'
    ? { ...application('application-1', null), ...query.payload } : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const updated = await workspace.updateApplication('application-1', { status: 'contacted', notes: 'Asked about supervision', contactEmail: '' });
  assert.ok(updated);
  assert.equal(updated.cv_variant_id, null);
  assert.equal(updated.contact_email, null);
  assert.equal(queries.some(({ operation }) => operation === 'rpc'), false);
  assert.deepEqual(queries.find(({ operation }) => operation === 'update')?.payload,
    { status: 'contacted', tracking_started: true, notes: 'Asked about supervision', contact_email: null });
  scope.stop();
});

test('checklist mutations save only one task and retain owned application context and CV', async () => {
  let stored = application();
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      const keys = new Set(stored.completed_checklist_keys);
      if (query.payload?.p_completed) keys.add(String(query.payload.p_item_key));
      else keys.delete(String(query.payload?.p_item_key));
      stored = { ...stored, completed_checklist_keys: [...keys] };
      return { data: stored, error: null };
    }
    return { data: query.table === 'applications' ? [stored] : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  await workspace.setApplicationChecklistItem(stored.id, 'requirements:degree', true);
  await workspace.setApplicationChecklistItem(stored.id, 'documents:cv', true);
  await workspace.setApplicationChecklistItem(stored.id, 'requirements:degree', false);
  assert.deepEqual(workspace.applications.value[0].completed_checklist_keys, ['documents:cv']);
  assert.deepEqual(workspace.applications.value[0].context_json, application().context_json);
  assert.equal(workspace.applications.value[0].cv_variant_id, 'cv-1');
  assert.deepEqual(queries.find(({ operation }) => operation === 'rpc')?.payload,
    { p_application_id: stored.id, p_item_key: 'requirements:degree', p_completed: true });
  await workspace.refresh();
  assert.deepEqual(workspace.applications.value[0].completed_checklist_keys, ['documents:cv']);
  scope.stop();
});

test('removal changes only the confirmed application and keeps its review and CV snapshots', async () => {
  let fail = true;
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? fail ? { data: null, error: { message: 'Offline' } } : { data: query.payload?.p_application_id, error: null }
    : { data: query.table === 'applications' ? [application(), { ...application('other'), opportunity_id: 'other-opportunity' }]
      : query.table === 'opportunity_reviews' ? [review('opportunity-1', 'not_interested')]
        : query.table === 'cv_variants' ? [{ id: 'cv-1', user_id: 'account-a', name: 'Snapshot' }] : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const cachedReviews = workspace.reviews.value;
  const cachedCvs = workspace.cvVariants.value;
  assert.equal(await workspace.removeApplication('application-1'), null);
  assert.equal(workspace.applications.value.length, 2);
  assert.equal(workspace.reviews.value[0].state, 'not_interested');
  fail = false;
  assert.equal(await workspace.removeApplication('application-1'), 'application-1');
  assert.deepEqual(workspace.applications.value.map(({ id }) => id), ['other']);
  assert.strictEqual(workspace.reviews.value, cachedReviews);
  assert.equal(workspace.reviews.value[0].state, 'not_interested');
  assert.strictEqual(workspace.cvVariants.value, cachedCvs);
  assert.equal(workspace.cvVariants.value.length, 1);
  assert.deepEqual(queries.filter(({ operation }) => operation === 'rpc').map(({ table, payload }) => ({ table, payload })),
    Array.from({ length: 2 }, () => ({ table: 'remove_job_application', payload: { p_application_id: 'application-1' } })));
  scope.stop();
});

test('removal preserves every cached evaluation field and never rereads feedback, including zero interest', async () => {
  for (const state of ['not_interested', 'unreviewed', 'interested', 'strong_interest'] as const) {
    const previous: OpportunityReview = { ...review('opportunity-1', state), interest_rating: 0,
      comment: 'Keep my complete private evaluation.', interest_reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }],
      feedback_excluded: true, feedback_revision: 3, feedback_updated_at: '2026-09-19T16:00:00Z',
      manually_archived: true, technical_issue_category: 'requirements', technical_issue_note: 'Keep my eligibility note.',
      prediction_baseline: { user_id: 'account-a', opportunity_id: 'opportunity-1', score: 8, scale_min: 0, scale_max: 10,
        predicted_at: '2026-09-18T16:00:00Z', source_kind: 'discovery_assessment', source_ref: 'Original verified assessment' },
      evaluation_revision: 2, reviewed_updated_at: '2026-09-18T16:00:00Z' };
    const { client, queries } = fakeClient(query => {
      if (query.operation === 'rpc') return { data: query.payload?.p_application_id, error: null };
      return { data: query.table === 'applications' ? [application()]
        : query.table === 'opportunity_reviews' ? [previous] : [], error: null };
    });
    const scope = effectScope();
    const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
    await settleUntil(() => !workspace.loading.value);
    const cachedReviews = workspace.reviews.value;
    const cachedReview = workspace.reviews.value[0];
    const readsBeforeRemoval = queries.filter(query => query.operation === 'select').length;
    assert.equal(await workspace.removeApplication('application-1'), 'application-1');
    assert.deepEqual(workspace.applications.value, []);
    assert.strictEqual(workspace.reviews.value, cachedReviews);
    assert.strictEqual(workspace.reviews.value[0], cachedReview);
    assert.deepEqual(workspace.reviews.value, [previous]);
    assert.equal(workspace.error.value, '');
    assert.equal(queries.filter(query => query.operation === 'select').length, readsBeforeRemoval);
    scope.stop();
  }
});

test('unconfirmed or unavailable application removal preserves all cached records', async () => {
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? { data: 'different-application', error: null }
    : { data: query.table === 'applications' ? [application()]
      : query.table === 'opportunity_reviews' ? [review('opportunity-1', 'not_interested')] : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const cachedApplications = workspace.applications.value, cachedReviews = workspace.reviews.value;
  assert.equal(await workspace.removeApplication('missing-application'), null);
  assert.equal(queries.some(query => query.operation === 'rpc'), false);
  assert.match(workspace.error.value, /Refresh to load/);
  assert.equal(await workspace.removeApplication('application-1'), null);
  assert.match(workspace.error.value, /Removal could not be confirmed/);
  assert.strictEqual(workspace.applications.value, cachedApplications);
  assert.strictEqual(workspace.reviews.value, cachedReviews);
  scope.stop();
});

test('removal never follows an old response with a feedback read under the next account', async () => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? writing.promise : {
    data: query.table === 'applications' ? [{ ...application(), user_id: String(query.filters.user_id) }]
      : query.table === 'opportunity_reviews' ? [{ ...review('opportunity-1', 'not_interested'),
        user_id: String(query.filters.user_id), feedback_revision: 1 }] : [], error: null,
  });
  const scope = effectScope();
  const account = ref('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.removeApplication('application-1');
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  account.value = 'account-b';
  await settleUntil(() => workspace.reviews.value[0]?.user_id === 'account-b');
  writing.resolve({ data: 'application-1', error: null });
  assert.equal(await pending, null);
  assert.equal(queries.some(query => query.table === 'opportunity_reviews' && query.single), false);
  assert.equal(workspace.reviews.value[0].user_id, 'account-b');
  assert.equal(workspace.applications.value[0].user_id, 'account-b');
  scope.stop();
});

test('late checklist and removal results cannot affect another signed-in account', async () => {
  for (const operation of ['checklist', 'remove']) {
    const writing = deferred<Result>();
    const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? writing.promise
      : { data: query.table === 'applications' ? [application()] : [], error: null });
    const scope = effectScope();
    const account = ref<string | null>('account-a');
    const workspace = scope.run(() => useCloudWorkspace(client, account))!;
    await settleUntil(() => !workspace.loading.value);
    const pending = operation === 'checklist' ? workspace.setApplicationChecklistItem('application-1', 'documents:cv', true) : workspace.removeApplication('application-1');
    await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
    account.value = null;
    writing.resolve({ data: operation === 'checklist' ? { ...application(), completed_checklist_keys: ['documents:cv'] } : 'application-1', error: null });
    assert.equal(await pending, null);
    assert.deepEqual(workspace.applications.value, []);
    scope.stop();
  }
});

test('application context loads the exact saved privacy CV from a fresh owned application only on request', async () => {
  const stored = createCloudCvSnapshot(createTestState({ about: { text: 'Exact saved research CV' } }));
  const fresh = application('application-1', stored.id);
  const { client, queries } = fakeClient((query) => ({ data: query.single
    ? query.table === 'applications' ? fresh : { ...stored, user_id: 'account-a' }
    : query.table === 'applications' ? [application('application-1', 'old-cv')] : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(queries.some(({ fields }) => fields?.includes('content_json')), false);
  const context = await workspace.getApplicationContext('application-1');
  assert.deepEqual(context, { application: fresh, cv: stored });
  const read = queries.find(({ table, single }) => table === 'cv_variants' && single);
  assert.deepEqual(read?.filters, { id: stored.id, user_id: 'account-a' });
  assert.equal(context?.cv?.content_json.about.text, 'Exact saved research CV');
  assert.deepEqual(context?.application.context_json.supervisor_top_papers, [{ title: 'Paper', year: 2025 }]);
  scope.stop();
});

test('unassigned CV is an explicit valid context while missing assigned CV prevents partial export', async () => {
  let assigned = false;
  const { client, queries } = fakeClient((query) => ({ data: query.single
    ? query.table === 'applications' ? application('application-1', assigned ? 'missing-cv' : null) : null
    : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const context = await workspace.getApplicationContext('application-1');
  assert.ok(context);
  assert.equal(context.cv, null);
  assert.equal(workspace.error.value, '');
  assert.equal(queries.some(({ table, single }) => table === 'cv_variants' && single), false);
  assigned = true;
  assert.equal(await workspace.getApplicationContext('application-1'), null);
  assert.match(workspace.error.value, /invalid or unavailable/);
  scope.stop();
});

test('context loading rejects non-private CVs and cross-user responses', async () => {
  const stored = createCloudCvSnapshot(createTestState());
  let owner = 'account-a';
  stored.content_json.contact.email = 'private@example.org';
  const { client } = fakeClient((query) => ({ data: query.single
    ? query.table === 'applications' ? { ...application('application-1', stored.id), user_id: owner } : { ...stored, user_id: owner }
    : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.getApplicationContext('application-1'), null);
  assert.match(workspace.error.value, /not a privacy snapshot/);
  owner = 'account-b';
  assert.equal(await workspace.getApplicationContext('application-1'), null);
  assert.match(workspace.error.value, /could not be loaded/);
  scope.stop();
});

test('logout while a saved CV is loading discards the complete application context', async () => {
  const cvRead = deferred<Result>();
  const stored = createCloudCvSnapshot(createTestState());
  const { client, queries } = fakeClient((query) => query.single
    ? query.table === 'applications' ? { data: application('application-1', stored.id), error: null } : cvRead.promise
    : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const reading = workspace.getApplicationContext('application-1');
  await settleUntil(() => queries.some(({ table, single }) => table === 'cv_variants' && single));
  account.value = null;
  cvRead.resolve({ data: { ...stored, user_id: 'account-a' }, error: null });
  assert.equal(await reading, null);
  assert.equal(workspace.error.value, '');
  assert.deepEqual(workspace.applications.value, []);
  scope.stop();
});

test('explicit research refresh uses only the application ID and preserves its saved CV and metadata', async () => {
  const original: Application = { ...application(), status: 'interview', notes: 'Prepare presentation', contacted_at: '2026-09-19T17:00:00.000Z', submitted_at: '2026-09-19T18:00:00.000Z' };
  const updated: Application = { ...original, context_json: { ...original.context_json, supervisor_top_papers: [{ title: 'New verified paper', year: 2026 }] }, context_captured_at: '2026-09-20T12:00:00.000Z' };
  const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? { data: original.id, error: null }
    : { data: query.single ? updated : query.table === 'applications' ? [original] : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.deepEqual(workspace.applications.value[0].context_json, original.context_json);
  const result = await workspace.refreshApplicationContext(original.id);
  assert.deepEqual(result, updated);
  assert.deepEqual(workspace.applications.value[0], updated);
  assert.equal(result?.cv_variant_id, original.cv_variant_id);
  assert.equal(result?.notes, original.notes);
  assert.equal(result?.status, original.status);
  assert.equal(result?.contact_email, original.contact_email);
  const rpc = queries.find(({ operation }) => operation === 'rpc');
  assert.equal(rpc?.table, 'refresh_job_application_context');
  assert.deepEqual(rpc?.payload, { p_application_id: original.id });
  assert.equal(queries.some(({ operation, fields }) => operation === 'update' || fields?.includes('content_json')), false);
  scope.stop();
});

test('logout during research refresh prevents follow-up reads and stale application updates', async () => {
  const updating = deferred<Result>();
  const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? updating.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.refreshApplicationContext('application-1');
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const count = queries.length;
  account.value = null;
  updating.resolve({ data: 'application-1', error: null });
  assert.equal(await pending, null);
  assert.equal(queries.length, count);
  assert.deepEqual(workspace.applications.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('stage saves queue with explicit tracking choices and preserve the server lock', async () => {
  const firstWrite = deferred<Result>();
  let held = true;
  let stored: Application = { ...application(), workflow_stage: 'preparation', tracking_started: false };
  const stages = { preparation: 'preparation', refinement: 'refinement', review: 'attachments', tracking: null } as const;
  const { client, queries } = fakeClient(async query => {
    if (query.operation === 'rpc' && query.table === 'set_job_application_stage') {
      if (held) { held = false; await firstWrite.promise; }
      const stage = query.payload!.p_stage as keyof typeof stages;
      stored = { ...stored, workflow_stage: stage, status: stored.tracking_started ? stored.status : stages[stage] ?? stored.status };
      return { data: { ...stored }, error: null };
    }
    if (query.operation === 'update') {
      stored = { ...stored, ...query.payload };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'applications' ? [stored] : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const stage = workspace.setApplicationStage(stored.id, 'tracking');
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  const explicitReady = workspace.updateApplication(stored.id, { status: 'ready' });
  const lastStage = workspace.setApplicationStage(stored.id, 'review');
  assert.equal(queries.filter(query => query.operation !== 'select').length, 1);
  firstWrite.resolve({ data: null, error: null });
  assert.equal((await stage)?.status, 'preparation');
  assert.equal((await explicitReady)?.tracking_started, true);
  assert.equal((await lastStage)?.workflow_stage, 'review');
  assert.equal(workspace.applications.value[0].status, 'ready');
  assert.deepEqual(queries.filter(query => query.operation !== 'select').map(query => query.table),
    ['set_job_application_stage', 'applications', 'set_job_application_stage']);
  assert.deepEqual(queries.find(query => query.operation === 'update')?.payload, { status: 'ready', tracking_started: true });
  scope.stop();
});

test('opening Tracking and resetting history keep the preparation status until an explicit tracking choice', async t => {
  const currentEntry = { status: 'attachments' as const, changedAt: '2026-10-12T10:00:00.000Z' };
  let stored: Application = { ...application(), status: 'attachments', workflow_stage: 'review', tracking_started: false,
    status_history: [{ status: 'preparation', changedAt: '2026-10-11T09:00:00.000Z' }, currentEntry] };
  const { client, queries } = fakeClient(query => {
    if (query.operation === 'rpc') {
      if (query.table === 'set_job_application_stage') stored = { ...stored, workflow_stage: 'tracking' };
      else if (query.table === 'reset_job_application_history') stored = { ...stored, status_history: [currentEntry] };
      else assert.fail(`Unexpected RPC: ${query.table}`);
      return { data: { ...stored }, error: null };
    }
    if (query.operation === 'update') {
      stored = { ...stored, ...query.payload };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'applications' ? [stored] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const opened = await workspace.setApplicationStage(stored.id, 'tracking');
  assert.equal(opened?.workflow_stage, 'tracking');
  assert.equal(opened?.status, 'attachments');
  assert.equal(opened?.tracking_started, false);
  assert.equal(opened?.status_history?.length, 2);
  const reset = await workspace.resetApplicationHistory(stored.id);
  assert.equal(reset?.status, 'attachments');
  assert.equal(reset?.tracking_started, false);
  assert.deepEqual(reset?.status_history, [currentEntry]);
  assert.deepEqual(workspace.applications.value, [reset]);
  assert.deepEqual(queries.filter(query => query.operation !== 'select').map(query => [query.table, query.payload]), [
    ['set_job_application_stage', { p_application_id: stored.id, p_stage: 'tracking' }],
    ['reset_job_application_history', { p_application_id: stored.id }],
  ], 'opening Tracking and resetting history must not send a status update');
  const ready = await workspace.updateApplication(stored.id, { status: 'ready' });
  assert.equal(ready?.status, 'ready');
  assert.equal(ready?.tracking_started, true);
  assert.deepEqual(queries.find(query => query.operation === 'update')?.payload, { status: 'ready', tracking_started: true });
});

test('history reset accepts the server baseline and preserves application details and other rows', async (t) => {
  const currentEntry = { status: 'contacted' as const, changedAt: '2026-10-12T10:00:00.000Z' };
  const original: Application = { ...application(), status: 'contacted', workflow_stage: 'tracking', tracking_started: true,
    notes: 'Ask about project funding', completed_checklist_keys: ['documents:cv'], contacted_at: currentEntry.changedAt,
    status_history: [{ status: 'ready', changedAt: '2026-10-11T09:00:00.000Z' }, currentEntry] };
  const reset: Application = { ...original, status_history: [currentEntry], updated_at: '2026-10-13T11:00:00.000Z' };
  const other = application('application-2');
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? { data: reset, error: null }
    : { data: query.table === 'applications' ? [original, other] : [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.deepEqual(await workspace.resetApplicationHistory(original.id), reset);
  assert.deepEqual(workspace.applications.value, [reset, other]);
  const writes = queries.filter(query => query.operation !== 'select');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'reset_job_application_history');
  assert.deepEqual(writes[0].payload, { p_application_id: original.id });
  assert.equal(workspace.error.value, '');
});

test('failed history resets retain the visible history and report the failure', async (t) => {
  const original: Application = { ...application(), status_history: [{ status: 'preparation', changedAt: null }] };
  const { client } = fakeClient(query => query.operation === 'rpc' ? { data: null, error: { message: 'Connection failed' } }
    : { data: query.table === 'applications' ? [original] : [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.resetApplicationHistory(original.id), null);
  assert.deepEqual(workspace.applications.value, [original]);
  assert.match(workspace.error.value, /Could not reset the application history/);
  assert.equal(workspace.saving.value, false);
});

test('history reset rejects another owner, another application, and malformed baseline history', async (t) => {
  const original: Application = { ...application(), status_history: [{ status: 'preparation', changedAt: null }] };
  const invalidRows: unknown[] = [
    { ...original, user_id: 'account-b' },
    { ...original, id: 'application-2' },
    { ...original, status_history: undefined },
    { ...original, status_history: [] },
    { ...original, status_history: [null] },
    { ...original, status_history: [{ status: 'ready', changedAt: null }] },
    { ...original, status_history: [{ status: 'preparation', changedAt: 'not a date' }] },
    { ...original, status_history: [{ status: 'preparation' }] },
    { ...original, status: 'unknown', status_history: [{ status: 'unknown', changedAt: null }] },
    { ...original, status_history: [...original.status_history!, ...original.status_history!] },
  ];
  const { client } = fakeClient(query => query.operation === 'rpc' ? { data: invalidRows.shift(), error: null }
    : { data: query.table === 'applications' ? [original] : [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  while (invalidRows.length) {
    assert.equal(await workspace.resetApplicationHistory(original.id), null);
    assert.deepEqual(workspace.applications.value, [original]);
    assert.match(workspace.error.value, /history reset could not be confirmed/);
  }
});

test('account changes discard an in-flight history reset without overwriting the next account', async (t) => {
  const resetting = deferred<Result>();
  const original: Application = { ...application(), status_history: [{ status: 'preparation', changedAt: null }] };
  const next = { ...application('next-account-application'), user_id: 'account-b' };
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? resetting.promise
    : { data: query.table === 'applications' ? query.filters.user_id === 'account-b' ? [next] : [original] : [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const account = ref('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.resetApplicationHistory(original.id);
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  const rpc = queries.find(query => query.operation === 'rpc')!;
  account.value = 'account-b';
  await settleUntil(() => !workspace.loading.value);
  assert.equal(rpc.signal?.aborted, true);
  resetting.resolve({ data: original, error: null });
  assert.equal(await pending, null);
  assert.deepEqual(workspace.applications.value, [next]);
  assert.equal(workspace.error.value, '');
});

test('history reset runs after preceding note and tracking saves and preserves their latest values', async (t) => {
  const writing = deferred<Result>();
  let stored: Application = { ...application(), status_history: [{ status: 'preparation', changedAt: null }] };
  const { client, queries } = fakeClient(async query => {
    if (query.operation === 'update') {
      await writing.promise;
      stored = { ...stored, ...query.payload, status_history: [...stored.status_history!, { status: 'contacted', changedAt: '2026-10-13T09:00:00.000Z' }] };
      return { data: { ...stored }, error: null };
    }
    if (query.operation === 'rpc') {
      stored = { ...stored, status_history: [stored.status_history!.at(-1)!] };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'applications' ? [stored] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const save = workspace.updateApplication(stored.id, { notes: 'New note', status: 'contacted' });
  await settleUntil(() => queries.some(query => query.operation === 'update'));
  const reset = workspace.resetApplicationHistory(stored.id);
  assert.equal(queries.some(query => query.operation === 'rpc'), false);
  writing.resolve({ data: null, error: null });
  assert.equal((await save)?.notes, 'New note');
  const result = await reset;
  assert.equal(result?.notes, 'New note');
  assert.equal(result?.status, 'contacted');
  assert.equal(result?.tracking_started, true);
  assert.deepEqual(result?.status_history, [{ status: 'contacted', changedAt: '2026-10-13T09:00:00.000Z' }]);
  assert.deepEqual(workspace.applications.value, [result]);
  assert.deepEqual(queries.filter(query => query.operation !== 'select').map(query => query.table), ['applications', 'reset_job_application_history']);
});

test('queued application writes cannot run under the next account', async () => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const stage = workspace.setApplicationStage('application-1', 'refinement');
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  const note = workspace.updateApplication('application-1', { notes: 'Old account note' });
  const tracking = workspace.updateApplication('application-1', { status: 'submitted' });
  account.value = null;
  writing.resolve({ data: { ...application(), workflow_stage: 'refinement', status: 'refinement' }, error: null });
  assert.deepEqual(await Promise.all([stage, note, tracking]), [null, null, null]);
  assert.equal(queries.filter(query => query.operation !== 'select').length, 1);
  assert.deepEqual(workspace.applications.value, []);
  scope.stop();
});

test('missing workflow RPC reports setup failure without inventing a saved stage', async () => {
  const original: Application = { ...application(), status: 'ready' };
  const { client } = fakeClient(query => query.operation === 'rpc' ? { data: null, error: { code: 'PGRST202' } }
    : { data: query.table === 'applications' ? [original] : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.setApplicationStage(original.id, 'refinement'), null);
  assert.match(workspace.error.value, /database setup is incomplete/);
  assert.equal(workspace.applications.value[0].workflow_stage, undefined);
  assert.equal(workspace.applications.value[0].status, 'ready');
  scope.stop();
});

test('disposed workspaces discard queued writes and reject new writes', async () => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const stage = workspace.setApplicationStage('application-1', 'review');
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  const pendingNote = workspace.updateApplication('application-1', { notes: 'Queued note' });
  scope.stop();
  assert.equal(await workspace.updateApplication('application-1', { notes: 'After unmount' }), null);
  assert.equal(await workspace.setApplicationStage('application-1', 'tracking'), null);
  assert.equal(await workspace.refresh(), false);
  writing.resolve({ data: { ...application(), workflow_stage: 'review', status: 'attachments' }, error: null });
  assert.deepEqual(await Promise.all([stage, pendingNote]), [null, null]);
  assert.equal(queries.filter(query => query.operation !== 'select').length, 1);
});

test('evaluation commits use one comment RPC and preserve independent interest and exclusion', async () => {
  let stored = { ...review(), comment: 'Synthetic private person person@example.invalid', evaluation_revision: 4,
    interest_rating: 7.5, feedback_revision: 8, feedback_excluded: true };
  const { client, queries } = fakeClient(query => {
    if (query.operation !== 'rpc') return { data: query.table === 'opportunity_reviews' ? [stored] : [], error: null };
    if (query.table === 'save_opportunity_feedback') stored = { ...stored, ...query.payload?.p_patch as object,
      feedback_revision: stored.feedback_revision + 1 };
    if (query.table === 'save_opportunity_comment') stored = { ...stored, comment: String(query.payload?.p_comment),
      evaluation_revision: stored.evaluation_revision + 1 };
    return { data: stored, error: null };
  });
  const scope = effectScope(); const workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  await workspace.saveOpportunityFeedback('opportunity-1', { interest_rating: 0 });
  assert.equal(workspace.reviews.value[0].interest_rating, 0);
  assert.equal(workspace.reviews.value[0].evaluation_revision, 4);
  assert.equal(await workspace.saveOpportunityFeedback('opportunity-1', { search_feedback_summary: 'Retired second source.' } as never), null);
  await workspace.setOpportunityComment('opportunity-1', '  Changed complete evaluation.\n ');
  const saved = workspace.reviews.value[0];
  assert.equal(saved.comment, '  Changed complete evaluation.\n ');
  assert.equal(saved.evaluation_revision, 5);
  assert.equal(saved.interest_rating, 0); assert.equal(saved.feedback_revision, 9); assert.equal(saved.feedback_excluded, true);
  assert.equal('approveOpportunityFeedbackSummary' in workspace, false); assert.equal('revokeOpportunityFeedbackSummary' in workspace, false);
  assert.deepEqual(queries.filter(query => query.operation === 'rpc').map(query => query.table), ['save_opportunity_feedback','save_opportunity_comment']);
  assert.deepEqual(queries.find(query => query.table === 'save_opportunity_comment')?.payload,
    { p_opportunity_id:'opportunity-1',p_comment:'  Changed complete evaluation.\n ' });
  assert.equal(queries.some(query => query.table === 'set_opportunity_feedback_consent'), false);
  scope.stop();
});

test('invalid feedback patches never reach storage and the workspace has no search-sharing state or mutation', async () => {
  const { client, queries } = fakeClient(() => ({ data: [], error: null }));
  const scope = effectScope(); const account = ref('account-a'); const workspace = scope.run(() => useCloudWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  for (const patch of [{ interest_rating: '2' }, { interest_rating: NaN }, { comment: 'not an allowed patch' }, { search_feedback_summary:'Retired second source.' }, { feedback_excluded: 'yes' }]) {
    assert.equal(await workspace.saveOpportunityFeedback('opportunity-1', patch as never), null);
  }
  assert.equal(queries.some(query => query.operation === 'rpc'), false);
  for (const key of ['feedbackSharing','loadFeedbackSharing','setStructuredFeedbackSharing']) assert.equal(Object.hasOwn(workspace,key), false);
  account.value = 'account-b';
  assert.equal(queries.some(query => query.table === 'read_opportunity_feedback_settings' || query.table === 'set_opportunity_feedback_consent'), false);
  scope.stop();
});

test('canonical catalogue decoding keeps structured identities for consumers without adding display aliases', async () => {
  const { canonicalOpportunityFixture } = await import('./fixtures/canonicalOpportunity');
  const row = opportunityFixture(canonicalOpportunityFixture());
  const result = readOpportunity(row);
  assert.strictEqual(result, row);
  assert.equal(result.supervisors[0]?.name, 'Prof. Morgan Example');
  assert.deepEqual(result.requirements, row.requirements);
  assert.deepEqual(result.required_documents, row.required_documents);
  assert.deepEqual(result.contacts, row.contacts);
  assert.equal(Object.hasOwn(result, 'details'), false);
});

test('manual disposition saves one owner-scoped partial patch without changing interest or applications', async () => {
  let stored = { ...review(), interest_rating: 8, manually_archived: false, technical_issue_category: null as string | null, technical_issue_note: null as string | null };
  const { client, queries } = fakeClient(query => {
    if (query.operation !== 'rpc') return { data: query.table === 'opportunity_reviews' ? [stored] : [], error: null };
    if (query.table === 'save_opportunity_feedback') stored = { ...stored, ...query.payload?.p_patch as object };
    return { data: stored, error: null };
  });
  const scope = effectScope(), workspace = scope.run(() => useCloudWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const saved = await workspace.saveOpportunityDisposition('opportunity-1', { manually_archived: true, technical_issue_category: 'requirements', technical_issue_note: 'Degree requirement not met.' });
  assert.equal(saved?.manually_archived, true); assert.equal(saved?.interest_rating, 8);
  assert.equal(saved?.state, stored.state);
  const writes = queries.filter(query => query.operation === 'rpc');
  assert.equal(writes.length, 1); assert.equal(writes[0]?.table, 'save_opportunity_feedback');
  assert.deepEqual(writes[0]?.payload, { p_opportunity_id: 'opportunity-1', p_patch: { manually_archived: true, technical_issue_category: 'requirements', technical_issue_note: 'Degree requirement not met.' } });
  for (const patch of [{ manually_archived: 'true' }, { technical_issue_category: 'dislike' }, { technical_issue_note: 'x'.repeat(1001) }, { interest_rating: 0 }]) {
    assert.equal(await workspace.saveOpportunityDisposition('opportunity-1', patch as never), null);
  }
  assert.equal(queries.filter(query => query.operation === 'rpc').length, 1);
  scope.stop();
});
