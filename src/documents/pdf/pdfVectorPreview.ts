import { isTextRecord } from './pdfTypes';
import type { VectorDocument, TextRecord, GraphicsState, VectorSnapshot } from './pdfTypes';
import { createVectorGraphicsContext, multiplyCanvasMatrices } from './pdfVectorGraphics.ts';
import { vectorPageLinks } from './pdfVectorLinks.ts';
import { vectorTextIntersectsPage } from './pdfVectorText.ts';
import { vectorPageLayers } from './pdfVectorLayers.ts';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
let previewSerial = 0;

// A small SVG target for the same path/clip replay used by PDFKit. Coordinates
// remain vector values; neither previews nor downloads encode page bitmaps.
export function createSvgDocument(prefix = `cv-vector-${++previewSerial}`) {
  let state = { matrix: [1, 0, 0, 1, 0, 0], clips: [] as string[], fill: '#000', stroke: '#000', fillAlpha: 1, strokeAlpha: 1, width: 1, cap: 'butt', join: 'miter', miter: 10, dash: [] as number[], dashOffset: 0 };
  const stack: (typeof state)[] = [], definitions: string[] = [], elements: string[] = [];
  let path = '';
  const matrix = () => `matrix(${state.matrix.join(' ')})`;
  const color = (value: string | number[]) => Array.isArray(value) ? `rgb(${value.join(',')})` : value;
  function emit(element: string) {
    for (const id of state.clips.toReversed()) element = `<g clip-path="url(#${id})">${element}</g>`;
    elements.push(element);
  }
  const doc: VectorDocument & { text(record: TextRecord, paint: GraphicsState): void; output(width: number, height: number, links?: string): string } = {
    save() { stack.push({ ...state, matrix: [...state.matrix], clips: [...state.clips] }); return doc; },
    restore() { state = stack.pop() || state; return doc; },
    transform(...matrix) { state.matrix = multiplyCanvasMatrices(state.matrix, matrix); return doc; },
    translate(x, y) { return doc.transform(1, 0, 0, 1, x, y); },
    scale(scaleX, scaleY = scaleX) { return doc.transform(scaleX, 0, 0, scaleY, 0, 0); },
    moveTo(x, y) { path += `M${x} ${y}`; return doc; },
    lineTo(x, y) { path += `L${x} ${y}`; return doc; },
    bezierCurveTo(...points) { path += `C${points.join(' ')}`; return doc; },
    closePath() { path += 'Z'; return doc; },
    rect(x, y, w, h) { path += `M${x} ${y}h${w}v${h}h${-w}Z`; return doc; },
    fillColor(value) { state.fill = color(value); return doc; },
    strokeColor(value) { state.stroke = color(value); return doc; },
    fillOpacity(value) { state.fillAlpha = value; return doc; },
    strokeOpacity(value) { state.strokeAlpha = value; return doc; },
    lineWidth(value) { state.width = value; return doc; },
    lineCap(value) { state.cap = value; return doc; },
    lineJoin(value) { state.join = value; return doc; },
    miterLimit(value) { state.miter = value; return doc; },
    addContent(value) {
      const match = value.match(/^\[([^\]]*)]\s+([\d.e+-]+) d$/);
      if (!match) throw new Error('Unsupported SVG vector command');
      state.dash = match[1].trim() ? match[1].trim().split(/\s+/).map(Number) : [];
      state.dashOffset = Number(match[2]);
      return doc;
    },
    fill(rule) {
      emit(`<path d="${path}" transform="${matrix()}" fill="${escape(state.fill)}" fill-opacity="${state.fillAlpha}" fill-rule="${rule === 'even-odd' ? 'evenodd' : 'nonzero'}"/>`);
      path = ''; return doc;
    },
    stroke() {
      emit(`<path d="${path}" transform="${matrix()}" fill="none" stroke="${escape(state.stroke)}" stroke-opacity="${state.strokeAlpha}" stroke-width="${state.width}" stroke-linecap="${state.cap}" stroke-linejoin="${state.join}" stroke-miterlimit="${state.miter}" stroke-dasharray="${state.dash.join(' ')}" stroke-dashoffset="${state.dashOffset}"/>`);
      path = ''; return doc;
    },
    clip(rule) {
      const id = `${prefix}-clip-${definitions.length}`;
      definitions.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${path}" transform="${matrix()}" clip-rule="${rule === 'even-odd' ? 'evenodd' : 'nonzero'}"/></clipPath>`);
      state.clips.push(id); path = ''; return doc;
    },
    svg(source, width, height, alpha) {
      const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
      // Root margins were already applied by the shared image painter. Keep
      // paint properties, not the copied HTML layout rules, on the nested SVG.
      for (const name of ['fill', 'stroke', 'color', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width']) {
        const value = root.style.getPropertyValue(name);
        if (value) root.setAttribute(name, value);
      }
      root.removeAttribute('style');
      root.removeAttribute('class');
      root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
      emit(`<g transform="${matrix()}" opacity="${alpha}">${new XMLSerializer().serializeToString(root)}</g>`);
      return doc;
    },
    text(record, paint) {
      const [raw, x, y] = record.args;
      const text = String(raw).replace(/[\t\n\f\r]/g, ' ');
      if (!text) return;
      const anchor = paint.textAlign === 'center' ? 'middle' : ['right', 'end'].includes(paint.textAlign) ? 'end' : 'start';
      const baseline = { bottom: 'text-after-edge', top: 'text-before-edge', middle: 'central', hanging: 'hanging' }[paint.textBaseline as 'bottom' | 'top' | 'middle' | 'hanging'] || 'alphabetic';
      const width = record.metrics.width;
      emit(`<text x="${x}" y="${y}" transform="${matrix()}" fill="${escape(state.fill)}" fill-opacity="${state.fillAlpha}" font-family="${escape(record.font.family)}" font-size="${record.font.size}" font-weight="${record.font.weight}" font-style="${record.font.style}" text-anchor="${anchor}" dominant-baseline="${baseline}"${width > 0 ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"` : ''} xml:space="preserve">${escape(text)}</text>`);
    },
    output(width, height, links = '') {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs>${definitions.join('')}</defs><rect width="100%" height="100%" fill="white"/>${elements.join('')}${links}</svg>`;
    },
  };
  return doc;
}

