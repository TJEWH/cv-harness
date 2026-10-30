import type { RenderOptions } from '../pdfTypes';
import { createPdfRenderTask } from '../pdfRenderTask';

// Keep layout capture and vector painting out of the editor's startup bundle.
// Cancel a waiting caller promptly; the browser shares the module across renders.
async function loadRenderer(signal?: AbortSignal) {
  const task = createPdfRenderTask(signal);
  try { return await task.wait(import('../pdfLayoutRenderer')); }
  finally { task.dispose(); }
}

/** One vector paint capture feeds scalable SVG previews and direct PDF files. */
export function usePdfExport() {
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  function revokeDownloads() {
    for (const [url, timer] of downloads) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    downloads.clear();
  }
  const renderPreview = async (element: HTMLElement, options: RenderOptions = {}) => {
    const renderer = await loadRenderer(options.signal);
    return renderer.renderPreview(element, options);
  };
  const renderPdfBlob = async (element: HTMLElement, options: RenderOptions = {}) => {
    const renderer = await loadRenderer(options.signal);
    return renderer.renderPdfBlob(element, options);
  };
  const exportToPdf = async (element: HTMLElement, filename = 'cv', options: RenderOptions = {}) => {
    const blob = await renderPdfBlob(element, options);
    options.signal?.throwIfAborted();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename + '.pdf';
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    downloads.set(url, setTimeout(() => {
      URL.revokeObjectURL(url);
      downloads.delete(url);
    }, 60_000));
  };
  return { renderPreview, renderPdfBlob, exportToPdf, revokeDownloads };
}
