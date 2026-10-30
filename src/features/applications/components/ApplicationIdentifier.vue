<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Application } from '../../../app/cloudTypes';
import { applicationIdentifier } from '../../refinement/domain/applicationReference';
import { useToastWatch } from '../../../shared/ui/useToasts';

const props = defineProps<{ application: Pick<Application, 'id' | 'application_code'>; lang: string }>();
const identifier = computed(() => applicationIdentifier(props.application));
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const feedback = ref('');
const copying = ref(false);
const failed = ref(false);
useToastWatch(() => feedback.value, () => ({ tone: failed.value ? 'error' : 'success' }));
watch(identifier, () => { feedback.value = ''; failed.value = false; });
async function copyIdentifier() {
  const value = identifier.value;
  feedback.value = ''; failed.value = false; copying.value = true;
  try {
    await navigator.clipboard.writeText(value);
    if (value === identifier.value) feedback.value = text('Application identifier copied.', 'Bewerbungskennung kopiert.');
  } catch {
    if (value === identifier.value) {
      failed.value = true;
      feedback.value = text('Copy unavailable. Select and copy the identifier below.', 'Kopieren nicht verfügbar. Die Kennung unten markieren und kopieren.');
    }
  } finally { copying.value = false; }
}
</script>

<template>
  <div class="application-identifier" @click.stop>
    <span class="application-identifier__label">ID</span>
    <code :aria-label="text('Application identifier', 'Bewerbungskennung')">{{ identifier }}</code>
    <button type="button" :disabled="copying" :aria-label="`${text('Copy application identifier', 'Bewerbungskennung kopieren')}: ${identifier}`" @click="copyIdentifier">{{ text('Copy', 'Kopieren') }}</button>
    <input v-if="failed" :value="identifier" readonly :aria-label="text('Application identifier to copy', 'Bewerbungskennung zum Kopieren')" @focus="($event.target as HTMLInputElement).select()" />
  </div>
</template>

<style scoped>
.application-identifier{display:flex;align-items:center;flex-wrap:wrap;gap:5px 8px;min-width:0;margin-top:6px;font-size:12px;line-height:1.5;color:#b9d8cd}
.application-identifier__label{color:#8db7ab;font-size:11px}
.application-identifier code{font:inherit;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;min-width:0;user-select:text}
.application-identifier button{flex-shrink:0;border:1px solid #356454;border-radius:6px;background:#0b1b25;color:#d1fae5;padding:4px 8px;font:inherit;cursor:pointer}
.application-identifier button:focus-visible{outline:2px solid #67c8a6;outline-offset:2px}
.application-identifier button:disabled{opacity:.5;cursor:default}
.application-identifier input{width:100%;min-width:0;font:inherit;color:inherit;background:#0b1b25;border:1px solid #356454;padding:8px}
@media(max-width:760px){.application-identifier{font-size:13px}.application-identifier button{min-height:40px;padding:7px 10px}.application-identifier input{font-size:16px}}
</style>
