import { stub } from '../../support/fixtures/cvState';
import test from 'node:test';
import assert from 'node:assert/strict';
import { timelinePageSegments, timelineRailPath, updateTimelineRails } from '../../../src/documents/layout/timelineLayout.ts';
import { createPdfPageGeometry } from '../../../src/documents/pdf/pdfPageGeometry.ts';

test('unpaginated timeline stays continuous through item spacing', () => {
  assert.equal(timelineRailPath([
    { x: 240, top: 10, bottom: 80 },
    { x: 240, top: 130, bottom: 200 },
    { x: 240, top: 500, bottom: 560 },
  ]), 'M 240 560 L 240 500 L 240 130 L 240 10');
});

test('paginated rails stop at the last item on each page without filling page-break whitespace', () => {
  assert.equal(timelineRailPath([
    { x: 10, top: 10, bottom: 80, page: 0 },
    { x: 10, top: 100, bottom: 180, page: 0 },
    { x: 10, top: 520, bottom: 600, page: 1 },
  ]), 'M 10 600 L 10 520 M 10 180 L 10 100 L 10 10');
});

test('timeline follows changes in the item column without crossing the sidebar', () => {
  assert.equal(timelineRailPath([
    { x: 10, top: 10, bottom: 80 },
    { x: 240, top: 130, bottom: 200 },
    { x: 10, top: 250, bottom: 300 },
  ]), 'M 10 300 L 10 250 M 240 200 L 240 130 M 10 80 L 10 10');
});

test('continued entries join on the next page without filling empty space on the previous page', () => {
  const geometry = createPdfPageGeometry({ sourcePixelsPerMillimeter: 1, firstPageHeight: 500, continuationTopPadding: 100 });
  const segments = timelinePageSegments({ x: 10, top: 100, bottom: 650 }, [
    { top: 100, bottom: 120 }, { top: 260, bottom: 280 },
    // Pagination moves the remaining content onto the next page.
    { top: 520, bottom: 550 }, { top: 610, bottom: 640 },
  ], geometry);
  assert.deepEqual(segments, [
    { x: 10, top: 100, bottom: 280, page: 0 },
    { x: 10, top: 520, bottom: 650, page: 1 },
  ]);
  assert.equal(timelineRailPath([...segments, { x: 10, top: 690, bottom: 750, page: 1 }]),
    'M 10 750 L 10 690 L 10 520 M 10 280 L 10 100');
});

test('empty continuation pages and trailing pagination space never create rail segments', () => {
  const geometry = createPdfPageGeometry({ sourcePixelsPerMillimeter: 1, firstPageHeight: 500 });
  assert.deepEqual(timelinePageSegments({ x: 10, top: 100, bottom: 1600 }, [
    { top: 100, bottom: 180 }, { top: 1100, bottom: 1200 },
  ], geometry), [
    { x: 10, top: 100, bottom: 180, page: 0 },
    { x: 10, top: 1100, bottom: 1200, page: 2 },
  ]);
});

test('empty timelines have no rail', () => {
  assert.equal(timelineRailPath([]), '');
});

