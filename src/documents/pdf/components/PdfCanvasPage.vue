<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import type { PdfPreviewPage } from '../pdfTypes';
import { loadPdfJs, retainPdfPage } from '../pdfJs';
import { makeT } from '../../../i18n/dict';
import { useToastWatch } from '../../../shared/ui/useToasts';

const props = withDefaults(defineProps<{ source: PdfPreviewPage; lang: string; scale?: number }>(), { scale: 1 });
const emit = defineEmits<{
  'update:loading': [value: boolean]; error: [message: string]; navigate: [page: number]; size: [value: { width: number; height: number }];
}>();
const t = makeT(computed(() => props.lang));
const failureMessage = computed(() => props.lang === 'de' ? 'Die PDF-Seite konnte nicht angezeigt werden.' : 'This PDF page could not be displayed.');
const root = ref<HTMLElement | null>(null);
const canvasHost = ref<HTMLElement | null>(null);
const textHost = ref<HTMLElement | null>(null);
const loading = ref(true);
const failed = ref(false);
const rendered = ref(false);
const ratio = ref(595 / 842);
type Link = { id: string; href: string; page?: number; label: string; style: Record<string, string> };
const links = ref<Link[]>([]);
let generation = 0;
let mounted = false;
let observer: ResizeObserver | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let renderTask: RenderTask | null = null;
let textLayer: TextLayer | null = null;
let activePage: PDFPageProxy | null = null;
let releasePage: ((pendingRender?: Promise<unknown>) => void) | null = null;
let pendingRender: Promise<unknown> | undefined;
let shownCanvas: HTMLCanvasElement | null = null;
let previousWidth = 0;
let previousPixelRatio = 0;
useToastWatch(() => failed.value ? failureMessage.value : '', () => ({ tone: 'error', action: {
  label: props.lang === 'de' ? 'Erneut versuchen' : 'Try again',
  run: () => { if (mounted) schedule(true); },
} }));

function releaseCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.remove();
  canvas.width = canvas.height = 0;
}
function cancel(clear = false) {
  generation++;
  clearTimeout(timer);
  renderTask?.cancel();
  renderTask = null;
  textLayer?.cancel();
  textLayer = null;
  if (clear) {
    releasePage?.(pendingRender);
    releasePage = null;
    activePage = null;
    rendered.value = false;
    links.value = [];
    textHost.value?.replaceChildren();
    releaseCanvas(shownCanvas);
    shownCanvas = null;
  }
}
function setLoading(value: boolean) { loading.value = value; emit('update:loading', value); }
function schedule(clear = false) {
  cancel(clear);
  failed.value = false;
  setLoading(true);
  if (mounted) timer = setTimeout(() => void render(generation), clear ? 0 : 80);
}

async function render(token: number) {
  const source = props.source;
  const current = () => mounted && token === generation;
  let canvas: HTMLCanvasElement | null = null;
  let page: PDFPageProxy | null = null;
  try {
    const width = root.value?.clientWidth || 0;
    if (!width || !canvasHost.value || !textHost.value) return;
    const pdfjs = await loadPdfJs();
    if (!current()) return;
    page = await source.pdf.getPage(source.pageNumber);
    if (!current()) { retainPdfPage(page)(); return; }
    if (activePage !== page) {
      releasePage?.(pendingRender);
      activePage = page;
      releasePage = retainPdfPage(page);
    }
    const base = page.getViewport({ scale: 1 });
    ratio.value = base.width / base.height;
    emit('size', { width: base.width, height: base.height });
    const viewport = page.getViewport({ scale: width / base.width });
    // Pinch zoom affects display transforms in the shared preview, so only increase raster density here.
    // The cap bounds each canvas to about 32 MB, including on high-DPI phones and very long pages.
    const density = Math.min(
      Math.max(1, window.devicePixelRatio || 1) * Math.max(1, props.scale),
      Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
      8192 / viewport.width, 8192 / viewport.height,
    );
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * density));
    canvas.height = Math.max(1, Math.floor(viewport.height * density));
    canvas.setAttribute('aria-hidden', 'true');
    const task = page.render({ canvas, viewport, transform: [density, 0, 0, density, 0, 0] });
    renderTask = task;
    pendingRender = task.promise;
    await task.promise;
    if (!current()) return;
    renderTask = null;
    releaseCanvas(shownCanvas);
    shownCanvas = canvas;
    canvasHost.value.replaceChildren(canvas);

    // Build a fresh text container so canceled text streams can never append into a replacement page.
    const textContainer = document.createElement('div');
    textContainer.className = 'textLayer';
    textContainer.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
    textHost.value.replaceChildren(textContainer);
    const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textContainer, viewport });
    textLayer = layer;
    // Text extraction and link failures must not hide an otherwise valid rendered scan.
    await Promise.allSettled([
      layer.render(),
      (async () => {
        const annotations = await page!.getAnnotations({ intent: 'display' });
        const nextLinks: Link[] = [];
        for (const annotation of annotations) {
          if (!current()) return;
          if (annotation.subtype !== 'Link' || !Array.isArray(annotation.rect)) continue;
          let href = '', targetPage: number | undefined;
          if (typeof annotation.url === 'string') {
            try {
              const url = new URL(annotation.url);
              if (['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) href = url.href;
            } catch { /* Invalid or unsupported links remain inert. */ }
          } else if (annotation.dest) {
            try {
              const destination = typeof annotation.dest === 'string' ? await source.pdf.getDestination(annotation.dest) : annotation.dest;
              if (Array.isArray(destination) && destination[0] !== undefined) {
                const index = typeof destination[0] === 'number' ? destination[0] : await source.pdf.getPageIndex(destination[0]);
                if (Number.isInteger(index) && index >= 0 && index < source.pdf.numPages) {
                  targetPage = index + 1;
                  href = `#page=${targetPage}`;
                }
              }
            } catch { /* A broken destination should not prevent other links from rendering. */ }
          }
          if (!href) continue;
          const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
          const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
          nextLinks.push({
            id: annotation.id, href, page: targetPage,
            label: targetPage ? `${t('pdfPage')} ${targetPage}` : href,
            style: { left: `${Math.min(x1, x2) / viewport.width * 100}%`, top: `${Math.min(y1, y2) / viewport.height * 100}%`, width: `${Math.abs(x2 - x1) / viewport.width * 100}%`, height: `${Math.abs(y2 - y1) / viewport.height * 100}%` },
          });
        }
        if (current()) links.value = nextLinks;
      })(),
    ]);
    if (current()) rendered.value = true;
  } catch (cause) {
    if (!current()) return;
    failed.value = true;
    rendered.value = false;
    releaseCanvas(shownCanvas);
    shownCanvas = null;
    links.value = [];
    textHost.value?.replaceChildren();
    emit('error', cause instanceof Error ? cause.message : String(cause));
  } finally {
    if (canvas && canvas !== shownCanvas) releaseCanvas(canvas);
    if (current()) setLoading(false);
  }
}
function resize() {
  const width = root.value?.clientWidth || 0;
  const pixelRatio = window.devicePixelRatio || 1;
  if (width > 0 && (width !== previousWidth || pixelRatio !== previousPixelRatio)) {
    previousWidth = width;
    previousPixelRatio = pixelRatio;
    schedule();
  }
}
function activateLink(event: MouseEvent, link: Link) {
  if (link.page !== undefined) { event.preventDefault(); emit('navigate', link.page); }
}
watch(() => props.source, () => schedule(true), { flush: 'sync' });
watch(() => props.scale, () => schedule());
onMounted(() => {
  mounted = true;
  observer = new ResizeObserver(resize);
  observer.observe(root.value!);
  window.addEventListener('resize', resize);
  resize();
});
onBeforeUnmount(() => {
  mounted = false;
  cancel(true);
  observer?.disconnect();
  window.removeEventListener('resize', resize);
});
</script>

