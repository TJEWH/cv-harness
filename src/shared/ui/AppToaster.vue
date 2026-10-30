<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faCheck, faCircleInfo, faCircleXmark, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useToasts } from './useToasts';
import type { Toast } from './useToasts';

const props = withDefaults(defineProps<{ lang?: string }>(), { lang: 'en' });
const { toasts, dismiss, pause, resume, notify } = useToasts();
const toastIcons = { success: faCheck, info: faCircleInfo, warning: faTriangleExclamation, error: faCircleXmark };
const labels = computed(() => props.lang === 'de'
  ? { region: 'Benachrichtigungen', close: 'Benachrichtigung schließen', waiting: 'Bitte warten …', failed: 'Der Vorgang ist fehlgeschlagen. Bitte erneut versuchen.' }
  : { region: 'Notifications', close: 'Dismiss notification', waiting: 'Please wait …', failed: 'The operation failed. Please try again.' });
const host = ref<HTMLElement | null>(null);
const target = ref<HTMLElement | string>('body');
const acting = ref(new Set<number>());
const transitionKey = ref(0);
const leaving = new Set<Element>();
let observer: MutationObserver | undefined;
function modalTarget() {
  // Keep notification actions reachable while a native modal makes the rest of the page inert.
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
  target.value = dialogs.at(-1) || 'body';
}
async function show() {
  await nextTick();
  const element = host.value;
  if (!element?.showPopover) return;
  if (toasts.value.length || leaving.size) {
    if (!element.matches(':popover-open')) element.showPopover();
  } else if (element.matches(':popover-open')) element.hidePopover();
}
function beginLeave(element: Element) { leaving.add(element); }
function finishLeave(element: Element) { leaving.delete(element); void show(); }
function visibility() {
  for (const toast of toasts.value) (document.hidden ? pause : resume)(toast.id, 'page-hidden');
}
function focusOut(id: number, event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) resume(id, 'focus');
}
async function runAction(toast: Toast) {
  if (!toast.action || acting.value.has(toast.id)) return;
  acting.value.add(toast.id);
  pause(toast.id, 'action');
  try {
    const result = await toast.action.run();
    if (result !== false && toasts.value.find(item => item.id === toast.id)?.revision === toast.revision) dismiss(toast.id);
  } catch (reason) {
    if (toasts.value.find(item => item.id === toast.id)?.revision === toast.revision) {
      dismiss(toast.id);
      notify({ message: reason instanceof Error ? reason.message : labels.value.failed, tone: 'error', action: toast.action });
    }
  } finally {
    acting.value.delete(toast.id);
    resume(toast.id, 'action');
  }
}
watch(toasts, (current, previous) => {
  if (current.length && (previous.length || leaving.size)) {
    // Replacing the group cancels an interrupted transition and shows the new message immediately.
    leaving.clear();
    transitionKey.value++;
  }
}, { flush: 'sync' });
watch([toasts, target], () => { visibility(); void show(); });
onMounted(() => {
  modalTarget();
  observer = new MutationObserver(modalTarget);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('visibilitychange', visibility);
  visibility();
  void show();
});
onBeforeUnmount(() => { observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); });
</script>

<template>
  <Teleport :to="target">
    <aside ref="host" class="app-toaster" popover="manual" :aria-label="labels.region">
      <TransitionGroup :key="transitionKey" name="toast" tag="div" class="app-toaster__stack" :appear="transitionKey === 0"
        @before-leave="beginLeave" @after-leave="finishLeave" @leave-cancelled="finishLeave">
        <article v-for="toast in toasts" :key="toast.id" class="app-toast" :class="`app-toast--${toast.tone}`"
          :role="toast.tone === 'error' ? 'alert' : 'status'" aria-atomic="true"
          @mouseenter="pause(toast.id)" @mouseleave="resume(toast.id)" @focusin="pause(toast.id, 'focus')" @focusout="focusOut(toast.id, $event)">
          <span class="app-toast__icon" aria-hidden="true"><FontAwesomeIcon :icon="toastIcons[toast.tone]" /></span>
          <div class="app-toast__body">
            <p>{{ toast.message }}</p>
            <button v-if="toast.action" type="button" class="app-toast__action" :disabled="acting.has(toast.id)" @click="runAction(toast)">{{ acting.has(toast.id) ? labels.waiting : toast.action.label }}</button>
          </div>
          <button type="button" class="app-toast__close" :aria-label="labels.close" @click="dismiss(toast.id)"><FontAwesomeIcon :icon="faXmark" aria-hidden="true" /></button>
        </article>
      </TransitionGroup>
    </aside>
  </Teleport>
</template>

<style scoped>
.app-toaster { position: fixed; inset: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) auto auto; z-index: 10000; width: min(380px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: 0; padding: 0; border: 0; overflow: auto; background: transparent; color: var(--ui-text); font: 13px/1.5 var(--font-ui, system-ui); pointer-events: none; scrollbar-width: thin; }
.app-toaster::backdrop { display: none; }
.app-toaster__stack { display: grid; gap: 10px; padding: 3px; }
.app-toast { --toast-accent: #8dc8e8; display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 14px; border: 1px solid var(--ui-border); border-inline-start-color: var(--toast-accent); border-radius: 8px; background: var(--ui-surface); pointer-events: auto; }
.app-toast--success { --toast-accent: var(--ui-accent); }
.app-toast--warning { --toast-accent: #efcc87; }
.app-toast--error { --toast-accent: #fca5a5; }
.app-toast__icon { display: grid; place-items: center; flex: 0 0 20px; height: 20px; color: var(--toast-accent); font-size: 14px; }
.app-toast__body { flex: 1; min-width: 0; }
.app-toast__body p { margin: 0; overflow-wrap: anywhere; }
.app-toast button { color: inherit; font: inherit; cursor: pointer; }
.app-toast__close { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; margin: -4px -5px 0 0; padding: 0; border: 0; border-radius: 4px; background: transparent; line-height: 1; }
.app-toast__close .svg-inline--fa { width: 14px; height: 14px; }
.app-toast__action { margin-top: 10px; padding: 5px 9px; border: 1px solid var(--ui-accent-border); border-radius: 5px; background: var(--ui-control); }
.app-toast button:hover:not(:disabled) { background: var(--ui-surface-hover); }
.app-toast button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.app-toast button:disabled { opacity: .6; cursor: wait; }
.toast-enter-active { transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1); }
.toast-leave-active { transition: opacity 120ms ease-in, transform 120ms ease-in; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(10px); }
@media (max-width: 760px) { .app-toaster { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .toast-enter-active, .toast-leave-active { transition: opacity 80ms linear; } .toast-enter-from, .toast-leave-to { transform: none; } }
@media print { .app-toaster { display: none !important; } }
</style>
