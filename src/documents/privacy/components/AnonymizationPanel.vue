<script setup lang="ts">
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { FIELD_PRIVACY_TYPES, type CvState, type FieldPrivacyType } from '../../cv/types';
import { makeT } from '../../../i18n/dict';
import FormBuilder from '../../../features/cv-studio/components/FormBuilder.vue';
import { applyPrivacyEditorChanges, createPrivacyEditorState, privacyFieldEntries } from '../domain/privacyOverrides';
import { automaticMaskForField } from '../domain/privacyEditorMasking';
import { PRIVACY_EDITOR } from '../composables/privacyEditorContext';
import { usePreviewInputCommit } from '../../pdf/composables/usePreviewInputCommit';
import { CV_TEXTAREA_COMMIT } from '../../cv/composables/cvTextareaCommit';

const props = defineProps<{ state: CvState; lang: string }>();
const emit = defineEmits<{ commit: [] }>();
const t = makeT(computed(() => props.lang));
const draft = ref(createPrivacyEditorState(props.state));
let refreshing = false;
let saving = false;
let dirty = false;
const inputCommit = usePreviewInputCommit(commitDraft);
const commitParentTextarea = inject(CV_TEXTAREA_COMMIT, () => {});
provide(CV_TEXTAREA_COMMIT, () => {
  flushDraft();
  commitParentTextarea();
});
function commitDraft() {
  if (refreshing) return;
  inputCommit.reset();
  dirty = false;
  saving = true;
  let changed = false;
  try { changed = applyPrivacyEditorChanges(props.state, draft.value); }
  finally { saving = false; }
  if (changed) emit('commit');
}
function onDraftFieldChange() {
  if (refreshing) return;
  dirty = true;
  if (!inputCommit.defer()) commitDraft();
}
function flushDraft() { if (dirty) commitDraft(); }
onMounted(() => { if (typeof window !== 'undefined') window.addEventListener('pagehide', flushDraft); });
onBeforeUnmount(() => {
  flushDraft();
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushDraft);
});
watch(() => props.state, () => {
  if (saving) return;
  inputCommit.reset();
  dirty = false;
  refreshing = true;
  try { draft.value = createPrivacyEditorState(props.state); }
  finally { refreshing = false; }
}, { deep: true, flush: 'sync' });
const originals = computed(() => new Map(privacyFieldEntries(props.state).map(entry => [entry.key, entry])));
const hiddenContentIds = computed(() => new Set([
  ...props.state.disabled,
  ...[...originals.value.values()].filter(entry => Reflect.get(entry.owner, 'hidden'))
    .map(entry => Reflect.get(entry.owner, 'id')).filter((id): id is string => typeof id === 'string'),
]));
const draftFields = shallowRef(new WeakMap<object, Map<string, string>>());
const draftOwners = shallowRef<object[]>([]);
// Reindex only when the draft is replaced, never when an individual value changes.
watch(draft, value => {
  const owners = new WeakMap<object, Map<string, string>>();
  const entries = privacyFieldEntries(value);
  for (const entry of entries) {
    if (!owners.has(entry.owner)) owners.set(entry.owner, new Map());
    owners.get(entry.owner)!.set(entry.field, entry.key);
  }
  draftFields.value = owners;
  draftOwners.value = [...new Set(entries.map(entry => entry.owner))];
}, { immediate: true, flush: 'sync' });
// Visibility switches commit immediately without observing the draft's text.
watch(() => [draft.value.disabled, ...draftOwners.value.map(owner => Reflect.get(owner, 'hidden'))],
  () => { if (!refreshing) commitDraft(); }, { deep: true, flush: 'sync' });
provide(PRIVACY_EDITOR, {
  language: () => props.lang,
  edited: onDraftFieldChange,
  field(owner, field) {
    const key = draftFields.value.get(owner)?.get(field);
    const original = key && originals.value.get(key);
    if (!original) return;
    return {
      original: original.value,
      automaticMask: automaticMaskForField(props.state, original),
      changed: Object.hasOwn(props.state.anonymization.fieldOverrides || {}, original.key),
      reset() {
        refreshing = true;
        try {
          if (Object.hasOwn(original.owner, field)) Reflect.set(owner, field, Reflect.get(original.owner, field));
          else Reflect.deleteProperty(owner, field);
        } finally { refreshing = false; }
        commitDraft();
      },
    };
  },
  hiddenInContent(id) {
    return hiddenContentIds.value.has(id);
  },
});

