<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { markTextareaDraftChanged, registerTextareaCommit } from '../editing/textareaCommit';

const props = withDefaults(defineProps<{
  modelValue?: string;
  modelModifiers?: { lazy?: boolean };
  autoResize?: boolean;
}>(), { modelValue: '' });
const emit = defineEmits<{ 'update:modelValue': [value: string]; commit: [] }>();
const textarea = ref<HTMLTextAreaElement | null>(null);
const draft = ref(props.modelValue);
let committed = props.modelValue;
let dirty = false;
let publishing = false;
const value = computed({
  get: () => draft.value,
  set: (text: string) => {
    if (text !== draft.value) markTextareaDraftChanged();
    draft.value = text;
    dirty = text !== committed;
    if (!props.modelModifiers?.lazy) emit('update:modelValue', text);
    void nextTick(resize);
  },
});
let focused = false;
let composing = false;

watch(() => props.modelValue, text => {
  // A local-draft v-model echo is not a persistence acknowledgement. Keep it
  // dirty until a commit so navigation and unmount can flush it as well.
  if (!props.modelModifiers?.lazy && text === draft.value) return;
  // An acknowledgement for an older commit must not replace newer typing.
  if (!dirty || !props.modelModifiers?.lazy) draft.value = text;
  committed = text;
  dirty = draft.value !== committed;
  void nextTick(resize);
});
function resize() {
  const field = textarea.value;
  if (!props.autoResize || !field || !field.getClientRects().length) return;
  field.style.height = 'auto';
  const style = window.getComputedStyle(field);
  const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  field.style.height = `${field.scrollHeight + (style.boxSizing === 'border-box' ? borders : 0)}px`;
}
function commit() {
  if (publishing || composing) return;
  publishing = true;
  try {
    const text = draft.value;
    dirty = false;
    committed = text;
    if (props.modelModifiers?.lazy && props.modelValue !== text) emit('update:modelValue', text);
    emit('commit');
  } finally { publishing = false; }
}
function commitDraft() { if (dirty) commit(); }
function onFocus() { focused = true; }
function onBlur() { focused = false; commit(); }
function onCompositionStart() { composing = true; }
function onCompositionEnd() { composing = false; }
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || composing || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  commit();
}
function onClick(event: MouseEvent) {
  if (event.detail === 3) (event.currentTarget as HTMLTextAreaElement).select();
}
function onPointerDown(event: PointerEvent) {
  // Publish before another control switches the owning record or section. Never
  // intercept the pointer: caret placement and native drag selection stay intact.
  if (focused && event.target !== textarea.value) commitDraft();
}
function onWindowBlur() { if (focused) commit(); }
function onVisibilityChange() { if (document.hidden) onWindowBlur(); }
let unregister: (() => void) | undefined;
onMounted(() => {
  unregister = registerTextareaCommit(commitDraft, () => !composing);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('pagehide', onWindowBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('pointerdown', onPointerDown, true);
  resize();
});
onBeforeUnmount(() => {
  commitDraft();
  unregister?.();
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('pagehide', onWindowBlur);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('pointerdown', onPointerDown, true);
});
</script>

<template>
  <textarea ref="textarea" v-model="value" @focus="onFocus" @blur="onBlur" @keydown="onKeydown" @click="onClick" @compositionstart="onCompositionStart" @compositionend="onCompositionEnd" />
</template>

<style scoped>
textarea { user-select: text; -webkit-user-select: text; touch-action: auto; }
</style>
