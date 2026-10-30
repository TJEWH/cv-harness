<script setup lang="ts">
import { computed, ref } from 'vue';
import { makeT } from '../../../i18n/dict';
import SectionHeading from '../../../shared/ui/SectionHeading.vue';

const props = withDefaults(defineProps<{
  contentId: string;
  lang: string;
  title?: string;
  collapsed?: boolean;
  disabled?: boolean;
  completed?: boolean;
  toggleable?: boolean;
  visibilityLocked?: boolean;
  visibilityLabel?: string;
  modes?: { config?: boolean; reorder?: boolean; versions?: boolean; todos?: boolean };
  titleEditor?: { editable: boolean; editing: boolean; value: string; placeholder?: string };
  headerSize?: string;
  keepTogether?: boolean;
}>(), { collapsed: false, disabled: false, completed: false, toggleable: true, visibilityLocked: false, keepTogether: undefined, modes: () => ({}) });
const emit = defineEmits<{
  'toggle-section': [];
  'toggle-collapse': [];
  'toggle-complete': [];
  'toggle-keep-together': [];
  'start-edit-title': [];
  'finish-edit-title': [restoreFocus: boolean];
  'cancel-edit-title': [restoreFocus: boolean];
  'update-editing-value': [value: string];
  'header-size-change': [value: string];
}>();
const element = ref<HTMLElement | null>(null);
defineExpose({ getElement: () => element.value });
const t = makeT(computed(() => props.lang));
const editingEnabled = computed(() => props.titleEditor?.editable && props.modes.config && !props.modes.versions && !props.modes.reorder);
const headerSizeOptions = computed(() => [
  { label: 'H2', value: 'h2' }, { label: 'H3', value: 'h3' }, { label: 'H4', value: 'h4' },
  { label: t('noTitle'), value: 'null' },
]);
function onHeaderClick(event: MouseEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest('button, input, select, textarea, a, [contenteditable="true"], .p-select')) return;
  emit('toggle-collapse');
}
</script>

<template>
  <section ref="element" class="section-group" :class="{ disabled, completed: modes.todos && completed, collapsed }">
    <slot name="before-header" />
    <div class="section-head" @click="onHeaderClick">
      <button v-if="toggleable" class="mini visibility-toggle" :class="disabled ? 'btn--success' : 'btn--danger'"
        type="button" :disabled="visibilityLocked" :aria-label="visibilityLabel || t(disabled ? 'show' : 'hide')"
        :title="t(disabled ? 'show' : 'hide')" @click.stop="emit('toggle-section')">
        <font-awesome-icon :icon="['fas', disabled ? 'eye-slash' : 'eye']" />
      </button>
      <slot name="heading" :controls="contentId">
        <InputText v-if="editingEnabled && titleEditor?.editing" :model-value="titleEditor.value"
          class="section-name-input" :aria-label="t('renameSection')" :placeholder="titleEditor.placeholder"
          @update:model-value="emit('update-editing-value', $event ?? '')" @click.stop
          @blur="emit('finish-edit-title', false)" @keyup.enter="emit('finish-edit-title', true)"
          @keyup.esc="emit('cancel-edit-title', true)" />
        <SectionHeading v-else :title="title" :collapsed="collapsed" :controls="contentId" :editing="Boolean(editingEnabled)"
          :edit-label="t('renameSection')" :disabled="modes.reorder"
          @activate="editingEnabled ? emit('start-edit-title') : emit('toggle-collapse')" @toggle-collapse="emit('toggle-collapse')" />
      </slot>
      <slot v-if="modes.versions" name="section-version" />
      <div v-else class="section-head__actions">
        <slot name="actions" />
        <button v-if="modes.config && keepTogether !== undefined" class="section-header-control section-break-toggle"
          :class="{ 'section-break-toggle--active': keepTogether }" type="button" :aria-pressed="keepTogether"
          :aria-label="t(keepTogether ? 'allowPageBreaks' : 'preventPageBreaks')"
          :title="t(keepTogether ? 'allowPageBreaks' : 'preventPageBreaks')" @click.stop="emit('toggle-keep-together')">
          <font-awesome-icon :icon="['fas', keepTogether ? 'lock' : 'lock-open']" />
        </button>
        <Select v-if="modes.config" :model-value="headerSize" :options="headerSizeOptions" option-label="label" option-value="value"
          class="header-size-select" :aria-label="t('headingSize')" @update:model-value="emit('header-size-change', $event)" />
        <label v-if="modes.todos" class="section-complete-toggle" :title="t('markComplete')" @click.stop>
          <input type="checkbox" :checked="completed" :aria-label="t('markComplete')" @change="emit('toggle-complete')" />
        </label>
      </div>
    </div>
    <div :id="contentId" class="section-content" :inert="collapsed">
      <div class="section-content__inner"><slot /></div>
    </div>
  </section>
</template>
