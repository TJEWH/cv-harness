<script setup lang="ts">
import { computed, inject } from 'vue';
import SectionHeading from '../../../shared/ui/SectionHeading.vue';
import PrivacyField from './PrivacyField.vue';
import { PRIVACY_EDITOR } from '../composables/privacyEditorContext';
import { makeT } from '../../../i18n/dict';

const props = defineProps<{ owner: object; field: string; title: string; placeholder?: string; lang: string; collapsed: boolean; controls: string }>();
defineEmits<{ 'toggle-collapse': [] }>();
const context = inject(PRIVACY_EDITOR, null);
const t = makeT(computed(() => props.lang));
const value = computed({
  get: () => Reflect.get(props.owner, props.field) ?? props.placeholder ?? '',
  set: (value: string) => {
    // Default headings need no override when restored to their displayed wording.
    if (value === props.placeholder && context?.field(props.owner, props.field)?.original === '') Reflect.deleteProperty(props.owner, props.field);
    else Reflect.set(props.owner, props.field, value);
  },
});
</script>

<template>
  <SectionHeading class="privacy-section-heading" :title="title" :collapsed="collapsed" :controls="controls" editing @toggle-collapse="$emit('toggle-collapse')">
    <template #title>
      <PrivacyField :owner="owner" :field="field" v-slot="{ disabled }" class="privacy-section-title">
        <span class="privacy-section-title-measure" aria-hidden="true">{{ value || '\u00a0' }}</span>
        <InputText v-model="value" :disabled="disabled" :aria-label="`${t('privacySectionTitle')}: ${title}`" class="privacy-section-title-input" @click.stop />
      </PrivacyField>
    </template>
  </SectionHeading>
</template>

<style scoped>
.privacy-section-title { z-index: 1; display: grid; width: max-content; max-width: 100%; }
.privacy-section-title-measure { grid-area: 1 / 1; min-width: 2ch; padding: 5px 6px; border: 1px solid transparent; font: inherit; white-space: pre; visibility: hidden; }
.privacy-section-title :deep(input.privacy-section-title-input) { position: absolute; inset: 0; width: 100%; min-width: 0; padding: 5px 6px; border-color: transparent; border-radius: 4px; background: transparent; color: inherit; font: inherit; }
.privacy-section-title:hover :deep(input.privacy-section-title-input), .privacy-section-title:focus-within :deep(input.privacy-section-title-input) { border-color: var(--ui-divider); background: var(--ui-control); }
.privacy-section-title.privacy-field--edited { color: var(--ui-accent); }
.privacy-section-title.privacy-field--edited .privacy-section-title-measure,
.privacy-section-title.privacy-field--edited :deep(.privacy-section-title-input) { padding-right: 34px; }
.privacy-section-title.privacy-field--edited:hover :deep(input.privacy-section-title-input), .privacy-section-title.privacy-field--edited:focus-within :deep(input.privacy-section-title-input) { border-color: var(--ui-accent-border); background: var(--ui-active); }
.privacy-section-title :deep(.privacy-field-revert) { top: 50%; right: 4px; transform: translateY(-50%); }
</style>
