import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADAPTIVE_BATCH_CAPABILITIES, ADAPTIVE_BATCH_EXECUTION_CONTRACT, ADAPTIVE_MAX_BATCH_BYTES, ADAPTIVE_MAX_OPPORTUNITY_BYTES,
  ADAPTIVE_PROTOCOL_STARTUP_CAPABILITIES, adaptiveJsonSqlLiteral, buildAdaptiveSearchSqlCall,
  validateAdaptiveBatchEnvelope, validateAdaptiveCompletionEnvelope, type AdaptiveBatchPayload, type AdaptiveCompletionPayload,
} from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

const id = (index: number) => `88000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const scope = { project_ref: 'abcdefghijklmnopqrst', search_id: id(1), run_id: id(2) };
const opportunity = { opportunity_key: 'synthetic-research', title: 'Synthetic research', last_checked_at: '2026-10-29T12:00:00Z',
  sources: [{ url: 'https://example.invalid/Jobs/ABC', kind: 'official', checked_at: '2026-10-29T12:00:00Z', precision: 'instant', supports: ['title'] }] };
const payload = (): AdaptiveBatchPayload => ({ schema_version: 1, opportunities: [{ item_id: id(3), opportunity }], execution: { checks: [], complete: false } });
const completion = (): AdaptiveCompletionPayload => ({ schema_version: 1, completion_id: id(4), batch_ids: [id(5)], status: 'complete' });

test('AF-08 reviewed capabilities enumerate only three helpers and explicit request bounds', () => {
  assert.deepEqual(ADAPTIVE_BATCH_CAPABILITIES.allowed_helpers, [
    'private.begin_adaptive_opportunity_search(uuid,uuid)', 'private.submit_adaptive_search_batch(uuid,uuid,jsonb)',
    'private.verify_and_complete_adaptive_search(uuid,jsonb)',
  ]);
  assert.equal(ADAPTIVE_PROTOCOL_STARTUP_CAPABILITIES.batch, false);
  assert.equal(ADAPTIVE_BATCH_EXECUTION_CONTRACT.maximum_batch_opportunities, 10);
  assert.equal(ADAPTIVE_BATCH_EXECUTION_CONTRACT.maximum_batch_bytes, 524288);
  assert.equal(ADAPTIVE_BATCH_EXECUTION_CONTRACT.maximum_opportunity_bytes, 262144);
  assert.equal(ADAPTIVE_BATCH_EXECUTION_CONTRACT.maximum_run_batches, 32);
});

test('AF-08 transport prepares one fixed helper call in the exact project without executing anything', () => {
  assert.deepEqual(buildAdaptiveSearchSqlCall({ action: 'startup', scope }), { project_ref: scope.project_ref,
    sql: `SELECT private.begin_adaptive_search_brief('${scope.search_id}'::uuid,'${scope.run_id}'::uuid) AS startup;` });
  const batch = buildAdaptiveSearchSqlCall({ action: 'batch', scope, batch_id: id(5), payload: payload() });
  assert.match(batch.sql, /^SELECT private\.submit_adaptive_search_batch\('/u);
  assert.equal(batch.project_ref, scope.project_ref);
  const last = buildAdaptiveSearchSqlCall({ action: 'complete', scope, payload: completion() });
  assert.match(last.sql, /^SELECT private\.verify_and_complete_adaptive_search\('/u);
  assert.throws(() => buildAdaptiveSearchSqlCall({ action: 'inspect', scope } as never), /Unsupported adaptive helper/u);
});

test('AF-08 project, search and run identifiers cannot inject SQL or select a different helper', () => {
  for (const patch of [{ project_ref: 'other-project' }, { search_id: `${id(1)}'); DROP TABLE x;--` }, { run_id: '' }, { helper: 'private.read_applications' }]) {
    assert.throws(() => buildAdaptiveSearchSqlCall({ action: 'startup', scope: { ...scope, ...patch } }));
  }
});

test('AF-08 SQL JSON literals escape apostrophes and backslashes after serialization', () => {
  const values = { title: "O'Brien'); SELECT forbidden(); --", text: '\\path\\file\nline', injection: '$payload$; SELECT other(); --', unicode: 'BCI — 聴覚' };
  const literal = adaptiveJsonSqlLiteral(values);
  assert.ok(literal.startsWith("E'")); assert.ok(literal.endsWith("'::jsonb"));
  const body = literal.slice(2, -8);
  let decoded = '';
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (char === "'") { assert.equal(body[++index], "'", 'Unescaped quote escaped the literal'); decoded += "'"; }
    else if (char === '\\') { assert.equal(body[++index], '\\', 'Unescaped E-string backslash changed JSON'); decoded += '\\'; }
    else decoded += char;
  }
  assert.deepEqual(JSON.parse(decoded), values);
});

