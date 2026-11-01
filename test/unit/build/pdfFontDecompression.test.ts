import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import PDFDocument from 'pdfkit';
import compress from 'wawoff2/compress.js';
import { decompressVectorFont } from '../../../src/documents/pdf/pdfFontDecompression.ts';
import { makeFontkitVariableSubsetsCompatible, makeWoff2DecoderModule } from '../../../build/vectorFontDecompression.ts';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

async function adaptedFontkit() {
  const path = join(dirname(require.resolve('fontkit')), 'browser-module.mjs');
  const source = makeFontkitVariableSubsetsCompatible(readFileSync(path, 'utf8'))
    .replace(/from "([^"]+)"/g, (_, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('passes through existing SFNT font bytes without copying or decoding', async () => {
  const bytes = new Uint8Array([0, 1, 0, 0]);
  assert.equal(await decompressVectorFont(bytes), bytes);
});

test('decodes a real WOFF2 variable font before instancing and PDF subsetting', async () => {
  const source = readFileSync(new URL('../../support/fixtures/Inter-Regular.ttf', import.meta.url));
  const woff2 = await compress(source);
  assert.deepEqual([...woff2.slice(0, 4)], [0x77, 0x4f, 0x46, 0x32]);
  const sfnt = await decompressVectorFont(woff2);
  assert.equal(await decompressVectorFont(woff2), sfnt);
  const { create } = await adaptedFontkit();
  const font = create(sfnt).getVariation({ opsz: 18 });
  assert.ok(font.hasGlyphForCodePoint(65));
  assert.equal(font.layout('Resume').glyphs.length, 6);

  const pdf = new PDFDocument();
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk) => chunks.push(chunk));
  const finished = once(pdf, 'end');
  pdf.font(font).text('Resume');
  pdf.end();
  await finished;
  assert.ok(Buffer.concat(chunks).includes(Buffer.from('/FontFile2')));
});

test('adapts only the pinned dependency signatures', () => {
  assert.throws(() => makeWoff2DecoderModule('changed dependency'), /dependency changed/);
  assert.throws(() => makeFontkitVariableSubsetsCompatible('changed dependency'), /dependency changed/);
});

test('retains simple and compound variable glyph contours when subsetting', async () => {
  const bytes = readFileSync(new URL('../../support/fixtures/Inter-Regular.ttf', import.meta.url));
  const { create } = await adaptedFontkit();
  for (const opsz of [18, 32]) {
    const font = create(bytes).getVariation({ opsz });
    const subset = font.createSubset();
    const glyphs = [...'BBxxÁÄéô'].map((character) => {
      const original = font.glyphForCodePoint(character.codePointAt(0));
      return { character, original, subsetId: subset.includeGlyph(original) };
    });
    assert.ok(glyphs.some(({ original }) => original._decode().numberOfContours < 0));
    const embedded = create(subset.encode());
    for (const { character, original, subsetId } of glyphs) {
      const actual = embedded.getGlyph(subsetId);
      const contours = (glyph: { path: { commands: { command: string }[] } }) => glyph.path.commands.filter(({ command }) => command === 'closePath').length;
      assert.equal(contours(actual), contours(original), `${character} retains every contour at opsz ${opsz}`);
      for (const edge of ['minX', 'maxX', 'minY', 'maxY']) {
        assert.ok(Math.abs(actual.bbox[edge] - original.bbox[edge]) <= 2,
          `${character} preserves ${edge} at opsz ${opsz}: ${actual.bbox[edge]} vs ${original.bbox[edge]}`);
      }
    }
  }
});

test('raises simple-glyph limits to cover flattened variable compound glyphs', async () => {
  const bytes = readFileSync(new URL('../../support/fixtures/Inter-Regular.ttf', import.meta.url));
  const { create } = await adaptedFontkit();
  const font = create(bytes).getVariation({ opsz: 18 });
  // Exercise families whose composite outlines exceed their simple-glyph limits.
  font.maxp.maxPoints = 1;
  font.maxp.maxContours = 1;
  const subset = font.createSubset();
  subset.includeGlyph(font.glyphForCodePoint('Ä'.codePointAt(0)));
  const embedded = create(subset.encode());
  assert.equal(embedded.maxp.maxPoints, font.maxp.maxComponentPoints);
  assert.equal(embedded.maxp.maxContours, font.maxp.maxComponentContours);
});

test('exposes the WASM decoder as ESM without Node filesystem or CommonJS dependencies', async () => {
  const source = makeWoff2DecoderModule(readFileSync(require.resolve('wawoff2/build/decompress_binding.js'), 'utf8'));
  assert.doesNotMatch(source, /require\(|module\["exports"]/);
  const { default: runtime } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  if (!runtime.calledRun) await new Promise((resolve) => { runtime.onRuntimeInitialized = resolve; });
  assert.equal(typeof runtime.decompress, 'function');
});
