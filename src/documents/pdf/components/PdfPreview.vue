<script setup lang="ts">
import type { PropType } from 'vue';
import type { DocumentPreviewPage } from '../pdfTypes';
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { makeT } from '../../../i18n/dict.ts';
import { scopePreviewSvgIds } from '../previewSvgIds';
import { useToastWatch } from '../../../shared/ui/useToasts';
const PdfCanvasPage = defineAsyncComponent(() => import('./PdfCanvasPage.vue'));

const props = defineProps({
  pages: { type: Array as PropType<DocumentPreviewPage[]>, default: () => [] },
  page: { type: Number, default: 1 },
  isUpdating: { type: Boolean, default: false },
  error: { type: String, default: '' },
  lang: { type: String, required: true },
  gestureNavigation: { type: Boolean, default: false },
  pinchZoom: { type: Boolean, default: false },
});
const emit = defineEmits<{ 'update:page': [page: number]; retry: [] }>();

const langRef = computed(() => props.lang);
const t = makeT(langRef);
useToastWatch(() => !props.isUpdating ? props.error : '', () => ({ tone: 'error', action: {
  label: t('retryPreview'), run: () => emit('retry'),
} }));
useToastWatch(() => props.isUpdating ? t(props.pages.length ? 'previewUpdating' : 'previewLoading') : '', { key: 'pdf-preview-progress', passive: true });
const totalPages = computed(() => props.pages.length);
const currentPage = computed(() => Math.min(Math.max(props.page, 1), Math.max(totalPages.value, 1)));
const svgScope = useId();
const currentPageData = computed(() => props.pages[currentPage.value - 1]);
const currentPdfPage = computed(() => {
  const source = currentPageData.value;
  return source && 'pdf' in source ? source : null;
});
const currentSvg = computed(() => {
  const source = currentPageData.value;
  return source && 'svg' in source ? scopePreviewSvgIds(source.svg, svgScope) : '';
});
const pageRatio = ref(210 / 297);
function updatePageSize({ width, height }: { width: number; height: number }) { pageRatio.value = width / height; }

