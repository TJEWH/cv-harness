import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';

let library: Promise<typeof import('pdfjs-dist')> | undefined;
const pageUsers = new WeakMap<PDFPageProxy, number>();

/** Inline and fullscreen previews can share a PDFPageProxy. Only the last view may clean its resources. */
export function retainPdfPage(page: PDFPageProxy) {
  pageUsers.set(page, (pageUsers.get(page) || 0) + 1);
  let released = false;
  return (pendingRender?: Promise<unknown>) => {
    if (released) return;
    released = true;
    pageUsers.set(page, (pageUsers.get(page) || 1) - 1);
    const cleanup = () => { if (!pageUsers.get(page)) page.cleanup(); };
    if (pendingRender) void pendingRender.then(cleanup, cleanup);
    else cleanup();
  };
}

/** Load the renderer only for existing PDFs; CV/SVG previews do not need it. */
export function loadPdfJs() {
  library ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  }).catch(cause => {
    library = undefined;
    throw cause;
  });
  return library;
}

export async function createPdfLoadingTask(data: Uint8Array): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await loadPdfJs();
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
  return pdfjs.getDocument({
    data,
    cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
    useSystemFonts: false,
  });
}
