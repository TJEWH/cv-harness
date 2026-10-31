<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, useId, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faCopy } from '@fortawesome/free-solid-svg-icons';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfiguration } from '../../../platform/supabase/supabase';
import type { Application, Opportunity, OpportunityReview } from '../../../app/cloudTypes';
import {
  prepareOpportunityInsights, buildOpportunityInsightsAnalysisPrompt, filterOpportunityInsightTopics,
  type OpportunityInsightJob, type OpportunityInsightTopicNode, type OpportunityTopicInterestFilter, type OpportunityInsightsAggregation,
} from '../domain/opportunityInsights';
import { useOpportunityInsightsSearch } from '../composables/useOpportunityInsightsSearch';
import { opportunityFeedbackTimestamp } from '../domain/opportunityFeedback';
import { opportunityTopicKey } from '../domain/opportunityTopics';
import { opportunityJobsAtInterest, opportunityJobInterestMinimum, opportunityJobClusterCount } from '../domain/opportunityJobInterest';
import { currentOpportunityRecords } from '../domain/opportunityInsightsCurrent';
import { copyPreparedText } from '../../../shared/lib/preparedClipboard';
import { useToasts, useToastWatch } from '../../../shared/ui/useToasts';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import DesktopSidebarPortal from '../../../shared/ui/DesktopSidebarPortal.vue';
import { useDesktopSidebar } from '../../../shared/ui/desktopSidebar';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import OpportunityInsightsTimeline from './OpportunityInsightsTimeline.vue';
import OpportunityInsightsTimelineControls from './OpportunityInsightsTimelineControls.vue';
import OpportunityInsightsBrush from './OpportunityInsightsBrush.vue';

const OpportunityTopicNetwork = defineAsyncComponent(() => import('./OpportunityTopicNetwork.vue'));

const props = withDefaults(defineProps<{
  ownerId: string; client: SupabaseClient | null; projectRef?: string;
  opportunities: Opportunity[]; reviews: OpportunityReview[]; applications: Application[];
  lang: string; loading: boolean; currentTime?: Date; sidebarActive?: boolean;
}>(), { sidebarActive: true });
const emit = defineEmits<{ openOpportunity: [id: string] }>();
const id = useId();
const desktopSidebar = useDesktopSidebar();
const sidebarControlsActive = computed(() => desktopSidebar.value && props.sidebarActive);
const connectedProjectRef = computed(() => props.projectRef || (supabaseConfiguration.status === 'ready' ? new URL(supabaseConfiguration.url).hostname.split('.')[0] : undefined));
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const number = (value: number | null, digits = 1) => value === null ? text('Unknown', 'Unbekannt')
  : new Intl.NumberFormat(props.lang === 'de' ? 'de' : 'en', { maximumFractionDigits: digits }).format(value);
const date = (value: string) => new Intl.DateTimeFormat(props.lang === 'de' ? 'de' : 'en', { dateStyle: 'medium' }).format(new Date(value));
const windowNow = ref(new Date().toISOString());
const rangeDates = ref<{ start: string; end: string } | null>(null);
const aggregation = ref<OpportunityInsightsAggregation>('auto');
const timelineView = ref<'outcomes' | 'topics' | 'alignment'>('outcomes');
const brushActive = ref(false);
const networkAvailable = ref(true);
const selectedTopicIds = ref<string[]>([]);
const focusedTopicIds = ref<Set<string> | null>(null);
function setTopicFocus(topicIds: string[] | null) { focusedTopicIds.value = topicIds ? new Set(topicIds) : null; }
watch(selectedTopicIds, ids => { if (!ids.length) focusedTopicIds.value = null; }, { flush: 'sync' });
const selectedJobId = ref<string | null>(null);
const graphSearch = ref('');
const networkMode = ref<'topics' | 'jobs'>('jobs');
const currentOnly = ref(false);
const jobMinimumInterest = ref(8), jobInterestDraft = ref(8);
const jobClusterCount = ref(5), jobClusterDraft = ref(5);
const excludedJobTopicIds = ref<string[]>([]), excludedTopicSearch = ref('');
function toggleExcludedTopic(topicId: string) {
  excludedJobTopicIds.value = excludedJobTopicIds.value.includes(topicId)
    ? excludedJobTopicIds.value.filter(id => id !== topicId) : [...excludedJobTopicIds.value, topicId].sort();
}
function previewJobInterest(event: Event) { jobInterestDraft.value = opportunityJobInterestMinimum(Number((event.target as HTMLInputElement).value)); }
function commitJobInterest() { jobMinimumInterest.value = jobInterestDraft.value; }
function previewJobClusters(event: Event) {
  if (clusterJobs.value.length) jobClusterDraft.value = opportunityJobClusterCount(Number((event.target as HTMLInputElement).value), clusterJobs.value.length);
}
function commitJobClusters() { jobClusterCount.value = jobClusterDraft.value; }
const bodyTabs = ['development', 'topics', 'clusters'] as const;
type BodyTab = typeof bodyTabs[number];
const activeBody = ref<BodyTab>('development');
const interestMode = ref<OpportunityTopicInterestFilter['mode']>('high');
const highThreshold = ref(8), lowThreshold = ref(4), minimumJobCount = ref(3);
const interestThreshold = computed(() => interestMode.value === 'low' ? lowThreshold.value : highThreshold.value);
function bodyTabLabel(tab: BodyTab) {
  return tab === 'development' ? text('Trends', 'Zeitverlauf')
    : tab === 'topics' ? text('Clusters', 'Gruppen') : text('Interest patterns', 'Interessenmuster');
}
function bodyTabKey(event: KeyboardEvent, tab: BodyTab) {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? bodyTabs.length - 1 : (bodyTabs.indexOf(tab) + direction + bodyTabs.length) % bodyTabs.length;
  activeBody.value = bodyTabs[index]!;
  (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus();
}
function setInterestThreshold(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 0 || value > 10) return;
  if (interestMode.value === 'low') lowThreshold.value = value; else highThreshold.value = value;
}
let topicsInitialized = false;
const calendarDate = (value: string) => {
  const valueDate = new Date(value);
  return `${String(valueDate.getFullYear()).padStart(4, '0')}-${String(valueDate.getMonth() + 1).padStart(2, '0')}-${String(valueDate.getDate()).padStart(2, '0')}`;
};
const today = computed(() => calendarDate(windowNow.value));
const analysisData = computed(() => ({ ownerId: props.ownerId, opportunities: props.opportunities, reviews: props.reviews,
  applications: props.applications, windowDays: null, now: windowNow.value }));
const preparedInsights = computed(() => prepareOpportunityInsights(analysisData.value));
const currentClock = computed(() => props.currentTime && Number.isFinite(props.currentTime.getTime()) ? props.currentTime : new Date(windowNow.value));
const currentOpportunities = computed<readonly Opportunity[]>(previous => {
  if (!currentOnly.value) return props.opportunities;
  const records = currentOpportunityRecords(props.opportunities, props.reviews, props.ownerId, currentClock.value);
  return previous && previous.length === records.length && records.every((record, index) => record === previous[index]) ? previous : records;
});
const preparedExplorer = computed(() => currentOnly.value
  ? prepareOpportunityInsights({ ...analysisData.value, opportunities: currentOpportunities.value }) : preparedInsights.value);
