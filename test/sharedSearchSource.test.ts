import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { effectScope, ref, shallowRef } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchCloudTemplate, SearchTemplate } from '../src/features/meta-search/searchTypes';
import { useSharedSearchSource } from '../src/features/meta-search/composables/useSharedSearchSource';
import { createSearchTemplate, searchTemplateContentKey, searchTemplateStorageKey, type StorageAdapter } from '../src/features/meta-search/data/useSearchTemplates';
import { searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../src/features/meta-search/data/searchTemplateCloud';

const cloudId = '40000000-0000-4000-8000-000000000001';
const otherCloudId = '40000000-0000-4000-8000-000000000002';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function memoryStorage() {
  const values = new Map<string, string>();
  let writes = 0;
  return { values, get writes() { return writes; }, getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { writes++; values.set(key, value); } };
}
function template(interests = 'Local acoustic sensing', acknowledged = false): SearchTemplate {
  const value = createSearchTemplate('Shared research', 'Europe/Tirane');
  value.researchInterests = interests;
  if (acknowledged) value.cloud = { id: cloudId, revision: 3, contentKey: searchTemplateContentKey(value) };
  return value;
}
function cloudRow(owner = 'owner', interests = 'Cloud robotics', id = cloudId, active = true): SearchCloudTemplate {
  const editor = template(interests); editor.active = active;
  return { id, user_id: owner, name: editor.name, revision: 7, created_at: editor.updatedAt, updated_at: editor.updatedAt,
    criteria: searchTemplateCloudCriteria(editor), schedule: searchTemplateCloudSchedule(editor),
    meta_search: { version: 1, active, editor, systemPrompt: 'System', userPrompt: 'User', recurringPrompt: 'Recurring' } };
}
type Reply = { data: SearchCloudTemplate[] | null; error: Error | null };
function cloudClient() {
  const reads: { owner: string; result: ReturnType<typeof deferred<Reply>> }[] = [];
  const client = { from(table: string) {
    assert.equal(table, 'opportunity_search_templates');
    let owner = '';
    const builder = { select: () => builder, eq(key: string, value: string) { assert.equal(key, 'user_id'); owner = value; return builder; },
      order() { const result = deferred<Reply>(); reads.push({ owner, result }); return result.promise; } };
    return builder;
  }, rpc() { assert.fail('The source loader must not write to the cloud.'); } } as unknown as SupabaseClient;
  return { client, reads };
}
function fixture(t: TestContext, storage = memoryStorage(), initialClient: SupabaseClient | null = null, storageGetter?: () => StorageAdapter) {
  const owner = ref('owner');
  const client = shallowRef(initialClient);
  const scope = effectScope();
  const source = scope.run(() => useSharedSearchSource({ owner: () => owner.value, client: () => client.value,
    storage: storageGetter || (() => storage) }))!;
  t.after(() => scope.stop());
  const seed = (value: SearchTemplate, account = owner.value) => storage.values.set(searchTemplateStorageKey(account), JSON.stringify([value]));
  return { owner, client, source, storage, scope, seed };
}
function succeed(read: ReturnType<typeof cloudClient>['reads'][number], rows: SearchCloudTemplate[]) { read.result.resolve({ data: rows, error: null }); }

test('an absent local key produces no generated default, and loading never writes', async t => {
  const f = fixture(t);
  assert.equal(searchTemplateStorageKey(''), 'cv.search-templates.v1:local');
  assert.equal(searchTemplateStorageKey('a/b'), 'cv.search-templates.v1:a%2Fb');
  f.source.reloadLocal(); await f.source.load();
  assert.equal(f.source.templates.value.length, 0);
  assert.equal(f.source.status.value, 'empty');
  const network = cloudClient(); f.client.value = network.client;
  const loading = f.source.load(); succeed(network.reads[0]!, [cloudRow()]); await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Cloud robotics');
  assert.equal(f.storage.values.size, 0);
  assert.equal(f.storage.writes, 0);
});

test('committed local content wins over preview cloud refreshes and unacknowledged forced refreshes', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  f.seed(template());
  await f.source.load({ refreshCloud: true });
  await f.source.load({ refreshCloud: true, refreshSavedLocal: true });
  assert.equal(network.reads.length, 0);
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Local acoustic sensing');
  assert.equal(f.source.status.value, 'ready');
  assert.equal(f.storage.writes, 0);
});

