import { getCurrentScope, onScopeDispose, readonly, shallowRef, watch } from 'vue';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';
export interface ToastOptions {
  tone?: ToastTone;
  key?: string;
  /** Background progress must not replace another operation's result or recovery action. */
  passive?: boolean;
  action?: { label: string; run: () => unknown | Promise<unknown> };
}
export interface Toast extends ToastOptions {
  id: number;
  revision: number;
  message: string;
  tone: ToastTone;
  duration: number;
}
type Lifetime = { timer?: ReturnType<typeof setTimeout>; started: number; remaining: number; pauses: Set<string> };

const toasts = shallowRef<Toast[]>([]);
const lifetimes = new Map<number, Lifetime>();
const TOAST_DURATION_MS = 2000;
let sequence = 0;

function dismiss(id: number) {
  clearTimeout(lifetimes.get(id)?.timer);
  lifetimes.delete(id);
  toasts.value = toasts.value.filter(toast => toast.id !== id);
}
function startTimer(id: number, lifetime: Lifetime) {
  if (!lifetime.remaining || lifetime.pauses.size) return;
  lifetime.started = Date.now();
  lifetime.timer = setTimeout(() => dismiss(id), lifetime.remaining);
  // Notifications must not keep a non-browser test process alive.
  if (typeof lifetime.timer === 'object') lifetime.timer.unref?.();
}
function notify(input: ToastOptions & { message: string }): number {
  const message = input.message.trim();
  if (!message) return 0;
  const tone = input.tone || 'info';
  if (input.passive && toasts.value.some(toast => !toast.passive && (!input.key || toast.key !== input.key))) return 0;
  const existing = toasts.value.find(toast => input.key ? toast.key === input.key : !toast.key && toast.message === message && toast.tone === tone);
  const id = existing?.id || ++sequence;
  const duration = TOAST_DURATION_MS;
  const pauses = lifetimes.get(id)?.pauses || new Set<string>();
  for (const toast of toasts.value) {
    clearTimeout(lifetimes.get(toast.id)?.timer);
    lifetimes.delete(toast.id);
  }
  const toast: Toast = { ...input, id, revision: (existing?.revision || 0) + 1, message, tone, duration };
  const lifetime = { remaining: duration, started: Date.now(), pauses };
  lifetimes.set(id, lifetime);
  toasts.value = [toast];
  startTimer(id, lifetime);
  return id;
}
function pause(id: number, reason = 'pointer') {
  const lifetime = lifetimes.get(id);
  if (!lifetime || lifetime.pauses.has(reason)) return;
  if (!lifetime.pauses.size && lifetime.timer) {
    clearTimeout(lifetime.timer);
    lifetime.timer = undefined;
    lifetime.remaining = Math.max(1, lifetime.remaining - (Date.now() - lifetime.started));
  }
  lifetime.pauses.add(reason);
}
function resume(id: number, reason = 'pointer') {
  const lifetime = lifetimes.get(id);
  if (!lifetime || !lifetime.pauses.delete(reason) || lifetime.pauses.size) return;
  startTimer(id, lifetime);
}
function clear() { for (const toast of toasts.value) dismiss(toast.id); }

export function useToasts() { return { toasts: readonly(toasts), notify, dismiss, pause, resume, clear }; }

/** Announce each operation result once, including repeated attempts with the same result. */
export function useToastWatch(source: () => string | null | undefined, options: ToastOptions | (() => ToastOptions) = {}, scheduling: { flush?: 'pre' | 'post' | 'sync' } = {}) {
  const key = `notice-${++sequence}`;
  let id = 0;
  const stop = watch(source, message => {
    if (!message?.trim()) { if (id) dismiss(id); return; }
    const settings = typeof options === 'function' ? options() : options;
    id = notify({ ...settings, key: settings.key || key, message });
  }, { immediate: true, flush: scheduling.flush ?? 'sync' });
  if (getCurrentScope()) onScopeDispose(() => {
    stop();
    // A retry cannot safely call a component after its document/account has closed.
    if (toasts.value.find(toast => toast.id === id)?.action) dismiss(id);
  });
  return stop;
}

type SaveState = 'unsaved' | 'saving' | 'saved' | 'error';
interface SaveStateToastOptions {
  scope: () => string | null;
  active?: () => boolean;
  messages: { saving: () => string; saved: () => string; error: () => string };
  retry?: { label: () => string; run: () => unknown | Promise<unknown> };
}

/** Report committed saves without announcing typing or an already-saved record on open. */
export function useSaveStateToast(source: () => SaveState, options: SaveStateToastOptions) {
  const key = `save-${++sequence}`;
  let id = 0;
  let revision = 0;
  let disposed = false;
  let announced: SaveState | null = null;
  function clearPending() {
    revision++;
    if (id && announced !== 'saved') dismiss(id);
    id = 0;
    announced = null;
  }
  const stop = watch(
    () => [options.scope(), options.active?.() ?? true, source(), options.messages.error()] as const,
    ([scope, active, status, error], previous) => {
      const changedScope = scope !== previous?.[0] || active !== previous?.[1];
      if (changedScope) clearPending();
      if (!scope || !active) return;
      if (status === 'unsaved') { clearPending(); return; }
      if (status === 'saved' && (changedScope || previous?.[2] !== 'saving')) { clearPending(); return; }
      if (!changedScope && status === previous?.[2] && (status !== 'error' || error === previous[3])) return;
      announced = status;
      const attempt = ++revision;
      id = notify({
        key,
        message: status === 'error' ? error : options.messages[status](),
        tone: status === 'error' ? 'error' : status === 'saving' ? 'info' : 'success',
        passive: status === 'saving',
        ...(status === 'error' && options.retry ? { action: { label: options.retry.label(), run: () => {
          if (disposed || attempt !== revision || options.scope() !== scope || !(options.active?.() ?? true) || source() !== 'error') return true;
          return options.retry!.run();
        } } } : {}),
      });
    },
    { immediate: true, flush: 'sync' },
  );
  const dispose = () => { disposed = true; stop(); clearPending(); };
  if (getCurrentScope()) onScopeDispose(dispose);
  return dispose;
}
