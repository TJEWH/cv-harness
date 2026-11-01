<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { useToasts } from '../../../shared/ui/useToasts';
import { isAdaptiveStartupDenial, AdaptiveStartupTransportError } from '../domain/adaptiveSearchTransport';
import { buildAdaptiveLifecycleInstruction, callAdaptiveLifecycle, decodeAdaptiveLifecycleNativeResponse, persistAdaptiveLifecycleIntent,
  persistAdaptiveLifecycleResponse, readAdaptiveLifecycleIntent, readAdaptiveLifecycleResponses,
  type AdaptiveLifecycleAction, type AdaptiveLifecycleBinding, type AdaptiveLifecycleIntent, type AdaptiveLifecycleMode, type AdaptiveLifecycleOperation } from '../domain/adaptiveSearchLifecycle';

const props = defineProps<{ client: SupabaseClient | null; ownerId: string; searchId: string; projectRef: string; lang?: string }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const controlsId = useId(), toasts = useToasts();
const pending = ref(false), journalUnavailable = ref(false);
const savedIntent = shallowRef<AdaptiveLifecycleIntent | null>(null);
const operation = shallowRef<AdaptiveLifecycleOperation | null>(null);
let revision = 0;
const binding = (): AdaptiveLifecycleBinding => ({ ownerId: props.ownerId, searchId: props.searchId, projectRef: props.projectRef });
const key = () => `lifecycle:${props.ownerId}:${props.projectRef}:${props.searchId}`;
const unavailable = computed(() => pending.value || !props.client || journalUnavailable.value || savedIntent.value?.blocked);
const confirmed = computed(() => operation.value?.outcome === 'aborted' && operation.value.abort.verified && operation.value.abort.lease_released);
const canApply = computed(() => operation.value?.outcome === 'prepared' && operation.value.target !== null && !unavailable.value);
const canStartCommand = computed(() => !savedIntent.value || operation.value && ['no_active_run', 'ambiguous_active_run', 'target_changed', 'binding_changed'].includes(operation.value.outcome)
  || confirmed.value && operation.value?.restart.status === 'not_requested');
const help = computed(() => text('Abort blocks further database writes from the selected execution and preserves saved work. A restart reserves one new run; run-aware research dispatch is unavailable here.',
  'Abbrechen sperrt weitere Datenbankschreibvorgänge dieses Laufs und erhält gespeicherte Arbeit. Ein Neustart reserviert einen neuen Lauf; dessen Forschungsausführung kann hier nicht gestartet werden.'));
