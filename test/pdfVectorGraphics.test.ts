import type { VectorDocument } from '../src/documents/pdf/pdfTypes';
import { stub } from './helpers';
import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { createVectorGraphicsContext, multiplyCanvasMatrices, transformCanvasPoint, parseCanvasColor } from '../src/documents/pdf/pdfVectorGraphics.ts';

function fixture() {
  const calls: { method: PropertyKey; args: any[] }[] = [];
  const doc = new Proxy({}, { get: (_, method) => (...args: unknown[]) => { calls.push({ method, args }); return doc; } });
  const graphics = createVectorGraphicsContext(stub<VectorDocument>(doc));
  return { calls, graphics, call: (method: string, ...args: unknown[]) => graphics.apply({ type: 'call', method, args }) };
}

test('composes canvas transforms in canvas order', () => {
  const matrix = multiplyCanvasMatrices([2, 0, 0, 3, 0, 0], [1, 0, 0, 1, 10, 20]);
  assert.deepEqual(transformCanvasPoint(matrix, 4, 5), [28, 75]);
});

test('keeps path geometry from creation time when the paint transform changes', () => {
  const { call, calls } = fixture();
  call('translate', 10, 20);
  call('rect', 0, 0, 5, 6);
  call('resetTransform');
  call('fill');
  call('stroke');
  assert.deepEqual(calls.filter(({ method }) => method === 'moveTo'), [
    { method: 'moveTo', args: [10, 20] }, { method: 'moveTo', args: [10, 20] },
  ]);
  assert.ok(calls.some(({ method, args }) => method === 'lineTo' && args[0] === 15 && args[1] === 26));
});

test('save and restore keep clipping and styles scoped without restoring the current path', () => {
  const { call, calls, graphics } = fixture();
  call('save');
  graphics.apply({ type: 'set', property: 'globalAlpha', value: 0.4 });
  call('translate', 10, 0);
  call('rect', 1, 2, 3, 4);
  call('clip', 'evenodd');
  call('restore');
  assert.deepEqual(graphics.state.matrix, [1, 0, 0, 1, 0, 0]);
  assert.equal(graphics.state.globalAlpha, 1);
  call('fill');
  assert.deepEqual(calls.filter(({ method }) => method === 'moveTo').map(({ args }) => args), [[11, 2], [11, 2]]);
  assert.deepEqual(calls.find(({ method }) => method === 'clip')!.args, ['even-odd']);
});

test('circles become continuous cubic vector curves', () => {
  const { call, calls } = fixture();
  call('arc', 10, 20, 5, 0, Math.PI * 2);
  call('fill');
  const curves = calls.filter(({ method }) => method === 'bezierCurveTo');
  assert.equal(curves.length, 4);
  assert.deepEqual(calls.find(({ method }) => method === 'moveTo')!.args, [15, 20]);
  assert.ok(Math.abs(curves.at(-1)!.args[4] - 15) < 1e-10);
  assert.ok(Math.abs(curves.at(-1)!.args[5] - 20) < 1e-10);
});

test('converts quadratic curves into true cubic PDF curves', () => {
  const { call, calls } = fixture();
  call('moveTo', 0, 0);
  call('quadraticCurveTo', 3, 6, 9, 0);
  call('stroke');
  assert.deepEqual(calls.find(({ method }) => method === 'bezierCurveTo')!.args, [2, 4, 5, 4, 9, 0]);
});

test('multiplies CSS alpha by canvas opacity and preserves dotted strokes', () => {
  const { call, calls, graphics } = fixture();
  graphics.apply({ type: 'set', property: 'fillStyle', value: 'rgba(10, 20, 30, 0.25)' });
  graphics.apply({ type: 'set', property: 'globalAlpha', value: 0.5 });
  call('setLineDash', [0, 3]);
  call('strokeRect', 0, 0, 5, 5);
  assert.deepEqual(calls.find(({ method }) => method === 'fillOpacity')!.args, [0.125]);
  assert.deepEqual(calls.find(({ method }) => method === 'addContent')!.args, ['[0 3] 0 d']);
  assert.deepEqual(parseCanvasColor('rgba(100% 0% 0% / 20%)'), { color: [255, 0, 0], opacity: 0.2 });
});

test('fails explicitly for unsupported paints instead of silently rasterizing the page', () => {
  const { call, graphics } = fixture();
  graphics.apply({ type: 'set', property: 'fillStyle', value: {} });
  assert.throws(() => call('fillRect', 0, 0, 10, 10), /gradients or patterns/);
  assert.throws(() => call('drawImage', { src: 'https://example.com/photo.webp', width: 10, height: 10 }, 0, 0), /requires SVG/);
});

