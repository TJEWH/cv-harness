import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { observeJobCardScroll } from '../../../src/features/opportunities/interaction/jobCardScroll';

function fixture(t: TestContext, initialLeft = 0, supportsScrollEnd = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const corrections: ScrollToOptions[] = [];
  const settled: number[] = [];
  const inset = 17;
  const step = 308;
  class Track extends EventTarget {
    scrollLeft = initialLeft;
    scrollTop = 0;
    clientLeft = 2;
    clientWidth = 320;
    scrollWidth = step * 3 + this.clientWidth;
    isConnected = true;
    getBoundingClientRect() { return { left: 20 }; }
    getClientRects() { return [this.getBoundingClientRect()]; }
    querySelectorAll() {
      return [0, 1, 2, 3].map(index => ({
        getBoundingClientRect: () => ({ left: 20 + this.clientLeft + inset + index * step - this.scrollLeft }),
      }));
    }
    scrollTo(options: ScrollToOptions) {
      corrections.push(options);
      if (options.left !== undefined) this.scrollLeft = options.left;
      if (options.top !== undefined) this.scrollTop = options.top;
    }
  }
  const track = new Track();
  if (supportsScrollEnd) Object.defineProperty(track, 'onscrollend', { value: null });
  const globals = {
    getComputedStyle: () => ({ scrollPaddingLeft: `${inset}px` }),
  };
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  const observer = observeJobCardScroll(track as unknown as HTMLElement, () => settled.push(track.scrollLeft));
  t.after(() => {
    observer.dispose();
    previous.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key));
  });
  function dispatch(type: string, touches = 0, target?: EventTarget) {
    const event = new Event(type);
    Object.defineProperty(event, 'touches', { value: Array.from({ length: touches }, (_, identifier) => ({ identifier })) });
    if (target) Object.defineProperty(event, 'target', { value: target });
    track.dispatchEvent(event);
  }
  function scroll(left: number) {
    track.scrollLeft = left;
    dispatch('scroll');
  }
  return { track, observer, corrections, settled, dispatch, scroll, step };
}

test('card sizing waits through the drag and momentum before correcting the final snap', t => {
  const f = fixture(t);
  f.dispatch('touchstart', 1);
  f.scroll(190);
  t.mock.timers.tick(80);
  f.scroll(350);
  assert.equal(f.observer.isMoving(), true);
  assert.deepEqual(f.settled, [], 'crossing a card midpoint must not trigger a height change');
  f.dispatch('touchend');
  t.mock.timers.tick(100);
  f.scroll(390);
  t.mock.timers.tick(100);
  f.scroll(340);
  assert.deepEqual(f.settled, [], 'touchend must not resize the scrollport while momentum continues');
  f.dispatch('scrollend', 0, new EventTarget());
  assert.deepEqual(f.settled, [], 'a nested textarea finishing its own scroll must not finish the card swipe');
  f.dispatch('scrollend');
  assert.equal(f.track.scrollLeft, f.step);
  assert.deepEqual(f.settled, [f.step], 'resize only after aligning the final card');
  assert.equal(f.observer.isMoving(), false);
  t.mock.timers.tick(1000);
  f.dispatch('scroll');
  f.dispatch('scrollend');
  assert.deepEqual(f.settled, [f.step], 'the correction and old fallback timer must not cause duplicate completion');
});

test('holding a finger prevents an idle timeout or scrollend from finishing the swipe', t => {
  const f = fixture(t);
  f.dispatch('touchstart', 1);
  f.scroll(420);
  t.mock.timers.tick(2000);
  f.dispatch('scrollend');
  assert.equal(f.observer.isMoving(), true);
  assert.deepEqual(f.corrections, []);
  assert.deepEqual(f.settled, []);
  f.dispatch('touchend');
  t.mock.timers.tick(180);
  assert.equal(f.track.scrollLeft, f.step);
  assert.deepEqual(f.settled, [f.step]);
});

test('the fallback waits for the last momentum scroll on browsers without scrollend', t => {
  const f = fixture(t);
  f.dispatch('touchstart', 1);
  f.scroll(350);
  f.dispatch('touchend');
  t.mock.timers.tick(100);
  f.scroll(550);
  t.mock.timers.tick(100);
  f.scroll(660);
  t.mock.timers.tick(179);
  assert.deepEqual(f.settled, []);
  assert.equal(f.observer.isMoving(), true);
  t.mock.timers.tick(1);
  assert.equal(f.track.scrollLeft, f.step * 2);
  assert.deepEqual(f.settled, [f.step * 2]);
});

