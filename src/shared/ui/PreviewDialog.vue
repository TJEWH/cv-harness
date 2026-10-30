<script setup lang="ts">
import { ref, useId, watch } from 'vue';

const props = withDefaults(defineProps<{ modelValue: boolean; title: string; lang?: string }>(), { lang: 'en' });
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const titleId = useId();
watch([() => props.modelValue, dialog], ([open, element]) => {
  if (!element) return;
  if (open && !element.open) element.showModal();
  else if (!open && element.open) element.close();
}, { flush: 'post' });
</script>

<template>
  <dialog ref="dialog" class="preview-dialog" :aria-labelledby="titleId" @close="emit('update:modelValue', false)">
    <header class="preview-dialog__header"><h2 :id="titleId">{{ title }}</h2><button class="btn" type="button" autofocus @click="dialog?.close()">{{ lang === 'de' ? 'Vorschau schließen' : 'Close preview' }}</button></header>
    <div class="preview-dialog__content"><slot v-if="modelValue" /></div>
  </dialog>
</template>

<style scoped>
.preview-dialog { font-family: var(--font-ui, system-ui); }
.preview-dialog { position: fixed; inset: 16px; width: calc(100% - 32px); height: calc(100dvh - 32px); max-width: none; max-height: none; margin: 0; padding: 18px; box-sizing: border-box; border: 1px solid #28534e; border-radius: 12px; color: #d1fae5; background: #06141f; overflow: hidden; }
.preview-dialog[open] { display: flex; flex-direction: column; gap: 16px; }
.preview-dialog::backdrop { background: #02080dd9; }
.preview-dialog__header { display: flex; flex-wrap: wrap; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; max-height: 40%; overflow: auto; }
.preview-dialog__header h2 { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; margin: 0; font: 600 18px/1.3 system-ui; color: #d1fae5; text-transform: none; letter-spacing: 0; }
.preview-dialog__header .btn { max-width: 100%; white-space: normal; }
.preview-dialog__content { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; }
@media (max-width: 760px) { .preview-dialog { inset: 0; width: 100%; height: 100dvh; padding: 12px; border-radius: 0; } .preview-dialog__header h2 { font-size: 16px; } }
</style>