test('AF-08 finite JSON and error messages preserve data without exposing invalid input', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const invalid of [{ secret: 'PRIVATE_CANARY\0' }, { score: NaN }, { score: Infinity }, { score: 1n }, { value: undefined }, cycle]) {
    assert.throws(() => adaptiveJsonSqlLiteral(invalid), error => error instanceof TypeError && !String(error).includes('PRIVATE_CANARY'));
  }
});

test('AF-08 batch envelopes reject unknown metadata, duplicate items and limits without canonical coercion', () => {
  validateAdaptiveBatchEnvelope(payload());
  validateAdaptiveBatchEnvelope({ schema_version: 1, opportunities: [], execution: { checks: [], complete: true } });
  for (const invalid of [{ ...payload(), data: { feedback: 'private' } }, { ...payload(), schema_version: 2 },
    { ...payload(), opportunities: Array(11).fill(payload().opportunities[0]) },
    { ...payload(), opportunities: [payload().opportunities[0], payload().opportunities[0]] },
    { ...payload(), plan_hash: 'not-a-copied-hash' },
    { ...payload(), opportunities: [{ item_id: id(3), opportunity, comment: 'PRIVATE_CANARY' }] },
    { ...payload(), query_suggestions: Array(17).fill({}) }]) assert.throws(() => validateAdaptiveBatchEnvelope(invalid));
});

test('AF-08 byte bounds measure UTF-8 for each canonical payload and the entire batch', () => {
  const value = payload();
  const huge = { ...opportunity, research_summary: '界'.repeat(Math.ceil(ADAPTIVE_MAX_OPPORTUNITY_BYTES / 3)) };
  assert.throws(() => validateAdaptiveBatchEnvelope({ ...value, opportunities: [{ item_id: id(3), opportunity: huge }] }), /byte limit/u);
  const half = { ...opportunity, research_summary: 'x'.repeat(180000) };
  assert.throws(() => validateAdaptiveBatchEnvelope({ ...value, opportunities: [1, 2, 3].map(index => ({ item_id: id(index), opportunity: half })) }), /byte limit/u);
  assert.throws(() => adaptiveJsonSqlLiteral({ value: '界'.repeat(ADAPTIVE_MAX_BATCH_BYTES) }), /byte limit/u);
});

test('AF-08 completion uses a complete sorted manifest and a stable completion identity', () => {
  validateAdaptiveCompletionEnvelope(completion());
  for (const invalid of [{ ...completion(), batch_ids: [] }, { ...completion(), batch_ids: [id(6), id(5)] },
    { ...completion(), batch_ids: [id(5), id(5)] }, { ...completion(), batch_ids: Array.from({ length: 33 }, (_, index) => id(index)) },
    { ...completion(), completion_id: 'guess' }, { ...completion(), status: 'empty-success' }, { ...completion(), tasks: ['replace'] }]) {
    assert.throws(() => validateAdaptiveCompletionEnvelope(invalid));
  }
});

test('AF-08 an interrupted startup can close the same run as failed before any batch was accepted', () => {
  const failed: AdaptiveCompletionPayload = { ...completion(), batch_ids: [], status: 'failed' };
  validateAdaptiveCompletionEnvelope(failed);
  assert.deepEqual(buildAdaptiveSearchSqlCall({ action: 'complete', scope, payload: failed }), {
    project_ref: scope.project_ref,
    sql: `SELECT private.verify_and_complete_adaptive_search('${scope.run_id}'::uuid, ${adaptiveJsonSqlLiteral(failed)});`,
  });
  assert.throws(() => validateAdaptiveCompletionEnvelope({ ...failed, status: 'complete' }), /batch manifest/u);
  assert.throws(() => validateAdaptiveCompletionEnvelope({ ...failed, completion_id: 'replacement' }), /stable UUID/u);
});

test('current payload guidance includes v2 evidence and reason restrictions while preserving the old full pin', async () => {
  const { ADAPTIVE_BATCH_PROTOCOL_TEXT, ADAPTIVE_LEGACY_BATCH_PROTOCOL_TEXT } = await import('../../../src/features/meta-search/domain/adaptiveSearchProtocol');
  assert.match(ADAPTIVE_BATCH_PROTOCOL_TEXT, /background_fit, project_context, requirements, availability/u);
  assert.match(ADAPTIVE_BATCH_PROTOCOL_TEXT, /requirements and availability allow only negative/u);
  assert.match(ADAPTIVE_BATCH_PROTOCOL_TEXT, /Current v2 application and confirmed-submission decisions are substantive evidence/u);
  assert.match(ADAPTIVE_LEGACY_BATCH_PROTOCOL_TEXT, /never a submission-only score fallback/u);
  assert.notEqual(ADAPTIVE_BATCH_PROTOCOL_TEXT, ADAPTIVE_LEGACY_BATCH_PROTOCOL_TEXT);
});
