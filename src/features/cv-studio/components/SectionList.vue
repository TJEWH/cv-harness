<script setup lang="ts">
import { DEFAULT_SECTION_HEADER_SIZE } from '../../../documents/cv/defaults';
import type { PropType } from 'vue';
import type { CvItem, ItemField } from '../../../documents/cv/types';
import { computed, inject, nextTick, ref, useId, watch } from 'vue';
import SectionItems from './SectionItems.vue';
import SectionHeading from '../../../shared/ui/SectionHeading.vue';
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
const contentId = `section-content-${useId()}`;
const pendingDeleteIndex = ref<number | null>(null);
watch(() => props.configMode, () => { pendingDeleteIndex.value = null; });
const items = computed({
  get: () => Array.isArray(props.modelValue) ? props.modelValue : [],
  set: (value) => emit('update:modelValue', value),
});
const inlineFields = computed(() => props.schema.filter((field) => field.type !== 'textarea'));
const textareaFields = computed(() => props.schema.filter((field) => field.type === 'textarea'));
const headerSizeOptions = computed(() => [
  { label: 'H2', value: 'h2' },
  { label: 'H3', value: 'h3' },
  { label: 'H4', value: 'h4' },
  { label: t('noTitle'), value: 'null' },
]);

const isHeaderControl = (target: EventTarget | null) => target instanceof Element && target.closest('button, input, select, textarea, a, [contenteditable="true"], .p-select');
const onHeaderClick = (event: MouseEvent) => {
  if (!isHeaderControl(event.target)) emit('toggle-collapse');
};

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
  <section ref="root" class="section-group" :data-section="sectionKey" :class="{ disabled, completed: todosMode && completed, collapsed: isCollapsed }">
    <ConfirmDeletionDialog
      :visible="pendingDeleteIndex !== null"
      :title="t('confirmDeletion')"
      :message="t('confirmDeleteItem')"
      :cancel-label="t('cancel')"
      :confirm-label="t('delete')"
      @cancel="pendingDeleteIndex = null"
      @confirm="confirmRemoveAt"
    />
    <div class="section-head" @click="onHeaderClick">
      <button
        v-if="toggleable"
        :disabled="visibilityLocked(sectionKey || '')"
        class="mini visibility-toggle"
        :class="[disabled ? 'btn--success' : 'btn--danger']"
        type="button"
        :aria-label="disabled ? t('show') : t('hide')"
        :title="disabled ? t('show') : t('hide')"
        @click.stop="emit('toggle-section')"
      >
        <font-awesome-icon :icon="['fas', disabled ? 'eye-slash' : 'eye']" />
      </button>

      <slot name="heading" :controls="contentId">
      <template v-if="editableTitle && configMode && !versionMode && !reorderMode">
        <SectionHeading v-if="!isEditingTitle" :title="title" :collapsed="isCollapsed" :controls="contentId" editing :edit-label="t('renameSection')" @activate="emit('start-edit-title')" @toggle-collapse="emit('toggle-collapse')" />
        <InputText
          v-else
          :model-value="editingTitleValue"
          class="section-name-input"
          :aria-label="t('renameSection')"
          :placeholder="titlePlaceholder"
          @update:model-value="emit('update-editing-value', $event ?? '')"
          @click.stop
          @blur="emit('finish-edit-title')"
          @keyup.enter="finishTitleEdit()"
          @keyup.esc="finishTitleEdit(true)"
        />
      </template>
      <SectionHeading v-else :title="title" :collapsed="isCollapsed" :controls="contentId" :disabled="reorderMode" @activate="emit('toggle-collapse')" />

      </slot>

      <slot v-if="versionMode" name="section-version" />
      <div v-else class="section-head__actions">
        <button v-if="configMode && showKeepTogether" class="section-header-control section-break-toggle" :class="{ 'section-break-toggle--active': keepTogether }" type="button" :aria-pressed="keepTogether" :aria-label="keepTogether ? t('allowPageBreaks') : t('preventPageBreaks')" :title="keepTogether ? t('allowPageBreaks') : t('preventPageBreaks')" @click.stop="emit('toggle-keep-together')"><font-awesome-icon :icon="['fas', keepTogether ? 'lock' : 'lock-open']" /></button>
        <Select
          v-if="configMode"
          :model-value="headerSize"
          :options="headerSizeOptions"
          option-label="label"
          option-value="value"
          class="header-size-select"
          :aria-label="t('headingSize')"
          @update:model-value="emit('header-size-change', $event)"
        />
        <label v-if="todosMode" class="section-complete-toggle" :title="t('markComplete')" @click.stop>
          <input type="checkbox" :checked="completed" :aria-label="t('markComplete')" @change="emit('toggle-complete')" />
        </label>
      </div>
    </div>

    <div :id="contentId" class="section-content" :inert="isCollapsed">
      <div class="section-content__inner">
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
      </div>
    </div>
  </section>
</template>
