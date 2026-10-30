import type { CallRecord } from '../src/documents/pdf/pdfTypes';
import { stub } from './helpers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfCanvasRecording } from '../src/documents/pdf/pdfCanvasRecording.ts';

function nativeContext() {
  const calls: { method: string; args: unknown[] }[] = [];
  const context = {
    canvas: {} as { ownerDocument?: unknown },
    font: '10px sans-serif',
    lineWidth: 1,
    fillStyle: '#000000',
    measureText(text: string) {
      assert.equal(this, context);
      return { width: text.length * 6 };
    },
  };
  for (const method of ['save', 'restore', 'scale', 'translate', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'fillText', 'strokeText', 'drawImage', 'setLineDash']) {
    Reflect.set(context, method, function (this: typeof context, ...args: unknown[]) {
      assert.equal(this, context);
      calls.push({ method, args });
      return `${method}-result`;
    });
  }
  return { context: stub<CanvasRenderingContext2D>(context), calls };
}

test('records paint order without executing native drawing or allocating a page bitmap', () => {
  const { context, calls } = nativeContext();
  const recording = createPdfCanvasRecording();
  const proxy = recording.wrap(context);
  assert.equal(proxy.scale(3, 3), undefined);
  proxy.translate(-10, -20);
  proxy.fillStyle = '#123456';
  proxy.save();
  proxy.beginPath();
  proxy.moveTo(1, 2);
  proxy.lineTo(3, 4);
  proxy.stroke();
  proxy.restore();

  assert.deepEqual(recording.records, [
    { type: 'call', method: 'scale', args: [3, 3] },
    { type: 'call', method: 'translate', args: [-10, -20] },
    { type: 'set', property: 'fillStyle', value: '#123456' },
    ...['save', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'restore'].map((method) => ({ type: 'call', method, args: method === 'moveTo' ? [1, 2] : method === 'lineTo' ? [3, 4] : [] })),
  ]);
  assert.equal(context.fillStyle, '#123456');
  assert.equal(proxy.canvas, context.canvas);
  assert.equal(recording.wrap(context), proxy);
  assert.deepEqual(calls.map(({ method }) => method), ['save', 'restore']);
});

test('font measurements remain native and are not recorded', () => {
  const { context } = nativeContext();
  const recording = createPdfCanvasRecording();
  const proxy = recording.wrap(context);
  assert.deepEqual(proxy.measureText('four'), { width: 24 });
  assert.equal(recording.records.length, 0);
});

test('records normalized accepted property values, including ignored invalid assignments', () => {
  const { context } = nativeContext();
  let width = 1;
  Object.defineProperty(context, 'lineWidth', {
    get: () => width,
    set: (value) => { if (value > 0) width = value; },
  });
  const recording = createPdfCanvasRecording();
  const proxy = recording.wrap(context);
  proxy.lineWidth = 2;
  proxy.lineWidth = 0;
  assert.deepEqual(recording.records.map((record) => record.type === 'set' ? record.value : undefined), [2, 2]);
});

test('text operations retain exact coordinates and cache normalized font descriptors', () => {
  const { context } = nativeContext();
  const recording = createPdfCanvasRecording();
  const proxy = recording.wrap(context);
  proxy.font = 'italic 600 14.5px "Source Sans 3", sans-serif';
  proxy.fillText('Hello', 10.25, 23.5);
  proxy.strokeText('World', 15, 24, 100);

  const descriptor = { family: '"Source Sans 3", sans-serif', size: 14.5, weight: 600, style: 'italic' };
  assert.deepEqual(recording.records[1], {
    type: 'call', method: 'fillText', args: ['Hello', 10.25, 23.5], font: descriptor,
    fontString: 'italic 600 14.5px "Source Sans 3", sans-serif',
    metrics: { width: 30, actualBoundingBoxAscent: undefined, actualBoundingBoxDescent: undefined },
  });
  assert.deepEqual(stub<CallRecord>(recording.records[2]).args, ['World', 15, 24, 100]);
  assert.equal(stub<CallRecord>(recording.records[1]).font, stub<CallRecord>(recording.records[2]).font);
});

test('captures browser text width and ink bounds without changing them', () => {
  const { context } = nativeContext();
  const metrics = { width: 31.875, actualBoundingBoxAscent: 10.25, actualBoundingBoxDescent: 2.5 };
  context.measureText = function (text) {
    assert.equal(this, context);
    assert.equal(text, 'Sample');
    return stub<TextMetrics>(metrics);
  };
  const recording = createPdfCanvasRecording();
  recording.wrap(context).fillText('Sample', 0, 10);
  assert.deepEqual(stub<CallRecord>(recording.records[0]).metrics, metrics);
  assert.notEqual(stub<CallRecord>(recording.records[0]).metrics, metrics);
});

test('uses the canvas document CSS declaration to resolve a normalized font', () => {
  const { context } = nativeContext();
  const declaration = { font: '', fontFamily: 'Inter, sans-serif', fontSize: '16px', fontWeight: 'bold', fontStyle: 'normal' };
  Object.defineProperty(context.canvas, 'ownerDocument', { value: { createElement: () => ({ style: declaration }) } });
  const recording = createPdfCanvasRecording();
  const proxy = recording.wrap(context);
  proxy.font = '700 16px Inter, sans-serif';
  proxy.fillText('Title', 0, 16);
  assert.equal(declaration.font, context.font);
  assert.deepEqual(stub<CallRecord>(recording.records[1]).font, { family: 'Inter, sans-serif', size: 16, weight: 700, style: 'normal' });
});

test('snapshots mutable argument arrays without copying SVG image objects', () => {
  const { context } = nativeContext();
  const recording = createPdfCanvasRecording();
  const proxy = recording.wrap(context);
  const dashes = [2, 3];
  const image = { src: 'data:image/svg+xml,<svg/>' };
  proxy.setLineDash(dashes);
  proxy.drawImage(stub<HTMLImageElement>(image), 0, 0, 20, 20, 1, 2, 10, 10);
  dashes.push(4);
  assert.deepEqual(stub<CallRecord>(recording.records[0]).args, [[2, 3]]);
  assert.equal(stub<CallRecord>(recording.records[1]).args[0], image);
});

test('never calls a native paint method even if that method would fail', () => {
  const { context } = nativeContext();
  context.fill = () => { throw new Error('Native failure'); };
  const recording = createPdfCanvasRecording();
  const proxy = recording.wrap(context);
  assert.doesNotThrow(() => proxy.fill());
  assert.deepEqual(recording.records, [{ type: 'call', method: 'fill', args: [] }]);
});

test('different recordings never intercept each other or modify native methods', () => {
  const first = nativeContext().context;
  const second = nativeContext().context;
  const firstMethod = first.fillRect;
  const recordingA = createPdfCanvasRecording();
  const recordingB = createPdfCanvasRecording();
  recordingA.wrap(first).fillRect(1, 2, 3, 4);
  recordingB.wrap(second).fillRect(5, 6, 7, 8);
  first.fillRect(9, 10, 11, 12);
  assert.equal(first.fillRect, firstMethod);
  assert.equal(recordingA.records.length, 1);
  assert.equal(recordingB.records.length, 1);
  assert.deepEqual(stub<CallRecord>(recordingB.records[0]).args, [5, 6, 7, 8]);
});
