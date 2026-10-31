<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, useId, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adaptiveDashboardRunState, createAdaptiveSearchDashboardController, type AdaptiveDashboardSource, type AdaptiveDashboardQuery, type AdaptiveDashboardExecution, type AdaptiveDashboardProposal, type AdaptiveDashboardRun, type AdaptiveSettingsPatch } from '../composables/adaptiveSearchDashboard';
import type { ApprovedAdaptiveRule } from '../domain/adaptiveSearchPlanner';
import { useToasts, useToastWatch, useSaveStateToast } from '../../../shared/ui/useToasts';
import { commitPendingTextareas } from '../../../shared/editing/textareaCommit';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import AdaptiveSearchPolicyHint from './AdaptiveSearchPolicyHint.vue';

const props = defineProps<{ ownerId: string; searchId: string; projectRef: string; client: SupabaseClient | null; lang?: string; embedded?: boolean }>();
const emit = defineEmits<{ 'runner-changed': [] }>();
const controlsId = useId();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const controller = shallowRef<ReturnType<typeof createAdaptiveSearchDashboardController> | null>(null);
const localError = ref('');
const breadthDraft = ref(20);
const breadthDirty = ref(false);
let breadthSaving: Promise<boolean> | null = null;
const cadenceDrafts = reactive<Record<string,string>>({});
const cadenceDirty = reactive<Record<string,boolean>>({});
watch(() => [props.ownerId,props.searchId,props.projectRef,props.client] as const, () => {
  controller.value?.dispose(); controller.value = null; localError.value = '';
  breadthDraft.value = 20; breadthDirty.value = false; breadthSaving = null;
  for (const key of Object.keys(cadenceDrafts)) delete cadenceDrafts[key];
  for (const key of Object.keys(cadenceDirty)) delete cadenceDirty[key];
  void reload();
}, { immediate: true });
async function reload(): Promise<boolean> {
  if (!props.client || !props.searchId) return false;
  localError.value = '';
  try {
    if (!controller.value) {
      let storage: Storage | undefined; try { storage = sessionStorage; } catch { /* in-memory recovery */ }
      controller.value = createAdaptiveSearchDashboardController(props.client, { ownerId: props.ownerId, searchId: props.searchId, projectRef: props.projectRef }, { storage, onRunnerChanged: () => emit('runner-changed') });
    }
    const active = controller.value;
    return await active.load() && active === controller.value;
  } catch { localError.value = 'load_failed'; return false; }
}
const state = computed(() => controller.value?.state);
const data = computed(() => state.value?.data);
const busy = computed(() => !data.value || state.value?.loading || state.value?.saving);
const adaptiveReady = computed(() => data.value?.readiness.mode === 'adaptive' && data.value.readiness.ready
  && !data.value.readiness.migration_requested && data.value.runner_authorization.enabled);
const authorizationUnavailable = computed(() => !data.value?.runner_authorization.enabled && (state.value?.error === 'runner_unavailable'
  || ['project_mismatch', 'release_disabled', 'capability_missing', 'invalid_binding'].includes(data.value?.readiness.readiness_code ?? '')));
const authorizationHelp = computed(() => data.value?.readiness.readiness_code === 'project_mismatch'
  ? text('This search needs its configured project connection. Correct the connection, then refresh.', 'Diese Suche benötigt die konfigurierte Projektverbindung. Korrigiere die Verbindung und aktualisiere anschließend.')
  : data.value?.readiness.readiness_code === 'invalid_binding'
    ? text('The saved task binding needs repair. Complete task setup, then refresh.', 'Die gespeicherte Aufgabenverknüpfung muss repariert werden. Schließe die Aufgabeneinrichtung ab und aktualisiere anschließend.')
    : text('An administrator must configure and enable adaptive execution for this project. Refresh after setup.', 'Ein Administrator muss die adaptive Ausführung für dieses Projekt einrichten und aktivieren. Aktualisiere nach der Einrichtung.'));
const runnerLabel = computed(() => data.value?.readiness.mode === 'adaptive'
  ? data.value.readiness.migration_requested ? text('Adaptive search', 'Adaptiver Suchablauf') : text('Adaptive task confirmed', 'Adaptive Aufgabe bestätigt') : text('Legacy search', 'Bisheriger Suchablauf'));
const adaptationLabel = computed(() => !adaptiveReady.value || !data.value?.settings.adaptation_enabled
  ? text('Adaptation inactive', 'Anpassung inaktiv') : data.value.settings.adaptation_paused
    ? text('Adaptation paused', 'Anpassung pausiert') : text('Adaptation active', 'Anpassung aktiv'));
const pendingPreferences = computed(() => data.value?.preferences.suggestions.filter(suggestion => ['pending', 'undone'].includes(suggestion.state)).length ?? 0);
const showPreferences = computed(() => Boolean(data.value && (data.value.preferences.approved_rules.length || data.value.preferences.suggestions.length
  || data.value.preferences.proposals.length || data.value.omitted.preference_suggestions || data.value.omitted.proposals)));
const showSources = computed(() => Boolean(data.value && (data.value.sources.length || Object.keys(state.value?.drafts ?? {}).length
  || Object.values(cadenceDirty).some(Boolean) || data.value.omitted.sources || data.value.settings.institution_sources_omitted)));
const pendingSources = computed(() => data.value?.sources.filter(source => source.status === 'pending_identification').length ?? 0);
const showQueries = computed(() => Boolean(data.value && (data.value.queries.plan || data.value.queries.executions.length
  || data.value.omitted.queries || data.value.omitted.executions)));
