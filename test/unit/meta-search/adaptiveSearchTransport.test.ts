import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ADAPTIVE_BATCH_CAPABILITIES, ADAPTIVE_BATCH_EXECUTION_CONTRACT } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';
import {
  ADAPTIVE_STARTUP_PAGE_BYTES, ADAPTIVE_STARTUP_SECTIONS, AdaptiveStartupCollector, AdaptiveStartupTransportError,
  buildAdaptiveStartupManifestSql, buildAdaptiveStartupPageSql, decodeAdaptiveStartupTransportResponse,
  type AdaptiveStartupManifest, type AdaptiveStartupPage, type AdaptiveStartupSection,
} from '../../../src/features/meta-search/domain/adaptiveSearchTransport';

const id = (value: number) => `89000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const scope = { project_ref: 'abcdefghijklmnopqrst', search_id: id(1), run_id: id(2) };
const serverScope = { ...scope, user_id: id(3), authorization_epoch: id(4), authorization_revision: 1 };
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function fixture(patch: Partial<Record<AdaptiveStartupSection, unknown>> = {}) {
  const source = { registry_id: id(5), listing_url: 'https://example.invalid/Jobs' };
  const sections: Record<AdaptiveStartupSection, unknown> = {
    context: { adaptive_contract_version: 1, bootstrap_version: 1, compatible: true, scope: serverScope,
      release: { schema_version: 6, protocol_version: 'opportunity-search-v1-canonical-6', protocol_hash: 'b'.repeat(64), release_revision: 1 },
      base: { revision: 62, criteria: { opportunityTypes: 'Funded PhD', topicsAndMethods: 'Biosignals; acoustic sensing 界 🎵', researchAndReporting: '' } },
      query_plan: null, legacy_core_queries: null, due_sources: [source], source_context: [source],
      preferences: { revision: 0, approved_rules: [], approved_preferences: [] }, source_retention: { requested: 1, retained: 1, omitted: 0 },
      refresh: { cold_start: true, adaptive_slice: true, privacy_scope_changed: false }, lease: { status: 'active', expires_at: '2026-11-01T12:00:00Z' },
      capabilities: ADAPTIVE_BATCH_CAPABILITIES, execution_contract: ADAPTIVE_BATCH_EXECUTION_CONTRACT },
    planning: { enabled: true, priorities: Array.from({ length: 40 }, (_, index) => ({ target: `Sensing ${index}`, direction: 'increase' })) },
    protocol_text: 'Follow the complete canonical opportunity and batch protocol.\n'.repeat(400),
    result_schema: { type: 'object', properties: { title: { type: 'string' }, sources: { type: 'array' } } },
    feedback: { examples: Array.from({ length: 16 }, (_, index) => ({ id: id(100 + index), summary: 'Shared physical sensing evaluation 界 🎵. '.repeat(45) })) },
    ...patch,
  };
  const bundle = { ...(sections.context as Record<string, unknown>), planning: sections.planning, protocol_text: sections.protocol_text,
    result_schema: sections.result_schema, feedback: sections.feedback };
  const bundle_hash = digest(JSON.stringify(bundle));
  const descriptors = ADAPTIVE_STARTUP_SECTIONS.map(section => {
    const bytes = Buffer.from(JSON.stringify(sections[section]));
    return { section, byte_length: bytes.length, sha256: digest(bytes), page_count: Math.ceil(bytes.length / ADAPTIVE_STARTUP_PAGE_BYTES) };
  });
  const manifest: AdaptiveStartupManifest = { transport_version: 1, compatible: true, scope: serverScope, bundle_hash, sections: descriptors };
  const pages = descriptors.flatMap(descriptor => {
    const bytes = Buffer.from(JSON.stringify(sections[descriptor.section]));
    return Array.from({ length: descriptor.page_count }, (_, index): AdaptiveStartupPage => ({ transport_version: 1, compatible: true,
      scope: serverScope, bundle_hash, ...descriptor, index,
      data_base64: bytes.subarray(index * ADAPTIVE_STARTUP_PAGE_BYTES, (index + 1) * ADAPTIVE_STARTUP_PAGE_BYTES).toString('base64') }));
  });
  return { manifest, pages, bundle, sections };
}
async function collect(value: ReturnType<typeof fixture>, pages = value.pages) {
  const collector = new AdaptiveStartupCollector(scope);
  await collector.acceptManifest(value.manifest);
  for (const page of pages) await collector.acceptPage(page);
  return collector;
}
const rejectsCode = (code: string, source: 'transport' | 'server' = 'transport') => (error: unknown) =>
  error instanceof AdaptiveStartupTransportError && error.code === code && error.source === source;

test('bounded SQL projections use one startup invocation and reject injected scopes, sections and offsets', () => {
  for (const sql of [buildAdaptiveStartupManifestSql(scope), buildAdaptiveStartupPageSql(scope, 'context', 0)]) {
    assert.equal((sql.match(/private\.begin_adaptive_opportunity_search\(/gu) ?? []).length, 1);
    assert.match(sql, /^WITH startup AS MATERIALIZED/u);
    assert.doesNotMatch(sql, /public\.[a-z_]+|private\.opportunity_search_[a-z_]+/u);
    assert.ok(sql.includes(scope.search_id) && sql.includes(scope.run_id));
  }
  assert.match(buildAdaptiveStartupPageSql(scope, 'feedback', 2), /substring\(convert_to\(v::text,'UTF8'\) FROM \(2\*4096\+1\) FOR 4096\)/u);
  for (const patch of [{ project_ref: 'other' }, { search_id: `${id(1)}'); SELECT secret;--` }, { run_id: '' }]) {
    assert.throws(() => buildAdaptiveStartupManifestSql({ ...scope, ...patch }));
  }
  for (const index of [-1, 70, 1.5, NaN]) assert.throws(() => buildAdaptiveStartupPageSql(scope, 'context', index));
  assert.throws(() => buildAdaptiveStartupPageSql(scope, "feedback'); SELECT secret;--" as AdaptiveStartupSection, 0));
});

