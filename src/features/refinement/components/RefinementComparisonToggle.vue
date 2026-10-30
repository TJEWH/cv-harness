<script setup lang="ts">
defineProps<{ modelValue: 'original' | 'proposed'; lang: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: 'original' | 'proposed'] }>();
</script>

<template>
  <div class="refinement-comparison" role="group" :aria-label="lang === 'de' ? 'Vorschlag vergleichen' : 'Compare proposal'">
    <button type="button" :disabled="disabled" :aria-pressed="modelValue === 'original'" @click="emit('update:modelValue', 'original')">{{ lang === 'de' ? 'Vorherige' : 'Previous' }}</button>
    <button type="button" :disabled="disabled" :aria-pressed="modelValue === 'proposed'" @click="emit('update:modelValue', 'proposed')">{{ lang === 'de' ? 'Aktuelle' : 'Current' }}</button>
  </div>
</template>

<style scoped>
.refinement-comparison{display:flex;gap:6px;min-width:0;font:12px/1.5 var(--font-ui,system-ui)}
.refinement-comparison button{flex:1;min-width:0;border:1px solid var(--ui-border,#28534e);border-radius:6px;background:var(--ui-control,#0b1b25);color:var(--ui-text,#d1fae5);cursor:pointer}
.refinement-comparison button[aria-pressed=true]{border-color:var(--ui-accent-border,#67c8a6);background:var(--ui-active,#185b4c);color:var(--ui-accent,#d1fae5)}
.refinement-comparison button:focus-visible{outline:2px solid var(--ui-accent,#67c8a6);outline-offset:2px}
.refinement-comparison button:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:760px){.refinement-comparison button{min-height:44px}}
</style>
