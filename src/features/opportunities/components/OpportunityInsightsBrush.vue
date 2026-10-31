<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import type { OpportunityInsightTimeline } from '../domain/opportunityInsights';
import { createOpportunityTimeBrush, opportunityCalendarDate, opportunityCalendarDay, type OpportunityBrushAction, type OpportunityBrushHandle, type OpportunityBrushRange } from '../domain/opportunityTimeBrush';

const props = defineProps<{
  overview: OpportunityInsightTimeline;
  rangeStart: string | null; rangeEnd: string | null;
  domainStart?: string | null; domainEnd?: string | null;
  lang: string;
}>();
const emit = defineEmits<{
  'update:range': [value: { start: string; end: string } | null];
  'brush-active': [value: boolean];
}>();
const id = useId(), host = ref<HTMLElement | null>(null), brushSvg = ref<SVGSVGElement | null>(null);
const width = ref(900);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const domain = computed(() => {
  const first = props.domainStart ?? props.overview.start, last = props.domainEnd ?? props.overview.end;
  const fallback = opportunityCalendarDay(new Date())!;
  const min = first ? opportunityCalendarDay(first) ?? fallback : fallback;
  return { min, max: Math.max(min, last ? opportunityCalendarDay(last) ?? min : min) };
});
const rangeDay = (value: string) => opportunityCalendarDay(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00` : value)!;
const selectedRange = () => props.rangeStart && props.rangeEnd ? { start: rangeDay(props.rangeStart), end: rangeDay(props.rangeEnd) } : null;
let brush = createOpportunityTimeBrush(domain.value, selectedRange());
const preview = shallowRef<OpportunityBrushRange | null | undefined>();
const brushRange = computed(() => preview.value === undefined ? selectedRange() ?? domainSelection() : preview.value ?? domainSelection());
const domainSelection = () => ({ start: domain.value.min, end: domain.value.max });
const span = computed(() => domain.value.max - domain.value.min + 1);
const dayX = (day: number) => (day - domain.value.min) / span.value * width.value;
const brushLeft = computed(() => Math.max(0, dayX(brushRange.value.start)));
const brushRight = computed(() => Math.min(width.value, dayX(brushRange.value.end + 1)));
const handleHitX = (handle: OpportunityBrushHandle) => Math.max(0, Math.min(width.value - 44, (handle === 'start' ? brushLeft.value : brushRight.value) - 22));
const compactHandles = computed(() => handleHitX('end') - handleHitX('start') <= 44);
const compactHitLeft = computed(() => Math.max(0, Math.min(width.value - 44, (brushLeft.value + brushRight.value) / 2 - 22)));
const rangeText = computed(() => `${opportunityCalendarDate(brushRange.value.start)} – ${opportunityCalendarDate(brushRange.value.end)} · ${brushRange.value.end - brushRange.value.start + 1} ${brushRange.value.end === brushRange.value.start ? text('day', 'Tag') : text('days', 'Tage')}`);
const overviewMaximum = computed(() => Math.max(1, ...props.overview.buckets.map(bucket => bucket.addedCount)));
const overviewBars = computed(() => props.overview.buckets.map(bucket => {
  const first = opportunityCalendarDay(bucket.start)!, last = opportunityCalendarDay(bucket.end)!;
  const height = bucket.addedCount / overviewMaximum.value * 16;
  return { x: dayX(first), width: Math.max(1, dayX(last + 1) - dayX(first)), y: 36.5 - height, height };
}));
let pointer: { id: number; x: number; y: number; action: OpportunityBrushAction; day: number; pending: boolean; left: number; width: number } | null = null;
let frame = 0;
let pendingPreview: OpportunityBrushRange | null | undefined;
const sameRange = (a: OpportunityBrushRange | null, b: OpportunityBrushRange | null) => a === b || Boolean(a && b && a.start === b.start && a.end === b.end);
function stopFrame() { if (frame) cancelAnimationFrame(frame); frame = 0; pendingPreview = undefined; }
function previewRange(range: OpportunityBrushRange | null) {
  pendingPreview = range;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (pendingPreview !== undefined) preview.value = pendingPreview;
    pendingPreview = undefined;
  });
}
function pointDay(clientX: number): number {
  if (!pointer) return domain.value.min;
  const fraction = Math.max(0, Math.min(1, (clientX - pointer.left) / pointer.width));
  return Math.min(domain.value.max, domain.value.min + Math.floor(fraction * span.value));
}
function beginPointer(event: PointerEvent, action: OpportunityBrushAction) {
  if (pointer || event.button !== 0 || !brushSvg.value) return;
  const bounds = brushSvg.value.getBoundingClientRect();
  // Narrow selections can put both 44px endpoint targets over the entire range.
  // Their shared central area uses upper/start, centre/move, lower/end lanes;
  // the visible grips follow those lanes without moving away from their dates.
  const x = (event.clientX - bounds.left) / Math.max(1, bounds.width) * width.value;
  if (action !== 'create' && compactHandles.value && x >= compactHitLeft.value && x <= compactHitLeft.value + 44) {
    const y = (event.clientY - (bounds.top ?? 0)) / Math.max(1, bounds.height || 44) * 44;
    action = y < 44 / 3 ? 'start' : y >= 88 / 3 ? 'end' : 'move';
  }
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, action, day: 0, pending: event.pointerType === 'touch', left: bounds.left, width: Math.max(1, bounds.width) };
  pointer.day = pointDay(event.clientX);
  brushSvg.value.setPointerCapture(event.pointerId);
  if (!pointer.pending) {
    brush.begin(pointer.id, action, pointer.day);
    emit('brush-active', true);
    previewRange(brush.selection);
  }
}
function movePointer(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return;
  if (pointer.pending) {
    const dx = Math.abs(event.clientX - pointer.x), dy = Math.abs(event.clientY - pointer.y);
    if (dx < 8 && dy < 8) return;
    if (dy > dx) { finishPointer(event.pointerId, true); return; }
    pointer.pending = false;
    brush.begin(pointer.id, pointer.action, pointer.day);
    emit('brush-active', true);
  }
  previewRange(brush.move(event.pointerId, pointDay(event.clientX)));
}
function commit(range: OpportunityBrushRange | null) {
  const normalized = range && range.start <= domain.value.min && range.end >= domain.value.max ? null : range;
  if (!sameRange(normalized, selectedRange())) emit('update:range', normalized ? { start: opportunityCalendarDate(normalized.start), end: opportunityCalendarDate(normalized.end) } : null);
}
function finishPointer(pointerId: number, cancelled = false) {
  if (!pointer || pointer.id !== pointerId) return;
  const pending = pointer.pending;
  pointer = null;
  stopFrame();
  if (!pending) {
    const range = cancelled ? brush.cancel(pointerId) : brush.end(pointerId);
    if (!cancelled) commit(range);
    emit('brush-active', false);
  }
  if (brushSvg.value?.hasPointerCapture(pointerId)) brushSvg.value.releasePointerCapture(pointerId);
  preview.value = undefined;
}
function cancelPointer() { if (pointer) finishPointer(pointer.id, true); }
function cancelKey(event: KeyboardEvent) {
  if (pointer && event.key === 'Escape') { event.preventDefault(); cancelPointer(); }
}
function handleKey(event: KeyboardEvent, handle: OpportunityBrushHandle) {
  if (event.key === 'Escape') { cancelPointer(); return; }
  if (pointer) return;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  commit(brush.keyboard(handle, event.key, event.shiftKey));
}
watch([() => domain.value.min, () => domain.value.max, () => props.rangeStart, () => props.rangeEnd], () => {
  if (pointer) cancelPointer();
  brush = createOpportunityTimeBrush(domain.value, selectedRange());
});
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (host.value) {
    width.value = Math.max(280, host.value.clientWidth);
    observer = new ResizeObserver(entries => { width.value = Math.max(280, entries[0]?.contentRect.width ?? 900); });
    observer.observe(host.value);
  }
  window.addEventListener('blur', cancelPointer);
  window.addEventListener('keydown', cancelKey);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('blur', cancelPointer);
  window.removeEventListener('keydown', cancelKey);
  stopFrame();
  const pointerId = pointer?.id; pointer = null; brush.cancel();
  if (pointerId !== undefined && brushSvg.value?.hasPointerCapture(pointerId)) brushSvg.value.releasePointerCapture(pointerId);
});
</script>

<template>
  <section ref="host" class="insights-brush" :aria-label="text('Shared addition date brush', 'Gemeinsame Auswahl der Hinzufügedaten')">
    <div :id="`${id}-selection`" class="timeline-brush-heading">{{ rangeText }}</div>
    <svg ref="brushSvg" class="timeline-brush" preserveAspectRatio="none" :viewBox="`0 0 ${width} 44`" role="group" :aria-label="text('Job addition date brush', 'Zeitraumauswahl nach Hinzufügedatum')" :aria-describedby="`${id}-selection`" :aria-description="overview.unavailableReason ? text('Addition volume is unavailable for this range. Date selection remains available.', 'Das Zugangsvolumen ist für diesen Zeitraum nicht verfügbar. Die Datumsauswahl bleibt möglich.') : undefined" @pointermove="movePointer" @pointerup="finishPointer($event.pointerId)" @pointercancel="finishPointer($event.pointerId, true)" @lostpointercapture="finishPointer($event.pointerId, true)">
      <rect width="100%" y="7.5" height="29" class="timeline-brush-ground" @pointerdown="beginPointer($event, 'create')" />
      <g class="timeline-overview" pointer-events="none"><rect v-for="(bar, index) in overviewBars" :key="index" :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height" /></g>
      <rect :x="brushLeft" y="8.5" :width="Math.max(1, brushRight - brushLeft)" height="27" class="timeline-brush-selection" tabindex="0" role="slider" :aria-label="text('Move selected date range', 'Gewählten Zeitraum verschieben')" :aria-valuemin="domain.min" :aria-valuemax="domain.max" :aria-valuenow="brushRange.start" :aria-valuetext="rangeText" @pointerdown.stop="beginPointer($event, rangeStart && rangeEnd ? 'move' : 'create')" @keydown="handleKey($event, 'selection')" />
      <g v-for="handle in (['start', 'end'] as const)" :key="handle" class="timeline-brush-handle"><rect :x="handleHitX(handle)" y="0" width="44" height="44" class="timeline-brush-hit" tabindex="0" role="slider" :aria-label="handle === 'start' ? text('Brush start date', 'Zeitraum-Startdatum') : text('Brush end date', 'Zeitraum-Enddatum')" :aria-valuemin="domain.min" :aria-valuemax="domain.max" :aria-valuenow="brushRange[handle]" :aria-valuetext="opportunityCalendarDate(brushRange[handle])" @pointerdown.stop="beginPointer($event, handle)" @keydown="handleKey($event, handle)" /><rect :x="(handle === 'start' ? brushLeft : brushRight) - 3" :y="compactHandles ? handle === 'start' ? 8.5 : 30 : 13" width="6" :height="compactHandles ? 6 : 18" rx="2" pointer-events="none" /></g>
    </svg>
  </section>
</template>

<style scoped>
.insights-brush { min-width: 0; }
.timeline-brush-heading { margin-bottom: 0; color: var(--ui-muted); font: 400 11px/1.5 var(--font-ui); font-variant-numeric: tabular-nums; text-align: end; }
.timeline-brush { display: block; box-sizing: border-box; width: 100%; height: 44px; overflow: visible; touch-action: pan-y; user-select: none; }
.timeline-brush-ground { fill: var(--ui-surface-hover); cursor: crosshair; }
.timeline-overview { fill: var(--ui-muted); opacity: .45; }
.timeline-brush-selection { fill: var(--ui-accent); fill-opacity: .09; stroke: var(--ui-accent); stroke-width: 1; cursor: grab; }
.timeline-brush-selection:active { cursor: grabbing; }
.timeline-brush-handle { fill: var(--ui-accent); }
.timeline-brush-hit { fill: transparent; cursor: ew-resize; }
.timeline-brush :is(rect):focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
</style>
