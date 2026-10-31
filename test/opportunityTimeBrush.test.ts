import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpportunityTimeBrush, opportunityCalendarDate, opportunityCalendarDay } from '../src/features/opportunities/domain/opportunityTimeBrush';

test('drawing a reversed range includes both boundary days and keeps a single day selectable', () => {
  const brush = createOpportunityTimeBrush({ min: 1, max: 31 });
  assert(brush.begin(7, 'create', 20));
  assert.deepEqual(brush.move(7, 8), { start: 8, end: 20 });
  assert.deepEqual(brush.end(7), { start: 8, end: 20 });
  assert(brush.begin(8, 'create', 12));
  assert.deepEqual(brush.end(8), { start: 12, end: 12 });
});

test('either endpoint resizes independently and cannot cross the other endpoint or domain', () => {
  const brush = createOpportunityTimeBrush({ min: 1, max: 31 }, { start: 10, end: 20 });
  brush.begin(1, 'start', 10);
  assert.deepEqual(brush.move(1, -20), { start: 1, end: 20 });
  assert.deepEqual(brush.move(1, 30), { start: 20, end: 20 });
  brush.end(1);
  brush.begin(2, 'end', 20);
  assert.deepEqual(brush.move(2, 50), { start: 20, end: 31 });
  assert.deepEqual(brush.move(2, 3), { start: 20, end: 20 });
});

test('moving a selected interval preserves inclusive length at both domain boundaries', () => {
  const brush = createOpportunityTimeBrush({ min: 1, max: 31 }, { start: 10, end: 20 });
  brush.begin(1, 'move', 15);
  assert.deepEqual(brush.move(1, 40), { start: 21, end: 31 });
  assert.deepEqual(brush.move(1, -40), { start: 1, end: 11 });
  assert.deepEqual(brush.end(1), { start: 1, end: 11 });
  assert.equal(brush.selection!.end - brush.selection!.start + 1, 11);
});

test('a second pointer cannot hijack a gesture or finish or cancel its owner', () => {
  const brush = createOpportunityTimeBrush({ min: 1, max: 31 }, { start: 10, end: 20 });
  assert(brush.begin(11, 'start', 10));
  assert.equal(brush.begin(12, 'create', 5), false);
  assert.deepEqual(brush.move(12, 3), { start: 10, end: 20 });
  brush.end(12); brush.cancel(12);
  assert.equal(brush.pointerId, 11);
  assert.deepEqual(brush.move(11, 7), { start: 7, end: 20 });
  brush.end(11);
  assert.equal(brush.pointerId, null);
});

test('cancelled gestures restore both explicit dates and the distinct All history selection', () => {
  for (const initial of [null, { start: 10, end: 20 }]) {
    const brush = createOpportunityTimeBrush({ min: 1, max: 31 }, initial);
    brush.begin(1, 'create', 4); brush.move(1, 6);
    assert.deepEqual(brush.cancel(1), initial);
    assert.equal(brush.pointerId, null);
    assert(brush.begin(2, 'create', 9), 'the next gesture works after cancellation');
    assert.deepEqual(brush.end(2), { start: 9, end: 9 });
  }
});

test('pointer release outside commits the last clamped preview and accepts the next interaction', () => {
  const brush = createOpportunityTimeBrush({ min: 1, max: 31 }, { start: 8, end: 15 });
  brush.begin(1, 'end', 15); brush.move(1, 1000);
  assert.deepEqual(brush.end(1), { start: 8, end: 31 });
  assert(brush.begin(2, 'start', 8));
  assert.deepEqual(brush.move(2, 4), { start: 4, end: 31 });
});

test('keyboard range handles and interval translation use one-day and seven-day steps', () => {
  const brush = createOpportunityTimeBrush({ min: 1, max: 31 }, { start: 10, end: 20 });
  assert.deepEqual(brush.keyboard('start', 'ArrowRight'), { start: 11, end: 20 });
  assert.deepEqual(brush.keyboard('end', 'ArrowLeft', true), { start: 11, end: 13 });
  assert.deepEqual(brush.keyboard('selection', 'ArrowRight', true), { start: 18, end: 20 });
  assert.deepEqual(brush.keyboard('selection', 'End'), { start: 29, end: 31 });
  assert.deepEqual(brush.keyboard('selection', 'Home'), { start: 1, end: 3 });
  assert.deepEqual(brush.keyboard('start', 'End'), { start: 3, end: 3 });
  assert.deepEqual(brush.keyboard('end', 'End'), { start: 3, end: 31 });
});

test('calendar steps remain consecutive through DST and are not based on 24 elapsed local hours', () => {
  const days = ['2026-03-07T12:00:00', '2026-03-08T12:00:00', '2026-03-09T12:00:00', '2026-10-24T12:00:00', '2026-10-25T12:00:00', '2026-10-26T12:00:00'];
  for (const [first, second] of [[0, 1], [1, 2], [3, 4], [4, 5]]) {
    assert.equal(opportunityCalendarDay(days[second!]!)! - opportunityCalendarDay(days[first!]!)!, 1);
  }
  assert.equal(opportunityCalendarDate(opportunityCalendarDay('2026-10-25T12:00:00')!), '2026-10-25');
  assert.equal(opportunityCalendarDay('invalid'), null);
});

test('empty, malformed and reversed domains cannot create an invalid brush', () => {
  assert.throws(() => createOpportunityTimeBrush({ min: 3, max: 2 }), RangeError);
  assert.throws(() => createOpportunityTimeBrush({ min: NaN, max: 2 }), RangeError);
  const brush = createOpportunityTimeBrush({ min: 5, max: 5 });
  brush.begin(1, 'create', 5);
  assert.deepEqual(brush.move(1, 0), { start: 5, end: 5 });
  assert.deepEqual(brush.end(1), { start: 5, end: 5 });
});
