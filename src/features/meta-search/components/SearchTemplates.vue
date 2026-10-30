<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfiguration } from '../../../platform/supabase/supabase';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faAlignLeft, faChevronDown, faClock, faCopy, faGlobe, faSliders } from '@fortawesome/free-solid-svg-icons';
import type { SearchTemplate, SearchTemplateCloudBinding } from '../searchTypes';
import { createSearchTemplateRepository, readSearchTemplate, searchTemplateContentKey } from '../data/useSearchTemplates';
import { buildReplaceSearchPrompt, buildSearchSystemPrompt, buildSearchUserPrompt, isSearchTemplateSaved } from '../domain/searchPrompts';
import { listCloudSearchTemplates, importCloudSearchTemplate, saveSearchTemplate } from '../data/searchTemplateCloud';
import { loadAdaptiveSearchRunnerState, requestAdaptiveSearchRunner, type AdaptiveSearchRunnerState } from '../domain/adaptiveSearchTask';
import { commitPendingTextareas } from '../../../shared/editing/textareaCommit';
import { flushEditorSession } from '../../../shared/editing/editorSession';
import { copyPreparedText } from '../../../shared/lib/preparedClipboard';
import { clearSearchDraft, recoverSearchDraft, retainSearchDraft } from '../data/searchTemplateRecovery';
import { useDesktopSidebar } from '../../../shared/ui/desktopSidebar';
import { useToastWatch, useSaveStateToast } from '../../../shared/ui/useToasts';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import DesktopSidebarPortal from '../../../shared/ui/DesktopSidebarPortal.vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import AdaptiveSearchPolicyHint from './AdaptiveSearchPolicyHint.vue';
import AdaptiveSearchDashboard from './AdaptiveSearchDashboard.vue';

