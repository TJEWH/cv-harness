import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpportunityReview } from '../src/app/cloudTypes';
import { currentOpportunityRecords } from '../src/features/opportunities/domain/opportunityInsightsCurrent';
import { opportunityFixture } from './fixtures/opportunity';

const owner = 'current-owner', other = 'other-owner', now = new Date('2026-10-31T12:00:00Z');
function review(id: string, revision: number, archived: boolean, userId = owner): OpportunityReview {
  return { user_id: userId, opportunity_id: id, feedback_revision: revision, manually_archived: archived,
    state: 'unreviewed', reviewed_updated_at: null, created_at: '', updated_at: '' };
}

test('current opportunities use Results deadline and owner-specific latest archive rules without mutation', () => {
  const rows = [
    opportunityFixture({ id: 'future', deadline: '2026-11-01T12:00:00Z' }),
    opportunityFixture({ id: 'exact', deadline: now.toISOString() }),
    opportunityFixture({ id: 'past', deadline: '2026-10-31T11:59:59Z' }),
    opportunityFixture({ id: 'unknown', deadline: null }),
    opportunityFixture({ id: 'invalid', deadline: 'not a date' }),
    opportunityFixture({ id: 'archived', deadline: '2026-11-01T12:00:00Z' }),
    opportunityFixture({ id: 'other-owner', deadline: null }),
    opportunityFixture({ id: 'restored', deadline: null }),
    opportunityFixture({ id: 'latest-archived', deadline: null }),
    opportunityFixture({ id: 'future', deadline: '2000-01-01' }),
  ];
  const reviews = [review('archived', 1, true), review('other-owner', 5, true, other),
    review('restored', 2, false), review('restored', 1, true),
    review('latest-archived', 2, true), review('latest-archived', 1, false)];
  const before = structuredClone({ rows, reviews });
  const result = currentOpportunityRecords(rows, reviews, owner, now);
  assert.deepEqual(result.map(row => row.id), ['future', 'exact', 'unknown', 'invalid', 'other-owner', 'restored']);
  assert.equal(result[0], rows[0], 'classification preserves the original complete record');
  assert.deepEqual({ rows, reviews }, before);
  assert(!currentOpportunityRecords(rows, reviews, owner, new Date(now.getTime() + 1)).some(row => row.id === 'exact'),
    'the exact timestamp becomes past only after its deadline');
});

test('date-only current opportunities include their entire local deadline day', () => {
  const row = opportunityFixture({ id: 'local-day', deadline: '2026-10-31', deadline_timezone: 'Europe/Tirane' });
  assert.equal(currentOpportunityRecords([row], [], owner, new Date('2026-10-31T22:59:59.999Z')).length, 1);
  assert.equal(currentOpportunityRecords([row], [], owner, new Date('2026-10-31T23:00:00Z')).length, 0);
});

test('equal-revision owner dispositions use the same last-record tie policy as Insights', () => {
  const row = opportunityFixture({ id: 'tie' });
  assert.equal(currentOpportunityRecords([row], [review('tie', 2, true), review('tie', 2, false)], owner, now).length, 1);
  assert.equal(currentOpportunityRecords([row], [review('tie', 2, false), review('tie', 2, true)], owner, now).length, 0);
});
