import type { Font } from 'fontkit';
import { stub } from '../../support/fixtures/cvState';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create as createFont } from 'fontkit';
import PDFDocument from 'pdfkit';
import { createVectorFontResolver, parseVectorCanvasFont, parseVectorFontFaces } from '../../../src/documents/pdf/pdfVectorFonts.ts';

const stylesheet = 'https://fonts.example.test/style.css';
const faceCss = ({ family = 'Inter', weight = '400', style = 'normal', url = 'normal.woff2', range = 'U+0000-00FF' } = {}) => `@font-face {
  font-family: '${family}'; font-style: ${style}; font-weight: ${weight};
  src: url('${url}') format('woff2'); unicode-range: ${range};
}`;

function fixture(css: string, { hasGlyph = () => true, createFont, response }: { hasGlyph?: (codePoint: number) => boolean; createFont?: () => unknown; response?: (url: string) => unknown } = {}) {
  const fetched: string[] = [];
  const fetch = async (url: string) => {
    fetched.push(url);
    return response?.(url) || { ok: true, text: async () => css, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const document = { getElementById: () => ({ href: stylesheet }), fonts: { ready: Promise.resolve() } };
  return { fetched, options: stub<NonNullable<Parameters<typeof createVectorFontResolver>[0]> & { document: Document }>({ document, fetch, createFont: createFont || (() => ({ hasGlyphForCodePoint: hasGlyph })) }) };
}

test('parses variable weights, relative sources, wildcard and supplementary Unicode ranges', () => {
  const [face] = parseVectorFontFaces(faceCss({ family: 'Noto Sans Thai', weight: '100 900', url: '../font.woff2', range: 'U+0E??, U+1F600-1F64F' }), stylesheet);
  assert.deepEqual(face, {
    family: 'Noto Sans Thai', style: 'normal', weight: [100, 900],
    url: 'https://fonts.example.test/font.woff2', ranges: [[0xe00, 0xeff], [0x1f600, 0x1f64f]],
  });
});

test('parses Bunny font faces with unquoted WOFF2 and WOFF sources', () => {
  const [face] = parseVectorFontFaces(`/* latin */
    @font-face {
      font-family: 'Inter'; font-style: normal; font-weight: 400;
      font-stretch: 100%; font-display: swap;
      src: url(https://fonts.bunny.net/inter/files/inter-latin-400-normal.woff2) format('woff2'), url(https://fonts.bunny.net/inter/files/inter-latin-400-normal.woff) format('woff');
      unicode-range: U+0000-00FF, U+20AC;
    }`, 'https://fonts.bunny.net/css?family=inter:400&display=swap');
  assert.deepEqual(face, {
    family: 'Inter', style: 'normal', weight: [400, 400],
    url: 'https://fonts.bunny.net/inter/files/inter-latin-400-normal.woff2',
    ranges: [[0, 0xff], [0x20ac, 0x20ac]],
  });
});

test('parses the canvas font shorthand without losing quoted fallback families', () => {
  assert.deepEqual(parseVectorCanvasFont('italic normal 600 12pt "Source Sans 3", Inter, sans-serif'), {
    fontSize: 16, weight: 600, style: 'italic', families: ['Source Sans 3', 'Inter', 'sans-serif'],
  });
  assert.equal(parseVectorCanvasFont('14px Inter').weight, 400);
  assert.throws(() => parseVectorCanvasFont('invalid'), /cannot interpret the rendered font/);
});

test('groups Latin, Thai and Cyrillic subsets while caching shared font and stylesheet fetches', async () => {
  const css = [faceCss({}), faceCss({ url: 'thai.woff2', range: 'U+0E00-0E7F' }), faceCss({ url: 'cyrillic.woff2', range: 'U+0400-04FF' })].join('\n');
  const { options, fetched } = fixture(css);
  const resolver = await createVectorFontResolver(options);
  const runs = await resolver.resolve('normal 400 12px Inter, sans-serif', 'AbกขЯZ');
  assert.deepEqual(runs.map(({ text }) => text), ['Ab', 'กข', 'Я', 'Z']);
  assert.equal(fetched.filter((url) => url === stylesheet).length, 1);
  assert.equal(fetched.filter((url) => url.endsWith('normal.woff2')).length, 1);
  await resolver.resolve('400 12px Inter', 'Again');
  assert.equal(fetched.length, 4);
});

test('uses CSS weight matching, including 400→500 before 300 and 800→700', async () => {
  const css = [300, 500, 700].map((weight) => faceCss({ weight: String(weight), url: `${weight}.woff2` })).join('\n');
  const { options } = fixture(css);
  const resolver = await createVectorFontResolver(options);
  const [normal] = await resolver.resolve('400 12px Inter', 'A');
  const [bold] = await resolver.resolve('800 12px Inter', 'A');
  assert.equal(normal.weight, 500);
  assert.equal(bold.weight, 700);
  assert.equal(bold.syntheticBold, false);
});

test('does not replace an unavailable glyph with a different weight from the same family', async () => {
  const css = faceCss({ weight: '400' }) + faceCss({ weight: '700', url: 'cyrillic.woff2', range: 'U+0400-04FF' });
  const { options } = fixture(css);
  const resolver = await createVectorFontResolver(options);
  await assert.rejects(resolver.resolve('400 12px Inter', 'Я'), /no embeddable font covers/);
});

test('instantiates variable fonts at the requested weight and reports synthetic italics', async () => {
  const variations: Record<string, number>[] = [];
  const { options } = fixture(faceCss({ weight: '100 900' }), { createFont: () => ({
    variationAxes: { wght: { min: 100, max: 900 } },
    getVariation: (axes: Record<string, number>) => { variations.push(axes); return { hasGlyphForCodePoint: () => true }; },
  }) });
  const resolver = await createVectorFontResolver(options);
  const [run] = await resolver.resolve('italic 650 12px Inter', 'AB');
  assert.deepEqual(variations, [{ wght: 650 }]);
  assert.equal(run.syntheticItalic, true);
  assert.equal(run.text, 'AB');
});

test('uses true italic faces when available', async () => {
  const { options } = fixture(faceCss({}) + faceCss({ style: 'italic', url: 'italic.woff2' }));
  const resolver = await createVectorFontResolver(options);
  const [run] = await resolver.resolve('italic 400 12px Inter', 'A');
  assert.match(run.id, /italic\.woff2/);
  assert.equal(run.syntheticItalic, false);
});

test('does not silently substitute a font for unavailable system fonts or missing glyphs', async () => {
  const { options } = fixture(faceCss({}), { hasGlyph: () => false });
  const resolver = await createVectorFontResolver(options);
  await assert.rejects(resolver.resolve('12px system-ui, sans-serif', 'A'), /Choose a downloadable font/);
  await assert.rejects(resolver.resolve('12px Inter, sans-serif', 'A'), /no embeddable font covers/);
});

test('snapshots stylesheet URLs before awaiting font downloads', async () => {
  const { options, fetched } = fixture(faceCss({}));
  let href = stylesheet;
  options.document.getElementById = () => stub<HTMLElement>({ href });
  const pending = createVectorFontResolver(options);
  href = 'https://fonts.example.test/changed.css';
  const resolver = await pending;
  await resolver.resolve('12px Inter', 'A');
  assert.equal(fetched[0], stylesheet);
});

test('uses an explicit stylesheet snapshot instead of the current document links', async () => {
  const { options, fetched } = fixture(faceCss({}));
  options.stylesheetUrls = ['https://fonts.example.test/snapshot.css'];
  const resolver = await createVectorFontResolver(options);
  await resolver.resolve('12px Inter', 'A');
  assert.equal(fetched[0], options.stylesheetUrls[0]);
  assert.ok(!fetched.includes(stylesheet));
});

test('PDFKit keeps fontkit instances with otherwise identical metadata distinct', async () => {
  const bytes = readFileSync(new URL('../../support/fixtures/Inter-Regular.ttf', import.meta.url));
  const css = faceCss({ weight: '300', url: 'shared.woff2' }) + faceCss({ weight: '700', url: 'shared.woff2' });
  const { options } = fixture(css, { createFont: () => stub<Font>(createFont(bytes)).getVariation({ opsz: 14 }) });
  const resolver = await createVectorFontResolver(options);
  const [light] = await resolver.resolve('300 12px Inter', 'A');
  const [bold] = await resolver.resolve('700 12px Inter', 'A');
  assert.notEqual(light.font.postscriptName, bold.font.postscriptName);
  const pdf = new PDFDocument({ autoFirstPage: false });
  pdf.font(stub<PDFKit.Mixins.PDFFontSource>(light.font));
  const lightId = stub<{ _font: { id: string } }>(pdf)._font.id;
  pdf.font(stub<PDFKit.Mixins.PDFFontSource>(bold.font));
  assert.notEqual(stub<{ _font: { id: string } }>(pdf)._font.id, lightId);
  pdf.destroy();
});

test('rejects failed downloads and permits a later retry', async () => {
  let failing = true;
  const { options } = fixture(faceCss({}), { response: () => failing ? { ok: false, status: 503 } : null });
  await assert.rejects(createVectorFontResolver(options), /could not load the font stylesheet/);
  failing = false;
  const resolver = await createVectorFontResolver(options);
  assert.equal((await resolver.resolve('12px Inter', 'A'))[0].text, 'A');
});

test('accepts the clone font snapshot with equivalent normalized descriptors', async () => {
  const { options } = fixture(faceCss({}));
  options.loadedFaces = [{ family: '"INTER"', style: 'normal', weight: 'normal', unicodeRange: 'U+0080-00FF, U+0000-007F', status: 'loaded' }];
  const resolver = await createVectorFontResolver(options);
  assert.equal((await resolver.resolve('400 12px Inter', 'A'))[0].text, 'A');
});

test('rejects an unloaded clone font instead of selecting a different loaded weight', async () => {
  const { options } = fixture(faceCss({ weight: '400' }) + faceCss({ weight: '700' }));
  options.loadedFaces = [
    { family: 'Inter', style: 'normal', weight: '400', unicodeRange: 'U+0000-00FF', status: 'error' },
    { family: 'Inter', style: 'normal', weight: '700', unicodeRange: 'U+0000-00FF', status: 'loaded' },
  ];
  const resolver = await createVectorFontResolver(options);
  await assert.rejects(resolver.resolve('400 12px Inter', 'A'), /Inter was not loaded when the page was rendered/);
  assert.equal((await resolver.resolve('800 12px Inter', 'A'))[0].weight, 700);
});

test('validates the exact Unicode subset that supplied the painted glyphs', async () => {
  const { options } = fixture(faceCss({}) + faceCss({ url: 'cyrillic.woff2', range: 'U+0400-04FF' }));
  options.loadedFaces = [{ family: 'Inter', style: 'normal', weight: '400', unicodeRange: 'U+0000-00FF', status: 'loaded' }];
  const resolver = await createVectorFontResolver(options);
  assert.equal((await resolver.resolve('12px Inter', 'A'))[0].text, 'A');
  await assert.rejects(resolver.resolve('12px Inter', 'Я'), /not loaded when the page was rendered/);
});

test('an empty clone font snapshot never authorizes a silent font substitution', async () => {
  const { options } = fixture(faceCss({}));
  options.loadedFaces = [];
  const resolver = await createVectorFontResolver(options);
  await assert.rejects(resolver.resolve('12px Inter', 'A'), /not loaded when the page was rendered/);
  assert.deepEqual(await resolver.resolve('12px Inter', ''), []);
});