const proxyFields = ['institution', 'place', 'dates'] as const;
const proxyFieldLabels = { institution: 'institution', place: 'place', dates: 'privacyDates' };
const maskKeys = (field: FieldPrivacyType): FieldPrivacyType[] =>
  field === 'institution' || field === 'company' ? ['company', 'institution'] : [field];
const isFieldProxyChecked = (field: FieldPrivacyType) =>
  maskKeys(field).every(key => props.state.anonymization.proxyFields?.includes(key));
const isFieldProxyMixed = (field: FieldPrivacyType) => !isFieldProxyChecked(field)
  && maskKeys(field).some(key => props.state.anonymization.proxyFields?.includes(key));
function setFieldProxy(field: FieldPrivacyType, enabled: boolean) {
  flushDraft();
  const fields = new Set(props.state.anonymization.proxyFields || []);
  for (const key of maskKeys(field)) {
    if (enabled) fields.add(key);
    else fields.delete(key);
  }
  props.state.anonymization = { ...props.state.anonymization, proxyFields: FIELD_PRIVACY_TYPES.filter(key => fields.has(key)) };
}
const hasEdits = computed(() => Object.keys(props.state.anonymization.fieldOverrides || {}).length > 0);
function resetEdits() {
  inputCommit.reset();
  dirty = false;
  const { fieldOverrides: _overrides, ...settings } = props.state.anonymization;
  props.state.anonymization = settings;
}
</script>

<template>
  <FormBuilder class="anonymization-panel" :state="draft" privacy-mode :toolbar-visible="false" :read-version="() => null" :save-version="() => false">
    <template #before-tabs>
      <div class="privacy-editor-intro">
        <fieldset class="privacy-automatic">
          <legend>{{ t('privacyAutomaticMasking') }}<InfoHint :lang="state.lang" :label="t('privacyAutomaticMasking')" :text="t('privacyEditorHelp')" /></legend>
          <div class="privacy-automatic__fields">
            <label class="privacy-automatic__header" :title="t('privacyHeaderMaskedHelp')">
              <input type="checkbox" checked disabled :aria-label="t('header')">
              <span>{{ t('header') }}</span>
            </label>
            <label v-for="field in proxyFields" :key="field">
              <input type="checkbox" :checked="isFieldProxyChecked(field)" :indeterminate="isFieldProxyMixed(field)" @change="setFieldProxy(field, ($event.target as HTMLInputElement).checked)">
              <span>{{ t(proxyFieldLabels[field]) }}</span>
            </label>
          </div>
        </fieldset>
        <button v-if="hasEdits" class="btn privacy-reset" type="button" @click="resetEdits">{{ t('privacyResetAll') }}</button>
      </div>
    </template>
  </FormBuilder>
</template>

<style scoped>
.privacy-editor-intro { flex: none; display: grid; gap: 4px; padding-bottom: 12px; }
.privacy-automatic { min-width: 0; margin: 0; padding: 0; border: 0; }
.privacy-automatic legend { padding: 0 0 4px; color: var(--ui-text); font-size: 13px; font-weight: 600; }
.privacy-automatic__fields { display: flex; flex-wrap: wrap; gap: 0 16px; }
.privacy-automatic__fields label { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; color: var(--ui-text); cursor: pointer; white-space: nowrap; }
.privacy-automatic__fields input { flex-shrink: 0; width: 16px; height: 16px; margin: 0; accent-color: var(--ui-accent); }
.privacy-automatic__fields .privacy-automatic__header { cursor: help; }
.privacy-reset { justify-self: start; min-height: 40px; margin-top: 4px; font-size: 13px; }
@media (max-width: 760px), (pointer: coarse) { .privacy-reset { min-height: 44px; } }
</style>
