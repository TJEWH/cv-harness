interface PointerSample { pointerId: number; button: number; clientX: number; clientY: number }

/** Separates a node click from camera panning, including a drag that returns to its origin. */
export function createOpportunityNetworkSelection(distance = 6) {
  let press: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
  const move = (event: Pick<PointerSample, 'pointerId' | 'clientX' | 'clientY'>) => {
    if (press?.pointerId === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= distance) press.moved = true;
  };
  return {
    begin(event: PointerSample) {
      if (press) { press.moved = true; return; }
      if (event.button === 0) press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    },
    move,
    end(event: PointerSample): boolean {
      if (!press || press.pointerId !== event.pointerId) return false;
      move(event);
      const select = event.button === 0 && !press.moved;
      press = null;
      return select;
    },
    cancel() { press = null; },
  };
}
