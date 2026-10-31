<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import OpportunityInsightsTimelineControls from './OpportunityInsightsTimelineControls.vue';
import type { OpportunityInsightTimeline } from '../domain/opportunityInsights';

type Aggregation = 'auto' | 'day' | 'week' | 'month';
type Bucket = OpportunityInsightTimeline['buckets'][number];
type View = 'outcomes' | 'topics' | 'alignment';
type Metric = 'hit' | 'gap' | 'rank';
const props = withDefaults(defineProps<{
  timeline: OpportunityInsightTimeline;
  topics: { id: string; label: string; highInterestCount: number }[]; selectedTopicIds: string[];
  selectedJob: { id: string; addedAt: string | null } | null;
  lang: string; aggregation: Aggregation;
  view?: View; showControls?: boolean; panelId?: string;
}>(), { showControls: true });
const emit = defineEmits<{
  'update:aggregation': [value: Aggregation];
  'update:view': [value: View];
}>();
const id = useId(), host = ref<HTMLElement | null>(null);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const number = (value: number, digits = 0) => new Intl.NumberFormat(props.lang === 'de' ? 'de' : 'en', { maximumFractionDigits: digits }).format(value);
const date = (value: string | number) => new Intl.DateTimeFormat(props.lang === 'de' ? 'de' : 'en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
const width = ref(900), height = 264, inset = { left: 42, right: 14, top: 16, bottom: 34 };
const localView = ref<View>('outcomes'), metric = ref<Metric>('hit'), activeBucket = ref<number | null>(null);
const view = computed(() => props.view ?? localView.value);
const timelineHint = computed(() => {
  const basis = text('Group jobs by catalogue Added date and compare your current feedback.', 'Gruppiere Stellen nach ihrem Hinzufügedatum im Katalog und vergleiche dein aktuelles Feedback dazu.');
  if (view.value === 'outcomes') return `${basis} ${text('Bars count added jobs. Lines count jobs with your rating or review category: reviewed, interest ≥8 and mismatches (fit ≥8, interest ≤4). Counts overlap.', 'Balken zählen hinzugefügte Stellen. Die Linien verwenden deine Bewertungen oder Interessenkategorien: bewertete Stellen, Interesse ≥8 und Fehlpassungen (Passung ≥8, Interesse ≤4). Die Zählungen überschneiden sich.')}`;
  if (view.value === 'topics') return `${basis} ${text('Each line counts jobs rated ≥8 for one topic; interest categories count as ratings. A job with several topics can count in several lines.', 'Jede Linie zählt Stellen mit Bewertung ≥8 für ein Thema; Interessenkategorien zählen als Bewertungen. Eine Stelle kann in mehreren Themenlinien zählen.')}`;
  if (metric.value === 'hit') return `${basis} ${text('Among jobs with current fit ≥8 and an explicit interest score, the hit rate is the share with your interest ≥8. The 95% band shows uncertainty from sample size; gaps mean no qualifying jobs.', 'Die Trefferquote ist der Anteil der Stellen mit deinem Interesse ≥8 unter Stellen mit aktueller Passung ≥8 und ausdrücklicher Interessenbewertung. Das 95%-Band zeigt die Unsicherheit durch den Stichprobenumfang; Lücken bedeuten keine passenden Wertepaare.')}`;
  if (metric.value === 'gap') return `${basis} ${text('The absolute gap averages |current fit − your latest explicit interest| across jobs with both scores; lower means closer agreement. Gaps mean no score pairs.', 'Die absolute Abweichung ist der Mittelwert von |aktuelle Passung − dein letztes ausdrückliches Interesse| für Stellen mit beiden Werten; kleiner bedeutet höhere Übereinstimmung. Lücken bedeuten keine Wertepaare.')}`;
  return `${basis} ${text('Compare the order of current fit scores with your latest explicit interest: +1 means the same order, 0 no rank agreement, −1 the reverse. Gaps mean fewer than five pairs or no variation in fit or interest.', 'Vergleiche die Rangfolge aktueller Passungswerte mit deinem letzten ausdrücklichen Interesse: +1 bedeutet gleiche Reihenfolge, 0 keine Rangübereinstimmung, −1 umgekehrte Reihenfolge. Lücken bedeuten weniger als fünf Wertepaare oder gleichbleibende Passungs- oder Interessenwerte.')}`;
});
const plotId = computed(() => props.panelId ?? `${id}-plot`);
function selectView(value: View) { localView.value = value; emit('update:view', value); }
const plotRight = computed(() => Math.max(inset.left + 1, width.value - inset.right));
const plotBottom = height - inset.bottom;
const bins = computed(() => props.timeline.buckets);
const extent = computed(() => {
  const first = props.timeline.start ?? bins.value[0]?.start;
  const last = props.timeline.end ?? bins.value.at(-1)?.end;
  const start = first ? Date.parse(first) : Date.now();
  return { start, end: Math.max(start + 1, last ? Date.parse(last) + 1 : start + 86_400_000) };
});
const x = (time: number) => inset.left + (time - extent.value.start) / (extent.value.end - extent.value.start) * (plotRight.value - inset.left);
const bucketX = (bucket: Bucket) => x((Date.parse(bucket.start) + Date.parse(bucket.end)) / 2);
const chosenTopics = computed(() => {
  const selected = props.selectedTopicIds.slice(0, 5).flatMap(topicId => { const topic = props.topics.find(item => item.id === topicId); return topic ? [topic] : []; });
  return selected.length ? selected : [...props.topics].filter(topic => topic.highInterestCount > 0)
    .sort((a, b) => b.highInterestCount - a.highInterestCount || a.id.localeCompare(b.id)).slice(0, 5);
});
const colors = ['var(--ui-accent)', '#91b9e9', '#dbc18d', '#c6a4da', '#e7a4b5'];
interface Series { key: string; label: string; color: string; values: (number | null)[] }
const series = computed<Series[]>(() => {
  if (view.value === 'outcomes') return [
    { key: 'reviewed', label: text('Reviewed', 'Bewertet'), color: '#91b9e9', values: bins.value.map(bucket => bucket.reviewedCount) },
    { key: 'high', label: text('High interest', 'Hohes Interesse'), color: colors[0]!, values: bins.value.map(bucket => bucket.highInterestCount) },
    { key: 'mismatch', label: text('Misaligned jobs', 'Fehlpassungen'), color: 'var(--ui-score-red)', values: bins.value.map(bucket => bucket.mismatchCount) },
  ];
  if (view.value === 'topics') return chosenTopics.value.map((topic, index) => ({ key: topic.id, label: topic.label, color: colors[index]!, values: bins.value.map(bucket => bucket.topicHighCounts[topic.id] ?? 0) }));
  return [{ key: metric.value, label: metric.value === 'hit' ? text('High-fit hit rate', 'Trefferquote hoher Passung') : metric.value === 'gap' ? text('Absolute gap', 'Absolute Abweichung') : text('Rank agreement', 'Rangübereinstimmung'), color: colors[0]!,
    values: bins.value.map(bucket => metric.value === 'hit' ? bucket.alignment.highFitHitRate : metric.value === 'gap' ? bucket.alignment.meanAbsoluteGap : bucket.alignment.spearman) }];
});
const yDomain = computed(() => view.value === 'alignment' ? metric.value === 'rank' ? { min: -1, max: 1 } : { min: 0, max: metric.value === 'hit' ? 1 : 10 }
  : { min: 0, max: Math.max(1, ...series.value.flatMap(row => row.values.flatMap(value => value === null ? [] : [value])), ...(view.value === 'outcomes' ? bins.value.map(bucket => bucket.addedCount) : [])) });
const y = (value: number) => plotBottom - (value - yDomain.value.min) / (yDomain.value.max - yDomain.value.min) * (plotBottom - inset.top);
const yTicks = computed(() => view.value === 'alignment' ? [yDomain.value.min, (yDomain.value.min + yDomain.value.max) / 2, yDomain.value.max]
  : [...new Set([0, Math.round(yDomain.value.max / 2), yDomain.value.max])]);
const tickLabel = (value: number) => view.value === 'alignment' && metric.value === 'hit' ? `${number(value * 100)}%` : number(value, view.value === 'alignment' ? 1 : 0);
const path = (values: (number | null)[]) => values.map((value, index) => value === null ? '' : `${index === 0 || values[index - 1] === null ? 'M' : 'L'}${bucketX(bins.value[index]!)} ${y(value)}`).join(' ');
const intervalPaths = computed(() => {
  if (view.value !== 'alignment' || metric.value !== 'hit') return [];
  const groups: { index: number; lower: number; upper: number }[][] = [];
  for (let index = 0; index < bins.value.length; index++) {
    const interval = bins.value[index]!.alignment.highFitHitInterval;
    if (!interval) continue;
    if (!index || !bins.value[index - 1]!.alignment.highFitHitInterval) groups.push([]);
    groups.at(-1)!.push({ index, ...interval });
  }
  return groups.map(group => `${group.map((item, index) => `${index ? 'L' : 'M'}${bucketX(bins.value[item.index]!)} ${y(item.upper)}`).join(' ')} ${group.toReversed().map(item => `L${bucketX(bins.value[item.index]!)} ${y(item.lower)}`).join(' ')} Z`);
});
const xTicks = computed(() => bins.value.length ? [...new Set([0, Math.floor((bins.value.length - 1) / 2), bins.value.length - 1])].map(index => ({ value: bucketX(bins.value[index]!), label: new Intl.DateTimeFormat(props.lang === 'de' ? 'de' : 'en', { month: 'short', day: 'numeric' }).format(new Date(bins.value[index]!.start)) })) : []);
const currentBucket = computed(() => bins.value[Math.min(activeBucket.value ?? bins.value.length - 1, bins.value.length - 1)] ?? null);
const metricValue = (bucket: Bucket) => metric.value === 'hit' ? bucket.alignment.highFitHitRate : metric.value === 'gap' ? bucket.alignment.meanAbsoluteGap : bucket.alignment.spearman;
const metricLabel = (bucket: Bucket): string => {
  const value = metricValue(bucket);
  if (value !== null) return metric.value === 'hit' ? `${number(value * 100)}%` : number(value, 2);
  if (!bucket.pairedCount) return text('No comparable scores', 'Keine vergleichbaren Werte');
  if (metric.value === 'hit') return text('No high-fit pairs', 'Keine Paare hoher Passung');
  if (metric.value === 'rank' && bucket.pairedCount < 5) return text('Needs at least 5 pairs', 'Mindestens 5 Wertepaare nötig');
  return text('Scores do not vary', 'Werte variieren nicht');
};
const bucketLabel = (bucket: Bucket) => `${date(bucket.start)} – ${date(bucket.end)}: ${number(bucket.addedCount)} ${text('added', 'hinzugefügt')}, ${number(bucket.reviewedCount)} ${text('reviewed', 'bewertet')}, ${number(bucket.highInterestCount)} ${text('high interest', 'hohes Interesse')}, ${number(bucket.mismatchCount)} ${text('misaligned', 'Fehlpassungen')}, ${number(bucket.pairedCount)} ${text('score pairs', 'Wertepaare')}`;
const noValues = computed(() => !series.value.some(row => row.values.some(value => value !== null)));
const selectedMarker = computed(() => { const time = props.selectedJob?.addedAt ? Date.parse(props.selectedJob.addedAt) : NaN; return Number.isFinite(time) && time >= extent.value.start && time <= extent.value.end ? x(time) : null; });

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!host.value) return;
  width.value = Math.max(280, host.value.clientWidth);
  observer = new ResizeObserver(entries => { width.value = Math.max(280, entries[0]?.contentRect.width ?? 900); });
  observer.observe(host.value);
});
watch(() => props.timeline, () => { activeBucket.value = null; });
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section ref="host" class="insights-timeline" :aria-labelledby="`${id}-heading`">
    <header class="timeline-heading">
      <div class="timeline-title"><h3 :id="`${id}-heading`">{{ text('Development over time', 'Entwicklung im Zeitverlauf') }}</h3><InfoHint :lang="lang" :label="text('Development over time', 'Entwicklung im Zeitverlauf')" :text="timelineHint" /></div>
      <label class="timeline-aggregation"><span>{{ text('Group by', 'Gruppieren') }}</span><select :value="aggregation" @change="emit('update:aggregation', ($event.target as HTMLSelectElement).value as Aggregation)"><option value="auto">{{ text('Auto', 'Automatisch') }}</option><option value="day">{{ text('Day', 'Tag') }}</option><option value="week">{{ text('Week', 'Woche') }}</option><option value="month">{{ text('Month', 'Monat') }}</option></select></label>
    </header>
    <OpportunityInsightsTimelineControls v-if="showControls" :view="view" :lang="lang" :panel-id="plotId" @update:view="selectView" />
    <div :id="plotId" role="tabpanel" :aria-labelledby="`${plotId}-${view}`">
      <div class="timeline-legend">
        <span v-if="view === 'outcomes'" class="timeline-key is-added">{{ text('Added', 'Hinzugefügt') }}</span>
        <span v-for="row in series" :key="row.key" class="timeline-key" :style="{ '--series-color': row.color }">{{ row.label }}</span>
        <label v-if="view === 'alignment'" class="timeline-metric"><span>{{ text('Measure', 'Kennzahl') }}</span><select :value="metric" @change="metric = ($event.target as HTMLSelectElement).value as Metric"><option value="hit">{{ text('High-fit hit rate', 'Trefferquote hoher Passung') }}</option><option value="gap">{{ text('Absolute score gap', 'Absolute Werteabweichung') }}</option><option value="rank">{{ text('Rank agreement', 'Rangübereinstimmung') }}</option></select></label>
      </div>
      <svg v-if="timeline.unavailableReason !== 'too_many_buckets'" class="timeline-plot" :viewBox="`0 0 ${width} ${height}`" :aria-label="text('Current feedback by job addition date', 'Aktuelles Feedback nach Hinzufügedatum')" role="group">
        <g v-for="tick in yTicks" :key="tick" class="timeline-axis"><line :x1="inset.left" :x2="plotRight" :y1="y(tick)" :y2="y(tick)" /><text :x="inset.left - 9" :y="y(tick) + 4" text-anchor="end">{{ tickLabel(tick) }}</text></g>
        <g v-if="view === 'outcomes'" class="timeline-volume"><rect v-for="(bucket, index) in bins" :key="index" :x="x(Date.parse(bucket.start)) + 1" :y="y(bucket.addedCount)" :width="Math.max(1, x(Date.parse(bucket.end) + 1) - x(Date.parse(bucket.start)) - 2)" :height="Math.max(0, plotBottom - y(bucket.addedCount))" /></g>
        <path v-for="(band, index) in intervalPaths" :key="`band-${index}`" :d="band" class="timeline-interval" />
        <g v-for="row in series" :key="row.key" :style="{ color: row.color }"><path :d="path(row.values)" class="timeline-line" /><template v-for="(value, index) in row.values" :key="index"><circle v-if="value !== null" :cx="bucketX(bins[index]!)" :cy="y(value)" r="2.8" class="timeline-point" /></template></g>
        <g v-if="selectedMarker !== null" class="timeline-job-marker"><line :x1="selectedMarker" :x2="selectedMarker" :y1="inset.top" :y2="plotBottom" /><title>{{ text('Selected job added', 'Ausgewählte Stelle hinzugefügt') }}: {{ date(selectedJob!.addedAt!) }}</title></g>
        <rect v-for="(bucket, index) in bins" :key="`inspect-${index}`" class="timeline-inspect" :x="x(Date.parse(bucket.start))" :y="inset.top" :width="Math.max(1, x(Date.parse(bucket.end) + 1) - x(Date.parse(bucket.start)))" :height="plotBottom - inset.top" tabindex="0" role="button" :aria-label="bucketLabel(bucket)" @focus="activeBucket = index" @pointerenter="activeBucket = index" @click="activeBucket = index"><title>{{ bucketLabel(bucket) }}</title></rect>
        <g v-for="(tick, index) in xTicks" :key="index" class="timeline-axis"><text :x="tick.value" :y="height - 8" :text-anchor="index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'">{{ tick.label }}</text></g>
      </svg>
      <p v-if="timeline.unavailableReason === 'too_many_buckets'" class="timeline-empty">{{ text(`${number(timeline.requiredBucketCount)} periods exceed the ${number(timeline.bucketLimit)}-period display limit. Narrow the dates or choose a wider grouping.`, `${number(timeline.requiredBucketCount)} Zeiträume überschreiten die Anzeigegrenze von ${number(timeline.bucketLimit)} Zeiträumen. Grenze die Daten ein oder wähle eine größere Gruppierung.`) }}</p>
      <p v-else-if="!bins.length" class="timeline-empty">{{ text('No jobs with a known Added date in this period.', 'Keine Stellen mit bekanntem Hinzufügedatum in diesem Zeitraum.') }}</p>
      <p v-else-if="view === 'topics' && !chosenTopics.length" class="timeline-empty">{{ text('Select up to five topics in the network to see their high-interest counts over time.', 'Wähle bis zu fünf Themen im Netzwerk, um Stellen mit hohem Interesse im Zeitverlauf zu sehen.') }}</p>
      <p v-else-if="noValues" class="timeline-empty">{{ text('This measure has no comparable values in these periods. Inspect the sample counts or choose a wider grouping.', 'Diese Kennzahl hat in diesen Zeitabschnitten keine vergleichbaren Werte. Prüfe die Stichprobengrößen oder wähle eine größere Gruppierung.') }}</p>
      <div v-if="currentBucket" class="timeline-readout"><span class="timeline-readout-date">{{ date(currentBucket.start) }} – {{ date(currentBucket.end) }}</span><template v-if="view === 'alignment'"><span>{{ metricLabel(currentBucket) }}</span><span>{{ number(currentBucket.pairedCount) }} {{ text('score pairs', 'Wertepaare') }}</span><span v-if="metric === 'hit' && currentBucket.alignment.highFitHitInterval">95%: {{ number(currentBucket.alignment.highFitHitInterval.lower * 100) }}–{{ number(currentBucket.alignment.highFitHitInterval.upper * 100) }}%</span></template><template v-else-if="view === 'topics'"><span v-for="topic in chosenTopics" :key="topic.id">{{ topic.label }}: {{ number(currentBucket.topicHighCounts[topic.id] ?? 0) }}</span></template><template v-else><span>{{ number(currentBucket.addedCount) }} {{ text('added', 'hinzugefügt') }}</span><span>{{ number(currentBucket.reviewedCount) }} {{ text('reviewed', 'bewertet') }}</span><span>{{ number(currentBucket.highInterestCount) }} {{ text('high interest', 'hohes Interesse') }}</span><span>{{ number(currentBucket.mismatchCount) }} {{ text('misaligned', 'Fehlpassungen') }}</span></template></div>
    </div>
  </section>
