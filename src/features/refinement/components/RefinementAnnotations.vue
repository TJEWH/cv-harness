<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, useId, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faQuoteLeft } from '@fortawesome/free-solid-svg-icons';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import type { AnnotationStatus } from '../refinementTypes';
import { QUESTION_GROUPS, questionPresentation, type AnnotationView, type QuestionGroup } from '../domain/refinementAnnotations';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { useToasts } from '../../../shared/ui/useToasts';
import { commitPendingTextareas } from '../../../shared/editing/textareaCommit';
import { flushEditorSession } from '../../../shared/editing/editorSession';

type Item = AnnotationView & { target: string; referenceChanged: boolean; included: boolean };
const props = defineProps<{
  items: Item[]; lang: string; disabled: boolean; busy?: boolean; hideHeading?: boolean;
  comments?: { id: string; explanation: string }[];
  save: (id: string, status: AnnotationStatus, response: string, previousReviewId: string | null, proposalId?: string) => Promise<boolean>;
  privacyPreview: (value: string) => string;
}>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const { notify, dismiss } = useToasts();
const drafts = reactive<Record<string, { status: AnnotationStatus; response: string; committedResponse: string; reviewId: string | null; savedStatus: AnnotationStatus; savedResponse: string; saving: boolean; failed: boolean; failedStatus: AnnotationStatus | null; partialFailure: boolean }>>({});
const statusGroupId = useId();
// A textarea's pointerdown commit can start saving before the status click runs.
// Keep editing available during our own saves; the queue serializes the choices.
const controlsDisabled = computed(() => props.disabled || !!props.busy && !Object.values(drafts).some(draft => draft.saving));
const key = (item: Item) => `${item.proposalId}:${item.annotation.id}`;
const dirty = (item: Item) => { const d = drafts[key(item)]; return !!d && (d.status !== d.savedStatus || d.response !== d.savedResponse); };
function reset(item: Item) {
  drafts[key(item)] = { status: item.status, response: item.response || '', committedResponse: item.response || '', reviewId: item.reviewId, savedStatus: item.status, savedResponse: item.response || '', saving: false, failed: false, failedStatus: null, partialFailure: false };
}
watch(() => props.items, items => { for (const item of items) if (!drafts[key(item)] || !dirty(item) && !drafts[key(item)]!.saving && !drafts[key(item)]!.failed) reset(item); }, { immediate: true });
const conflictToasts = new Map<string, number>();
const saveToasts = new Map<string, number>();
watch(() => props.items.filter(item => !drafts[key(item)]?.saving && drafts[key(item)]?.reviewId !== item.reviewId).map(key), (conflicts, previous) => {
  for (const id of previous) if (!conflicts.includes(id)) {
    dismiss(conflictToasts.get(id) || 0);
    conflictToasts.delete(id);
  }
  for (const id of conflicts) if (!previous.includes(id)) conflictToasts.set(id, notify({
    key: `annotation-conflict-${id}`,
    message: text('This annotation changed elsewhere. Your unsaved response is retained; reload the saved annotation before editing again.', 'Diese Anmerkung wurde andernorts geändert. Deine ungespeicherte Antwort bleibt erhalten; vor weiteren Änderungen den gespeicherten Stand laden.'),
    tone: 'warning',
    action: { label: text('Load saved annotation', 'Gespeicherte Anmerkung laden'), run: () => {
      const current = props.items.find(item => key(item) === id);
      if (current && !props.disabled && !props.busy) reset(current);
    } },
  }));
});
type Commit = { key: string; item: Item; status: AnnotationStatus; response: string; promise: Promise<boolean>; resolve: (saved: boolean) => void };
const queue: Commit[] = [];
let activeCommit: Commit | null = null;
let disposed = false;
let editorSessionEpoch = 0;
watch(() => props.items.map(key).join('\0'), () => { editorSessionEpoch++; }, { flush: 'sync' });
watch(() => props.disabled || props.busy, blocked => {
  if (!blocked) void drain();
});
onBeforeUnmount(() => {
  disposed = true; editorSessionEpoch++;
  for (const commit of queue.splice(0)) commit.resolve(false);
  for (const id of [...conflictToasts.values(), ...saveToasts.values()]) dismiss(id);
});
function save(item: Item): Promise<boolean> {
  if (disposed) return Promise.resolve(false);
  const d = drafts[key(item)]!;
  const status = d.status, response = d.response;
  const pending = [...queue].reverse().find(commit => commit.key === key(item)) || (activeCommit?.key === key(item) ? activeCommit : null);
  if (pending?.status === status && pending.response === response) return pending.promise;
  if (!pending && !dirty(item) && !d.failed) return Promise.resolve(true);
  if (props.disabled) return Promise.resolve(false);
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  queue.push({ key: key(item), item, status, response, promise, resolve });
  void drain();
  return promise;
}
function commitAnswer(item: Item): Promise<boolean> {
  if (props.disabled || disposed) return Promise.resolve(false);
  const draft = drafts[key(item)]!;
  // Saving an empty answer reopens the question, including an ignored one.
  // Unchanged nonempty historical answers must not resolve on blur or flush.
  if (!draft.response.trim()) draft.status = 'open';
  else if (draft.response !== draft.committedResponse && draft.status !== 'ignored') draft.status = 'resolved';
  draft.committedResponse = draft.response;
  return save(item);
}
function selectStatus(item: Item, status: 'resolved' | 'ignored'): Promise<boolean> {
  if (controlsDisabled.value || disposed) return Promise.resolve(false);
  commitPendingTextareas();
  drafts[key(item)]!.status = status;
  return save(item);
}
async function drain() {
  if (activeCommit || props.disabled || props.busy || disposed) return;
  const commit = queue.shift();
  if (!commit) return;
  activeCommit = commit;
  const { item, status, response } = commit;
  const d = drafts[commit.key]!;
  let saved = false;
  // Only a review written by this queue may advance the base for a later commit.
  const current = props.items.find(value => key(value) === commit.key);
  if (!current || d.reviewId !== current.reviewId) {
    activeCommit = null; commit.resolve(false); void drain(); return;
  }
  d.saving = true; d.failed = false; d.failedStatus = null; d.partialFailure = false;
  function acceptSaved(current: Item) {
    const unchanged = d.status === status && d.response === response;
    d.savedStatus = current.status; d.savedResponse = current.response || ''; d.reviewId = current.reviewId;
    if (unchanged) {
      if (d.committedResponse === response) d.committedResponse = current.response || '';
      d.status = current.status; d.response = current.response || '';
    }
  }
  function failed() {
    const current = props.items.find(value => key(value) === key(item));
    const statusSaved = !!current && current.status === status && (current.response || '') === props.privacyPreview(response).trim();
    if (current && statusSaved) acceptSaved(current);
    d.failed = true; d.failedStatus = status; d.partialFailure = statusSaved;
    // Retain the requested status as an unsaved draft so Retry preserves intent.
  }
  try {
    saved = await props.save(item.annotation.id, status, response, d.reviewId, item.proposalId);
    const current = props.items.find(value => key(value) === key(item));
    if (saved) { if (current) acceptSaved(current); }
    else failed();
  } catch {
    failed();
  } finally {
    d.saving = false;
    if (!saved && !disposed) saveToasts.set(commit.key, notify({
      key: `annotation-save-${commit.key}`, message: failureMessage(item), tone: 'error',
      action: { label: text('Retry save', 'Erneut speichern'), run: () => save(item) },
    }));
    else if (saved) { dismiss(saveToasts.get(commit.key) || 0); saveToasts.delete(commit.key); }
    commit.resolve(saved);
    activeCommit = null;
    // The parent's busy flag is propagated before starting the next snapshot.
    await nextTick();
    void drain();
  }
}
function flush(): Promise<boolean> {
  const epoch = editorSessionEpoch, items = [...props.items];
  return flushEditorSession({
    current: () => !disposed && epoch === editorSessionEpoch,
    steps: [async () => (await Promise.all(items.map(item => save(item)))).every(saved => saved === true)],
    settled: () => items.every(item => !dirty(item) && !drafts[key(item)]!.failed),
  });
}
defineExpose({ flush });
function failureMessage(item: Item) {
  const draft = drafts[key(item)]!;
  if (draft.failedStatus === 'ignored') return draft.partialFailure
    ? text('Ignored status saved, but previous feedback could not be cancelled. Retry save to finish.', 'Der Status „Ignoriert“ wurde gespeichert, vorheriges Feedback konnte aber nicht zurückgenommen werden. Zum Abschließen erneut speichern.')
    : text('Ignoring could not be saved. Your choice and answer are retained. Retry save to try again.', 'Ignorieren konnte nicht gespeichert werden. Deine Auswahl und Antwort bleiben erhalten. Bitte erneut speichern.');
  return text('The question could not be fully saved. Your choice and answer are retained. Retry save to try again.', 'Die Frage konnte nicht vollständig gespeichert werden. Deine Auswahl und Antwort bleiben erhalten. Bitte erneut speichern.');
}
const questionGroupLabel = (group: QuestionGroup) => ({
  application_requirements: text('Application requirements', 'Bewerbungsanforderungen'),
  experience: text('Your experience', 'Eigene Erfahrung'),
  follow_up: text('Follow-up questions', 'Rückfragen'),
  other: text('Other', 'Sonstige'),
})[group];
const groups = computed(() => QUESTION_GROUPS.map(group => ({
  id: group,
  items: props.items.filter(item => questionPresentation(item.annotation.text).group === group),
  comments: (props.comments || []).filter(comment => questionPresentation(comment.explanation).group === group),
})).filter(group => group.items.length || group.comments.length));
</script>

