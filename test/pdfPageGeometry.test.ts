import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPdfPageGeometry,
  createPdfPageSlices,
  resolveLastPageSidebarPlacement,
} from '../src/documents/pdf/pdfPageGeometry.ts';

test('slices pages at the existing integer-rounded pixel boundaries', () => {
  const pages = createPdfPageSlices({ width: 703, height: 3000, pageWidth: 210, pageHeight: 297 });

  assert.deepEqual(pages.map(({ sourceTop, sourceBottom }) => [sourceTop, sourceBottom]), [
    [0, 994],
    [994, 1988],
    [1988, 2982],
    [2982, 3000],
  ]);
});

test('slices retain asymmetric margins and only pad continuation pages', () => {
  const pages = createPdfPageSlices({
    width: 760,
    height: 2500,
    pageWidth: 210,
    pageHeight: 297,
    margins: [11, 7, 19, 13],
    continuationTopPadding: 12,
  });

  assert.deepEqual(pages, [
    { sourceTop: 0, sourceBottom: 1068, canvasWidth: 760, contentWidth: 190, leftOffset: 7, topOffset: 11 },
    { sourceTop: 1068, sourceBottom: 2088, canvasWidth: 760, contentWidth: 190, leftOffset: 7, topOffset: 23 },
    { sourceTop: 2088, sourceBottom: 2500, canvasWidth: 760, contentWidth: 190, leftOffset: 7, topOffset: 23 },
  ]);
});

test('suppresses trailing fractional slices up to the rounded 0.75 mm tolerance', () => {
  const options = { width: 840, pageWidth: 210, pageHeight: 297 };

  assert.equal(createPdfPageSlices({ ...options, height: 1190.5 }).length, 1);
  assert.equal(createPdfPageSlices({ ...options, height: 1191 }).length, 1);
  assert.equal(createPdfPageSlices({ ...options, height: 1191.01 }).length, 2);
  assert.equal(createPdfPageSlices({ ...options, height: 3 }).length, 0);
});

test('retains the one-pixel minimum tolerance at low source resolutions', () => {
  const options = { width: 100, pageWidth: 200, pageHeight: 200 };

  assert.equal(createPdfPageSlices({ ...options, height: 101 }).length, 1);
  assert.equal(createPdfPageSlices({ ...options, height: 101.1 }).length, 2);
});

test('clamps continuation padding to leave at least one millimeter of page height', () => {
  const pages = createPdfPageSlices({
    width: 200,
    height: 610,
    pageWidth: 100,
    pageHeight: 300,
    continuationTopPadding: 500,
  });

  assert.deepEqual(pages.map(({ sourceTop, sourceBottom }) => [sourceTop, sourceBottom]), [
    [0, 600], [600, 602], [602, 604], [604, 606], [606, 608],
  ]);
  assert.equal(pages[1].topOffset, 299);
  assert.deepEqual(
    createPdfPageSlices({ width: 200, height: 800, pageWidth: 100, pageHeight: 300, continuationTopPadding: -5 }),
    createPdfPageSlices({ width: 200, height: 800, pageWidth: 100, pageHeight: 300 }),
  );
});

test('rejects source dimensions or margins that leave no usable area', () => {
  const options = { width: 600, height: 1000, pageWidth: 210, pageHeight: 297 };
  for (const invalid of [
    { width: 0 },
    { width: Number.NaN },
    { height: Number.POSITIVE_INFINITY },
    { margins: [0, 110, 0, 100] },
    { margins: [150, 0, 147, 0] },
  ]) {
    assert.throws(() => createPdfPageSlices({ ...options, ...invalid }), /no space for the CV content/);
  }
});

test('maps source coordinates to the first page and padded continuation pages', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 2,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  assert.equal(geometry.firstPageSourceHeight, 594);
  assert.equal(geometry.continuationSourceHeight, 574);
  assert.equal(geometry.pageStart(2), 1168);
  assert.equal(geometry.pageIndexForSourceY(593.9), 0);
  assert.equal(geometry.pageIndexForSourceY(594), 1);
  assert.equal(geometry.pageCountForSourceHeight(1168), 2);
});

test('finds the latest whole page where a sidebar can begin and still end on the final page', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  assert.equal(geometry.sidebarStartPageForFinalPage(200, 2, 80), 2);
  assert.equal(geometry.sidebarStartPageForFinalPage(400, 2, 80), 1);
  assert.equal(geometry.sidebarStartPageForFinalPage(780, 2, 80), 0);
});

test('accounts for the header before placing a sidebar on the cover page', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  assert.equal(geometry.sidebarStartPageForFinalPage(250, 0, 80), 0);
  assert.equal(geometry.sidebarStartPageForFinalPage(217, 0, 80), 0);
});

test('places a short sidebar on the body final page', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 200,
    firstPageSidebarTop: 80,
    initialFinalPage: 2,
    measureBodyFinalPage: () => 2,
  });

  assert.deepEqual(placement, {
    finalPage: 2,
    startPage: 2,
    sidebarLastPage: 2,
    iterations: 1,
  });
});

test('uses only the minimum preceding pages for a multi-page sidebar', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 400,
    firstPageSidebarTop: 80,
    initialFinalPage: 2,
    measureBodyFinalPage: () => 2,
  });

  assert.equal(placement.finalPage, 2);
  assert.equal(placement.startPage, 1);
  assert.equal(placement.sidebarLastPage, 2);
});

test('extends the document with sidebar-only final pages when necessary', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 900,
    firstPageSidebarTop: 80,
    initialFinalPage: 1,
    measureBodyFinalPage: () => 1,
  });

  assert.equal(placement.startPage, 0);
  assert.equal(placement.sidebarLastPage, 3);
  assert.equal(placement.finalPage, 3);
});

test('promotes the final page when a sidebar causes body reflow', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 200,
    firstPageSidebarTop: 80,
    initialFinalPage: 2,
    measureBodyFinalPage: ({ finalPage }) => (finalPage === 2 ? 3 : 2),
  });

  assert.equal(placement.finalPage, 3);
  assert.equal(placement.startPage, 3);
  assert.equal(placement.sidebarLastPage, 3);
  assert.equal(placement.iterations, 2);
});

test('keeps last-page placement correct with margin-reduced pages and continuation padding', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 2.5,
    firstPageHeight: 267,
    continuationTopPadding: 12,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 900,
    firstPageSidebarTop: 120,
    initialFinalPage: 2,
    measureBodyFinalPage: () => 2,
  });

  assert.equal(geometry.firstPageSourceHeight, 667.5);
  assert.equal(geometry.continuationSourceHeight, 637.5);
  assert.equal(placement.startPage, 1);
  assert.equal(placement.sidebarLastPage, 2);
  assert.equal(placement.finalPage, 2);
});
