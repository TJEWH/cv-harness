import type { RenderTask } from './pdfTypes';
import { createPdfPageGeometry, type PageGeometry } from './pdfPageGeometry';
// CSS page-break placement retained independently of the removed html2pdf
// worker. Only the private snapshot is changed; canceled work is disposable.
export async function applyPdfPageBreaks(root: HTMLElement, pageSize: number | PageGeometry, task: Pick<RenderTask, 'checkpoint'>, onLayoutChange?: () => void) {
  if (typeof pageSize === 'number' && !(pageSize > 0)) throw new Error('PDF margins leave no space for content');
  const geometry = typeof pageSize === 'number'
    ? createPdfPageGeometry({ sourcePixelsPerMillimeter: 1, firstPageHeight: pageSize })
    : pageSize;
  const origin = root.getBoundingClientRect().top;
  const forced = new Set(['always', 'page', 'left', 'right']);
  for (const element of root.querySelectorAll('*')) {
    const pause = task.checkpoint();
    if (pause) await pause;
    const style = root.ownerDocument.defaultView!.getComputedStyle(element);
    let before = forced.has(style.breakBefore || style.pageBreakBefore);
    const after = forced.has(style.breakAfter || style.pageBreakAfter);
    const avoid = ['avoid', 'avoid-page'].includes(style.breakInside || style.pageBreakInside);
    const bounds = element.getBoundingClientRect();
    const top = bounds.top - origin, bottom = bounds.bottom - origin;
    const startPage = geometry.pageIndexForSourceY(top);
    const nextPageHeight = geometry.pageEnd(startPage + 1) - geometry.pageStart(startPage + 1);
    if (avoid && !before && startPage !== geometry.pageIndexForSourceY(Math.max(top, bottom - 0.01)) && bottom - top <= nextPageHeight) before = true;
    const insert = (position: number, next: Node | null) => {
      const spacer = root.ownerDocument.createElement('div');
      spacer.style.cssText = `display:block;height:${geometry.pageEnd(geometry.pageIndexForSourceY(position)) - position}px`;
      element.parentNode!.insertBefore(spacer, next);
      onLayoutChange?.();
    };
    if (before) insert(top, element);
    if (after) insert(bottom, element.nextSibling);
  }
}
