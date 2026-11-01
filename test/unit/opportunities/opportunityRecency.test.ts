import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityRecency } from '../../../src/features/opportunities/domain/opportunityRecency';

const now = new Date('2026-09-20T12:00:00Z');
const old = '2026-09-18T12:00:00Z';

test('new opportunities take priority over recent updates', () => {
  assert.equal(opportunityRecency({ created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T11:00:00Z' }, now), 'new');
  assert.equal(opportunityRecency({ created_at: now.toISOString(), updated_at: now.toISOString() }, now), 'new');
});

test('older opportunities highlight recent updates, using timezone offsets', () => {
  assert.equal(opportunityRecency({ created_at: old, updated_at: '2026-09-20T13:30:00+02:00' }, now), 'updated');
  assert.equal(opportunityRecency({ created_at: null, updated_at: '2026-09-20T11:30:00Z' }, now), 'updated');
});

test('highlights expire at 24 elapsed hours, including across daylight-saving changes', () => {
  for (const field of ['created_at', 'updated_at'] as const) {
    const opportunity = { created_at: old, updated_at: old, [field]: '2026-09-19T12:00:00.001Z' };
    assert.equal(opportunityRecency(opportunity, now), field === 'created_at' ? 'new' : 'updated');
    assert.equal(opportunityRecency(opportunity, new Date(now.getTime() + 1)), null);
  }
  const opportunity = { created_at: '2026-10-24T14:00:00+02:00', updated_at: null };
  assert.equal(opportunityRecency(opportunity, new Date('2026-10-25T12:59:59+01:00')), 'new');
  assert.equal(opportunityRecency(opportunity, new Date('2026-10-25T13:00:00+01:00')), null);
});

test('missing, invalid, old and future timestamps are not highlighted', () => {
  for (const timestamp of [null, '', 'not a date', old, '2026-09-20T12:00:00.001Z']) {
    assert.equal(opportunityRecency({ created_at: timestamp, updated_at: timestamp }, now), null);
  }
  assert.equal(opportunityRecency({ created_at: now.toISOString(), updated_at: now.toISOString() }, new Date(NaN)), null);
});

test('reviewed versions stay clear and later changes highlight again', () => {
  const version = '2026-09-20T10:00:00Z';
  for (const created of [old, version]) {
    const opportunity = { created_at: created, updated_at: version };
    assert.equal(opportunityRecency(opportunity, now, version), null);
    assert.equal(opportunityRecency(opportunity, now, '2026-09-20T12:00:00+02:00'), null);
    assert.equal(opportunityRecency({ ...opportunity, updated_at: '2026-09-20T11:00:00Z' }, now, version), 'updated');
    assert.notEqual(opportunityRecency(opportunity, now, 'invalid'), null);
  }
  assert.equal(opportunityRecency({ created_at: version, updated_at: null }, now, version), null);
});