</template>

<style scoped>
.insights-timeline { min-width: 0; color: var(--ui-text); }
.timeline-heading, .timeline-title { display: flex; align-items: center; gap: 4px; min-width: 0; }
.timeline-heading { justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.timeline-heading h3 { margin: 0; font: 600 14px/1.5 var(--font-ui); }
.timeline-aggregation, .timeline-metric { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--ui-muted); font-size: 11px; }
.timeline-aggregation select, .timeline-metric select { width: auto; min-height: 36px; max-width: 100%; padding: 5px 26px 5px 8px; font: 400 12px/1.5 var(--font-ui); }
.timeline-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 18px; min-height: 36px; margin-bottom: 4px; }
.timeline-key { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ui-muted); }
.timeline-key::before { content: ''; width: 14px; height: 2px; background: var(--series-color); }
.timeline-key.is-added::before { height: 8px; background: var(--ui-divider); }
.timeline-metric { margin-inline-start: auto; }
.timeline-plot { display: block; width: 100%; height: 264px; overflow: visible; }
.timeline-axis { color: var(--ui-muted); font: 11px var(--font-ui); }
.timeline-axis line { stroke: var(--ui-divider); stroke-width: 1; }
.timeline-axis text { fill: currentColor; }
.timeline-volume rect { fill: var(--ui-divider); opacity: .65; }
.timeline-line { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.timeline-point { fill: currentColor; }
.timeline-interval { fill: var(--ui-accent); opacity: .12; }
.timeline-job-marker line { stroke: var(--ui-score-red); stroke-width: 1.5; stroke-dasharray: 4 4; }
.timeline-inspect { fill: transparent; stroke: none; }
.timeline-inspect:hover, .timeline-inspect:focus { fill: var(--ui-accent); fill-opacity: .05; }
.timeline-inspect:focus-visible { outline: none; stroke: var(--ui-accent); stroke-width: 1; }
.timeline-readout { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px 16px; min-height: 32px; margin-top: 4px; color: var(--ui-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.timeline-readout-date { color: var(--ui-text); }
.timeline-empty { margin: 10px 0; color: var(--ui-muted); font-size: 12px; }
select:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
@media (max-width: 760px) {
  .timeline-aggregation select, .timeline-metric select { min-height: 44px; font-size: 16px; }
  .timeline-aggregation { width: 100%; justify-content: space-between; }
  .timeline-metric { width: 100%; margin: 4px 0 0; justify-content: space-between; }
}
</style>