const props = withDefaults(defineProps<{ userId: string; lang?: string; sidebarActive?: boolean; projectId?: string; client?: SupabaseClient | null }>(), { sidebarActive: true });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
function failureMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : null;
  return code === '42501' || code === 'PGRST301' || code === 'PGRST302'
    ? text('Access was denied. Check the signed-in owner and search authorization before retrying.', 'Der Zugriff wurde verweigert. Prüfe das angemeldete Konto und die Suchautorisierung, bevor du es erneut versuchst.')
    : text('The search request failed. Check the connection and setup, then retry. Your draft is retained.', 'Die Suchanfrage ist fehlgeschlagen. Prüfe Verbindung und Einrichtung und versuche es erneut. Dein Entwurf bleibt erhalten.');
}
const controlsId = useId();
const desktopSidebar = useDesktopSidebar();
const connectedProjectId = computed(() => props.projectId || (supabaseConfiguration.status === 'ready' ? new URL(supabaseConfiguration.url).hostname.split('.')[0] : undefined));
const form = ref<SearchTemplate | null>(null);
const status = ref<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
const error = ref('');
const notice = ref('');
const loadingCloud = ref(false);
const loadError = ref(false);
const copying = ref(false);
const copiedFallback = ref('');
const runner = ref<AdaptiveSearchRunnerState | null>(null);
const preparingRunner = ref(false);
const runnerError = ref('');
const adaptiveDashboard = ref<InstanceType<typeof AdaptiveSearchDashboard> | null>(null);
let requestedSetupId: string | null = null;
let copiedSetup: { key: string; id: string } | null = null;
useSaveStateToast(() => status.value, {
  scope: () => `${props.userId}:meta-search`,
  active: () => props.sidebarActive,
  messages: {
    saving: () => text('Saving meta search…', 'Metasuche wird gespeichert…'),
    saved: () => text('Meta search saved.', 'Metasuche gespeichert.'),
    error: () => error.value,
  },
  retry: { label: () => text('Retry', 'Erneut versuchen'), run: () => loadError.value || !form.value ? retryLoad() : retrySave() },
});
useToastWatch(() => props.sidebarActive ? runnerError.value : '', { tone: 'error' });
useToastWatch(() => props.sidebarActive && status.value !== 'error' ? error.value : '', { tone: 'error' });
useToastWatch(() => props.sidebarActive && loadingCloud.value ? text('Loading meta search…', 'Metasuche wird geladen…') : '', { passive: true });
useToastWatch(() => props.sidebarActive ? notice.value : '', { tone: 'success' });
let editingOwner = props.userId;
let baseline: SearchTemplate | null = null;
let binding: SearchTemplateCloudBinding | undefined;
let dirty = false;
let replacing = false;
let disposed = false;
let ownerGeneration = 0;
let editorSessionEpoch = 0;
watch([() => props.userId, () => props.client, () => props.sidebarActive], () => { editorSessionEpoch++; }, { flush: 'sync' });
let typingVersion = 0;
let modelVersion = 0;
let committedTypingVersion = 0;
let ready: Promise<void> = Promise.resolve();
let queue: Promise<unknown> = Promise.resolve();
let pending: Promise<boolean> | null = null;
let pendingKey: string | null = null;
let failedWrite: SearchTemplate | null = null;
const repository = () => createSearchTemplateRepository(localStorage, editingOwner);
function replace(value: SearchTemplate | null) {
  replacing = true; form.value = value ? { ...clone(value), active: true } : null; baseline = value ? clone(value) : null;
  dirty = false; replacing = false; committedTypingVersion = typingVersion;
}
function onDraftInput() { typingVersion++; status.value = 'unsaved'; notice.value = ''; copiedFallback.value = ''; }
function patchBinding(value: SearchTemplateCloudBinding) {
  binding = clone(value);
  replacing = true;
  if (form.value) form.value.cloud = clone(value);
  if (baseline) baseline.cloud = clone(value);
  replacing = false;
}
async function initialize(owner: string, token: number) {
  const client = props.client;
  if (!client) throw new Error(text('Connect Supabase to save the meta search.', 'Verbinde Supabase, um die Metasuche zu speichern.'));
  const version = typingVersion; const initialModelVersion = modelVersion;
  const initial = form.value;
  const hasLocal = !!localStorage.getItem(`cv.search-templates.v1:${encodeURIComponent(owner || 'local')}`);
  const localPending = !!recoverSearchDraft(owner) || !!initial && (initial.cloud ? !isSearchTemplateSaved(initial) : hasLocal);
  loadingCloud.value = true;
  try {
    const rows = await listCloudSearchTemplates(client, owner);
    if (disposed || token !== ownerGeneration) return;
    const row = initial?.cloud ? rows.find(item => item.id === initial.cloud!.id) : rows.find(item => item.meta_search?.version === 1) || rows[0];
    if (initial?.cloud && !row) throw new Error('The saved meta search is unavailable. Your local draft is retained.');
    if (row) {
      const saved = importCloudSearchTemplate(row);
      binding = saved.cloud;
      if (!localPending && !dirty && typingVersion === version && modelVersion === initialModelVersion) {
        replace(saved);
        const stored = repository().saveTemplate(saved, null);
        baseline = clone(stored);
        replacing = true; form.value = clone(stored); replacing = false;
      } else if (saved.cloud) patchBinding({ ...saved.cloud, contentKey: initial?.cloud?.contentKey || '' });
      const loadedRunner = await loadAdaptiveSearchRunnerState(client, owner, row.id, connectedProjectId.value || '');
      if (disposed || token !== ownerGeneration) return;
      if (!loadedRunner && row.meta_search?.recurringPrompt.includes('private.begin_adaptive_opportunity_search')) {
        throw new Error(text('The saved adaptive runner is unavailable. Restore its readiness helper before changing task instructions.', 'Der gespeicherte adaptive Ablauf ist nicht verfügbar. Zuerst seine Bereitschaftsfunktion wiederherstellen, bevor Aufgabenanweisungen geändert werden.'));
      }
      runner.value = loadedRunner; runnerError.value = '';
    }
    status.value = form.value && isSearchTemplateSaved(form.value) && typingVersion === committedTypingVersion ? 'saved' : 'unsaved';
  } finally { if (token === ownerGeneration) loadingCloud.value = false; }
}
function commitSnapshot(forceCloud = false): Promise<boolean> {
  if (!form.value) return Promise.resolve(false);
  const owner = editingOwner; const token = ownerGeneration; const inputVersion = typingVersion;
  let snapshot: SearchTemplate;
  try {
    snapshot = repository().saveTemplate(readSearchTemplate(form.value), baseline);
    baseline = clone(snapshot);
    replacing = true; form.value = clone(snapshot); replacing = false;
    dirty = false; committedTypingVersion = inputVersion;
  } catch (cause) {
    retainSearchDraft(owner, form.value, baseline);
    error.value = failureMessage(cause); status.value = 'error';
    return Promise.resolve(false);
  }
  const key = searchTemplateContentKey(snapshot);
  if (pending && pendingKey === key) return pending;
  if (!forceCloud && !pending && !failedWrite && isSearchTemplateSaved(snapshot)) { status.value = 'saved'; return Promise.resolve(true); }
  retainSearchDraft(owner, snapshot, baseline);
  const client = props.client;
  const initialization = ready;
  status.value = 'saving'; error.value = '';
  const current = () => !disposed && token === ownerGeneration && owner === editingOwner;
  const operation = queue.then(async () => {
    try {
      await initialization;
      if (!current() || !client) return false;
      const options = { projectId: connectedProjectId.value, runner: runner.value };
      status.value = 'saving';
      let result: SearchTemplate;
      if (failedWrite) {
        result = await saveSearchTemplate(client, owner, failedWrite, options);
        if (!current()) return false;
        patchBinding(result.cloud!); failedWrite = null;
        if (searchTemplateContentKey(result) !== key) {
          failedWrite = { ...snapshot, cloud: binding }; result = await saveSearchTemplate(client, owner, failedWrite, options);
        }
      } else {
        failedWrite = { ...snapshot, cloud: binding || snapshot.cloud };
        result = await saveSearchTemplate(client, owner, failedWrite, options);
      }
      if (!current()) return false;
      failedWrite = null; patchBinding(result.cloud!);
      // Store only the acknowledgment on the newest local version, preserving newer edits.
      const latest = repository().listTemplates()[0]!;
      if (latest.id === snapshot.id) {
        const stored = repository().saveTemplate({ ...latest, cloud: result.cloud }, latest);
        if (baseline) { baseline.cloud = clone(result.cloud); baseline.revision = stored.revision; baseline.updatedAt = stored.updatedAt; }
      }
      clearSearchDraft(owner, snapshot.id, key);
      const unchanged = !!form.value && searchTemplateContentKey(form.value) === key && typingVersion === inputVersion;
      status.value = unchanged ? 'saved' : 'unsaved'; error.value = '';
      return unchanged;
    } catch (cause) {
      if (current()) { error.value = failureMessage(cause); status.value = 'error'; }
      return false;
    }
  }).finally(() => { if (current() && pending === operation) { pending = null; pendingKey = null; } });
  pending = operation; pendingKey = key; queue = operation;
  return operation;
}
function flushSave(): Promise<boolean> {
  commitPendingTextareas();
  if (loadError.value) return Promise.resolve(false);
  if (loadingCloud.value && !dirty) return ready.then(() => commitSnapshot(), () => false);
  return commitSnapshot();
}
function flushTextareas() {
  const epoch = editorSessionEpoch, token = ownerGeneration;
  let dashboard = adaptiveDashboard.value;
  return flushEditorSession({
    current: () => !disposed && epoch === editorSessionEpoch && token === ownerGeneration && (!dashboard || dashboard === adaptiveDashboard.value),
    steps: [flushSave, () => {
      // The first acknowledgement can mount this editor. Capture it only after
      // the session has checked for newer drafts, then keep its identity fixed.
      dashboard ??= adaptiveDashboard.value;
      return dashboard ? dashboard.flush() : true;
    }],
    settled: () => typingVersion === committedTypingVersion,
  });
}
const flush = flushTextareas;
defineExpose({ flush, flushSave, flushTextareas });
watch(form, () => {
  if (replacing || !form.value) return;
  modelVersion++;
  dirty = true; status.value = 'unsaved'; notice.value = ''; copiedFallback.value = '';
}, { deep: true, flush: 'sync' });
watch(() => props.userId, id => {
  if (form.value && (dirty || !isSearchTemplateSaved(form.value))) retainSearchDraft(editingOwner, form.value, baseline);
  ownerGeneration++; editingOwner = id; copying.value = false;
  pending = null; pendingKey = null; failedWrite = null; binding = undefined; queue = Promise.resolve();
  runner.value = null; runnerError.value = ''; preparingRunner.value = false; requestedSetupId = null; copiedSetup = null;
  error.value = ''; notice.value = ''; loadError.value = false; replace(null);
  try {
    const local = repository().listTemplates()[0]!; const recovered = recoverSearchDraft(id);
    replace(recovered?.form || local); baseline = recovered?.baseline || clone(local); binding = local.cloud;
    const token = ownerGeneration;
    ready = initialize(id, token).catch(cause => {
      if (!disposed && token === ownerGeneration) { loadError.value = true; error.value = failureMessage(cause); status.value = 'error'; }
      throw cause;
    });
    void ready.catch(() => {});
  } catch (cause) { error.value = failureMessage(cause); status.value = 'error'; }
}, { immediate: true });
async function retryLoad() {
  const token = ownerGeneration;
  ready = initialize(editingOwner, token);
  try {
    await ready;
    if (disposed || token !== ownerGeneration) return;
    loadError.value = false; error.value = ''; await flushSave();
  } catch (cause) {
    if (disposed || token !== ownerGeneration) return;
    loadError.value = true; error.value = failureMessage(cause); status.value = 'error';
  }
}
function retrySave() { return loadError.value ? retryLoad() : flushSave(); }
const systemPreview = computed(() => { try { return form.value ? buildSearchSystemPrompt(form.value, { projectId: connectedProjectId.value, runner: runner.value }) : ''; } catch { return ''; } });
const userPreview = computed(() => { try { return form.value ? buildSearchUserPrompt(form.value, { projectId: connectedProjectId.value, runner: runner.value }) : ''; } catch { return ''; } });
async function refreshRunnerState() {
  const token = ownerGeneration, owner = editingOwner, search = form.value?.cloud?.id, project = connectedProjectId.value, client = props.client;
  if (!search || !project || !client) return;
  try {
    const loaded = await loadAdaptiveSearchRunnerState(client, owner, search, project);
    if (disposed || token !== ownerGeneration) return;
    runner.value = loaded; runnerError.value = '';
  } catch (cause) { if (!disposed && token === ownerGeneration) runnerError.value = failureMessage(cause); }
}
async function prepareRunner() {
  if (preparingRunner.value) return;
  const token = ownerGeneration; preparingRunner.value = true; runnerError.value = '';
  try {
    if (!await flushTextareas() || disposed || token !== ownerGeneration || !props.client || !binding || !connectedProjectId.value) return;
    const currentRunner = runner.value || await loadAdaptiveSearchRunnerState(props.client, editingOwner, binding.id, connectedProjectId.value);
    if (disposed || token !== ownerGeneration) return;
    if (!currentRunner?.ready) throw new Error(text('Install and enable the adaptive batch release and authorize this search before preparing its task update.', 'Zuerst die adaptive Batch-Version installieren und aktivieren sowie diese Suche autorisieren.'));
    requestedSetupId ||= currentRunner.migration_requested && currentRunner.setup_id ? currentRunner.setup_id : crypto.randomUUID();
    const requested = await requestAdaptiveSearchRunner(props.client, editingOwner, binding.id, connectedProjectId.value, currentRunner.revision, requestedSetupId);
    if (disposed || token !== ownerGeneration) return;
    runner.value = requested;
    if (!await flushTextareas() || disposed || token !== ownerGeneration) return;
    if (!await commitSnapshot(true)) return;
    requestedSetupId = null;
    notice.value = text('Adaptive instructions prepared. Copy the replace prompt to update the selected task in ChatGPT.', 'Adaptive Anweisungen vorbereitet. Die Ersetzungsanweisung kopieren, um die ausgewählte Aufgabe in ChatGPT zu aktualisieren.');
  } catch (cause) { if (!disposed && token === ownerGeneration) runnerError.value = failureMessage(cause); }
  finally { if (token === ownerGeneration) preparingRunner.value = false; }
}
async function copy() {
  if (copying.value) return;
  const token = ownerGeneration; copying.value = true; notice.value = '';
  try {
    const result = await copyPreparedText(async () => {
      if (!await flushTextareas() || !form.value || token !== ownerGeneration || disposed) return null;
      const owner = editingOwner, search = form.value.cloud?.id, project = connectedProjectId.value, client = props.client;
      const inputVersion = typingVersion, draftVersion = modelVersion;
      if (!search || !project || !client) throw new Error(text('Connect the saved search to Supabase before copying its setup.', 'Die gespeicherte Suche vor dem Kopieren ihrer Einrichtung mit Supabase verbinden.'));
      // A previous ChatGPT read may have claimed setup since the editor loaded.
      // Refresh on this explicit action and retain its identity for reconciliation.
      const loaded = await loadAdaptiveSearchRunnerState(client, owner, search, project);
      if (disposed || token !== ownerGeneration || editingOwner !== owner || props.client !== client || connectedProjectId.value !== project
        || form.value?.cloud?.id !== search || typingVersion !== inputVersion || modelVersion !== draftVersion
        || typingVersion !== committedTypingVersion || status.value !== 'saved') return null;
      if (!loaded && runner.value) throw new Error(text('The setup readiness helper is unavailable. Reload before copying task instructions.', 'Die Bereitschaftsfunktion ist nicht verfügbar. Vor dem Kopieren der Aufgabenanweisung neu laden.'));
      runner.value = loaded; runnerError.value = '';
      let setupId: string | undefined;
      if (loaded) {
        const key = `${project}:${search}:${form.value.cloud!.revision}:${loaded.revision}:${loaded.binding?.task_id || ''}`;
        if (loaded.setup_id) copiedSetup = { key, id: loaded.setup_id };
        else if (copiedSetup?.key !== key) copiedSetup = { key, id: crypto.randomUUID() };
        setupId = copiedSetup!.id;
      }
      return buildReplaceSearchPrompt(form.value, { projectId: project, runner: loaded, setupId });
    });
    if (!result || disposed || token !== ownerGeneration) return;
    if (result.copied) notice.value = text('Replacement instruction copied. Paste it into ChatGPT to replace the meta-search schedule.', 'Ersetzungsanweisung kopiert. In ChatGPT einfügen, um den Metasuch-Zeitplan zu ersetzen.');
    else { copiedFallback.value = result.value; notice.value = text('Select and copy the instruction below.', 'Die Anweisung unten markieren und kopieren.'); }
  } catch (cause) { if (!disposed && token === ownerGeneration) error.value = failureMessage(cause); }
  finally { if (token === ownerGeneration) copying.value = false; }
}
onBeforeUnmount(() => { if (form.value && status.value !== 'saved') retainSearchDraft(editingOwner, form.value, baseline); disposed = true; ownerGeneration++; });
</script>
<template>
  <section class="search-templates" :aria-busy="loadingCloud || status === 'saving'">
    <header class="search-heading">
      <h2>{{ text('Meta research', 'Metasuche') }}<InfoHint :lang="lang" :label="text('Meta research', 'Metasuche')" :text="text('One daily search with a shared profile. Reuse its research interests in motivation letters.', 'Eine tägliche Suche mit einem gemeinsamen Profil. Seine Forschungsinteressen auch für Motivationsschreiben verwenden.')" /></h2>
    </header>
    <button v-if="error && !form" type="button" @click="retryLoad">{{ text('Retry loading search', 'Suche erneut laden') }}</button>
    <div class="search-layout" :class="{ 'search-layout--sidebar': desktopSidebar && sidebarActive }">
      <DesktopSidebarPortal area="major" :active="sidebarActive">
        <aside class="search-library" :aria-label="text('Meta research actions', 'Metasuchaktionen')">
          <div class="search-action-row">
            <button class="search-primary" type="button" :disabled="copying || preparingRunner || loadingCloud || !client" @click="copy"><FontAwesomeIcon :icon="faCopy" aria-hidden="true" />{{ copying ? text('Preparing…', 'Vorbereiten…') : text('Copy replace prompt', 'Ersetzungsanweisung kopieren') }}</button>
            <InfoHint :lang="lang" :label="text('Replace meta search', 'Metasuche ersetzen')" :text="text('Edits save to Supabase on blur or Enter. Copy this short instruction and paste it into ChatGPT to read the saved prompt and replace the existing meta-search scheduled task. Copying itself does not change the schedule.', 'Änderungen werden beim Verlassen des Felds oder mit Enter in Supabase gespeichert. Die kurze Anweisung kopieren und in ChatGPT einfügen, um den gespeicherten Prompt zu lesen und die bestehende geplante Metasuche zu ersetzen. Kopieren selbst ändert den Zeitplan nicht.')" />
          </div>
          <AdaptiveSearchPolicyHint :lang="lang" />
        </aside>
      </DesktopSidebarPortal>
      <div v-if="form" class="search-editor">
      <form class="search-form" @submit.prevent="flushSave" @focusout="flushSave" @input.capture="onDraftInput">
        <button v-if="status === 'error'" type="button" @click="retrySave">{{ text('Retry save', 'Speichern erneut versuchen') }}</button>
        <details class="search-section" open>
          <summary><FontAwesomeIcon :icon="faAlignLeft" aria-hidden="true" /><span>{{ text('Shared search profile', 'Gemeinsames Suchprofil') }}</span><InfoHint :lang="lang" :label="text('Shared search profile', 'Gemeinsames Suchprofil')" :text="text('Write entries in English, separated by semicolons. Research directions are alternatives: a position can match one direction or a useful combination. The system prompt applies verification, deduplication, scoring and the 72-hour deadline rule.', 'Einträge auf Englisch schreiben und mit Semikolons trennen. Forschungsrichtungen sind Alternativen: Eine Stelle kann zu einer Richtung oder einer sinnvollen Kombination passen. Der Systemprompt ergänzt Verifikation, Deduplizierung, Bewertungen und die 72-Stunden-Fristregel.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields">
            <div class="hint-label-row"><label :for="`${controlsId}-opportunities`">{{ text('Opportunity / job types and sources', 'Stellenarten und Quellen') }}</label><InfoHint :lang="lang" :label="text('Opportunity / job types and sources', 'Stellenarten und Quellen')" :text="text('Separate entries with ;. Describe the roles you want and the job sources to search. Distinguish required conditions from preferences.', 'Einträge mit ; trennen. Gewünschte Stellenarten und zu durchsuchende Quellen beschreiben. Verbindliche Bedingungen von Präferenzen unterscheiden.')" /></div>
            <AutosaveTextarea :id="`${controlsId}-opportunities`" v-model.lazy="form.opportunityDescription" lang="en" rows="5" maxlength="12000" :placeholder="text('Role types; preferred job sources; source descriptions', 'Stellenarten; bevorzugte Quellen; Quellenbeschreibung')" @commit="flushSave" />
            <div class="hint-label-row"><label :for="`${controlsId}-interests`">{{ text('Research interests, preferred and avoided tasks', 'Forschungsinteressen, bevorzugte und unerwünschte Aufgaben') }}</label><InfoHint :lang="lang" :label="text('Research interests', 'Forschungsinteressen')" :text="text('Separate directions, preferred tasks or methods, and avoided tasks with ;. A role may fit one direction or several; it need not fulfill every interest. State hard exclusions explicitly. These interests can also guide motivation letters, without claiming qualifications.', 'Forschungsrichtungen, bevorzugte Aufgaben oder Methoden und unerwünschte Aufgaben mit ; trennen. Eine Stelle kann zu einer oder mehreren Richtungen passen und muss nicht alle Interessen erfüllen. Harte Ausschlüsse ausdrücklich benennen. Diese Interessen können auch Motivationsschreiben anleiten, ohne Qualifikationen zu behaupten.')" /></div>
            <AutosaveTextarea :id="`${controlsId}-interests`" v-model.lazy="form.researchInterests" lang="en" rows="6" maxlength="12000" :placeholder="text('Alternative research directions; preferred tasks / methods; avoided tasks', 'Alternative Forschungsrichtungen; bevorzugte Aufgaben / Methoden; unerwünschte Aufgaben')" @commit="flushSave" />
            <div class="hint-label-row"><label :for="`${controlsId}-funding`">{{ text('Salary, funding and conditions', 'Gehalt, Finanzierung und Bedingungen') }}</label><InfoHint :lang="lang" :label="text('Salary, funding and conditions', 'Gehalt, Finanzierung und Bedingungen')" :text="text('Separate salary or funding expectations, contract conditions, start preferences and other conditions with ;. Unspecified preferences do not create additional filters.', 'Erwartungen an Gehalt oder Finanzierung, Vertragsbedingungen, Startpräferenzen und weitere Bedingungen mit ; trennen. Nicht genannte Präferenzen erzeugen keine zusätzlichen Filter.')" /></div>
            <AutosaveTextarea :id="`${controlsId}-funding`" v-model.lazy="form.fundingConditions" lang="en" rows="4" maxlength="12000" :placeholder="text('Salary / funding; contract conditions; preferred start', 'Gehalt / Finanzierung; Vertragsbedingungen; bevorzugter Beginn')" @commit="flushSave" />
          </div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faGlobe" aria-hidden="true" /><span>{{ text('Regions and language priorities', 'Regionale und sprachliche Prioritäten') }}</span><InfoHint :lang="lang" :label="text('Regions and language priorities', 'Regionale und sprachliche Prioritäten')" :text="text('List preferred regions in priority order and distinguish preferences from exclusions.', 'Bevorzugte Regionen nach Priorität auflisten und Präferenzen von Ausschlüssen unterscheiden.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><label :for="`${controlsId}-locations`">{{ text('Region and language preferences', 'Regionale und sprachliche Präferenzen') }}</label><AutosaveTextarea :id="`${controlsId}-locations`" v-model.lazy="form.locationPreferences" lang="en" rows="5" maxlength="12000" @commit="flushSave" /></div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faAlignLeft" aria-hidden="true" /><span>{{ text('Additional search instructions', 'Zusätzliche Suchanweisungen') }}</span><InfoHint :lang="lang" :label="text('Additional search instructions', 'Zusätzliche Suchanweisungen')" :text="text('Optional English instructions that extend the shared profile. The installed search protocol still governs verification and saving.', 'Optionale englische Anweisungen, die das gemeinsame Profil ergänzen. Das installierte Suchprotokoll regelt weiterhin Verifikation und Speicherung.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><label :for="`${controlsId}-strategy`">{{ text('User prompt', 'Nutzerprompt') }}</label><AutosaveTextarea :id="`${controlsId}-strategy`" v-model.lazy="form.userPrompt" lang="en" rows="5" maxlength="12000" @commit="flushSave" /></div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faClock" aria-hidden="true" /><span>{{ text('Daily schedule', 'Täglicher Zeitplan') }}</span><InfoHint :lang="lang" :label="text('Daily schedule', 'Täglicher Zeitplan')" :text="text('Time and context save automatically. Copy the replacement instruction into ChatGPT to apply the saved schedule. Successful runs without new or materially changed strong matches stay quiet.', 'Uhrzeit und Kontext werden automatisch gespeichert. Die Ersetzungsanweisung in ChatGPT einfügen, um den gespeicherten Zeitplan anzuwenden. Erfolgreiche Läufe ohne neue oder wesentlich geänderte starke Treffer bleiben still.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><div class="search-schedule"><label>{{ text('Daily time', 'Tägliche Uhrzeit') }}<input v-model="form.dailyTime" type="time" required @change="flushSave" /></label><label>{{ text('Time zone', 'Zeitzone') }}<input v-model="form.timezone" placeholder="Europe/Tirane" required @change="flushSave" /></label></div></div>
          <div class="search-fields search-runner-setup" :aria-label="text('Technical task setup', 'Technische Aufgaben-Einrichtung')">
            <div class="hint-label-row"><strong>{{ text('Technical runner', 'Technischer Suchablauf') }}</strong><InfoHint :lang="lang" :label="text('Technical runner', 'Technischer Suchablauf')" :text="text('Prepare the adaptive contract once, then copy the replacement instruction. Current criteria and feedback load on every run; ordinary edits need no task replacement. Schedule or technical changes require an explicit task update. A saved binding records a task-tool receipt, not proof of unattended execution.', 'Den adaptiven Ablauf einmal vorbereiten und danach die Ersetzungsanweisung kopieren. Aktuelle Kriterien und Rückmeldungen werden bei jedem Lauf geladen; normale Änderungen benötigen keinen Aufgabenersatz. Zeitplan- oder technische Änderungen erfordern eine ausdrückliche Aktualisierung. Eine gespeicherte Bindung belegt eine Werkzeugbestätigung, keinen unbeaufsichtigten Erfolg.')" /></div>
            <InfoHint :lang="lang" :label="text('Runner setup', 'Suchablauf-Einrichtung')" :text="runner?.mode === 'adaptive' ? text('Adaptive runner installed. Search edits take effect on the next run.', 'Adaptiver Ablauf eingerichtet. Suchänderungen gelten ab dem nächsten Lauf.') : runner?.migration_requested ? text('Adaptive update prepared; task-tool confirmation is pending.', 'Adaptive Aktualisierung vorbereitet; Aufgabenbestätigung steht aus.') : text('Existing runner preserved. Adaptive setup requires an explicit update.', 'Bisheriger Ablauf bleibt erhalten. Die adaptive Einrichtung erfordert eine ausdrückliche Aktualisierung.')" />
            <p v-if="runner?.binding">{{ text('Bound task', 'Verknüpfte Aufgabe') }}: <code>{{ runner.binding.task_id }}</code></p>
            <InfoHint v-if="runner && !runner.ready" :lang="lang" :label="text('Adaptive setup unavailable', 'Adaptive Einrichtung nicht verfügbar')" :text="runner.readiness_code" />
            <button type="button" :disabled="preparingRunner || copying || loadingCloud || !client" @click="prepareRunner">{{ preparingRunner ? text('Preparing…', 'Vorbereiten…') : text('Prepare adaptive task update', 'Adaptive Aufgabenaktualisierung vorbereiten') }}</button>
          </div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faSliders" aria-hidden="true" /><span>{{ text('Generated prompts', 'Generierte Prompts') }}</span><InfoHint :lang="lang" :label="text('Generated prompts', 'Generierte Prompts')" :text="text('These are the complete English prompts saved in Supabase. The short replacement instruction tells ChatGPT where to read them. Search execution keeps the existing research protocol.', 'Dies sind die vollständigen englischen Prompts in Supabase. Die kurze Ersetzungsanweisung zeigt ChatGPT, wo es sie lesen kann. Die Suchausführung verwendet weiterhin das bestehende Forschungsprotokoll.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><div class="search-prompt-title"><label :for="`${controlsId}-system`">System prompt</label></div><AutosaveTextarea :id="`${controlsId}-system`" :model-value="systemPreview" readonly lang="en" rows="10" /><div class="search-prompt-title"><label :for="`${controlsId}-user`">User prompt</label></div><AutosaveTextarea :id="`${controlsId}-user`" :model-value="userPreview" readonly lang="en" rows="10" /></div>
        </details>
        <div v-if="copiedFallback" class="search-fields"><label :for="`${controlsId}-fallback`">{{ text('Select and copy prompt', 'Prompt markieren und kopieren') }}</label><AutosaveTextarea :id="`${controlsId}-fallback`" :model-value="copiedFallback" readonly lang="en" rows="12" /></div>
      </form>
      <AdaptiveSearchDashboard v-if="client && form.cloud?.id && connectedProjectId" ref="adaptiveDashboard" :owner-id="userId" :search-id="form.cloud.id" :project-ref="connectedProjectId" :client="client" :lang="lang" @runner-changed="refreshRunnerState" />
      </div>
      <InfoHint v-else :lang="lang" :label="text('Search recovery', 'Suchwiederherstellung')" :text="text('Your saved search could not be opened. Recover its backup before importing another file.', 'Deine gespeicherte Suche konnte nicht geöffnet werden. Stelle ihre Sicherung wieder her, bevor du eine weitere Datei importierst.')" />
    </div>
  </section>
</template>

<style scoped>
.search-templates { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 28px 32px; color: var(--ui-text); overflow: hidden; }
.search-heading { margin-bottom: 20px; flex-shrink: 0; }
.search-heading h2 { margin: 0 0 8px; font: 700 22px/1.3 var(--font-ui); color: var(--ui-text); text-shadow: none; text-transform: none; letter-spacing: 0; }
.search-templates p, .search-library p { margin: 0; max-width: 75ch; color: var(--ui-muted); font-size: 13px; line-height: 1.6; }
.search-runner-setup { font-family: var(--font-ui); }
.search-runner-setup strong { font-size: 13px; font-weight: 600; }
.search-runner-setup code { overflow-wrap: anywhere; }
.search-layout { display: grid; grid-template-columns: minmax(180px, 240px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 24px; min-width: 0; min-height: 0; flex: 1 1 0; overflow: hidden; }
.search-layout--sidebar { grid-template-columns: minmax(0, 1fr); }
.search-library { display: grid; align-content: start; gap: 16px; min-width: 0; }
.search-editor { min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; overscroll-behavior: contain; }
.search-form { min-width: 0; min-height: 0; }
.search-action-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.search-action-row > button { flex: 1; min-width: 0; }
.search-templates :is(button, input, select, textarea), .search-library :is(button, input, select) { box-sizing: border-box; min-width: 0; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); padding: 10px 12px; font: 400 14px/1.5 var(--font-ui); }
.search-templates :is(input, select, textarea), .search-library select { width: 100%; }
.search-templates button, .search-library button { display: inline-flex; justify-content: center; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600; }
.search-templates button:hover:not(:disabled), .search-library button:hover:not(:disabled) { background: var(--ui-surface-hover); }
.search-templates button:disabled, .search-library button:disabled { opacity: .55; cursor: default; }
.search-templates :is(button,input,select,textarea,summary):focus-visible, .search-library :is(button,select,summary):focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.search-templates label, .search-library label { display: grid; gap: 7px; color: var(--ui-text); font: 600 12px/1.4 var(--font-ui); }
.search-section { border-top: 1px solid var(--ui-divider); min-width: 0; }
.search-section > summary { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 8px 16px; box-sizing: border-box; cursor: pointer; list-style: none; font: 600 14px/1.5 var(--font-ui); }
.search-section > summary::-webkit-details-marker { display: none; }
.search-section > summary::marker { content: ''; }
.search-section > summary > svg { width: 16px; flex-shrink: 0; color: var(--ui-accent); }
.search-section > summary > .search-chevron { margin-left: auto; width: 12px; color: var(--ui-muted); }
.search-section[open] > summary > .search-chevron { transform: rotate(180deg); }
.search-fields { display: grid; gap: 12px; padding: 4px 16px 22px; min-width: 0; }
.search-fields > label:not(:first-child) { margin-top: 6px; }
.search-schedule { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: end; }
.search-library .search-primary { color: var(--ui-accent); border-color: var(--ui-accent-border); }
.search-library .search-copy-actions p { font-size: 12px; }
.search-files { border-top: 1px solid var(--ui-divider); padding-top: 12px; }
.search-files summary { cursor: pointer; font: 600 13px/1.5 var(--font-ui); color: var(--ui-muted); }
.search-file-actions { display: grid; gap: 10px; margin-top: 12px; }
.search-prompt-title { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.search-templates textarea { resize: vertical; caret-color: var(--ui-accent); }
@media (max-width: 760px) {
  .search-templates { padding: 20px 12px; overflow: auto; overscroll-behavior: contain; }
  .search-heading { margin-bottom: 20px; }
  .search-layout { display: flex; flex-direction: column; flex: 0 0 auto; overflow: visible; }
  .search-editor { overflow: visible; }
  .search-schedule { grid-template-columns: minmax(0, 1fr); }
  .search-templates :is(input,select,textarea), .search-library select { font-size: 16px; }
  .search-templates button:not(.info-hint__button), .search-library button:not(.info-hint__button) { min-height: 44px; }
  .search-fields { padding-left: 4px; padding-right: 4px; }
}
</style>
