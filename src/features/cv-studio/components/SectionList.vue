<script setup lang="ts">
import { DEFAULT_SECTION_HEADER_SIZE } from '../../../documents/cv/defaults';
import type { PropType } from 'vue';
import type { CvItem, ItemField } from '../../../documents/cv/types';
import { computed, inject, nextTick, ref, useId, watch } from 'vue';
import SectionItems from './SectionItems.vue';
import CvSectionFrame from './CvSectionFrame.vue';
import { makeT } from '../../../i18n/dict.ts';
import { createContentId } from '../../../documents/layout/contentLayout.ts';
import MarkdownTextarea from '../../../documents/cv/components/MarkdownTextarea.vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import PrivacyField from '../../../documents/privacy/components/PrivacyField.vue';
import { PRIVACY_EDITOR } from '../../../documents/privacy/composables/privacyEditorContext';
import ConfirmDeletionDialog from '../../../shared/ui/ConfirmDeletionDialog.vue';

const props = defineProps({
  title: String,
  sectionKey: String,
  lang: { type: String, required: true },
  modelValue: { type: Array as PropType<CvItem[]>, required: true },
  schema: { type: Array as PropType<ItemField[]>, required: true },
  addLabel: { type: String, default: 'Hinzufügen' },
  toggleable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
  completed: { type: Boolean, default: false },
  showKeepTogether: { type: Boolean, default: false },
  keepTogether: { type: Boolean, default: false },
  isCollapsed: { type: Boolean, default: false },
  editableTitle: { type: Boolean, default: false },
  isEditingTitle: { type: Boolean, default: false },
  editingTitleValue: { type: String, default: '' },
  titlePlaceholder: { type: String, default: '' },
  headerSize: { type: String, default: DEFAULT_SECTION_HEADER_SIZE },
  versionMode: { type: Boolean, default: false },
  privacyMode: { type: Boolean, default: false },
  todosMode: { type: Boolean, default: false },
  configMode: { type: Boolean, default: false },
  reorderMode: { type: Boolean, default: false },
});

const emit = defineEmits<{
  'update:modelValue': [items: CvItem[]];
  'toggle-section': []; 'toggle-complete': []; 'toggle-collapse': [];
  'toggle-keep-together': [];
  'start-edit-title': []; 'finish-edit-title': []; 'cancel-edit-title': [];
  'update-editing-value': [value: string]; 'header-size-change': [size: string];
}>();

const privacyEditor = inject(PRIVACY_EDITOR, null);
const visibilityLocked = (id: string) => Boolean(props.privacyMode && privacyEditor?.hiddenInContent(id));
const langRef = computed(() => props.lang);
const t = makeT(langRef);
const root = ref<HTMLElement | null>(null);
const frame = ref<InstanceType<typeof CvSectionFrame> | null>(null);
watch(frame, value => { root.value = value?.getElement() || null; }, { flush: 'post' });
const contentId = `section-content-${useId()}`;
const pendingDeleteIndex = ref<number | null>(null);
watch(() => props.configMode, () => { pendingDeleteIndex.value = null; });
const items = computed({
  get: () => Array.isArray(props.modelValue) ? props.modelValue : [],
  set: (value) => emit('update:modelValue', value),
});
const inlineFields = computed(() => props.schema.filter((field) => field.type !== 'textarea'));
const textareaFields = computed(() => props.schema.filter((field) => field.type === 'textarea'));
const add = () => {
  const entry: CvItem = { id: createContentId(props.sectionKey || 'entry'), hidden: false };
  props.schema.forEach((field) => {
    if (field.type === 'number') entry[field.key] = 0;
    else if (field.type === 'select' && field.key === 'state') return;
    else if (field.type === 'select') entry[field.key] = field.options[0]?.value ?? '';
    else entry[field.key] = '';
  });
  items.value = [...items.value, entry];
  nextTick(() => {
    const row = root.value?.querySelector('.item-row:last-of-type');
    row?.querySelector<HTMLElement>('input, textarea, [role="combobox"]')?.focus();
    row?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  });
};

function updateItemState(item: CvItem, value: unknown) {
  if (value === 'planned' || value === 'ongoing' || value === 'complete') item.state = value;
  else delete item.state;
}

const removeAt = (index: number) => {
  items.value = items.value.filter((_, itemIndex) => itemIndex !== index);
};
const requestRemoveAt = (index: number) => { pendingDeleteIndex.value = index; };
const confirmRemoveAt = () => {
  if (pendingDeleteIndex.value !== null) removeAt(pendingDeleteIndex.value);
  pendingDeleteIndex.value = null;
};
const finishTitleEdit = (cancel = false) => {
  if (cancel) emit('cancel-edit-title');
  else emit('finish-edit-title');
  nextTick(() => root.value?.querySelector<HTMLButtonElement>('.section-heading-button')?.focus());
};

