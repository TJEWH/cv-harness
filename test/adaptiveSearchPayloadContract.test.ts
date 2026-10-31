import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ADAPTIVE_BATCH_PROTOCOL_PREFIX, ADAPTIVE_BATCH_PROTOCOL_TEXT, ADAPTIVE_PAYLOAD_CONTRACT_TEXT, ADAPTIVE_PAYLOAD_STARTUP_INSTRUCTION,
  validateAdaptiveBatchEnvelope, validateAdaptiveCompletionEnvelope } from '../src/features/meta-search/domain/adaptiveSearchProtocol';
import { buildAdaptiveRecurringSearchPrompt } from '../src/features/meta-search/domain/adaptiveSearchTask';

function examples(text: string): Record<string, any> {
  const json = /ADAPTIVE PAYLOAD EXAMPLES \(JSON templates\)\n```json\n([\s\S]+?)\n```/u.exec(text)?.[1];
  assert(json, 'the delivered protocol includes parseable complete JSON templates');
  return JSON.parse(json);
}
const id = '98000000-0000-4000-8000-000000000001';
function filled(value: unknown): any {
  return JSON.parse(JSON.stringify(value).replace(/<[^>]+>/gu, token => token.endsWith('_uuid>') ? id
    : token === '<returned_plan_hash>' ? 'a'.repeat(64)
      : token.includes('_iso>') ? '2026-10-31T12:00:00Z'
        : token.includes('_url>') ? 'https://example.invalid/verified' : 'Synthetic public evidence'));
}

test('the delivered adaptive protocol preserves its reviewed prefix and includes complete first/later/completion JSON', () => {
  assert(ADAPTIVE_BATCH_PROTOCOL_TEXT.startsWith(`${ADAPTIVE_BATCH_PROTOCOL_PREFIX}\n\n`));
  const value = examples(ADAPTIVE_BATCH_PROTOCOL_TEXT);
  validateAdaptiveBatchEnvelope(filled(value.first_batch));
  validateAdaptiveBatchEnvelope(filled(value.later_batch));
  validateAdaptiveCompletionEnvelope(filled(value.completion));
  assert.deepEqual(Object.keys(value.first_batch).sort(), ['execution', 'opportunities', 'query_plan', 'schema_version']);
  assert.deepEqual(Object.keys(value.first_batch.query_plan.queries[0]).sort(), ['manual', 'query', 'query_id', 'role']);
  assert.deepEqual(Object.keys(value.first_batch.execution).sort(), ['backlog', 'checks', 'complete']);
  assert.deepEqual(Object.keys(value.completion).sort(), ['batch_ids', 'completion_id', 'schema_version', 'status']);
  assert.equal(value.first_batch.query_plan.schema_version, 2);
  assert.equal(value.first_batch.schema_version, 1);
});

test('a canonical opportunity, attribution, listing witness and due-source check can be constructed from delivered examples', () => {
  const value = examples(ADAPTIVE_BATCH_PROTOCOL_TEXT), batch = filled(value.first_batch);
  batch.opportunities = [filled(value.opportunity_item)];
  batch.opportunities[0].reusable_source = filled(value.reusable_source);
  batch.opportunities[0].opportunity.sources.push(filled(value.listing_evidence));
  batch.execution.checks[0].results_count = 1;
  const source = filled(value.source_check); source.check_id = '98000000-0000-4000-8000-000000000002';
  batch.execution.checks.push(source);
  assert.deepEqual(Object.keys(source).sort(), ['attempted_at', 'check_id', 'kind', 'results_count', 'source_registry_id', 'status']);
  assert.equal(batch.opportunities[0].opportunity.sources[1].kind, 'official_listing');
  assert.equal(batch.opportunities[0].attribution.recommendation_generated, false);
  validateAdaptiveBatchEnvelope(batch);
});

test('instructions state every closed execution enum, optional evidence constraint, policy allocation and terminal read', () => {
  for (const required of ['complete, blocked, failed, partial, paginated, dynamic',
    'access_denied, network_error, pagination_limit, dynamic_content, budget_exhausted, unknown',
    'needs_verification, unreachable, identity_ambiguous, deadline_uncertain, budget_exhausted, pagination_limit, dynamic_content or unsafe_reference',
    'max(policy.minimum_exploration_queries,ceil(noncore_count*policy.exploration_ratio))',
    'include at least one noncore query', 'At exploration_ratio=0 all noncore queries must be adaptive and none exploration',
    'at exploration_ratio=1 all noncore queries must be exploration',
    'startup.planning.refresh_required is false and startup.refresh.adaptive_slice is false',
    'A historical plan_hash alone never establishes that the plan is already pinned',
    'manual:false', 'no plan', '0–1000000', 'never zero', 'source_context', 'effective official_listing evidence',
    'Never invent evidence refs', 'Never send legacy notes, unresolvedCount', 'Do not call a fourth read helper',
    'No plan may exceed 30 queries', 'a zero-result run']) {
    assert(ADAPTIVE_PAYLOAD_CONTRACT_TEXT.toLowerCase().includes(required.toLowerCase()), required);
  }
  const value = examples(ADAPTIVE_BATCH_PROTOCOL_TEXT);
  assert.equal(value.source_suggestion.kind, 'candidate');
  assert.equal(value.preference_suggestion.rule.kind, 'emphasis');
  assert.equal(value.source_suggestion.listing_url, undefined);
  assert.equal(value.completion.notes, undefined);
});

test('compact saved task instructions load complete shapes at startup without stale canonical numbers', () => {
  const prompt = buildAdaptiveRecurringSearchPrompt(id, 'abcdefghijklmnopqrst');
  assert(prompt.includes(ADAPTIVE_BATCH_PROTOCOL_PREFIX));
  assert(prompt.includes(ADAPTIVE_PAYLOAD_STARTUP_INSTRUCTION));
  assert(prompt.includes('canonical results matching startup.result_schema'));
  assert(!/canonical v[56] results/u.test(prompt));
  assert(!prompt.includes('ADAPTIVE PAYLOAD EXAMPLES'), 'large payload examples are loaded once at runtime');
  assert(Buffer.byteLength(prompt) < 7000, 'the saved task stays compact');
});

test('the current schema installs the exact delivered protocol as a private immutable function', () => {
  const sql = readFileSync(new URL('../supabase/schemas/12_search_support.sql', import.meta.url), 'utf8');
  const body = /select \$adaptive_payload_protocol\$([\s\S]+?)\$adaptive_payload_protocol\$::text/u.exec(sql)?.[1];
  assert.equal(body, ADAPTIVE_BATCH_PROTOCOL_TEXT);
  assert.match(sql, /CREATE FUNCTION private\.opportunity_search_adaptive_protocol_text\(\) RETURNS text\s+LANGUAGE sql IMMUTABLE\s+SET search_path TO ''\s+AS \$_\$\s+select \$adaptive_payload_protocol\$/u);
  const security = readFileSync(new URL('../supabase/schemas/60_security.sql', import.meta.url), 'utf8');
  assert.match(security, /REVOKE ALL ON FUNCTION private\.opportunity_search_adaptive_protocol_text\(\) FROM PUBLIC;/u);
});
