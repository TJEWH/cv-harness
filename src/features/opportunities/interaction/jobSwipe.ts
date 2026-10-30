type SwipeDirection = -1 | 1;
type SwipeOptions = {
  enabled: () => boolean;
  onSwipe: (direction: SwipeDirection) => void;
};

type Gesture = {
  identifier: number;
  x: number;
  y: number;
  startedAt: number;
  horizontal: boolean;
};

const ignoredTargets = 'a, button, input, textarea, select, option, summary, [role="button"], [role="link"], [role="slider"], [contenteditable]:not([contenteditable="false"]), .pdf-preview, [data-swipe-ignore]';

function targetElement(target: EventTarget | null): Element | null {
  if (!target || !('nodeType' in target)) return null;
  const node = target as Node;
  return node.nodeType === 1 ? node as Element : node.parentElement;
}

function ignoresGesture(event: TouchEvent): boolean {
  const boundary = targetElement(event.currentTarget);
  for (let element = targetElement(event.target); element; element = element.parentElement) {
    if (element.matches(ignoredTargets)) return true;
    if (element === boundary) break;
    if (element.scrollWidth > element.clientWidth + 1) {
      const overflow = element.ownerDocument.defaultView?.getComputedStyle(element).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

/** Bind start/end passively and move nonpassively; cancel on touchcancel. */
export function createJobSwipe({ enabled, onSwipe }: SwipeOptions) {
  let gesture: Gesture | null = null;
  let suppressClickUntil = 0;

  function cancel() { gesture = null; }

  function onTouchStart(event: TouchEvent) {
    cancel();
    suppressClickUntil = 0;
    if (!enabled() || event.defaultPrevented || event.touches.length !== 1 || ignoresGesture(event)) return;
    const touch = event.touches[0];
    const view = event.view ?? targetElement(event.target)?.ownerDocument.defaultView;
    const width = view?.innerWidth ?? (typeof window === 'undefined' ? 0 : window.innerWidth);
    // Leave both screen edges to native back/forward navigation.
    if (touch.clientX <= 24 || (width > 0 && touch.clientX >= width - 24)) return;
    gesture = {
      identifier: touch.identifier, x: touch.clientX, y: touch.clientY,
      startedAt: event.timeStamp, horizontal: false,
    };
  }

  function horizontalIntent(touch: Touch): boolean {
    if (!gesture) return false;
    const dx = Math.abs(touch.clientX - gesture.x);
    const dy = Math.abs(touch.clientY - gesture.y);
    if (Math.max(dx, dy) < 12) return false;
    // Once a gesture is vertical, it cannot become job navigation later.
    if (!gesture.horizontal && dy >= dx) { cancel(); return false; }
    if (dx > dy * 1.5) gesture.horizontal = true;
    return gesture.horizontal;
  }

  function onTouchMove(event: TouchEvent) {
    if (!gesture) return;
    const touch = event.touches[0];
    if (!enabled() || event.defaultPrevented || event.touches.length !== 1
      || touch.identifier !== gesture.identifier || event.timeStamp - gesture.startedAt > 900) {
      cancel();
      return;
    }
    if (horizontalIntent(touch)) {
      // A noncancelable move means the browser already owns this gesture.
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
    }
  }

  function onTouchEnd(event: TouchEvent) {
    const current = gesture;
    if (!current) return;
    const touch = event.changedTouches[0];
    if (!enabled() || event.defaultPrevented || event.touches.length !== 0 || event.changedTouches.length !== 1
      || touch.identifier !== current.identifier || event.timeStamp - current.startedAt > 900) {
      cancel();
      return;
    }
    const dx = touch.clientX - current.x;
    const dy = touch.clientY - current.y;
    const horizontal = horizontalIntent(touch);
    cancel();
    if (!horizontal || Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    suppressClickUntil = event.timeStamp + 450;
    onSwipe(dx < 0 ? 1 : -1);
  }

  function onClickCapture(event: MouseEvent) {
    // Keyboard activation has no click count; a fresh touch also clears this guard.
    if (!suppressClickUntil || event.detail === 0 || event.timeStamp > suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  }

  return { onTouchStart, onTouchMove, onTouchEnd, cancel, onClickCapture };
}
