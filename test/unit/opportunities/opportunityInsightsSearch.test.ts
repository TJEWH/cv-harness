import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { effectScope, ref, shallowRef } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchCloudTemplate } from '../../../src/features/meta-search/searchTypes';
import { useOpportunityInsightsSearch } from '../../../src/features/opportunities/composables/useOpportunityInsightsSearch';
import { createSearchTemplate } from '../../../src/features/meta-search/data/searchTemplateRepository';

const ownerId = '91000000-0000-4000-8000-000000000001';
const searchId = '91000000-0000-4000-8000-000000000002';
const otherOwner = '91000000-0000-4000-8000-000000000003';
const otherSearch = '91000000-0000-4000-8000-000000000004';
const projectRef = 'abcdefghijklmnopqrst';
const tick = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function row(id = searchId, owner = ownerId): SearchCloudTemplate {
  const editor = createSearchTemplate('Synthetic shared search', 'Europe/Tirane');
  return { id, user_id: owner, name: 'Synthetic shared search', revision: 1,
    criteria: { opportunityTypes: '', topicsAndMethods: '', locationsAndLanguages: '', fundingAndConditions: '', fitAndExclusions: '', sourcesAndQueries: '', researchAndReporting: '' },
    schedule: { frequency: 'daily', intervalHours: 1, weekdays: [], time: '09:00', timezone: 'Europe/Tirane', runImmediately: true },
    created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z',
    meta_search: { version: 1, active: true, editor, systemPrompt: 'System', userPrompt: 'User', recurringPrompt: 'Recurring' } };
}
type Reply = { data: unknown; error: unknown };
function network() {
  const reads: { owner: string; result: ReturnType<typeof deferred<Reply>> }[] = [];
  let rpcCalls = 0;
  const client = { from(table: string) {
    assert.equal(table, 'opportunity_search_templates');
    let owner = '';
    const query = { select(value: string) { assert.equal(value, '*'); return query; },
      eq(key: string, value: string) { assert.equal(key, 'user_id'); owner = value; return query; },
      order(key: string) { assert.equal(key, 'updated_at'); const result = deferred<Reply>(); reads.push({ owner, result }); return result.promise; } };
    return query;
  }, rpc() { rpcCalls++; throw new Error('Dashboard history is unavailable and must never be requested by Insights.'); } } as unknown as SupabaseClient;
  return { reads, client, rpcCalls: () => rpcCalls };
}
function mount(t: TestContext, client: SupabaseClient | null, owner = ownerId, project: string | null = projectRef) {
  const scope = effectScope(), ownerValue = ref(owner), clientValue = shallowRef(client), projectValue = ref(project ?? undefined);
  const state = scope.run(() => useOpportunityInsightsSearch({ ownerId: () => ownerValue.value,
    client: () => clientValue.value, projectRef: () => projectValue.value }))!;
  t.after(() => scope.stop());
  return { state, scope, owner: ownerValue, client: clientValue, project: projectValue };
}

test('insights resolves only the owner-scoped shared search identity without requesting a dashboard', async t => {
  const service = network(), view = mount(t, service.client);
  assert.equal(view.state.loading.value, true);
  assert.equal(service.reads[0]!.owner, ownerId);
  service.reads[0]!.result.resolve({ data: [row(), row(otherSearch)], error: null });
  await tick();
  assert.equal(view.state.searchId.value, searchId);
  assert.equal(view.state.hasSavedSearch.value, true);
  assert.equal(view.state.loading.value, false);
  assert.equal(view.state.error.value, '');
  assert.equal(service.reads.length, 1);
  assert.equal(service.rpcCalls(), 0, 'unavailable dashboard/run-history RPCs cannot affect metadata-only Insights');
  assert.equal('dashboard' in view.state, false);
});

test('unsupported saved metadata cannot select a search through a fallback', async t => {
  const service = network(), view = mount(t, service.client);
  service.reads[0]!.result.resolve({ data: [{ ...row(otherSearch), meta_search: undefined }, row()], error: null });
  await tick();
  assert.equal(view.state.searchId.value, null);
  assert.equal(view.state.hasSavedSearch.value, false);
  assert.notEqual(view.state.error.value, '');
  assert.equal(service.rpcCalls(), 0);
});

