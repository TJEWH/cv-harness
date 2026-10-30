import { onBeforeUnmount, ref, watch } from 'vue';
import type { PreviewPage, RenderOptions } from '../pdfTypes';
import { createPreviewRenderSlot } from '../pdfRenderTask';
import { usePdfExport } from './usePdfExport';
import { usePreviewInputCommit } from './usePreviewInputCommit';

export type PdfPreviewRenderer = Pick<ReturnType<typeof usePdfExport>, 'renderPreview' | 'renderPdfBlob' | 'exportToPdf'>;
export interface DocumentPdfPreviewOptions {
  source(): Promise<HTMLElement>;
  options(): RenderOptions;
  signature(): unknown;
  active(): boolean;
  identity?: () => unknown[];
  delayMs?: number;
  watchFlush?: 'sync' | 'post';
  /** Hold updates during an interaction; call commit() after releasing it. */
  deferUpdate?: () => boolean;
  retainPagesOnUpdate?: boolean;
  /** Also preserve text-entry deferral while this preview is hidden. */
  retainPagesOnHide?: boolean;
  resetPageOnUpdate?: boolean;
  /** Successful empty output can be retried when this preview reopens. */
  cacheEmptyPages?: boolean;
  cancelExportsOnSourceChange?: boolean;
  /** The caller owns download URL cleanup when supplying a renderer. */
  renderer?: PdfPreviewRenderer;
}

