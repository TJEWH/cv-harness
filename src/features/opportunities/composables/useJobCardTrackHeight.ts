import { onBeforeUnmount, ref, watchPostEffect, type Ref } from 'vue';
import { observeJobCardScroll } from '../interaction/jobCardScroll';

/** Size a mobile list to its settled card, without resizing during native momentum. */
export function useJobCardTrackHeight(root: Ref<HTMLElement | null>, active: () => boolean) {
  const viewport = window.matchMedia('(max-width: 760px)');
  const mobile = ref(viewport.matches);
  const onViewportChange = () => { mobile.value = viewport.matches; };
  viewport.addEventListener('change', onViewportChange);
  onBeforeUnmount(() => viewport.removeEventListener('change', onViewportChange));

  watchPostEffect(onCleanup => {
    const container = root.value;
    if (!container || !mobile.value || !active()) return;
    let frame = 0;
    const observed = new Set<HTMLElement>();
    const sizedTracks = new Set<HTMLElement>();
    const scrolling = new Map<HTMLElement, ReturnType<typeof observeJobCardScroll>>();
    const resize = new ResizeObserver(schedule);

    function update() {
      frame = 0;
      const cardsToObserve = new Set<HTMLElement>();
      const tracks = new Set(container!.querySelectorAll<HTMLElement>('.jobs-card-track'));
      for (const [track, observer] of scrolling) {
        if (!tracks.has(track)) { observer.dispose(); scrolling.delete(track); }
      }
      for (const track of tracks) {
        if (!scrolling.has(track)) scrolling.set(track, observeJobCardScroll(track, schedule));
        const cards = [...track.querySelectorAll<HTMLElement>('.jobs-result-row')];
        cards.forEach(card => cardsToObserve.add(card));
        if (!cards.length || !track.getClientRects().length || scrolling.get(track)!.isMoving()) continue;
        const style = getComputedStyle(track);
        const start = track.getBoundingClientRect().left + track.clientLeft + (parseFloat(style.scrollPaddingLeft) || 0);
        const current = cards.reduce((nearest, card, index) =>
          Math.abs(card.getBoundingClientRect().left - start) < Math.abs(cards[nearest].getBoundingClientRect().left - start) ? index : nearest, 0);
        const height = cards[current].getBoundingClientRect().height
          + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const value = `${Math.ceil(height)}px`;
        if (track.style.getPropertyValue('--jobs-card-track-height') !== value) track.style.setProperty('--jobs-card-track-height', value);
        sizedTracks.add(track);
      }
      for (const card of observed) {
        if (!cardsToObserve.has(card)) { resize.unobserve(card); observed.delete(card); }
      }
      for (const card of cardsToObserve) {
        if (!observed.has(card)) { resize.observe(card); observed.add(card); }
      }
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }

    const mutations = new MutationObserver(schedule);
    mutations.observe(container, { childList: true, characterData: true, subtree: true });
    resize.observe(container);
    update();
    onCleanup(() => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      scrolling.forEach(observer => observer.dispose());
      sizedTracks.forEach(track => track.style.removeProperty('--jobs-card-track-height'));
    });
  });
}