</script>

<template>
  <CvSectionFrame ref="frame" :data-section="sectionKey" :content-id="contentId" :lang="lang" :title="title"
    :disabled="disabled" :completed="completed" :collapsed="isCollapsed" :toggleable="toggleable"
    :visibility-locked="visibilityLocked(sectionKey || '')" :header-size="headerSize"
    :keep-together="showKeepTogether ? keepTogether : undefined"
    :modes="{ config: configMode, reorder: reorderMode, versions: versionMode, todos: todosMode }"
    :title-editor="{ editable: editableTitle, editing: isEditingTitle, value: editingTitleValue, placeholder: titlePlaceholder }"
    @toggle-section="emit('toggle-section')" @toggle-collapse="emit('toggle-collapse')" @toggle-complete="emit('toggle-complete')"
    @toggle-keep-together="emit('toggle-keep-together')" @start-edit-title="emit('start-edit-title')"
    @finish-edit-title="$event ? finishTitleEdit() : emit('finish-edit-title')" @cancel-edit-title="finishTitleEdit(true)"
    @update-editing-value="emit('update-editing-value', $event)" @header-size-change="emit('header-size-change', $event)">
    <template #before-header>
      <ConfirmDeletionDialog
        :visible="pendingDeleteIndex !== null"
        :title="t('confirmDeletion')"
        :message="t('confirmDeleteItem')"
        :cancel-label="t('cancel')"
        :confirm-label="t('delete')"
        @cancel="pendingDeleteIndex = null"
        @confirm="confirmRemoveAt"
      />
    </template>
    <template v-if="$slots.heading" #heading="{ controls }"><slot name="heading" :controls="controls" /></template>
    <template #section-version><slot name="section-version" /></template>
    <SectionItems v-model="items" :lang="lang" :reorder-mode="reorderMode">
      <template #default="{ item, index }">
        <div class="item-row__actions">
          <button class="mini visibility-toggle" :class="item.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="item.hidden ? t('show') : t('hide')" :title="item.hidden ? t('show') : t('hide')" :disabled="visibilityLocked(item.id)" @click="item.hidden = !item.hidden"><font-awesome-icon :icon="['fas', item.hidden ? 'eye-slash' : 'eye']" /></button>
          <button v-if="configMode" type="button" class="mini btn--danger" :aria-label="t('remove')" :title="t('remove')" @click="requestRemoveAt(index)"><font-awesome-icon :icon="['fas', 'trash']" /></button>
        </div>
        <div class="item-row__content">
          <div v-if="inlineFields.length" :class="['row', schema.length === 2 ? 'row-2' : '', schema.length === 3 ? 'row-3' : '', schema.length === 4 ? 'row-4' : '']">
            <PrivacyField :owner="item" :field="field.key" v-for="field in inlineFields" :key="field.key" v-slot="{ disabled }"><label>
              {{ field.label }}
              <InputText :disabled="disabled" v-if="field.type === 'text'" v-model="item[field.key]" :placeholder="field.placeholder || ''" fluid />
              <InputNumber :disabled="disabled" v-else-if="field.type === 'number'" :model-value="item[field.key]" @update:model-value="item[field.key] = $event ?? 0" :placeholder="field.placeholder || ''" :use-grouping="false" fluid />
              <Select :disabled="disabled" v-else-if="field.type === 'select' && field.key === 'state'" :model-value="item.state || ''" :options="field.options" option-label="label" option-value="value" :aria-label="field.label" fluid @update:model-value="updateItemState(item, $event)" />
              <Select :disabled="disabled" v-else-if="field.type === 'select'" v-model="item[field.key]" :options="field.options" option-label="label" option-value="value" :aria-label="field.label" fluid /></label></PrivacyField>
          </div>
          <PrivacyField :owner="item" :field="field.key" v-for="field in textareaFields" :key="field.key" v-slot="{ disabled }"><div class="markdown-field"><div class="hint-label-row"><label :for="`${contentId}-${item.id}-${field.key}`">{{ field.label }}</label><InfoHint :id="`${contentId}-${item.id}-${field.key}-help`" :lang="lang" :label="field.label" :text="t('markdownTextareaHelp')" /></div>
            <MarkdownTextarea :id="`${contentId}-${item.id}-${field.key}`" :disabled="disabled" v-model="item[field.key]" :placeholder="field.placeholder || ''" :aria-label="field.label" :aria-describedby="`${contentId}-${item.id}-${field.key}-help`" /></div></PrivacyField>
        </div>
      </template>
    </SectionItems>
    <button v-if="addLabel && !reorderMode" type="button" class="add-item-row" @click="add"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ addLabel }}</button>
  </CvSectionFrame>
</template>
