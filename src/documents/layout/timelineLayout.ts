import { createPdfPageGeometry, type PageGeometry } from '../pdf/pdfPageGeometry';

type TimelineSegment = { x: number; top: number; bottom: number; page?: number };

// A spanning item's box includes pagination whitespace. Measure its painted
// lines instead, so each page has its own endpoint before joining nearby items.
function contentRects(item: Element) {
  const document = item.ownerDocument;
  const walker = document.createTreeWalker(item, 4 /* SHOW_TEXT */);
  const range = document.createRange();
  const rects: { top: number; bottom: number }[] = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) {
      if (rect.width && rect.height) rects.push(rect);
    }
  }
  for (const element of item.querySelectorAll('img, svg, hr')) {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) rects.push(rect);
  }
  return rects;
}

export function timelinePageSegments(
  item: TimelineSegment,
  content: { top: number; bottom: number }[],
  geometry: PageGeometry,
): TimelineSegment[] {
  // All coordinates here are relative to the PDF source, before section-local
  // coordinates are applied to the SVG.
  const firstPage = geometry.pageIndexForSourceY(item.top);
  const lastPage = geometry.pageIndexForSourceY(Math.max(item.top, item.bottom - 0.01));
  if (firstPage === lastPage) return [{ ...item, page: firstPage }];
  const segments = new Map<number, TimelineSegment>();
  for (const rect of content) {
    const start = Math.max(item.top, rect.top);
    const end = Math.min(item.bottom, rect.bottom);
    if (end <= start) continue;
    for (let page = geometry.pageIndexForSourceY(start); page <= geometry.pageIndexForSourceY(end - 0.01); page++) {
      const top = Math.max(start, geometry.pageStart(page));
      const bottom = Math.min(end, geometry.pageEnd(page));
      const segment = segments.get(page);
      if (segment) {
        segment.top = Math.min(segment.top, top);
        segment.bottom = Math.max(segment.bottom, bottom);
      } else segments.set(page, { x: item.x, top, bottom, page });
    }
  }
  const result = [...segments.values()].sort((a, b) => a.page! - b.page!);
  for (const segment of result) {
    if (segment.page === firstPage) segment.top = item.top;
    // Retain the true item-box endpoint on its final page, including its normal
    // line height/padding, but never a spacer that spills onto an empty page.
    if (segment.page === lastPage) segment.bottom = item.bottom;
  }
  return result;
}

// Follow the actual item column, including left/deferred sidebars. One rail per
// section bridges both timeline wrappers and item gaps on the same PDF page.
export function timelineRailPath(items: TimelineSegment[]) {
  if (!items.length) return '';
  // Draw upwards from the actual bottom entry, never from a page boundary or
  // a wrapper whose height includes pagination whitespace.
  const last = items[items.length - 1];
  const commands = [`M ${last.x} ${last.bottom}`];
  let previousX = last.x;
  let previousPage = last.page;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    // Segments on the same page join, including continued entries. Never bridge
    // the empty area before a page break or cross a sidebar column.
    if (index < items.length - 1 && (item.x !== previousX || item.page !== previousPage)) {
      commands.push(`M ${item.x} ${item.bottom}`);
    }
    commands.push(`L ${item.x} ${item.top}`);
    previousX = item.x;
    previousPage = item.page;
  }
  return commands.join(' ');
}

export function updateTimelineRails(root: HTMLElement | null, pageSize?: number | PageGeometry) {
  if (!root || root.ownerDocument.documentElement.getAttribute('data-show-timeline') === 'false') return;
  const view = root.ownerDocument.defaultView!;
  const geometry = typeof pageSize === 'number'
    ? createPdfPageGeometry({ sourcePixelsPerMillimeter: 1, firstPageHeight: pageSize })
    : pageSize;
  const sourceTop = geometry ? root.getBoundingClientRect().top : 0;
  // Read every section first; interleaving SVG writes with geometry reads forces
  // the browser to lay out the CV again for each section.
  const measurements = [...root.querySelectorAll<SVGSVGElement>('.timeline-rail')].map((rail) => {
    const section = rail.parentElement!;
    const bounds = section.getBoundingClientRect();
    const items = bounds.width && bounds.height ? [...section.querySelectorAll('.timeline > .item')].flatMap((item) => {
      const title = item.querySelector<HTMLElement>('.item-title')!;
      const titleBounds = title.getBoundingClientRect();
      const dot = view.getComputedStyle(title, '::before');
      const itemBounds = item.getBoundingClientRect();
      const measurement = {
        x: titleBounds.left - bounds.left + parseFloat(dot.left) + parseFloat(dot.width) / 2,
        top: titleBounds.top - sourceTop + titleBounds.height / 2,
        bottom: itemBounds.bottom - sourceTop,
      };
      const spansPages = geometry && geometry.pageIndexForSourceY(measurement.top)
        !== geometry.pageIndexForSourceY(Math.max(measurement.top, measurement.bottom - 0.01));
      const segments = geometry
        ? timelinePageSegments(measurement, spansPages ? contentRects(item).map((rect) => ({ top: rect.top - sourceTop, bottom: rect.bottom - sourceTop })) : [], geometry)
        : [measurement];
      return segments.map((segment) => ({ ...segment, top: segment.top + sourceTop - bounds.top, bottom: segment.bottom + sourceTop - bounds.top }));
    }) : [];
    // Tight, explicitly positioned SVG bounds prevent intrinsic SVG sizing from
    // lifting or clipping the rail when a section gains page-break spacers.
    const top = items.length ? Math.min(...items.map((item) => item.top)) - 2 : 0;
    const bottom = items.length ? Math.max(...items.map((item) => item.bottom)) + 2 : 0;
    const height = bottom - top;
    return { rail, top, height, width: bounds.width, path: timelineRailPath(items) };
  });
  const setAttribute = (element: Element, name: string, value: string) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  for (const { rail, top, height, width, path } of measurements) {
    if (rail.style.top !== `${top}px`) rail.style.top = `${top}px`;
    // html2canvas copies computed SVG dimensions into inline CSS. Update both
    // CSS and attributes when the final renderer layout changes item heights.
    if (rail.style.width !== `${width}px`) rail.style.width = `${width}px`;
    if (rail.style.height !== `${height}px`) rail.style.height = `${height}px`;
    setAttribute(rail, 'preserveAspectRatio', 'none');
    setAttribute(rail, 'width', String(width));
    setAttribute(rail, 'height', String(height));
    setAttribute(rail, 'viewBox', `0 ${top} ${width || 1} ${height || 1}`);
    setAttribute(rail.querySelector('path')!, 'd', path);
  }
}
