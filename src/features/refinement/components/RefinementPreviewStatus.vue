<script setup lang="ts">
import RefinementComparisonToggle from './RefinementComparisonToggle.vue';
defineProps<{ modelValue: 'original' | 'proposed'; label: string; reference: string; outdated: boolean; lang: string; hideComparison?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: 'original' | 'proposed'] }>();
</script>

<template>
  <div class="refinement-preview-status">
    <RefinementComparisonToggle v-if="!hideComparison" :model-value="modelValue" :lang="lang" @update:model-value="emit('update:modelValue', $event)" />
  </div>
</template>

<style scoped>
.refinement-preview-status{display:grid;gap:7px;width:100%;color:#efcc87;font:12px/1.5 var(--font-ui,system-ui);box-sizing:border-box}
.refinement-preview-status p{margin:0;overflow-wrap:anywhere}
.refinement-preview-status small{color:#b1c6bd;font-size:10px}
.refinement-preview-status__outdated{color:#fecaca}
</style>
