<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faAlignLeft } from '@fortawesome/free-solid-svg-icons';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { OPPORTUNITY_INTEREST_REASON_CATEGORIES, type Opportunity, type OpportunityInterestReason, type OpportunityReview } from '../../../app/cloudTypes';
import { MAX_OPPORTUNITY_INTEREST_REASONS, normalizeOpportunityInterestReasons } from '../domain/opportunityFeedback';
import { flushEditorSession } from '../../../shared/editing/editorSession';
import { useToastWatch } from '../../../shared/ui/useToasts';
import { opportunityFeedbackTextIsSafe } from '../domain/opportunityFeedbackPrivacy';
import { MAX_OPPORTUNITY_EVALUATION_LENGTH } from '../domain/opportunityEvaluation';

interface FeedbackPatch { interest_reasons?: OpportunityInterestReason[] }
const props = withDefaults(defineProps<{
  ownerId: string;
  opportunity: Opportunity;
  review?: OpportunityReview | null;
  busy?: boolean;
  lang?: string;
  evaluationText: string;
  evaluationStatus?: string;
  evaluationError?: string;
  evaluationInputId?: string;
  evaluationLabelledby?: string;
  saveFeedback(id: string, patch: FeedbackPatch): Promise<OpportunityReview | null>;
  flushPrivateComment: () => Promise<boolean>;
}>(), { review: null, busy: false, lang: 'en' });
const controlsId = `opportunity-feedback-${useId()}`;
const emit = defineEmits<{ 'update:evaluationText': [value: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const currentReview = computed(() => props.review?.user_id === props.ownerId && props.review.opportunity_id === props.opportunity.id ? props.review : null);
const scope = computed(() => `${props.ownerId}:${props.opportunity.id}`);
const reasonDraft = ref<OpportunityInterestReason[]>([]);
const reasonBaseline = ref<OpportunityInterestReason[]>([]);
const reasonError = ref('');
const reasonsSaving = ref(false);
let generation = 0;
let editorDisposed = false;
onBeforeUnmount(() => { editorDisposed = true; generation++; });
let reasonRequest: Promise<boolean> | null = null;
watch(scope, () => {
  generation++;
  reasonRequest = null;
  reasonDraft.value = [];
  reasonBaseline.value = [];
  reasonError.value = '';
  reasonsSaving.value = false;
}, { flush: 'sync' });
const reasons = computed(() => reasonDraft.value);
const reasonPending = computed(() => JSON.stringify(reasonDraft.value) !== JSON.stringify(reasonBaseline.value));
watch([scope, () => currentReview.value?.interest_reasons], (next, previous) => {
  const saved = normalizeOpportunityInterestReasons(next[1]);
  const pending = reasonPending.value;
  reasonBaseline.value = saved;
  if (!previous || next[0] !== previous[0] || !pending || JSON.stringify(reasonDraft.value) === JSON.stringify(saved)) {
    reasonDraft.value = saved;
    reasonError.value = '';
  }
}, { immediate: true, flush: 'sync' });
const disabled = computed(() => props.busy || reasonsSaving.value);
function saveReasons(): Promise<boolean> {
  if (reasonRequest) return reasonRequest;
  if (disabled.value) return Promise.resolve(false);
  const ownerGeneration = generation, owner = props.ownerId, id = props.opportunity.id;
  reasonsSaving.value = true;
  reasonError.value = '';
  const pending = (async () => {
    try {
      const updated = normalizeOpportunityInterestReasons(reasonDraft.value);
      reasonDraft.value = updated;
      if (JSON.stringify(updated) === JSON.stringify(reasonBaseline.value)) return true;
      const saved = await props.saveFeedback(id, { interest_reasons: updated });
      if (ownerGeneration !== generation) return false;
      if (!saved || saved.user_id !== owner || saved.opportunity_id !== id
        || JSON.stringify(normalizeOpportunityInterestReasons(saved.interest_reasons)) !== JSON.stringify(updated)) throw new Error();
      reasonBaseline.value = normalizeOpportunityInterestReasons(saved.interest_reasons);
      reasonDraft.value = reasonBaseline.value;
      return true;
    } catch {
      if (ownerGeneration === generation) reasonError.value = text(`Your reason selections were not saved. Retry, or clear a category if the ${MAX_OPPORTUNITY_INTEREST_REASONS}-reason limit is reached.`, `Deine Auswahl wurde nicht gespeichert. Versuche es erneut oder entferne eine Kategorie, falls die Grenze von ${MAX_OPPORTUNITY_INTEREST_REASONS} Gründen erreicht ist.`);
      return false;
    } finally { if (ownerGeneration === generation) reasonsSaving.value = false; }
  })();
  reasonRequest = pending;
  void pending.then(() => { if (reasonRequest === pending) reasonRequest = null; });
  return pending;
}
const isReasonSelected = (category: OpportunityInterestReason['category'], polarity: OpportunityInterestReason['polarity']) => reasons.value.some(reason => reason.category === category && reason.polarity === polarity);
function toggleReason(category: OpportunityInterestReason['category'], polarity: OpportunityInterestReason['polarity'], checked: boolean): Promise<boolean> {
  if (!reasonCategories(polarity).includes(category)) return Promise.resolve(false);
  if (disabled.value) return Promise.resolve(false);
  if (isReasonSelected(category, polarity) !== checked) {
    reasonDraft.value = checked ? [...reasons.value, { category, polarity }]
      : reasons.value.filter(reason => reason.category !== category || reason.polarity !== polarity);
  }
  return reasonPending.value ? saveReasons() : Promise.resolve(true);
}
const reasonGroups: OpportunityInterestReason['polarity'][] = ['positive', 'negative'];
const reasonCategories = (polarity: OpportunityInterestReason['polarity']) => OPPORTUNITY_INTEREST_REASON_CATEGORIES.filter(category => polarity === 'negative' || !['requirements', 'availability'].includes(category));
const categoryLabel = (category: OpportunityInterestReason['category']) => ({
  topic: text('Topic', 'Thema'), method: text('Method', 'Methode'), hardware: text('Tools+hardware', 'Tools+Hardware'),
  location: text('Location', 'Ort'), funding: text('Salary', 'Gehalt'), timing: text('Timing', 'Zeitpunkt'),
  background_fit: text('Background fit', 'Passung zum Hintergrund'), project_context: text('Project context', 'Projektkontext'),
  requirements: text('Requirements', 'Anforderungen'), availability: text('Availability', 'Verfügbarkeit'), other: text('Other', 'Sonstiges'),
})[category];

const summaryDraft = computed({
  get: () => props.evaluationText,
  set: (value: string) => emit('update:evaluationText', value),
});
const summaryError = computed(() => props.evaluationError ?? '');
const summaryLength = computed(() => Array.from(summaryDraft.value).length);
const summaryInvalid = computed(() => Boolean(summaryError.value) || summaryLength.value > MAX_OPPORTUNITY_EVALUATION_LENGTH);
const summaryExcerpt = computed(() => Array.from(summaryDraft.value).slice(0,600).join(''));
const summaryEligible = computed(() => !currentReview.value?.feedback_excluded && opportunityFeedbackTextIsSafe(summaryDraft.value,MAX_OPPORTUNITY_EVALUATION_LENGTH) && opportunityFeedbackTextIsSafe(summaryExcerpt.value));
const evaluationHint = computed(() => {
  const inclusion = currentReview.value?.feedback_excluded ? text('Excluded from search feedback', 'Vom Suchfeedback ausgeschlossen')
    : !summaryDraft.value.trim() ? text('No feedback text yet', 'Noch kein Feedbacktext')
      : !summaryEligible.value ? text('Text withheld by content safeguards', 'Text durch Inhaltsprüfung zurückgehalten')
        : text('Included in search feedback', 'Im Suchfeedback enthalten');
  return `${inclusion}. ${text('Your searches use public opportunity details, your interest selection, reasons, saved evaluation and application status by default. Excluding this opportunity withholds all of its feedback. Longer evaluations use the first 600 characters; the full evaluation stays saved. Application notes, CVs and letters stay private. Contact details, credentials and unsafe instructions are withheld.', 'Deine Suchen verwenden standardmäßig öffentliche Stellendaten, deine Interessenauswahl, Gründe, gespeicherte Einschätzung und deinen Bewerbungsstatus. Wenn du diese Stelle ausschließt, wird ihr gesamtes Feedback zurückgehalten. Bei längeren Einschätzungen werden die ersten 600 Zeichen verwendet; der vollständige Text bleibt gespeichert. Bewerbungsnotizen, Lebensläufe und Briefe bleiben privat. Kontaktdaten, Zugangsdaten und unsichere Anweisungen werden zurückgehalten.')}`;
});
const flushSummary = () => props.flushPrivateComment();
function flush(): Promise<boolean> {
  const ownerGeneration = generation;
  const pendingReasons = reasonRequest;
  return flushEditorSession({
    current: () => !editorDisposed && ownerGeneration === generation,
    steps: [
      () => pendingReasons || true,
      async () => !reasonPending.value || await saveReasons() && !reasonPending.value,
    ],
    settled: () => !reasonPending.value && !reasonError.value,
  });
}

const retry = () => saveReasons();
useToastWatch(() => reasonError.value, () => ({ tone: 'error', action: { label: text('Retry', 'Erneut versuchen'), run: retry } }));
defineExpose({ flush });
</script>

<template>
  <section class="feedback-controls" :aria-label="text('Search feedback', 'Suchfeedback')">
    <div class="feedback-summary">
      <div class="feedback-heading"><label :for="evaluationInputId || `${controlsId}-summary`">{{ text('Qualitative evaluation', 'Qualitative Einschätzung') }}</label><InfoHint :lang="lang" :label="text('Qualitative evaluation', 'Qualitative Einschätzung')" :text="evaluationHint" /><span class="feedback-summary-count">{{ summaryLength }} / {{ MAX_OPPORTUNITY_EVALUATION_LENGTH }} {{ text('characters', 'Zeichen') }}</span></div>
      <AutosaveTextarea :id="evaluationInputId || `${controlsId}-summary`" v-model="summaryDraft" :aria-labelledby="evaluationLabelledby" rows="3" :aria-invalid="summaryInvalid || undefined" @commit="flushSummary" />
      <details v-if="summaryLength > 600 && summaryEligible" class="feedback-excerpt"><summary><FontAwesomeIcon :icon="faAlignLeft" class="disclosure-prefix" aria-hidden="true" />{{ text('Search feedback excerpt — first 600 characters', 'Suchfeedback-Auszug — erste 600 Zeichen') }}</summary><p>{{ summaryExcerpt }}</p></details>
      <button v-if="summaryError" class="btn" type="button" @click="flushSummary">{{ text('Retry save', 'Speichern erneut versuchen') }}</button>
    </div>
    <fieldset class="feedback-reasons" :disabled="disabled" :aria-busy="reasonsSaving || undefined" :aria-invalid="reasonError ? true : undefined">
      <legend class="feedback-heading">{{ text('Reasons', 'Gründe') }}<InfoHint :lang="lang" :label="text('Reason categories', 'Kategorien der Gründe')" :text="text('Choose the categories you prefer or avoid. Each selection saves directly. Use your personal evaluation for details.', 'Wähle die Kategorien, die du bevorzugst oder vermeiden möchtest. Jede Auswahl wird direkt gespeichert. Beschreibe Einzelheiten in deiner persönlichen Einschätzung.')" /></legend>
      <div class="feedback-reason-groups">
        <fieldset v-for="polarity in reasonGroups" :key="polarity" class="feedback-reason-group">
          <legend>{{ polarity === 'positive' ? text('Prefer', 'Bevorzugen') : text('Avoid', 'Vermeiden') }}</legend>
          <div class="feedback-category-options"><label v-for="category in reasonCategories(polarity)" :key="category" class="feedback-category"><input type="checkbox" :checked="isReasonSelected(category, polarity)" @change="toggleReason(category, polarity, ($event.target as HTMLInputElement).checked)" />{{ categoryLabel(category) }}</label></div>
        </fieldset>
      </div>
    </fieldset>
    <button v-if="reasonError" class="btn" type="button" :disabled="disabled" @click="retry">{{ text('Retry', 'Erneut versuchen') }}</button>
  </section>
</template>

<style scoped>
.feedback-controls { display: grid; gap: 18px; min-width: 0; color: var(--ui-text); }
.feedback-heading { display: flex; align-items: center; gap: 4px; min-width: 0; }
.feedback-controls label, .feedback-reasons legend { color: var(--ui-text); font: 600 12px/1.5 var(--font-ui); }
.feedback-controls label:not(.feedback-category) { display: grid; gap: 6px; }
.feedback-summary :deep(textarea) { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); font: 400 14px/1.5 var(--font-ui); caret-color: var(--ui-accent); }
.feedback-summary :deep(textarea) { resize: vertical; }
.feedback-controls :is(input,button):focus-visible, .feedback-summary :deep(textarea:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.feedback-controls .feedback-category input[type=checkbox] { flex: 0 0 16px; box-sizing: border-box; width: 16px; min-width: 16px; max-width: 16px; height: 16px; margin: 0; padding: 0; accent-color: var(--ui-accent); }
.feedback-reasons { min-width: 0; margin: 0; padding: 0; border: 0; }
.feedback-reasons legend { padding: 0 0 8px; }
.feedback-reason-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.feedback-reason-group { min-width: 0; margin: 0; border: 0; padding: 0; }
.feedback-category-options { display: flex; flex-wrap: wrap; gap: 8px; }
.feedback-controls .feedback-category { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; box-sizing: border-box; padding: 6px 9px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); cursor: pointer; font-size: 14px; font-weight: 400; }
.feedback-category:has(input:checked) { border-color: var(--ui-accent); }
.feedback-category:hover { background: var(--ui-hover, var(--ui-control)); }
.feedback-summary { display: grid; gap: 8px; }
.feedback-summary-count { margin-inline-start: auto; color: var(--ui-muted); font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 400; }
.feedback-summary .feedback-heading { flex-wrap: wrap; }
.feedback-excerpt { color: var(--ui-muted); font-size: 12px; line-height: 1.6; }
.feedback-excerpt summary { cursor: pointer; }
.feedback-excerpt p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 0; }
.feedback-controls button:disabled { opacity: .55; cursor: default; }
@media (max-width: 760px), (pointer: coarse) {
  .feedback-controls { gap: 24px; }
  .feedback-controls button, .feedback-controls .feedback-category { min-height: 44px; }
  .feedback-controls label, .feedback-controls .feedback-category, .feedback-reasons legend, .feedback-excerpt, .feedback-controls button { font-size: 16px; }
  .feedback-summary :deep(textarea) { min-height: 44px; font-size: 16px; }
  .feedback-controls :deep(.info-hint) { margin-inline-start: 0; }
  .feedback-controls :deep(.info-hint > .info-hint__button) { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
  .feedback-summary-count { font-size: 13px; }
  .feedback-summary :deep(textarea) { min-height: 144px; }
  .feedback-excerpt summary { box-sizing: border-box; min-height: 44px; padding-block: 10px; }
}
@media (max-width: 760px) {
  .feedback-summary > .feedback-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 8px; }
  .feedback-summary-count { grid-column: 1 / -1; margin-inline-start: 0; justify-self: start; }
  .feedback-reason-groups { grid-template-columns: minmax(0, 1fr); gap: 20px; }
}
</style>
