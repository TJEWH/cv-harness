/** Keep layout changes out of native card dragging, momentum and snap animation. */
export function observeJobCardScroll(track: HTMLElement, onSettled: () => void) {
  const supportsScrollEnd = 'onscrollend' in track;
  let lastLeft = track.scrollLeft;
  let scrolling = false;
  let touching = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function settle() {
    const pending = scrolling || timer !== undefined;
    clearTimer();
    if (disposed || touching || !pending) return;
    if (scrolling) {
      const cards = [...track.querySelectorAll<HTMLElement>('.jobs-result-row')];
      const start = track.getBoundingClientRect().left + track.clientLeft
        + (parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0);
      const nearest = cards.reduce<HTMLElement | undefined>((current, card) =>
        !current || Math.abs(card.getBoundingClientRect().left - start) < Math.abs(current.getBoundingClientRect().left - start)
          ? card : current, undefined);
      if (nearest) {
        const left = Math.max(0, Math.min(track.scrollWidth - track.clientWidth,
          track.scrollLeft + nearest.getBoundingClientRect().left - start));
        // Safari can finish momentum a few pixels past a snap point. Correct
        // only at rest; writing scrollLeft during a drag fights native scrolling.
        if (Math.abs(track.scrollLeft - left) > 1) track.scrollTo({ left, behavior: 'instant' });
      }
    }
    lastLeft = track.scrollLeft;
    scrolling = false;
    onSettled();
  }

  function scheduleSettlement() {
    clearTimer();
    if (scrolling && supportsScrollEnd) return;
    // Older iOS versions do not emit scrollend. Continued momentum keeps
    // postponing this fallback, and a held finger prevents it from settling.
    timer = setTimeout(settle, 180);
  }

  function onScroll(event: Event) {
    if (event.target !== track) return;
    if (track.scrollLeft === lastLeft) return;
    lastLeft = track.scrollLeft;
    scrolling = true;
    scheduleSettlement();
  }
  function onScrollEnd(event: Event) { if (event.target === track) settle(); }
  function onTouchStart() { touching = true; clearTimer(); }
  function onTouchEnd(event: TouchEvent) {
    touching = event.touches.length > 0;
    if (!touching) scheduleSettlement();
  }

  track.addEventListener('scroll', onScroll, { passive: true });
  track.addEventListener('scrollend', onScrollEnd, { passive: true });
  track.addEventListener('touchstart', onTouchStart, { passive: true });
  track.addEventListener('touchend', onTouchEnd, { passive: true });
  track.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return {
    isMoving: () => scrolling || touching || timer !== undefined,
    dispose() {
      disposed = true;
      clearTimer();
      track.removeEventListener('scroll', onScroll);
      track.removeEventListener('scrollend', onScrollEnd);
      track.removeEventListener('touchstart', onTouchStart);
      track.removeEventListener('touchend', onTouchEnd);
      track.removeEventListener('touchcancel', onTouchEnd);
    },
  };
}
