<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { JOB_CLUSTER_COLORS } from './opportunityClusterColors';
import type { OpportunityTopicHierarchyNode } from '../domain/opportunityTopicHierarchy';
import { projectOpportunityTopicDendrogram } from '../domain/opportunityTopicDendrogram';
import type { OpportunityGraphNode } from '../domain/opportunityGraphLayout';

const props = withDefaults(defineProps<{ forest: OpportunityTopicHierarchyNode[]; nodes: OpportunityGraphNode[]; selectedIds: Set<string>; relatedIds?: Set<string> | null; lang: string; busy: boolean; entityKind?: 'topic' | 'job' }>(), { entityKind: 'topic' });
const emit = defineEmits<{ select: [id: string] }>();
const host = ref<HTMLElement | null>(null), width = ref(760);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const groups = computed(() => props.entityKind === 'job' ? props.forest : []);
const records = computed(() => new Map(props.nodes.map(node => [node.id, node])));
const diagram = computed(() => projectOpportunityTopicDendrogram(props.forest, width.value, { entityKind: props.entityKind }));
const axisTicks = computed(() => diagram.value.plotRight - diagram.value.plotLeft < 220 ? [0, 50, 100] : [0, 25, 50, 75, 100]);
const allBranches = computed(() => diagram.value.branches.map(branch => branch.path).join(''));
const relatedBranchIds = computed(() => {
  if (!props.relatedIds) return null;
  const related = new Set<string>();
  const pending = props.forest.map(node => ({ node, visited: false }));
  while (pending.length) {
    const { node, visited } = pending.pop()!;
    if (node.topicId) {
      if (props.relatedIds.has(node.topicId)) related.add(node.id);
    } else if (node.children && !visited) {
      pending.push({ node, visited: true }, { node: node.children[0], visited: false }, { node: node.children[1], visited: false });
    } else if (node.children?.some(child => related.has(child.id))) related.add(node.id);
  }
  return related;
});
const relatedBranches = computed(() => diagram.value.branches.filter(branch => relatedBranchIds.value?.has(branch.id)).map(branch => branch.path).join(''));
const isMuted = (id: string) => Boolean(props.relatedIds && !props.relatedIds.has(id) && !props.selectedIds.has(id));
const leafHeight = computed(() => diagram.value.leafHeight);
const jobGroups = computed(() => {
  if (props.entityKind !== 'job') return [];
  const leafRows = new Map(diagram.value.leaves.map(leaf => [leaf.id, leaf]));
  const branchPaths = new Map(diagram.value.branches.map(branch => [branch.id, branch.path]));
  return groups.value.map((node, index) => {
    const leafIds: string[] = [], paths: string[] = [], pending = [node];
    while (pending.length) {
      const item = pending.pop()!;
      if (item.topicId) leafIds.push(item.topicId);
      else if (item.children) {
        const path = branchPaths.get(item.id); if (path) paths.push(path);
        pending.push(item.children[1], item.children[0]);
      }
    }
    const rows = leafIds.flatMap(id => leafRows.get(id) ?? []);
    const top = rows.reduce((value, row) => Math.min(value, row.y), Infinity), bottom = rows.reduce((value, row) => Math.max(value, row.y), -Infinity);
    return { id: node.id, leafIds,
      color: JOB_CLUSTER_COLORS[index % JOB_CLUSTER_COLORS.length]!, path: paths.join(''),
      top: top - leafHeight.value / 2, height: bottom - top + leafHeight.value,
      muted: props.relatedIds != null && !leafIds.some(id => props.relatedIds!.has(id) || props.selectedIds.has(id)) };
  });
});
const leafGroups = computed(() => new Map(jobGroups.value.flatMap(group => group.leafIds.map(id => [id, group] as const))));
function leafDescription(id: string, label: string) {
  const node = records.value.get(id);
  if (node?.kind === 'job') return `${label}: ${node.topicCount ?? 0} ${node.topicCount === 1 ? text('topic group used for clustering', 'Themengruppe für die Gruppenbildung') : text('topic groups used for clustering', 'Themengruppen für die Gruppenbildung')}; ${text('interest', 'Interesse')} ${node.interestScore ?? '—'} / 10`;
  const count = node?.matchingJobCount ?? node?.highInterestCount ?? 0;
  return `${label}: ${count} ${text('matching jobs', 'passende Stellen')}${node?.avoided ? text('; explicit topic avoid reason', '; ausdrücklicher Themen-Vermeidungsgrund') : ''}`;
}
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!host.value) return;
  width.value = host.value.clientWidth;
  observer = new ResizeObserver(entries => { width.value = entries[0]?.contentRect.width ?? width.value; });
  observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="host" class="topic-hierarchy" :class="{ 'is-job': entityKind === 'job', 'is-narrow': diagram.width < 600 }">
    <div class="hierarchy-controls">
      <span class="hierarchy-axis-label">{{ entityKind === 'job' ? text('Relative similarity', 'Relative Ähnlichkeit') : text('Relationship strength', 'Beziehungsstärke') }}</span>
      <InfoHint :lang="lang" :label="entityKind === 'job' ? text('Job dendrogram', 'Stellen-Dendrogramm') : text('Topic dendrogram', 'Themen-Dendrogramm')" :text="entityKind === 'job' ? text('Compare branches within each colored group: joins nearer the job titles mean greater similarity. Read percentages as relative similarity. Select a job for its complete topics and feedback.', 'Vergleiche die Äste innerhalb jeder farbigen Gruppe: Verbindungen näher an den Stellentiteln bedeuten höhere Ähnlichkeit. Lies Prozentwerte als relative Ähnlichkeit. Wähle eine Stelle für ihre vollständigen Themen und dein Feedback.') : text('Read branches from left (weaker) to right (stronger). Percentages show relative relationship strength; disconnected topics stay separate. Select a topic to highlight its direct neighbors.', 'Lies die Äste von links (schwächer) nach rechts (stärker). Prozentwerte zeigen relative Beziehungsstärke; unverbundene Themen bleiben getrennt. Wähle ein Thema, um seine direkten Nachbarn hervorzuheben.')" />
      <span v-if="entityKind === 'job' && forest.length" class="hierarchy-group-count">{{ groups.length }} {{ groups.length === 1 ? text('job cluster', 'Stellengruppe') : text('job clusters', 'Stellengruppen') }}</span>
    </div>
    <div v-if="forest.length" class="hierarchy-dendrogram-scroll">
      <svg class="hierarchy-dendrogram" :width="diagram.width" :height="diagram.height" :viewBox="`0 0 ${diagram.width} ${diagram.height}`" role="group" :aria-label="entityKind === 'job' ? text('Job topic dendrogram', 'Dendrogramm der Stellenthemen') : text('Topic relationship dendrogram', 'Dendrogramm der Themenbeziehungen')">
        <g class="dendrogram-axis" aria-hidden="true"><line :x1="diagram.plotLeft" :x2="diagram.plotRight" y1="30" y2="30" /><g v-for="tick in axisTicks" :key="tick"><line :x1="diagram.plotLeft + tick / 100 * (diagram.plotRight - diagram.plotLeft)" :x2="diagram.plotLeft + tick / 100 * (diagram.plotRight - diagram.plotLeft)" y1="25" y2="34" /><text :x="diagram.plotLeft + tick / 100 * (diagram.plotRight - diagram.plotLeft)" y="18" :text-anchor="tick === 0 ? 'start' : tick === 100 ? 'end' : 'middle'">{{ tick }}%</text></g></g>
        <g v-if="entityKind === 'job'" class="dendrogram-group-bands" aria-hidden="true"><g v-for="group in jobGroups" :key="group.id" :class="{ 'is-muted': group.muted }" :style="{ '--job-group-color': group.color }"><rect x="0" :y="group.top" :width="diagram.width" :height="group.height" /><line x1="5" x2="5" :y1="group.top + 3" :y2="group.top + group.height - 3" /></g></g>
        <path :d="allBranches" class="dendrogram-branches" :class="{ 'is-muted': relatedIds != null }" aria-hidden="true" />
        <path v-if="relatedIds" :d="relatedBranches" class="dendrogram-branches" aria-hidden="true" />
        <path v-if="entityKind === 'job'" v-for="group in jobGroups" :key="group.id" :d="group.path" class="dendrogram-branches is-job-group" :class="{ 'is-muted': group.muted }" :style="{ '--job-group-color': group.color }" aria-hidden="true" />
        <g v-for="leaf in diagram.leaves" :key="leaf.id" class="dendrogram-leaf" :style="entityKind === 'job' ? { '--job-group-color': leafGroups.get(leaf.id)?.color } : undefined" :class="{ 'is-selected': selectedIds.has(leaf.id), 'is-avoided': records.get(leaf.id)?.avoided, 'is-muted': isMuted(leaf.id) }">
          <circle :cx="leaf.x" :cy="leaf.y" r="3" aria-hidden="true" />
          <foreignObject :x="leaf.x + 8" :y="leaf.y - leafHeight / 2" :width="diagram.labelWidth" :height="leafHeight"><button class="dendrogram-topic" type="button" :aria-pressed="selectedIds.has(leaf.id)" :aria-label="leafDescription(leaf.id, leaf.label)" :title="leafDescription(leaf.id, leaf.label)" @click="emit('select', leaf.id)"><span>{{ leaf.label }}</span><small>{{ entityKind === 'job' ? `${records.get(leaf.id)?.interestScore ?? '—'}/10` : records.get(leaf.id)?.matchingJobCount ?? records.get(leaf.id)?.highInterestCount ?? 0 }}</small></button></foreignObject>
        </g>
      </svg>
    </div>
    <p v-if="!busy && !forest.length" class="hierarchy-empty">{{ entityKind === 'job' ? text('No jobs meet the selected interest level in this view.', 'Keine Stellen erreichen in dieser Ansicht das gewählte Mindestinteresse.') : text('No topic relationships in this view.', 'Keine Themenbeziehungen in dieser Ansicht.') }}</p>
  </div>
