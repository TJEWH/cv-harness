import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ADAPTIVE_BATCH_PROTOCOL_PREFIX, ADAPTIVE_BATCH_PROTOCOL_TEXT, ADAPTIVE_PAYLOAD_CONTRACT_TEXT, ADAPTIVE_PAYLOAD_STARTUP_INSTRUCTION, ADAPTIVE_HOSTED_PROTOCOL_TEXT,
  validateAdaptiveBatchEnvelope, validateAdaptiveCompletionEnvelope, validateAdaptiveOpportunityEnvelope, validateAdaptiveFinishEnvelope } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';
import { buildAdaptiveRecurringSearchPrompt } from '../../../src/features/meta-search/domain/adaptiveSearchTask';

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

test('the historical internal adaptive protocol preserves its reviewed prefix and includes complete first/later/completion JSON', () => {
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

test('historical pinned examples retain canonical opportunity, attribution, listing and check shapes', () => {
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

test('historical pins preserve their closed execution, evidence, allocation and terminal-read instructions', () => {
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

test('saved task instructions load complete payload and canonical schemas at startup', () => {
  const prompt = buildAdaptiveRecurringSearchPrompt(id, 'abcdefghijklmnopqrst');
  assert(prompt.includes(ADAPTIVE_PAYLOAD_STARTUP_INSTRUCTION));
  assert.doesNotMatch(prompt, /canonical v\d+ results/u, 'the startup schema supplies the canonical result version');
  assert(!prompt.includes(ADAPTIVE_PAYLOAD_CONTRACT_TEXT), 'the complete payload contract is loaded at runtime');
  assert(!prompt.includes('ADAPTIVE PAYLOAD EXAMPLES'), 'large payload examples are loaded once at runtime');
});

test('the current schema retains the historical internal protocol for pinned contexts', () => {
  const sql = readFileSync(new URL('../../../supabase/schemas/12_search_support.sql', import.meta.url), 'utf8');
  const body = /select \$adaptive_payload_protocol\$([\s\S]+?)\$adaptive_payload_protocol\$::text/u.exec(sql)?.[1];
  assert.equal(body, ADAPTIVE_BATCH_PROTOCOL_TEXT);
  assert.match(sql, /CREATE FUNCTION private\.opportunity_search_adaptive_protocol_text\(\) RETURNS text\s+LANGUAGE sql IMMUTABLE\s+SET search_path TO ''\s+AS \$_\$\s+select \$adaptive_payload_protocol\$/u);
  const security = readFileSync(new URL('../../../supabase/schemas/60_security.sql', import.meta.url), 'utf8');
  assert.match(security, /REVOKE ALL ON FUNCTION private\.opportunity_search_adaptive_protocol_text\(\) FROM PUBLIC;/u);
});


test('current published examples are a canonical item and a flat finish, with no obsolete save format', () => {
  const values = /opportunity_json:\n([^\n]+)\nfinish_json:\n([^\n]+)/u.exec(ADAPTIVE_HOSTED_PROTOCOL_TEXT);
  assert.ok(values, 'the current contract has complete parseable JSON examples');
  const opportunity = filled(JSON.parse(values[1]!)), finish = filled(JSON.parse(values[2]!));
  validateAdaptiveOpportunityEnvelope(opportunity);
  validateAdaptiveFinishEnvelope(finish);
  assert.deepEqual(Object.keys(opportunity).sort(), ['last_checked_at', 'official_url', 'opportunity_key', 'sources', 'title']);
  assert.deepEqual(Object.keys(finish).sort(), ['completion_id', 'execution', 'query_plan', 'status']);
  assert.ok(finish.query_plan, 'the complete example supplies its actual query plan');
  assert.ok(finish.execution, 'the complete example supplies actual execution checks');
  assert.equal(finish.query_plan.schema_version, 2);
  assert.deepEqual(Object.keys(finish.execution).sort(), ['backlog', 'checks', 'complete']);
  for (const forbidden of ['submit_adaptive_search_batch', 'verify_and_complete_adaptive_search', 'batch_ids',
    'FIRST BATCH', 'opportunities:[]', 'Override only', 'reusable_source', 'attribution']) {
    assert.ok(!ADAPTIVE_HOSTED_PROTOCOL_TEXT.includes(forbidden), forbidden);
  }
});

test('current published protocol preserves adaptive research obligations and independent save proofs', () => {
  for (const required of ['Preserve every core/manual entry', 'byte for byte', 'startup.legacy_core_queries', 'cold start',
    'startup.planning.blocked_core_queries', 'source targets outside startup.source_context',
    'max(policy.minimum_exploration_queries,ceil(noncore_count*policy.exploration_ratio))', 'all generated queries',
    'startup.planning.refresh_required is false', 'startup.refresh.adaptive_slice is false',
    'Record every due source separately', 'complete, blocked, failed, partial, paginated or dynamic',
    'access_denied, network_error, pagination_limit, dynamic_content, budget_exhausted or unknown',
    'needs_verification, unreachable, identity_ambiguous, deadline_uncertain, budget_exhausted, pagination_limit, dynamic_content or unsafe_reference',
    'Suggestions remain inert', 'Never fetch reviews or applications', 'requirements and availability allow only negative',
    'separate SELECT private.verify_adaptive_search_item', 'verified:true', 'changed_since_save', 'rolled_back',
    'exact run/item IDs', 'opportunity_id must match the accepted receipt when available',
    'if the save response is unavailable, retain the persisted opportunity_id returned by verification',
    'accepted_roots', 'no rejected or conflicting leaves', 'Never treat the whole submitted object as accepted',
    'invalid_opportunity with stored:false and correction_allowed:true', 'one evidence-based correction',
    'Missing execution cannot establish complete research', 'cannot undo earlier committed saves',
    'Without execution, send only completion_id and status',
    'identical completion UUID and complete JSON']) {
    assert.ok(ADAPTIVE_HOSTED_PROTOCOL_TEXT.toLowerCase().includes(required.toLowerCase()), required);
  }
});

test('current receipt guidance distinguishes saved evidence from valid unresolved items and deferred verification', () => {
  for (const required of ['then distinguish these two valid outcomes',
    'outcome:saved requires a non-null opportunity_id UUID and verification_required:true',
    'outcome:unresolved is a valid recorded deferral', 'opportunity_id, canonical_outcome and discovery_id are null',
    'accepted_roots is {}, verification_required:false', 'insufficient_evidence, identity_conflict or correction_deferred',
    'no opportunity was saved', 'Do not classify this receipt as invalid, verify it or resubmit it',
    'item_id as candidate_id', 'reason:identity_ambiguous for identity_conflict, otherwise needs_verification',
    'Continue saving other candidates', 'execution.complete:false and finish with status:failed',
    'status:deferred, verified:false and opportunity_id:null confirms a recorded unsaved item',
    'continue other candidates without verifying or resubmitting it again',
    'Any other missing, unverified or unavailable result stays uncertain']) {
    assert.ok(ADAPTIVE_HOSTED_PROTOCOL_TEXT.includes(required), required);
  }
});

test('database publishes exactly the current outward protocol independently of historical pins', () => {
  const sql = readFileSync(new URL('../../../supabase/schemas/12_search_support.sql', import.meta.url), 'utf8');
  const text = /select \$adaptive_hosted\$([\s\S]+?)\$adaptive_hosted\$/u.exec(sql)?.[1];
  assert.equal(text, ADAPTIVE_HOSTED_PROTOCOL_TEXT);
  assert.notEqual(ADAPTIVE_HOSTED_PROTOCOL_TEXT, ADAPTIVE_BATCH_PROTOCOL_TEXT);
  assert.match(sql, /jsonb_set\(brief,'\{protocol_text\}',to_jsonb\(private\.adaptive_search_hosted_protocol_text\(\)/u);
});
