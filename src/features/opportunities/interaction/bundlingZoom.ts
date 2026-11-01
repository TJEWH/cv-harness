interface ZoomOptions {
  getZoom(): number;
  setZoom(value: number): void;
  baseSize(): number;
  afterRender(): Promise<unknown>;
}
interface Frame { zoom: number; left: number; top: number }
interface Anchor { x: number; y: number }
interface Pinch { kind: 'touch' | 'gesture'; ids: number[]; distance: number; zoom: number; anchor: Anchor }
interface ScaleGesture extends Event { scale: number; clientX?: number; clientY?: number }

/** Zoom the SVG around the gesture midpoint while leaving ordinary scrolling native. */
export function attachOpportunityBundlingZoom(viewport: HTMLElement, options: ZoomOptions) {
  let pending: Frame | null = null, pinch: Pinch | null = null;
  let generation = 0, disposed = false, suppressClick = false;
  const frame = (): Frame => pending ?? { zoom: options.getZoom(), left: viewport.scrollLeft, top: viewport.scrollTop };
  function local(clientX?: number, clientY?: number) {
    const bounds = viewport.getBoundingClientRect();
    return { x: Number.isFinite(clientX) ? clientX! - bounds.left - (viewport.clientLeft || 0) : viewport.clientWidth / 2,
      y: Number.isFinite(clientY) ? clientY! - bounds.top - (viewport.clientTop || 0) : viewport.clientHeight / 2 };
  }
  function offset(zoom: number) {
    const side = options.baseSize() * zoom;
    return { x: Math.max(0, (viewport.clientWidth - side) / 2), y: Math.max(0, (viewport.clientHeight - side) / 2) };
  }
  function anchorAt(point: Anchor): Anchor {
    const current = frame(), margin = offset(current.zoom);
    return { x: (current.left + point.x - margin.x) / current.zoom, y: (current.top + point.y - margin.y) / current.zoom };
  }
  function apply(value: number, anchor: Anchor, point: Anchor) {
    if (disposed || !Number.isFinite(value)) return;
    const zoom = Math.max(.5, Math.min(4, value)), side = options.baseSize() * zoom, margin = offset(zoom);
    const next = { zoom,
      left: Math.max(0, Math.min(Math.max(0, side - viewport.clientWidth), anchor.x * zoom + margin.x - point.x)),
      top: Math.max(0, Math.min(Math.max(0, side - viewport.clientHeight), anchor.y * zoom + margin.y - point.y)) };
    const token = ++generation;
    pending = next;
    options.setZoom(zoom);
    void options.afterRender().then(() => {
      if (disposed || token !== generation) return;
      viewport.scrollLeft = next.left; viewport.scrollTop = next.top;
      pending = null;
    });
  }
  function wheel(event: WheelEvent) {
    if (!event.ctrlKey || !event.cancelable || !Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    if (pinch) return;
    const point = local(event.clientX, event.clientY);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    apply(frame().zoom * Math.exp(-Math.max(-700, Math.min(700, delta * .01))), anchorAt(point), point);
  }
  function touchPair(event: TouchEvent, ids?: number[]) {
    const touches = Array.from(event.touches);
    if (touches.length !== 2) return null;
    const pair = ids ? ids.map(id => touches.find(touch => touch.identifier === id)) : touches;
    const a = pair[0], b = pair[1];
    if (!a || !b) return null;
    return { ids: [a.identifier, b.identifier], distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      point: local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2) };
  }
  function touchStart(event: TouchEvent) {
    if (event.touches.length === 1 && !pinch) suppressClick = false;
    const pair = touchPair(event);
    if (!pair || pair.distance < 1 || !event.cancelable) { pinch = null; return; }
    event.preventDefault();
    suppressClick = true;
    pinch = { kind: 'touch', ids: pair.ids, distance: pair.distance, zoom: frame().zoom, anchor: anchorAt(pair.point) };
  }
  function touchMove(event: TouchEvent) {
    if (pinch?.kind !== 'touch') return;
    const pair = touchPair(event, pinch.ids);
    if (!pair || !event.cancelable) { pinch = null; return; }
    event.preventDefault();
    apply(pinch.zoom * pair.distance / pinch.distance, pinch.anchor, pair.point);
  }
  function touchEnd(event: TouchEvent) { if (event.touches.length !== 2 && pinch?.kind === 'touch') pinch = null; }
  function cancel() { pinch = null; generation++; pending = null; }
  function gestureStart(event: Event) {
    if (!event.cancelable) return;
    event.preventDefault();
    if (pinch?.kind === 'touch') return;
    const gesture = event as ScaleGesture;
    if (!(gesture.scale > 0) || !Number.isFinite(gesture.scale)) return;
    const point = local(gesture.clientX, gesture.clientY);
    pinch = { kind: 'gesture', ids: [], distance: gesture.scale, zoom: frame().zoom, anchor: anchorAt(point) };
  }
  function gestureChange(event: Event) {
    if (!event.cancelable || !pinch) return;
    event.preventDefault();
    if (pinch.kind !== 'gesture') return;
    const gesture = event as ScaleGesture;
    if (gesture.scale > 0) apply(pinch.zoom * gesture.scale / pinch.distance, pinch.anchor, local(gesture.clientX, gesture.clientY));
  }
  function gestureEnd() { if (pinch?.kind === 'gesture') pinch = null; }
  function pointerDown() { if (!pinch) suppressClick = false; }
  function click(event: MouseEvent) {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }
  const listeners: [string, EventListener, AddEventListenerOptions | boolean][] = [
    ['wheel', wheel as EventListener, { passive: false }],
    ['touchstart', touchStart as EventListener, { passive: false }],
    ['touchmove', touchMove as EventListener, { passive: false }],
    ['touchend', touchEnd as EventListener, false], ['touchcancel', cancel, false],
    ['gesturestart', gestureStart, { passive: false }], ['gesturechange', gestureChange, { passive: false }], ['gestureend', gestureEnd, false],
    ['pointerdown', pointerDown, false], ['click', click as EventListener, true],
  ];
  for (const [name, listener, settings] of listeners) viewport.addEventListener(name, listener, settings);
  return {
    zoomAt(value: number, clientX?: number, clientY?: number) {
      const point = local(clientX, clientY);
      apply(value, anchorAt(point), point);
    },
    reset() {
      cancel(); suppressClick = false;
      apply(1, { x: 0, y: 0 }, { x: 0, y: 0 });
    },
    dispose() {
      disposed = true; cancel();
      for (const [name, listener, settings] of listeners) viewport.removeEventListener(name, listener, settings);
    },
  };
}