/** One cancellable lifecycle per document, shared by its inline and full-size surfaces. */
export function useDocumentPdfPreview(input: DocumentPdfPreviewOptions) {
  const pages = ref<PreviewPage[]>([]);
  const page = ref(1);
  const busy = ref(false);
  const downloading = ref(false);
  // Keep the legacy imperative error channel: starting either operation or
  // changing visibility/source clears it for existing application callers.
  const error = ref('');
  const previewError = ref('');
  const downloadError = ref('');
  const slot = createPreviewRenderSlot();
  const exports = new Set<AbortController>();
  const ownedRenderer = input.renderer ? null : usePdfExport();
  const renderer = input.renderer || ownedRenderer!;
  const delay = input.delayMs ?? 150;
  const watchFlush = input.watchFlush ?? 'sync';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let disposed = false;
  let pendingUpdate = false;
  let activeDownload: AbortController | null = null;
  // Keep one completed source, including successful empty output. Displayed
  // retained pages may be stale; only this cache can satisfy reactivation.
  let completedPages: PreviewPage[] | null = null;
  const inputCommit = usePreviewInputCommit(commit);
  let identity = input.identity?.();

  function cancelPreview() {
    generation++;
    slot.cancel();
    clearTimeout(timer);
    timer = undefined;
    busy.value = false;
  }
  function cancelExports() {
    for (const controller of exports) controller.abort();
    exports.clear();
  }
  function clearPreviewError() { previewError.value = ''; error.value = ''; }
  function schedule() {
    if (disposed || !input.active()) return;
    busy.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void refresh(); }, delay);
  }
  async function refresh() {
    if (disposed || !input.active()) return;
    cancelPreview();
    const token = generation;
    const signal = slot.start();
    const current = () => !disposed && token === generation && !signal.aborted;
    completedPages = null;
    pendingUpdate = false;
    inputCommit.reset();
    busy.value = true;
    clearPreviewError();
    try {
      const element = await input.source();
      signal.throwIfAborted();
      const result = await renderer.renderPreview(element, { ...input.options(), signal });
      if (current()) {
        completedPages = result.pages.length || input.cacheEmptyPages !== false ? result.pages : null;
        pages.value = result.pages;
        page.value = Math.min(Math.max(page.value, 1), Math.max(1, result.pages.length));
      }
    } catch (cause) {
      if (current()) {
        // Retention lasts only while replacing a source, never after failure.
        pages.value = [];
        previewError.value = cause instanceof Error ? cause.message : String(cause);
        error.value = previewError.value;
      }
    } finally { if (current()) busy.value = false; }
  }

  /** Request a replacement; false reuses only a completed nonempty preview. */
  function request(force = true) {
    if (disposed) return;
    if (!force && completedPages?.length) {
      if (input.active()) pages.value = completedPages;
      return;
    }
    cancelPreview();
    completedPages = null;
    pendingUpdate = false;
    inputCommit.reset();
    clearPreviewError();
    if (!input.retainPagesOnUpdate) pages.value = [];
    schedule();
  }
  /** Release an existing deferred update without resetting its selected page. */
  function commit() {
    if (disposed || !pendingUpdate || input.deferUpdate?.()) return;
    pendingUpdate = false;
    inputCommit.reset();
    cancelPreview();
    clearPreviewError();
    schedule();
  }

  function invalidateSource(wasActive: boolean) {
    completedPages = null;
    cancelPreview();
    if (input.cancelExportsOnSourceChange !== false) cancelExports();
    const nextIdentity = input.identity?.();
    const identityChanged = nextIdentity?.length !== identity?.length
      || !!nextIdentity?.some((value, index) => value !== identity?.[index]);
    identity = nextIdentity;
    const externalHold = !!input.deferUpdate?.();
    const textHold = !externalHold && !identityChanged
      && (input.active() && wasActive || !!input.retainPagesOnHide)
      && inputCommit.defer();
    const deferred = externalHold || textHold;
    clearPreviewError();
    if (identityChanged || !deferred && !input.retainPagesOnUpdate) pages.value = [];
    if (!deferred && input.resetPageOnUpdate) page.value = 1;
    pendingUpdate = deferred;
    if (deferred) return;
    inputCommit.reset();
    schedule();
  }
  watch([input.signature, () => input.identity?.()], (_value, previous) => {
    invalidateSource(!!previous?.length && input.active());
  }, { deep: true, immediate: true, flush: watchFlush });
  watch(input.active, active => {
    cancelPreview();
    pendingUpdate = false;
    inputCommit.reset();
    error.value = '';
    if (!input.retainPagesOnHide) { pages.value = []; previewError.value = ''; }
    if (!active || disposed) return;
    if (completedPages !== null) { pages.value = completedPages; return; }
    clearPreviewError();
    // Visibility reactivation renders the current source rather than reviving
    // a stale completed cache, including after a hidden deferred edit.
    schedule();
  }, { flush: watchFlush });

  async function getPdfBlob(source = input.source): Promise<Blob> {
    const controller = new AbortController();
    if (disposed) controller.abort();
    exports.add(controller);
    try {
      controller.signal.throwIfAborted();
      const element = await source();
      controller.signal.throwIfAborted();
      const blob = await renderer.renderPdfBlob(element, { ...input.options(), signal: controller.signal });
      controller.signal.throwIfAborted();
      return blob;
    } finally { exports.delete(controller); }
  }
  async function download(filename: string) {
    if (disposed || downloading.value) return;
    const controller = new AbortController();
    activeDownload = controller;
    exports.add(controller);
    downloading.value = true;
    downloadError.value = '';
    error.value = '';
    try {
      const element = await input.source();
      controller.signal.throwIfAborted();
      await renderer.exportToPdf(element, filename, { ...input.options(), signal: controller.signal });
    } catch (cause) {
      if (!disposed && activeDownload === controller && !controller.signal.aborted) {
        downloadError.value = cause instanceof Error ? cause.message : String(cause);
        error.value = downloadError.value;
      }
    } finally {
      exports.delete(controller);
      if (activeDownload === controller) { activeDownload = null; downloading.value = false; }
    }
  }
  function reset() {
    cancelPreview();
    cancelExports();
    activeDownload = null;
    downloading.value = false;
    completedPages = null;
    pendingUpdate = false;
    inputCommit.reset();
    pages.value = [];
    page.value = 1;
    error.value = ''; previewError.value = ''; downloadError.value = '';
    ownedRenderer?.revokeDownloads();
  }
  onBeforeUnmount(() => { disposed = true; reset(); });
  return { pages, page, busy, downloading, error, previewError, downloadError, getPdfBlob, download, refresh, request, commit, reset };
}
