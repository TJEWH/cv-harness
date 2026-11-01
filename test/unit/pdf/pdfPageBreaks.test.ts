import { stub } from '../../support/fixtures/cvState';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPdfPageBreaks } from '../../../src/documents/pdf/pdfPageBreaks.ts';
import { createPdfPageGeometry } from '../../../src/documents/pdf/pdfPageGeometry.ts';

function fixture(style: Partial<CSSStyleDeclaration>, top: number, bottom: number) {
  const inserted: { height: string; before: unknown }[] = [];
  const element = { getBoundingClientRect: () => ({ top: top + 50, bottom: bottom + 50 }), parentNode: { insertBefore: (node: { style: { cssText: string } }, before: unknown) => inserted.push({ height: node.style.cssText, before }) }, nextSibling: null };
  const root = { getBoundingClientRect: () => ({ top: 50 }), querySelectorAll: () => [element], ownerDocument: { defaultView: { getComputedStyle: () => style }, createElement: () => ({ style: {} }) } };
  return { root: stub<HTMLElement>(root), inserted, element };
}

test('locked items crossing a boundary are moved using root-relative coordinates', async () => {
  const { root, inserted, element } = fixture({ breakInside: 'avoid' }, 90, 130);
  await applyPdfPageBreaks(root, 100, { checkpoint() { return undefined; } });
  assert.deepEqual(inserted, [{ height: 'display:block;height:10px', before: element }]);
});

test('items larger than a page remain breakable and cancellation propagates', async () => {
  const { root, inserted } = fixture({ breakInside: 'avoid-page' }, 90, 250);
  await applyPdfPageBreaks(root, 100, { checkpoint() { return undefined; } });
  assert.deepEqual(inserted, []);
  await assert.rejects(applyPdfPageBreaks(root, 100, { checkpoint() { throw new Error('Canceled'); } }), /Canceled/);
});

test('explicit CSS breaks insert spacing without changing original content', async () => {
  const { root, inserted } = fixture({ breakAfter: 'page' }, 20, 40);
  await applyPdfPageBreaks(root, 100, { checkpoint() { return undefined; } });
  assert.deepEqual(inserted, [{ height: 'display:block;height:60px', before: null }]);
});

test('layout changes are synchronized immediately after inserting a spacer', async () => {
  const { root, inserted } = fixture({ breakBefore: 'page', breakAfter: 'page' }, 20, 40);
  const counts: number[] = [];
  await applyPdfPageBreaks(root, 100, { checkpoint() { return undefined; } }, () => counts.push(inserted.length));
  assert.deepEqual(counts, [1, 2]);
});

test('continuation items use the shorter exported page height after top padding', async () => {
  const { root, inserted, element } = fixture({ breakInside: 'avoid' }, 175, 195);
  const geometry = createPdfPageGeometry({ sourcePixelsPerMillimeter: 1, firstPageHeight: 100, continuationTopPadding: 20 });
  await applyPdfPageBreaks(root, geometry, { checkpoint() { return undefined; } });
  assert.deepEqual(inserted, [{ height: 'display:block;height:5px', before: element }], 'the second page ends at 180, not 200');
});

test('an item ending exactly at a page boundary is not pushed onto the next page', async () => {
  const { root, inserted } = fixture({ breakInside: 'avoid' }, 60, 100);
  await applyPdfPageBreaks(root, 100, { checkpoint() { return undefined; } });
  assert.deepEqual(inserted, []);
});