test('native scrollend keeps sizing frozen through long pauses during drag and momentum', t => {
  const f = fixture(t, 0, true);
  f.dispatch('touchstart', 1);
  f.scroll(420);
  t.mock.timers.tick(10_000);
  f.dispatch('scrollend');
  assert.equal(f.observer.isMoving(), true);
  assert.deepEqual(f.settled, [], 'a held touch must remain frozen even if a scrollend is received');
  f.dispatch('touchend');
  t.mock.timers.tick(10_000);
  assert.equal(f.observer.isMoving(), true);
  assert.deepEqual(f.settled, [], 'an event delivery pause must not be mistaken for completed native momentum');
  f.scroll(580);
  t.mock.timers.tick(10_000);
  assert.deepEqual(f.corrections, []);
  f.dispatch('scrollend');
  assert.equal(f.track.scrollLeft, f.step * 2);
  assert.deepEqual(f.settled, [f.step * 2]);
  assert.equal(f.observer.isMoving(), false);
});

test('native scrollend support still releases a tap and takes over from a delayed first scroll', t => {
  const f = fixture(t, 0, true);
  f.dispatch('touchstart', 1);
  f.dispatch('touchend');
  t.mock.timers.tick(180);
  assert.deepEqual(f.settled, [0], 'a tap produces no scrollend, so pending content measurement must be released');
  f.dispatch('touchstart', 1);
  f.dispatch('touchend');
  t.mock.timers.tick(100);
  assert.equal(f.observer.isMoving(), true);
  f.scroll(350);
  t.mock.timers.tick(10_000);
  assert.deepEqual(f.settled, [0], 'the first native scroll cancels the touch-release fallback');
  assert.deepEqual(f.corrections, []);
  f.dispatch('scrollend');
  assert.deepEqual(f.settled, [0, f.step]);
});

test('snap correction aligns both swipe directions and clamps elastic overscroll at the endpoints', t => {
  const f = fixture(t);
  for (const [left, expected] of [[354, 308], [580, 616], [-52, 0], [990, 924]]) {
    f.scroll(left);
    f.dispatch('scrollend');
    assert.equal(f.track.scrollLeft, expected);
    assert.equal(f.settled.at(-1), expected);
  }
  assert.equal(f.corrections.length, 4);
  assert.ok(f.corrections.every(value => value.behavior === 'instant'), 'a residual offset must not start another momentum animation');
});

test('already aligned and subpixel positions do not trigger redundant scroll corrections', t => {
  const f = fixture(t);
  f.scroll(f.step);
  f.dispatch('scrollend');
  f.scroll(f.step * 2 + 0.5);
  f.dispatch('scrollend');
  assert.deepEqual(f.corrections, []);
  assert.deepEqual(f.settled, [f.step, f.step * 2 + 0.5]);
});

test('vertical reading leaves horizontal position untouched and touch release permits pending sizing', t => {
  const f = fixture(t, 308);
  f.track.scrollTop = 120;
  f.dispatch('scroll');
  f.dispatch('scrollend');
  t.mock.timers.tick(1000);
  assert.equal(f.observer.isMoving(), false);
  assert.deepEqual(f.settled, [], 'vertical scroll events alone must not request horizontal settlement');
  f.dispatch('touchstart', 1);
  f.dispatch('scroll');
  t.mock.timers.tick(1000);
  assert.deepEqual(f.settled, []);
  f.dispatch('touchend');
  f.dispatch('scrollend');
  t.mock.timers.tick(1000);
  assert.equal(f.track.scrollLeft, 308);
  assert.equal(f.track.scrollTop, 120);
  assert.equal(f.observer.isMoving(), false);
  assert.deepEqual(f.corrections, []);
  assert.deepEqual(f.settled, [308], 'release permits content changes deferred during the touch to be measured');
});

test('a remaining touch keeps the drag active and cancellation releases it for settling', t => {
  const f = fixture(t);
  f.dispatch('touchstart', 2);
  f.scroll(360);
  f.dispatch('touchend', 1);
  t.mock.timers.tick(1000);
  assert.deepEqual(f.settled, []);
  f.dispatch('touchcancel');
  t.mock.timers.tick(180);
  assert.deepEqual(f.settled, [f.step]);
});

test('disposal cancels queued corrections and ignores further gestures', t => {
  const f = fixture(t);
  f.scroll(350);
  f.observer.dispose();
  t.mock.timers.tick(1000);
  f.dispatch('scrollend');
  f.dispatch('touchstart', 1);
  f.scroll(650);
  f.dispatch('touchend');
  f.dispatch('scrollend');
  t.mock.timers.tick(1000);
  assert.deepEqual(f.corrections, []);
  assert.deepEqual(f.settled, []);
});