test('absent configuration or saved search leaves independent feedback usable without an error', async t => {
  const service = network();
  for (const [client, owner, project] of [[null, ownerId, projectRef], [service.client, '', projectRef],
    [service.client, 'invalid-owner', projectRef], [service.client, ownerId, null], [service.client, ownerId, 'invalid-project']] as const) {
    const view = mount(t, client, owner, project);
    assert.equal(view.state.loading.value, false);
    assert.equal(view.state.error.value, '');
    assert.equal(view.state.searchId.value, null);
  }
  assert.equal(service.reads.length, 0);
  const view = mount(t, service.client);
  service.reads[0]!.result.resolve({ data: [], error: null }); await tick();
  assert.equal(view.state.hasSavedSearch.value, false);
  assert.equal(view.state.loading.value, false);
  assert.equal(view.state.error.value, '');
  assert.equal(service.rpcCalls(), 0);
});

test('metadata errors expose generic recovery state and a retry can restore the saved identity', async t => {
  const service = network(), view = mount(t, service.client);
  service.reads[0]!.result.resolve({ data: null, error: { message: 'PRIVATE_DATABASE_DETAIL', code: 'NETWORK' } }); await tick();
  assert.equal(view.state.hasSavedSearch.value, false);
  assert.equal(view.state.searchId.value, null);
  assert.equal(view.state.error.value, 'Saved search context could not be loaded. Retry loading it.');
  assert(!view.state.error.value.includes('PRIVATE'));
  const retry = view.state.refresh();
  service.reads[1]!.result.resolve({ data: [row()], error: null });
  assert.equal(await retry, true);
  assert.equal(view.state.searchId.value, searchId);
  assert.equal(view.state.error.value, '');
  assert.equal(service.rpcCalls(), 0);
});

test('foreign owner rows and malformed search identities fail closed before producing context', async t => {
  for (const saved of [row(searchId, otherOwner), row('not-a-uuid'), row('91000000-0000-4000-8000-000000000002; private')]) {
    const service = network(), view = mount(t, service.client);
    service.reads[0]!.result.resolve({ data: [saved], error: null }); await tick();
    assert.equal(view.state.searchId.value, null);
    assert.equal(view.state.hasSavedSearch.value, false);
    assert.equal(view.state.error.value, 'Saved search context could not be loaded. Retry loading it.');
    assert.equal(service.rpcCalls(), 0);
  }
});

test('owner, client and project switches immediately clear context and ignore stale list responses', async t => {
  const first = network(), second = network(), view = mount(t, first.client);
  first.reads[0]!.result.resolve({ data: [row()], error: null }); await tick();
  assert.equal(view.state.searchId.value, searchId);
  const oldRefresh = view.state.refresh();
  view.owner.value = otherOwner;
  assert.equal(view.state.searchId.value, null);
  first.reads[1]!.result.resolve({ data: [row()], error: null });
  assert.equal(await oldRefresh, false);
  assert.equal(view.state.searchId.value, null);
  first.reads[2]!.result.resolve({ data: [row(otherSearch, otherOwner)], error: null }); await tick();
  assert.equal(view.state.searchId.value, otherSearch);
  view.client.value = second.client;
  assert.equal(view.state.searchId.value, null);
  view.project.value = 'tsrqponmlkjihgfedcba';
  second.reads[0]!.result.resolve({ data: [row(otherSearch, otherOwner)], error: null }); await tick();
  assert.equal(view.state.searchId.value, null);
  assert.equal(view.state.loading.value, true);
  second.reads[1]!.result.resolve({ data: [], error: null }); await tick();
  assert.equal(view.state.loading.value, false);
  assert.equal(view.state.error.value, '');
  assert.equal(first.rpcCalls() + second.rpcCalls(), 0);
});

test('scope disposal prevents a pending metadata read from repopulating a closed view', async t => {
  const service = network(), view = mount(t, service.client);
  view.scope.stop();
  service.reads[0]!.result.resolve({ data: [row()], error: null }); await tick();
  assert.equal(view.state.searchId.value, null);
  assert.equal(view.state.loading.value, false);
  assert.equal(await view.state.refresh(), false);
  assert.equal(service.reads.length, 1);
  assert.equal(service.rpcCalls(), 0);
});
