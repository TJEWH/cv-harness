import assert from 'node:assert/strict';
import test from 'node:test';
import storageSchema from '../supabase/opportunity_schema_v6.json';
import { createOpportunityResultSchema } from '../src/features/opportunities/domain/opportunityResultSchema';

test('canonical v6 intake requires fresh source evidence but lets the server generate stable entity identities', () => {
  const input = createOpportunityResultSchema();
  assert.equal(input['x-canonical-version'], 6);
  assert.equal(input.properties.last_checked_at!.type, 'string');
  assert.equal(input.properties.sources!.minItems, 1);
  assert.deepEqual(input.$defs.person!.required, []);
  assert.deepEqual(input.$defs.checklist!.required, ['text', 'status', 'stage']);
  assert.deepEqual(input.$defs.paper!.required, []);
  assert.deepEqual(input.$defs.focus_profile!.required, ['name']);
  assert.deepEqual(input.$defs.money_component!.required, ['label']);
  assert.deepEqual(input.$defs.source!.required, ['url', 'kind', 'checked_at', 'precision', 'supports']);
  assert.deepEqual(input.required, ['opportunity_key', 'title', 'last_checked_at', 'sources']);
  assert.equal(input.additionalProperties, false);
  for (const key of ['particularly_suitable', 'particularly_suitable_reason', 'special_features']) {
    assert.equal(Object.hasOwn(input.properties, key), false);
  }
  assert.match(input.properties.research_summary!.description as string, /Unique selling points/);
});

test('canonical v6 intake exposes only the closed, bounded expected-value correction contract', () => {
  const control = createOpportunityResultSchema().properties.merge_control!;
  assert.deepEqual(control, { type: 'object', additionalProperties: false, properties: {
    corrections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'expected', 'reason'],
      properties: { path: { type: 'string', pattern: '^/', minLength: 2 }, expected: true,
        reason: { type: 'string', minLength: 1, maxLength: 4000 } } } },
  } });
});

test('intake schema derivation never mutates storage requirements or aliases a previous preview', () => {
  const before = JSON.stringify(storageSchema), first = createOpportunityResultSchema(), second = createOpportunityResultSchema();
  first.properties.last_checked_at!.type = 'object';
  (first.$defs.person!.required as string[]).push('private_field');
  assert.equal(second.properties.last_checked_at!.type, 'string');
  assert.deepEqual(second.$defs.person!.required, []);
  assert.equal(JSON.stringify(storageSchema), before);
  assert.deepEqual(storageSchema.$defs.person.required, ['entity_id', 'roles']);
  assert.deepEqual(storageSchema.properties.last_checked_at.type, ['string', 'null']);
});
