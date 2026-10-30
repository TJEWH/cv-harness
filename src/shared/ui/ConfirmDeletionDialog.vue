<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, required: true },
  message: { type: String, required: true },
  cancelLabel: { type: String, required: true },
  confirmLabel: { type: String, required: true },
});

const emit = defineEmits<{ cancel: []; confirm: [] }>();
const cancelButton = ref<HTMLButtonElement | null>(null);

const cancel = () => emit('cancel');
const onKeydown = (event: KeyboardEvent) => {
  if (props.visible && event.key === 'Escape') cancel();
};

watch(() => props.visible, (visible) => {
  if (visible) nextTick(() => cancelButton.value?.focus());
});
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="confirmation-backdrop" @click.self="cancel">
      <section class="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-message">
        <h3 id="delete-confirmation-title">{{ title }}</h3>
        <p id="delete-confirmation-message" class="app-hint">{{ message }}</p>
        <div class="confirmation-dialog__actions">
          <button ref="cancelButton" class="btn" type="button" @click="cancel">{{ cancelLabel }}</button>
          <button class="btn btn--danger" type="button" @click="$emit('confirm')">{{ confirmLabel }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirmation-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: rgba(2, 6, 23, .72); }
.confirmation-dialog { width: min(100%, 380px); display: grid; gap: 14px; padding: 18px; border: 1px solid #134e4a; border-radius: 10px; background: #113c34; box-shadow: 0 18px 48px rgba(0, 0, 0, .5); color: #d1fae5; }
.confirmation-dialog h3, .confirmation-dialog p { margin: 0; }
.confirmation-dialog h3 { color: #9be8c7; font-size: 1rem; }
.confirmation-dialog p { color: #cbd5e1; font-size: 13px; line-height: 1.45; }
.confirmation-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
