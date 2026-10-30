import assert from 'node:assert/strict';
import test from 'node:test';
import { effectScope, isProxy, shallowRef } from 'vue';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { usePdfBlobPreview } from '../src/documents/pdf/composables/usePdfBlobPreview';
import { retainPdfPage } from '../src/documents/pdf/pdfJs';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function document(numPages: number) { return { numPages } as PDFDocumentProxy; }
function task(pdf?: PDFDocumentProxy) {
  const pending = deferred<PDFDocumentProxy>();
  let destroyed = 0;
  if (pdf) pending.resolve(pdf);
  return {
    ...pending,
    destroy: async () => { destroyed++; },
    destroyed: () => destroyed,
  };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(load: NonNullable<Parameters<typeof usePdfBlobPreview>[1]>, initial: Blob | null = null) {
  const source = shallowRef(initial);
  const scope = effectScope();
  const preview = scope.run(() => usePdfBlobPreview(() => source.value, load))!;
  return { source, preview, unmount: () => scope.stop() };
}

test('PDF blob preview shares raw documents across pages and disposes replacements without changing source bytes', async t => {
  const firstPdf = document(3), secondPdf = document(1);
  const first = task(firstPdf), second = task(secondPdf);
  const original = new Blob(['original local PDF']);
  const bytes: Uint8Array[] = [];
  const loaded = [first, second];
  const view = fixture(async data => { bytes.push(data); return loaded.shift()!; }, original);
  t.after(view.unmount);
  assert.equal(view.preview.loading.value, true);
  await settle();
  assert.equal(view.preview.pages.value.length, 3);
  assert.deepEqual(view.preview.pages.value.map(page => page.pageNumber), [1, 2, 3]);
  assert.ok(view.preview.pages.value.every(page => page.pdf === firstPdf && !isProxy(page.pdf)));
  assert.equal(new TextDecoder().decode(bytes[0]), 'original local PDF');
  assert.equal(await original.text(), 'original local PDF');
  view.source.value = new Blob(['second']);
  assert.equal(view.preview.pages.value.length, 0, 'old pages disappear synchronously');
  assert.equal(first.destroyed(), 1);
  await settle();
  assert.equal(view.preview.pages.value[0].pdf, secondPdf);
  view.unmount();
  assert.equal(second.destroyed(), 1);
  assert.deepEqual(view.preview.pages.value, []);
});

test('stale parsing and stale failures cannot replace the current PDF or its loading state', async t => {
  const older = task(), current = task();
  const loaded = [older, current];
  const view = fixture(async () => loaded.shift()!, new Blob(['older']));
  t.after(view.unmount);
  await settle();
  view.source.value = new Blob(['current']);
  await settle();
  assert.equal(older.destroyed(), 1);
  older.resolve(document(50));
  await settle();
  assert.deepEqual(view.preview.pages.value, []);
  assert.equal(view.preview.loading.value, true);
  current.resolve(document(2));
  await settle();
  assert.equal(view.preview.pages.value.length, 2);
  assert.equal(view.preview.error.value, '');
  assert.equal(view.preview.loading.value, false);
  const errorTask = task();
  const errorView = fixture(async () => errorTask, new Blob(['pending']));
  await settle();
  errorView.source.value = null;
  errorTask.reject(new Error('Canceled old load'));
  await settle();
  assert.equal(errorView.preview.error.value, '');
  errorView.unmount();
});

test('superseded Blob reads do not start parsing or leave an old document visible', async t => {
  const pending = deferred<ArrayBuffer>();
  class SlowBlob extends Blob { override arrayBuffer() { return pending.promise; } }
  let loads = 0;
  const view = fixture(async () => { loads++; return task(document(1)); }, new SlowBlob());
  t.after(view.unmount);
  view.source.value = null;
  pending.resolve(new ArrayBuffer(1));
  await settle();
  assert.equal(loads, 0);
  assert.equal(view.preview.loading.value, false);
  assert.deepEqual(view.preview.pages.value, []);
});

test('an asynchronous task returned after unmount is destroyed and its cancellation rejection is consumed', async () => {
  const loading = deferred<ReturnType<typeof task>>();
  const lateTask = task();
  const view = fixture(async () => loading.promise, new Blob(['late']));
  await settle();
  view.unmount();
  loading.resolve(lateTask);
  await settle();
  assert.equal(lateTask.destroyed(), 1);
  lateTask.reject(new Error('Worker destroyed'));
  await settle();
  assert.deepEqual(view.preview.pages.value, []);
  assert.equal(view.preview.loading.value, false);
});

test('failed PDF loads release their worker and can be retried locally', async t => {
  const broken = task(), retry = task(document(2));
  const loaded = [broken, retry];
  const view = fixture(async () => loaded.shift()!, new Blob(['pdf bytes']));
  t.after(view.unmount);
  await settle();
  broken.reject(new Error('Invalid PDF structure'));
  await settle();
  assert.equal(broken.destroyed(), 1);
  assert.match(view.preview.error.value, /Invalid PDF structure/);
  assert.equal(view.preview.loading.value, false);
  assert.deepEqual(view.preview.pages.value, []);
  view.preview.retry();
  assert.equal(view.preview.error.value, '');
  await settle();
  assert.equal(view.preview.pages.value.length, 2);
  assert.equal(view.preview.loading.value, false);
});

test('shared PDF page resources are released only after the last view and pending render finish', async () => {
  let cleaned = 0;
  const page = { cleanup: () => { cleaned++; return true; } } as PDFPageProxy;
  const inline = retainPdfPage(page), expanded = retainPdfPage(page);
  inline();
  assert.equal(cleaned, 0, 'closing inline cannot invalidate the expanded text or image resources');
  const pending = deferred<void>();
  expanded(pending.promise);
  assert.equal(cleaned, 0);
  const reopened = retainPdfPage(page);
  pending.resolve();
  await settle();
  assert.equal(cleaned, 0, 'a view reopening while cancellation finishes retains its page');
  reopened();
  assert.equal(cleaned, 1);
  reopened();
  assert.equal(cleaned, 1, 'release is idempotent');
});