</template>

<style scoped>
.topic-hierarchy { min-width: 0; border-block: 1px solid var(--ui-divider); padding-block: 14px; }
.hierarchy-controls { display: flex; align-items: end; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 12px; }
.hierarchy-axis-label { color: var(--ui-muted); font-size: 11px; }
.hierarchy-group-count { color: var(--ui-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.dendrogram-group-bands rect { fill: var(--job-group-color); opacity: .045; }
.dendrogram-group-bands line { stroke: var(--job-group-color); stroke-width: 2; }
.dendrogram-group-bands .is-muted { opacity: .2; }
.dendrogram-branches.is-job-group { stroke: var(--job-group-color); stroke-width: 1.5; opacity: .9; }
.dendrogram-branches.is-job-group.is-muted { opacity: .14; }
.hierarchy-dendrogram-scroll { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y; }
.hierarchy-dendrogram { display: block; max-width: none; overflow: visible; }
.dendrogram-axis line { stroke: var(--ui-divider); stroke-width: 1; }
.dendrogram-axis text { fill: var(--ui-muted); font: 11px var(--font-ui); }
.dendrogram-branches { fill: none; stroke: var(--ui-muted); stroke-width: 1; opacity: .5; }
.dendrogram-branches.is-muted { opacity: .14; }
.dendrogram-leaf > circle { fill: var(--job-group-color, var(--ui-muted)); }
.dendrogram-leaf.is-selected > circle { fill: var(--ui-accent); }
.dendrogram-leaf.is-avoided > circle { fill: var(--ui-score-red); }
.dendrogram-leaf.is-muted > circle { opacity: .25; }
.dendrogram-leaf.is-muted .dendrogram-topic { color: var(--ui-muted); }
.dendrogram-leaf.is-muted .dendrogram-topic:is(:hover, :focus-visible) { color: var(--ui-text); }
.dendrogram-topic { display: flex; align-items: center; justify-content: space-between; gap: 10px; box-sizing: border-box; width: 100%; height: 100%; padding: 3px 5px; border: 0; border-radius: 3px; color: var(--ui-text); background: transparent; font: 500 12px/1.5 var(--font-ui); text-align: start; cursor: pointer; }
.dendrogram-topic > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dendrogram-topic small { color: var(--ui-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.is-job .dendrogram-topic small { flex-shrink: 0; }
.is-job.is-narrow .dendrogram-topic > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; white-space: normal; overflow-wrap: anywhere; line-height: 1.4; }
.dendrogram-topic:hover { background: var(--ui-surface-hover); }
.dendrogram-topic[aria-pressed=true] { color: var(--ui-accent); background: var(--ui-surface-hover); }
.dendrogram-topic:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.dendrogram-leaf.is-avoided .dendrogram-topic > span { text-decoration: underline; text-decoration-color: var(--ui-score-red); text-underline-offset: 3px; }
.hierarchy-empty { color: var(--ui-muted); font-size: 12px; }
</style>
