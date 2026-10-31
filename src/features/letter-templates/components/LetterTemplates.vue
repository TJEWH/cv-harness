<script setup lang="ts">
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faAlignLeft, faCheck, faChevronDown, faComments, faDownload, faEnvelopeOpenText, faFeatherPointed, faPlus, faUpload } from '@fortawesome/free-solid-svg-icons';
import { debounce } from '../../../documents/cv/data/useStorage';
import type { LetterFormatting, LetterTemplate } from '../../../documents/letter/letterTypes';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES, DEFAULT_QUESTION_GUIDANCE, DEFAULT_REFINEMENT_SYSTEM_PROMPT, LETTER_TEMPLATE_CONTEXT_MAX_LENGTH } from '../../../documents/letter/motivationLetters';
import { useToasts, useToastWatch } from '../../../shared/ui/useToasts';
import DesktopSidebarPortal from '../../../shared/ui/DesktopSidebarPortal.vue';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import { flushEditorSessionSync } from '../../../shared/editing/editorSession';
import LetterFormattingControls from '../../../documents/letter/components/LetterFormattingControls.vue';
import { useDesktopSidebar } from '../../../shared/ui/desktopSidebar';
import { SEARCH_TEMPLATES_UPDATED_EVENT } from '../../meta-search/data/useSearchTemplates';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useSharedSearchSource } from '../../meta-search/composables/useSharedSearchSource';

const props = withDefaults(defineProps<{ userId: string; lang?: string; sidebarActive?: boolean; client?: SupabaseClient | null }>(), { sidebarActive: true });
const desktopSidebar = useDesktopSidebar();
const sidebarControlsVisible = computed(() => desktopSidebar.value && props.sidebarActive);
const emit = defineEmits<{ changed: [] }>();
const templates = ref<LetterTemplate[]>([]);
const selectedId = ref('');
const defaultId = ref('');
const defaultTemplateName = computed(() => templates.value.find(template => template.id === defaultId.value)?.name || '');
const controlsId = useId();
const form = ref<LetterTemplate | null>(null);
const sharedSearchSource = useSharedSearchSource({
  owner: () => props.userId,
  client: () => props.client,
  storage: () => localStorage,
});
const sharedInterestsState = sharedSearchSource.status;
const message = ref('');
const error = ref('');
const validationError = ref('');
const importInput = ref<HTMLInputElement | null>(null);
const isImporting = ref(false);
const saveStatus = ref<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
let editingOwner = props.userId;
let importGeneration = 0;
let disposed = false;
let replacingForm = false;
let dirty = false;
let savedForm: LetterTemplate | null = null;
let editorGeneration = 0;
type FailedDraft = { form: LetterTemplate; baseline: LetterTemplate | null; selectedId: string; error: string; validationError: string };
// One blocked editor per owner; private drafts never cross an account boundary.
const failedDrafts = new Map<string, FailedDraft>();
const cloneTemplate = (value: LetterTemplate) => JSON.parse(JSON.stringify(value)) as LetterTemplate;
function retainFailedDraft() {
  if (!dirty || !form.value) return;
  failedDrafts.set(editingOwner, { form: cloneTemplate(form.value), baseline: savedForm && cloneTemplate(savedForm), selectedId: selectedId.value, error: error.value, validationError: validationError.value });
}
function retrySave() {
  const owner = editingOwner; const id = form.value?.id; const token = editorGeneration;
  return () => !disposed && props.userId === owner && editingOwner === owner && form.value?.id === id && token === editorGeneration ? flush() : false;
}
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const { notify } = useToasts();
useToastWatch(() => message.value, { tone: 'success' });
useToastWatch(() => error.value, () => ({ tone: 'error', ...(dirty ? { action: { label: text('Retry', 'Erneut versuchen'), run: retrySave() } } : {}) }));
useToastWatch(() => validationError.value, { tone: 'error' });
useToastWatch(() => isImporting.value ? text('Reading the template file…', 'Vorlagendatei wird gelesen…') : '', { passive: true });
useToastWatch(() => form.value?.useMetaSearchInterests && sharedInterestsState.value === 'loading'
  ? text('Loading shared research interests…', 'Gemeinsame Forschungsinteressen werden geladen…')
  : form.value?.useMetaSearchInterests && sharedInterestsState.value === 'error'
    ? text('Shared research interests could not be loaded.', 'Gemeinsame Forschungsinteressen konnten nicht geladen werden.') : '',
() => sharedInterestsState.value === 'error'
  ? { tone: 'error', action: { label: text('Retry', 'Erneut versuchen'), run: retrySharedInterests() } }
  : { passive: true });
