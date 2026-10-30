<script setup lang="ts">
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { computed, ref, watch } from 'vue';
import type { LocalRefinementRequest, RefinementProposalRow, RefinementRequestRow, RefinementScope } from '../refinementTypes';
import { refinementMatchesScope, refinementRunMetadata } from '../domain/refinementHistory';
import RefinementPrivacyPreview from './RefinementPrivacyPreview.vue';
import ConfirmDeletionDialog from '../../../shared/ui/ConfirmDeletionDialog.vue';
const props = defineProps<{
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; localRequests: Record<string, LocalRefinementRequest>;
  scope: RefinementScope;
  currentRequestId: string | null; activeId: string; reviewActive: boolean; accepted: boolean;
  canClear?: boolean;
  publicationStatus: 'unpublished' | 'current' | 'outdated' | 'unverifiable'; lang: string; busy: boolean; open: boolean;
}>();
const emit = defineEmits<{ clear: []; select: [id: string]; details: [open: boolean]; exportRequest: [id: string]; exportProposal: [id: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const unknown = () => text('Unknown', 'Unbekannt');
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(props.lang === 'de' ? 'de-DE' : 'en-GB') : unknown();
const runs = computed(() => props.requests.filter(row => refinementMatchesScope(row.request_json.scope, props.scope, row.cleared_scopes)).map(row => ({ row, metadata: refinementRunMetadata(row, props.localRequests[row.id]), proposals: props.proposals.filter(proposal => proposal.request_id === row.id) })));
const clearTitle = computed(() => props.scope === 'cv' ? text('Clear CV refinement history?', 'CV-Überarbeitungsverlauf löschen?') : props.scope === 'letter' ? text('Clear letter refinement history?', 'Brief-Überarbeitungsverlauf löschen?') : text('Clear refinement history?', 'Überarbeitungsverlauf löschen?'));
const clearMessage = computed(() => props.scope === 'cv'
  ? text('Restore the CV to its original state and remove its approval, then permanently delete its refinement rounds, proposals, comments, feedback and original snapshot. Your letter and its history are kept.', 'Den ursprünglichen CV-Stand wiederherstellen und seine Freigabe aufheben, dann seine Überarbeitungsrunden, Vorschläge, Kommentare, Rückmeldungen und den ursprünglichen Snapshot endgültig löschen. Brief und Briefverlauf bleiben erhalten.')
  : props.scope === 'letter'
    ? text('Reset the letter to an empty draft using the selected template’s defaults and remove its approval, then permanently delete its refinement rounds, proposals, comments, feedback and original snapshot. Your CV and its history are kept.', 'Den Brief auf einen leeren Entwurf mit den Einstellungen der ausgewählten Vorlage zurücksetzen und seine Freigabe aufheben, dann seine Überarbeitungsrunden, Vorschläge, Kommentare, Rückmeldungen und den ursprünglichen Snapshot endgültig löschen. CV und CV-Verlauf bleiben erhalten.')
    : text('Restore the original CV, reset the letter to its template and remove their approvals, then permanently delete all refinement rounds, proposals, comments, feedback and original snapshots.', 'Den ursprünglichen CV wiederherstellen, den Brief auf seine Vorlage zurücksetzen und ihre Freigaben aufheben, dann alle Überarbeitungsrunden, Vorschläge, Kommentare, Rückmeldungen und ursprünglichen Snapshots endgültig löschen.'));
const emptyMessage = computed(() => props.scope === 'cv' ? text('No CV refinement history yet.', 'Noch kein CV-Überarbeitungsverlauf.') : props.scope === 'letter' ? text('No motivation letter refinement history yet.', 'Noch kein Überarbeitungsverlauf für das Motivationsschreiben.') : text('No refinement history yet.', 'Noch kein Überarbeitungsverlauf.'));
const confirmingClear = ref(false);
const requestClear = () => { if (!props.busy && props.canClear) confirmingClear.value = true; };
const cancelClear = () => { confirmingClear.value = false; };
const confirmClear = () => {
  if (!confirmingClear.value) return;
  confirmingClear.value = false;
  if (!props.busy && props.canClear) emit('clear');
};
watch(() => props.busy || !props.canClear, disabled => { if (disabled) cancelClear(); });
watch(() => props.scope, cancelClear);
</script>

<template>
  <section class="refinement-history" :aria-label="text('Refinement runs', 'Überarbeitungsrunden')">
    <ConfirmDeletionDialog
      :visible="confirmingClear"
      :title="clearTitle"
      :message="clearMessage"
      :cancel-label="text('Cancel', 'Abbrechen')"
      :confirm-label="text('Clear history', 'Verlauf löschen')"
      @cancel="cancelClear"
      @confirm="confirmClear"
    />
    <details class="disclosure-row run-details" :open="open" @toggle="emit('details', ($event.target as HTMLDetailsElement).open)">
      <summary>{{ text('History', 'Verlauf') }}<InfoHint :lang="lang" :label="text('History', 'Verlauf')" :text="text('Historical metadata comes from saved records. Missing versions remain unknown.', 'Historische Metadaten stammen aus gespeicherten Datensätzen. Fehlende Versionen bleiben unbekannt.')" /></summary>
      <button type="button" class="btn btn--danger" :disabled="busy || !canClear" @click="requestClear">{{ text('Clear history', 'Verlauf löschen') }}</button>
      <p v-if="!runs.length" class="app-hint">{{ emptyMessage }}</p>
      <details v-for="run in runs" :key="run.row.id" class="disclosure-row history-run">
        <summary>{{ date(run.row.created_at) }} · {{ run.proposals.length }} {{ text('proposals', 'Vorschläge') }}{{ run.row.id === currentRequestId ? text(' · Current', ' · Aktuell') : '' }}</summary>
        <dl>
          <dt>{{ text('Request', 'Anfrage') }}</dt><dd><code>{{ run.metadata.requestId }}</code></dd>
          <dt>{{ text('Created', 'Erstellt') }}</dt><dd>{{ date(run.metadata.createdAt) }}</dd>
          <template v-if="scope !== 'letter'"><dt>{{ text('CV source revision', 'CV-Quellrevision') }}</dt><dd>{{ run.metadata.cvRevision ?? unknown() }}</dd>
          <dt>{{ text('Exact CV version', 'Exakte CV-Version') }}</dt><dd><code>{{ run.metadata.cvVersion ?? unknown() }}</code></dd></template>
          <template v-if="scope !== 'cv'"><dt>{{ text('Letter source version', 'Brief-Quellversion') }}</dt><dd><code>{{ run.metadata.letterVersion ?? unknown() }}</code></dd>
          <dt>{{ text('Template', 'Vorlage') }}</dt><dd>{{ run.metadata.templateName }} · r{{ run.metadata.templateRevision }}</dd></template>
          <dt>{{ text('Prompt version', 'Prompt-Version') }}</dt><dd>{{ run.metadata.promptVersion ?? unknown() }}</dd>
          <dt>{{ text('Schema version', 'Schemaversion') }}</dt><dd>{{ run.metadata.protocolVersion }}</dd>
          <dt>{{ text('Approved additional instructions', 'Freigegebene zusätzliche Hinweise') }}</dt><dd class="pre-wrap">{{ run.metadata.instructions || text('None supplied', 'Keine übermittelt') }}</dd>
        </dl>
        <button type="button" @click="emit('exportRequest', run.row.id)">{{ text('Export public request', 'Öffentliche Anfrage exportieren') }}</button>
        <div v-for="proposal in run.proposals" :key="proposal.id" class="history-proposal"><p><code>{{ proposal.id }}</code> · {{ date(proposal.created_at) }}</p><p>{{ proposal.proposal_json.summary }}</p><button type="button" :disabled="busy" @click="emit('select', proposal.id)">{{ text('Review this proposal', 'Diesen Vorschlag prüfen') }}</button><button type="button" @click="emit('exportProposal', proposal.id)">{{ text('Export proposal', 'Vorschlag exportieren') }}</button></div>
        <details class="disclosure-row"><summary>{{ text('Captured public sources', 'Gespeicherte öffentliche Quellen') }}</summary><RefinementPrivacyPreview :user-id="run.row.user_id" :request="run.row.request_json" :lang="lang" /></details>
      </details>
    </details>
  </section>
</template>

<style scoped>
.refinement-history{padding:0;font-size:13px;line-height:1.5}.current-run{padding:0 0 14px}h3{font-size:16px;margin:0 0 8px}p{margin:8px 0}code,dd{overflow-wrap:anywhere}code{font-size:11px;color:#a6c1b9}label{display:grid;gap:8px;margin-top:12px}select{width:100%;min-width:0}button,select{color:inherit;background:#0b1b25;border:1px solid #28534e;border-radius:6px;padding:8px;font:inherit}button{cursor:pointer;margin:5px 8px 5px 0}button:disabled{opacity:.5}dl{display:grid;grid-template-columns:minmax(90px,35%) minmax(0,1fr);gap:7px 12px}dt{color:#a6c1b9}dd{margin:0}.pre-wrap{white-space:pre-wrap}.history-proposal{border-left:2px solid #447565;margin:14px 0;padding-left:12px}
button.btn--danger{border-color:#ef4444;color:#fee2e2}
@media(max-width:600px){dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:9px}select{font-size:16px}}
</style>
