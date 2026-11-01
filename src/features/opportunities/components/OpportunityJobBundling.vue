<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import type { OpportunityBundlingDiagram } from '../domain/opportunityEdgeBundling';
import type { OpportunityGraphNode } from '../domain/opportunityGraphLayout';
import type { OpportunityInsightJob, OpportunityInsightTopicNode } from '../domain/opportunityInsights';
import { opportunityJobGraphFocus } from '../domain/opportunityJobGraph';
import { JOB_CLUSTER_COLORS, TOPIC_CLUSTER_COLORS, opportunityJobBundlingEdgeColor } from './opportunityClusterColors';
import { attachOpportunityBundlingZoom } from '../interaction/bundlingZoom';

const props = withDefaults(defineProps<{
  diagram: OpportunityBundlingDiagram | null;
  nodes: OpportunityGraphNode[];
  topics: OpportunityInsightTopicNode[];
  jobs?: OpportunityInsightJob[];
  entityKind?: 'job' | 'topic';
  selectedId?: string | null;
  selectedIds?: ReadonlySet<string>;
  lang: string;
  busy: boolean;
}>(), { jobs: () => [], selectedId: null, selectedIds: () => new Set<string>() });
const emit = defineEmits<{ select: [id: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const isTopic = computed(() => (props.entityKind ?? props.diagram?.entityKind ?? 'job') === 'topic');
const host = ref<HTMLElement | null>(null), viewport = ref<HTMLElement | null>(null), width = ref(960), zoom = ref(1);
const hoveredId = ref<string | null>(null), focusedId = ref<string | null>(null), hoveredEdgeId = ref<string | null>(null);
const focusedEdgeId = ref<string | null>(null), tabEdgeId = ref<string | null>(null), edgeTooltipVisible = ref(false);
const edgeTooltip = ref<HTMLElement | null>(null), edgeTooltipId = `bundling-edge-${useId()}`;
const labelWidth = 190;
const radius = computed(() => props.diagram?.radius ?? 240);
const size = computed(() => 2 * (radius.value + labelWidth + 32));
const compact = computed(() => width.value <= 600);
const compactSize = computed(() => radius.value * 2 + 88);
const compactWidth = computed(() => Math.max(280, width.value, ((props.diagram?.leaves.length ?? 0) + (props.diagram?.groups.length ?? 0) * 1.4) * 10.5));
const baseDisplayWidth = computed(() => compact.value ? compactWidth.value : size.value);
const displayWidth = computed(() => baseDisplayWidth.value * zoom.value);
const compactTarget = computed(() => 32 * compactSize.value / compactWidth.value);
const viewBox = computed(() => compact.value
  ? `${size.value / 2 - radius.value - 44} ${size.value / 2 - radius.value - 44} ${compactSize.value} ${compactSize.value}`
  : `0 0 ${size.value} ${size.value}`);
const records = computed(() => new Map(props.nodes.map(node => [node.id, node])));
const topicLabels = computed(() => new Map(props.topics.map(topic => [topic.id, topic.label])));
const jobLabels = computed(() => new Map(props.jobs.map(job => [job.id, job.title])));
const sharedLabel = (count = 2) => isTopic.value
  ? text(count === 1 ? 'Shared job' : 'Shared jobs', count === 1 ? 'Gemeinsame Stelle' : 'Gemeinsame Stellen')
  : text(count === 1 ? 'Shared topic' : 'Shared topics', count === 1 ? 'Gemeinsames Thema' : 'Gemeinsame Themen');
const sharedEvidenceLabels = (ids: readonly string[]) => isTopic.value
  ? ids.map(id => jobLabels.value.get(id) || text('Title withheld', 'Titel zurückgehalten'))
  : ids.map(id => topicLabels.value.get(id) ?? id);
const leaves = computed(() => props.diagram?.leaves.map(leaf => {
  const left = leaf.angle > Math.PI;
  return { ...leaf, left, rotation: leaf.angle * 180 / Math.PI - 90 + (left ? 180 : 0),
    label: records.value.get(leaf.id)?.label || leaf.label || (isTopic.value ? text('Topic withheld', 'Thema zurückgehalten') : text('Title withheld', 'Titel zurückgehalten')) };
}) ?? []);
const leafById = computed(() => new Map(leaves.value.map(leaf => [leaf.id, leaf])));
const selectionIds = computed(() => new Set([...props.selectedIds, ...(props.selectedId ? [props.selectedId] : [])].filter(id => leafById.value.has(id))));
const activeId = computed(() => [hoveredId.value, focusedId.value, ...selectionIds.value].find(id => id && leafById.value.has(id)) ?? null);
const focusIds = computed(() => isTopic.value
  ? new Set([...selectionIds.value, ...(activeId.value ? [activeId.value] : [])]) : new Set(activeId.value ? [activeId.value] : []));
const relatedIds = computed(() => {
  if (!props.diagram || !focusIds.value.size) return null;
  const related = new Set<string>();
  for (const id of focusIds.value) for (const neighbor of opportunityJobGraphFocus(props.diagram.adjacency, id) ?? []) related.add(neighbor);
  return related;
});
const activeLeaf = computed(() => activeId.value ? leafById.value.get(activeId.value) : null);
const activeEdge = computed(() => props.diagram?.edges.find(edge => edge.id === (hoveredEdgeId.value ?? focusedEdgeId.value)));
const tabbableEdgeId = computed(() => props.diagram?.edges.find(edge => edge.id === tabEdgeId.value)?.id ?? props.diagram?.edges[0]?.id);
const activeEdgeTopics = computed(() => sharedEvidenceLabels(activeEdge.value?.sharedIds ?? []));
const color = (index: number) => {
  const palette = isTopic.value ? TOPIC_CLUSTER_COLORS : JOB_CLUSTER_COLORS;
  return palette[index % palette.length]!;
};
// Sparsification retains the strongest pairs first, including the cohort maximum.
const maximumSharedTopics = computed(() => props.diagram?.edges.reduce((maximum, edge) => Math.max(maximum, edge.sharedCount), 0) ?? 0);
const edgeColor = (count: number) => opportunityJobBundlingEdgeColor(count, maximumSharedTopics.value);
const bundlingHint = computed(() => {
  const maximum = maximumSharedTopics.value;
  const scale = isTopic.value
    ? maximum > 1 ? text(`Blue edges share one job; red edges share ${maximum} jobs, the most for these settings.`, `Blaue Linien teilen eine Stelle; rote Linien teilen ${maximum} Stellen, das Maximum für diese Einstellungen.`)
      : maximum === 1 ? text('Every connection currently has one shared job and is blue.', 'Jede Verbindung hat derzeit eine gemeinsame Stelle und ist blau.')
        : text('Curves connect topics that occur in the same jobs.', 'Kurven verbinden Themen, die in denselben Stellen vorkommen.')
    : maximum > 1 ? text(`Blue edges share one topic; red edges share ${maximum} topics, the most for these settings.`, `Blaue Linien teilen ein Thema; rote Linien teilen ${maximum} Themen, das Maximum für diese Einstellungen.`)
      : maximum === 1 ? text('Every connection currently shares one topic and is blue.', 'Jede Verbindung teilt derzeit ein Thema und ist blau.')
        : text('Curves connect jobs with shared topics through the colored cluster hierarchy.', 'Kurven verbinden Stellen mit gemeinsamen Themen entlang der farbigen Gruppenhierarchie.');
  const controls = isTopic.value ? text('Pinch to zoom, scroll to pan, and select topics to find matching jobs.', 'Zoome mit zwei Fingern, scrolle zum Verschieben und wähle Themen für passende Stellen.')
    : text('Pinch to zoom, scroll to pan, and select a job for its title and connections.', 'Ziehe zwei Finger auseinander zum Zoomen, scrolle zum Verschieben und wähle eine Stelle für ihren Titel und ihre Verbindungen.');
  return `${scale} ${controls}`;
});
const connectedJobs = (count: number) => isTopic.value
  ? text(count === 1 ? 'connected topic' : 'connected topics', count === 1 ? 'verbundenes Thema' : 'verbundene Themen')
  : count === 1 ? text('connected job', 'verbundene Stelle') : text('connected jobs', 'verbundene Stellen');
const isMuted = (id: string) => relatedIds.value != null && !relatedIds.value.has(id);
const edgeActive = (edge: { source: string; target: string }) => focusIds.value.has(edge.source) || focusIds.value.has(edge.target);
const edges = computed(() => [...(props.diagram?.edges ?? [])].sort((a, b) => Number(edgeActive(a)) - Number(edgeActive(b))));
function description(id: string) {
  const leaf = leafById.value.get(id);
  if (!leaf) return '';
  if (isTopic.value) return `${leaf.label}; ${leaf.evidenceCount} ${text('matching jobs', 'passende Stellen')}; ${leaf.relationshipCount} ${connectedJobs(leaf.relationshipCount)}${records.value.get(id)?.avoided ? text('; explicit topic avoid reason', '; ausdrücklicher Themen-Vermeidungsgrund') : ''}`;
  return `${leaf.label}; ${text('interest', 'Interesse')} ${records.value.get(id)?.interestScore ?? '—'}/10; ${leaf.relationshipCount} ${connectedJobs(leaf.relationshipCount)}`;
}
function edgeDescription(edge: NonNullable<typeof activeEdge.value>) {
  return `${leafById.value.get(edge.source)?.label ?? ''} · ${leafById.value.get(edge.target)?.label ?? ''}: ${sharedLabel()}: ${sharedEvidenceLabels(edge.sharedIds).join(', ')}`;
}
let edgeAnchor = { x: 0, y: 0 }, focusedEdgeElement: SVGPathElement | null = null;
const tooltipHovered = ref(false);
let edgeCloseTimer: ReturnType<typeof setTimeout> | undefined, tooltipGeneration = 0;
function cancelEdgeClose() { clearTimeout(edgeCloseTimer); }
function hideEdgePopover() {
  if (edgeTooltip.value?.hidePopover && edgeTooltip.value.matches(':popover-open')) edgeTooltip.value.hidePopover();
  if (typeof window !== 'undefined') window.removeEventListener('resize', dismissEdgeTooltip);
  if (typeof document !== 'undefined') {
    document.removeEventListener('scroll', tooltipScroll, true);
    document.removeEventListener('keydown', tooltipKey, true);
  }
}
function dismissEdgeTooltip() {
  cancelEdgeClose(); tooltipGeneration++; tooltipHovered.value = false;
  hoveredEdgeId.value = null; edgeTooltipVisible.value = false; hideEdgePopover();
}
function tooltipScroll(event: Event) {
  if (edgeTooltip.value?.contains(event.target as Node)) return;
  if (edgeTooltipVisible.value && !hoveredEdgeId.value && focusedEdgeId.value && focusedEdgeElement
    && (typeof document === 'undefined' || document.activeElement === focusedEdgeElement)) {
    focusEdgeAnchor(focusedEdgeElement); positionEdgeTooltip(); return;
  }
  dismissEdgeTooltip();
}
function tooltipKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault(); event.stopPropagation(); dismissEdgeTooltip();
}
function positionEdgeTooltip() {
  const panel = edgeTooltip.value;
  if (!panel || !edgeTooltipVisible.value) return;
  const bounds = panel.getBoundingClientRect();
  const screen = typeof window === 'undefined' ? null : window.visualViewport;
  const left = screen?.offsetLeft ?? 0, top = screen?.offsetTop ?? 0;
  const screenWidth = screen?.width || (typeof window !== 'undefined' ? window.innerWidth : width.value);
  const screenHeight = screen?.height || (typeof window !== 'undefined' ? window.innerHeight : 800);
  panel.style.left = `${Math.max(left + 12, Math.min(edgeAnchor.x + 14, left + screenWidth - bounds.width - 12))}px`;
  const below = edgeAnchor.y + 14;
  panel.style.top = `${Math.max(top + 12, Math.min(below + bounds.height <= top + screenHeight - 12 ? below : edgeAnchor.y - bounds.height - 14, top + screenHeight - bounds.height - 12))}px`;
}
function focusEdgeAnchor(element: SVGPathElement | null) {
  if (!element) return;
  const bounds = element.getBoundingClientRect();
  edgeAnchor = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  const matrix = element.getScreenCTM?.();
  if (matrix && element.getPointAtLength) {
    const point = element.getPointAtLength(element.getTotalLength() / 2);
    edgeAnchor = { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
  }
}
function inspectEdge(id: string, event?: PointerEvent) {
  cancelEdgeClose(); hoveredEdgeId.value = id; edgeTooltipVisible.value = true;
  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) edgeAnchor = { x: event.clientX, y: event.clientY };
}
function moveEdgeTooltip(event: PointerEvent) {
  if (!hoveredEdgeId.value || !edgeTooltipVisible.value) return;
  edgeAnchor = { x: event.clientX, y: event.clientY }; positionEdgeTooltip();
}
function leaveEdge() {
  cancelEdgeClose();
  edgeCloseTimer = setTimeout(() => {
    if (tooltipHovered.value) return;
    hoveredEdgeId.value = null;
    if (focusedEdgeId.value) { focusEdgeAnchor(focusedEdgeElement); positionEdgeTooltip(); }
    else dismissEdgeTooltip();
  }, 140);
}
function focusEdge(id: string, event: FocusEvent) {
  cancelEdgeClose(); hoveredEdgeId.value = null; focusedEdgeId.value = id; tabEdgeId.value = id;
  focusedEdgeElement = event.currentTarget as SVGPathElement; focusEdgeAnchor(focusedEdgeElement); edgeTooltipVisible.value = true;
}
function blurEdge() {
  focusedEdgeId.value = null; focusedEdgeElement = null;
  if (!hoveredEdgeId.value) dismissEdgeTooltip();
}
function edgeKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissEdgeTooltip(); return; }
  const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  const paths = [...((event.currentTarget as SVGPathElement).closest('svg')?.querySelectorAll<SVGPathElement>('.bundling-edge') ?? [])];
  if (!paths.length) return;
  event.preventDefault(); event.stopPropagation();
  const index = paths.indexOf(event.currentTarget as SVGPathElement);
  paths[event.key === 'Home' ? 0 : event.key === 'End' ? paths.length - 1 : (index + direction + paths.length) % paths.length]?.focus();
}
watch([activeEdge, edgeTooltipVisible], async ([edge, visible]) => {
  const token = ++tooltipGeneration;
  if (!edge || !visible) { hideEdgePopover(); return; }
  await nextTick();
  if (token !== tooltipGeneration || !edgeTooltipVisible.value) return;
  edgeTooltip.value?.showPopover?.(); positionEdgeTooltip();
  if (typeof window !== 'undefined') window.addEventListener('resize', dismissEdgeTooltip);
  if (typeof document !== 'undefined') {
    document.addEventListener('scroll', tooltipScroll, true);
    document.addEventListener('keydown', tooltipKey, true);
  }
}, { flush: 'post' });
watch(zoom, dismissEdgeTooltip, { flush: 'sync' });
function groupArc(start: number, end: number) {
  const r = radius.value + 9;
  const gap = Math.min(.025, (end - start) / 4);
  const from = start + gap, to = end - gap;
  return `M${r * Math.sin(from)},${-r * Math.cos(from)} A${r},${r} 0 ${to - from > Math.PI ? 1 : 0},1 ${r * Math.sin(to)},${-r * Math.cos(to)}`;
}
function leafKey(event: KeyboardEvent, index: number) {
  const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? leaves.value.length - 1 : (index + direction + leaves.value.length) % leaves.value.length;
  (event.currentTarget as HTMLElement).closest('svg')?.querySelectorAll<HTMLButtonElement>('.bundling-job')[next]?.focus();
}
let zoomControls: ReturnType<typeof attachOpportunityBundlingZoom> | null = null;
function resetView() { zoomControls?.reset(); }
function zoomKey(event: KeyboardEvent) {
  if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomControls?.zoomAt(zoom.value * 1.25); }
  else if (event.key === '-') { event.preventDefault(); zoomControls?.zoomAt(zoom.value / 1.25); }
  else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); resetView(); }
}
watch(viewport, element => {
  zoomControls?.dispose(); zoomControls = null;
  if (element) zoomControls = attachOpportunityBundlingZoom(element, {
    getZoom: () => zoom.value, setZoom: value => { zoom.value = value; }, baseSize: () => baseDisplayWidth.value, afterRender: nextTick,
  });
}, { flush: 'post' });
watch([() => props.diagram, baseDisplayWidth], () => { zoom.value = 1; resetView(); }, { flush: 'sync' });
watch(() => props.diagram, () => {
  hoveredId.value = null; focusedId.value = null; focusedEdgeId.value = null; tabEdgeId.value = null; focusedEdgeElement = null; dismissEdgeTooltip();
}, { flush: 'sync' });
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!host.value) return;
  width.value = host.value.clientWidth || 960;
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(entries => { width.value = entries[0]?.contentRect.width || width.value; });
  observer.observe(host.value);
});
onBeforeUnmount(() => { observer?.disconnect(); zoomControls?.dispose(); dismissEdgeTooltip(); });
</script>

