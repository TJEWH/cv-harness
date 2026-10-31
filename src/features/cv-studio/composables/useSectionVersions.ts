import type { CvState, SavedConfiguration, SaveStatus, ContentArea } from '../../../documents/cv/types';
interface SectionVersionsOptions {
  state(): CvState; selectedId(): string; configurations(): SavedConfiguration[];
  readVersion(id: string): CvState | null | undefined;
  saveVersion(id: string, data: CvState): boolean;
  onStatus(status: SaveStatus): void;
}
import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { createNormalizedContentState } from '../../../documents/layout/contentLayout.ts';
import { readCvState } from '../../../documents/cv/domain/cvStateValidation';
import { debounce } from '../../../documents/cv/data/cvStorage.ts';
import { isBuiltinDocument } from '../domain/builtinConfigurations';

const builtInSections = ['header', 'about', 'education', 'jobs', 'languages', 'hobbies'];

export function hasContentSection(state: CvState, key: string) {
  if (builtInSections.includes(key)) return true;
  return [...(state.customSections || []), ...(state.sidebarSections || [])].some((section) => section.id === key);
}

// Alternate versions are separate reactive documents. Only the active document
// is observed by the app's preview; editing another document saves it in place.
export function useSectionVersions({ state, selectedId, configurations: allConfigurations, readVersion, saveVersion, onStatus }: SectionVersionsOptions) {
  const configurations = () => allConfigurations().filter(({ id }) => !isBuiltinDocument(id));
  const enabled = ref(false);
  const selections = reactive<Record<string, string>>({});
  const records = new Map<string, { data: CvState; stop: () => void }>();
  const revision = ref(0);
  const dirty = new Set<string>();

  function flush() {
    saveLater.cancel();
    discardDeletedRecords();
    for (const id of [...dirty]) {
      const record = records.get(id);
      if (!record) continue;
      if (saveVersion(id, JSON.parse(JSON.stringify(record.data)))) dirty.delete(id);
    }
    onStatus(dirty.size ? 'error' : 'saved');
    return dirty.size === 0;
  }
  const saveLater = debounce(flush, 250);

  function discardDeletedRecords() {
    const available = new Set(configurations().map(({ id }) => id));
    for (const [id, record] of records) {
      if (!available.has(id)) {
        record.stop();
        records.delete(id);
        dirty.delete(id);
        for (const key of Object.keys(selections)) if (selections[key] === id) delete selections[key];
      }
    }
  }

  function refresh() {
    discardDeletedRecords();
    revision.value += 1;
    if (!enabled.value) return;
    for (const { id } of configurations()) {
      if (id === selectedId() || records.has(id)) continue;
      const saved = readVersion(id);
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
      const data = createNormalizedContentState(readCvState(JSON.parse(JSON.stringify(saved))));
      const document = reactive(data);
      const stop = watch(document, () => {
        dirty.add(id);
        onStatus('saving');
        saveLater();
      }, { deep: true, flush: 'sync' });
      records.set(id, { data: document, stop });
    }
    revision.value += 1;
  }

  const sources = computed(() => {
    revision.value;
    const current = { id: selectedId(), data: state() };
    if (!enabled.value) return [current];
    return [current, ...configurations().filter(({ id }) => id !== current.id && records.has(id))
      .map(({ id }) => ({ id, data: records.get(id)!.data }))];
  });
  const options = (key: string) => sources.value.filter(({ id, data }) => !isBuiltinDocument(id) && hasContentSection(data, key)).map(({ id }) => ({
    id,
    name: configurations().find((item) => item.id === id)?.name || '',
  }));
  const versionId = (key: string) => {
    const available = options(key);
    return available.some(({ id }) => id === selections[key]) ? selections[key] : available[0]?.id;
  };
  const sectionState = (key: string) => sources.value.find(({ id }) => id === versionId(key))?.data || state();
  const select = (key: string, id: string) => {
    if (options(key).some((option) => option.id === id)) selections[key] = id;
  };
  const order = (area: ContentArea) => [...new Set(sources.value.flatMap(({ data }) => data[`${area}Order`] || []))];

  function reset() {
    if (!flush()) return false;
    enabled.value = false;
    for (const record of records.values()) record.stop();
    records.clear();
    for (const key of Object.keys(selections)) delete selections[key];
    revision.value += 1;
    return true;
  }

  watch(enabled, (value) => value ? refresh() : flush(), { flush: 'sync' });
  watch(() => configurations().map(({ id }) => id).join('\n'), refresh, { flush: 'sync' });
  watch(selectedId, () => { reset(); }, { flush: 'sync' });
  onScopeDispose(() => {
    flush();
    for (const record of records.values()) record.stop();
  });

  return { enabled, options, versionId, sectionState, select, order, flush, reset };
}