export async function renderVectorPreview(snapshot: Omit<VectorSnapshot, 'task'> & { task: Pick<VectorSnapshot['task'], 'checkpoint'> }) {
  const { pages, pageWidth, pageHeight, task } = snapshot;
  const result = [];
  for (const page of pages) {
    await task.checkpoint(true);
    const doc = createSvgDocument();
    let annotations = '';
    for (const { recording, canvas, links, page: layerPage } of vectorPageLayers(snapshot, page)) {
      const page = layerPage;
      doc.save();
      const scale = page.contentWidth / page.canvasWidth;
      doc.translate(page.leftOffset, page.topOffset);
      doc.rect(0, 0, page.contentWidth, (page.sourceBottom - page.sourceTop) * scale).clip();
      doc.scale(scale).translate(0, -page.sourceTop);
      const context = createVectorGraphicsContext(doc);
      for (const record of recording.records) {
        const pause = task.checkpoint();
        if (pause) await pause;
        if (isTextRecord(record) && record.method === 'fillText') {
          if (vectorTextIntersectsPage(record, context.state, page)) context.withPaint((_, state) => doc.text(record, state));
        }
        else context.apply(record);
      }
      context.finish();
      doc.restore();
      annotations += vectorPageLinks(links, canvas, page).map((link) => `<a href="${escape(link.href)}" aria-label="${escape(link.href)}" target="_blank" rel="noopener noreferrer"><rect x="${link.x}" y="${link.y}" width="${link.width}" height="${link.height}" fill="transparent"/></a>`).join('');
    }
    result.push({ ...page, svg: doc.output(pageWidth, pageHeight, annotations) });
  }
  return { pages: result };
}
