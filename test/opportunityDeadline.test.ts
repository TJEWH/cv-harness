import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOpportunityDeadline, isOpportunityDeadlinePassed, opportunityDeadlineSortKey } from '../src/features/opportunities/domain/opportunityDeadline';

test('date-only deadlines include the entire stated date in the deadline timezone', () => {
  const now = new Date('2026-09-20T14:00:00Z');
  assert.equal(isOpportunityDeadlinePassed({ deadline: '2026-09-21', deadline_timezone: 'Europe/Berlin' }, now), false);
  assert.equal(isOpportunityDeadlinePassed({ deadline: '2026-09-20', deadline_timezone: 'Europe/Berlin' }, now), false);
  assert.equal(isOpportunityDeadlinePassed({ deadline: '2026-09-19', deadline_timezone: 'Europe/Berlin' }, now), true);
  const closing = { deadline: '2026-09-20', deadline_timezone: 'Europe/Berlin' };
  assert.equal(isOpportunityDeadlinePassed(closing, new Date('2026-09-20T21:59:59.999Z')), false);
  assert.equal(isOpportunityDeadlinePassed(closing, new Date('2026-09-20T22:00:00.000Z')), true);
  assert.equal(isOpportunityDeadlinePassed({ deadline: '2026-09-20', deadline_timezone: 'America/New_York' }, new Date('2026-09-21T02:00:00Z')), false);
});

test('an explicit local deadline time closes in the specified IANA timezone', () => {
  const deadline = { deadline: '2026-09-20', deadline_time_local: '17:30:00', deadline_timezone: 'Europe/Berlin' };
  assert.equal(isOpportunityDeadlinePassed(deadline, new Date('2026-09-20T15:29:59Z')), false);
  assert.equal(isOpportunityDeadlinePassed(deadline, new Date('2026-09-20T15:30:00Z')), false);
  assert.equal(isOpportunityDeadlinePassed(deadline, new Date('2026-09-20T15:30:00.001Z')), true);
  assert.equal(opportunityDeadlineSortKey(deadline), Date.parse('2026-09-20T15:30:00Z'));
});

test('zoned timestamps use their own offset and are never expanded to a whole day', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  assert.equal(isOpportunityDeadlinePassed('2026-09-20T14:01:00+02:00', now), false);
  assert.equal(isOpportunityDeadlinePassed('2026-09-20T13:59:00+02:00', now), true);
  assert.equal(isOpportunityDeadlinePassed('2026-09-20T12:00:00Z', now), false);
  assert.equal(opportunityDeadlineSortKey({ deadline: '2026-09-20T12:00:00Z', deadline_timezone: 'America/New_York' }), now.getTime());
});

test('daylight-saving changes use real civil-day length and preserve repeated deadline hours', () => {
  assert.equal(opportunityDeadlineSortKey({ deadline: '2026-03-29', deadline_timezone: 'Europe/Berlin' }), Date.parse('2026-03-29T21:59:59.999Z'));
  assert.equal(opportunityDeadlineSortKey({ deadline: '2026-10-25', deadline_timezone: 'Europe/Berlin' }), Date.parse('2026-10-25T22:59:59.999Z'));
  const repeated = { deadline: '2026-10-25', deadline_time_local: '02:30', deadline_timezone: 'Europe/Berlin' };
  assert.equal(isOpportunityDeadlinePassed(repeated, new Date('2026-10-25T00:45:00Z')), false);
  assert.equal(opportunityDeadlineSortKey(repeated), Date.parse('2026-10-25T01:30:00Z'));
});

test('unknown, impossible and malformed deadlines never hide an opportunity', () => {
  for (const input of [null, undefined, '', 'unknown', '2026-02-30', '20/09/2026', '2026-09-20T25:00:00Z',
    { deadline: '2026-09-20', deadline_timezone: 'invalid/zone' },
    { deadline: '2026-09-20', deadline_time_local: 'not confirmed' },
    { deadline: '2026-09-20', deadline_time_local: '24:00' },
    { deadline: '2026-03-29', deadline_time_local: '02:30', deadline_timezone: 'Europe/Berlin' },
  ]) {
    assert.equal(isOpportunityDeadlinePassed(input, new Date('2030-01-01T00:00:00Z')), false, JSON.stringify(input));
    assert.equal(opportunityDeadlineSortKey(input), Infinity, JSON.stringify(input));
  }
});

test('local date-only deadlines default to browser local day, and labels do not move across UTC boundaries', () => {
  const localDate = new Date(2026, 8, 20, 23, 59, 59, 999);
  assert.equal(isOpportunityDeadlinePassed('2026-09-20', localDate), false);
  assert.equal(isOpportunityDeadlinePassed('2026-09-20', new Date(localDate.getTime() + 1)), true);
  assert.match(formatOpportunityDeadline({ deadline: '2026-09-20', deadline_timezone: 'Pacific/Auckland' }, 'en'), /20 Sept? 2026/);
  assert.match(formatOpportunityDeadline({ deadline: '2026-09-20', deadline_time_local: '17:30:00', deadline_timezone: 'Europe/Berlin' }, 'en'), /17:30.*Europe\/Berlin/);
  assert.equal(formatOpportunityDeadline(null, 'de'), 'Keine bestätigte Frist');
});
