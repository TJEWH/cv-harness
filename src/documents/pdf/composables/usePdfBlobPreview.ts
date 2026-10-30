import { markRaw, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { PdfPreviewPage } from '../pdfTypes';
import { createPdfLoadingTask } from '../pdfJs';

type LoadingTask = Pick<PDFDocumentLoadingTask, 'promise' | 'destroy'>;
type LoadPdf = (data: Uint8Array) => Promise<LoadingTask>;

/** Keep one locally parsed document for both preview surfaces, never changing the source blob. */
export function usePdfBlobPreview(source: () => Blob | null, loadPdf: LoadPdf = createPdfLoadingTask) {
  const pages = shallowRef<PdfPreviewPage[]>([]);
  const loading = ref(false);
  const error = ref('');
  let generation = 0;
  let disposed = false;
  let activeTask: LoadingTask | null = null;

  function release(task: LoadingTask | null) {
    // Destroying the loading task also releases a successfully parsed document and its worker.
    if (!task) return;
    // A task returned by an outdated asynchronous loader may never have been awaited.
    void task.promise.catch(() => {});
    try { void task.destroy().catch(() => {}); } catch { /* A released worker needs no further action. */ }
  }
  function clear() {
    generation++;
    pages.value = [];
    loading.value = false;
    error.value = '';
    const previous = activeTask;
    activeTask = null;
    release(previous);
  }
  async function load(blob: Blob, token: number) {
    loading.value = true;
    let task: LoadingTask | null = null;
    const current = () => !disposed && token === generation;
    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!current()) return;
      task = await loadPdf(data);
      if (!current()) { release(task); return; }
      activeTask = task;
      const pdf = markRaw(await task.promise);
      if (!current()) return;
      pages.value = Array.from({ length: pdf.numPages }, (_, index) => ({ pdf, pageNumber: index + 1 }));
    } catch (cause) {
      if (!current()) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (activeTask === task) { activeTask = null; release(task); }
    } finally {
      if (current()) loading.value = false;
    }
  }
  function retry() {
    if (disposed) return;
    clear();
    const blob = source();
    if (blob) void load(blob, generation);
  }
  watch(source, retry, { immediate: true, flush: 'sync' });
  onScopeDispose(() => { disposed = true; clear(); });
  return { pages, loading, error, retry };
}
