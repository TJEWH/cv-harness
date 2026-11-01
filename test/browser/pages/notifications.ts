/** Isolated UI fixture: no accounts, storage, or network operations. */
import { createApp, h, nextTick, ref } from 'vue';
import AppToaster from '../../../src/shared/ui/AppToaster.vue';
import InfoHint from '../../../src/shared/ui/InfoHint.vue';
import { useToasts } from '../../../src/shared/ui/useToasts';
import '../../../src/assets/cv.css';

createApp({
  setup() {
    const { notify, clear } = useToasts();
    const dialog = ref<HTMLDialogElement | null>(null);
    const retries = ref(0);
    const checking = ref(false);
    const checkResult = ref('');
    async function checkTransitions() {
      checking.value = true;
      checkResult.value = 'Checking toast timing and transitions…';
      clear();
      const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
      const rendered = async () => { await nextTick(); await nextTick(); };
      const until = async (condition: () => unknown) => {
        const end = performance.now() + 6000;
        while (!condition()) {
          if (performance.now() > end) throw new Error('Timed out waiting for the toast transition.');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      try {
        notify({ key: 'check-first', message: 'First notification', tone: 'success' });
        await rendered();
        const host = document.querySelector<HTMLElement>('.app-toaster')!;
        assert(host.matches(':popover-open'), 'The notification container must be visible.');
        assert(host.querySelector('.toast-enter-active'), 'The first toast must animate in.');
        notify({ key: 'check-second', message: 'Replacement notification', tone: 'info' });
        await rendered();
        assert(host.querySelectorAll('.app-toast').length === 1, 'A replacement must remove the earlier toast immediately.');
        assert(!host.querySelector('.toast-enter-active,.toast-leave-active'), 'A replacement must skip in/out transitions.');
        await until(() => host.querySelector('.toast-leave-active'));
        assert(host.matches(':popover-open'), 'The container must stay visible during the exit animation.');
        notify({ key: 'check-third', message: 'Final notification', tone: 'success' });
        await rendered();
        assert(host.querySelectorAll('.app-toast').length === 1, 'New messages must also replace a toast already fading out.');
        assert(host.textContent?.includes('Final notification'), 'The newest message must be visible immediately.');
        assert(!host.querySelector('.toast-enter-active,.toast-leave-active'), 'An interrupted exit must not animate the replacement.');
        await until(() => host.querySelector('.toast-leave-active'));
        assert(host.matches(':popover-open'), 'The final exit animation must stay visible.');
        await until(() => !host.matches(':popover-open'));
        assert(!host.querySelector('.app-toast'), 'Expired messages must not reappear after the last toast.');
        checkResult.value = 'PASS: entrance, immediate replacement, interrupted exit, and two-second dismissal.';
      } catch (cause) {
        checkResult.value = `FAIL: ${cause instanceof Error ? cause.message : String(cause)}`;
      } finally { checking.value = false; }
    }
    return () => h('main', { style: 'padding:24px;color:#d1fae5;font-family:system-ui;max-width:750px' }, [
      h(AppToaster),
      h('h1', ['Hints and notifications', h(InfoHint, { label: 'Local files', text: 'Files stay on this device. Operation results appear as desktop notifications.' })]),
      h('button', { class: 'btn', onClick: () => notify({ key: 'fixture-save', message: 'Changes saved.', tone: 'success' }) }, 'Save changes'),
      h('button', { class: 'btn', onClick: () => notify({ message: 'Connection unavailable. Retry when ready.', tone: 'error', action: { label: 'Retry', run: () => { retries.value++; notify({ message: 'Retry succeeded.', tone: 'success' }); } } }) }, 'Simulate failure'),
      h('button', { class: 'btn', onClick: () => dialog.value?.showModal() }, 'Open dialog'),
      h('button', { class: 'btn', disabled: checking.value, onClick: checkTransitions }, 'Check toast transitions'),
      h('p', { role: 'status', 'data-testid': 'toast-check-result' }, checkResult.value),
      h('p', `Completed retries: ${retries.value}`),
      h('dialog', { ref: dialog, style: 'padding:24px;background:#091c24;color:#d1fae5;border:1px solid #28534e' }, [
        h('h2', ['Operation in a dialog', h(InfoHint, { label: 'Notifications in dialogs', text: 'A desktop notification and its retry action remain accessible while this dialog is open.' })]),
        h('button', { class: 'btn', onClick: () => notify({ message: 'Dialog operation failed.', tone: 'error', action: { label: 'Retry dialog operation', run: () => { retries.value++; notify({ message: 'Dialog operation succeeded.', tone: 'success' }); } } }) }, 'Fail dialog operation'),
        h('button', { class: 'btn', onClick: () => dialog.value?.close() }, 'Close dialog'),
      ]),
    ]);
  },
}).mount('#app');