watch(data, value => {
  if (breadthDirty.value && value?.settings.search_breadth_percent === breadthDraft.value) breadthDirty.value = false;
  if (!breadthDirty.value) breadthDraft.value = value?.settings.search_breadth_percent ?? 20;
  for (const source of value?.sources ?? []) {
    const sourceId = source.registry_id, local = cadenceDrafts[sourceId];
    if (cadenceDirty[sourceId] && local?.trim() && Number(local) === source.check_interval_hours && !state.value?.drafts[sourceId]) delete cadenceDirty[sourceId];
    if (!cadenceDirty[sourceId]) cadenceDrafts[sourceId] = String(state.value?.drafts[sourceId]?.check_interval_hours ?? source.check_interval_hours);
  }
});
const breadthAvailable = computed(() => data.value?.settings.search_breadth_percent !== null && data.value?.settings.breadth_revision !== null && data.value?.policy.policy_version !== 'adaptive-query-v1');
const breadthActive = computed(() => adaptiveReady.value && data.value?.settings.adaptation_enabled && !data.value.settings.adaptation_paused);
const breadthLabel = computed(() => breadthDraft.value === 0 ? text('Off', 'Aus') : breadthDraft.value <= 20 ? text('Focused', 'Fokussiert') : breadthDraft.value <= 50 ? text('Balanced', 'Ausgewogen') : text('Adventurous', 'Experimentierfreudig'));
const breadthValueText = computed(() => `${breadthDraft.value}% · ${breadthLabel.value}`);
const breadthAllocation = computed(() => {
  const capacity = data.value?.planning_capacity;
  if (!capacity) return text('The next run determines the available query slots.', 'Der nächste Lauf bestimmt die freien Abfrageplätze.');
  const count = Math.ceil(capacity.discretionary * breadthDraft.value / 100);
  return text(`At full capacity, at least ${count} of ${capacity.discretionary} free queries explore new directions.`, `Bei voller Kapazität prüfen mindestens ${count} von ${capacity.discretionary} freien Abfragen neue Suchrichtungen.`);
});
function draftBreadth(event: Event) {
  breadthDraft.value = Number((event.target as HTMLInputElement).value); breadthDirty.value = true;
}
async function saveBreadth(): Promise<boolean> {
  if (breadthSaving) return breadthSaving;
  const active = controller.value, value = breadthDraft.value;
  if (!breadthDirty.value) return true;
  if (!active || !breadthAvailable.value) return false;
  const pending = (async () => {
    const saved = await setting({ search_breadth_percent: value });
    if (active === controller.value && saved && breadthDraft.value === value) breadthDirty.value = false;
    return saved === true;
  })();
  breadthSaving = pending;
  try { return await pending; } finally { if (breadthSaving === pending) breadthSaving = null; }
}
const preview = computed(() => data.value ? JSON.stringify(data.value.feedback_preview,null,2) : '');
const orphanedDrafts = computed(() => Object.keys(state.value?.drafts ?? {}).filter(id => !data.value?.sources.some(source => source.registry_id === id)));
function discardDraft(id: string) { if (controller.value?.discardSourceDraft(id)) useToasts().notify({ tone: 'success', message: text('Local draft discarded. No new source change was sent.','Lokaler Entwurf verworfen. Keine neue Quellenänderung wurde gesendet.') }); }
const allocation = computed(() => {
  const plan = data.value?.queries.plan;
  if (!plan) return null;
  const core = plan.queries.filter(query => query.role === 'core').length;
  const adaptive = plan.queries.filter(query => query.role === 'adaptive').length;
  const exploration = plan.queries.filter(query => query.role === 'exploration');
  return { core, adaptive, exploration: exploration.length, actualExploration: data.value!.queries.executions.filter(check => check.kind === 'query' && exploration.some(query => query.query_id === check.query_id && query.text_hash === check.text_hash)).length };
});
const omittedCount = computed(() => data.value ? Object.values(data.value.omitted).reduce((sum,value) => sum+value,0) : 0);
const dashboardHelp = computed(() => [
  text('Settings apply on the next active adaptive run; activate the adaptive task first if you still use the legacy search. Pausing adaptation keeps your base search and sources.', 'Einstellungen gelten im nächsten aktiven adaptiven Lauf; aktiviere zuerst die adaptive Aufgabe, falls du noch den bisherigen Suchablauf nutzt. Eine Pause erhält deine Basissuche und Quellen.'),
  omittedCount.value ? text('Counts cover the records shown here.', 'Zählungen beziehen sich auf die hier angezeigten Datensätze.') : '',
].filter(Boolean).join(' '));
const breadthHelp = computed(() => [
  text('Use this share of free queries to explore new topics, role titles and sources; 0% turns exploration off.', 'Nutze diesen Anteil der freien Abfragen für neue Themen, Stellentitel und Quellen; 0 % schaltet die Erkundung aus.'),
  breadthAvailable.value ? breadthAllocation.value : text('Install the search-breadth database update to enable this control.', 'Installiere die Datenbankaktualisierung für die Suchbreite, um diesen Regler zu aktivieren.'),
  breadthAvailable.value && !breadthActive.value ? text('Activate and unpause adaptation to apply it.', 'Aktiviere die Anpassung und hebe die Pause auf, um dies anzuwenden.') : '',
].filter(Boolean).join(' '));
const automationHelp = computed(() => [
  data.value?.runner_authorization.enabled
    ? text('You have authorized this search to run in this project.', 'Du hast die Ausführung dieser Suche in diesem Projekt autorisiert.')
    : text('Authorize this search before activating the adaptive task.', 'Autorisiere diese Suche, bevor du die adaptive Aufgabe aktivierst.'),
  data.value?.readiness.migration_requested
    ? text('Paste the prepared task instructions into ChatGPT to finish activation.', 'Füge die vorbereiteten Aufgabenanweisungen in ChatGPT ein, um die Aktivierung abzuschließen.')
    : data.value?.readiness.mode === 'adaptive'
    ? text('Each run loads your latest feedback and source settings.', 'Jeder Lauf lädt dein aktuelles Feedback und deine Quelleneinstellungen.')
    : text('Choose Prepare ChatGPT update, then paste the replace prompt into ChatGPT.', 'Wähle ChatGPT-Update vorbereiten und füge danach die Ersetzungsanweisung in ChatGPT ein.'),
].join(' '));
const feedbackHelp = computed(() => text(
  'Searches use up to 16 examples and the first 600 characters of each evaluation; exclude an opportunity to withhold its feedback. Interest uses your 0–10 rating, then category (8, 6 or 2), then confirmed submission (9); contacts, application notes, CVs and letters stay private.',
  'Suchen nutzen bis zu 16 Beispiele und die ersten 600 Zeichen jeder Einschätzung; schließe eine Stelle aus, um ihr Feedback zurückzuhalten. Interesse folgt deiner Bewertung von 0–10, dann der Kategorie (8, 6 oder 2), dann einer bestätigten Einreichung (9); Kontakte, Bewerbungsnotizen, Lebensläufe und Briefe bleiben privat.',
));
const errorText = computed(() => {
  const code = localError.value || state.value?.error;
  return code === 'conflict' ? text('Another tab changed these settings. Reload the latest values, review your retained draft and save again.', 'Ein anderer Tab hat diese Einstellungen geändert. Lade die aktuellen Werte, prüfe den erhaltenen Entwurf und speichere erneut.')
    : code === 'denied' ? text('Access was denied. Check the signed-in owner and authorization before continuing.', 'Der Zugriff wurde verweigert. Prüfe das angemeldete Konto und die Autorisierung, bevor du fortfährst.')
      : code === 'source_unavailable' ? text('A retained source draft is outside the loaded view. Reload to inspect it, or explicitly discard that local draft.','Ein erhaltener Quellenentwurf liegt außerhalb der geladenen Ansicht. Lade zur Prüfung erneut oder verwirf diesen lokalen Entwurf ausdrücklich.')
      : code === 'breadth_upgrade_required' ? text('Install the search-breadth database update before changing this setting.', 'Installiere die Datenbankaktualisierung für die Suchbreite, bevor du diese Einstellung änderst.')
      : code === 'runner_unavailable' ? authorizationHelp.value
      : code === 'cadence' ? text('Use a whole number from 24 to 720 hours. Your input is kept.', 'Gib eine ganze Zahl zwischen 24 und 720 Stunden ein. Deine Eingabe bleibt erhalten.')
        : code === 'load_failed' ? text('The adaptive dashboard could not be loaded. Retry loading it.', 'Die adaptive Übersicht konnte nicht geladen werden. Versuche es erneut.')
          : code ? text('The change could not be saved. Your draft is kept. Retry the exact request or reload to review the latest values.', 'Die Änderung konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten. Wiederhole die genaue Anfrage oder lade die aktuellen Werte zur Prüfung.') : '';
});
useSaveStateToast(() => errorText.value ? 'error' : state.value?.saving ? 'saving' : 'saved', {
  scope: () => props.client && props.searchId ? `${props.ownerId}:${props.searchId}:${props.projectRef}` : null,
  messages: {
    saving: () => text('Saving adaptive search change…', 'Änderung der adaptiven Suche wird gespeichert…'),
    saved: () => text('Adaptive search change saved.', 'Änderung der adaptiven Suche gespeichert.'),
    error: () => errorText.value,
  },
  retry: { label: () => state.value?.retryable ? text('Retry exact request', 'Genaue Anfrage wiederholen') : text('Reload latest', 'Aktuelle Werte laden'), run: () => state.value?.retryable ? controller.value?.retry() : reload() },
});
useToastWatch(() => state.value?.loading ? text('Loading adaptive search…', 'Adaptive Suche wird geladen…') : '', { passive: true });
const date = (value: string | null) => value === null ? text('Unknown', 'Unbekannt') : new Intl.DateTimeFormat(props.lang === 'de' ? 'de' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const number = (value: number | null) => value === null ? text('Unknown', 'Unbekannt') : new Intl.NumberFormat(props.lang === 'de' ? 'de' : 'en', { maximumFractionDigits: 2 }).format(value);
const checked = (event: Event) => (event.target as HTMLInputElement).checked;
function setting(patch: AdaptiveSettingsPatch) {
  localError.value = '';
  try { return controller.value?.patchSettings(patch); } catch { localError.value = Object.hasOwn(patch,'reuse_check_interval_hours') ? 'cadence' : 'save_failed'; return Promise.resolve(false); }
}
function toggleAuthorization(): Promise<boolean> {
  if (busy.value || authorizationUnavailable.value || !controller.value || !data.value) return Promise.resolve(false);
  return controller.value.authorize(!data.value.runner_authorization.enabled);
}
function sourceFlag(source: AdaptiveDashboardSource, field: 'enabled' | 'pinned', enabled: boolean) {
  localError.value = ''; controller.value?.sourceDraft(source.registry_id, { [field]: enabled }); return controller.value?.saveSource(source.registry_id);
}
function sourceValue(source: AdaptiveDashboardSource, field: 'enabled' | 'pinned') { return state.value?.drafts[source.registry_id]?.[field] ?? source[field]; }
async function saveCadence(source: AdaptiveDashboardSource): Promise<boolean> {
  const value = cadenceDrafts[source.registry_id] ?? String(source.check_interval_hours), hours = Number(value), active = controller.value;
  if (!value.trim() || !Number.isSafeInteger(hours) || hours < 24 || hours > 720) { localError.value = 'cadence'; return false; }
  if (!active) return false;
  localError.value = ''; active.sourceDraft(source.registry_id, { check_interval_hours: hours });
  const saved = await active.saveSource(source.registry_id);
  if (active === controller.value && saved && cadenceDrafts[source.registry_id] === value) { delete cadenceDirty[source.registry_id]; cadenceDrafts[source.registry_id] = String(hours); }
  return saved;
}
async function flush(): Promise<boolean> {
  commitPendingTextareas(); const active = controller.value;
  if (!active) return true;
  while (breadthDirty.value) if (!await saveBreadth()) return false;
  for (const source of data.value?.sources ?? []) if (cadenceDirty[source.registry_id] && !await saveCadence(source)) return false;
  return localError.value !== 'cadence' && active === controller.value && await active.flush();
}
function ruleLabel(rule: ApprovedAdaptiveRule) {
  if (rule.kind === 'source_exclusion') return `${text('Exclude source','Quelle ausschließen')}: ${data.value?.sources.find(source => source.registry_id === rule.source_registry_id)?.institution ?? text('Reusable source','Wiederverwendbare Quelle')}`;
  const prefix = rule.kind === 'hard_exclusion' ? text('Hard exclusion','Verbindlicher Ausschluss') : rule.polarity === 'positive' ? text('Prefer','Bevorzugen') : text('Avoid','Vermeiden');
  return `${prefix}: ${rule.target}`;
}
function evidenceLabel(reference: string, index: number) {
  const example = data.value?.feedback_preview.examples.find(value => value.opportunity_id === reference);
  const title = example ? `${example.title}${example.institution ? ` · ${example.institution}` : ''}` : text('Reviewed opportunity outside this sampled preview','Geprüfte Stelle außerhalb dieser Stichprobenvorschau');
  return `${text('Evidence','Evidenz')} ${index+1}: ${title}`;
}
const suggestionState = (value: string) => ({ pending: text('Pending review','Prüfung ausstehend'), approved: text('Approved','Freigegeben'), rejected: text('Rejected','Abgelehnt'), undone: text('Undone','Zurückgenommen') })[value] ?? text('Unknown','Unbekannt');
const roleLabel = (value: string) => ({ core: text('Core','Kernabfrage'), adaptive: text('Adaptive','Adaptiv'), exploration: text('Exploration','Neue Suchrichtung') })[value] ?? value;
const statusLabel = (value: string | null) => value === null ? text('Unknown','Unbekannt') : ({ complete: text('Complete','Vollständig'), blocked: text('Blocked','Blockiert'), failed: text('Failed','Fehlgeschlagen'), partial: text('Partial','Teilweise'), paginated: text('Pagination incomplete','Seitensuche unvollständig'), dynamic: text('Dynamic page incomplete','Dynamische Seite unvollständig'), unreported: text('Not reported','Nicht dokumentiert'), running: text('Running','Läuft') })[value] ?? text('Unknown','Unbekannt');
const failureLabel = (value: string) => ({ access_denied: text('Access denied','Zugriff verweigert'), network_error: text('Network error','Netzwerkfehler'), pagination_limit: text('Pagination limit','Seitengrenze erreicht'), dynamic_content: text('Dynamic content','Dynamischer Inhalt'), budget_exhausted: text('Research budget exhausted','Recherchebudget ausgeschöpft'), unknown: text('Unknown cause','Unbekannte Ursache') })[value] ?? text('Unknown cause','Unbekannte Ursache');
const queryExecutions = (query: AdaptiveDashboardQuery) => data.value?.queries.executions.filter(check => check.kind === 'query' && check.query_id === query.query_id && check.text_hash === query.text_hash) ?? [];
function checkIdentity(check: AdaptiveDashboardExecution): string {
  if (check.kind === 'query') {
    const query = data.value?.queries.plan?.queries.find(query => query.query_id === check.query_id && query.text_hash === check.text_hash);
    return query ? query.query ?? text('Query text withheld', 'Abfragetext zurückgehalten') : text('Query outside the saved plan', 'Abfrage außerhalb des gespeicherten Plans');
  }
  const source = data.value?.sources.find(source => source.registry_id === check.source_registry_id);
  return source?.institution ?? source?.listing_url ?? text('Source outside this view or withheld', 'Quelle außerhalb dieser Ansicht oder zurückgehalten');
}
function proposalReason(proposal: AdaptiveDashboardProposal): string {
  return proposal.reason === 'adaptation_disabled' ? text('Adaptation inactive', 'Anpassung inaktiv')
    : proposal.reason === 'needs_verified_evidence' ? text('Needs verified evidence', 'Verifizierte Evidenz erforderlich')
      : proposal.reason === 'needs_reviewed_evidence' ? text('Needs reviewed evidence', 'Geprüfte Evidenz erforderlich')
        : text('Not applied', 'Nicht angewendet');
}
const sourceRole = (source: AdaptiveDashboardSource) => source.mandatory ? text('Mandatory source','Verbindliche Quelle') : source.pinned ? text('Pinned source','Angeheftete Quelle') : source.provenance === 'explicit' ? text('Explicit source','Eigene Quelle') : text('Retained discovery source','Beibehaltene Suchquelle');
function runLabel(run: AdaptiveDashboardRun) {
  return { failed: text('Failed run','Fehlgeschlagener Lauf'), incomplete: text('Incomplete research','Unvollständige Recherche'), unknown: text('Coverage unknown','Abdeckung unbekannt'),
    running: text('Running','Läuft'), empty: text('Successful empty search','Erfolgreiche Suche ohne Treffer'), complete: text('Complete','Vollständig') }[adaptiveDashboardRunState(run)];
}
function leadTime(run: AdaptiveDashboardRun) {
  if (run.deadline.exact_lead_time_hours !== null && !run.deadline.uncertain) return `${text('Mean evidenced lead time','Mittlere belegte Vorlaufzeit')}: ${number(run.deadline.exact_lead_time_hours)} ${text('hours','Stunden')}`;
  if (run.deadline.lower_lead_time_hours !== null && run.deadline.upper_lead_time_hours !== null) return `${text('Mean provisional lead-time bounds','Mittlere vorläufige Vorlaufzeitgrenzen')}: ${number(run.deadline.lower_lead_time_hours)}–${number(run.deadline.upper_lead_time_hours)} ${text('hours','Stunden')}`;
  return text('Unknown lead time','Unbekannte Vorlaufzeit');
}
defineExpose({ flush, reload });
onBeforeUnmount(() => controller.value?.dispose());
</script>

<template>
  <section class="adaptive-dashboard" :class="{ 'adaptive-dashboard--embedded': embedded }" :aria-labelledby="`${controlsId}-heading`" :aria-busy="state?.loading || state?.saving">
    <div class="adaptive-heading">
      <div class="adaptive-title-row">
        <h3 :id="`${controlsId}-heading`">{{ text('Adaptive feedback','Adaptives Feedback') }}</h3>
        <InfoHint :lang="lang" :label="text('Adaptive feedback','Adaptives Feedback')" :text="dashboardHelp" />
      </div>
      <button class="btn adaptive-refresh" type="button" :disabled="state?.saving || state?.loading || !client || !searchId" @click="reload()">{{ text('Refresh','Aktualisieren') }}</button>
    </div>
    <div v-if="!client || !searchId" class="adaptive-title-row">
      <span>{{ text('Adaptive controls','Adaptive Einstellungen') }}</span>
      <InfoHint :lang="lang" :label="text('Adaptive controls','Adaptive Einstellungen')" :text="text('Save the shared meta search to open its adaptive controls.','Speichere die gemeinsame Metasuche, um ihre adaptiven Einstellungen zu öffnen.')" />
    </div>
    <div v-if="errorText" class="adaptive-actions adaptive-recovery">
      <button v-if="state?.retryable" class="btn" type="button" :disabled="state?.saving" @click="controller?.retry()">{{ text('Retry exact request','Genaue Anfrage wiederholen') }}</button>
      <button class="btn" type="button" :disabled="state?.saving || state?.loading" @click="reload()">{{ text('Reload latest','Aktuelle Werte laden') }}</button>
    </div>
    <div v-if="orphanedDrafts.length" class="adaptive-recovery">
      <div class="adaptive-title-row">
        <h4>{{ text('Retained source drafts','Erhaltene Quellenentwürfe') }}</h4>
        <InfoHint :lang="lang" :label="text('Retained source drafts','Erhaltene Quellenentwürfe')" :text="text('Reload to review drafts outside this view, or discard a selected local draft.','Lade Entwürfe außerhalb dieser Ansicht zur Prüfung erneut oder verwirf einen ausgewählten lokalen Entwurf.')" />
      </div>
      <div v-for="(sourceId,index) in orphanedDrafts" :key="sourceId" class="adaptive-actions">
        <span>{{ text('Retained source draft','Erhaltener Quellenentwurf') }} {{ index+1 }}</span>
        <button class="btn" type="button" :disabled="state?.saving" @click="discardDraft(sourceId)">{{ text('Discard local draft','Lokalen Entwurf verwerfen') }}</button>
      </div>
    </div>
    <template v-if="data">
      <p class="adaptive-runner-state"><strong>{{ runnerLabel }}</strong><span v-if="data.readiness.migration_requested">{{ text('Adaptive setup pending', 'Adaptive Einrichtung ausstehend') }}</span><span>{{ adaptationLabel }}</span></p>
      <fieldset class="adaptive-settings" :disabled="busy">
        <legend class="sr-only">{{ text('Adaptive search settings','Einstellungen der adaptiven Suche') }}</legend>
        <div class="adaptive-settings-group">
          <AdaptiveSearchPolicyHint class="adaptive-policy-heading" :lang="lang" :policy="data.policy" />
          <div class="adaptive-setting-row adaptive-priorities">
            <label class="adaptive-check"><input type="checkbox" :checked="data.settings.adaptation_enabled" @change="setting({ adaptation_enabled: checked($event) })" />{{ text('Adapt query priorities','Suchprioritäten anpassen') }}</label>
            <label class="adaptive-check"><input type="checkbox" :checked="data.settings.adaptation_paused" @change="setting({ adaptation_paused: checked($event) })" />{{ text('Pause adaptation','Anpassung pausieren') }}</label>
          </div>
          <div class="adaptive-breadth">
            <div class="adaptive-title-row">
              <label :for="`${controlsId}-breadth`">{{ text('Search breadth','Suchbreite') }}</label>
              <InfoHint :id="`${controlsId}-breadth-help`" :lang="lang" :label="text('Search breadth','Suchbreite')" :text="breadthHelp" />
              <output :for="`${controlsId}-breadth`" class="adaptive-breadth-value">{{ breadthValueText }}</output>
            </div>
            <input :id="`${controlsId}-breadth`" type="range" min="0" max="100" step="5" :value="breadthDraft" :aria-valuetext="breadthValueText" :aria-describedby="`${controlsId}-breadth-help`" :disabled="!breadthAvailable" @input="draftBreadth" @change="saveBreadth()" />
            <div class="adaptive-breadth-scale" aria-hidden="true"><span>{{ text('Focused','Fokussiert') }}</span><span>{{ text('Balanced','Ausgewogen') }}</span><span>{{ text('Adventurous','Experimentierfreudig') }}</span></div>
          </div>
        </div>
        <div class="adaptive-settings-group adaptive-source-settings">
          <h4>{{ text('Source retention','Quellen beibehalten') }}</h4>
          <label class="adaptive-check"><input type="checkbox" :checked="data.settings.successful_source_reuse_enabled" @change="setting({ successful_source_reuse_enabled: checked($event) })" />{{ text('Retain verified useful source listings','Verifizierte nützliche Stellenquellen beibehalten') }}</label>
          <label class="adaptive-cadence">
            <span>{{ text('New retained-source interval (hours)','Intervall neuer beibehaltener Quellen (Stunden)') }}</span>
            <input type="number" min="24" max="720" step="1" :value="data.settings.reuse_check_interval_hours" @change="setting({ reuse_check_interval_hours: Number(($event.target as HTMLInputElement).value) })" />
          </label>
        </div>
      </fieldset>
    </template>
    <slot name="task-setup" />
    <template v-if="data">
      <details class="adaptive-section">
        <summary><span class="adaptive-section-title">{{ text('Automation authorization','Autorisierung der automatischen Suche') }}</span><FontAwesomeIcon :icon="faChevronDown" class="adaptive-chevron" aria-hidden="true" /></summary>
        <div class="adaptive-body">
          <div class="adaptive-title-row">
            <h4>{{ text('Runner status','Status des Suchablaufs') }}</h4>
            <InfoHint :lang="lang" :label="text('Automation authorization','Autorisierung der automatischen Suche')" :text="automationHelp" />
          </div>
          <dl class="adaptive-facts">
            <div><dt>{{ text('Authorization','Autorisierung') }}</dt><dd>{{ data.runner_authorization.enabled ? text('Authorized for this project','Für dieses Projekt autorisiert') : text('Owner authorization required','Autorisierung erforderlich') }}</dd></div>
            <div><dt>{{ text('Task setup','Aufgabeneinrichtung') }}</dt><dd>{{ data.readiness.migration_requested ? text('Adaptive setup pending','Adaptive Einrichtung ausstehend') : data.readiness.mode === 'adaptive' ? text('Adaptive task confirmed','Adaptive Aufgabe bestätigt') : text('Technical task update required','Technische Aufgabenaktualisierung erforderlich') }}</dd></div>
            <div v-if="!data.readiness.ready"><dt>{{ text('Runner readiness','Bereitschaft') }}</dt><dd>{{ data.readiness.readiness_code === 'owner_not_authorized' ? text('Owner authorization required','Autorisierung erforderlich') : text('Deployment or setup prerequisite not ready','Bereitstellung oder Einrichtung noch nicht bereit') }}</dd></div>
          </dl>
          <div class="adaptive-actions"><button class="btn" type="button" :disabled="busy || authorizationUnavailable" @click="toggleAuthorization()">{{ data.runner_authorization.enabled ? text('Revoke runner authorization','Ausführungsautorisierung widerrufen') : text('Authorize this search in this project','Diese Suche in diesem Projekt autorisieren') }}</button><InfoHint v-if="authorizationUnavailable" :lang="lang" :label="text('Authorization setup required','Einrichtung für Autorisierung erforderlich')" :text="authorizationHelp" /></div>
        </div>
      </details>
      <details class="adaptive-section">
        <summary><span class="adaptive-section-title">{{ text('Outgoing feedback preview','Vorschau des weitergegebenen Feedbacks') }}</span><span class="adaptive-count">{{ data.feedback_preview.counts.selected }} / {{ data.feedback_preview.counts.eligible }}</span><FontAwesomeIcon :icon="faChevronDown" class="adaptive-chevron" aria-hidden="true" /></summary>
        <div class="adaptive-body">
          <p class="adaptive-muted">{{ text('Feedback revision','Feedbackrevision') }} {{ data.feedback_preview.feedback_revision }} · {{ data.feedback_preview.counts.eligible }} {{ text('considered','berücksichtigt') }} · {{ data.feedback_preview.counts.selected }} {{ text('examples','Beispiele') }}</p>
          <div class="adaptive-title-row">
            <label :for="`${controlsId}-preview`">{{ text('Exact outgoing packet','Genaues weitergegebenes Paket') }}</label>
            <InfoHint :lang="lang" :label="text('Interest metric and privacy','Interessenwert und Datenschutz')" :text="feedbackHelp" />
          </div>
          <AutosaveTextarea :id="`${controlsId}-preview`" class="adaptive-packet" :model-value="preview" readonly rows="12" spellcheck="false" />
        </div>
      </details>
      <details v-if="showPreferences" class="adaptive-section"><summary><span class="adaptive-section-title">{{ text('Reviewed preferences','Geprüfte Präferenzen') }}</span><span class="adaptive-count">{{ data.preferences.approved_rules.length }} {{ text('active','aktiv') }} · {{ pendingPreferences }} {{ text('to review','zu prüfen') }}</span><FontAwesomeIcon :icon="faChevronDown" class="adaptive-chevron" aria-hidden="true" /></summary><div class="adaptive-body"><div class="adaptive-title-row"><h4>{{ text('Approved rules','Freigegebene Regeln') }}</h4><InfoHint :lang="lang" :label="text('Reviewed preferences','Geprüfte Präferenzen')" :text="text('Approve a suggestion to apply its rule to future searches. You can review suggestions without pausing research.','Gib einen Vorschlag frei, um seine Regel in künftigen Suchen anzuwenden. Du kannst Vorschläge prüfen, ohne die Recherche zu pausieren.')" /></div><p v-if="!data.preferences.approved_rules.length" class="adaptive-muted">{{ text('No approved preference rules.','Keine freigegebenen Präferenzregeln.') }}</p><ul class="adaptive-list"><li v-for="rule in data.preferences.approved_rules" :key="rule.rule_id"><span>{{ ruleLabel(rule) }}</span><details v-if="rule.evidence_refs.length" class="adaptive-evidence"><summary>{{ rule.evidence_refs.length }} {{ text('evidence references','Evidenzverweise') }}</summary><ul><li v-for="(reference,index) in rule.evidence_refs" :key="reference">{{ evidenceLabel(reference,index) }}</li></ul></details></li></ul><p v-if="data.omitted.preference_suggestions" class="adaptive-muted">{{ data.omitted.preference_suggestions }} {{ text('more preference suggestions outside this view','weitere Präferenzvorschläge außerhalb dieser Ansicht') }}</p><h4 v-if="data.preferences.suggestions.length">{{ text('Suggestions','Vorschläge') }}</h4><article v-for="suggestion in data.preferences.suggestions" :key="suggestion.suggestion_id" class="adaptive-entry"><p>{{ ruleLabel(suggestion.rule) }}</p><small>{{ suggestionState(suggestion.state) }} · {{ suggestion.rule.evidence_refs.length }} {{ text('evidence references','Evidenzverweise') }}</small><details v-if="suggestion.rule.evidence_refs.length" class="adaptive-evidence"><summary>{{ text('Evidence references','Evidenzverweise') }}</summary><ul><li v-for="(reference,index) in suggestion.rule.evidence_refs" :key="reference">{{ evidenceLabel(reference,index) }}</li></ul></details><div class="adaptive-actions"><button v-if="['pending','undone'].includes(suggestion.state)" class="btn" type="button" :disabled="busy" @click="controller?.decide(suggestion.suggestion_id,'approve')">{{ text('Approve rule','Regel freigeben') }}</button><button v-if="['pending','undone'].includes(suggestion.state)" class="btn" type="button" :disabled="busy" @click="controller?.decide(suggestion.suggestion_id,'reject')">{{ text('Reject','Ablehnen') }}</button><button v-if="['approved','rejected'].includes(suggestion.state)" class="btn" type="button" :disabled="busy" @click="controller?.decide(suggestion.suggestion_id,'undo')">{{ text('Undo decision','Entscheidung zurücknehmen') }}</button></div></article><div v-if="data.preferences.proposals.length || data.omitted.proposals" class="adaptive-deferred"><div class="adaptive-title-row"><h4>{{ text('Deferred proposals','Zurückgestellte Vorschläge') }}</h4><InfoHint :lang="lang" :label="text('Deferred proposals','Zurückgestellte Vorschläge')" :text="text('These proposals do not change your searches.','Diese Vorschläge ändern deine Suchen nicht.')" /></div><p v-for="proposal in data.preferences.proposals" :key="proposal.suggestion_id" class="adaptive-muted">{{ proposal.kind === 'source' ? text('Source proposal','Quellenvorschlag') : proposal.kind === 'query' ? text('Query proposal','Suchabfragevorschlag') : text('Preference proposal','Präferenzvorschlag') }} · {{ proposalReason(proposal) }}<template v-if="proposal.listing_url || proposal.vacancy_url"> · <a :href="proposal.listing_url ?? proposal.vacancy_url!" target="_blank" rel="noopener noreferrer">{{ text('View source','Quelle ansehen') }}</a></template><template v-else-if="proposal.query"> · {{ proposal.query }}</template></p><p v-if="data.omitted.proposals" class="adaptive-muted">{{ data.omitted.proposals }} {{ text('more proposals outside this view','weitere Vorschläge außerhalb dieser Ansicht') }}</p></div></div></details>
      <details v-if="showSources" class="adaptive-section"><summary><span class="adaptive-section-title">{{ text('Reusable sources','Wiederverwendbare Quellen') }}</span><span class="adaptive-count">{{ data.sources.length }} {{ text('recorded','erfasst') }}<template v-if="pendingSources"> · {{ pendingSources }} {{ text('pending','ausstehend') }}</template></span><FontAwesomeIcon :icon="faChevronDown" class="adaptive-chevron" aria-hidden="true" /></summary><div class="adaptive-body"><p v-if="data.settings.institution_sources_omitted" class="adaptive-muted">{{ text(`${data.settings.institution_sources_omitted} requested institution sources could not be retained within the source limit.`, `${data.settings.institution_sources_omitted} gewünschte Hochschulquellen konnten wegen der Quellengrenze nicht beibehalten werden.`) }}</p><p v-if="data.omitted.sources" class="adaptive-muted">{{ data.omitted.sources }} {{ text('more sources outside this view','weitere Quellen außerhalb dieser Ansicht') }}</p><article v-for="source in data.sources" :key="source.registry_id" class="adaptive-entry"><h4>{{ source.institution ?? text('Reusable listing','Wiederverwendbare Stellenliste') }}</h4><a v-if="source.listing_url" :href="source.listing_url" target="_blank" rel="noopener noreferrer">{{ source.listing_url }}</a><p v-else class="adaptive-muted">{{ text('Reusable listing missing or withheld; execution eligibility is unknown.','Wiederverwendbare Stellenliste fehlt oder wird zurückgehalten; Ausführbarkeit unbekannt.') }}</p><p class="adaptive-muted">{{ sourceRole(source) }} · {{ source.listing_verified_at ? `${text('Listing verified','Stellenliste verifiziert')}: ${date(source.listing_verified_at)}` : text('No verified listing time','Kein belegter Verifikationszeitpunkt') }}</p><div class="adaptive-setting-row"><label class="adaptive-check"><input type="checkbox" :checked="sourceValue(source,'pinned')" :disabled="busy" @change="sourceFlag(source,'pinned',checked($event))" />{{ text('Pinned','Angeheftet') }}</label><label class="adaptive-check"><input type="checkbox" :checked="sourceValue(source,'enabled')" :disabled="busy || !source.listing_url && !source.enabled" @change="sourceFlag(source,'enabled',checked($event))" />{{ text('Enabled','Aktiviert') }}</label><label class="adaptive-cadence">{{ text('Check every (hours)','Prüfen alle (Stunden)') }}<input type="number" min="24" max="720" step="1" :disabled="busy" :value="cadenceDrafts[source.registry_id] ?? source.check_interval_hours" @input="cadenceDrafts[source.registry_id]=($event.target as HTMLInputElement).value; cadenceDirty[source.registry_id]=true" @change="saveCadence(source)" @keydown.enter.prevent="saveCadence(source)" /></label></div><p>{{ text('Last attempted check','Letzter Prüfversuch') }}: {{ date(source.coverage.last_attempted_at ?? source.last_attempted_at) }} · {{ statusLabel(source.coverage.last_status) }}</p><p>{{ text('Last successful check','Letzte erfolgreiche Prüfung') }}: {{ date(source.last_successful_at) }}</p><p v-if="source.coverage.last_failure_reason" class="adaptive-muted">{{ text('Recent coverage problem','Letztes Abdeckungsproblem') }}: {{ failureLabel(source.coverage.last_failure_reason) }}</p><p class="adaptive-muted">{{ source.outcomes.sample_size }} {{ text('unique opportunities','eindeutige Stellen') }} · {{ source.outcomes.reviewed }} {{ text('reviewed','bewertet') }} · {{ text('Mean interest','Mittleres Interesse') }} {{ number(source.outcomes.mean_interest) }} · {{ source.outcomes.confirmed_submissions }} {{ text('confirmed submissions','bestätigte Einreichungen') }}</p></article></div></details>
      <details v-if="showQueries" class="adaptive-section"><summary><span class="adaptive-section-title">{{ text('Saved queries and actual checks','Gespeicherte Abfragen und tatsächliche Prüfungen') }}</span><FontAwesomeIcon :icon="faChevronDown" class="adaptive-chevron" aria-hidden="true" /></summary><div class="adaptive-body"><p v-if="!data.queries.plan" class="adaptive-muted">{{ text('No structured plan in this view. Legacy query roles and executions remain unknown.','Kein strukturierter Plan in dieser Ansicht. Frühere Abfragerollen und Ausführungen bleiben unbekannt.') }}</p><p v-if="data.omitted.queries" class="adaptive-muted">{{ data.omitted.queries }} {{ text('more saved queries outside this view','weitere gespeicherte Abfragen außerhalb dieser Ansicht') }}</p><template v-if="data.queries.plan"><p>{{ text('Plan revision','Planrevision') }} {{ data.queries.plan.revision }} · {{ text('Base / feedback / preferences','Basis / Feedback / Präferenzen') }} {{ data.queries.plan.basis.base_revision }} / {{ data.queries.plan.basis.feedback_revision }} / {{ data.queries.plan.basis.preference_revision }}</p><p v-if="allocation" class="adaptive-muted">{{ text('Saved allocation','Gespeicherte Aufteilung') }}: {{ allocation.core }} {{ text('core','Kernabfragen') }} / {{ allocation.adaptive }} {{ text('adaptive','adaptiv') }} / {{ allocation.exploration }} {{ text('exploration','Erkundung') }} · {{ allocation.actualExploration }} {{ text('recorded exploration checks','dokumentierte Erkundungsprüfungen') }}. {{ allocation.core >= data.policy.maximum_queries ? text('No discretionary query capacity remains.','Keine freie Abfragekapazität verbleibt.') : '' }}</p><p v-if="data.settings.query_plan_dirty" class="adaptive-muted">{{ text('Adaptive plan refresh due on the next active adaptive run.','Aktualisierung des adaptiven Plans im nächsten aktiven adaptiven Lauf fällig.') }}</p><article v-for="query in data.queries.plan.queries" :key="`${query.query_id}:${query.text_hash}`" class="adaptive-entry"><p>{{ query.query ?? text('Query text withheld','Abfragetext zurückgehalten') }}</p><small>{{ roleLabel(query.role) }}{{ query.manual ? ` · ${text('Manual','Manuell')}` : '' }} · {{ queryExecutions(query).length }} {{ text('recorded checks in this bounded history','dokumentierte Prüfungen in diesem begrenzten Verlauf') }}</small><p class="adaptive-muted">{{ query.outcomes.sample_size }} {{ text('unique verified opportunities','eindeutige verifizierte Stellen') }} · {{ query.outcomes.reviewed }} {{ text('reviewed','bewertet') }} · {{ query.outcomes.explicit_high_interest }} {{ text('explicit high-interest outcomes','ausdrücklich starkes Interesse') }} · {{ query.outcomes.confirmed_submissions }} {{ text('confirmed submissions','bestätigte Einreichungen') }} · {{ text('Mean interest','Mittleres Interesse') }} {{ number(query.outcomes.mean_interest) }}</p></article></template><h4>{{ text('Recent actual checks','Letzte tatsächliche Prüfungen') }}</h4><p v-if="data.omitted.executions" class="adaptive-muted">{{ data.omitted.executions }} {{ text('more recorded checks outside this view','weitere dokumentierte Prüfungen außerhalb dieser Ansicht') }}</p><p v-if="!data.queries.executions.length && !data.omitted.executions" class="adaptive-muted">{{ data.readiness.mode === 'legacy' ? text('Detailed adaptive checks are unavailable for the legacy search.','Detaillierte adaptive Prüfungen sind für den bisherigen Suchablauf nicht verfügbar.') : text('No recorded checks in this view.','Keine dokumentierten Prüfungen in dieser Ansicht.') }}</p><article v-for="check in data.queries.executions" :key="`${check.run_id}:${check.check_id}`" class="adaptive-entry"><p>{{ checkIdentity(check) }}</p><small>{{ date(check.attempted_at) }} · {{ check.kind === 'source' ? text('Source check','Quellenprüfung') : text('Query execution','Suchabfrage') }} · {{ statusLabel(check.status) }} · {{ check.results_count === null ? text('Results unknown','Ergebniszahl unbekannt') : `${check.results_count} ${text('results','Ergebnisse')}` }}</small><p v-if="check.failure_reason" class="adaptive-muted">{{ failureLabel(check.failure_reason) }}</p></article></div></details>
      <details class="adaptive-section"><summary><span class="adaptive-section-title">{{ text('Recent runs','Letzte Suchläufe') }}</span><span class="adaptive-count">{{ data.runs.length }}</span><FontAwesomeIcon :icon="faChevronDown" class="adaptive-chevron" aria-hidden="true" /></summary><div class="adaptive-body"><p v-if="!data.runs.length" class="adaptive-muted">{{ text('No search runs recorded.','Noch keine Suchläufe dokumentiert.') }}</p><article v-for="run in data.runs" :key="run.run_id" class="adaptive-entry"><h4>{{ runLabel(run) }}</h4><p>{{ date(run.started_at) }} → {{ date(run.completed_at) }}</p><p class="adaptive-muted">{{ text('Base / feedback / preferences','Basis / Feedback / Präferenzen') }}: {{ run.basis.base_revision }} / {{ run.basis.feedback_revision ?? text('Unknown','Unbekannt') }} / {{ run.basis.preference_revision ?? text('Unknown','Unbekannt') }} · {{ run.basis.protocol_version }} · {{ run.adaptive_contract_version === null ? text('Legacy attribution','Frühere Zuordnung unbekannt') : text('Adaptive run','Adaptiver Lauf') }}</p><p>{{ run.counts.new }} {{ text('new','neu') }} · {{ run.counts.updated }} {{ text('updated','aktualisiert') }} · {{ run.counts.verified }} {{ text('separately verified during the run','im Lauf separat verifiziert') }}</p><p>{{ run.counts.incomplete_sources }} {{ text('incomplete sources','unvollständige Quellen') }} · {{ run.counts.failed_checks }} {{ text('failed checks','fehlgeschlagene Prüfungen') }} · {{ run.counts.unresolved ?? text('Unknown','Unbekannt') }} {{ text('unresolved candidates','ungeklärte Kandidaten') }}</p><p class="adaptive-muted">{{ text('Candidate backlog','Kandidatenrückstand') }}: {{ run.backlog_candidates ?? text('Unknown','Unbekannt') }} · {{ text('Omitted candidates','Ausgelassene Kandidaten') }}: {{ run.backlog_omitted ?? text('Unknown','Unbekannt') }} · {{ text('Report overflow','Berichtsüberlauf') }}: {{ run.backlog_overflow === null ? text('Unknown','Unbekannt') : run.backlog_overflow ? text('Yes','Ja') : text('No','Nein') }}</p><p>{{ run.deadline.late_discoveries }} {{ text('confirmed late discoveries','bestätigte späte Entdeckungen') }} · {{ run.deadline.possible_late_discoveries }} {{ text('possibly late','möglicherweise spät') }} · {{ run.deadline.unknown }} {{ text('unknown deadlines','unbekannte Fristen') }}</p><p class="adaptive-muted">{{ leadTime(run) }} · {{ text('Notification delivery unknown','Benachrichtigungszustellung unbekannt') }}</p></article></div></details>
    </template>
  </section>
</template>

<style scoped>
.adaptive-dashboard { container-type: inline-size; min-width: 0; color: var(--ui-text); padding: 24px 0 8px; font: 400 13px/1.6 var(--font-ui); }
.adaptive-dashboard--embedded { padding-top: 4px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.adaptive-heading, .adaptive-title-row, .adaptive-setting-row, .adaptive-actions { display: flex; align-items: center; flex-wrap: wrap; min-width: 0; }
.adaptive-heading { justify-content: space-between; gap: 12px; padding-inline: 16px; margin-bottom: 20px; }
.adaptive-title-row { gap: 4px; }
.adaptive-setting-row, .adaptive-actions { gap: 8px 16px; }
.adaptive-heading h3 { margin: 0; font: 600 15px/1.5 var(--font-ui); color: inherit; }
.adaptive-runner-state { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 0 16px 16px; }
.adaptive-runner-state span { color: var(--ui-muted); }
.adaptive-dashboard .adaptive-refresh { padding: 7px 12px; }
.adaptive-dashboard p { margin: 0; max-width: 75ch; overflow-wrap: anywhere; }
.adaptive-dashboard h4 { margin: 0; font: 600 13px/1.6 var(--font-ui); }
.adaptive-muted, .adaptive-dashboard small { color: var(--ui-muted); font-size: 12px; }
.adaptive-settings { display: grid; gap: 24px; border: 0; padding: 0 16px 24px; margin: 0; min-width: 0; }
.adaptive-settings-group { display: grid; align-content: start; gap: 12px; min-width: 0; }
.adaptive-settings .adaptive-policy-heading { color: var(--ui-text); font-weight: 600; }
.adaptive-source-settings h4 { display: flex; align-items: center; min-height: 28px; }
.adaptive-dashboard .adaptive-check { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; min-height: 28px; cursor: pointer; font: inherit; }
.adaptive-dashboard .adaptive-check input[type="checkbox"] { box-sizing: border-box; width: 16px; min-width: 16px; max-width: 16px; height: 16px; margin: 0; padding: 0; accent-color: var(--ui-accent); flex: 0 0 16px; }
.adaptive-dashboard .adaptive-cadence { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; max-width: 380px; font: 400 12px/1.5 var(--font-ui); }
.adaptive-dashboard .adaptive-cadence input[type="number"] { box-sizing: border-box; width: 88px; min-width: 88px; max-width: 88px; flex: 0 0 88px; padding: 7px 9px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); font: 400 14px/1.5 var(--font-ui); font-variant-numeric: tabular-nums; }
.adaptive-breadth { display: grid; gap: 4px; min-width: 0; width: 100%; max-width: 560px; padding-top: 4px; }
.adaptive-dashboard .adaptive-breadth input[type="range"] { box-sizing: border-box; width: 100%; min-width: 0; min-height: 28px; margin: 0; padding: 0; border: 0; background: transparent; accent-color: var(--ui-accent); cursor: pointer; }
.adaptive-breadth-value { margin-inline-start: auto; font-variant-numeric: tabular-nums; color: var(--ui-muted); font-size: 12px; white-space: nowrap; }
.adaptive-breadth-scale { display: flex; justify-content: space-between; gap: 8px; color: var(--ui-muted); font-size: 11px; }
.adaptive-dashboard :is(button,input,summary):focus-visible, .adaptive-body :deep(textarea:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.adaptive-dashboard :is(button,input):disabled { opacity: .55; cursor: default; }
.adaptive-section { min-width: 0; border-top: 1px solid var(--ui-divider); }
.adaptive-section > summary { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 16px; box-sizing: border-box; list-style: none; cursor: pointer; font: 600 14px/1.5 var(--font-ui); }
.adaptive-section > summary::-webkit-details-marker { display: none; }
.adaptive-section > summary::marker { content: ''; }
.adaptive-section > summary:hover { background: var(--ui-surface-hover); }
.adaptive-section-title { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.adaptive-count { color: var(--ui-muted); font-weight: 400; font-variant-numeric: tabular-nums; white-space: nowrap; }
.adaptive-chevron { width: 12px; flex: 0 0 12px; color: var(--ui-muted); }
.adaptive-section[open] > summary > .adaptive-chevron { transform: rotate(180deg); }
.adaptive-body { display: grid; gap: 12px; padding: 4px 16px 24px; min-width: 0; }
.adaptive-body :deep(textarea) { width: 100%; min-width: 0; box-sizing: border-box; resize: vertical; padding: 12px; background: var(--ui-control); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 7px; font: 400 12px/1.6 var(--font-ui); }
.adaptive-body :deep(textarea.adaptive-packet) { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
.adaptive-facts { display: grid; gap: 8px; margin: 0 0 4px; }
.adaptive-facts > div { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr); gap: 8px 20px; max-width: 640px; }
.adaptive-facts dt { color: var(--ui-muted); }
.adaptive-facts dd { margin: 0; overflow-wrap: anywhere; }
.adaptive-list { display: grid; gap: 8px; margin: 0; padding-inline-start: 18px; }
.adaptive-list li { overflow-wrap: anywhere; }
.adaptive-list small { display: block; }
.adaptive-evidence { color: var(--ui-muted); font-size: 12px; }
.adaptive-evidence > summary { cursor: pointer; }
.adaptive-evidence ul { margin: 6px 0; padding-inline-start: 18px; }
.adaptive-entry { display: grid; gap: 8px; padding: 16px 0; border-top: 1px solid var(--ui-divider); min-width: 0; }
.adaptive-entry:first-of-type { border-top: 0; padding-top: 0; }
.adaptive-entry:last-child { padding-bottom: 0; }
.adaptive-entry a { overflow-wrap: anywhere; color: var(--ui-accent); text-underline-offset: 3px; }
.adaptive-recovery { display: grid; gap: 8px; padding: 0 16px 20px; }
@container (min-width: 720px) {
  .adaptive-settings { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 32px; }
  .adaptive-source-settings { padding-inline-start: 32px; border-inline-start: 1px solid var(--ui-divider); }
}
@media (max-width: 760px) {
  .adaptive-heading { padding-inline: 4px; margin-bottom: 16px; }
  .adaptive-runner-state { padding-inline: 4px; }
  .adaptive-settings { padding-inline: 4px; gap: 20px; }
  .adaptive-source-settings { padding-top: 16px; border-top: 1px solid var(--ui-divider); }
  .adaptive-section > summary, .adaptive-body, .adaptive-recovery { padding-inline: 4px; }
  .adaptive-section > summary { gap: 8px; }
  .adaptive-dashboard button:not(.info-hint__button), .adaptive-dashboard .adaptive-check, .adaptive-dashboard .adaptive-breadth input[type="range"] { min-height: 44px; }
  .adaptive-dashboard .adaptive-cadence input[type="number"] { font-size: 16px; min-height: 44px; }
  .adaptive-body :deep(textarea) { font-size: 16px; }
}
</style>