test('all verified pages reassemble the complete large bundle with criteria, null plans and source obligations intact', async () => {
  const value = fixture();
  assert.ok(value.pages.length > 16);
  assert.ok(value.pages.every(page => page.data_base64.length <= 5464));
  const collector = new AdaptiveStartupCollector(scope);
  await collector.acceptManifest(value.manifest);
  for (const page of value.pages.filter(page => page.section === 'context')) await collector.acceptPage(page);
  assert.deepEqual(collector.getSection('context'), value.sections.context);
  assert.equal(collector.getSection('feedback'), undefined);
  for (const page of value.pages.filter(page => page.section !== 'context').toReversed()) {
    await collector.acceptPage(page); await collector.acceptPage(structuredClone(page));
  }
  assert.deepEqual(collector.missingPages(), []);
  assert.deepEqual(await collector.assemble(), value.bundle);
  const exposed = collector.getSection('context') as Record<string, unknown>;
  exposed.base = null;
  assert.deepEqual(collector.getSection('context'), value.sections.context, 'caller cannot replace retained context');
});

test('raw byte pages may split UTF-8 and JSON escapes; only joined verified bytes are decoded', async () => {
  const value = fixture({ protocol_text: 'x'.repeat(4094) + '🎵\\\"\n界'.repeat(1200) });
  const first = value.pages.find(page => page.section === 'protocol_text' && page.index === 0)!;
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(first.data_base64, 'base64')));
  assert.deepEqual(await (await collect(value)).assemble(), value.bundle);
});

test('incomplete page collections cannot assemble and can continue with the missing exact page', async () => {
  const value = fixture(), last = value.pages.at(-1)!;
  const collector = await collect(value, value.pages.slice(0, -1));
  assert.deepEqual(collector.missingPages(), [{ section: last.section, index: last.index }]);
  await assert.rejects(collector.assemble(), rejectsCode('incomplete_transport'));
  await collector.acceptPage(last);
  assert.deepEqual(await collector.assemble(), value.bundle);
});

