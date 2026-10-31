import { onScopeDispose, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchTemplate } from '../searchTypes';
import { createSearchTemplateRepository, searchTemplateStorageKey, type StorageAdapter } from '../data/searchTemplateRepository';
import { importCloudSearchTemplate, listCloudSearchTemplates } from '../data/searchTemplateCloud';
import { isSearchTemplateSaved } from '../domain/searchPrompts';

interface SharedSearchSourceOptions {
  owner(): string;
  client(): SupabaseClient | null | undefined;
  storage(): StorageAdapter;
}
interface SharedSearchLoadOptions {
  /** Refresh a hydrated cloud source; committed local content still wins. */
  refreshCloud?: boolean;
  /** Permit an acknowledged local source to refresh from its exact cloud row. */
  refreshSavedLocal?: boolean;
}
interface PendingRead {
  raw: string | null;
  promise: Promise<void>;
}

/** Read available search intent without changing local storage or application snapshots. */
export function useSharedSearchSource(options: SharedSearchSourceOptions) {
  const templates = ref<SearchTemplate[]>([]);
  const loading = ref(false);
  const status = ref<'loading' | 'ready' | 'empty' | 'error'>('empty');
  const error = ref('');
  let generation = 0;
  let hydrated = false;
  let disposed = false;
  let pending: PendingRead | null = null;

  function ready() {
    loading.value = false;
    status.value = templates.value[0]?.researchInterests ? 'ready' : 'empty';
    error.value = '';
  }
  function fail(reason: unknown) {
    loading.value = false;
    status.value = 'error';
    error.value = reason instanceof Error ? reason.message : 'Shared research interests could not be loaded.';
  }
  function reset() {
    generation++;
    hydrated = false;
    pending = null;
    templates.value = [];
    loading.value = false;
    status.value = 'empty';
    error.value = '';
  }
  watch([options.owner, options.client], reset, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; reset(); });

  function readLocal(owner: string) {
    const storage = options.storage();
    const raw = storage.getItem(searchTemplateStorageKey(owner));
    if (pending && pending.raw !== raw) pending = null;
    if (raw !== null) templates.value = createSearchTemplateRepository(storage, owner).listTemplates();
    else if (!hydrated) templates.value = [];
    if (!pending) ready();
    return raw;
  }
  function reloadLocal() {
    if (disposed) return;
    try { readLocal(options.owner()); }
    catch (reason) { pending = null; fail(reason); throw reason; }
  }

  function load(settings: SharedSearchLoadOptions = {}): Promise<void> {
    if (disposed) return Promise.resolve();
    const owner = options.owner();
    const client = options.client();
    const token = generation;
    const currentScope = () => !disposed && token === generation && owner === options.owner() && client === options.client();
    try {
      const raw = readLocal(owner);
      const local = templates.value[0];
      if (!client || !owner || owner === 'local'
        || raw !== null && (!settings.refreshSavedLocal || !local || !isSearchTemplateSaved(local))
        || hydrated && !settings.refreshCloud) return Promise.resolve();
      if (pending) return pending.promise;

      // Preview refreshes prefer the shared row; explicit application refreshes
      // retain the source's exact binding, including a cached cloud-only source.
      const boundId = settings.refreshSavedLocal ? local?.cloud?.id : undefined;
      loading.value = true;
      status.value = 'loading';
      error.value = '';
      let request: PendingRead;
      const current = () => currentScope() && pending === request;
      const promise = (async () => {
        try {
          const rows = await listCloudSearchTemplates(client, owner);
          if (!current()) return;
          // A commit in another editor/tab wins even if no update event arrived.
          if (options.storage().getItem(searchTemplateStorageKey(owner)) !== raw) { reloadLocal(); return; }
          const row = boundId ? rows.find(item => item.id === boundId) : rows.find(item => item.meta_search?.version === 1) || rows[0];
          templates.value = row ? [importCloudSearchTemplate(row)] : [];
          hydrated = true;
          ready();
        } catch (reason) {
          if (!current()) return;
          // A failed older cloud read must not hide newly committed local intent.
          try {
            if (options.storage().getItem(searchTemplateStorageKey(owner)) !== raw) { reloadLocal(); return; }
          } catch (storageError) { reason = storageError; }
          fail(reason);
          throw reason;
        } finally {
          if (current()) { pending = null; loading.value = false; }
        }
      })();
      request = { raw, promise };
      pending = request;
      return promise;
    } catch (reason) {
      if (!currentScope()) return Promise.resolve();
      pending = null;
      fail(reason);
      return Promise.reject(reason);
    }
  }

  return { templates, loading, status, error, reloadLocal, load };
}