<template>
  <div ref="root" class="pdf-canvas-page" :data-page-number="source.pageNumber" :data-rendered="rendered" :style="{ aspectRatio: String(ratio) }" :aria-busy="loading">
    <div ref="canvasHost" class="pdf-canvas-page__canvas" />
    <div ref="textHost" class="pdf-canvas-page__text" />
    <div class="pdf-canvas-page__links">
      <a v-for="link in links" :key="link.id" :href="link.href" :style="link.style" :aria-label="link.label" :title="link.label" :target="link.page === undefined ? '_blank' : undefined" rel="noopener noreferrer" @click="activateLink($event, link)" />
    </div>
    <div v-if="failed" class="pdf-canvas-page__status">
      <button type="button" class="btn" @click="schedule(true)">{{ lang === 'de' ? 'Erneut versuchen' : 'Try again' }}</button>
    </div>
  </div>
</template>

<style scoped>
.pdf-canvas-page{position:relative;width:100%;min-width:0;background:#fff;color:#17212f;overflow:hidden;color-scheme:light;direction:ltr}
.pdf-canvas-page__canvas,.pdf-canvas-page__text,.pdf-canvas-page__links{position:absolute;inset:0}
.pdf-canvas-page__canvas :deep(canvas){display:block;width:100%;height:100%}
.pdf-canvas-page__links{pointer-events:none}
.pdf-canvas-page__links a{position:absolute;pointer-events:auto;cursor:pointer}
.pdf-canvas-page__links a:focus-visible{outline:2px solid #006db3;background:#006db329}
.pdf-canvas-page__status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:16px;background:#fffffff0;font-size:13px;text-align:center}
.pdf-canvas-page__text :deep(.textLayer){position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size));--scale-round-x:1px;--scale-round-y:1px}
.pdf-canvas-page__text :deep(.textLayer :is(span,br)){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0;user-select:text;-webkit-user-select:text}
.pdf-canvas-page__text :deep(.textLayer > :not(.markedContent)),.pdf-canvas-page__text :deep(.markedContent span:not(.markedContent)){--font-height:0;--scale-x:1;--rotate:0deg;font-size:calc(var(--text-scale-factor) * var(--font-height));transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.pdf-canvas-page__text :deep(.markedContent){display:contents}
.pdf-canvas-page__text :deep(.textLayer ::selection){background:#006db34d}
.pdf-canvas-page__text :deep(.textLayer[data-main-rotation="90"]){transform:rotate(90deg) translateY(-100%)}
.pdf-canvas-page__text :deep(.textLayer[data-main-rotation="180"]){transform:rotate(180deg) translate(-100%,-100%)}
.pdf-canvas-page__text :deep(.textLayer[data-main-rotation="270"]){transform:rotate(270deg) translateX(-100%)}
</style>