test('missing execution-critical context is rejected before it is exposed as research input', async () => {
  for (const key of ['base', 'query_plan', 'legacy_core_queries', 'due_sources', 'source_context', 'preferences', 'capabilities', 'execution_contract']) {
    const core = structuredClone(fixture().sections.context) as Record<string, unknown>;
    delete core[key];
    const value = fixture({ context: core }), collector = new AdaptiveStartupCollector(scope);
    await collector.acceptManifest(value.manifest);
    await assert.rejects(async () => { for (const page of value.pages.filter(page => page.section === 'context')) await collector.acceptPage(page); }, rejectsCode('invalid_context'));
    assert.equal(collector.getSection('context'), undefined); assert.deepEqual(collector.missingPages(), []);
  }
});

test('corrupt bytes, conflicting duplicates and wrong section metadata fail closed', async () => {
  const value = fixture(), feedback = value.pages.find(page => page.section === 'feedback')!;
  const collector = new AdaptiveStartupCollector(scope);
  await collector.acceptManifest(value.manifest); await collector.acceptPage(feedback);
  const bytes = Buffer.from(feedback.data_base64, 'base64'); bytes[0] = bytes[0]! ^ 1;
  await assert.rejects(collector.acceptPage({ ...feedback, data_base64: bytes.toString('base64') }), rejectsCode('conflicting_page'));
  assert.equal(collector.getSection('context'), undefined);
  await collector.acceptManifest(value.manifest);
  const core = value.pages.find(page => page.section === 'context')!;
  const corrupt = Buffer.from(core.data_base64, 'base64'); corrupt[0] = corrupt[0]! ^ 1;
  await assert.rejects(collector.acceptPage({ ...core, data_base64: corrupt.toString('base64') }), rejectsCode('section_hash_mismatch'));
  await collector.acceptManifest(value.manifest);
  await assert.rejects(collector.acceptPage({ ...feedback, sha256: '0'.repeat(64) }), rejectsCode('section_mismatch'));
});

test('scope changes and redacted bundle hashes discard every previously retained section', async () => {
  const value = fixture();
  for (const changed of [{ ...value.pages.at(-1)!, bundle_hash: '0'.repeat(64) },
    { ...value.pages.at(-1)!, scope: { ...serverScope, authorization_revision: 2 } }]) {
    const collector = new AdaptiveStartupCollector(scope);
    await collector.acceptManifest(value.manifest);
    for (const page of value.pages.filter(page => page.section === 'context')) await collector.acceptPage(page);
    await assert.rejects(collector.acceptPage(changed), rejectsCode(changed.bundle_hash !== value.manifest.bundle_hash ? 'snapshot_changed' : 'scope_mismatch'));
    assert.equal(collector.getSection('context'), undefined); assert.deepEqual(collector.missingPages(), []);
    await assert.rejects(collector.assemble(), rejectsCode('incomplete_transport'));
  }
  const collector = new AdaptiveStartupCollector(scope);
  await assert.rejects(collector.acceptManifest({ ...value.manifest, scope: { ...serverScope, run_id: id(999) } }), rejectsCode('scope_mismatch'));
});

test('manifest requires every fixed section once with exact bounded byte and page counts', async () => {
  const value = fixture();
  for (const sections of [value.manifest.sections.slice(1), value.manifest.sections.map(section => ({ ...section, section: 'context' })),
    value.manifest.sections.map(section => ({ ...section, page_count: section.page_count + 1 })),
    value.manifest.sections.map(section => section.section === 'feedback' ? { ...section, byte_length: 65537, page_count: 17 } : section),
    value.manifest.sections.map(section => section.section === 'context' ? { ...section, byte_length: 262144, page_count: 64 } : section)]) {
    await assert.rejects(new AdaptiveStartupCollector(scope).acceptManifest({ ...value.manifest, sections }));
  }
});