test('rail geometry uses final title positions, not the full-width timeline wrapper', () => {
  const attributes: Record<string, string> = {};
  let writes = 0;
  const getAttribute = (key: string) => attributes[key] ?? null;
  const path = { getAttribute, setAttribute: (key: string, value: string) => { attributes[key] = value; writes++; } };
  const item = (left: number, top: number, bottom: number) => ({
    querySelector: () => ({ getBoundingClientRect: () => ({ left, top, height: 20 }) }),
    querySelectorAll: () => [],
    ownerDocument: {
      createTreeWalker: () => {
        let visited = false;
        return { currentNode: { textContent: 'Entry content' }, nextNode: () => visited ? null : (visited = true) };
      },
      createRange: () => ({ selectNodeContents() {}, getClientRects: () => [
        { top, bottom: top + 20, width: 100, height: 20 },
        { top: bottom - 20, bottom, width: 100, height: 20 },
      ] }),
    },
    getBoundingClientRect: () => ({ bottom }),
  });
  const items = [item(320, 200, 260), item(320, 450, 530)];
  const rail = {
    getAttribute,
    style: { top: '', width: '', height: '' },
    parentElement: {
      getBoundingClientRect: () => ({ left: 40, top: 100, width: 700, height: 450 }),
      querySelectorAll: () => items,
    },
    setAttribute: (key: string, value: string) => { attributes[key] = value; writes++; },
    querySelector: () => path,
  };
  const root = {
    getBoundingClientRect: () => ({ top: 0 }),
    ownerDocument: { documentElement: { getAttribute: () => null }, defaultView: { getComputedStyle: () => ({ left: '-22px', width: '16px' }) } },
    querySelectorAll: () => [rail],
  };
  updateTimelineRails(stub<HTMLElement>(root));
  assert.deepEqual(attributes, { preserveAspectRatio: 'none', width: '700', height: '324', viewBox: '0 108 700 324', d: 'M 266 430 L 266 360 L 266 110' });
  assert.equal(rail.style.top, '108px');
  const initialWrites = writes;
  updateTimelineRails(stub<HTMLElement>(root));
  assert.equal(writes, initialWrites, 'unchanged geometry must not mutate the DOM');
  updateTimelineRails(stub<HTMLElement>(root), 400);
  assert.equal(attributes.d, 'M 266 430 L 266 360 M 266 160 L 266 110', 'each page ends at its own last item bottom');
  // Pagination whitespace above the entries moves the SVG, without shifting its
  // endpoints relative to the entries or stretching it to the section height.
  items.splice(0, 2, item(320, 700, 760), item(320, 950, 1030));
  updateTimelineRails(stub<HTMLElement>(root));
  assert.equal(rail.style.top, '608px');
  assert.equal(attributes.height, '324');
  assert.equal(attributes.d, 'M 266 930 L 266 860 L 266 610');
  // Mirroring the sidebar or resizing a column must not retain cached geometry.
  items.splice(0, 2, item(80, 200, 260), item(80, 450, 530));
  updateTimelineRails(stub<HTMLElement>(root));
  assert.equal(attributes.d, 'M 26 430 L 26 360 L 26 110');
  // The painting iframe can resolve a taller final item than the first snapshot.
  // Its copied inline height must grow together with the path and SVG viewBox.
  items.splice(0, 2, item(80, 200, 260), item(80, 450, 610));
  updateTimelineRails(stub<HTMLElement>(root), 400);
  assert.equal(attributes.d, 'M 26 510 L 26 360 M 26 160 L 26 110');
  assert.equal(attributes.height, '404');
  assert.equal(rail.style.height, '404px');
  assert.equal(rail.style.width, '700px');
  const geometry = createPdfPageGeometry({ sourcePixelsPerMillimeter: 1, firstPageHeight: 300, continuationTopPadding: 100 });
  items.splice(0, 2, item(80, 450, 490), item(80, 510, 590));
  updateTimelineRails(stub<HTMLElement>(root), geometry);
  assert.equal(attributes.d, 'M 26 490 L 26 420 M 26 390 L 26 360', 'continued page segments use the same page boundaries as export');
  items.splice(0, 2, item(80, 250, 550), item(80, 580, 650));
  updateTimelineRails(stub<HTMLElement>(root), geometry);
  assert.equal(attributes.d, 'M 26 550 L 26 490 L 26 430 M 26 170 L 26 160', 'a continued entry connects on its final page and stops at visible content on the earlier page');
  items.splice(0, 2, item(80, 250, 500), item(80, 580, 650));
  updateTimelineRails(stub<HTMLElement>(root), geometry);
  assert.equal(attributes.d, 'M 26 550 L 26 490 M 26 400 L 26 380 M 26 170 L 26 160', 'an entry ending exactly at a page boundary does not join the next page');
});

test('disabled timelines do not measure layout or write SVG attributes', () => {
  updateTimelineRails(stub<HTMLElement>({
    ownerDocument: { documentElement: { getAttribute: () => 'false' } },
    querySelectorAll() { throw new Error('Hidden timelines should not be traversed'); },
  }));
});
