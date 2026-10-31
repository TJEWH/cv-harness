import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpportunityNetworkSelection } from '../src/features/opportunities/domain/opportunityNetworkSelection';

const point = (x: number, y = 0, pointerId = 1, button = 0) => ({ clientX: x, clientY: y, pointerId, button });

test('a stable primary press selects while camera drags cross the movement threshold', () => {
  const gesture = createOpportunityNetworkSelection();
  gesture.begin(point(10)); gesture.move(point(14));
  assert.equal(gesture.end(point(14)), true);
  gesture.begin(point(10)); gesture.move(point(16));
  assert.equal(gesture.end(point(16)), false);
});

test('an out-and-back camera pan cannot become a node click at release', () => {
  const gesture = createOpportunityNetworkSelection();
  gesture.begin(point(20, 30)); gesture.move(point(100, 70)); gesture.move(point(21, 30));
  assert.equal(gesture.end(point(20, 30)), false);
});

test('middle and secondary mouse buttons never initiate node selection', () => {
  const gesture = createOpportunityNetworkSelection();
  for (const button of [1, 2]) {
    gesture.begin(point(20, 30, 1, button));
    assert.equal(gesture.end(point(20, 30, 1, button)), false);
    assert.equal(gesture.end(point(20, 30)), false);
  }
});

test('pointer ownership is retained and multi-pointer camera gestures do not select topics', () => {
  const gesture = createOpportunityNetworkSelection();
  gesture.begin(point(20)); gesture.move(point(80, 0, 2));
  assert.equal(gesture.end(point(80, 0, 2)), false);
  assert.equal(gesture.end(point(20)), true, 'an unrelated move/release cannot hijack the owning pointer');
  gesture.begin(point(20)); gesture.begin(point(80, 0, 2));
  assert.equal(gesture.end(point(80, 0, 2)), false);
  assert.equal(gesture.end(point(20)), false, 'a second pointer makes this a camera gesture');
});

test('cancellation and renderer replacement discard a pending click without breaking the next click', () => {
  const gesture = createOpportunityNetworkSelection();
  gesture.begin(point(20)); gesture.cancel();
  assert.equal(gesture.end(point(20)), false);
  gesture.begin(point(40));
  assert.equal(gesture.end(point(40)), true);
});