test('same-scope reads deduplicate, normal loads reuse cloud hydration, and preview refreshes refetch', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const first = f.source.load(), duplicate = f.source.load({ refreshCloud: true });
  assert.equal(first, duplicate);
  assert.equal(network.reads.length, 1);
  assert.equal(f.source.loading.value, true);
  assert.equal(f.source.status.value, 'loading');
  succeed(network.reads[0]!, [cloudRow()]); await first;
  f.source.reloadLocal(); await f.source.load();
  assert.equal(network.reads.length, 1);
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Cloud robotics');
  const refreshed = f.source.load({ refreshCloud: true });
  assert.equal(network.reads.length, 2);
  succeed(network.reads[1]!, [cloudRow('owner', 'Latest cloud interests')]); await refreshed;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Latest cloud interests');
});

test('explicit application refresh selects the acknowledged bound row without rewriting local content', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const local = template('Acknowledged local interests', true); f.seed(local);
  await f.source.load({ refreshCloud: true });
  assert.equal(network.reads.length, 0);
  const loading = f.source.load({ refreshCloud: true, refreshSavedLocal: true });
  succeed(network.reads[0]!, [cloudRow('owner', 'Another saved search', otherCloudId), cloudRow('owner', 'Updated bound search')]);
  await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Updated bound search');
  assert.equal(f.storage.getItem(searchTemplateStorageKey('owner')), JSON.stringify([local]));
  assert.equal(f.storage.writes, 0);
});

test('a missing bound row remains empty instead of substituting another search', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client); f.seed(template('Bound', true));
  const loading = f.source.load({ refreshCloud: true, refreshSavedLocal: true });
  succeed(network.reads[0]!, [cloudRow('owner', 'Unrelated', otherCloudId)]); await loading;
  assert.equal(f.source.templates.value.length, 0);
  assert.equal(f.source.status.value, 'empty');
});

test('cloud-only refreshes prefer a shared document over a newer legacy row', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const legacy = cloudRow('owner', 'Legacy', otherCloudId); delete legacy.meta_search;
  const loading = f.source.load({ refreshCloud: true });
  succeed(network.reads[0]!, [legacy, cloudRow('owner', 'Shared document')]); await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Shared document');
});

test('a local commit made during a cloud read wins even without an update event', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const loading = f.source.load(); f.seed(template('Committed during the request'));
  succeed(network.reads[0]!, [cloudRow()]); await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Committed during the request');
  assert.equal(f.source.status.value, 'ready');
  assert.equal(f.source.loading.value, false);
});

test('reloadLocal invalidates an older cloud failure and retains the committed source', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const loading = f.source.load(); f.seed(template('Local event commit')); f.source.reloadLocal();
  network.reads[0]!.result.reject(new Error('Obsolete cloud failure')); await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Local event commit');
  assert.equal(f.source.status.value, 'ready');
  assert.equal(f.source.error.value, '');
});

test('a failed cloud read also notices local commits when no update event arrived', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const loading = f.source.load(); f.seed(template('Newer local commit'));
  network.reads[0]!.result.reject(new Error('Older failure')); await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Newer local commit');
  assert.equal(f.source.status.value, 'ready');
});

test('an acknowledged source edited during a forced refresh cannot be replaced by its older cloud copy', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const local = template('Previously acknowledged', true); f.seed(local);
  const loading = f.source.load({ refreshCloud: true, refreshSavedLocal: true });
  f.seed({ ...local, researchInterests: 'New committed local direction', revision: local.revision + 1 });
  succeed(network.reads[0]!, [cloudRow()]); await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'New committed local direction');
});

