import { createPdfRenderTask } from '../src/documents/pdf/pdfRenderTask';
import type { VectorSnapshot, TextRecord, GraphicsState } from '../src/documents/pdf/pdfTypes';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { renderVectorPdf } from '../src/documents/pdf/pdfVectorExport.ts';
import { vectorTextIntersectsPage } from '../src/documents/pdf/pdfVectorText.ts';

const page = { sourceTop: 0, sourceBottom: 100, canvasWidth: 100, contentWidth: 100, leftOffset: 10, topOffset: 10 };
const task = createPdfRenderTask();
const fixture = (overrides: Partial<VectorSnapshot> = {}): VectorSnapshot => ({
  recording: { records: [] }, canvas: { width: 100, height: 200 }, pages: [page],
  links: undefined, fontStyleUrls: [], pageWidth: 210, pageHeight: 297, task, ...overrides,
});
const textRecord = (text = 'A', x = 10, y = 20): TextRecord => ({
  type: 'call', method: 'fillText', args: [text, x, y], font: { size: 12, family: 'Inter', weight: 400, style: 'normal' }, fontString: '12px Inter',
  metrics: { width: 12, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 },
});

function pdfStreams(bytes: Buffer) {
  const pdf = bytes.toString('latin1');
  return [...pdf.matchAll(/<<([^<>]*)>>\s*stream\r?\n/g)].map((match) => {
    const dictionary = match[1];
    const length = Number(dictionary.match(/\/Length\s+(\d+)\b/)?.[1]);
    const start = match.index + match[0].length;
    const stream = bytes.subarray(start, start + length);
    return (/\/FlateDecode\b/.test(dictionary) ? inflateSync(stream) : stream).toString('latin1');
  });
}

test('an empty vector export produces a valid single blank PDF page', async () => {
  const blob = await renderVectorPdf(fixture({ pages: [] }));
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.equal(blob.type, 'application/pdf');
  assert.match(pdf, /^%PDF-/);
  assert.equal([...pdf.matchAll(/\/Type \/Page\b/g)].length, 1);
  assert.equal(pdf.includes('/Subtype /Image'), false);
});

test('unsupported recorded graphics reject export without hanging its output collector', { timeout: 2000 }, async () => {
  await assert.rejects(renderVectorPdf(fixture({
    recording: { records: [{ type: 'call', method: 'unsupportedPaint', args: [] }] },
  })), /Unsupported vector canvas operation: unsupportedPaint/);
});

test('text intersection excludes fully clipped and transparent text from the page', () => {
  const state: Pick<GraphicsState, 'matrix' | 'globalAlpha' | 'textAlign' | 'direction'> = { textAlign: 'start', direction: 'inherit', matrix: [1, 0, 0, 1, 0, 0], globalAlpha: 1 };
  assert.equal(vectorTextIntersectsPage(textRecord(), state, page), true);
  for (const [x, y] of [[-12, 20], [100, 20], [10, -2], [10, 110]]) {
    assert.equal(vectorTextIntersectsPage(textRecord('A', x, y), state, page), false, `text at ${x}, ${y}`);
  }
  assert.equal(vectorTextIntersectsPage(textRecord(), { ...state, globalAlpha: 0 }, page), false);
  assert.equal(vectorTextIntersectsPage(textRecord('A', 10, 99), state, page), true);
});

test('text intersection uses the active scale and transform before choosing a page', () => {
  const state: Pick<GraphicsState, 'matrix' | 'globalAlpha' | 'textAlign' | 'direction'> = { textAlign: 'start', direction: 'inherit', matrix: [2, 0, 0, 3, 5, 120], globalAlpha: 1 };
  const text = textRecord('A', 10, 20);
  assert.equal(vectorTextIntersectsPage(text, state, page), false);
  assert.equal(vectorTextIntersectsPage(text, state, { ...page, sourceTop: 100, sourceBottom: 200 }), true);
  assert.equal(vectorTextIntersectsPage(text, { ...state, matrix: [2, 0, 0, 3, 100, 120] }, { ...page, sourceTop: 100, sourceBottom: 200 }), false);
});

test('embeds visible selectable font text only on its own page and retains clickable links', async (t) => {
  const font = readFileSync(new URL('./fixtures/Inter-Regular.ttf', import.meta.url));
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(url.endsWith('.css')
    ? "@font-face { font-family: Inter; font-weight: 400; src: url('./inter.ttf'); }"
    : font));
  const blob = await renderVectorPdf(fixture({
    recording: { records: [textRecord('A', 10, 20), textRecord('B', 10, 120)] },
    pages: [page, { ...page, sourceTop: 100, sourceBottom: 200 }],
    fontStyleUrls: ['https://vector.example.test/fonts.css'],
    links: { width: 100, height: 200, links: [{ x: 10, y: 10, width: 12, height: 12, href: 'https://example.com/resume' }] },
  }));
  const bytes = Buffer.from(await blob.arrayBuffer());
  const pdf = bytes.toString('latin1');
  const paint = pdfStreams(bytes).filter((stream) => /\bBT\b/.test(stream));
  assert.equal([...pdf.matchAll(/\/Type \/Page\b/g)].length, 2);
  assert.equal(paint.length, 2);
  for (const stream of paint) {
    assert.equal([...stream.matchAll(/\bBT\b/g)].length, 1, 'off-page text is not duplicated in this page');
    assert.doesNotMatch(stream, /\b3\s+Tr\b/, 'text must not use invisible rendering mode');
    assert.match(stream, /\bTJ\b/, 'real font glyphs are emitted');
  }
  assert.match(pdf, /\/ToUnicode\b/);
  assert.match(pdf, /\/FontFile2\b/);
  assert.match(pdf, /\/Subtype \/Link\b/);
  assert.match(pdf, /https:\/\/example\.com\/resume/);
  assert.equal(pdf.includes('/Subtype /Image'), false);
});

test('PDF footers repeat selectable contact text and link annotations on every page', async (t) => {
  const font = readFileSync(new URL('./fixtures/Inter-Regular.ttf', import.meta.url));
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(url.endsWith('.css')
    ? "@font-face { font-family: Inter; font-weight: 400; src: url('./inter.ttf'); }"
    : font));
  const blob = await renderVectorPdf(fixture({
    recording: { records: [textRecord('A', 10, 20), textRecord('B', 10, 120)] },
    pages: [page, { ...page, sourceTop: 100, sourceBottom: 200 }],
    fontStyleUrls: ['https://vector.example.test/fonts.css'],
    footer: {
      recording: { records: [textRecord('Contact', 10, 12)] }, canvas: { width: 100, height: 20 },
      page: { ...page, sourceTop: 0, sourceBottom: 20, topOffset: 260 },
      links: { width: 100, height: 20, links: [{ href: 'mailto:contact@example.com', x: 10, y: 2, width: 40, height: 12 }] },
    },
  }));
  const bytes = Buffer.from(await blob.arrayBuffer());
  const pdf = bytes.toString('latin1');
  const paint = pdfStreams(bytes).filter((stream) => /\bBT\b/.test(stream));
  assert.equal(paint.length, 2);
  for (const stream of paint) assert.equal([...stream.matchAll(/\bBT\b/g)].length, 2, 'one body text run and one footer run per page');
  assert.equal([...pdf.matchAll(/mailto:contact@example.com/g)].length, 2);
  assert.equal(pdf.includes('/Subtype /Image'), false);
});
