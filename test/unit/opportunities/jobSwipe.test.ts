import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobSwipe } from '../../../src/features/opportunities/interaction/jobSwipe';

type Point = { identifier: number; clientX: number; clientY: number };
const point = (x: number, y = 100, identifier = 1): Point => ({ clientX: x, clientY: y, identifier });

function element({ tag = 'div', parent = null, scrollWidth = 300, clientWidth = 300, overflowX = 'visible', ignore = false }: {
  tag?: string; parent?: Element | null; scrollWidth?: number; clientWidth?: number; overflowX?: string; ignore?: boolean;
} = {}): Element {
  return {
    nodeType: 1, parentElement: parent, scrollWidth, clientWidth,
    matches: () => ignore || ['a', 'button', 'input', 'textarea', 'select', 'summary'].includes(tag),
    ownerDocument: { defaultView: { innerWidth: 400, getComputedStyle: () => ({ overflowX }) } },
  } as unknown as Element;
}

function harness() {
  let enabled = true;
  const changes: number[] = [];
  const handlers = createJobSwipe({ enabled: () => enabled, onSwipe: direction => changes.push(direction) });
  const root = element();
  function touch(type: 'start' | 'move' | 'end', points: Point[], {
    target = root, time = type === 'start' ? 100 : type === 'move' ? 200 : 300,
    remaining = [], cancelable = true, defaultPrevented = false,
  }: { target?: Element; time?: number; remaining?: Point[]; cancelable?: boolean; defaultPrevented?: boolean } = {}) {
    const event = {
      touches: type === 'end' ? remaining : points, changedTouches: points,
      target, currentTarget: root, timeStamp: time, cancelable, defaultPrevented,
      preventDefault() { this.defaultPrevented = true; },
    };
    const handler = type === 'start' ? handlers.onTouchStart : type === 'move' ? handlers.onTouchMove : handlers.onTouchEnd;
    handler(event as unknown as TouchEvent);
    return event;
  }
  function swipe(from = point(250), to = point(100), target = root) {
    const start = touch('start', [from], { target });
    const move = touch('move', [to], { target });
    const end = touch('end', [to], { target });
    return { start, move, end };
  }
  function click(time = 350, detail = 1) {
    const event = { timeStamp: time, detail, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    handlers.onClickCapture(event as unknown as MouseEvent);
    return event;
  }
  return { handlers, root, changes, touch, swipe, click, disable: () => { enabled = false; } };
}

test('horizontal swipes request one adjacent item and start/end remain passive', () => {
  const h = harness();
  const events = h.swipe();
  assert.deepEqual(h.changes, [1]);
  assert.equal(events.start.defaultPrevented, false);
  assert.equal(events.move.defaultPrevented, true);
  assert.equal(events.end.defaultPrevented, false);
  h.handlers.onTouchEnd(events.end as unknown as TouchEvent);
  h.swipe(point(100), point(250));
  assert.deepEqual(h.changes, [1, -1], 'left is next and right is previous, once per gesture');
});

test('taps, short drags, and vertical scrolling never navigate', () => {
  const h = harness();
  assert.equal(h.swipe(point(100), point(103)).move.defaultPrevented, false);
  h.swipe(point(100), point(140));
  assert.equal(h.swipe(point(100), point(130, 280)).move.defaultPrevented, false);
  h.touch('start', [point(100)]);
  assert.equal(h.touch('move', [point(110, 130)]).defaultPrevented, false);
  assert.equal(h.touch('move', [point(280, 140)]).defaultPrevented, false);
  h.touch('end', [point(280, 140)]);
  assert.deepEqual(h.changes, [], 'a vertical start stays scrolling after a horizontal turn');
});

test('multi-touch, touch cancellation, and finger replacement abandon the whole gesture', () => {
  const h = harness();
  h.touch('start', [point(250), point(200, 100, 2)]);
  h.touch('end', [point(100)]);
  h.touch('start', [point(250)]);
  h.touch('move', [point(150), point(100, 100, 2)]);
  h.touch('move', [point(80)]);
  h.touch('end', [point(80)]);
  h.touch('start', [point(250)]);
  h.touch('start', [point(250), point(200, 100, 2)]);
  h.touch('end', [point(100)]);
  h.touch('start', [point(250)]);
  h.handlers.cancel();
  h.touch('end', [point(100)]);
  h.swipe(point(250), point(100, 100, 2));
  h.touch('start', [point(250)]);
  h.touch('end', [point(100)], { remaining: [point(200, 100, 2)] });
  assert.deepEqual(h.changes, []);
});

test('slow drags and browser-owned gestures do not navigate', () => {
  const h = harness();
  h.touch('start', [point(250)]);
  assert.equal(h.touch('move', [point(100)], { time: 1100 }).defaultPrevented, false);
  h.touch('end', [point(100)], { time: 1200 });
  h.touch('start', [point(250)]);
  h.touch('move', [point(100)]);
  h.touch('end', [point(100)], { time: 1200 });
  h.touch('start', [point(250)]);
  assert.equal(h.touch('move', [point(100)], { cancelable: false }).defaultPrevented, false);
  h.touch('end', [point(100)]);
  h.touch('start', [point(250)], { defaultPrevented: true });
  h.touch('end', [point(100)]);
  assert.deepEqual(h.changes, []);
});

test('disabled navigation leaves gestures alone, including when disabled during a swipe', () => {
  const h = harness();
  h.touch('start', [point(250)]);
  h.disable();
  h.touch('end', [point(100)]);
  assert.equal(h.swipe().move.defaultPrevented, false);
  assert.deepEqual(h.changes, []);
});

test('both screen edges are reserved for native navigation', () => {
  const h = harness();
  for (const x of [0, 24, 376, 399]) {
    assert.equal(h.swipe(point(x), point(200)).move.defaultPrevented, false);
  }
  assert.deepEqual(h.changes, []);
  h.swipe(point(25), point(125));
  h.swipe(point(375), point(275));
  assert.deepEqual(h.changes, [-1, 1]);
});

test('controls and their descendants, explicit exclusions, and horizontal scrollers own their touches', () => {
  const h = harness();
  for (const tag of ['a', 'button', 'input', 'textarea', 'select', 'summary']) {
    const control = element({ tag, parent: h.root });
    assert.equal(h.swipe(point(250), point(100), element({ parent: control })).move.defaultPrevented, false);
  }
  const excluded = element({ ignore: true, parent: h.root });
  h.swipe(point(250), point(100), element({ parent: excluded }));
  for (const overflowX of ['auto', 'scroll']) {
    const scroller = element({ parent: h.root, scrollWidth: 600, overflowX });
    assert.equal(h.swipe(point(250), point(100), element({ parent: scroller })).move.defaultPrevented, false);
  }
  assert.deepEqual(h.changes, []);
  h.swipe(point(250), point(100), element({ parent: h.root, overflowX: 'auto' }));
  assert.deepEqual(h.changes, [1], 'a fitting element does not consume horizontal gestures');
});

test('swipes suppress their compatibility click without swallowing keyboard activation or the next tap', () => {
  const h = harness();
  h.swipe();
  assert.equal(h.click(350, 0).prevented, false, 'keyboard activation remains available');
  const click = h.click();
  assert.equal(click.prevented, true);
  assert.equal(click.stopped, true);
  assert.equal(h.click().prevented, false, 'only one compatibility click is suppressed');
  h.swipe();
  assert.equal(h.click(1000).prevented, false, 'the guard expires');
  h.swipe();
  h.swipe(point(100), point(102));
  assert.equal(h.click().prevented, false, 'a fresh tap clears the swipe click guard');
});
