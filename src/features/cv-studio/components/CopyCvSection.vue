<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CvState, SavedConfiguration } from '../../../documents/cv/types';
import { cloneCv, copyCvSection } from '../../applications/applicationCv';
import { useToastWatch } from '../../../shared/ui/useToasts';
const props = defineProps<{ state: CvState; configurations: SavedConfiguration[]; readVersion: (id: string) => CvState | null | undefined }>();
const sourceId = ref('');
const section = ref('about');
const error = ref('');
useToastWatch(() => error.value, { tone: 'error' });
const undo = ref<{ state: CvState; section: string } | null>(null);
const source = computed(() => sourceId.value ? props.readVersion(sourceId.value) : null);
const sections = computed(() => source.value ? [
  { id: 'header', name: 'Contact / headline' }, { id: 'about', name: 'About' }, { id: 'jobs', name: 'Experience' },
  { id: 'education', name: 'Education' }, { id: 'languages', name: 'Languages' }, { id: 'hobbies', name: 'Interests' },
  ...source.value.customSections, ...source.value.sidebarSections,
] : []);
function copy() {
  try {
    if (!source.value) return;
    const next = copyCvSection(props.state, source.value, section.value);
    undo.value = { state: cloneCv(props.state), section: section.value };
    Object.assign(props.state, next);
    error.value = '';
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
function undoCopy() { if (undo.value) Object.assign(props.state, copyCvSection(props.state, undo.value.state, undo.value.section)); undo.value = null; }
</script>
<template>
  <details v-if="configurations.length" class="copy-section">
    <summary>{{ state.lang === 'de' ? 'Abschnitt aus Variante kopieren' : 'Copy section from variant' }}</summary>
    <div class="copy-section__controls">
      <label>{{ state.lang === 'de' ? 'Quellvariante' : 'Source variant' }}<select v-model="sourceId"><option value="">—</option><option v-for="variant in configurations" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
      <label>{{ state.lang === 'de' ? 'Abschnitt' : 'Section' }}<select v-model="section"><option v-for="item in sections" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <button class="btn" type="button" :disabled="!source" @click="copy">{{ state.lang === 'de' ? 'In dieses Dokument kopieren' : 'Copy into this document' }}</button>
      <button v-if="undo" class="btn" type="button" @click="undoCopy">{{ state.lang === 'de' ? 'Rückgängig' : 'Undo copy' }}</button>
    </div>
  </details>
</template>
<style scoped>
.copy-section { padding: 12px 16px; border-bottom: 1px solid #24504e; color: #cce8df; }
.copy-section summary { cursor: pointer; font-size: 13px; }
.copy-section__controls { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; padding-top: 12px; }
.copy-section label { display: grid; gap: 5px; font-size: 12px; }
</style>