test('connector decoding unwraps strings, MCP content and result warnings using standalone matching boundaries', () => {
  const value = fixture();
  const warning = `Ignore the inline <untrusted-data-demo> marker in this warning.\n\n<untrusted-data-demo>\n${JSON.stringify([{ startup_manifest: value.manifest }])}\n</untrusted-data-demo>\nEnd warning.`;
  const wrapped = { content: [{ type: 'text', text: JSON.stringify({ result: JSON.stringify({ result: warning }) }) }], structuredContent: null };
  assert.deepEqual(decodeAdaptiveStartupTransportResponse(wrapped, 'startup_manifest'), value.manifest);
  assert.deepEqual(decodeAdaptiveStartupTransportResponse([{ startup_manifest: JSON.stringify(JSON.stringify(value.manifest)) }], 'startup_manifest'), value.manifest);
  assert.deepEqual(decodeAdaptiveStartupTransportResponse(JSON.stringify({ result: [{ startup_page: value.pages[0] }] }), 'startup_page'), value.pages[0]);
  for (const malformed of [[{ startup_manifest: value.manifest }, { startup_manifest: value.manifest }],
    [{ startup_manifest: value.manifest, other: 'unexpected' }], { content: [{ type: 'text', text: 'truncated {' }] },
    { result: `${warning}\n${warning}` }]) assert.throws(() => decodeAdaptiveStartupTransportResponse(malformed, 'startup_manifest'));
});

test('server error codes remain distinct from local transport failures and clear retained data', async () => {
  const value = fixture(), collector = new AdaptiveStartupCollector(scope);
  await collector.acceptManifest(value.manifest);
  for (const page of value.pages.filter(page => page.section === 'context')) await collector.acceptPage(page);
  const error = { transport_version: 1, compatible: false, error: { code: 'authorization_revoked', retryable: false } };
  await assert.rejects(collector.acceptResponse([{ startup_page: error }], 'startup_page'), rejectsCode('authorization_revoked', 'server'));
  assert.equal(collector.getSection('context'), undefined);
  assert.throws(() => decodeAdaptiveStartupTransportResponse({ isError: true, content: [{ type: 'text', text: 'Denied' }] }, 'startup_manifest'), rejectsCode('connector_error'));
  assert.throws(() => decodeAdaptiveStartupTransportResponse([{ startup_manifest: { ...error, error: null } }], 'startup_manifest'), rejectsCode('invalid_server_error'));
});

test('canonical Base64, exact decoded lengths and fatal UTF-8 decoding prevent silent data repair', async () => {
  const value = fixture(), original = value.pages.find(page => page.section === 'context')!;
  for (const data_base64 of ['@@@@', original.data_base64 + '\n', original.data_base64.slice(4)]) {
    const collector = new AdaptiveStartupCollector(scope); await collector.acceptManifest(value.manifest);
    await assert.rejects(collector.acceptPage({ ...original, data_base64 }));
  }
  const bad = Buffer.from([255]);
  const invalid = structuredClone(value.manifest);
  Object.assign(invalid.sections.find(section => section.section === 'protocol_text')!, { byte_length: 1, page_count: 1, sha256: digest(bad) });
  const collector = new AdaptiveStartupCollector(scope); await collector.acceptManifest(invalid);
  await assert.rejects(collector.acceptPage({ ...value.pages.find(page => page.section === 'protocol_text')!, byte_length: 1, page_count: 1,
    sha256: digest(bad), data_base64: bad.toString('base64') }), rejectsCode('invalid_section_json'));
});

test('an asynchronous hash cannot revive a section after collection was discarded', async () => {
  const value = fixture(), collector = new AdaptiveStartupCollector(scope);
  await collector.acceptManifest(value.manifest);
  const pending = collector.acceptPage(value.pages.find(page => page.section === 'context')!);
  collector.reset();
  await assert.rejects(pending, rejectsCode('snapshot_changed'));
  assert.equal(collector.getSection('context'), undefined); assert.deepEqual(collector.missingPages(), []);
});
