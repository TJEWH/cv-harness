<script setup lang="ts">
import { computed, inject, useId } from 'vue';
import { normalizeMarkdownText } from '../../../shared/lib/markdownText.ts';
import { CV_TEXTAREA_COMMIT } from '../composables/cvTextareaCommit';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  help: { type: String, default: '' },
  lang: { type: String, default: 'en' },
  rows: { type: Number, default: 3 },
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const helpId = `markdown-help-${useId()}`;
const commit = inject(CV_TEXTAREA_COMMIT, () => {});

const value = computed({
  get: () => normalizeMarkdownText(props.modelValue),
  set: (nextValue) => emit('update:modelValue', nextValue),
});

</script>

<template>
  <AutosaveTextarea v-bind="$attrs" v-model.lazy="value" class="p-textarea p-component p-textarea-fluid" :placeholder="placeholder" :aria-label="ariaLabel || undefined" :aria-describedby="[help ? helpId : '', $attrs['aria-describedby']].filter(Boolean).join(' ') || undefined" auto-resize :rows="rows" @commit="commit" />
  <InfoHint v-if="help" :id="helpId" :lang="lang" :label="ariaLabel || (lang === 'de' ? 'Textformatierung' : 'Text formatting')" :text="help" />
</template>