test('embeds SVG icons as vector paths, including cropped and transformed images', async () => {
  const doc = new PDFDocument({ size: [100, 100], margin: 0, compress: false });
  const chunks: Buffer[] = [];
  const output = new Promise<string>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    doc.on('error', reject);
  });
  const graphics = createVectorGraphicsContext(stub<VectorDocument>(doc));
  const originalMatrix = [...stub<{ _ctm: number[] }>(doc)._ctm];
  graphics.apply({ type: 'set', property: 'globalAlpha', value: 0.6 });
  graphics.apply({ type: 'call', method: 'translate', args: [5, 8] });
  graphics.apply({ type: 'call', method: 'drawImage', args: [{
    src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path fill="#123456" d="M0 0 L20 0 L20 10 Z"/></svg>')}`,
    width: 20,
    height: 10,
  }, 2, 1, 10, 5, 30, 40, 20, 10] });
  assert.deepEqual(stub<{ _ctm: number[] }>(doc)._ctm, originalMatrix);
  assert.equal(stub<{ _ctmStack: unknown[] }>(doc)._ctmStack.length, 0);
  doc.end();
  const pdf = await output;
  assert.equal(pdf.includes('/Subtype /Image'), false);
  assert.ok(pdf.includes('30 40 20 10 re'));
  assert.ok(pdf.includes('/ca 0.6'));
});

test('painting exceptions restore document graphics state', () => {
  const { calls, graphics } = fixture();
  assert.throws(() => graphics.withPaint(() => { throw new Error('Font unavailable'); }), /Font unavailable/);
  assert.equal(calls.at(-1)!.method, 'restore');
});

test('SVG root margins shift vector content inside the unchanged image crop', async () => {
  const doc = new PDFDocument({ size: [100, 100], margin: 0, compress: false });
  const chunks: Buffer[] = [];
  const output = new Promise<string>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    doc.on('error', reject);
  });
  const graphics = createVectorGraphicsContext(stub<VectorDocument>(doc));
  graphics.apply({ type: 'call', method: 'drawImage', args: [{
    src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22px" height="12px" viewBox="0 0 384 512" style="margin: 0 0 0 8px; margin-top: 3px; margin-inline: 8px 0; width: 22px; height: 12px;"><path d="M0 0 L384 0 L384 512 Z"/></svg>')}`,
    width: 22,
    height: 12,
  }, 0, 0, 22, 12, 30, 40, 22, 12] });
  doc.end();
  const pdf = await output;
  assert.ok(pdf.includes('30 40 22 12 re\nW n'));
  assert.ok(pdf.includes('1 0 0 1 8 3 cm'));
  assert.equal(pdf.includes('/Subtype /Image'), false);
});

test('finish unwinds outstanding canvas effects without restoring caller-owned page state', () => {
  const doc = new PDFDocument({ size: [100, 100], margin: 0 });
  doc.save().translate(12, 15).scale(0.25);
  const pageMatrix = [...stub<{ _ctm: number[] }>(doc)._ctm];
  const pageDepth = stub<{ _ctmStack: unknown[] }>(doc)._ctmStack.length;
  const graphics = createVectorGraphicsContext(stub<VectorDocument>(doc));
  graphics.apply({ type: 'call', method: 'save', args: [] });
  graphics.apply({ type: 'set', property: 'globalAlpha', value: 0.5 });
  graphics.apply({ type: 'call', method: 'save', args: [] });
  graphics.apply({ type: 'call', method: 'translate', args: [30, 50] });
  graphics.apply({ type: 'call', method: 'rect', args: [0, 0, 10, 10] });
  graphics.apply({ type: 'call', method: 'clip', args: [] });
  assert.equal(stub<{ _ctmStack: unknown[] }>(doc)._ctmStack.length, pageDepth + 2);
  graphics.finish();
  assert.equal(stub<{ _ctmStack: unknown[] }>(doc)._ctmStack.length, pageDepth);
  assert.deepEqual(stub<{ _ctm: number[] }>(doc)._ctm, pageMatrix);
  assert.equal(graphics.state.globalAlpha, 1);
  assert.deepEqual(graphics.state.matrix, [1, 0, 0, 1, 0, 0]);
  graphics.finish();
  assert.equal(stub<{ _ctmStack: unknown[] }>(doc)._ctmStack.length, pageDepth);
  doc.restore();
  assert.equal(stub<{ _ctmStack: unknown[] }>(doc)._ctmStack.length, 0);
  doc.end();
});