function outcomeLabel(value: AdaptiveLifecycleOperation['outcome']) {
  const labels = { prepared: ['Ready for confirmation', 'Bereit zur Bestätigung'], no_active_run: ['No active execution', 'Keine aktive Ausführung'],
    ambiguous_active_run: ['Execution target ambiguous', 'Ausführungslauf nicht eindeutig'], target_changed: ['Execution target changed', 'Ausführungslauf geändert'],
    binding_changed: ['Automation binding changed', 'Automationsverknüpfung geändert'], aborted: ['Execution aborted', 'Ausführung abgebrochen'] } as const;
  const label = labels[value]; return text(label[0], label[1]);
}
function restartLabel(value: AdaptiveLifecycleOperation['restart']['status']) {
  const labels = { not_requested: ['Not requested', 'Nicht angefordert'], reserved_not_dispatched: ['Reserved; not dispatched', 'Reserviert; nicht gestartet'],
    startup_accepted: ['Startup accepted; research dispatch unknown', 'Start angenommen; Forschungsausführung unbekannt'],
    complete: ['Run complete', 'Lauf abgeschlossen'], failed: ['Restart failed', 'Neustart fehlgeschlagen'], blocked: ['Restart blocked', 'Neustart blockiert'] } as const;
  const label = labels[value]; return text(label[0], label[1]);
}
watch(() => [props.ownerId, props.searchId, props.projectRef, props.client] as const, () => {
  revision++; pending.value = false; operation.value = null; savedIntent.value = null; journalUnavailable.value = false;
  try { savedIntent.value = readAdaptiveLifecycleIntent(localStorage, binding()); }
  catch {
    journalUnavailable.value = true;
    toasts.notify({ key: key(), tone: 'error', message: text('The local operation checkpoint is unavailable. Restore browser storage before preparing an execution action.',
      'Der lokale Aktionsspeicher ist nicht verfügbar. Stelle den Browserspeicher wieder her, bevor du eine Ausführungsaktion vorbereitest.') });
  }
}, { immediate: true });
onBeforeUnmount(() => { revision++; });
function saveIntent(value: AdaptiveLifecycleIntent) {
  persistAdaptiveLifecycleIntent(localStorage, binding(), value);
  savedIntent.value = value;
}
function invoke(client: SupabaseClient, action: AdaptiveLifecycleAction, current: AdaptiveLifecycleIntent, prior?: AdaptiveLifecycleOperation) {
  const selected = binding(), capturedIntent = { ...current };
  try {
    if (JSON.stringify(readAdaptiveLifecycleIntent(localStorage, selected)) !== JSON.stringify(capturedIntent)) throw new Error('Changed local operation.');
    persistAdaptiveLifecycleIntent(localStorage, selected, capturedIntent);
    readAdaptiveLifecycleResponses(localStorage, selected, capturedIntent);
  } catch {
    journalUnavailable.value = true;
    throw new AdaptiveStartupTransportError('lifecycle_checkpoint_unavailable');
  }
  return callAdaptiveLifecycle(client, action, selected, capturedIntent, prior,
    response => persistAdaptiveLifecycleResponse(localStorage, selected, capturedIntent, action, response));
}
function announce(error: unknown) {
  const code = error instanceof AdaptiveStartupTransportError ? error.code : 'local_operation_failed';
  if (['lifecycle_checkpoint_unavailable', 'lifecycle_capture_invalid', 'lifecycle_capture_oversized'].includes(code)) journalUnavailable.value = true;
  if (isAdaptiveStartupDenial(error) && savedIntent.value) {
    savedIntent.value = { ...savedIntent.value, blocked: true };
    try { saveIntent(savedIntent.value); } catch { journalUnavailable.value = true; }
  }
  toasts.notify({ key: key(), tone: 'error', message: text(`Execution operation stopped (${code}).`, `Ausführungsaktion gestoppt (${code}).`) });
}
async function prepare(mode: AdaptiveLifecycleMode, reuse = false) {
  if (unavailable.value || !props.client || (reuse ? !savedIntent.value || savedIntent.value.mode !== mode || operation.value !== null : !canStartCommand.value)) return;
  const token = revision, client = props.client;
  pending.value = true;
  toasts.notify({ key: key(), tone: 'info', message: text('Preparing the exact execution target…', 'Genauen Ausführungslauf vorbereiten…') });
  try {
    const next = reuse ? savedIntent.value! : { operation_id: crypto.randomUUID(), mode, blocked: false };
    saveIntent(next); operation.value = null;
    const result = await invoke(client, 'prepare', next);
    if (token !== revision) return;
    operation.value = result;
    toasts.notify({ key: key(), tone: result.outcome === 'prepared' ? 'success' : 'warning', message: result.outcome === 'prepared'
      ? text('Execution pinned. Confirm the requested abort below.', 'Lauf festgelegt. Bestätige unten den gewünschten Abbruch.')
      : result.outcome === 'no_active_run' ? text('No active execution. Nothing was aborted or started.', 'Kein aktiver Lauf. Nichts wurde abgebrochen oder gestartet.')
        : text('The execution target could not be selected safely.', 'Der Ausführungslauf konnte nicht sicher bestimmt werden.') });
  } catch (error) { if (token === revision) announce(error); }
  finally { if (token === revision) pending.value = false; }
}
async function check() {
  const client = props.client, current = savedIntent.value;
  if (unavailable.value || !client || !current) return;
  const token = revision; pending.value = true;
  toasts.notify({ key: key(), tone: 'info', message: text('Reading the saved operation…', 'Gespeicherte Aktion lesen…') });
  try {
    const result = await invoke(client, 'read', current, operation.value ?? undefined);
    if (token !== revision) return;
    operation.value = result;
    toasts.notify({ key: key(), tone: 'success', message: text('Saved operation read.', 'Gespeicherte Aktion gelesen.') });
  } catch (error) { if (token === revision) announce(error); }
  finally { if (token === revision) pending.value = false; }
}
async function apply() {
  const client = props.client, current = savedIntent.value, pinned = operation.value;
  if (!canApply.value || !client || !current || !pinned) return;
  const token = revision; pending.value = true;
  toasts.notify({ key: key(), tone: 'info', message: text('Aborting and verifying the pinned execution…', 'Festgelegten Lauf abbrechen und verifizieren…') });
  try {
    const result = await invoke(client, 'apply', current, pinned);
    if (token !== revision) return;
    operation.value = result;
    const verified = await invoke(client, 'read', current, result);
    if (token !== revision) return;
    operation.value = verified;
    const aborted = verified.outcome === 'aborted' && verified.abort.verified && verified.abort.lease_released;
    toasts.notify({ key: key(), tone: aborted ? 'success' : 'warning', message: aborted
      ? current.mode === 'abort_and_restart'
        ? text('Abort verified. Restart reserved; research dispatch is unavailable.', 'Abbruch verifiziert. Neustart reserviert; Forschungsausführung nicht verfügbar.')
        : text('Abort verified. Saved work was preserved.', 'Abbruch verifiziert. Gespeicherte Arbeit blieb erhalten.')
      : text('Abort was not verified. Check the saved operation.', 'Abbruch nicht verifiziert. Prüfe die gespeicherte Aktion.') });
  } catch (error) { if (token === revision) announce(error); }
  finally { if (token === revision) pending.value = false; }
}
async function copy() {
  if (!operation.value || unavailable.value) return;
  const token = revision;
  try {
    const prompt = buildAdaptiveLifecycleInstruction(operation.value);
    await navigator.clipboard.writeText(prompt);
    if (token === revision) toasts.notify({ key: key(), tone: 'success', message: text('Exact lifecycle instructions copied.', 'Genaue Lebenszyklus-Anweisung kopiert.') });
  } catch { if (token === revision) toasts.notify({ key: key(), tone: 'error', message: text('Copy failed. Keep this operation and try copying again.', 'Kopieren fehlgeschlagen. Behalte diese Aktion und versuche erneut zu kopieren.') }); }
}
function inspect() {
  const current = savedIntent.value;
  if (!current || unavailable.value) return;
  try {
    const captured = readAdaptiveLifecycleResponses(localStorage, binding(), current);
    if (!captured) throw new AdaptiveStartupTransportError('lifecycle_capture_unavailable');
    operation.value = decodeAdaptiveLifecycleNativeResponse(JSON.parse(captured.responses[captured.last_action]!), binding(), current, operation.value ?? undefined);
    toasts.notify({ key: key(), tone: 'success', message: text('Saved response inspected locally.', 'Gespeicherte Antwort lokal geprüft.') });
  } catch (error) { announce(error); }
}
</script>

