import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import pdfPreviewAssets from '../build/pdfPreviewAssets.ts';

const require = createRequire(import.meta.url);
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

function callable<T>(hook: T | { handler: T }): T {
  return typeof hook === 'function' ? hook : (hook as { handler: T }).handler;
}

function setup(base: string) {
  const plugin = pdfPreviewAssets();
  callable(plugin.configResolved!).call({} as never, { base } as ResolvedConfig);
  let middleware: Middleware | undefined;
  callable(plugin.configureServer!).call({} as never, { middlewares: { use(value: Middleware) { middleware = value; } } } as ViteDevServer);
  assert.ok(middleware);
  return (url: string, method = 'GET') => {
    const headers = new Map<string, string | number>();
    const response = {
      statusCode: 200, body: undefined as Buffer | undefined, ended: false, passed: false,
      setHeader(name: string, value: string | number) { headers.set(name, value); },
      end(body?: Buffer) { this.body = body; this.ended = true; },
    };
    middleware!({ url, method } as IncomingMessage, response as unknown as ServerResponse, () => { response.passed = true; });
    return { ...response, headers };
  };
}

test('PDF.js support assets use the configured base and proper content types', () => {
  const request = setup('/cv-harness/');
  const wasm = request('/cv-harness/pdfjs/wasm/openjpeg.wasm?version=1');
  assert.equal(wasm.statusCode, 200);
  assert.equal(wasm.headers.get('Content-Type'), 'application/wasm');
  assert.deepEqual(wasm.body, readFileSync(require.resolve('pdfjs-dist/wasm/openjpeg.wasm')));
  assert.equal(request('/cv-harness/pdfjs/wasm/openjpeg_nowasm_fallback.js').headers.get('Content-Type'), 'text/javascript');
  assert.equal(request('/cv-harness/pdfjs/standard_fonts/LiberationSans-Regular.ttf').headers.get('Content-Type'), 'font/ttf');
  assert.equal(request('/cv-harness/pdfjs/iccs/CGATS001Compat-v2-micro.icc').headers.get('Content-Type'), 'application/vnd.iccprofile');
  assert.equal(request('/pdfjs/wasm/openjpeg.wasm').passed, true);
  const head = request('/cv-harness/pdfjs/wasm/openjpeg.wasm', 'HEAD');
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers.get('Content-Length'), wasm.body!.length);
  assert.ok(setup('/')('/pdfjs/wasm/openjpeg.wasm').body);
});

test('PDF.js asset serving rejects malformed paths and cannot leave its allowlisted files', () => {
  const request = setup('/cv-harness/');
  for (const path of ['../package.json', '%2e%2e/package.json', 'cmaps/%2e%2e/package.json', 'wasm%5c..%5cpackage.json', '%00', '%ZZ']) {
    const response = request(`/cv-harness/pdfjs/${path}`);
    assert.equal(response.statusCode, 400, path);
    assert.equal(response.body, undefined, path);
  }
  for (const path of ['package.json', 'wasm/missing.wasm', 'cmaps//Identity-H.bcmap']) {
    const response = request(`/cv-harness/pdfjs/${path}`);
    assert.equal(response.statusCode, 404, path);
    assert.equal(response.body, undefined, path);
  }
});

test('production PDF.js assets preserve nested paths and match development bytes', () => {
  const plugin: Plugin = pdfPreviewAssets();
  const assets = new Map<string, Uint8Array>();
  const context = { emitFile(asset: { fileName: string; source: Uint8Array }) { assets.set(asset.fileName, asset.source); return asset.fileName; } };
  const generate = callable(plugin.generateBundle!);
  generate.call(context as never, {} as never, {}, false);
  assert.ok(assets.size > 100);
  const request = setup('/cv-harness/');
  for (const path of ['pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap', 'pdfjs/standard_fonts/LiberationSans-Regular.ttf', 'pdfjs/wasm/openjpeg.wasm', 'pdfjs/iccs/CGATS001Compat-v2-micro.icc']) {
    assert.ok(assets.has(path), path);
    assert.deepEqual(assets.get(path), request(`/cv-harness/${path}`).body);
  }
  assert.equal(assets.has('pdfjs/package.json'), false);
});
