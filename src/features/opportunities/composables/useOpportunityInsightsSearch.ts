import { computed, onScopeDispose, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listCloudSearchTemplates } from '../../meta-search/data/searchTemplateCloud';
import { requireSearchTaskScope } from '../../meta-search/domain/adaptiveSearchTask';

interface OpportunityInsightsSearchOptions {
  ownerId(): string;
  client(): SupabaseClient | null;
  projectRef(): string | undefined;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const project = /^[a-z0-9]{20}$/u;

/** Optional saved-search identity for qualitative feedback. Never loads run history or dashboard data. */
export function useOpportunityInsightsSearch(options: OpportunityInsightsSearchOptions) {
  const searchId = ref<string | null>(null);
  const hasSavedSearch = computed(() => searchId.value !== null);
  const loading = ref(false);
  const error = ref('');
  let generation = 0;
  let disposed = false;

  async function refresh(): Promise<boolean> {
    if (disposed) return false;
    const token = ++generation;
    const ownerId = options.ownerId(), client = options.client(), projectRef = options.projectRef();
    const current = () => !disposed && token === generation && ownerId === options.ownerId()
      && client === options.client() && projectRef === options.projectRef();
    searchId.value = null;
    error.value = '';
    loading.value = false;
    if (!client || !uuid.test(ownerId) || !projectRef || !project.test(projectRef)) return false;
    loading.value = true;
    try {
      const templates = await listCloudSearchTemplates(client, ownerId);
      if (!current()) return false;
      const template = templates[0];
      if (!template) return true;
      const scope = requireSearchTaskScope(template.id, projectRef);
      searchId.value = scope.searchId;
      return true;
    } catch {
      if (current()) error.value = 'Saved search context could not be loaded. Retry loading it.';
      return false;
    } finally {
      if (current()) loading.value = false;
    }
  }

  watch([options.ownerId, options.client, options.projectRef], () => { void refresh(); }, { immediate: true, flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    generation++;
    searchId.value = null;
    loading.value = false;
    error.value = '';
  });
  return { searchId, hasSavedSearch, loading, error, refresh };
}