const allInput = computed(() => ({ ...analysisData.value, aggregation: aggregation.value }));
const allInsights = computed(() => preparedInsights.value.build({ windowDays: null, aggregation: aggregation.value }));
function endOfDay(value: string, clock = windowNow.value): string {
  if (value === calendarDate(clock)) return clock;
  const nextDay = new Date(`${value}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  return new Date(nextDay.getTime() - 1).toISOString().replace(/\.999Z$/u, '.999999Z');
}
function supportedRange(range: { start: string; end: string }, clock: string): boolean {
  try {
    if (calendarDate(`${range.start}T00:00:00`) !== range.start || calendarDate(`${range.end}T00:00:00`) !== range.end) return false;
    const start = opportunityFeedbackTimestamp(new Date(`${range.start}T00:00:00`).toISOString());
    const end = opportunityFeedbackTimestamp(endOfDay(range.end, clock));
    const now = opportunityFeedbackTimestamp(clock);
    return start !== null && end !== null && now !== null && start <= end && end <= now;
  } catch { return false; }
}
const input = computed(() => rangeDates.value ? { ...allInput.value, rangeStart: new Date(`${rangeDates.value.start}T00:00:00`).toISOString(), rangeEnd: endOfDay(rangeDates.value.end) } : allInput.value);
const insights = computed(() => rangeDates.value ? preparedInsights.value.build(input.value) : allInsights.value);
const explorerGraph = computed(() => currentOnly.value ? preparedExplorer.value.build(input.value).graph : insights.value.graph);
function selectBrush(value: { start: string; end: string } | null) {
  if (!value) { showAllFeedback(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value.start) || !/^\d{4}-\d{2}-\d{2}$/u.test(value.end)
    || value.start > value.end || value.end > today.value || !supportedRange(value, new Date().toISOString())) return;
  rangeDates.value = { ...value };
}
function showAllFeedback() { rangeDates.value = null; }
function setBrushActive(active: boolean) {
  brushActive.value = active;
  if (active) clearCopy();
}
function resetOwnerState() {
  showAllFeedback();
  windowNow.value = new Date().toISOString();
  selectedTopicIds.value = [];
  focusedTopicIds.value = null;
  selectedJobId.value = null;
  topicsInitialized = false;
  graphSearch.value = '';
  networkMode.value = 'jobs';
  currentOnly.value = false;
  jobMinimumInterest.value = 8;
  jobInterestDraft.value = 8;
  jobClusterCount.value = 5;
  jobClusterDraft.value = 5;
  excludedJobTopicIds.value = [];
  excludedTopicSearch.value = '';
  brushActive.value = false;
  networkAvailable.value = true;
  activeBody.value = 'development';
  interestMode.value = 'high';
  highThreshold.value = 8;
  lowThreshold.value = 4;
  minimumJobCount.value = 3;
  timelineView.value = 'outcomes';
}
function leadingTopicIds(topics: readonly OpportunityInsightTopicNode[]): string[] {
  return topics.filter(topic => topic.highInterestCount > 0)
    .sort((a, b) => b.highInterestCount - a.highInterestCount || a.id.localeCompare(b.id)).slice(0, 5).map(topic => topic.id);
}
watch(() => props.ownerId, resetOwnerState, { flush: 'sync' });
watch(() => allInsights.value.graph.topics, topics => {
  if (topicsInitialized || !topics.length) return;
  selectedTopicIds.value = leadingTopicIds(topics);
  topicsInitialized = true;
}, { immediate: true });
const topicById = computed(() => new Map(allInsights.value.graph.topics.map(topic => [topic.id, topic])));
const currentTopicById = computed(() => new Map(explorerGraph.value.topics.map(topic => [topic.id, topic])));
const timelineTopicIds = computed(() => {
  const selected = selectedTopicIds.value.filter(topicId => currentTopicById.value.has(topicId));
  return selected.length ? selected : leadingTopicIds(insights.value.graph.topics);
});
const topicFilter = computed(() => ({ mode: interestMode.value, interestThreshold: interestThreshold.value,
  minimumJobCount: interestMode.value === 'low' ? 1 : minimumJobCount.value }));
const selectedJob = computed(() => explorerGraph.value.jobs.find(job => job.id === selectedJobId.value) ?? null);
const clusterJobs = computed(() => opportunityJobsAtInterest(explorerGraph.value.jobs, jobMinimumInterest.value));
const maximumJobClusters = computed(() => Math.max(1, Math.min(10, clusterJobs.value.length || 10)));
watch(() => clusterJobs.value.length, count => {
  if (!count) return;
  jobClusterCount.value = opportunityJobClusterCount(jobClusterCount.value, count);
  jobClusterDraft.value = opportunityJobClusterCount(jobClusterDraft.value, count);
}, { immediate: true, flush: 'sync' });
const clusterJobIds = computed(() => new Set(clusterJobs.value.map(job => job.id)));
const jobExclusionTopics = computed(() => {
  const counts = new Map<string, number>();
  for (const job of clusterJobs.value) for (const topicId of new Set(job.topicIds)) counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
  const query = opportunityTopicKey(excludedTopicSearch.value);
  return allInsights.value.graph.topics.flatMap(topic => {
    const count = counts.get(topic.id) ?? 0;
    return (count || excludedJobTopicIds.value.includes(topic.id)) && (!query || opportunityTopicKey(topic.label).includes(query)) ? [{ ...topic, count }] : [];
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});
// Count the interest cohort before applying the matching-job minimum, so the
// slider's own value cannot shrink its range or require another graph scan.
const matchingTopicsAtInterest = computed(() => filterOpportunityInsightTopics(explorerGraph.value, {
  mode: interestMode.value, interestThreshold: interestThreshold.value, minimumJobCount: 1,
}));
const maximumTopicCount = computed(() => matchingTopicsAtInterest.value.reduce((maximum, topic) => Math.max(maximum, topic.matchingJobCount), 1));
watch([maximumTopicCount, minimumJobCount, interestMode, () => props.loading], ([maximum, minimum, mode, loading]) => {
  if (mode === 'low' || loading) return;
  const bounded = Math.max(1, Math.min(maximum, Number.isFinite(minimum) ? Math.floor(minimum) : 1));
  if (minimum !== bounded) minimumJobCount.value = bounded;
}, { immediate: true, flush: 'pre' });
const topicMatches = computed(() => matchingTopicsAtInterest.value.filter(topic => topic.matchingJobCount >= topicFilter.value.minimumJobCount));
const visibleTopicIds = computed(() => topicMatches.value.map(match => match.topicId));
const matchingJobCounts = computed(() => Object.fromEntries(topicMatches.value.map(match => [match.topicId, match.matchingJobCount])));
const visibleTopicSet = computed(() => new Set(visibleTopicIds.value));
const normalizedQuery = computed(() => opportunityTopicKey(graphSearch.value));
function matchesTopicSelection(job: OpportunityInsightJob): boolean {
  const matchesInterest = interestMode.value === 'all' || job.explicitInterest && job.interestScore !== null
    && (interestMode.value === 'high' ? job.interestScore >= interestThreshold.value : job.interestScore <= interestThreshold.value);
  return matchesInterest && job.topicIds.some(topicId => visibleTopicSet.value.has(topicId))
    && (!selectedTopicIds.value.length || job.topicIds.some(topicId => selectedTopicIds.value.includes(topicId)));
}
const matchingJobs = computed(() => {
  const query = normalizedQuery.value;
  return explorerGraph.value.jobs.filter(job => {
    const inCohort = networkMode.value === 'jobs' ? clusterJobIds.value.has(job.id) : matchesTopicSelection(job);
    return inCohort && (!query || [job.title, job.institution, ...job.topicIds.map(topicId => topicById.value.get(topicId)?.label)]
      .some(value => value?.toLocaleLowerCase().includes(query)));
  }).sort((a, b) => (b.interestScore ?? -1) - (a.interestScore ?? -1) || (a.title ?? '').localeCompare(b.title ?? ''));
});
const visibleTopics = computed(() => explorerGraph.value.topics.filter(topic => visibleTopicSet.value.has(topic.id)
  && (!normalizedQuery.value || topic.label.toLocaleLowerCase().includes(normalizedQuery.value)))
  .sort((a, b) => (matchingJobCounts.value[b.id] ?? 0) - (matchingJobCounts.value[a.id] ?? 0) || a.label.localeCompare(b.label)));
watch([interestMode, highThreshold, lowThreshold, minimumJobCount, currentOnly], () => {
  selectedTopicIds.value = [];
  selectedJobId.value = null;
});
watch([clusterJobIds, networkMode], () => { if (networkMode.value === 'jobs' && selectedJobId.value && !clusterJobIds.value.has(selectedJobId.value)) selectedJobId.value = null; });
function toggleTopic(topicId: string) {
  if (!topicById.value.has(topicId)) return;
  if (selectedTopicIds.value.includes(topicId)) selectedTopicIds.value = selectedTopicIds.value.filter(value => value !== topicId);
  else if (selectedTopicIds.value.length < 5) selectedTopicIds.value = [...selectedTopicIds.value, topicId];
  else notify({ tone: 'info', message: text('Choose up to five topics for the trend comparison. Remove one to add another.', 'Vergleiche bis zu fünf Themen im Verlauf. Entferne eines, um ein anderes hinzuzufügen.') });
}
function selectJob(jobId: string) { if (explorerGraph.value.jobs.some(job => job.id === jobId)) selectedJobId.value = jobId; }
function selectNetworkMode(mode: 'topics' | 'jobs') {
  networkMode.value = mode;
  selectedJobId.value = null;
  focusedTopicIds.value = null;
  graphSearch.value = '';
}
watch(() => explorerGraph.value.jobs, jobs => {
  if (selectedJobId.value && !jobs.some(job => job.id === selectedJobId.value)) selectedJobId.value = null;
});
const summary = computed(() => insights.value.summary);
const highInterestPanels = computed(() => [
  { key: 'institutions', label: text('Universities & institutions', 'Hochschulen & Einrichtungen'), groups: insights.value.highInterest.institutions, omitted: insights.value.highInterest.omittedInstitutions },
  { key: 'countries', label: text('Countries', 'Länder'), groups: insights.value.highInterest.countries, omitted: insights.value.highInterest.omittedCountries },
]);
const rate = (value: number | null) => value === null ? text('Unknown', 'Unbekannt') : `${number(value * 100, 0)}%`;
const search = useOpportunityInsightsSearch({ ownerId: () => props.ownerId, client: () => props.client, projectRef: () => connectedProjectRef.value });
const reasonRows = computed(() => ['topic', 'method', 'hardware', 'location', 'funding', 'timing', 'other'].map(category => ({
  category, positive: insights.value.reasons.find(row => row.category === category && row.polarity === 'positive')?.count ?? 0,
  negative: insights.value.reasons.find(row => row.category === category && row.polarity === 'negative')?.count ?? 0,
})).filter(row => row.positive + row.negative > 0));
const maximumReason = computed(() => Math.max(1, ...reasonRows.value.flatMap(row => [row.positive, row.negative])));
const reasonLabel = (category: string) => ({ topic: text('Topic', 'Thema'), method: text('Method', 'Methode'), hardware: text('Hardware', 'Hardware'),
  location: text('Location', 'Ort'), funding: text('Funding', 'Finanzierung'), timing: text('Timing', 'Zeitpunkt'), other: text('Other', 'Sonstiges') })[category] ?? category;
const originLabel = (origin: string) => ({ explicit_rating: text('Explicit rating', 'Eigene Bewertung'), categorical_review: text('Interest category', 'Interessenauswahl'),
  confirmed_submission: text('Submission fallback', 'Einreichung als Ersatzsignal'), none: text('Unknown', 'Unbekannt') })[origin] ?? origin;
const percent = (value: number, total: number) => total ? value / total * 100 : 0;
const copying = ref(false);
const preparedText = ref('');
const copyFailed = ref(false);
const preparedExamples = ref(0);
let generation = 0;
let disposed = false;
let copyToastId = 0;
let copyController: AbortController | null = null;
const { notify, dismiss } = useToasts();
function clearCopy() {
  generation++; preparedText.value = ''; copyFailed.value = false; copying.value = false;
  copyController?.abort(); copyController = null;
  if (copyToastId) { dismiss(copyToastId); copyToastId = 0; }
}
watch(input, clearCopy, { flush: 'sync' });
watch([interestMode, highThreshold, lowThreshold, minimumJobCount, jobInterestDraft, jobClusterDraft, jobClusterCount, excludedJobTopicIds, currentOnly], clearCopy, { flush: 'sync' });
watch(currentOpportunities, () => { if (currentOnly.value) clearCopy(); }, { flush: 'sync' });
watch([() => props.opportunities, () => props.reviews, () => props.applications], () => {
  clearCopy();
  windowNow.value = new Date().toISOString();
}, { deep: true, flush: 'sync' });
watch([() => props.client, connectedProjectRef, search.searchId], clearCopy, { flush: 'sync' });
onBeforeUnmount(() => { disposed = true; clearCopy(); });
useToastWatch(() => search.loading.value ? text('Loading saved search context…', 'Gespeicherter Suchkontext wird geladen…') : '', { passive: true });
useToastWatch(() => search.error.value ? text('Saved search context could not be loaded. Feedback charts are still available.', 'Der gespeicherte Suchkontext konnte nicht geladen werden. Die Feedbackdiagramme sind weiterhin verfügbar.') : '',
  () => ({ tone: 'error', action: { label: text('Retry', 'Erneut versuchen'), run: search.refresh } }));

async function copyAnalysis() {
  if (disposed || copying.value || props.loading || brushActive.value || jobInterestDraft.value !== jobMinimumInterest.value || jobClusterDraft.value !== jobClusterCount.value) return;
  const token = generation, captured = input.value, searchId = search.searchId.value;
  const controller = new AbortController(); copyController = controller;
  const current = () => !disposed && token === generation && captured === input.value && searchId === search.searchId.value;
  copying.value = true;
  copyFailed.value = false;
  let examples = 0;
  try {
    const result = await copyPreparedText(async () => {
      const prompt = await buildOpportunityInsightsAnalysisPrompt({ ...captured, searchId, signal: controller.signal,
        topicFilter: { ...topicFilter.value }, jobClusterMinimumInterest: jobMinimumInterest.value, jobClusterCount: jobClusterCount.value, jobClusterExcludedTopicIds: [...excludedJobTopicIds.value],
        explorerCurrentOnly: currentOnly.value, explorerCurrentAt: currentOnly.value ? currentClock.value.toISOString() : undefined });
      if (!current()) return null;
      examples = prompt.exampleCount;
      return prompt.text;
    });
    if (!current() || !result) return;
    preparedText.value = result.value;
    preparedExamples.value = examples;
    copyFailed.value = !result.copied;
    copyToastId = notify({ tone: result.copied ? 'success' : 'error',
      message: result.copied ? text('Analysis prompt copied. Paste it into ChatGPT.', 'Analyseanweisung kopiert. In ChatGPT einfügen.')
        : text('Copy failed. Select the prepared analysis prompt below or retry copying.', 'Kopieren fehlgeschlagen. Wähle die vorbereitete Analyseanweisung unten aus oder kopiere erneut.'),
      ...(!result.copied ? { action: { label: text('Retry copy', 'Erneut kopieren'), run: () => current() ? copyAnalysis() : undefined } } : {}),
    });
  } catch {
    if (current()) copyToastId = notify({ tone: 'error', message: text('The analysis prompt could not be prepared. Retry copying it.', 'Die Analyseanweisung konnte nicht vorbereitet werden. Kopiere sie erneut.'),
      action: { label: text('Retry', 'Erneut versuchen'), run: () => current() ? copyAnalysis() : undefined } });
  } finally { if (copyController === controller) copyController = null; if (current()) copying.value = false; }
}
</script>

<template>
  <section class="opportunity-insights" :aria-labelledby="`${id}-heading`" :aria-busy="loading || search.loading.value">
    <div class="insights-heading-inset"><header class="insights-heading workspace-page-heading">
      <div class="insights-title">
        <h2 :id="`${id}-heading`">{{ text('Insights', 'Einblicke') }}</h2>
        <InfoHint :lang="lang" :label="text('Insights', 'Einblicke')" :text="text('Compare your current feedback by catalogue Added date using the time brush. Results filters do not apply. Copy the English analysis prompt to paste into ChatGPT.', 'Vergleiche dein aktuelles Feedback nach Hinzufügedatum im Katalog und wähle den Zeitraum mit dem Zeitpinsel. Ergebnisfilter gelten hier nicht. Kopiere die englische Analyseanweisung zum Einfügen in ChatGPT.')" />
      </div>
      <button class="btn insights-copy" type="button" :disabled="loading || search.loading.value || copying || brushActive || jobInterestDraft !== jobMinimumInterest || jobClusterDraft !== jobClusterCount || !summary.catalogueCount" :aria-busy="copying" @click="copyAnalysis"><FontAwesomeIcon :icon="faCopy" aria-hidden="true" />{{ text('Copy analysis prompt', 'Analyseanweisung kopieren') }}</button>
    </header></div>

    <template v-if="!loading">
      <div class="insights-body-tabs" role="tablist" :aria-label="text('Insights views', 'Ansichten der Einblicke')"><button v-for="tab in bodyTabs" :id="`${id}-view-${tab}`" :key="tab" type="button" role="tab" :aria-label="bodyTabLabel(tab)" :aria-selected="activeBody === tab" :aria-controls="`${id}-body-${tab}`" :tabindex="activeBody === tab ? 0 : -1" @click="activeBody = tab" @keydown="bodyTabKey($event, tab)">{{ bodyTabLabel(tab) }}</button></div>
      <div v-if="activeBody === 'development'" class="insights-development-tabs"><OpportunityInsightsTimelineControls :view="timelineView" :lang="lang" :panel-id="`${id}-development-chart`" @update:view="timelineView = $event" /></div>
      <div :id="`${id}-body-${activeBody}`" :key="activeBody" class="insights-body" role="tabpanel" :aria-labelledby="`${id}-view-${activeBody}`" tabindex="0">
      <div v-if="search.error.value" class="insights-context-recovery"><button class="btn" type="button" :disabled="search.loading.value" @click="search.refresh">{{ text('Reload analysis context', 'Analysekontext erneut laden') }}</button></div>
      <OpportunityInsightsTimeline v-if="activeBody === 'development'" :key="ownerId" :timeline="insights.timeline" :topics="insights.graph.topics" :selected-topic-ids="timelineTopicIds" :selected-job="selectedJob" :lang="lang" :aggregation="aggregation" :view="timelineView" :show-controls="false" :panel-id="`${id}-development-chart`" @update:aggregation="aggregation = $event" @update:view="timelineView = $event" />
      <dl v-if="activeBody === 'development'" class="insights-summary">
        <div><dt>{{ text('With interest', 'Mit Interessenwert') }}</dt><dd>{{ number(summary.scoredCount, 0) }} / {{ number(summary.eligibleCount, 0) }}</dd></div>
        <div><dt>{{ text('Potential misalignments', 'Mögliche Fehlpassungen') }}</dt><dd>{{ number(insights.falsePositives.count, 0) }}</dd></div>
        <div><dt>{{ text('Explicit high interest', 'Ausdrücklich hohes Interesse') }}</dt><dd>{{ number(summary.highInterestCount, 0) }}</dd></div>
        <div><dt>{{ text('Unknown interest', 'Unbekanntes Interesse') }}</dt><dd>{{ number(summary.unknownCount, 0) }}</dd></div>
        <div><dt>{{ text('Excluded', 'Ausgeschlossen') }}</dt><dd>{{ number(summary.excludedCount, 0) }}</dd></div>
      </dl>

      <div v-if="!summary.catalogueCount" class="insights-empty">
        <h3>{{ opportunities.length ? text('No jobs added in this window', 'Keine Stellen in diesem Zeitraum hinzugefügt') : text('Your feedback starts the picture', 'Dein Feedback macht das Bild sichtbar') }}</h3>
        <p>{{ opportunities.length ? text('Choose a wider window to include more catalogue additions.', 'Wähle einen größeren Zeitraum, um mehr Katalogzugänge einzubeziehen.') : text('Review opportunities in Results to see interest patterns here.', 'Bewerte Stellen unter Ergebnisse, um hier Interessenmuster zu sehen.') }}</p>
        <button v-if="opportunities.length && rangeDates" class="btn" type="button" @click="showAllFeedback">{{ text('Show all history', 'Gesamten Verlauf anzeigen') }}</button>
      </div>
      <template v-else>
      <section v-if="activeBody === 'topics'" class="insights-explorer" :aria-labelledby="`${id}-map-heading`">
        <DesktopSidebarPortal area="major" :active="sidebarActive">
          <div class="insights-sidebar-controls insights-major-actions" :class="{ 'is-sidebar': sidebarControlsActive }">
            <div class="insights-view-switch" role="group" :aria-label="text('Cluster view', 'Gruppenansicht')">
              <button class="btn" type="button" :aria-pressed="networkMode === 'jobs'" @click="selectNetworkMode('jobs')">{{ text('Job clusters', 'Stellengruppen') }}</button>
              <button class="btn" type="button" :aria-pressed="networkMode === 'topics'" @click="selectNetworkMode('topics')">{{ text('Topic clusters', 'Themengruppen') }}</button>
            </div>
            <div :id="`${id}-presentation-controls`" class="insights-presentation-target" />
          </div>
        </DesktopSidebarPortal>
        <div class="insights-section-heading insights-explorer-heading">
          <div class="insights-title"><h3 :id="`${id}-map-heading`">{{ networkMode === 'jobs' ? text('Job clusters', 'Stellengruppen') : text('Topics in context', 'Themen im Zusammenhang') }}</h3><InfoHint :lang="lang" :label="text('Clustering', 'Gruppenbildung')" :text="networkMode === 'jobs' ? text('Group jobs by their topics and your feedback. Select a job to inspect its complete topic list and rating.', 'Gruppiere Stellen nach ihren Themen und deinem Feedback. Wähle eine Stelle, um ihre vollständige Themenliste und deine Bewertung zu sehen.') : text('Select up to five topics for trends and matching jobs. Larger nodes have more matching jobs. Muted topics remain selectable.', 'Wähle bis zu fünf Themen für Verlauf und passende Stellen. Größere Knoten stehen für mehr passende Stellen. Gedämpfte Themen kannst du weiter auswählen.')" /></div>
          <div v-if="networkMode === 'jobs'" class="insights-topic-filters insights-job-filters" role="group" :aria-label="text('Job filters', 'Stellenfilter')">
            <div class="insights-job-interest" role="group" :aria-label="text('Job cluster filters', 'Filter für Stellengruppen')">
              <label class="insights-filter-slider"><span>{{ text('Minimum interest', 'Mindestinteresse') }} <strong>{{ jobInterestDraft.toFixed(1) }} / 10</strong></span><input type="range" min="0" max="10" step="0.5" :value="jobInterestDraft" @input="previewJobInterest" @change="commitJobInterest" /></label>
              <InfoHint :lang="lang" :label="text('Minimum job interest', 'Mindestinteresse für Stellen')" :text="text('Include jobs with your rating or review category at or above this score. Release the slider to update the clusters; overall statistics keep their thresholds.', 'Zeige Stellen mit eigener Bewertung oder Interessenkategorie ab diesem Wert. Lass den Regler los, um die Gruppen zu aktualisieren; andere Statistiken behalten ihre Schwellen.')" />
            </div>
            <div class="insights-job-interest" role="group" :aria-label="text('Job cluster count', 'Anzahl der Stellengruppen')">
              <label class="insights-filter-slider"><span>{{ text('Clusters', 'Gruppen') }} <strong>{{ jobClusterDraft }}</strong></span><input type="range" min="1" :max="maximumJobClusters" step="1" :value="jobClusterDraft" :disabled="!clusterJobs.length" @input="previewJobClusters" @change="commitJobClusters" /></label>
              <InfoHint :lang="lang" :label="text('Number of job clusters', 'Anzahl der Stellengruppen')" :text="text('Choose 1–10 groups in both views. Group sizes differ by at most one job, so some jobs may have little in common. Release to apply.', 'Wähle 1–10 Gruppen für beide Ansichten. Die Gruppengrößen unterscheiden sich um höchstens eine Stelle; einzelne Stellen können wenig gemeinsam haben. Lass den Regler zum Anwenden los.')" />
            </div>
          </div>
          <div v-else class="insights-topic-filters" role="group" :aria-label="text('Topic filters', 'Themenfilter')">
            <label class="insights-filter-mode"><span>{{ text('Interest', 'Interesse') }}</span><select v-model="interestMode"><option value="all">{{ text('All topics', 'Alle Themen') }}</option><option value="high">{{ text('At or above', 'Mindestens') }}</option><option value="low">{{ text('At or below', 'Höchstens') }}</option></select></label>
            <label v-if="interestMode !== 'all'" class="insights-filter-slider"><span>{{ interestMode === 'low' ? text('Maximum interest', 'Maximales Interesse') : text('Minimum interest', 'Minimales Interesse') }} <strong>{{ number(interestThreshold) }} / 10</strong></span><input type="range" min="0" max="10" step="0.5" :value="interestThreshold" @input="setInterestThreshold" /></label>
            <label v-if="interestMode !== 'low'" class="insights-filter-slider"><span>{{ text('Minimum matching jobs', 'Mindestens passende Stellen') }} <strong>{{ number(minimumJobCount, 0) }}</strong></span><input v-model.number="minimumJobCount" type="range" min="1" :max="maximumTopicCount" step="1" :disabled="!matchingTopicsAtInterest.length" /></label>
            <InfoHint :lang="lang" :label="text('Topic filters', 'Themenfilter')" :text="interestMode === 'low' ? text('In the selected period, include topics with at least one rated job and none above the maximum. Interest categories count as ratings.', 'Zeige im gewählten Zeitraum Themen mit mindestens einer bewerteten Stelle und keiner Bewertung über dem Maximum. Interessenkategorien zählen als Bewertungen.') : interestMode === 'high' ? text('Count jobs whose rating or interest category meets the minimum. Keep topics with at least the chosen number of matching jobs.', 'Zähle Stellen, deren Bewertung oder Interessenkategorie das Minimum erreicht. Zeige Themen mit mindestens der gewählten Zahl passender Stellen.') : text('Count jobs with each topic, including jobs without feedback. Use the job-count minimum to hide rare topics.', 'Zähle Stellen pro Thema, auch ohne Feedback. Blende seltene Themen über die Mindestzahl passender Stellen aus.')" />
          </div>
        </div>
        <DesktopSidebarPortal area="minor" :active="sidebarActive">
          <div class="insights-sidebar-controls insights-minor-actions" :class="{ 'is-sidebar': sidebarControlsActive }">
            <div :id="`${id}-camera-controls`" class="insights-camera-target" />
            <div class="insights-current-filter">
              <label><input v-model="currentOnly" type="checkbox" />{{ text('Current opportunities only', 'Nur aktuelle Stellenangebote') }}</label>
              <InfoHint :lang="lang" :label="text('Current opportunities', 'Aktuelle Stellenangebote')" :text="text('Leave out expired jobs and jobs you moved to Past; keep jobs with unknown deadlines. Filter topic and job views, matching jobs and the copied hierarchy. Overall statistics and examples keep the full period.', 'Blende abgelaufene Stellen und von dir nach Früher verschobene Stellen aus; behalte Stellen ohne bekannte Frist. Filtere Themen- und Stellenansichten, passende Stellen und die kopierte Hierarchie. Andere Statistiken und Beispiele behalten den ganzen Zeitraum.')" />
            </div>
          </div>
        </DesktopSidebarPortal>
        <div class="insights-network-layout" :class="{ 'is-fallback': !networkAvailable, 'is-job-explorer': networkMode === 'jobs' }">
          <div class="insights-network-visual">
            <OpportunityTopicNetwork :key="ownerId" :presentation-controls-target="`#${id}-presentation-controls`" :camera-controls-target="`#${id}-camera-controls`" :graph="explorerGraph" :view-mode="networkMode" :job-minimum-interest="jobMinimumInterest" :job-cluster-count="jobClusterCount" :job-excluded-topic-ids="excludedJobTopicIds" :visible-topic-ids="visibleTopicIds" :matching-job-counts="matchingJobCounts" :interest-mode="interestMode" :interest-threshold="interestThreshold" :selected-topic-ids="selectedTopicIds" :selected-job-id="selectedJobId" :owner-id="ownerId" :layout-paused="brushActive" :lang="lang" @select-topic="toggleTopic" @select-job="selectJob" @availability="networkAvailable = $event" @focus-topics="setTopicFocus" />
          </div>
          <section class="insights-matching-jobs" :aria-labelledby="`${id}-matching-jobs`">
            <div class="insights-list-heading"><h4 :id="`${id}-matching-jobs`">{{ text('Matching jobs', 'Passende Stellen') }}</h4><button v-if="selectedJobId" class="insights-text-button" type="button" @click="selectedJobId = null">{{ text('Clear selection', 'Auswahl aufheben') }}</button><span>{{ matchingJobs.length }}</span></div>
            <ul class="insights-job-list" :class="{ 'is-job-explorer': networkMode === 'jobs' }"><li v-for="job in matchingJobs" :key="job.id"><button type="button" :aria-pressed="selectedJobId === job.id" @click="selectJob(job.id)"><span>{{ job.title ?? text('Title withheld', 'Titel zurückgehalten') }}</span><small>{{ job.mismatch ? text('High fit · low interest', 'Hohe Passung · niedriges Interesse') : job.highInterest ? text('High interest', 'Hohes Interesse') : job.explicitInterest ? text('Explicit feedback', 'Ausdrückliches Feedback') : text('Interest unknown', 'Interesse unbekannt') }}</small></button></li></ul>
            <p v-if="!matchingJobs.length" class="insights-empty-note">{{ text('No jobs match this selection.', 'Keine Stellen entsprechen dieser Auswahl.') }}</p>
          </section>
          <aside class="insights-network-list" :aria-label="text('Explore topics and jobs', 'Themen und Stellen erkunden')">
            <label :for="`${id}-topic-search`">{{ networkMode === 'jobs' ? text('Find a job', 'Stelle finden') : text('Find a topic or job', 'Thema oder Stelle finden') }}</label>
            <input :id="`${id}-topic-search`" v-model="graphSearch" type="search" autocomplete="off" />
            <section v-if="networkMode === 'jobs'" class="insights-job-exclusions" :aria-labelledby="`${id}-exclusions`">
              <div class="insights-list-heading"><h4 :id="`${id}-exclusions`">{{ text('Exclude topics', 'Themen ausschließen') }}</h4><InfoHint :lang="lang" :label="text('Topic exclusions', 'Themenausschlüsse')" :text="text('Select broad topics to leave them out of clustering in both views. You keep the jobs, their complete topic lists and your feedback.', 'Wähle allgemeine Themen, um sie in beiden Ansichten von der Gruppenbildung auszunehmen. Du behältst die Stellen, ihre vollständigen Themenlisten und dein Feedback.')" /><span>{{ excludedJobTopicIds.length }} {{ text('excluded', 'ausgeschlossen') }}</span></div>
              <button v-if="excludedJobTopicIds.length" class="insights-text-button" type="button" @click="excludedJobTopicIds = []">{{ text('Clear exclusions', 'Ausschlüsse aufheben') }}</button>
              <label :for="`${id}-exclude-search`">{{ text('Find a topic to exclude', 'Thema zum Ausschließen suchen') }}</label>
              <input :id="`${id}-exclude-search`" v-model="excludedTopicSearch" type="search" autocomplete="off" />
              <ul v-if="jobExclusionTopics.length" class="insights-excluded-topic-list"><li v-for="topic in jobExclusionTopics" :key="topic.id"><label :class="{ 'is-excluded': excludedJobTopicIds.includes(topic.id) }"><input type="checkbox" :checked="excludedJobTopicIds.includes(topic.id)" :aria-label="`${text('Exclude', 'Ausschließen:')} ${topic.label}`" @change="toggleExcludedTopic(topic.id)" /><span>{{ topic.label }}</span><small>{{ topic.count }} / {{ clusterJobs.length }} {{ text('jobs', 'Stellen') }}</small></label></li></ul>
              <p v-else class="insights-empty-note">{{ text('No matching topics to exclude.', 'Keine passenden Themen zum Ausschließen.') }}</p>
            </section>
            <template v-if="networkMode === 'topics'">
            <div class="insights-list-heading"><h4>{{ text('Topics', 'Themen') }}</h4><button v-if="selectedTopicIds.length" class="insights-text-button" type="button" @click="selectedTopicIds = []">{{ text('Clear selection', 'Auswahl aufheben') }}</button><span>{{ selectedTopicIds.length }} / 5</span></div>
            <ul class="insights-topic-list"><li v-for="topic in visibleTopics" :key="topic.id" :class="{ 'is-muted': focusedTopicIds !== null && !focusedTopicIds.has(topic.id) && !selectedTopicIds.includes(topic.id) }"><button type="button" :aria-pressed="selectedTopicIds.includes(topic.id)" @click="toggleTopic(topic.id)"><span>{{ topic.label }}</span><small>{{ matchingJobCounts[topic.id] ?? 0 }} {{ text('jobs', 'Stellen') }}</small></button></li></ul>
            <p v-if="!visibleTopics.length" class="insights-empty-note">{{ text('No matching topic labels.', 'Keine passenden Themenbezeichnungen.') }}</p>
            </template>

          </aside>
        </div>
        <section v-if="selectedJob" class="insights-job-context" :aria-labelledby="`${id}-job-heading`">
          <header><div><h4 :id="`${id}-job-heading`">{{ selectedJob.title ?? text('Title withheld', 'Titel zurückgehalten') }}</h4><p>{{ selectedJob.institution ?? text('Unknown institution', 'Unbekannte Einrichtung') }} · {{ selectedJob.country ?? text('Unknown country', 'Unbekanntes Land') }}</p></div><dl><div><dt>{{ text('Added', 'Hinzugefügt') }}</dt><dd>{{ selectedJob.addedAt ? date(selectedJob.addedAt) : text('Unknown', 'Unbekannt') }}</dd></div><div><dt>{{ text('Current fit', 'Aktuelle Passung') }}</dt><dd>{{ number(selectedJob.currentFit) }}</dd></div><div><dt>{{ text('Your interest', 'Dein Interesse') }}</dt><dd>{{ number(selectedJob.interestScore) }}</dd></div></dl><button class="btn insights-open-opportunity" type="button" @click="emit('openOpportunity', selectedJob.id)">{{ text('Open opportunity', 'Stellenangebot öffnen') }}</button></header>
          <h4>{{ text('Complete topic bundle', 'Alle Themen dieser Stelle') }}</h4>
          <ul class="insights-context-topics"><li v-for="topicId in selectedJob.topicIds" :key="topicId"><button type="button" :aria-pressed="selectedTopicIds.includes(topicId)" @click="toggleTopic(topicId)">{{ topicById.get(topicId)?.label ?? topicId }}</button><span v-if="selectedJob.avoidedTopicIds.includes(topicId)" class="is-avoided">{{ text('Explicitly avoided', 'Ausdrücklich vermieden') }}</span><small v-else>{{ currentTopicById.get(topicId)?.highInterestCount ?? 0 }} {{ text('high-interest jobs share this topic', 'Stellen mit hohem Interesse teilen dieses Thema') }}</small></li></ul>
          <p v-if="!selectedJob.topicIds.length" class="insights-empty-note">{{ text('No safe topic labels recorded for this job.', 'Keine sicheren Themenbezeichnungen für diese Stelle erfasst.') }}</p>
          <div v-if="selectedJob.reasons.length" class="insights-selected-reasons"><h4>{{ text('Your selected reasons', 'Deine gewählten Gründe') }}</h4><ul><li v-for="(reason, index) in selectedJob.reasons" :key="index" :class="{ 'is-avoided': reason.polarity === 'negative' }">{{ reason.polarity === 'negative' ? text('Avoid', 'Vermeiden') : text('Prefer', 'Bevorzugen') }} · {{ reasonLabel(reason.category) }}<span v-if="reason.target"> · {{ reason.target }}</span></li></ul></div>

        </section>
      </section>
      <template v-if="activeBody === 'clusters'">
      <section class="insights-chart" :aria-labelledby="`${id}-reasons`">
          <div class="insights-section-heading"><h3 :id="`${id}-reasons`">{{ text('What drives your feedback', 'Was dein Feedback bestimmt') }}</h3><InfoHint :lang="lang" :label="text('Feedback reasons', 'Feedbackgründe')" :text="text('Compare the positive and negative reasons you selected, counting each job once per category and direction. One job can count in several categories.', 'Vergleiche deine gewählten positiven und negativen Gründe; zähle jede Stelle einmal je Kategorie und Richtung. Eine Stelle kann zu mehreren Kategorien zählen.')" /></div>
          <div class="insights-legend"><span class="is-negative">{{ text('Avoid', 'Vermeiden') }}</span><span>{{ text('Prefer', 'Bevorzugen') }}</span></div>
          <ol v-if="reasonRows.length" class="insights-reasons">
            <li v-for="reason in reasonRows" :key="reason.category">
              <span>{{ reasonLabel(reason.category) }}</span>
              <div class="insights-reason-bars" aria-hidden="true"><span class="insights-track insights-track--negative"><span class="insights-bar is-negative" :style="{ width: `${percent(reason.negative, maximumReason)}%` }" /></span><span class="insights-track"><span class="insights-bar" :style="{ width: `${percent(reason.positive, maximumReason)}%` }" /></span></div>
              <span class="insights-reason-count"><span class="is-negative">{{ number(reason.negative, 0) }} {{ text('avoid', 'vermeiden') }}</span><span>{{ number(reason.positive, 0) }} {{ text('prefer', 'bevorzugen') }}</span></span>
            </li>
          </ol>
          <p v-else class="insights-empty-note">{{ text('No structured reasons yet. Select reasons when reviewing opportunities to compare them here.', 'Noch keine strukturierten Gründe. Wähle bei der Bewertung Gründe aus, um sie hier zu vergleichen.') }}</p>
        </section>

      <section class="insights-chart" :aria-labelledby="`${id}-distribution`">
          <div class="insights-section-heading"><h3 :id="`${id}-distribution`">{{ text('Interest distribution', 'Verteilung des Interesses') }}</h3><InfoHint :lang="lang" :label="text('Interest distribution', 'Verteilung des Interesses')" :text="text('Compare shares among jobs with an interest score. Use your rating first, then review category (2/6/8), then confirmed submission (9). Leave jobs with unknown interest out.', 'Vergleiche Anteile unter Stellen mit Interessenwert. Es zählt deine Bewertung, danach die Interessenkategorie (2/6/8), danach eine bestätigte Einreichung (9). Stellen mit unbekanntem Interesse zählen nicht mit.')" /></div>
          <ol class="insights-bars" :aria-label="text('Interest from 0 to 10', 'Interesse von 0 bis 10')">
            <li v-for="bucket in insights.histogram" :key="bucket.min">
              <span class="insights-bar-label">{{ bucket.label }}</span>
              <span class="insights-track" aria-hidden="true"><span class="insights-bar" :style="{ width: `${percent(bucket.count, summary.scoredCount)}%` }" /></span>
              <span class="insights-bar-value">{{ number(bucket.count, 0) }}<small>{{ number(percent(bucket.count, summary.scoredCount), 0) }}%</small></span>
            </li>
          </ol>
          <p v-if="!summary.scoredCount" class="insights-empty-note">{{ text('No interest scores yet. Add a rating or interest category to an opportunity.', 'Noch keine Interessenwerte. Vergib eine Bewertung oder Interessenauswahl für eine Stelle.') }}</p>
          <dl class="insights-origins"><div v-for="origin in insights.origins" :key="origin.origin"><dt>{{ originLabel(origin.origin) }}</dt><dd>{{ number(origin.count, 0) }}</dd></div></dl>
        </section>
      <section class="insights-section insights-places" :aria-labelledby="`${id}-places`">
        <div class="insights-section-heading">
          <h3 :id="`${id}-places`">{{ text('Where your high interest clusters', 'Wo sich dein hohes Interesse bündelt') }}</h3>
          <InfoHint :lang="lang" :label="text('High-interest institutions and countries', 'Hochschulen und Länder mit hohem Interesse')" :text="text('Compare jobs rated 8+ with all rated jobs in each group; interest categories count as ratings. Read Mean as the average for the 8+ subset.', 'Vergleiche Stellen ab 8 mit allen bewerteten Stellen je Gruppe; Interessenkategorien zählen als Bewertungen. Das Mittel bezieht sich auf die Teilmenge ab 8.')" />
        </div>
        <div class="insights-place-panels">
          <section v-for="panel in highInterestPanels" :key="panel.key" class="insights-cohort-panel" :aria-labelledby="`${id}-high-${panel.key}`">
            <h4 :id="`${id}-high-${panel.key}`">{{ panel.label }}</h4>
            <ol v-if="panel.groups.length" class="insights-cohorts">
              <li v-for="group in panel.groups" :key="group.label ?? 'unknown'">
                <div class="insights-cohort-label"><span>{{ group.label ?? text('Unknown / withheld', 'Unbekannt / zurückgehalten') }}</span><small>{{ number(group.highInterestCount, 0) }} {{ text('high', 'hoch') }} / {{ number(group.reviewedCount, 0) }} {{ text('reviewed', 'bewertet') }}</small></div>
                <div class="insights-cohort-value"><span>{{ rate(group.highInterestShare) }}</span><small v-if="group.meanInterest !== null">{{ text('Mean', 'Mittel') }} {{ number(group.meanInterest) }} / 10</small></div>
                <span class="insights-track" aria-hidden="true"><span class="insights-bar" :style="{ width: `${(group.highInterestShare ?? 0) * 100}%` }" /></span>
              </li>
            </ol>
            <p v-else class="insights-empty-note">{{ text('No explicit high-interest feedback in this breakdown yet.', 'Noch kein ausdrücklich hohes Interesse in dieser Aufteilung.') }}</p>
            <p v-if="panel.omitted" class="insights-omitted">{{ number(panel.omitted, 0) }} {{ text('more groups outside this view', 'weitere Gruppen außerhalb dieser Ansicht') }}</p>
          </section>
        </div>
      </section>
      </template>

      </template>

      <details v-if="preparedText" class="insights-prompt" :open="copyFailed">
        <summary><FontAwesomeIcon :icon="faCopy" class="disclosure-prefix" aria-hidden="true" />{{ text('Prepared ChatGPT analysis', 'Vorbereitete ChatGPT-Analyse') }}<span>{{ number(preparedExamples, 0) }} {{ text('feedback examples', 'Feedbackbeispiele') }}</span></summary>
        <div class="insights-prompt-body"><div class="insights-title"><label :for="`${id}-prompt`">{{ text('Analysis prompt', 'Analyseanweisung') }}</label><InfoHint :lang="lang" :label="text('Copied analysis', 'Kopierte Analyse')" :text="text('Paste this English prompt into ChatGPT. You get statistics; with a saved search, you get the job hierarchy, up to 16 feedback examples and 8 mismatch summaries. Excluded jobs, contact details, application notes, CVs and letters stay out.', 'Füge die englische Analyseanweisung in ChatGPT ein. Du erhältst Kennzahlen; mit gespeicherter Suche die Stellenhierarchie, bis zu 16 Feedbackbeispiele und 8 Zusammenfassungen von Fehlpassungen. Ausgeschlossene Stellen, Kontaktdaten, Bewerbungsnotizen, Lebensläufe und Briefe bleiben außen vor.')" /></div><AutosaveTextarea :id="`${id}-prompt`" :model-value="preparedText" readonly rows="12" spellcheck="false" /></div>
      </details>
      </div>
      <footer class="insights-time-window" :aria-label="text('Shared time window', 'Gemeinsamer Zeitraum')">
        <OpportunityInsightsBrush :key="ownerId" :overview="allInsights.overview" :range-start="rangeDates?.start ?? null" :range-end="rangeDates?.end ?? null" :domain-start="allInsights.coverage.earliestAddedAt ?? undefined" :domain-end="windowNow" :lang="lang" @update:range="selectBrush" @brush-active="setBrushActive" />
      </footer>
    </template>
  </section>
</template>

<style scoped>
.opportunity-insights { container-type: inline-size; display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; color: var(--ui-text); font: 400 13px/1.6 var(--font-ui); }
.insights-heading, .insights-title, .insights-section-heading { display: flex; align-items: center; min-width: 0; }
.insights-heading-inset { flex: 0 0 auto; padding: 24px 32px 0; }
.insights-heading { flex: 0 0 auto; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 0; padding-bottom: 10px; border-bottom: 1px solid var(--ui-divider); }
.insights-development-tabs { flex: 0 0 auto; padding-inline: 32px; }
.insights-body-tabs { display: flex; flex: 0 0 auto; gap: 4px; padding-inline: 32px; border-bottom: 1px solid var(--ui-divider); overflow-x: auto; scrollbar-width: thin; }
.insights-body-tabs button { flex: 0 0 auto; appearance: none; min-height: 42px; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--ui-muted); font: 600 12px/1.5 var(--font-ui); cursor: pointer; white-space: nowrap; }
.insights-body-tabs button[aria-selected=true] { color: var(--ui-accent); border-bottom-color: var(--ui-accent); }
.insights-body-tabs button:hover { color: var(--ui-text); background: var(--ui-surface-hover); }
.insights-body { flex: 1 1 auto; min-height: 0; padding: 24px 32px 32px; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.insights-time-window { flex: 0 0 auto; padding: 4px 32px; border-top: 1px solid var(--ui-divider); background: var(--ui-surface); }
.insights-title, .insights-section-heading { gap: 4px; }
.insights-heading h2 { margin: 0; color: var(--ui-text); text-shadow: none; font: 700 22px/1.3 var(--font-ui); text-transform: none; letter-spacing: 0; }
.opportunity-insights h3 { margin: 0; color: var(--ui-text); text-shadow: none; font: 600 14px/1.5 var(--font-ui); }
.opportunity-insights h4 { margin: 0; color: var(--ui-text); text-shadow: none; font: 600 13px/1.5 var(--font-ui); }
.opportunity-insights p { max-width: 70ch; margin: 0; }
.opportunity-insights .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; font: 600 12px/1.5 var(--font-ui); background: var(--ui-control); }
.opportunity-insights .btn:hover:not(:disabled) { background: var(--ui-surface-hover); }
.opportunity-insights .insights-copy { border-color: var(--ui-accent-border); color: var(--ui-accent); }
.insights-context-recovery { margin-bottom: 20px; }
.insights-summary { display: flex; flex-wrap: wrap; gap: 16px 32px;}
.insights-summary > div { display: grid; gap: 2px; }
.insights-summary dt, .insights-origins dt { color: var(--ui-muted); font-size: 12px; }
.insights-summary dd { margin: 0; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.insights-chart { min-width: 0; }
.insights-chart + .insights-chart { margin-top: 32px; }
.insights-section-heading { margin-bottom: 16px; }
.insights-explorer-heading { align-items: center; flex-wrap: wrap; gap: 12px 28px; }
.insights-explorer-heading > .insights-topic-filters { flex: 1 1 440px; margin: 0; }
.insights-sidebar-controls { min-width: 0; }
.insights-major-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.insights-major-actions.is-sidebar { margin: 0; }
.insights-major-actions.is-sidebar .insights-view-switch, .insights-major-actions.is-sidebar :deep(.network-presentation) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.insights-major-actions.is-sidebar .insights-view-switch > button, .insights-major-actions.is-sidebar :deep(.network-presentation > button) { width: 100%; min-width: 0; white-space: normal; }
.insights-minor-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; margin-bottom: 16px; }
.insights-minor-actions.is-sidebar { flex-direction: column; align-items: stretch; gap: 12px; margin: 0; }
.insights-minor-actions .insights-current-filter { margin: 0; }
.insights-presentation-target:empty, .insights-camera-target:empty { display: none; }
.insights-sidebar-controls :is(button, input):focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.insights-explorer { margin-bottom: 0; }
.insights-topic-filters { display: flex; align-items: end; flex-wrap: wrap; gap: 16px 24px; margin: 0 0 20px; }
.insights-current-filter { display: flex; align-items: center; gap: 4px; margin-bottom: 12px; }
.insights-current-filter label { display: flex; align-items: center; gap: 8px; min-height: 36px; color: var(--ui-text); font-size: 12px; cursor: pointer; }
.insights-current-filter input { flex: 0 0 16px; box-sizing: border-box; width: 16px; height: 16px; padding: 0; margin: 0; accent-color: var(--ui-accent); }
.insights-topic-filters label { display: grid; gap: 5px; font-size: 11px; color: var(--ui-muted); }
.insights-job-interest { display: flex; align-items: end; gap: 8px; flex: 1 1 180px; max-width: 260px; }
.insights-job-interest label { display: grid; gap: 5px; min-width: 0; color: var(--ui-muted); font-size: 11px; }
.insights-job-interest .insights-filter-slider { flex-basis: 140px; }
.insights-job-interest .insights-filter-slider > span { flex-wrap: wrap; gap: 0 8px; }
.insights-filter-mode select { min-height: 36px; max-width: 100%; padding: 5px 28px 5px 8px; font: inherit; }
.insights-filter-slider { flex: 1 1 180px; max-width: 260px; }
.insights-filter-slider > span { display: flex; justify-content: space-between; gap: 10px; }
.insights-filter-slider strong { color: var(--ui-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.insights-filter-slider input { width: 100%; height: 28px; margin: 0; accent-color: var(--ui-accent); cursor: pointer; }
.insights-view-switch { display: flex; flex-wrap: wrap; gap: 8px; }
.insights-view-switch [aria-pressed=true], .insights-view-switch [aria-pressed=true]:hover, .opportunity-insights .insights-view-switch [aria-pressed=true]:hover { color: var(--ui-accent); border-color: var(--ui-accent-border); background: var(--ui-active); }
.insights-view-switch .btn span { color: var(--ui-muted); font-variant-numeric: tabular-nums; }
.insights-network-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; grid-template-areas: 'visual controls' 'jobs controls'; gap: 20px 24px; align-items: start; }
.insights-network-layout.is-job-explorer { grid-template-areas: 'visual visual' 'jobs controls'; }
.insights-network-visual, .insights-network-list { min-width: 0; }
.insights-network-visual { grid-area: visual; }
.insights-matching-jobs { grid-area: jobs; min-width: 0; }
.insights-matching-jobs > .insights-list-heading { margin-top: 0; }
.insights-network-list { grid-area: controls; padding-inline-start: 24px; border-inline-start: 1px solid var(--ui-divider); }
.insights-network-layout.is-fallback { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'visual' 'jobs' 'controls'; }
.insights-network-layout.is-fallback .insights-network-list { padding-inline-start: 0; border-inline-start: 0; }
.insights-network-list > label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; }
.insights-network-list > input, .insights-job-exclusions > input { box-sizing: border-box; width: 100%; min-height: 38px; }
.insights-job-exclusions > label { display: block; margin: 12px 0 8px; color: var(--ui-muted); font-size: 11px; }
.insights-excluded-topic-list { list-style: none; margin: 10px 0 0; padding: 0; max-height: 330px; overflow: auto; scrollbar-gutter: stable; }
.insights-excluded-topic-list label { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 5px 0; cursor: pointer; }
.insights-excluded-topic-list label > span { min-width: 0; overflow-wrap: anywhere; }
.insights-excluded-topic-list input { flex: 0 0 16px; box-sizing: border-box; width: 16px; height: 16px; padding: 0; margin: 0; accent-color: var(--ui-accent); }
.insights-excluded-topic-list small { margin-inline-start: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.insights-excluded-topic-list .is-excluded { color: var(--ui-muted); }
.insights-list-heading { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; }
.insights-list-heading > span { margin-inline-start: auto; color: var(--ui-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.insights-text-button { padding: 2px 0; min-height: 28px; border: 0; background: transparent; color: var(--ui-muted); font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.insights-topic-list, .insights-job-list { list-style: none; padding: 0; margin: 0; max-height: 600px; overflow: auto; scrollbar-gutter: stable; overscroll-behavior: contain; }
.insights-topic-list button, .insights-job-list button { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; box-sizing: border-box; width: 100%; min-height: 36px; padding: 7px 8px; text-align: start; border: 0; border-radius: 4px; background: transparent; color: var(--ui-text); font: inherit; cursor: pointer; }
.insights-topic-list button > span, .insights-job-list button > span { overflow-wrap: anywhere; min-width: 0; }
.insights-topic-list small { white-space: nowrap; }
.insights-topic-list .is-muted > button { color: var(--ui-muted); }
.insights-topic-list .is-muted > button:is(:hover, :focus-visible) { color: var(--ui-text); }
.insights-topic-list button:hover, .insights-job-list button:hover { background: var(--ui-surface-hover); }
.insights-topic-list [aria-pressed=true], .insights-job-list [aria-pressed=true] { color: var(--ui-accent); background: var(--ui-surface-hover); }
.insights-job-list { max-height: 230px; }
.insights-job-list.is-job-explorer { max-height: 460px; }
.insights-job-list button { flex-direction: column; gap: 2px; }
.insights-job-context { border-top: 1px solid var(--ui-divider); margin-top: 24px; padding-top: 20px; }
.insights-job-context > header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px 24px; margin-bottom: 20px; }
.insights-job-context > header > div { flex: 1 1 230px; }
.insights-open-opportunity { align-self: flex-start; }
.insights-job-context > header p { margin-top: 4px; color: var(--ui-muted); font-size: 12px; }
.insights-job-context dl { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 0; }
.insights-job-context dt { color: var(--ui-muted); font-size: 11px; }
.insights-job-context dd { margin: 2px 0 0; font-variant-numeric: tabular-nums; }
.insights-context-topics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; list-style: none; padding: 0; margin: 12px 0 0; }
.insights-context-topics li { display: grid; gap: 2px; min-width: 0; }
.insights-context-topics button { justify-self: start; padding: 0; min-height: 28px; border: 0; background: transparent; font: inherit; font-weight: 600; color: var(--ui-text); text-align: start; cursor: pointer; overflow-wrap: anywhere; }
.insights-context-topics [aria-pressed=true] { color: var(--ui-accent); }
.insights-context-topics .is-avoided, .insights-selected-reasons .is-avoided { color: var(--ui-score-red); font-size: 12px; }
.insights-selected-reasons { margin-top: 24px; }
.insights-selected-reasons ul { display: flex; flex-wrap: wrap; gap: 6px 24px; list-style: none; padding: 0; margin: 10px 0 0; font-size: 12px; }
.insights-bars, .insights-reasons { list-style: none; display: grid; gap: 14px; padding: 0; margin: 0; }
.insights-bars > li { display: grid; grid-template-columns: 52px minmax(0, 1fr) 62px; align-items: center; gap: 12px; min-height: 25px; }
.insights-bar-label, .insights-bar-value, .insights-reason-count { font-variant-numeric: tabular-nums; }
.insights-bar-value { display: flex; justify-content: flex-end; align-items: baseline; gap: 8px; }
.opportunity-insights small { color: var(--ui-muted); font-size: 11px; }
.insights-track { display: block; height: 12px; min-width: 0; background: var(--ui-surface-hover); overflow: hidden; }
.insights-bar { display: block; height: 100%; max-width: 100%; background: var(--ui-accent); }
.insights-origins { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 24px 0 0; }
.insights-origins > div { display: flex; align-items: baseline; gap: 6px; }
.insights-origins dd { margin: 0; font-variant-numeric: tabular-nums; }
.insights-legend { display: flex; align-items: center; gap: 16px; color: var(--ui-muted); font-size: 11px; }
.insights-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.insights-legend > span::before { content: ''; width: 8px; height: 8px; background: var(--ui-accent); }
.insights-legend > .is-negative::before, .insights-bar.is-negative { background: var(--ui-score-red); }
.insights-reasons { margin-top: 18px; }
.insights-reasons > li { display: grid; grid-template-columns: 66px minmax(0, 1fr) 90px; align-items: center; gap: 12px; }
.insights-reasons > li > span:first-child { overflow-wrap: anywhere; }
.insights-reason-bars { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; }
.insights-track--negative .insights-bar { margin-inline-start: auto; }
.insights-reason-count { display: flex; flex-direction: column; align-items: flex-end; font-size: 11px; line-height: 1.5; }
.insights-reason-count > .is-negative { color: var(--ui-score-red); }
.insights-section { margin-top: 0; }
.insights-places { margin-top: 32px; }
.insights-place-panels { display: grid; gap: 32px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.insights-cohort-panel { min-width: 0; }
.insights-cohort-panel h4 { margin-bottom: 16px; }
.insights-cohorts { display: grid; gap: 18px; list-style: none; padding: 0; margin: 0; }
.insights-cohorts > li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; align-items: start; }
.insights-cohorts .insights-track { grid-column: 1 / -1; height: 8px; }
.insights-cohort-label, .insights-cohort-value { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.insights-cohort-value { text-align: end; font-variant-numeric: tabular-nums; }
.insights-cohort-value small { white-space: nowrap; }
.opportunity-insights .insights-omitted { margin-top: 12px; color: var(--ui-muted); font-size: 11px; }
.insights-empty { padding: 20px 0 28px; }
.insights-empty p, .insights-empty-note { color: var(--ui-muted); font-size: 12px; }
.insights-empty p { margin-top: 8px; }
.insights-chart .insights-empty-note { margin-top: 20px; }
.insights-prompt { margin-top: 28px; border-top: 1px solid var(--ui-divider); }
.insights-prompt > summary { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding-block: 16px; cursor: pointer; font-weight: 600; }
.insights-prompt > summary > span { color: var(--ui-muted); font-size: 12px; font-weight: 400; }
.insights-prompt-body { display: grid; gap: 8px; }
.insights-prompt-body :deep(textarea) { box-sizing: border-box; width: 100%; resize: vertical; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.opportunity-insights :is(button, summary, textarea, input):focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.opportunity-insights button:disabled { opacity: .5; cursor: default; }
@container (max-width: 680px) {
  .insights-job-interest { flex-basis: 140px; max-width: none; }
  .insights-filter-slider > span { flex-direction: column; align-items: flex-start; gap: 2px; }
  .insights-network-layout, .insights-network-layout.is-job-explorer { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'visual' 'jobs' 'controls'; }
  .insights-network-list { padding-inline-start: 0; padding-top: 20px; border-inline-start: 0; border-top: 1px solid var(--ui-divider); }
  .insights-topic-list { max-height: 175px; }
  .insights-excluded-topic-list label { min-height: 44px; }
  .insights-context-topics { grid-template-columns: minmax(0, 1fr); }
  .insights-place-panels { grid-template-columns: minmax(0, 1fr); gap: 24px; }
}
@media (max-width: 760px) {
  .insights-current-filter label { min-height: 44px; }
  .insights-heading-inset { padding: 16px 16px 0; }
  .insights-heading { align-items: flex-start; }
  .insights-body-tabs, .insights-development-tabs { padding-inline: 16px; }
  .insights-body-tabs button { min-height: 44px; }
  .insights-body { padding: 20px 16px 28px; }
  .insights-time-window { padding: 4px 16px; }
  .insights-filter-slider { max-width: none; }
  .insights-filter-slider input { height: 36px; }
  .opportunity-insights .btn { min-height: 44px; }
  .insights-summary { gap: 14px 24px; }
  .insights-network-list > input, .insights-job-exclusions > input { font-size: 16px; min-height: 44px; }
  .insights-prompt-body :deep(textarea) { font-size: 16px; }
}
</style>