const TRACKPAD_SWIPE_THRESHOLD = 72;
const TOUCH_SWIPE_THRESHOLD = 48;
let horizontalSwipeDistance = 0;
let horizontalSwipeReset: number | null = null;
let touchStart: { id: number; x: number; y: number } | null = null;
const stageElement = ref<HTMLElement | null>(null);
const pageElement = ref<HTMLElement | null>(null);
const zoom = ref(1);
const offset = ref({ x: 0, y: 0 });
const pageStyle = computed(() => ({
  '--pdf-page-ratio': pageRatio.value,
  ...(props.pinchZoom ? { transform: `translate(${offset.value.x}px, ${offset.value.y}px) scale(${zoom.value})` } : {}),
}));
let pinch: { ids: number[]; distance: number; scale: number; anchorX: number; anchorY: number } | null = null;
let pan: { id: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;
let consumedTouch = false;
let resizeObserver: ResizeObserver | undefined;

function resetZoom() {
  zoom.value = 1;
  offset.value = { x: 0, y: 0 };
  resetTouchSwipe();
}

function setOffset(x: number, y: number) {
  const stage = stageElement.value;
  const page = pageElement.value;
  if (!stage || !page) return;
  const maxX = Math.max(0, (page.clientWidth * zoom.value - stage.clientWidth) / 2);
  const maxY = Math.max(0, (page.clientHeight * zoom.value - stage.clientHeight) / 2);
  offset.value = { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
}

function touchPair(touches: TouchList) {
  const [first, second] = [touches[0], touches[1]];
  const rect = stageElement.value!.getBoundingClientRect();
  return {
    x: (first.clientX + second.clientX) / 2 - rect.left - rect.width / 2,
    y: (first.clientY + second.clientY) / 2 - rect.top - rect.height / 2,
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
  };
}

function startPan(touch: Touch) {
  pan = { id: touch.identifier, x: touch.clientX, y: touch.clientY, offsetX: offset.value.x, offsetY: offset.value.y };
}

function turnPage(direction: number) {
  const nextPage = Math.min(Math.max(currentPage.value + direction, 1), totalPages.value);
  if (nextPage !== currentPage.value) emit('update:page', nextPage);
}

function resetTouchSwipe() {
  touchStart = null;
  pinch = null;
  pan = null;
  consumedTouch = false;
}

function handleTouchStart(event: TouchEvent) {
  touchStart = null;
  pan = null;
  pinch = null;
  if (props.pinchZoom && currentPageData.value && stageElement.value) {
    if (event.touches.length === 2) {
      const pair = touchPair(event.touches);
      pinch = {
        ids: [event.touches[0].identifier, event.touches[1].identifier],
        distance: Math.max(1, pair.distance), scale: zoom.value,
        anchorX: (pair.x - offset.value.x) / zoom.value,
        anchorY: (pair.y - offset.value.y) / zoom.value,
      };
      consumedTouch = true;
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (event.touches.length === 1 && zoom.value > 1) {
      startPan(event.touches[0]);
      return;
    }
  }
  if (event.touches.length > 1) consumedTouch = true;
  if (consumedTouch) return;
  if (!props.gestureNavigation || totalPages.value < 2 || event.touches.length !== 1) return;
  const touch = event.touches[0];
  touchStart = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
}

function isHorizontalTouchSwipe(touch: Touch) {
  if (!touchStart || touch.identifier !== touchStart.id) return false;
  const distanceX = Math.abs(touch.clientX - touchStart.x);
  const distanceY = Math.abs(touch.clientY - touchStart.y);
  return distanceX >= TOUCH_SWIPE_THRESHOLD && distanceX > distanceY * 1.25;
}

function handleTouchMove(event: TouchEvent) {
  if (pinch && event.touches.length === 2 && pinch.ids.every((id) => Array.from(event.touches).some((touch) => touch.identifier === id))) {
    const pair = touchPair(event.touches);
    zoom.value = Math.max(1, Math.min(4, pinch.scale * pair.distance / pinch.distance));
    setOffset(pair.x - pinch.anchorX * zoom.value, pair.y - pinch.anchorY * zoom.value);
    if (event.cancelable) event.preventDefault();
    return;
  }
  if (pan && event.touches.length === 1 && event.touches[0].identifier === pan.id) {
    const touch = event.touches[0];
    if (Math.hypot(touch.clientX - pan.x, touch.clientY - pan.y) > 3) consumedTouch = true;
    setOffset(pan.offsetX + touch.clientX - pan.x, pan.offsetY + touch.clientY - pan.y);
    if (event.cancelable) event.preventDefault();
    return;
  }
  if (!props.gestureNavigation || event.touches.length !== 1) {
    touchStart = null;
    pinch = null;
    pan = null;
    if (event.touches.length > 1) consumedTouch = true;
    return;
  }
  if (isHorizontalTouchSwipe(event.touches[0]) && event.cancelable) event.preventDefault();
}

function handleTouchEnd(event: TouchEvent) {
  if (consumedTouch || pinch || pan) {
    if (consumedTouch && event.cancelable) event.preventDefault();
    touchStart = null;
    pinch = null;
    pan = null;
    if (event.touches.length === 0) resetTouchSwipe();
    else if (props.pinchZoom && zoom.value > 1 && event.touches.length === 1) startPan(event.touches[0]);
    return;
  }
  const touch = event.changedTouches[0];
  if (props.gestureNavigation && totalPages.value > 1 && event.touches.length === 0 && touch && isHorizontalTouchSwipe(touch)) {
    // Suppress the synthetic click so swiping across a PDF link never opens it.
    if (event.cancelable) event.preventDefault();
    turnPage(touch.clientX < touchStart!.x ? 1 : -1);
  }
  resetTouchSwipe();
}

function resetHorizontalSwipe() {
  horizontalSwipeDistance = 0;
  if (horizontalSwipeReset !== null) window.clearTimeout(horizontalSwipeReset);
  horizontalSwipeReset = null;
}

function handleTrackpadSlide(event: WheelEvent) {
  if (event.ctrlKey || zoom.value > 1) return;
  if (!props.gestureNavigation || totalPages.value < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  // Trackpads report a two-finger horizontal slide as wheel input. Keep normal
  // vertical scrolling intact while using a deliberate horizontal slide to turn pages.
  event.preventDefault();
  horizontalSwipeDistance += event.deltaX;
  if (Math.abs(horizontalSwipeDistance) < TRACKPAD_SWIPE_THRESHOLD) {
    if (horizontalSwipeReset !== null) window.clearTimeout(horizontalSwipeReset);
    horizontalSwipeReset = window.setTimeout(resetHorizontalSwipe, 180);
    return;
  }

  const direction = Math.sign(horizontalSwipeDistance);
  resetHorizontalSwipe();
  turnPage(direction);
}

watch([currentPage, () => props.pinchZoom], resetZoom);
watch(currentPageData, () => { resetZoom(); pageRatio.value = 210 / 297; });
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !stageElement.value) return;
  resizeObserver = new ResizeObserver(resetZoom);
  resizeObserver.observe(stageElement.value);
});
onBeforeUnmount(() => {
  resetHorizontalSwipe();
  resizeObserver?.disconnect();
});
</script>

<template>
  <section
    class="pdf-preview"
    :class="{ 'pdf-preview--gesture-navigation': gestureNavigation, 'pdf-preview--pinch-zoom': pinchZoom }"
    :aria-busy="isUpdating"
    @wheel="handleTrackpadSlide"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="resetTouchSwipe"
  >
    <div ref="stageElement" class="pdf-preview__stage">
      <div v-if="error && !isUpdating" class="pdf-preview__error">
        <button class="btn" type="button" @click="emit('retry')">{{ t('retryPreview') }}</button>
      </div>
      <div
        v-else-if="currentPdfPage"
        class="pdf-preview__page"
        ref="pageElement"
        :style="pageStyle"
        :aria-label="`${t('pdfPage')} ${currentPage}`"
      >
        <PdfCanvasPage :source="currentPdfPage" :lang="lang" :scale="zoom" @size="updatePageSize" @navigate="emit('update:page', $event)" />
      </div>
      <div
        v-else-if="currentSvg"
        class="pdf-preview__page"
        ref="pageElement"
        :style="pageStyle"
        :aria-label="`${t('pdfPage')} ${currentPage}`"
        v-html="currentSvg"
      />
      <div v-else-if="!isUpdating" class="pdf-preview__empty">{{ t('previewEmpty') }}</div>
    </div>
  </section>
</template>

<style scoped>
.pdf-preview { width: 100%; min-width: 0; }
.pdf-preview--gesture-navigation { touch-action: pan-y pinch-zoom; }
.pdf-preview--pinch-zoom { touch-action: none; user-select: none; -webkit-user-select: none; }
.pdf-preview--pinch-zoom .pdf-preview__page { transform-origin: center; will-change: transform; }
.pdf-preview__stage { position: relative; display: grid; min-height: 220px; place-items: center; overflow: hidden; border-radius: 6px; background: #0b0f14; }
.pdf-preview__page { display: block; width: min(100%, 794px); height: auto; box-shadow: 0 5px 18px rgba(0, 0, 0, .4); }
.pdf-preview__page :deep(> svg) { display: block; width: 100%; height: auto; }
.pdf-preview__empty { color: #9be8c7; font-size: 13px; }
.pdf-preview__error { width: min(100%, 48ch); min-height: 0; max-height: 100%; overflow: auto; box-sizing: border-box; padding: 24px; color: var(--ui-text, #dce6e2); font: 16px/1.5 var(--font-ui, system-ui); overflow-wrap: anywhere; }
.pdf-preview__error .btn { max-width: 100%; min-height: 44px; font: inherit; white-space: normal; }
</style>
