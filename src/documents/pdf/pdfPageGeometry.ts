interface SliceOptions {
  width: number; height: number; pageWidth: number; pageHeight: number;
  margins?: number[]; continuationTopPadding?: number;
}
interface GeometryOptions { sourcePixelsPerMillimeter: number; firstPageHeight: number; continuationTopPadding?: number }
export type PageGeometry = ReturnType<typeof createPdfPageGeometry>;
interface SidebarPlacementOptions {
  geometry: PageGeometry; sidebarHeight: number; firstPageSidebarTop?: number; initialFinalPage?: number;
  measureBodyFinalPage?(placement: { finalPage: number; startPage: number; sidebarLastPage: number }): number;
}
function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pageIndex(value: unknown) {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

const TRAILING_SLICE_TOLERANCE_MILLIMETERS = 0.75;

/**
 * Split vector paint coordinates into pages using the established subpixel
 * boundaries. Margins follow [top, left, bottom, right] order.
 */
export function createPdfPageSlices({
  width,
  height,
  pageWidth,
  pageHeight,
  margins = [0, 0, 0, 0],
  continuationTopPadding = 0,
}: SliceOptions) {
  const [marginTop, marginLeft, marginBottom, marginRight] = margins;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const firstPageHeight = pageHeight - marginTop - marginBottom;
  const safeContinuationPadding = Math.min(
    Math.max(Number(continuationTopPadding) || 0, 0),
    Math.max(0, firstPageHeight - 1),
  );

  if (
    !Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height < 0
    || !Number.isFinite(contentWidth) || contentWidth <= 0
    || !Number.isFinite(firstPageHeight) || firstPageHeight <= 0
  ) {
    throw new Error('PDF margins leave no space for the CV content');
  }

  const trailingSliceTolerance = Math.max(
    1,
    Math.ceil((width / contentWidth) * TRAILING_SLICE_TOLERANCE_MILLIMETERS),
  );
  const pages = [];
  let sourceTop = 0;

  while (height - sourceTop > trailingSliceTolerance) {
    const padding: number = pages.length > 0 ? safeContinuationPadding : 0;
    const sliceHeight = Math.min(
      Math.max(1, Math.floor((width * (firstPageHeight - padding)) / contentWidth)),
      height - sourceTop,
    );
    const sourceBottom = sourceTop + sliceHeight;
    pages.push({
      sourceTop,
      sourceBottom,
      canvasWidth: width,
      contentWidth,
      leftOffset: marginLeft,
      topOffset: marginTop + padding,
    });
    sourceTop = sourceBottom;
  }

  return pages;
}

/**
 * Describe the source-canvas heights that map to each exported PDF page.
 */
export function createPdfPageGeometry({
  sourcePixelsPerMillimeter,
  firstPageHeight,
  continuationTopPadding = 0,
}: GeometryOptions) {
  const pixelsPerMillimeter = Math.max(0.001, finiteNumber(sourcePixelsPerMillimeter, 1));
  const firstPageMillimeters = Math.max(0.001, finiteNumber(firstPageHeight, 1));
  const safeContinuationPadding = Math.min(
    Math.max(0, finiteNumber(continuationTopPadding)),
    Math.max(0, firstPageMillimeters - 0.001),
  );
  const firstPageSourceHeight = firstPageMillimeters * pixelsPerMillimeter;
  const continuationSourceHeight = Math.max(
    0.001,
    (firstPageMillimeters - safeContinuationPadding) * pixelsPerMillimeter,
  );
  const normalizePageIndex = pageIndex;

  const pageStart = (pageIndex: number) => {
    const index = normalizePageIndex(pageIndex);
    return index === 0 ? 0 : firstPageSourceHeight + ((index - 1) * continuationSourceHeight);
  };

  const pageEnd = (pageIndex: number) => pageStart(normalizePageIndex(pageIndex) + 1);

  const pageIndexForSourceY = (sourceY: number) => {
    const position = Math.max(0, finiteNumber(sourceY));
    if (position < firstPageSourceHeight) return 0;
    return 1 + Math.floor((position - firstPageSourceHeight) / continuationSourceHeight);
  };

  const pageCountForSourceHeight = (sourceHeight: number) => {
    const height = Math.max(0, finiteNumber(sourceHeight));
    return pageIndexForSourceY(Math.max(0, height - 0.01)) + 1;
  };

  const sidebarStartPageForFinalPage = (sidebarHeight: number, finalPageIndex: number, firstPageSidebarTop = 0) => {
    const requiredHeight = Math.max(0, finiteNumber(sidebarHeight));
    const finalPage = normalizePageIndex(finalPageIndex);
    const firstPageAvailableHeight = Math.max(0, firstPageSourceHeight - Math.max(0, finiteNumber(firstPageSidebarTop)));
    let availableHeight = 0;

    for (let pageIndex = finalPage; pageIndex >= 0; pageIndex -= 1) {
      availableHeight += pageIndex === 0 ? firstPageAvailableHeight : continuationSourceHeight;
      if (availableHeight + 0.01 >= requiredHeight) return pageIndex;
    }

    return 0;
  };

  return {
    firstPageSourceHeight,
    continuationSourceHeight,
    pageStart,
    pageEnd,
    pageIndexForSourceY,
    pageCountForSourceHeight,
    sidebarStartPageForFinalPage,
  };
}

/**
 * Find the latest page where a sidebar can start while guaranteeing that it
 * occupies the final PDF page. The caller measures body reflow after each
 * candidate is applied, keeping DOM concerns outside this geometry helper.
 */
export function resolveLastPageSidebarPlacement({
  geometry,
  sidebarHeight,
  firstPageSidebarTop = 0,
  initialFinalPage = 0,
  measureBodyFinalPage = () => initialFinalPage,
}: SidebarPlacementOptions) {
  const naturalSidebarHeight = Math.max(0, finiteNumber(sidebarHeight));
  const firstSidebarTop = Math.max(0, finiteNumber(firstPageSidebarTop));
  let finalPage = pageIndex(initialFinalPage);

  // Moving the sidebar to a later page can only release body width. This
  // monotonic loop therefore converges once the target reaches the body end.
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const startPage = geometry.sidebarStartPageForFinalPage(
      naturalSidebarHeight,
      finalPage,
      firstSidebarTop,
    );
    const sidebarTop = startPage === 0 ? firstSidebarTop : geometry.pageStart(startPage);
    const sidebarLastPage = geometry.pageIndexForSourceY(
      Math.max(sidebarTop, sidebarTop + naturalSidebarHeight - 0.01),
    );
    const bodyLastPage = pageIndex(measureBodyFinalPage({
      finalPage,
      startPage,
      sidebarLastPage,
    }));
    const nextFinalPage = Math.max(finalPage, sidebarLastPage, bodyLastPage);

    if (nextFinalPage === finalPage) {
      return {
        finalPage,
        startPage,
        sidebarLastPage,
        iterations: iteration + 1,
      };
    }

    finalPage = nextFinalPage;
  }

  throw new Error('Sidebar placement did not converge');
}
