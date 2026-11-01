import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAdaptiveSearchDashboard } from '../../../src/features/meta-search/composables/adaptiveSearchDashboard';

// Generated only by the isolated current-database dashboard test, never production.
const fixture = () => JSON.parse(readFileSync(new URL('../../browser/fixtures/adaptive-dashboard.fixture.json', import.meta.url), 'utf8'));

test('the browser dashboard fixture decodes through the real current UI boundary without changing the outgoing packet', async () => {
  const raw = fixture();
  const before = structuredClone(raw);
  const result = await readAdaptiveSearchDashboard(raw, {
    ownerId: raw.user_id, searchId: raw.search_id, projectRef: raw.project_ref,
  });
  assert.equal(result.feedback_preview.metric_version, 'opportunity-interest-v2');
  assert.equal(result.feedback_preview.selection_policy_version, 'opportunity-feedback-selection-v2');
  assert.equal(result.policy.policy_version, 'adaptive-query-v3');
  assert.equal(result.settings.search_breadth_percent, 20);
  assert.equal(result.settings.breadth_revision, 0);
  assert.equal(result.settings.adaptation_revision, 3);
  assert.equal(result.settings.source_reuse_revision, 1);
  assert.equal(result.settings.preference_revision, 2);
  assert.equal(result.settings.query_plan_revision, 1);
  assert.deepEqual(result.planning_capacity, { core_queries: 1, discretionary: 29 });
  assert.equal(result.feedback_preview.counts.application, 1);
  assert.deepEqual(result.feedback_preview, raw.feedback_preview, 'The preview is the exact validated runner packet');
  assert.deepEqual(raw, before, 'Decoding must not mutate the shared browser fixture');
  assert(!JSON.stringify(result).includes('PRIVATE_CANARY'));
});

test('the browser dashboard fixture cannot decode under another account, search or project', async () => {
  const raw = fixture();
  const scope = { ownerId: raw.user_id, searchId: raw.search_id, projectRef: raw.project_ref };
  for (const other of [
    { ...scope, ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { ...scope, searchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { ...scope, projectRef: 'different-project' },
  ]) await assert.rejects(readAdaptiveSearchDashboard(raw, other));
});

test('the browser dashboard boundary rejects an extra private field in the outgoing packet', async () => {
  const raw = fixture();
  raw.feedback_preview.private_notes = 'PRIVATE_CANARY';
  await assert.rejects(readAdaptiveSearchDashboard(raw, raw.user_id, raw.search_id, raw.project_ref));
});