<template>
  <div ref="host" class="job-bundling" :class="{ 'is-compact': compact, 'is-topic': isTopic }" :aria-busy="busy">
    <div class="bundling-heading">
      <span>{{ sharedLabel() }}</span>
      <InfoHint :lang="lang" :label="text('Hierarchical edge bundling', 'Hierarchische Kantenbündelung')" :text="bundlingHint" />
      <button v-if="diagram" class="bundling-reset" type="button" @click="resetView">{{ text('Reset view', 'Ansicht zurücksetzen') }}</button>
      <span v-if="diagram" class="bundling-counts">{{ leaves.length }} {{ isTopic ? text('topics', 'Themen') : text('jobs', 'Stellen') }} · {{ diagram.relationshipCount }} {{ text('connections', 'Verbindungen') }}<template v-if="diagram.edges.length < diagram.relationshipCount"> · {{ diagram.edges.length }} {{ text('shown', 'angezeigt') }}</template></span>
    </div>
    <div v-if="diagram && leaves.length" ref="viewport" class="bundling-scroll" :style="{ height: `${baseDisplayWidth}px` }" tabindex="0" :aria-label="isTopic ? text('Topic connections chart. Pinch to zoom and scroll to pan. Plus and minus zoom; Home resets. Use Tab to reach connections and topics; arrow keys move between them.', 'Diagramm der Themenverbindungen. Zoome mit zwei Fingern und scrolle zum Verschieben. Plus und Minus zoomen; Pos1 setzt zurück. Erreiche Verbindungen und Themen mit Tab und wechsle mit den Pfeiltasten.') : text('Job connections chart. Pinch to zoom and scroll to pan. Plus and minus zoom; Home resets. Use Tab to reach connections and jobs; arrow keys move between them.', 'Diagramm der Stellenverbindungen. Zoome mit zwei Fingern und scrolle zum Verschieben. Plus und Minus zoomen; Pos1 setzt zurück. Erreiche Verbindungen und Stellen mit Tab und wechsle mit den Pfeiltasten.')" @keydown="zoomKey" @scroll="tooltipScroll">
      <svg class="bundling-chart" :style="{ width: `${displayWidth}px`, minWidth: `${displayWidth}px`, height: `${displayWidth}px`, marginTop: `${Math.max(0, (baseDisplayWidth - displayWidth) / 2)}px` }" :width="compact ? compactSize : size" :height="compact ? compactSize : size" :viewBox="viewBox" role="group" :aria-label="isTopic ? text('Topics connected by shared jobs', 'Themen verbunden durch gemeinsame Stellen') : text('Jobs connected by shared topics', 'Stellen verbunden durch gemeinsame Themen')">
        <g :transform="`translate(${size / 2},${size / 2})`">
          <g class="bundling-groups" aria-hidden="true"><path v-for="group in diagram.groups" :key="group.id" :d="groupArc(group.startAngle, group.endAngle)" :stroke="color(group.index)" /></g>
          <g class="bundling-edges">
            <path v-for="edge in edges" :key="edge.id" class="bundling-edge" :class="{ 'is-active': edgeActive(edge), 'is-muted': focusIds.size > 0 && !edgeActive(edge), 'is-hovered': hoveredEdgeId === edge.id || focusedEdgeId === edge.id }" :d="edge.path" :stroke="edgeColor(edge.sharedCount)" :tabindex="edge.id === tabbableEdgeId ? 0 : -1" role="img" :aria-label="edgeDescription(edge)" :aria-describedby="edgeTooltipVisible && activeEdge?.id === edge.id ? edgeTooltipId : undefined" @pointerenter="inspectEdge(edge.id, $event)" @pointermove="moveEdgeTooltip" @pointerleave="leaveEdge" @focus="focusEdge(edge.id, $event)" @blur="blurEdge" @keydown="edgeKey" />
          </g>
          <g v-for="(leaf, index) in leaves" :key="leaf.id" class="bundling-leaf" :class="{ 'is-selected': selectionIds.has(leaf.id), 'is-active': activeId === leaf.id, 'is-muted': isMuted(leaf.id), 'is-left': leaf.left, 'is-avoided': isTopic && records.get(leaf.id)?.avoided }" :style="{ '--job-group-color': color(leaf.groupIndex) }" :transform="`translate(${leaf.x},${leaf.y}) rotate(${leaf.rotation})`" @pointerenter="hoveredId = leaf.id" @pointerleave="hoveredId = null">
            <circle r="4" aria-hidden="true" />
            <foreignObject :x="compact ? -compactTarget / 2 : leaf.left ? -labelWidth - 16 : 16" :y="compact ? -compactTarget / 2 : -16" :width="compact ? compactTarget : labelWidth" :height="compact ? compactTarget : 32" :transform="compact ? `rotate(${-leaf.rotation})` : undefined"><button class="bundling-job" :class="{ 'bundling-topic': isTopic }" :style="compact ? { fontSize: `${12 * compactSize / compactWidth}px` } : undefined" type="button" :aria-pressed="selectionIds.has(leaf.id)" :aria-label="compact ? `${index + 1}. ${description(leaf.id)}` : description(leaf.id)" :title="description(leaf.id)" @click="emit('select', leaf.id)" @focus="focusedId = leaf.id" @blur="focusedId = null" @keydown="leafKey($event, index)">{{ compact ? index + 1 : leaf.label }}</button></foreignObject>
          </g>
        </g>
      </svg>
    </div>
    <p v-if="diagram && leaves.length && !diagram.relationshipCount" class="bundling-empty">{{ isTopic ? text('These topics have no shared jobs under the current filters.', 'Diese Themen haben unter den aktuellen Filtern keine gemeinsamen Stellen.') : text('These jobs have no shared topics after exclusions.', 'Diese Stellen haben nach den Ausschlüssen keine gemeinsamen Themen.') }}</p>
    <p v-if="activeLeaf" class="bundling-record"><template v-if="compact">{{ leaves.indexOf(activeLeaf) + 1 }}. </template>{{ activeLeaf.label }} · {{ activeLeaf.relationshipCount }} {{ connectedJobs(activeLeaf.relationshipCount) }}</p>
    <div :id="edgeTooltipId" ref="edgeTooltip" class="bundling-edge-tooltip" role="tooltip" popover="manual" :hidden="!edgeTooltipVisible || !activeEdge" @pointerenter="tooltipHovered = true; cancelEdgeClose()" @pointerleave="tooltipHovered = false; leaveEdge()" @keydown.esc.stop.prevent="dismissEdgeTooltip">
      <span class="bundling-edge-tooltip-label">{{ sharedLabel(activeEdgeTopics.length) }}</span>
      <strong class="bundling-edge-topics">{{ activeEdgeTopics.join(', ') }}</strong>
    </div>
  </div>
