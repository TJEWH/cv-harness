import assert from 'node:assert/strict';
import test from 'node:test';
import { attachOpportunityBundlingZoom } from '../../../src/features/opportunities/interaction/bundlingZoom';

type TouchPoint = { identifier: number; clientX: number; clientY: number };
function harness({ width = 500, height = 400, baseSize = 1000, zoom = 1, left = 200, top = 150,
  borderLeft = 0, borderTop = 0 } = {}) {
  const listeners = new Map<string, { listener: EventListener; options: AddEventListenerOptions | boolean | undefined }[]>();
  const renderResolvers: (() => void)[] = [], changes: number[] = [], writes: { axis: string; value: number }[] = [];
  const capture = (options: AddEventListenerOptions | boolean | undefined) => typeof options === 'boolean' ? options : !!options?.capture;
  const viewport = {
    clientWidth: width, clientHeight: height, clientLeft: borderLeft, clientTop: borderTop,
    get scrollWidth() { return Math.max(width, baseSize * zoom); },
    get scrollHeight() { return Math.max(height, baseSize * zoom); },
    get scrollLeft() { return left; },
    set scrollLeft(value: number) { left = Math.max(0, Math.min(this.scrollWidth - width, value)); writes.push({ axis: 'left', value: left }); },
    get scrollTop() { return top; },
    set scrollTop(value: number) { top = Math.max(0, Math.min(this.scrollHeight - height, value)); writes.push({ axis: 'top', value: top }); },
    getBoundingClientRect: () => ({ left: 100, top: 50, width, height }),
    addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions | boolean) {
      const records = listeners.get(type) ?? []; records.push({ listener, options }); listeners.set(type, records);
    },
    removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions | boolean) {
      listeners.set(type, (listeners.get(type) ?? []).filter(record => record.listener !== listener || capture(record.options) !== capture(options)));
    },
  };
  const controls = attachOpportunityBundlingZoom(viewport as unknown as HTMLElement, {
    getZoom: () => zoom,
    setZoom: value => { zoom = value; changes.push(value); },
    baseSize: () => baseSize,
    afterRender: () => new Promise<void>(resolve => renderResolvers.push(resolve)),
  });
  function dispatch(type: string, properties: Record<string, unknown> = {}) {
    const event = { type, target: viewport, currentTarget: viewport, cancelable: true, defaultPrevented: false, immediateStopped: false,
      detail: 1, touches: [] as TouchPoint[], clientX: 350 + borderLeft, clientY: 250 + borderTop,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediateStopped = true; },
      ...properties };
    for (const { listener } of [...(listeners.get(type) ?? [])]) {
      listener.call(viewport, event as unknown as Event);
      if (event.immediateStopped) break;
    }
    return event;
  }
  const point = (x: number, y = 200, identifier = 1): TouchPoint => ({ identifier, clientX: x + 100 + borderLeft, clientY: y + 50 + borderTop });
  const touch = (type: string, points: TouchPoint[], extra: Record<string, unknown> = {}) => dispatch(`touch${type}`, { touches: points, ...extra });
  const wheel = (deltaY: number, extra: Record<string, unknown> = {}) => dispatch('wheel', { ctrlKey: true, deltaY, deltaMode: 0, ...extra });
  async function flush() { renderResolvers.splice(0).forEach(resolve => resolve()); await Promise.resolve(); }
  function worldAt(x: number, y: number) {
    return { x: (left + x - Math.max(0, (width - baseSize * zoom) / 2)) / zoom,
      y: (top + y - Math.max(0, (height - baseSize * zoom) / 2)) / zoom };
  }
  return { viewport, controls, listeners, changes, writes, point, touch, wheel, dispatch, flush, worldAt, zoom: () => zoom };
}
function close(actual: number, expected: number) { assert(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`); }

test('a two-finger pinch follows touch identifiers and preserves its focal point with existing scroll and borders', async () => {
  const h = harness({ borderLeft: 3, borderTop: 5 });
  const before = h.worldAt(250, 200);
  assert(h.touch('start', [h.point(200, 200, 7), h.point(300, 200, 9)]).defaultPrevented);
  assert(h.touch('move', [h.point(350, 200, 9), h.point(150, 200, 7)]).defaultPrevented, 'touch list reordering does not swap finger identity');
  assert.equal(h.zoom(), 2);
  assert.equal(h.writes.length, 0, 'scroll adjustment waits for the SVG size to render');
  await h.flush();
  assert.equal(h.viewport.scrollLeft, 650); assert.equal(h.viewport.scrollTop, 500);
  assert.deepEqual(h.worldAt(250, 200), before);
});

test('pinch zoom is bounded from one half to four times and its latest frame wins before rendering', async () => {
  const h = harness();
  h.touch('start', [h.point(200), h.point(300, 200, 2)]);
  h.touch('move', [h.point(175), h.point(325, 200, 2)]);
  h.touch('move', [h.point(150), h.point(350, 200, 2)]);
  await h.flush();
  assert.equal(h.zoom(), 2); assert.equal(h.writes.length, 2, 'superseded callbacks cannot restore an earlier scroll offset');
  assert.equal(h.viewport.scrollLeft, 650); assert.equal(h.viewport.scrollTop, 500);
  h.touch('move', [h.point(-250), h.point(750, 200, 2)]);
  assert.equal(h.zoom(), 4);
  h.touch('move', [h.point(245), h.point(255, 200, 2)]);
  assert.equal(h.zoom(), .5);
  await h.flush();
  assert.equal(h.viewport.scrollLeft, 0); assert.equal(h.viewport.scrollTop, 0);
});

test('zooming out accounts for centered margins when the chart becomes narrower than its viewport', async () => {
  const h = harness({ width: 800, height: 400, left: 100, top: 200 });
  const before = h.worldAt(400, 200);
  h.touch('start', [h.point(350), h.point(450, 200, 2)]);
  h.touch('move', [h.point(375), h.point(425, 200, 2)]);
  await h.flush();
  assert.equal(h.zoom(), .5);
  assert.equal(h.viewport.scrollLeft, 0); assert.equal(h.viewport.scrollTop, 0);
  assert.deepEqual(h.worldAt(400, 200), before, 'the fitted horizontal axis includes its 150px centering margin');
});

test('one-finger drags and ordinary wheel scrolling remain native', () => {
  const h = harness();
  assert.equal(h.touch('start', [h.point(200)]).defaultPrevented, false);
  assert.equal(h.touch('move', [h.point(100)]).defaultPrevented, false);
  assert.equal(h.wheel(-20, { ctrlKey: false }).defaultPrevented, false);
  assert.equal(h.wheel(-20, { cancelable: false }).defaultPrevented, false);
  assert.equal(h.wheel(NaN).defaultPrevented, false);
  assert.deepEqual(h.changes, []);
  assert.equal(h.listeners.get('touchmove')![0]!.options && (h.listeners.get('touchmove')![0]!.options as AddEventListenerOptions).passive, false);
});

test('control-wheel pinch normalizes pixel, line and page deltas and keeps the cursor anchored', async () => {
  for (const [deltaY, deltaMode] of [[-20, 0], [-1.25, 1], [-.05, 2]]) {
    const h = harness();
    const before = h.worldAt(250, 200);
    assert(h.wheel(deltaY!, { deltaMode }).defaultPrevented);
    close(h.zoom(), Math.exp(.2));
    await h.flush();
    close(h.worldAt(250, 200).x, before.x); close(h.worldAt(250, 200).y, before.y);
  }
  const h = harness();
  const before = h.worldAt(250, 200);
  h.wheel(-10); h.wheel(-10);
  await h.flush();
  close(h.zoom(), Math.exp(.2));
  close(h.worldAt(250, 200).x, before.x); close(h.worldAt(250, 200).y, before.y);
});

test('cancelled or replaced touches abandon the pinch and a new pair can restart it', async () => {
  const h = harness();
  h.touch('start', [h.point(200), h.point(300, 200, 2)]);
  assert.equal(h.touch('move', [h.point(150), h.point(350, 200, 3)]).defaultPrevented, false, 'replacement finger cannot inherit the original pinch');
  h.touch('move', [h.point(100), h.point(400, 200, 2)]);
  assert.equal(h.zoom(), 1);
  h.touch('start', [h.point(200), h.point(300, 200, 2)]);
  h.touch('move', [h.point(150), h.point(350, 200, 2)]);
  h.touch('cancel', []);
  await h.flush();
  assert.equal(h.writes.length, 0, 'cancel invalidates a pending scroll write');
  const count = h.changes.length;
  h.touch('move', [h.point(100), h.point(400, 200, 2)]);
  assert.equal(h.changes.length, count);
  h.touch('start', [h.point(200, 200, 8), h.point(300, 200, 9)]);
  h.touch('move', [h.point(225, 200, 8), h.point(275, 200, 9)]);
  await h.flush();
  assert.equal(h.zoom(), 1, 'the restarted gesture uses the current rendered zoom as its baseline');
  h.touch('end', [h.point(225, 200, 8)]);
  assert.equal(h.touch('move', [h.point(210, 200, 8)]).defaultPrevented, false);
});

test('pinching suppresses pointer clicks while keeping keyboard activation and fresh gestures usable', () => {
  const h = harness();
  h.touch('start', [h.point(200), h.point(300, 200, 2)]);
  h.touch('move', [h.point(150), h.point(350, 200, 2)]);
  h.touch('end', []);
  const keyboard = h.dispatch('click', { detail: 0 });
  assert.equal(keyboard.defaultPrevented, false); assert.equal(keyboard.immediateStopped, false);
  const compatibility = h.dispatch('click', { detail: 1 });
  assert.equal(compatibility.defaultPrevented, true); assert.equal(compatibility.immediateStopped, true);
  assert.equal(h.listeners.get('click')![0]!.options, true, 'suppression runs before job selection listeners');
  h.touch('start', [h.point(200)]);
  assert.equal(h.dispatch('click', { detail: 1 }).defaultPrevented, false, 'a fresh one-finger tap clears the guard');
  h.touch('start', [h.point(200), h.point(300, 200, 2)]);
  h.touch('end', []);
  h.dispatch('pointerdown');
  assert.equal(h.dispatch('click', { detail: 1 }).defaultPrevented, false, 'a fresh pointer gesture also clears the guard');
});

test('Safari scale gestures zoom around their midpoint without double-applying a simultaneous touch pinch', async () => {
  const h = harness();
  assert(h.dispatch('gesturestart', { scale: 1 }).defaultPrevented);
  assert(h.dispatch('gesturechange', { scale: 1.5 }).defaultPrevented);
  await h.flush();
  assert.equal(h.zoom(), 1.5);
  h.dispatch('gestureend');
  h.touch('start', [h.point(200), h.point(300, 200, 2)]);
  h.dispatch('gesturestart', { scale: 1 });
  h.dispatch('gesturechange', { scale: 3 });
  assert.equal(h.zoom(), 1.5);
  h.touch('move', [h.point(150), h.point(350, 200, 2)]);
  await h.flush();
  assert.equal(h.zoom(), 3);
});

test('reset supersedes pending frames and dispose removes listeners and prevents delayed scroll writes', async () => {
  const h = harness();
  h.wheel(-20);
  h.controls.reset();
  await h.flush();
  assert.equal(h.zoom(), 1); assert.equal(h.viewport.scrollLeft, 0); assert.equal(h.viewport.scrollTop, 0);
  assert.equal(h.writes.length, 2, 'only the reset frame reaches the viewport');
  h.wheel(-20);
  const count = h.changes.length;
  h.controls.dispose();
  await h.flush();
  assert.equal(h.writes.length, 2, 'disposing invalidates all pending render callbacks');
  assert.equal([...h.listeners.values()].flat().length, 0);
  h.wheel(-20); h.touch('start', [h.point(200), h.point(300, 200, 2)]);
  assert.equal(h.changes.length, count);
});
