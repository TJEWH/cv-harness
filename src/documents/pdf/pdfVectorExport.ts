import { isTextRecord } from './pdfTypes';
import type { FontRun, PaintRecord, TextRecord, VectorSnapshot } from './pdfTypes';
import * as pdfkit from 'pdfkit';
import type { Font, FontCollection } from 'fontkit';
// PDFKit 0.20 exposes a named ESM constructor and accepts Fontkit objects;
// the upstream DefinitelyTyped declarations still describe its older API.
interface VectorPdfDocument extends PDFKit.PDFDocument {
  font(source: PDFKit.Mixins.PDFFontSource | Font, familyOrSize?: string | number, size?: number): this;
}
const { PDFDocument } = pdfkit as unknown as {
  PDFDocument: new (options: Omit<PDFKit.PDFDocumentOptions, 'font'> & { font: null }) => VectorPdfDocument;
};
import { toBlob } from 'pdfkit/output';
import { create as createFont } from 'fontkit';
import { createVectorFontResolver } from './pdfVectorFonts.ts';
import { createVectorGraphicsContext, parseCanvasColor } from './pdfVectorGraphics.ts';
import { vectorTextIntersectsPage } from './pdfVectorText.ts';
import { vectorPageLinks } from './pdfVectorLinks.ts';
import { vectorPageLayers } from './pdfVectorLayers.ts';

const POINTS_PER_MILLIMETER = 72 / 25.4;
// Fontkit's public TypeScript declarations are Node-oriented and only name
// Buffer here. Its browser module accepts Uint8Array directly, which keeps the
// PDF export free of Node globals.
const createBrowserFont = createFont as unknown as (bytes: Uint8Array) => Font | FontCollection;

function drawText(context: ReturnType<typeof createVectorGraphicsContext<VectorPdfDocument>>, record: TextRecord, runs: FontRun[]) {
  const [text, x, y, maxWidth] = record.args;
  if (!text || !runs.length) return;
  context.withPaint((doc, state) => {
    const widths = runs.map((run) => {
      doc.font(run.font, run.id).fontSize(run.fontSize);
      return doc.widthOfString(run.text);
    });
    const fontWidth = widths.reduce((sum, width) => sum + width, 0);
    const browserWidth = record.metrics.width;
    const width = Number.isFinite(maxWidth) && maxWidth > 0 ? Math.min(browserWidth, maxWidth) : browserWidth;
    const scale = fontWidth > 0 ? width / fontWidth : 1;
    let left = x;
    if (state.textAlign === 'center') left -= width / 2;
    if (state.textAlign === 'right' || (state.textAlign === 'end' && state.direction !== 'rtl')) left -= width;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      doc.font(run.font, run.id).fontSize(run.fontSize);
      if (run.syntheticBold) {
        const paint = parseCanvasColor(state.fillStyle);
        doc.strokeColor(paint.color).strokeOpacity(paint.opacity * state.globalAlpha).lineWidth(run.fontSize / 30);
      }
      const textOptions: PDFKit.Mixins.TextOptions & { horizontalScaling: number } = {
        lineBreak: false,
        baseline: state.textBaseline,
        horizontalScaling: scale * 100,
        oblique: run.syntheticItalic ? 14 : false,
        stroke: record.method === 'strokeText' || run.syntheticBold,
        fill: record.method !== 'strokeText',
      };
      doc.text(run.text, left, y, textOptions);
      left += widths[index] * scale;
    }
  }, { stroke: record.method === 'strokeText' });
}

/**
 * Replay the shared vector paint list as PDF paths and visible embedded fonts.
 */
export async function renderVectorPdf(snapshot: VectorSnapshot) {
  const { recording, pages, fontStyleUrls, loadedFaces, pageWidth, pageHeight, task } = snapshot;
  const resolver = await task.wait(createVectorFontResolver({ document: globalThis.document, stylesheetUrls: fontStyleUrls, loadedFaces, createFont: createBrowserFont }));
  const textRuns = new Map<PaintRecord, FontRun[]>();
  for (const record of [...recording.records, ...(snapshot.footer?.recording.records || [])]) {
    if (!isTextRecord(record) || !record.fontString) continue;
    // Canvas treats ASCII control whitespace as spaces; PDFKit would otherwise
    // lay out a newline again, and fonts do not contain glyphs for these codes.
    const text = String(record.args[0]).replace(/[\t\n\f\r]/g, ' ');
    if (!text) continue;
    const pause = task.checkpoint();
    if (pause) await pause;
    textRuns.set(record, await task.wait(resolver.resolve(record.fontString, text)));
  }

  const doc = new PDFDocument({
    autoFirstPage: false,
    font: null,
    compress: true,
    info: { Creator: 'CV Builder', Producer: 'CV Builder vector export' },
  });
  const blob = toBlob(doc as unknown as PDFKit.PDFDocument);
  // Attach a handler immediately, including when a drawing error aborts export.
  blob.catch(() => {});
  try {
    const pageOptions = { size: [pageWidth * POINTS_PER_MILLIMETER, pageHeight * POINTS_PER_MILLIMETER], margin: 0 };
    // An empty CV still downloads a valid single blank page.
    if (!pages.length) doc.addPage(pageOptions);
    for (const page of pages) {
      await task.checkpoint(true);
      doc.addPage(pageOptions);
      for (const { recording, canvas, links, page: layerPage } of vectorPageLayers(snapshot, page)) {
        const page = layerPage;
        const pixelScale = page.contentWidth * POINTS_PER_MILLIMETER / page.canvasWidth;
        doc.save();
        doc.translate(page.leftOffset * POINTS_PER_MILLIMETER, page.topOffset * POINTS_PER_MILLIMETER);
        doc.rect(0, 0, page.canvasWidth * pixelScale, (page.sourceBottom - page.sourceTop) * pixelScale).clip();
        doc.scale(pixelScale).translate(0, -page.sourceTop);
        const context = createVectorGraphicsContext(doc);
        for (const record of recording.records) {
          const pause = task.checkpoint();
          if (pause) await pause;
          if (isTextRecord(record) && textRuns.has(record)) {
            // Include text only on pages that intersect its painted bounds.
            if (vectorTextIntersectsPage(record, context.state, page)) drawText(context, record, textRuns.get(record)!);
          } else context.apply(record);
        }
        context.finish();
        doc.restore();
        for (const link of vectorPageLinks(links, canvas, page)) {
          doc.link(link.x * POINTS_PER_MILLIMETER, link.y * POINTS_PER_MILLIMETER,
            link.width * POINTS_PER_MILLIMETER, link.height * POINTS_PER_MILLIMETER, link.href);
        }
      }
    }
    doc.end();
    return await task.wait(blob);
  } catch (error) {
    // Finish the output collector even when drawing or cancellation aborts.
    doc.emit('error', error);
    throw error;
  }
}