<template>
  <details class="lifecycle" :aria-busy="pending">
    <summary>{{ text('Execution management', 'Ausführung verwalten') }}</summary>
    <div class="lifecycle-body">
      <div class="lifecycle-heading">
        <h4>{{ text('Abort an execution', 'Ausführung abbrechen') }}</h4>
        <InfoHint :id="`${controlsId}-help`" :lang="lang" :label="text('Execution management', 'Ausführung verwalten')" :text="help" />
      </div>
      <div class="lifecycle-actions">
        <button class="btn" type="button" :disabled="unavailable || !canStartCommand" @click="prepare('abort')">{{ text('Abort current execution', 'Aktuelle Ausführung abbrechen') }}</button>
        <button class="btn" type="button" :disabled="unavailable || !canStartCommand" @click="prepare('abort_and_restart')">{{ text('Abort and reserve restart', 'Abbrechen und Neustart reservieren') }}</button>
      </div>
      <dl v-if="operation" class="lifecycle-record">
        <dt>{{ text('Operation', 'Aktion') }}</dt><dd>{{ operation.operation_id }}</dd>
        <dt>{{ text('Target run', 'Ziellauf') }}</dt><dd>{{ operation.target?.run_id ?? text('No pinned target', 'Kein festgelegter Ziellauf') }}</dd>
        <dt>{{ text('Outcome', 'Ergebnis') }}</dt><dd>{{ outcomeLabel(operation.outcome) }}</dd>
        <dt>{{ text('Abort verification', 'Abbruchverifizierung') }}</dt><dd>{{ operation.abort.verified ? text('Verified', 'Verifiziert') : text('Not verified', 'Nicht verifiziert') }}</dd>
        <template v-if="operation.restart.run_id"><dt>{{ text('Restart run', 'Neustartlauf') }}</dt><dd>{{ operation.restart.run_id }} · {{ restartLabel(operation.restart.status) }}</dd></template>
      </dl>
      <div v-if="savedIntent" class="lifecycle-actions">
        <button class="btn" v-if="!operation" type="button" :disabled="unavailable" @click="prepare(savedIntent.mode, true)">{{ text('Prepare saved operation', 'Gespeicherte Aktion vorbereiten') }}</button>
        <button class="btn" v-if="canApply" type="button" @click="apply">{{ savedIntent.mode === 'abort' ? text('Confirm abort', 'Abbruch bestätigen') : text('Confirm abort and reserve restart', 'Abbruch und Neustartreservierung bestätigen') }}</button>
        <button class="btn" type="button" :disabled="unavailable" @click="check">{{ text('Check saved operation', 'Gespeicherte Aktion prüfen') }}</button>
        <button class="btn" type="button" :disabled="unavailable" @click="inspect">{{ text('Inspect saved response', 'Gespeicherte Antwort prüfen') }}</button>
        <button class="btn" v-if="operation?.target && ['prepared', 'aborted'].includes(operation.outcome)" type="button" :disabled="unavailable" @click="copy">{{ text('Copy exact instructions', 'Genaue Anweisung kopieren') }}</button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.lifecycle { border-top: 1px solid var(--ui-border); margin-top: 12px; color: var(--ui-text); }
.lifecycle summary { padding: 16px; cursor: pointer; font-weight: 600; }
.lifecycle-body { padding: 0 16px 16px; }
.lifecycle-heading, .lifecycle-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lifecycle-heading h4 { margin: 0; font: inherit; font-weight: 600; }
.lifecycle-actions { margin-top: 12px; }
.lifecycle summary:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.lifecycle-record { display: grid; grid-template-columns: minmax(110px, auto) minmax(0, 1fr); gap: 4px 16px; margin: 16px 0 0; }
.lifecycle-record dt { color: var(--ui-muted); }
.lifecycle-record dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 760px) { .lifecycle summary { padding-inline: 4px; } .lifecycle-body { padding-inline: 4px; } .lifecycle-record { grid-template-columns: 1fr; gap: 2px; } .lifecycle-record dd { margin-bottom: 8px; } }
</style>
