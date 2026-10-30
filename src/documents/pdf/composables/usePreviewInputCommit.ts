import { nextTick, onBeforeUnmount, onMounted } from 'vue';

export function isPreviewTextInput(target: EventTarget | null): target is HTMLElement {
  return typeof Element !== 'undefined' && target instanceof HTMLElement && target.matches(
    'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
  );
}

/** Keep the last PDF visible during text entry; commit after the DOM/model update. */
export function usePreviewInputCommit(onCommit: () => void) {
  let pending = false;
  let field: HTMLElement | null = null;
  let disposed = false;
  let observer: MutationObserver | undefined;
  function reset() { pending = false; field = null; observer?.disconnect(); }
  async function commit() {
    await nextTick();
    if (!pending || disposed) return;
    reset();
    onCommit();
  }
  function defer() {
    if (typeof document === 'undefined' || !isPreviewTextInput(document.activeElement)) return false;
    pending = true;
    field = document.activeElement as HTMLElement;
    observer?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'style', 'class'] });
    return true;
  }
  function onFocusOut(event: FocusEvent) { if (event.target === field) void commit(); }
  function onPointerDown(event: PointerEvent) {
    if (field && event.target instanceof Node && !field.contains(event.target)) void commit();
  }
  function onKeyUp(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && isPreviewTextInput(event.target)) void commit();
  }
  function onVisibilityChange() { if (document.hidden) void commit(); }
  onMounted(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', commit);
    if (typeof MutationObserver !== 'undefined') observer = new MutationObserver(() => {
      // Removing or hiding a focused field does not consistently emit blur.
      if (field && (!field.isConnected || document.activeElement !== field || !field.getClientRects().length)) void commit();
    });
  });
  onBeforeUnmount(() => {
    disposed = true;
    reset();
    if (typeof document === 'undefined') return;
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('blur', commit);
  });
  return { defer, reset };
}
