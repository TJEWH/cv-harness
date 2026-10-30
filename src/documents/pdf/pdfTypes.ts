import type { Font } from 'fontkit';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { createPdfRenderTask } from './pdfRenderTask';

export type RenderTask = ReturnType<typeof createPdfRenderTask>;
export interface Surface { width: number; height: number; ownerDocument?: Document }
export interface PageSlice {
  sourceTop: number; sourceBottom: number; canvasWidth: number;
  contentWidth: number; leftOffset: number; topOffset: number;
}
export interface PreviewPage extends PageSlice { svg: string }
/** A page in an existing PDF, rendered only when the shared preview displays it. */
export interface PdfPreviewPage { pdf: PDFDocumentProxy; pageNumber: number }
export type DocumentPreviewPage = PreviewPage | PdfPreviewPage;
export interface FontDescriptor { family: string; size: number; weight: number; style: string }
export interface TextMetricsRecord { width: number; actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number }
/** Keep reflected Canvas overload arguments inside the recording/replay boundary.
 * Consumers validate the method. */
export interface CallRecord {
  type: 'call'; method: string; args: any[];
  font?: FontDescriptor; fontString?: string; metrics?: TextMetricsRecord;
}
export interface SetRecord { type: 'set'; property: string; value: unknown; method?: never }
export type PaintRecord = CallRecord | SetRecord;
export interface TextRecord extends CallRecord { font: FontDescriptor; metrics: TextMetricsRecord }
export function isTextRecord(record: PaintRecord): record is TextRecord {
  return record.type === 'call' && (record.method === 'fillText' || record.method === 'strokeText')
    && record.font !== undefined && record.metrics !== undefined;
}
export interface GraphicsState {
  matrix: number[]; fillStyle: unknown; strokeStyle: unknown; globalAlpha: number;
  font: string; textBaseline: CanvasTextBaseline; textAlign: CanvasTextAlign; direction: CanvasDirection;
  lineWidth: number; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin; miterLimit: number;
  lineDash: number[]; lineDashOffset: number; globalCompositeOperation: string;
}
export interface LinkRect { href: string; x: number; y: number; width: number; height: number }
export interface LoadedFace { family: string; style: string; weight: string; unicodeRange: string; status: string }
export interface LinkCapture extends Surface { links: LinkRect[]; fontStyleUrls?: string[]; loadedFaces?: LoadedFace[] }
export interface VectorSnapshot {
  recording: { records: PaintRecord[] }; canvas: Surface; pages: PageSlice[];
  links?: LinkCapture; fontStyleUrls?: string[]; loadedFaces?: LoadedFace[];
  pageWidth: number; pageHeight: number; task: RenderTask;
  footer?: VectorLayer;
}
export interface VectorLayer {
  recording: { records: PaintRecord[] }; canvas: Surface; links?: LinkCapture; page: PageSlice;
}
export interface RenderOptions {
  signal?: AbortSignal; margin?: number | number[]; continuationTopPadding?: number;
  sidebarFillMode?: string; sidebarHeightMode?: string;
}
export interface FontRun {
  font: Font; id: string; weight: number; family: string; fontSize: number;
  syntheticBold: boolean; syntheticItalic: boolean; text: string;
}
/** Common drawing surface implemented by both PDFKit and the SVG preview. */
export interface VectorDocument {
  save(): this; restore(): this;
  transform(...matrix: number[]): this;
  translate(x: number, y: number): this;
  scale(x: number, y?: number): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  bezierCurveTo(...points: number[]): this;
  closePath(): this;
  rect(x: number, y: number, width: number, height: number): this;
  fillColor(color: string | [number, number, number]): this;
  strokeColor(color: string | [number, number, number]): this;
  fillOpacity(alpha: number): this; strokeOpacity(alpha: number): this;
  lineWidth(width: number): this; lineCap(cap: CanvasLineCap): this;
  lineJoin(join: CanvasLineJoin): this; miterLimit(limit: number): this;
  addContent(value: string): this;
  fill(rule?: 'even-odd' | 'non-zero'): this; stroke(): this; clip(rule?: 'even-odd' | 'non-zero'): this;
  svg?(source: string, width: number, height: number, alpha: number): this;
}
