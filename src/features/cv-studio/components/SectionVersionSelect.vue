<script setup lang="ts">
import type { PropType } from 'vue';
import type { SavedConfiguration } from '../../../documents/cv/types';
defineProps({
  modelValue: String,
  options: { type: Array as PropType<SavedConfiguration[]>, default: () => [] },
  label: String,
  draftLabel: String,
});
defineEmits<{ 'update:modelValue': [id: string] }>();
</script>

<template>
  <select class="section-version-select" :value="modelValue ?? ''" :disabled="!options.length" :aria-label="label" @click.stop @change="$emit('update:modelValue', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
    <option v-if="!options.length" value="" disabled>{{ draftLabel }}</option>
    <option v-for="option in options" :key="option.id" :value="option.id">{{ option.name || draftLabel }}</option>
  </select>
</template>

<style scoped>
.section-version-select { width: min(200px, 45%); min-width: 100px; margin-left: auto; }
</style>
