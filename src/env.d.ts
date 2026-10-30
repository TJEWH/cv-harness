/// <reference types="vite/client" />
declare module 'wawoff2/build/decompress_binding.js' {
  const runtime: import('./vendor').Woff2Runtime;
  export default runtime;
}
declare module 'wawoff2/compress.js' {
  export default function compress(bytes: Uint8Array): Promise<Uint8Array>;
}
declare module 'pdfkit/output' {
  export function toBlob(document: PDFKit.PDFDocument): Promise<Blob>;
}
declare module 'virtual:responsive-html2canvas' {
  type RenderTask = import('./documents/pdf/pdfTypes').RenderTask;
  type Surface = import('./documents/pdf/pdfTypes').Surface;
  export default function paintLayout(element: HTMLElement, options: {
    scale: number; useCORS: boolean; scrollX: number; scrollY: number; logging: boolean;
    windowWidth: number; windowHeight: number; renderTask: RenderTask;
    createVectorContext(surface: Surface, documentRef?: Document): CanvasRenderingContext2D;
    ignoreElements(node: Element): boolean;
    onclone(document: Document, clone: HTMLElement): void;
  }): Promise<Surface>;
}
