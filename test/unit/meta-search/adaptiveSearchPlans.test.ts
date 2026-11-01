import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityFeedbackTextHash } from '../../../src/features/opportunities/domain/opportunityFeedbackPrivacy';
import {
  ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION, adaptiveSearchPlanDocument, createAdaptiveSearchPlan, legacySearchQueriesPayload,
  readSearchQueryPlan, replaceAdaptiveSearchSlice, searchPlanFreshness, validateAdaptiveSearchPlanTransition, validateAdaptiveSearchQueries, validateLegacyCoreQueryAnchor,
  type AdaptiveSearchPlanBasis, type AdaptiveSearchQueryInput,
} from '../../../src/features/meta-search/domain/adaptiveSearchPlans';

const id = (index: number) => `74000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const basis = (patch: Partial<AdaptiveSearchPlanBasis> = {}): AdaptiveSearchPlanBasis => ({ base_revision: 2, feedback_revision: 3,
  preference_revision: 1, protocol_version: 'opportunity-search-v1-canonical-6', ...patch });
const query = (index: number, patch: Partial<AdaptiveSearchQueryInput> = {}): AdaptiveSearchQueryInput => ({ query_id: id(index),
  query: `site:example.invalid funded BCI research ${index}`, role: 'adaptive', ...patch });

test('AF-04 query version 2 preserves stable identity and hashes exact changed text without mutating old plans', async () => {
  const originalInput = query(1);
  const original = await createAdaptiveSearchPlan(basis(), [originalInput]);
  assert.equal(original.schema_version, ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION);
  assert.equal(original.queries[0]!.text_hash, await opportunityFeedbackTextHash(originalInput.query));
  const changed = await createAdaptiveSearchPlan(basis({ feedback_revision: 4 }), [query(1, { query: 'site:example.invalid funded robotic sensing PhD' })]);
  assert.equal(changed.queries[0]!.query_id, original.queries[0]!.query_id);
  assert.notEqual(changed.queries[0]!.text_hash, original.queries[0]!.text_hash);
  assert.equal(original.queries[0]!.query, originalInput.query);
  assert.equal(original.basis.feedback_revision, 3);
  assert.ok(Object.isFrozen(original) && Object.isFrozen(original.queries) && Object.isFrozen(original.queries[0]));
  assert.throws(() => { (original.queries[0] as { query: string }).query = 'Unexpected rewrite'; }, TypeError);
});

test('AF-04 exact wire query document is separate from independent revision metadata', async () => {
  const plan = await createAdaptiveSearchPlan(basis(), [query(1)]);
  const document = adaptiveSearchPlanDocument(plan);
  assert.deepEqual(Object.keys(document), ['schema_version', 'queries']);
  const reread = await readSearchQueryPlan(document, basis());
  assert.equal(reread.format, 'adaptive-v2');
  if (reread.format === 'adaptive-v2') assert.deepEqual(reread.plan, plan);
  await assert.rejects(readSearchQueryPlan(document), /Invalid independent/);
  await assert.rejects(readSearchQueryPlan({ ...document, private_note: 'Never interpreted' }, basis()), /Unsupported/);
});

test('AF-04 historical query arrays remain exact, immutable, unattributed legacy input', async () => {
  const legacy = [{ query: '  funded BCI PhD  ', sources: ['EXAMPLE.invalid', 'https://example.invalid/Jobs?jobId=123456789'] },
    { query: 'acoustic robotics research' }];
  const before = JSON.stringify(legacy);
  const result = await readSearchQueryPlan(legacy);
  assert.equal(result.format, 'legacy');
  if (result.format !== 'legacy') assert.fail('Expected legacy input');
  assert.deepEqual(result.queries, legacy);
  assert.equal(result.requires_migration, true);
  assert.equal(JSON.stringify(legacy), before);
  assert.doesNotMatch(JSON.stringify(result), /query_id|text_hash|manual|created_at|discovered_at|executed_at/u);
  legacy[0]!.sources!.push('new.invalid');
  assert.equal(result.queries[0]!.sources!.length, 2, 'read models never alias mutable historical arrays');
});

test('AF-04 cold-start empty input is missing/stale while publishing zero or over 30 queries fails', async () => {
  for (const value of [null, undefined, []]) {
    const result = await readSearchQueryPlan(value);
    assert.equal(result.format, 'missing');
    assert.deepEqual(searchPlanFreshness(result, basis()), { status: 'missing', stale_axes: [], core_stale: true, adaptive_stale: true, requires_generation: true });
  }
  await assert.rejects(createAdaptiveSearchPlan(basis(), []), /between 1 and 30/);
  await assert.rejects(createAdaptiveSearchPlan(basis(), Array.from({ length: 31 }, (_, index) => query(index + 1))), /between 1 and 30/);
  const maximum = await createAdaptiveSearchPlan(basis(), Array.from({ length: 30 }, (_, index) => query(index + 1)));
  assert.equal(maximum.queries.length, 30);
});

test('AF-04 feedback/preferences changes invalidate the adaptive slice without making core queries stale', async () => {
  const current = await createAdaptiveSearchPlan(basis(), [query(1, { role: 'core', manual: true })]);
  const read = await readSearchQueryPlan(adaptiveSearchPlanDocument(current), current.basis);
  assert.deepEqual(searchPlanFreshness(read, basis()), { status: 'current', stale_axes: [], core_stale: false, adaptive_stale: false, requires_generation: false });
  assert.deepEqual(searchPlanFreshness(read, basis({ feedback_revision: 4, preference_revision: 2 })), {
    status: 'stale', stale_axes: ['feedback', 'preference'], core_stale: false, adaptive_stale: true, requires_generation: true,
  });
  const changedBase = searchPlanFreshness(read, basis({ base_revision: 3 }));
  assert.equal(changedBase.core_stale, true); assert.deepEqual(changedBase.stale_axes, ['base']);
  const changedProtocol = searchPlanFreshness(read, basis({ protocol_version: 'opportunity-search-v2' }));
  assert.equal(changedProtocol.core_stale, true); assert.deepEqual(changedProtocol.stale_axes, ['protocol']);
});

test('AF-04 adaptive replacement preserves every core query, source hint and registry target', async () => {
  const original = await createAdaptiveSearchPlan(basis(), [query(1, { role: 'core', manual: true, sources: ['https://example.invalid/Jobs?topic=BCI'], source_registry_id: id(900) }),
    query(2, { role: 'core', manual: false }), query(3)]);
  const next = await replaceAdaptiveSearchSlice(original, [query(4, { role: 'exploration' })], basis({ feedback_revision: 4 }));
  assert.deepEqual(next.queries.slice(0, 2), original.queries.slice(0, 2));
  assert.deepEqual(next.queries.map(item => item.query_id), [1, 2, 4].map(id));
  assert.equal(next.queries[0]!.source_registry_id, id(900));
  assert.equal(original.queries[2]!.query_id, id(3), 'old run plans retain the previous adaptive query');
  await assert.rejects(replaceAdaptiveSearchSlice(original, [query(4, { role: 'core' })], basis()), /cannot replace manual or core/);
});

test('AF-04 management transitions protect all core on the same base, and manual core through base edits', async () => {
  const previous = await createAdaptiveSearchPlan(basis(), [query(1, { role: 'core', manual: true }), query(2, { role: 'core' }), query(3)]);
  const erased = await createAdaptiveSearchPlan(basis({ feedback_revision: 4 }), [query(1, { role: 'core', manual: true }), query(4)]);
  assert.throws(() => validateAdaptiveSearchPlanTransition(previous, erased), /preserve protected core/);
  const baseEdited = await createAdaptiveSearchPlan(basis({ base_revision: 3 }), [query(1, { role: 'core', manual: true }), query(5, { role: 'core' })]);
  assert.doesNotThrow(() => validateAdaptiveSearchPlanTransition(previous, baseEdited));
  const erasedManual = await createAdaptiveSearchPlan(basis({ base_revision: 3 }), [query(5, { role: 'core' })]);
  assert.throws(() => validateAdaptiveSearchPlanTransition(previous, erasedManual), /preserve protected core/);
});

test('AF-04 core capacity is explicit; adaptive refresh never drops manual queries to stay under the ceiling', async () => {
  const maximum = await createAdaptiveSearchPlan(basis(), Array.from({ length: 30 }, (_, index) => query(index + 1, { role: 'core', manual: true })));
  await assert.rejects(replaceAdaptiveSearchSlice(maximum, [query(100, { role: 'exploration' })], basis({ feedback_revision: 4 })), /between 1 and 30/);
  assert.equal(maximum.queries.length, 30);
});

test('AF-04 public source hints retain case-sensitive paths, filters and distinct vacancy identifiers', async () => {
  const result = await validateAdaptiveSearchQueries([query(1, { source_registry_id: id(901), sources: ['EXAMPLE.invalid', 'example.invalid',
    'https://EXAMPLE.invalid/Jobs?jobId=123456789', 'https://example.invalid/jobs?jobId=123456789', 'https://example.invalid/Jobs?jobId=987654321'] })]);
  assert.deepEqual(result[0]!.sources, ['EXAMPLE.invalid', 'example.invalid', 'https://EXAMPLE.invalid/Jobs?jobId=123456789',
    'https://example.invalid/jobs?jobId=123456789', 'https://example.invalid/Jobs?jobId=987654321']);
  assert.equal(result[0]!.source_registry_id, id(901));
  const sharedPortal = await validateAdaptiveSearchQueries([query(1, { query: 'first specific vacancy', sources: ['https://example.invalid/apply'] }),
    query(2, { query: 'second specific vacancy', sources: ['https://example.invalid/apply'] })]);
  assert.equal(sharedPortal.length, 2, 'a portal URL does not deduplicate vacancy/query identities');
});

test('AF-04 query validators reject false hashes, duplicate identity, private URLs and unknown schema fields', async () => {
  await assert.rejects(validateAdaptiveSearchQueries([query(1, { text_hash: 'a'.repeat(64) })]), /hash does not match/);
  await assert.rejects(validateAdaptiveSearchQueries([query(1), query(1)]), /repeat a query identity/);
  for (const sources of [['https://person:secret@example.invalid/Jobs'], ['mailto:person@example.invalid'], ['https://example.invalid/Jobs?token=secret'], ['example.local']]) {
    await assert.rejects(validateAdaptiveSearchQueries([query(1, { sources })]), /Invalid public/);
  }
  for (const invalid of [{ ...query(1), source_id: id(99) }, query(1, { manual: true }), { ...query(1), query: 'ab' }, { ...query(1), query: 'BCI\nPhD' }]) {
    await assert.rejects(validateAdaptiveSearchQueries([invalid]), /Invalid version 2/);
  }
});

test('AF-04 legacy compatibility does not activate retired profiles, archives or unsupported JSON versions', async () => {
  for (const value of [{ profiles: [{ active: true, query: 'retired private research' }] }, { legacySearchArchive: '[{"query":"old"}]' },
    '[{"query":"archived text"}]', { schema_version: 3, queries: [query(1)] }]) {
    await assert.rejects(readSearchQueryPlan(value, basis()), /Unsupported/);
  }
  await assert.rejects(readSearchQueryPlan([{ query: 'search terms', profileId: 'retired' }]), /Invalid historical/);
  const legacy = await readSearchQueryPlan([{ query: 'saved focused query' }]);
  assert.equal(searchPlanFreshness(legacy, basis()).status, 'legacy');
});

test('AF-04 explicit legacy-writer composition emits only its original strict keys', async () => {
  const plan = await createAdaptiveSearchPlan(basis(), [query(1, { role: 'core', manual: true, source_registry_id: id(900), sources: ['example.invalid'] }), query(2)]);
  const payload = legacySearchQueriesPayload(plan);
  assert.deepEqual(payload, [{ query: plan.queries[0]!.query, sources: ['example.invalid'] }, { query: plan.queries[1]!.query }]);
  assert.doesNotMatch(JSON.stringify(payload), /query_id|text_hash|manual|role|source_registry_id|feedback_revision/u);
  assert.equal((await readSearchQueryPlan(payload)).format, 'legacy');
});

test('AF-04 legacy anchors preserve exact core text/source arrays without claiming old manual authorship', async () => {
  const legacy = await readSearchQueryPlan([{ query: '  saved BCI research query  ', sources: ['EXAMPLE.invalid', 'https://example.invalid/Jobs?jobId=123456789'] }]);
  if (legacy.format !== 'legacy') assert.fail('Expected legacy anchor');
  const plan = await createAdaptiveSearchPlan(basis(), [query(1, { role: 'core', query: legacy.queries[0]!.query, sources: legacy.queries[0]!.sources })]);
  assert.doesNotThrow(() => validateLegacyCoreQueryAnchor(legacy.queries, plan));
  assert.equal(plan.queries[0]!.manual, false, 'legacy provenance does not prove manual authorship');
  const rewritten = await createAdaptiveSearchPlan(basis(), [query(1, { role: 'core', query: legacy.queries[0]!.query.trim(), sources: legacy.queries[0]!.sources })]);
  assert.throws(() => validateLegacyCoreQueryAnchor(legacy.queries, rewritten), /exact saved legacy core/);
});

test('AF-04 query hashing captures input values before asynchronous digests', async () => {
  const source = query(1, { role: 'core', manual: true, source_registry_id: id(901), sources: ['example.invalid'] });
  const pending = createAdaptiveSearchPlan(basis(), [source]);
  source.role = 'exploration'; source.source_registry_id = 'person@example.invalid';
  (source.sources as string[]).push('https://example.invalid/?token=private');
  const plan = await pending;
  assert.equal(plan.queries[0]!.role, 'core');
  assert.equal(plan.queries[0]!.source_registry_id, id(901));
  assert.deepEqual(plan.queries[0]!.sources, ['example.invalid']);
});

test('AF-04 independent revision axes reject missing/invalid versions without creating a plausible plan', async () => {
  for (const invalid of [basis({ base_revision: 0 }), basis({ feedback_revision: -1 }), basis({ preference_revision: NaN }), basis({ protocol_version: '' })]) {
    await assert.rejects(createAdaptiveSearchPlan(invalid, [query(1)]), /Invalid independent/);
  }
  await assert.rejects(validateAdaptiveSearchQueries([query(1, { sources: Array.from({ length: 17 }, () => 'example.invalid') })]), /at most 16/);
});