<template>
  <section v-if="groups.length" class="annotations" :aria-label="text('Questions', 'Fragen')">
    <h3 v-if="!hideHeading">{{ text('Questions', 'Fragen') }}</h3>
    <section v-for="group in groups" :key="group.id" class="question-group" :data-question-group="group.id">
      <h4>{{ questionGroupLabel(group.id) }}</h4>
      <article v-for="item in group.items" :key="key(item)" class="annotation-row" :data-annotation-id="item.annotation.id" :data-proposal-id="item.proposalId" :aria-label="item.target" :aria-busy="drafts[key(item)]!.saving">
        <p class="annotation-text">{{ questionPresentation(item.annotation.text).text }}</p>
        <template v-if="item.annotation.document === 'letter' && item.annotation.location">
          <details class="disclosure-row"><summary><FontAwesomeIcon :icon="faQuoteLeft" class="disclosure-prefix" aria-hidden="true" />{{ text('Original text reference', 'Ursprünglicher Textbezug') }}<InfoHint v-if="item.referenceChanged" :lang="lang" :label="text('Original text reference', 'Ursprünglicher Textbezug')" :text="text('Referenced text has changed', 'Referenzierter Text wurde geändert')" /></summary><blockquote>{{ item.annotation.location.quote }}</blockquote></details>
        </template>
        <label>{{ text('Your response (optional)', 'Deine Antwort (optional)') }}<AutosaveTextarea v-model="drafts[key(item)]!.response" @commit="commitAnswer(item)" rows="3" maxlength="12000" :disabled="controlsDisabled" /></label>
        <fieldset class="status-choices" :disabled="controlsDisabled" :aria-label="text('Question status', 'Fragenstatus')">
          <label><input type="radio" :name="`${statusGroupId}-${key(item)}`" value="resolved" :checked="drafts[key(item)]!.status === 'resolved'" @change="selectStatus(item, 'resolved')" />{{ text('Resolved', 'Erledigt') }}</label>
          <label><input type="radio" :name="`${statusGroupId}-${key(item)}`" value="ignored" :checked="drafts[key(item)]!.status === 'ignored'" @change="selectStatus(item, 'ignored')" />{{ text('Ignored', 'Ignoriert') }}</label>
        </fieldset>
        <button v-if="drafts[key(item)]!.reviewId !== item.reviewId" type="button" :disabled="disabled || busy" @click="reset(item)">{{ text('Load saved annotation', 'Gespeicherte Anmerkung laden') }}</button>
        <button v-if="drafts[key(item)]!.failed" type="button" :disabled="disabled || busy || drafts[key(item)]!.saving || drafts[key(item)]!.reviewId !== item.reviewId" @click="save(item)">{{ text('Retry save', 'Erneut speichern') }}</button>
      </article>
      <p v-for="comment in group.comments" :key="comment.id" class="legacy-question">{{ questionPresentation(comment.explanation).text }}</p>
    </section>
  </section>
