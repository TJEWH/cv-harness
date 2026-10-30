import { computed, onScopeDispose, reactive, shallowRef, watch } from 'vue';

interface NotesApplication { id: string; notes?: string | null }
type NotesDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface NotesAutosaveOptions {
  application(): NotesApplication | undefined | null;
  save(id: string, notes: string): Promise<boolean>;
  busy?(): boolean;
  owner?(): string;
  errorMessage?(): string;
  storage?: NotesDraftStorage | null;
  storagePrefix?: string;
  maxLength?: number;
  /** Optional one-time composition of existing saved and recoverable editor text. */
  initialDraft?(saved: string, recovery: string | undefined): string;
}
interface NotesDraft {
  id: string;
  recoveryKey: string;
  state: { value: string; saved: string; error: string; saving: boolean; cancelled: boolean };
  pending: Promise<boolean> | null;
  pendingValue: string | null;
}

/** Keeps recoverable drafts local until blur, Enter, or navigation requests a commit. */
export function useApplicationNotesAutosave(options: NotesAutosaveOptions) {
  const selected = shallowRef<NotesDraft | null>(null);
  const drafts = new Map<string, NotesDraft>();
  let queue: Promise<unknown> = Promise.resolve();
  let activeOwner = options.owner?.() || '';
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = typeof localStorage === 'undefined' ? null : localStorage; } catch { storage = null; }
  }

  function recoveryValue(key: string): string | undefined {
    try {
      const value = JSON.parse(storage?.getItem(key) || 'null');
      return value && typeof value.value === 'string' && value.value.length <= (options.maxLength ?? 20_000) ? value.value : undefined;
    } catch { return undefined; }
  }

  function preserveRecovery(draft: NotesDraft) {
    try { storage?.setItem(draft.recoveryKey, JSON.stringify({ value: draft.state.value })); } catch { /* Cloud saving remains available without local storage. */ }
  }

  function clearRecovery(draft: NotesDraft, saved: string) {
    try {
      // An older request must not clear a newer draft, including one from another tab.
      if (recoveryValue(draft.recoveryKey) === saved) storage?.removeItem(draft.recoveryKey);
    } catch { /* Optional local recovery. */ }
  }

  function waitUntilIdle(draft: NotesDraft): Promise<boolean> {
    if (draft.state.cancelled || !options.busy?.()) return Promise.resolve(!draft.state.cancelled);
    return new Promise(resolve => {
      const stop = watch([() => options.busy?.(), () => draft.state.cancelled], ([busy, cancelled]) => {
        if (busy && !cancelled) return;
        stop();
        resolve(!cancelled);
      }, { flush: 'sync' });
    });
  }

  function flushDraft(draft: NotesDraft): Promise<boolean> {
    if (draft.state.cancelled) return Promise.resolve(false);
    const snapshot = draft.state.value;
    if (draft.pending && draft.pendingValue === snapshot) return draft.pending;
    if (!draft.pending && snapshot === draft.state.saved) return Promise.resolve(true);
    draft.state.saving = true;
    draft.state.error = '';
    const pending = queue.then(async () => {
      if (!await waitUntilIdle(draft) || draft.state.cancelled) return false;
      try {
        if (snapshot !== draft.state.saved) {
          const saved = await options.save(draft.id, snapshot);
          if (draft.state.cancelled) return false;
          if (!saved) throw new Error(options.errorMessage?.() || 'Could not save notes. Please retry.');
          draft.state.saved = snapshot;
          clearRecovery(draft, snapshot);
        }
        draft.state.error = '';
        // New typing is a separate draft; do not send it without another commit.
        return draft.state.value === draft.state.saved;
      } catch (error) {
        if (!draft.state.cancelled) draft.state.error = error instanceof Error ? error.message : options.errorMessage?.() || 'Could not save notes. Please retry.';
        return false;
      }
    }).finally(() => {
      if (draft.pending === pending) {
        draft.pending = null;
        draft.pendingValue = null;
        draft.state.saving = false;
      }
    });
    draft.pending = pending;
    draft.pendingValue = snapshot;
    queue = pending;
    return pending;
  }

  const notes = computed({
    get: () => selected.value?.state.value || '',
    set: (value: string) => {
      const draft = selected.value;
      if (!draft || value === draft.state.value) return;
      const previousValue = draft.state.value;
      draft.state.value = value;
      draft.state.error = '';
      if (value !== draft.state.saved || draft.pending) preserveRecovery(draft);
      else clearRecovery(draft, previousValue);
    },
  });
  const dirty = computed(() => !!selected.value && selected.value.state.value !== selected.value.state.saved);
  const error = computed(() => selected.value?.state.error || '');
  const status = computed<'saved' | 'saving' | 'unsaved' | 'error'>(() => error.value ? 'error' : selected.value?.state.saving ? 'saving' : dirty.value ? 'unsaved' : 'saved');
  const flush = () => selected.value ? flushDraft(selected.value) : Promise.resolve(true);

  watch(() => {
    const application = options.application();
    return [options.owner?.() || '', application?.id, application?.notes || ''] as const;
  }, ([owner, id, saved]) => {
    const previous = selected.value;
    if (activeOwner !== owner) {
      for (const draft of drafts.values()) draft.state.cancelled = true;
      drafts.clear();
      activeOwner = owner;
    } else if (previous && previous.id !== id) {
      void flushDraft(previous);
    }
    if (!id) { selected.value = null; return; }
    let draft = drafts.get(id);
    if (!draft) {
      const recoveryKey = `${options.storagePrefix ?? 'CV_APPLICATION_NOTES_DRAFT'}:${encodeURIComponent(owner)}:${encodeURIComponent(id)}`;
      const recovery = recoveryValue(recoveryKey);
      const value = options.initialDraft?.(saved, recovery) ?? recovery ?? saved;
      draft = { id, recoveryKey, state: reactive({ value, saved, error: '', saving: false, cancelled: false }), pending: null, pendingValue: null };
      drafts.set(id, draft);
      if (value === saved) clearRecovery(draft, saved);
    } else if (!draft.pending && draft.state.value === draft.state.saved) {
      draft.state.value = draft.state.saved = saved;
    }
    selected.value = draft;
  }, { immediate: true, flush: 'sync' });

  onScopeDispose(() => {
    for (const draft of drafts.values()) void flushDraft(draft);
  });

  return { notes, dirty, status, error, flush };
}