</template>

<style scoped>
.job-bundling { min-width: 0; border-block: 1px solid var(--ui-divider); padding-block: 14px; }
.bundling-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; color: var(--ui-muted); font-size: 12px; }
.bundling-counts { margin-inline-start: auto; font-size: 11px; font-variant-numeric: tabular-nums; }
.bundling-reset { min-height: 36px; padding: 5px 10px; border: 1px solid var(--ui-border); border-radius: 5px; color: var(--ui-muted); background: var(--ui-control); font: 600 12px/1.5 var(--font-ui); cursor: pointer; }
.bundling-reset:hover { color: var(--ui-text); background: var(--ui-surface-hover); }
.bundling-reset:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.bundling-scroll { max-width: 100%; overflow: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y; scrollbar-color: var(--ui-border) var(--ui-surface); }
.bundling-chart { display: block; margin-inline: auto; overflow: visible; }
.bundling-groups path { fill: none; stroke-width: 3; opacity: .75; }
.bundling-edge { fill: none; stroke-width: 1.1; stroke-opacity: .28; pointer-events: stroke; }
.bundling-edge.is-muted { stroke-opacity: .035; }
.bundling-edge.is-active { stroke-width: 1.8; stroke-opacity: .85; }
.bundling-edge.is-hovered { stroke-width: 3; stroke-opacity: 1; }
.bundling-edge:focus { stroke-width: 3; stroke-opacity: 1; outline: none; }
.bundling-edge-tooltip { position: fixed; inset: auto; box-sizing: border-box; width: max-content; max-width: min(380px, calc(100vw - 24px)); max-height: min(320px, calc(100dvh - 24px)); overflow: auto; margin: 0; padding: 10px 12px; border: 0; border-radius: 8px; background: var(--ui-tooltip-bg); color: var(--ui-tooltip-text); box-shadow: 0 10px 30px #0008; font: 500 13px/1.5 var(--font-ui); overflow-wrap: anywhere; z-index: 10000; }
.bundling-edge-tooltip[hidden] { display: none; }
.bundling-edge-tooltip-label { display: block; font-size: 11px; }
.bundling-edge-topics { display: block; font-weight: 600; }
.bundling-leaf > circle { fill: var(--job-group-color); }
.bundling-leaf.is-selected > circle, .bundling-leaf.is-active > circle { fill: var(--ui-accent); r: 5px; }
.bundling-leaf.is-muted > circle { opacity: .3; }
.bundling-leaf.is-avoided > circle { stroke: var(--ui-score-red); stroke-width: 2; }
.bundling-leaf.is-avoided .bundling-job { text-decoration: underline; text-decoration-color: var(--ui-score-red); text-underline-offset: 3px; }
.bundling-job { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; box-sizing: border-box; width: 100%; height: 100%; overflow: hidden; padding: 1px 4px; border: 0; border-radius: 3px; color: var(--ui-text); background: transparent; font: 500 11px/1.35 var(--font-ui); text-align: start; overflow-wrap: anywhere; cursor: pointer; }
.is-left .bundling-job { text-align: end; }
.is-muted .bundling-job { color: var(--ui-muted); }
.bundling-job:hover, .bundling-job:focus-visible { color: var(--ui-text); background: var(--ui-surface-hover); }
.bundling-job[aria-pressed=true] { color: var(--ui-accent); background: var(--ui-active); }
.is-compact .bundling-job { display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--job-group-color); border-radius: 50%; background: var(--ui-control); text-align: center; }
.is-compact .is-muted .bundling-job { border-color: var(--ui-border); }
.is-compact .bundling-job[aria-pressed=true] { border-color: var(--ui-accent); color: var(--ui-accent); background: var(--ui-active); }
.is-compact .is-avoided .bundling-job { border-color: var(--ui-score-red); }
.bundling-job:focus-visible, .bundling-scroll:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.bundling-empty, .bundling-record { margin: 12px 0 0; color: var(--ui-muted); font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .bundling-heading { gap: 6px; }
  .bundling-reset { min-height: 44px; }
}
</style>