test('A to B to A cannot revive the first account read or clear a newer loading state', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const old = f.source.load(); f.owner.value = 'other-owner'; const other = f.source.load();
  f.owner.value = 'owner'; const latest = f.source.load();
  assert.deepEqual(network.reads.map(read => read.owner), ['owner', 'other-owner', 'owner']);
  succeed(network.reads[0]!, [cloudRow('owner', 'Old account read')]); await old;
  network.reads[1]!.result.reject(new Error('Stale other account failure')); await other;
  assert.equal(f.source.templates.value.length, 0);
  assert.equal(f.source.loading.value, true);
  assert.equal(f.source.error.value, '');
  succeed(network.reads[2]!, [cloudRow('owner', 'Current account read')]); await latest;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Current account read');
});

test('changing the client invalidates old results within the same account', async t => {
  const first = cloudClient(), second = cloudClient(), f = fixture(t, memoryStorage(), first.client);
  const old = f.source.load(); f.client.value = second.client; const latest = f.source.load();
  first.reads[0]!.result.reject(new Error('Old client failed')); await old;
  assert.equal(f.source.loading.value, true);
  succeed(second.reads[0]!, [cloudRow('owner', 'New client result')]); await latest;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'New client result');
});

test('disposal suppresses late results and errors without further reads', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const loading = f.source.load(); f.scope.stop(); network.reads[0]!.result.reject(new Error('Late failure')); await loading;
  await f.source.load(); f.source.reloadLocal();
  assert.equal(network.reads.length, 1);
  assert.equal(f.source.templates.value.length, 0);
  assert.equal(f.source.status.value, 'empty');
  assert.equal(f.source.error.value, '');
});

test('a current error rejects and exposes retryable state, then a retry clears it', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  const loading = f.source.load(); network.reads[0]!.result.resolve({ data: null, error: new Error('Search unavailable') });
  await assert.rejects(loading, /Search unavailable/);
  assert.equal(f.source.status.value, 'error');
  assert.equal(f.source.error.value, 'Search unavailable');
  assert.equal(f.source.loading.value, false);
  const retry = f.source.load(); succeed(network.reads[1]!, [cloudRow()]); await retry;
  assert.equal(f.source.status.value, 'ready'); assert.equal(f.source.error.value, '');
});

test('blocked browser storage does not prevent mounting and is reported from operations', async t => {
  let accesses = 0;
  const f = fixture(t, memoryStorage(), null, () => { accesses++; throw new Error('Storage blocked'); });
  assert.equal(accesses, 0);
  await assert.rejects(f.source.load(), /Storage blocked/);
  assert.equal(f.source.status.value, 'error');
  assert.throws(() => f.source.reloadLocal(), /Storage blocked/);
  assert.equal(f.source.error.value, 'Storage blocked');
});

test('invalid committed data reports an error without falling back to cloud or defaults', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  f.storage.values.set(searchTemplateStorageKey('owner'), '{broken');
  await assert.rejects(f.source.load());
  assert.equal(f.source.status.value, 'error');
  assert.equal(network.reads.length, 0);
});

test('empty interests still provide the search template and converted paused content retains its local revision', async t => {
  const network = cloudClient(), f = fixture(t, memoryStorage(), network.client);
  f.seed(template('')); await f.source.load();
  assert.equal(f.source.templates.value.length, 1);
  assert.equal(f.source.status.value, 'empty');
  f.storage.values.clear();
  const loading = f.source.load({ refreshCloud: true });
  const paused = cloudRow('owner', 'Paused search interests', cloudId, false);
  succeed(network.reads[0]!, [paused]); await loading;
  assert.equal(f.source.templates.value[0]?.researchInterests, 'Paused search interests');
  assert.equal(f.source.templates.value[0]?.revision, paused.meta_search!.editor.revision);
  assert.equal(f.source.templates.value[0]?.cloud?.contentKey, '');
});