</template>

<style scoped>
.annotations { margin: 0; }
.question-group + .question-group { margin-top: 28px; }
.question-group h4 { font-size: 14px; margin: 0 0 12px; color: var(--ui-muted, #a6c1b9); }
.annotation-row { margin: 0; padding: 0; min-width: 0; }
.annotation-row + .annotation-row, .legacy-question { margin-top: 24px; }
.annotation-text { margin: 0 0 12px; }
.annotation-text, .legacy-question, blockquote { white-space: pre-wrap; overflow-wrap: anywhere; }
blockquote { margin: .6rem 0; border-left: 3px solid #28534e; padding-left: .7rem; }
label { display: flex; flex-direction: column; gap: .3rem; margin: .65rem 0; font-size: .85rem; }
textarea, button { font: inherit; border: 1px solid #28534e; border-radius: 7px; padding: .6rem; background: #0b1b25; color: #d1fae5; max-width: 100%; }
textarea { resize: vertical; width: 100%; box-sizing: border-box; }button { cursor: pointer; }button:disabled { opacity: .55; cursor: default; }
.status-choices { display: flex; flex-wrap: wrap; gap: .3rem 1.25rem; border: 0; padding: 0; margin: .65rem 0; min-width: 0; }
.status-choices label { flex-direction: row; margin: 0; cursor: pointer; }
.status-choices input { margin: 0; accent-color: var(--ui-accent, #6ee7b7); }
.status-choices:disabled label { opacity: .55; cursor: default; }
.status-choices input:focus-visible, button:focus-visible { outline: 2px solid var(--ui-accent, #6ee7b7); outline-offset: 3px; }
@media (max-width: 640px) { .annotation-row { padding: .75rem 0; } }
</style>