const announceSaved = debounce(() => {
  notify({ message: text('All changes saved locally', 'Alle Änderungen lokal gespeichert'), tone: 'success', key: 'letter-template-autosave' });
}, 1500);
const applicantNamePlaceholder = '{{APPLICANT_NAME}}';
const repository = () => createLetterRepository(localStorage, editingOwner);
function retrySharedInterests() {
  const owner = editingOwner; const id = form.value?.id; const token = editorGeneration;
  return () => !disposed && props.userId === owner && editingOwner === owner && form.value?.id === id && token === editorGeneration ? reloadSharedResearchInterests() : false;
}
async function reloadSharedResearchInterests() {
  if (form.value?.useMetaSearchInterests === false) return;
  try { await sharedSearchSource.load({ refreshCloud: true }); }
  catch { /* The shared source status supplies the existing preview retry toast. */ }
}
function updateResearchInterestSource() {
  if (flushSave() && form.value?.useMetaSearchInterests) void reloadSharedResearchInterests();
}
function select(id: string, initializingOwner = false) {
  if (!initializingOwner && !flushSave()) return;
  try { templates.value = repository().listTemplates(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return; }
  editorGeneration++; error.value = '';
  selectedId.value = id;
  const selected = templates.value.find((item) => item.id === id);
  replaceForm(selected ? JSON.parse(JSON.stringify(selected)) : null);
  if (form.value && form.value.questionGuidance === undefined) form.value.questionGuidance = DEFAULT_QUESTION_GUIDANCE;
  if (form.value && form.value.refinementSystemPrompt === undefined) form.value.refinementSystemPrompt = DEFAULT_REFINEMENT_SYSTEM_PROMPT;
  save();
  void reloadSharedResearchInterests();
}
function selectFromInput(event: Event) {
  const input = event.target as HTMLSelectElement;
  select(input.value);
  input.value = selectedId.value;
}
function reload(initializingOwner = false) {
  try {
    templates.value = repository().listTemplates();
    defaultId.value = repository().defaultTemplate()?.id || '';
    select(templates.value.find((item) => item.id === selectedId.value)?.id || defaultId.value, initializingOwner);
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function replaceForm(value: LetterTemplate | null, baseline = value) {
  savedForm = baseline ? JSON.parse(JSON.stringify(baseline)) : null;
  replacingForm = true; form.value = value; validationError.value = ''; replacingForm = false;
}
function updateFormatting(value: LetterFormatting | undefined) {
  if (!form.value) return;
  if (value) form.value.formatting = value;
  else delete form.value.formatting;
  flushSave();
}
function revealInvalidSection(event: Event) {
  const section = (event.target as HTMLElement).closest('details');
  if (section) section.open = true;
}
function create() {
  if (!flushSave()) return;
  editorGeneration++; error.value = '';
  replaceForm({ ...DEFAULT_LETTER_TEMPLATES[0]!, id: crypto.randomUUID(), name: text('New letter template', 'Neue Briefvorlage'), revision: 1 }, null);
  selectedId.value = ''; message.value = ''; dirty = true;
  save();
}
function setDefault() {
  if (!flushSave()) return;
  try {
    error.value = '';
    repository().setDefaultTemplate(selectedId.value);
    defaultId.value = selectedId.value;
    emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    message.value = text('Default template updated. New applications on this device will use it.', 'Standardvorlage geändert. Neue Bewerbungen auf diesem Gerät verwenden diese Vorlage.');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function save(): boolean {
  if (!form.value || !dirty) return true;
  validationError.value = '';
  if (!form.value.name.trim() || !form.value.structure.trim() || !form.value.tone.trim()) {
    validationError.value = text('Enter a template name, structure and tone to save your changes.', 'Zum Speichern Vorlagenname, Struktur und Tonalität eingeben.');
    saveStatus.value = 'error';
    retainFailedDraft();
    return false;
  }
  validationError.value = '';
  try {
    error.value = '';
    const saved = repository().saveTemplate(form.value, savedForm);
    if (failedDrafts.get(editingOwner)?.form.id === saved.id) failedDrafts.delete(editingOwner);
    dirty = false;
    selectedId.value = saved.id;
    replaceForm(saved);
    templates.value = repository().listTemplates();
    defaultId.value = repository().defaultTemplate()?.id || '';
    saveStatus.value = 'saved';
    announceSaved();
    emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    saveStatus.value = 'error';
    retainFailedDraft();
    return false;
  }
}
function flushSave(): boolean {
  const owner = editingOwner; const id = form.value?.id; const token = editorGeneration;
  return flushEditorSessionSync({ steps: [save], current: () => owner === editingOwner && id === form.value?.id && token === editorGeneration });
}
function flush(): boolean { return !disposed && editingOwner === props.userId && flushSave(); }
defineExpose({ flush });
watch(form, () => {
  if (replacingForm) return;
  announceSaved.cancel();
  dirty = true; saveStatus.value = 'unsaved'; message.value = '';
  if (failedDrafts.get(editingOwner)?.form.id === form.value?.id) retainFailedDraft();
}, { deep: true, flush: 'sync' });
watch(() => props.userId, (id) => {
  importGeneration++; isImporting.value = false;
  if (!flushSave()) retainFailedDraft();
  announceSaved.cancel();
  editingOwner = id; editorGeneration++; dirty = false; selectedId.value = ''; templates.value = []; defaultId.value = ''; message.value = ''; error.value = '';
  replaceForm(null); saveStatus.value = 'saved';
  const retained = failedDrafts.get(id);
  if (retained) {
    try { templates.value = repository().listTemplates(); defaultId.value = repository().defaultTemplate()?.id || ''; }
    catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
    selectedId.value = retained.selectedId;
    replaceForm(cloneTemplate(retained.form), retained.baseline && cloneTemplate(retained.baseline));
    dirty = true; saveStatus.value = 'error'; error.value = retained.error; validationError.value = retained.validationError;
    void reloadSharedResearchInterests();
  } else reload(true);
}, { immediate: true });
watch(() => props.client, () => { void reloadSharedResearchInterests(); });
onMounted(() => { window.addEventListener('pagehide', flushSave); window.addEventListener(SEARCH_TEMPLATES_UPDATED_EVENT, reloadSharedResearchInterests); window.addEventListener('focus', reloadSharedResearchInterests); });
onBeforeUnmount(() => { disposed = true; importGeneration++; flushSave(); announceSaved.cancel(); window.removeEventListener('pagehide', flushSave); window.removeEventListener(SEARCH_TEMPLATES_UPDATED_EVENT, reloadSharedResearchInterests); window.removeEventListener('focus', reloadSharedResearchInterests); });
function download() {
  if (!flushSave()) return;
  try {
    const url = URL.createObjectURL(new Blob([repository().exportTemplates()], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'letter-templates.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { error.value = String(cause); }
}
async function importLibrary(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || isImporting.value || disposed || !flushSave()) return;
  const user = props.userId;
  const token = ++importGeneration;
  const current = () => !disposed && token === importGeneration && user === props.userId;
  isImporting.value = true; error.value = ''; message.value = '';
  try {
    const raw = await file.text();
    if (!current() || !flushSave()) return;
    repository().importTemplates(raw); reload(); emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    message.value = text('Templates imported as new copies.', 'Vorlagen als neue Kopien importiert.');
  } catch (cause) {
    if (current()) error.value = text('The library could not be imported. Select the file again to retry. ', 'Die Bibliothek konnte nicht importiert werden. Zum Wiederholen die Datei erneut auswählen. ') + (cause instanceof Error ? cause.message : String(cause));
  }
  finally { if (current()) isImporting.value = false; }
}
</script>

<template>
  <section class="letter-templates">
    <div class="template-heading workspace-page-heading">
      <h2>{{ text('Letter templates', 'Briefvorlagen') }}<InfoHint :lang="lang" :label="text('Letter templates', 'Briefvorlagen')" :text="text('Reusable structure, research interests and drafting guidance. Letters use the assigned CV’s fonts, colors and selected contact fields, with their own page margins and text size. Templates stay on this device until included in an explicitly published refinement request.', 'Wiederverwendbare Struktur, Forschungsinteressen und Entwurfshinweise. Briefe übernehmen Schriftarten, Farben und ausgewählte Kontaktdaten des zugewiesenen Lebenslaufs. Seitenränder und Textgröße werden separat eingestellt. Vorlagen bleiben auf diesem Gerät, bis sie Teil einer ausdrücklich veröffentlichten Überarbeitungsanfrage sind.')" /></h2>
    </div>
    <div class="template-layout" :class="{ 'template-layout--sidebar': sidebarControlsVisible }">
      <DesktopSidebarPortal area="major" :active="sidebarActive">
      <aside class="template-library-controls" :aria-label="text('Letter template library', 'Briefvorlagenbibliothek')">
        <div class="template-library-section">
          <label>{{ text('Template to edit', 'Vorlage zum Bearbeiten') }}<select :value="selectedId" @change="selectFromInput">
            <option v-if="!selectedId" value="" disabled>{{ text('New template', 'Neue Vorlage') }}</option>
            <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
          </select></label>
          <button class="template-create-action" type="button" @click="create"><FontAwesomeIcon :icon="faPlus" aria-hidden="true" /><span>{{ text('Create new template', 'Neue Vorlage erstellen') }}</span></button>
        </div>
        <section class="template-library-section template-default" :aria-labelledby="`${controlsId}-default-heading`">
          <h3 :id="`${controlsId}-default-heading`">{{ text('New applications', 'Neue Bewerbungen') }}<InfoHint :id="`${controlsId}-default-help`" :lang="lang" :label="text('New applications', 'Neue Bewerbungen')" :text="text('Selected automatically for new applications on this device.', 'Wird auf diesem Gerät automatisch für neue Bewerbungen ausgewählt.')" /></h3>
          <p v-if="selectedId && selectedId === defaultId" class="template-default-status"><FontAwesomeIcon :icon="faCheck" aria-hidden="true" /><span>{{ text('This template is the default', 'Diese Vorlage ist der Standard') }}</span></p>
          <template v-else>
            <p class="template-control-help">{{ text('Current default:', 'Aktueller Standard:') }} <strong>{{ defaultTemplateName }}</strong></p>
            <button type="button" :disabled="!selectedId" :aria-describedby="`${controlsId}-default-help`" @click="setDefault">{{ text('Make this the default', 'Als Standard festlegen') }}</button>
          </template>
        </section>
        <details class="template-library-files">
          <summary>{{ text('Import & export', 'Import & Export') }}<InfoHint :id="`${controlsId}-files-help`" :lang="lang" :label="text('Import & export', 'Import & Export')" :text="text('Export all templates as a JSON file. Import adds new copies to your library.', 'Alle Vorlagen als JSON-Datei exportieren. Beim Import werden neue Kopien hinzugefügt.')" /></summary>
          <div class="template-library-actions">
            <button type="button" :aria-describedby="`${controlsId}-files-help`" @click="download"><FontAwesomeIcon :icon="faDownload" aria-hidden="true" /><span>{{ text('Export all templates', 'Alle Vorlagen exportieren') }}</span></button>
            <button type="button" :disabled="isImporting" :aria-describedby="`${controlsId}-files-help`" @click="importInput?.click()"><FontAwesomeIcon :icon="faUpload" aria-hidden="true" /><span>{{ isImporting ? text('Importing…', 'Importieren…') : text('Import templates', 'Vorlagen importieren') }}</span></button>
          </div>
        </details>
        <input ref="importInput" hidden type="file" accept=".json,application/json" :disabled="isImporting" @change="importLibrary" />
      </aside>
      </DesktopSidebarPortal>
      <form v-if="form" :key="userId" class="template-form" @submit.prevent="flushSave" @focusout="flushSave" @invalid.capture="revealInvalidSection">
        <label>{{ text('Template name', 'Vorlagenname') }}<input v-model="form.name" required maxlength="120" /></label>
        <details class="template-section" open>
          <summary><FontAwesomeIcon :icon="faAlignLeft" aria-hidden="true" /><span>{{ text('Main text', 'Haupttext') }}</span><FontAwesomeIcon class="template-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
          <div class="template-section-fields">
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-structure`">{{ text('Structure and sections', 'Struktur und Abschnitte') }}</label><InfoHint :id="`${controlsId}-structure-help`" :lang="lang" :label="text('Structure and sections', 'Struktur und Abschnitte')" :text="text('Instructions for ChatGPT on paragraph order, section content and the letter’s narrative flow.', 'Anweisungen für ChatGPT zu Absatzreihenfolge, Abschnittsinhalten und dem roten Faden des Briefs.')" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-structure`" v-model.lazy="form.structure" :aria-describedby="`${controlsId}-structure-help`" rows="8" required maxlength="16000" /></div>
            <div class="template-field">
              <div class="hint-label-row"><label :for="form.useMetaSearchInterests ? undefined : `${controlsId}-research-interests`">{{ text('Research interests', 'Forschungsinteressen') }}</label><InfoHint :id="`${controlsId}-research-interests-help`" :lang="lang" :label="text('Research interests', 'Forschungsinteressen')" :text="text('Use the shared meta-search interests by default, or turn this off to write interests for this letter template. New applications keep a copy of the selected interests. Use relevant research directions selectively; interests and preferred tasks are aspirations, not proof of experience. Avoided tasks are search preferences, not wording to copy into a letter.', 'Standardmäßig werden die gemeinsamen Forschungsinteressen der Metasuche verwendet. Ausschalten, um eigene Interessen für diese Briefvorlage zu schreiben. Neue Bewerbungen behalten eine Kopie der gewählten Interessen. Relevante Forschungsrichtungen gezielt auswählen: Interessen und bevorzugte Aufgaben sind Ziele, keine Erfahrungsnachweise. Zu vermeidende Aufgaben sind Suchpräferenzen, kein Text für den Brief.')" /></div>
              <label class="template-checkbox"><input v-model="form.useMetaSearchInterests" type="checkbox" @change="updateResearchInterestSource" /><span>{{ text('Use research interests from meta search', 'Forschungsinteressen aus der Metasuche verwenden') }}</span></label>
              <button v-if="form.useMetaSearchInterests && sharedInterestsState === 'error'" type="button" @click="reloadSharedResearchInterests">{{ text('Retry loading shared interests', 'Gemeinsame Interessen erneut laden') }}</button>
              <AutosaveTextarea v-if="!form.useMetaSearchInterests" @commit="flushSave" :id="`${controlsId}-research-interests`" v-model.lazy="form.researchInterests" :aria-describedby="`${controlsId}-research-interests-help`" rows="5" :maxlength="LETTER_TEMPLATE_CONTEXT_MAX_LENGTH" />
            </div>
          </div>
        </details>
        <details class="template-section">
          <summary><FontAwesomeIcon :icon="faFeatherPointed" aria-hidden="true" /><span>{{ text('Tone', 'Tonalität') }}</span><FontAwesomeIcon class="template-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
          <div class="template-section-fields">
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-tone`">{{ text('Tone and writing guidance', 'Tonalität und Schreibhinweise') }}</label><InfoHint :id="`${controlsId}-tone-help`" :lang="lang" :label="text('Tone and writing guidance', 'Tonalität und Schreibhinweise')" :text="text('Instructions for ChatGPT on the letter’s tone, wording and level of formality.', 'Anweisungen für ChatGPT zu Ton, Wortwahl und Formalität des Briefs.')" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-tone`" v-model.lazy="form.tone" :aria-describedby="`${controlsId}-tone-help`" rows="4" maxlength="1000" required /></div>
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-example`">{{ text('Example letter (optional)', 'Beispielbrief (optional)') }}</label><InfoHint :id="`${controlsId}-example-help`" :lang="lang" :label="text('Example letter (optional)', 'Beispielbrief (optional)')" :text="text('Use an earlier letter to guide wording, style and structure. Its claims are not evidence about the applicant. Remove or generalize confidential details before sharing.', 'Ein früherer Brief kann Wortwahl, Stil und Struktur vorgeben. Seine Aussagen sind keine Nachweise über die bewerbende Person. Entfernen oder verallgemeinern Sie vertrauliche Details vor dem Teilen.')" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-example`" v-model.lazy="form.exampleText" :aria-describedby="`${controlsId}-example-help`" rows="8" maxlength="20000" /></div>
          </div>
        </details>
        <details class="template-section">
          <summary><FontAwesomeIcon :icon="faComments" aria-hidden="true" /><span>{{ text('Feedback loop', 'Feedback-Schleife') }}</span><FontAwesomeIcon class="template-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
          <div class="template-section-fields">
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-question-guidance`">{{ text('Questions and context to ask for (optional)', 'Rückfragen und gewünschter Kontext (optional)') }}</label><InfoHint :id="`${controlsId}-question-guidance-help`" :lang="lang" :label="text('Questions and context to ask for (optional)', 'Rückfragen und gewünschter Kontext (optional)')" :text="text('Explain when a question would improve a draft or refinement and what context to ask for. For example, ask about required or beneficial qualifications without CV evidence, then request a relevant example or an honest learning interest. Questions should add value, avoid repeating answered questions and never assume missing experience.', 'Beschreiben Sie, wann eine Rückfrage einen Entwurf oder eine Überarbeitung verbessert und welcher Kontext erfragt werden soll. Zum Beispiel: nach geforderten oder vorteilhaften Qualifikationen ohne Lebenslaufnachweis fragen und um ein relevantes Beispiel oder ehrliches Lerninteresse bitten. Fragen sollen einen Mehrwert bieten, beantwortete Fragen nicht wiederholen und fehlende Erfahrung nicht unterstellen.')" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-question-guidance`" v-model.lazy="form.questionGuidance" :aria-describedby="`${controlsId}-question-guidance-help`" rows="6" :maxlength="LETTER_TEMPLATE_CONTEXT_MAX_LENGTH" /></div>
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-refinement-system-prompt`">{{ text('Refinement system prompt (optional)', 'System-Prompt für Überarbeitungen (optional)') }}</label><InfoHint :id="`${controlsId}-refinement-system-prompt-help`" :lang="lang" :label="text('Refinement system prompt (optional)', 'System-Prompt für Überarbeitungen (optional)')" :text="text('Guide each refinement iteration: decide which resolved answers strengthen the letter’s central narrative and add value, which to leave out, and when to ask for more detail.', 'Legen Sie fest, wie jede Überarbeitungsrunde mit Antworten umgeht: Welche stärken den roten Faden und bieten Mehrwert, welche bleiben außen vor und wann sind genauere Rückfragen nötig?')" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-refinement-system-prompt`" v-model.lazy="form.refinementSystemPrompt" :aria-describedby="`${controlsId}-refinement-system-prompt-help`" rows="8" :maxlength="LETTER_TEMPLATE_CONTEXT_MAX_LENGTH" /></div>
          </div>
        </details>
        <details class="template-section">
          <summary><FontAwesomeIcon :icon="faEnvelopeOpenText" aria-hidden="true" /><span>{{ text('Formalities', 'Formalitäten') }}</span><FontAwesomeIcon class="template-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
          <div class="template-section-fields">
            <div class="template-form-row"><label>{{ text('Default language', 'Standardsprache') }}<select v-model="form.language"><option value="en">English</option><option value="de">Deutsch</option></select></label><label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="form.maxWords" type="number" min="50" max="2000" required /></label></div>
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-subject`">{{ text('Subject instructions', 'Hinweise zum Betreff') }}</label><InfoHint :id="`${controlsId}-subject-help`" :lang="lang" :label="text('Subject instructions', 'Hinweise zum Betreff')" :text="text('Describe how to name the position and include a tender reference when available.', 'Beschreiben Sie, wie die Stelle benannt und eine vorhandene Ausschreibungsreferenz aufgenommen werden soll.')" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-subject`" v-model.lazy="form.subjectInstructions" :aria-describedby="`${controlsId}-subject-help`" rows="3" maxlength="1000" /></div>
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-salutation`">{{ text('Salutation instructions', 'Hinweise zur Anrede') }}</label><InfoHint :id="`${controlsId}-salutation-help`" :lang="lang" :label="text('Salutation instructions', 'Hinweise zur Anrede')" :text="text('Describe how to choose the recipient from the tender and how to greet them if no contact is named.', 'Beschreiben Sie, wie der Empfänger aus der Ausschreibung gewählt und ohne genannten Kontakt angesprochen werden soll.')" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-salutation`" v-model.lazy="form.salutationInstructions" :aria-describedby="`${controlsId}-salutation-help`" rows="3" maxlength="1000" /></div>
            <div class="template-field"><div class="hint-label-row"><label :for="`${controlsId}-closing`">{{ text('Closing instructions', 'Hinweise zum Abschluss') }}</label><InfoHint :id="`${controlsId}-closing-help`" :lang="lang" :label="text('Closing instructions', 'Hinweise zum Abschluss')" :text="text(`Describe the closing invitation, sign-off and signature. Use ${applicantNamePlaceholder} for the private name.`, `Beschreiben Sie die abschließende Einladung, Grußformel und Unterschrift. Verwenden Sie ${applicantNamePlaceholder} für den privaten Namen.`)" /></div><AutosaveTextarea @commit="flushSave" :id="`${controlsId}-closing`" v-model.lazy="form.closingInstructions" :aria-describedby="`${controlsId}-closing-help`" rows="3" maxlength="1000" /></div>
            <LetterFormattingControls :formatting="form.formatting" :lang="lang || 'en'" template-mode @change="updateFormatting" />
          </div>
        </details>
      </form>
    </div>
  </section>
</template>

<style scoped>
.letter-templates{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;box-sizing:border-box;overflow:hidden;padding:0;color:var(--ui-text);background:transparent;font-family:var(--font-ui,system-ui)}
.template-heading{display:flex;flex:0 0 auto;justify-content:space-between;gap:20px;align-items:start;margin:0;padding-bottom:10px;border-bottom:1px solid var(--ui-divider)}
.letter-templates h2{font:700 22px/1.3 system-ui;text-transform:none;letter-spacing:0;margin:0;color:var(--ui-text)}
.letter-templates p,.template-library-controls p{margin:0;color:var(--ui-muted);font-size:13px;line-height:1.6}
.letter-templates :is(button,input,select,textarea),.template-library-controls :is(button,input,select){font:inherit;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-control);color:var(--ui-text);padding:10px 12px}
.letter-templates button,.template-library-controls button{cursor:pointer;font-size:13px;font-weight:600}
button:hover:not(:disabled){background:var(--ui-surface-hover)}
button:disabled{opacity:.55;cursor:default}
.letter-templates :is(button,input,select,textarea):focus-visible,.template-library-controls :is(button,input,select):focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.template-layout{display:grid;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden;grid-template-columns:minmax(180px,240px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:24px}
.template-layout--sidebar{grid-template-columns:minmax(0,1fr)}
.template-library-controls{width:100%;min-width:0;box-sizing:border-box;align-self:start;display:grid;gap:20px}
.template-library-section{display:grid;gap:10px;min-width:0}
.template-library-section h3{margin:0;font:600 13px/1.4 var(--font-ui);color:var(--ui-text)}
.template-library-controls .template-control-help{font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.template-control-help strong{font-weight:500;color:var(--ui-text)}
.template-library-controls button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:38px;text-align:center}
.template-library-section > button,.template-library-actions > button{width:100%;min-width:0;box-sizing:border-box}
.template-library-controls button svg,.template-default-status svg{flex:0 0 auto;width:14px}
.template-library-controls .template-create-action{margin-top:2px;border-color:var(--ui-accent-border);color:var(--ui-accent)}
.template-default{padding-top:18px;border-top:1px solid var(--ui-divider)}
.template-library-controls .template-default-status{display:flex;align-items:baseline;gap:8px;color:var(--ui-accent);font-size:13px;line-height:1.5}
.template-library-files{min-width:0;border-top:1px solid var(--ui-divider);padding-top:8px}
.template-library-files summary{padding:10px 0;cursor:pointer;font:600 13px/1.4 var(--font-ui);color:var(--ui-muted)}
.template-library-files summary:hover{color:var(--ui-text)}
.template-library-files summary:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.template-library-actions{display:grid;gap:10px;padding-top:4px}
.template-form{display:grid;align-content:start;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;}
.template-form > label {margin: 20px 10px}
.letter-templates label,.template-library-controls label{display:grid;gap:7px;font:600 12px/1.4 system-ui;color:var(--ui-text)}
.template-form > .template-section:first-child{border-top:0}
.template-section{min-width:0;border-top:1px solid var(--ui-divider)}
.template-section > summary{display:flex;align-items:center;gap:10px;min-height:48px;padding:8px 16px;box-sizing:border-box;cursor:pointer;list-style:none;font:600 14px/1.5 var(--font-ui);color:var(--ui-text)}
.template-section > summary::-webkit-details-marker{display:none}
.template-section > summary::marker{content:''}
.template-section > summary > svg{flex:0 0 auto;width:16px;color:var(--ui-accent)}
.template-section > summary > .template-chevron{margin-left:auto;width:12px;color:var(--ui-muted)}
.template-section[open] > summary > .template-chevron{transform:rotate(180deg)}
.template-section > summary:hover{color:var(--ui-accent)}
.template-section > summary:focus-visible{outline:2px solid var(--ui-accent);outline-offset:3px;border-radius:3px}
.template-section-fields{display:grid;gap:18px;padding:4px 16px 18px;min-width:0}
.template-field{display:grid;gap:7px;min-width:0}
.letter-templates :is(input,select,textarea),.template-library-controls :is(input,select){font:400 14px/1.5 var(--font-ui);min-width:0;width:100%;box-sizing:border-box}
textarea{resize:vertical}
.template-form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:760px){.letter-templates{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.template-layout{display:flex;flex:0 0 auto;flex-direction:column;overflow:visible;gap:24px}.template-heading{flex-direction:column;gap:10px;margin:0;padding-bottom:10px}.template-form-row{grid-template-columns:1fr}.template-form{overflow:visible;max-width:none}}
@media(max-width:760px){.letter-templates :is(input,select,textarea),.template-library-controls :is(input,select){font-size:16px}.letter-templates button,.template-library-controls button{min-height:44px}}
.template-form .template-checkbox { display:flex; align-items:center; justify-content:flex-start; gap:8px; min-height:44px; font-weight:400; }
.template-form .template-checkbox input { width:16px; height:16px; min-width:16px; margin:0; padding:0; flex:0 0 16px; }
</style>
