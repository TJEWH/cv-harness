import assert from 'node:assert/strict';
import test from 'node:test';
import { FontImportError, fontOptions, fontStylesheetUrl, importWebFont, selectedFont, storeCustomFont } from '../../../src/documents/layout/webFonts';

const css = (name = 'Open Sans') => `@font-face { font-family: '${name}'; font-weight: 400; src: url(https://fonts.example.test/font.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;
const decode = async () => {};
const isError = (code: FontImportError['code'], source?: string, status?: number) => (error: unknown) => {
  assert.ok(error instanceof FontImportError);
  assert.equal(error.code, code);
  if (source) assert.equal(error.source, source);
  if (status !== undefined) assert.equal(error.status, status);
  return true;
};

test('imports a decoded file and uses the canonical provider family name', async () => {
  const requested: string[] = [];
  let decoded = false;
  const result = await importWebFont('  open   sans  ', 'bunny', {
    fetch: async (url) => {
      requested.push(String(url));
      return new Response(String(url).includes('/css?') ? css() : new Uint8Array([1, 2, 3]));
    },
    decode: async (name, data) => {
      assert.equal(name, 'Open Sans');
      assert.equal(data.byteLength, 3);
      decoded = true;
    },
  });
  assert.deepEqual(result, { name: 'Open Sans', source: 'bunny' });
  assert.ok(decoded);
  assert.deepEqual(requested, [
    'https://fonts.bunny.net/css?family=open-sans:300,400,600,700&display=swap',
    'https://fonts.example.test/font.woff2',
  ]);
});

test('Bunny missing-font responses fall back to Google and retain the actual source', async () => {
  const requested: string[] = [];
  const result = await importWebFont('Century Gothic', 'bunny', {
    fetch: async (url) => {
      requested.push(String(url));
      if (String(url).includes('bunny.net')) return new Response("/* Error: API Error. Details: Please specify a valid icon font on the 'family' parameter. */");
      return new Response(String(url).includes('/css?') ? css('Century Gothic') : 'font');
    }, decode,
  });
  assert.deepEqual(result, { name: 'Century Gothic', source: 'google' });
  assert.match(requested[1], /googleapis\.com\/css\?family=Century\+Gothic:/);
  assert.equal(requested.length, 3);
});

test('an explicit Google source never requests Bunny', async () => {
  await importWebFont('Open Sans', 'google', {
    fetch: async (url) => {
      assert.doesNotMatch(String(url), /bunny/);
      return new Response(String(url).includes('/css?') ? css() : 'font');
    }, decode,
  });
});

test('missing fonts, HTTP failures, invalid CSS and blocked requests have distinct errors', async () => {
  const cases = [
    { response: () => new Response('400: Font family not found. Missing font family', { status: 400 }), code: 'not-found', status: 400 },
    { response: () => new Response('Busy', { status: 429 }), code: 'http', status: 429 },
    { response: () => new Response('Service unavailable', { status: 503 }), code: 'http', status: 503 },
    { response: () => new Response('Bad request', { status: 400 }), code: 'http', status: 400 },
    { response: () => new Response('<html>unexpected response</html>'), code: 'invalid-css' },
    { response: () => new Response(css('Wrong family')), code: 'invalid-css' },
    { response: () => { throw new TypeError('Failed to fetch'); }, code: 'network' },
  ] as const;
  for (const entry of cases) {
    await assert.rejects(importWebFont('Missing Font', 'google', { fetch: async () => entry.response(), decode }),
      isError(entry.code, 'google', 'status' in entry ? entry.status : undefined));
  }
  for (const status of [429, 503]) {
    let count = 0;
    await assert.rejects(importWebFont('Open Sans', 'bunny', {
      fetch: async () => { count++; return new Response('Busy', { status }); }, decode,
    }), isError('http', 'bunny', status));
    assert.equal(count, 1, 'Provider errors must not be mistaken for a missing family');
  }
});

test('a missing font on both providers does not succeed or substitute another family', async () => {
  await assert.rejects(importWebFont('Browallia New', 'bunny', {
    fetch: async () => new Response('Font family not found', { status: 400 }), decode,
  }), isError('not-found', 'google', 400));
});

test('font file download and decoding failures do not count as successful imports', async () => {
  await assert.rejects(importWebFont('Open Sans', 'bunny', {
    fetch: async (url) => String(url).includes('/css?') ? new Response(css()) : new Response('Missing file', { status: 404 }), decode,
  }), isError('http', 'bunny', 404));
  await assert.rejects(importWebFont('Open Sans', 'google', {
    fetch: async (url) => new Response(String(url).includes('/css?') ? css() : 'corrupt font'),
    decode: async () => { throw new Error('invalid font'); },
  }), isError('decode', 'google'));
});

test('invalid names, timeouts and cancellations are identified without saving a font', async () => {
  for (const name of ['', '  ', 'Inter:700', 'https://example.com/font', 'Inter|Roboto']) {
    await assert.rejects(importWebFont(name, 'bunny', { fetch: async () => { throw new Error('Must not fetch'); } }), isError('invalid-name'));
  }
  await assert.rejects(importWebFont('Open Sans', 'bunny', {
    fetch: async () => new Promise<Response>(() => {}), timeoutMs: 5,
  }), isError('timeout', 'bunny'));
  await assert.rejects(importWebFont('Open Sans', 'google', {
    fetch: async (url) => new Response(String(url).includes('/css?') ? css() : 'font'),
    decode: async () => new Promise(() => {}), timeoutMs: 5,
  }), isError('timeout', 'google'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(importWebFont('Open Sans', 'bunny', { signal: controller.signal }), isError('cancelled'));
});

test('custom source overrides remain stored, while bundled families use local assets', () => {
  const customFonts = storeCustomFont([{ name: 'Inter', source: 'bunny' }], { name: 'Inter', source: 'google' });
  assert.deepEqual(customFonts, [{ name: 'Inter', source: 'google' }]);
  const design = { customFonts: storeCustomFont(customFonts, { name: 'Open Sans', source: 'bunny' }) };
  assert.deepEqual(fontOptions(['Inter'], design), [
    { value: 'Inter', label: 'Inter (Bundled)' }, { value: 'Open Sans', label: 'Open Sans (Bunny)' },
  ]);
  assert.match(fontStylesheetUrl(selectedFont('Inter', design)), /bundled-fonts\.css$/);
  assert.match(fontStylesheetUrl(selectedFont('Open Sans', design)), /fonts.bunny.net/);
  assert.deepEqual(selectedFont('Century Gothic', {}), { name: 'Century Gothic', source: 'google' });
  assert.deepEqual(selectedFont('Browallia New', {}), { name: 'Browallia New', source: 'google' });
});
