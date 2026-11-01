import assert from 'node:assert/strict';
import test from 'node:test';
import { scopePreviewSvgIds } from '../../../src/documents/pdf/previewSvgIds';
import { createSvgDocument } from '../../../src/documents/pdf/pdfVectorPreview';

test('simultaneous previews resolve timeline and page clipping inside their own SVG', () => {
  const doc = createSvgDocument('page');
  doc.rect(0, 10, 100, 80).clip().moveTo(5, 0).lineTo(5, 150).stroke();
  const source = doc.output(100, 100);
  const inline = scopePreviewSvgIds(source, 'inline');
  const full = scopePreviewSvgIds(source, 'full');
  assert.match(inline, /id="inline-page-clip-0"/);
  assert.match(full, /id="full-page-clip-0"/);
  assert.match(full, /clip-path="url\(#full-page-clip-0\)"/);
  assert.doesNotMatch(full, /url\(#page-clip-0\)/);
  assert.equal(full.replaceAll('full-page-clip-0', 'page-clip-0'), source, 'page geometry and paint remain unchanged');
});

test('local SVG references follow renamed definitions while external links and colors remain unchanged', () => {
  const source = `<svg><defs><path id='marker'/><mask id="mask"/></defs><use href='#marker'/><use xlink:href="#marker"/><path mask="url(#mask)" fill="#abcdef"/><a href="https://example.com/#marker">Link</a></svg>`;
  const result = scopePreviewSvgIds(source, 'view');
  assert.match(result, /href='#view-marker'/);
  assert.match(result, /xlink:href="#view-marker"/);
  assert.match(result, /mask="url\(#view-mask\)"/);
  assert.match(result, /fill="#abcdef"/);
  assert.match(result, /href="https:\/\/example.com\/#marker"/);
  assert.equal(scopePreviewSvgIds('', 'empty'), '');
});
