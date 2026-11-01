import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import renderer, { makeCanvasCooperative } from '../../../build/responsivePdfRenderer.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('html2canvas/dist/html2canvas.esm.js'), 'utf8');

test('the vector layout adapter preserves cooperative cloning, parsing and painting', () => {
  const transformed = makeCanvasCooperative(source);
  assert.doesNotThrow(() => new Function(transformed.replace('export default html2canvas;', '')));
  assert.match(transformed, /await parseNodeTreeAsync\(context, childNode, container, root\)/);
  assert.match(transformed, /await this\.cloneChildNodes\(node, clone, copyStyles\)/);
  assert.match(transformed, /context\.renderTask\?\.own\(iframe\)/);
});

test('the main painter uses a dimension-only vector surface and a recording context', () => {
  const transformed = makeCanvasCooperative(source);
  const painter = transformed.slice(transformed.indexOf('function CanvasRenderer('), transformed.indexOf('CanvasRenderer.prototype.applyEffects'));
  assert.match(painter, /_this.canvas = \{ width: 0, height: 0, style: \{} }/);
  assert.match(painter, /context.createVectorContext\(_this.canvas\)/);
  assert.doesNotMatch(painter, /getContext|createElement\('canvas'\)/);
});

test('incompatible dependency changes fail loudly', () => {
  assert.throws(() => makeCanvasCooperative(source.replace('this.documentElement = this.cloneNode', 'this.root = this.cloneNode')), /dependency changed/);
});

test('the virtual adapter loads directly without an html2pdf worker', () => {
  const plugin = renderer();
  const id = plugin.resolveId('virtual:responsive-html2canvas');
  assert.equal(plugin.load(id!)!, makeCanvasCooperative(source));
  assert.equal(Reflect.get(plugin, 'transform'), undefined);
});
