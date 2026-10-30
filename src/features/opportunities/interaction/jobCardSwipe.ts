import { createJobSwipe } from './jobSwipe';

/** Extend a card row's native scrolling to the surrounding list space. */
export function createJobCardSwipe(options: { enabled: () => boolean; root: () => HTMLElement | null }) {
  let track: HTMLElement | null = null;
  let nativeStart: { identifier: number; x: number; y: number; time: number } | null = null;

  function adjacentOffset(direction: -1 | 1) {
    if (!track || !options.root()?.contains(track)) return;
    const cards = [...track.querySelectorAll<HTMLElement>('.jobs-result-row')];
    const padding = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
    const left = track.getBoundingClientRect().left + padding;
    const current = cards.reduce((nearest, card, index) =>
      Math.abs(card.getBoundingClientRect().left - left) < Math.abs(cards[nearest].getBoundingClientRect().left - left) ? index : nearest, 0);
    const next = cards[current + direction];
    if (next) return track.scrollLeft + next.getBoundingClientRect().left - left;
  }

  function resetTop() {
    const root = options.root();
    if (!track || !root?.contains(track)) return;
    // Align before horizontal movement starts. Moving the ancestor during a
    // smooth swipe can interrupt it and produces a visible second jump.
    if (track.scrollTop) track.scrollTop = 0;
    const offset = track.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientTop
      - (parseFloat(getComputedStyle(root).paddingTop) || 0);
    if (Math.abs(offset) > 1) root.scrollTo({ top: root.scrollTop + offset, behavior: 'instant' });
  }

  function nativeTrack(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-swipe-ignore]')) return null;
    for (let element: Element | null = target; element && element !== options.root(); element = element.parentElement) {
      if (element.matches('.jobs-card-track')) return element as HTMLElement;
      // Leave nested horizontal controls and text selection to the browser.
      if (element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return null;
    }
    return null;
  }

  const swipe = createJobSwipe({
    enabled: options.enabled,
    onSwipe(direction) {
      const left = adjacentOffset(direction);
      if (left === undefined) return;
      resetTop();
      track!.scrollTo({
        left,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    },
  });
  return {
    ...swipe,
    onTouchStart(event: TouchEvent) {
      track = null;
      nativeStart = null;
      const root = options.root();
      const touch = event.touches[0];
      if (options.enabled() && root && touch && event.touches.length === 1 && !event.defaultPrevented) {
        // Native card scrolling still owns touches inside a row. In headings,
        // gutters or empty space, use the nearest visible row instead.
        let nearestDistance = Infinity;
        const viewport = root.getBoundingClientRect();
        for (const candidate of root.querySelectorAll<HTMLElement>('.jobs-card-track')) {
          const bounds = candidate.getBoundingClientRect();
          if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue;
          const distance = Math.max(bounds.top - touch.clientY, touch.clientY - bounds.bottom, 0);
          if (distance < nearestDistance) { track = candidate; nearestDistance = distance; }
        }
        if (track && nativeTrack(event.target) === track && touch.clientX > 24 && touch.clientX < window.innerWidth - 24) {
          nativeStart = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
        }
      }
      swipe.onTouchStart(event);
    },
    onTouchMove(event: TouchEvent) {
      const start = nativeStart;
      if (start) {
        const touch = event.touches[0];
        if (!options.enabled() || event.defaultPrevented || event.touches.length !== 1
          || touch.identifier !== start.identifier || event.timeStamp - start.time > 900) {
          nativeStart = null;
        } else {
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) >= 12) {
            if (Math.abs(dy) >= Math.abs(dx)) nativeStart = null;
            else if (Math.abs(dx) > Math.abs(dy) * 1.5) {
              nativeStart = null;
              // This runs before the move's native horizontal scrolling. Keep
              // that native drag, snapping and momentum intact.
              if (adjacentOffset(dx < 0 ? 1 : -1) !== undefined) resetTop();
            }
          }
        }
      }
      swipe.onTouchMove(event);
    },
    onTouchEnd(event: TouchEvent) { nativeStart = null; swipe.onTouchEnd(event); },
    onWheel(event: WheelEvent) {
      if (!options.enabled() || event.defaultPrevented || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      track = nativeTrack(event.target);
      if (adjacentOffset(event.deltaX > 0 ? 1 : -1) !== undefined) resetTop();
    },
    cancel() { nativeStart = null; track = null; swipe.cancel(); },
  };
}
