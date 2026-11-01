import type { CallRecord, TextRecord } from '../../../src/documents/pdf/pdfTypes';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSvgDocument, renderVectorPreview } from '../../../src/documents/pdf/pdfVectorPreview.ts';

const call = (method: string, ...args: unknown[]): CallRecord => ({ type: 'call', method, args });
const text = (value: string, y: number): TextRecord => ({ ...call('fillText', value, 10, y), font: { family: 'Inter', size: 12, weight: 400, style: 'normal' }, metrics: { width: 40, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 } });
const page = { sourceTop: 0, sourceBottom: 100, canvasWidth: 100, contentWidth: 180, leftOffset: 10, topOffset: 12 };
const task = { checkpoint() { return undefined; } };

test('previews contain visible vector text and paths, never a bitmap or foreign HTML', async () => {
  const { pages } = await renderVectorPreview({
    recording: { records: [call('fillRect', 0, 0, 100, 200), text('Hello <script>&"', 20), text('Page two', 120)] },
    canvas: { width: 100, height: 200 }, pages: [page, { ...page, sourceTop: 100, sourceBottom: 200 }],
    pageWidth: 210, pageHeight: 297, task,
  });
  assert.equal(pages.length, 2);
  assert.match(pages[0].svg, /<svg[^>]*viewBox="0 0 210 297"/);
  assert.match(pages[0].svg, /<path /);
  assert.match(pages[0].svg, /Hello &lt;script&gt;&amp;&quot;/);
  assert.doesNotMatch(pages[0].svg, /Page two/);
  assert.match(pages[1].svg, /Page two/);
  assert.doesNotMatch(pages[1].svg, /Hello/);
  for (const { svg } of pages) assert.doesNotMatch(svg, /<image|<canvas|<foreignObject|data:image|<script/);
});

test('SVG clipping IDs are unique between renders and links retain page geometry', async () => {
  const input = { recording: { records: [] }, canvas: { width: 100, height: 100 }, pages: [page], pageWidth: 210, pageHeight: 297, task,
    links: { width: 100, height: 100, links: [{ x: 10, y: 10, width: 20, height: 10, href: 'https://example.com/?a=1&b=2' }] } };
  const first = (await renderVectorPreview(input)).pages[0].svg;
  const second = (await renderVectorPreview(input)).pages[0].svg;
  assert.notEqual(first.match(/id="([^"]+)"/)![1], second.match(/id="([^"]+)"/)![1]);
  assert.match(first, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(first, /x="28" y="30" width="36" height="18"/);
});

test('SVG target scopes clipping, transforms, opacity and line dashes with save/restore', () => {
  const doc = createSvgDocument('test');
  doc.save().translate(10, 20).rect(0, 0, 5, 5).clip();
  doc.fillColor([17, 24, 39]).fillOpacity(.5).rect(0, 0, 2, 2).fill();
  doc.restore().strokeColor('#123456').lineWidth(2).addContent('[2 3] 1 d').moveTo(0, 0).lineTo(5, 5).stroke();
  const svg = doc.output(100, 100);
  assert.match(svg, /fill="rgb\(17,24,39\)" fill-opacity="0.5"/);
  assert.match(svg, /transform="matrix\(1 0 0 1 10 20\)"/);
  assert.match(svg, /<\/g><path[^>]*transform="matrix\(1 0 0 1 0 0\)"/);
  assert.match(svg, /stroke-dasharray="2 3" stroke-dashoffset="1"/);
});

test('contact footer text and links repeat outside the body clip on every preview page', async () => {
  const { pages } = await renderVectorPreview({
    recording: { records: [text('Body one', 20), text('Body two', 120)] },
    canvas: { width: 100, height: 200 }, pages: [page, { ...page, sourceTop: 100, sourceBottom: 200 }],
    footer: {
      recording: { records: [text('contact@example.com', 12)] },
      canvas: { width: 100, height: 20 },
      page: { ...page, sourceTop: 0, sourceBottom: 20, topOffset: 250 },
      links: { width: 100, height: 20, links: [{ href: 'mailto:contact@example.com', x: 10, y: 2, width: 40, height: 12 }] },
    },
    pageWidth: 210, pageHeight: 297, task,
  });
  assert.equal(pages.length, 2);
  for (const { svg } of pages) {
    assert.match(svg, />contact@example.com<\/text>/);
    assert.match(svg, /transform="matrix\(1.8 0 0 1.8 10 250\)"/);
    assert.match(svg, /href="mailto:contact@example.com"/);
    assert.match(svg, /x="28" y="253.6"/);
  }
  assert.doesNotMatch(pages[0].svg, /Body two/);
  assert.doesNotMatch(pages[1].svg, /Body one/);
});
