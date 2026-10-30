import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createRenderer, nextTick, ref } from 'vue';
import type { PreviewPage, RenderOptions } from '../src/documents/pdf/pdfTypes';
import type { DocumentPdfPreviewOptions, PdfPreviewRenderer, useDocumentPdfPreview } from '../src/documents/pdf/composables/useDocumentPdfPreview';

type Preview = ReturnType<typeof useDocumentPdfPreview>;
const filename = new URL('../src/documents/pdf/composables/useDocumentPdfPreview.ts', import.meta.url);
const sourceCode = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireFromSource = createRequire(filename);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 190));
const samplePage = (svg: string): PreviewPage => ({ svg, sourceTop: 0, sourceBottom: 100, canvasWidth: 100, contentWidth: 100, leftOffset: 0, topOffset: 0 });
function pendingResult<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function turns() { for (let index = 0; index < 6; index++) await nextTick(); }
function mountPreview(mock: {
  renderPreview: (_element: HTMLElement, options: RenderOptions) => Promise<{ pages: PreviewPage[] }>;
  renderPdfBlob?: (_element: HTMLElement, options: RenderOptions) => Promise<Blob>;
  exportToPdf?: (_element: HTMLElement, filename: string, options: RenderOptions) => Promise<void>;
}, settings: Partial<DocumentPdfPreviewOptions> = {}) {
  let revoked = 0;
  let typing = false;
  let commitInput = () => {};
  const exports: { useDocumentPdfPreview?: typeof useDocumentPdfPreview } = {};
  new Function('require', 'exports', sourceCode)((path: string) => path === './usePdfExport' ? {
    usePdfExport: () => ({ ...mock, revokeDownloads: () => { revoked++; }, exportToPdf: mock.exportToPdf || (async () => {}) }),
  } : path === './usePreviewInputCommit' ? {
    usePreviewInputCommit: (commit: () => void) => { commitInput = commit; return { defer: () => typing, reset() {} }; },
  } : requireFromSource(path), exports);
  const active = ref(false);
  const version = ref(1);
  const identity = ref('original');
  const document = ref({ contact: { name: 'Original name' } });
  let sourceReads = 0;
  let preview!: Preview;
  const app = renderer.createApp({
    setup() {
      preview = exports.useDocumentPdfPreview!({
        source: async () => { sourceReads++; return {} as HTMLElement; }, options: () => ({ margin: [10, 10, 10, 10] }),
        signature: () => [version.value, document.value], active: () => active.value,
        identity: () => [identity.value],
        ...settings,
      });
      return () => null;
    },
  });
  app.mount({});
  return { preview, active, version, identity, document, setTyping: (value: boolean) => { typing = value; }, commitInput: () => commitInput(), unmount: () => app.unmount(), sourceReads: () => sourceReads, revoked: () => revoked };
}

test('returning to an unchanged document reuses its completed pages without another source capture', async t => {
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => {
    renders++;
    return { pages: [samplePage('first'), samplePage('second')] };
  } });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  fixture.preview.page.value = 2;
  for (let index = 0; index < 3; index++) {
    fixture.active.value = false;
    await nextTick();
    fixture.active.value = true;
    assert.equal(fixture.preview.pages.value[1]?.svg, 'second', 'cached pages are available immediately on return');
    assert.equal(fixture.preview.busy.value, false);
    assert.equal(fixture.preview.page.value, 2, 'returning keeps the selected page');
    await settle();
  }
  assert.equal(renders, 1, 'three unchanged returns must not repeat PDF painting');
  assert.equal(fixture.sourceReads(), 1, 'cached returns do not recapture the DOM');
});

test('nested document edits while hidden invalidate cached pages and render only when reopened', async t => {
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`render-${++renders}`)] }) });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  fixture.active.value = false;
  fixture.document.value.contact.name = 'Changed while hidden';
  assert.equal(fixture.preview.pages.value.length, 0, 'a deep source edit immediately invalidates the completed preview');
  await settle();
  assert.equal(renders, 1, 'hidden edits do not start rendering');
  fixture.active.value = true;
  assert.equal(fixture.preview.pages.value.length, 0, 'the old cached document cannot reappear');
  await settle();
  assert.equal(renders, 2);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-2');
});

for (const nextIdentity of ['proposal', 'anonymized']) test(`a hidden ${nextIdentity} source switch invalidates the cached document`, async t => {
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`render-${++renders}`)] }) });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  fixture.active.value = false;
  fixture.identity.value = nextIdentity;
  assert.equal(fixture.preview.pages.value.length, 0, 'private or different-source pages disappear synchronously');
  await settle();
  assert.equal(renders, 1);
  fixture.active.value = true;
  assert.equal(fixture.preview.pages.value.length, 0, 'reactivation cannot restore the previous source');
  await settle();
  assert.equal(renders, 2);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-2');
});

test('hiding an unfinished render cancels it and reopening starts a fresh render', async t => {
  const renders: { signal: AbortSignal; finish: (value: { pages: PreviewPage[] }) => void }[] = [];
  const fixture = mountPreview({ renderPreview: (_element, { signal }) => new Promise(finish => { renders.push({ signal: signal!, finish }); }) });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  fixture.active.value = false;
  assert.equal(renders[0].signal.aborted, true);
  fixture.active.value = true;
  await settle();
  assert.equal(renders.length, 2, 'an aborted render does not count as a reusable preview');
  renders[0].finish({ pages: [samplePage('canceled')] });
  await Promise.resolve(); await nextTick();
  assert.equal(fixture.preview.pages.value.length, 0, 'late completion cannot populate the reopened preview');
  renders[1].finish({ pages: [samplePage('current')] });
  await Promise.resolve(); await nextTick();
  assert.equal(fixture.preview.pages.value[0]?.svg, 'current');
  assert.equal(fixture.preview.busy.value, false);
});

test('leaving with a pending typing edit cannot restore the previous completed preview', async t => {
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`render-${++renders}`)] }) });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  fixture.setTyping(true);
  fixture.document.value.contact.name = 'Uncommitted edit';
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-1', 'typing may keep the previous page until the user leaves');
  fixture.active.value = false;
  fixture.setTyping(false);
  await settle();
  assert.equal(renders, 1);
  fixture.active.value = true;
  assert.equal(fixture.preview.pages.value.length, 0, 'a deferred edit makes the completed cache stale');
  await settle();
  assert.equal(renders, 2);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-2');
});

test('returning after a failed render retries instead of treating the failure as a cached preview', async t => {
  let renders = 0;
  let fail = true;
  const fixture = mountPreview({ renderPreview: async () => {
    renders++;
    if (fail) throw new Error('Preview unavailable');
    return { pages: [samplePage('recovered')] };
  } });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  assert.match(fixture.preview.error.value, /Preview unavailable/);
  fixture.active.value = false;
  fail = false;
  fixture.active.value = true;
  await settle();
  assert.equal(renders, 2);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'recovered');
  assert.equal(fixture.preview.error.value, '');
  assert.equal(fixture.preview.busy.value, false);
});

test('typing preserves the current PDF until commit, while a source switch still clears it immediately', async t => {
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`render-${++renders}`)] }) });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  fixture.setTyping(true);
  fixture.version.value++;
  fixture.version.value++;
  await settle();
  assert.equal(renders, 1);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-1');
  assert.equal(fixture.preview.busy.value, false);
  fixture.commitInput();
  await settle();
  assert.equal(renders, 2);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-2');
  fixture.identity.value = 'proposal';
  fixture.version.value++;
  assert.deepEqual(fixture.preview.pages.value, []);
  await settle();
  assert.equal(renders, 2, 'further typing still waits, but cannot retain a different source');
  fixture.commitInput();
  await settle();
  assert.equal(renders, 3);
});

test('document previews cancel stale renders and stop work when their tab is hidden', async (t) => {
  const renders: { signal: AbortSignal; finish: (value: { pages: PreviewPage[] }) => void }[] = [];
  const fixture = mountPreview({ renderPreview: (_element, { signal }) => new Promise((finish) => { renders.push({ signal: signal!, finish }); }) });
  t.after(fixture.unmount);
  await settle();
  assert.equal(fixture.sourceReads(), 0, 'hidden documents keep their source but do not render previews');
  fixture.active.value = true;
  await nextTick(); await settle();
  assert.equal(renders.length, 1);
  fixture.version.value++;
  await nextTick();
  assert.equal(renders[0].signal.aborted, true);
  renders[0].finish({ pages: [samplePage('stale')] });
  await settle();
  assert.equal(renders.length, 2);
  assert.deepEqual(fixture.preview.pages.value, [], 'a canceled render cannot publish private stale pages');
  renders[1].finish({ pages: [samplePage('current')] });
  await Promise.resolve(); await nextTick();
  assert.equal((fixture.preview.pages.value as PreviewPage[])[0].svg, 'current');
  assert.equal(fixture.preview.busy.value, false);
  fixture.version.value++;
  assert.deepEqual(fixture.preview.pages.value, [], 'switching sources immediately removes previously rendered pages from every surface');
  await nextTick(); await settle();
  fixture.active.value = false;
  await nextTick();
  assert.equal(renders[2].signal.aborted, true);
  assert.equal(fixture.preview.busy.value, false);
});

test('a failed replacement preview cannot display the previous document as the new source', async (t) => {
  let fail = false;
  const fixture = mountPreview({ renderPreview: async () => {
    if (fail) throw new Error('The proposed document cannot be rendered.');
    return { pages: [samplePage('original')] };
  } });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  assert.equal(fixture.preview.pages.value[0]?.svg, 'original');
  fail = true;
  fixture.version.value++;
  assert.deepEqual(fixture.preview.pages.value, []);
  await settle();
  assert.deepEqual(fixture.preview.pages.value, []);
  assert.match(fixture.preview.error.value, /proposed document cannot be rendered/);
});

test('hidden document sources still export for a package and dispose pending exports on unmount', async () => {
  const pending: { signal: AbortSignal; finish: (value: Blob) => void }[] = [];
  const fixture = mountPreview({
    renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: (_element, { signal }) => new Promise((finish, reject) => {
      pending.push({ signal: signal!, finish });
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }),
  });
  const exported = fixture.preview.getPdfBlob();
  await Promise.resolve();
  assert.equal(pending.length, 1);
  const pdf = new Blob(['pdf']);
  pending[0].finish(pdf);
  assert.equal(await exported, pdf);
  const canceled = fixture.preview.getPdfBlob();
  await Promise.resolve();
  fixture.unmount();
  await assert.rejects(canceled, { name: 'AbortError' });
  assert.equal(pending[0].signal.aborted, false, 'completed exports release their controller');
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(fixture.revoked(), 1);
});

test('opening then closing a proposal while an export awaits its DOM source permanently cancels that export', async t => {
  let finishSource!: (element: HTMLElement) => void;
  let renders = 0;
  const fixture = mountPreview({
    renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: async () => { renders++; return new Blob(['unaccepted proposal']); },
  });
  t.after(fixture.unmount);
  const exported = fixture.preview.getPdfBlob(() => new Promise(resolve => { finishSource = resolve; }));
  fixture.version.value = 2;
  fixture.version.value = 1;
  finishSource({} as HTMLElement);
  await assert.rejects(exported, { name: 'AbortError' });
  assert.equal(renders, 0, 'the canceled export never renders the temporary proposal DOM');
});

for (const change of ['source', 'identity'] as const) test(`${change} changes cancel an in-flight PDF even when the renderer completes after cancellation`, async t => {
  let finishRender!: (blob: Blob) => void;
  let signal!: AbortSignal;
  const fixture = mountPreview({
    renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: (_element, options) => new Promise(resolve => { signal = options.signal!; finishRender = resolve; }),
  });
  t.after(fixture.unmount);
  const exported = fixture.preview.getPdfBlob();
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  if (change === 'source') { fixture.version.value = 2; fixture.version.value = 1; }
  else { fixture.identity.value = 'proposal'; fixture.identity.value = 'original'; }
  assert.equal(signal.aborted, true, 'the source watcher invalidates exports synchronously');
  finishRender(new Blob(['stale PDF']));
  await assert.rejects(exported, { name: 'AbortError' });
});

for (const phase of ['source capture', 'PDF rendering'] as const) test(`switching to Attachments during ${phase} preserves the unchanged document export`, async t => {
  let finishSource!: (element: HTMLElement) => void;
  let finishRender!: (blob: Blob) => void;
  let signal!: AbortSignal;
  const fixture = mountPreview({
    renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: (_element, options) => new Promise(resolve => { signal = options.signal!; finishRender = resolve; }),
  });
  t.after(fixture.unmount);
  fixture.active.value = true;
  const exported = fixture.preview.getPdfBlob(() => new Promise(resolve => { finishSource = resolve; }));
  if (phase === 'source capture') fixture.active.value = false;
  finishSource({} as HTMLElement);
  await Promise.resolve();
  if (phase === 'PDF rendering') fixture.active.value = false;
  assert.equal(signal.aborted, false, 'navigation must not cancel the PDF used in the attachment package');
  const pdf = new Blob(['approved document']);
  finishRender(pdf);
  assert.equal(await exported, pdf);
  assert.equal(fixture.preview.error.value, '');
});

for (const delayMs of [100, 500]) test(`configured ${delayMs} ms scheduling waits for post watchers and the full delay`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`render-${++renders}`)] }) }, {
    delayMs, watchFlush: 'post', retainPagesOnUpdate: true,
  });
  t.after(fixture.unmount);
  fixture.active.value = true;
  assert.equal(fixture.preview.busy.value, false, 'post visibility work waits for Vue');
  await turns(); t.mock.timers.tick(delayMs - 1); await turns();
  assert.equal(renders, 0);
  t.mock.timers.tick(1); await turns(); assert.equal(renders, 1);
  fixture.version.value++;
  assert.equal(fixture.preview.busy.value, false, 'post source work also waits for Vue');
  await turns(); assert.equal(fixture.preview.busy.value, true);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-1');
  t.mock.timers.tick(delayMs); await turns(); assert.equal(renders, 2);
});

test('retained studio pages disappear after failure, and obsolete errors cannot replace recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const renders: ReturnType<typeof pendingResult<{ pages: PreviewPage[] }>>[] = [];
  const fixture = mountPreview({ renderPreview: async () => { const result = pendingResult<{ pages: PreviewPage[] }>(); renders.push(result); return result.promise; } }, {
    delayMs: 100, retainPagesOnUpdate: true, retainPagesOnHide: true,
  });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(100); await turns();
  renders[0]!.resolve({ pages: [samplePage('old')] }); await turns();
  fixture.version.value++;
  assert.equal(fixture.preview.pages.value[0]?.svg, 'old');
  t.mock.timers.tick(100); await turns(); renders[1]!.reject(new Error('Replacement failed')); await turns();
  assert.equal(fixture.preview.pages.value.length, 0);
  assert.equal(fixture.preview.previewError.value, 'Replacement failed');
  fixture.preview.request(); assert.equal(fixture.preview.previewError.value, '');
  t.mock.timers.tick(100); await turns();
  fixture.preview.request(); t.mock.timers.tick(100); await turns();
  renders[3]!.resolve({ pages: [samplePage('recovered')] }); await turns();
  renders[2]!.reject(new Error('Late obsolete failure')); await turns();
  assert.equal(fixture.preview.pages.value[0]?.svg, 'recovered');
  assert.equal(fixture.preview.previewError.value, '');
  assert.equal(fixture.preview.busy.value, false);
});

test('privacy updates clear and reset ordinary changes but preserve pages and page selection through deferral', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let held = false, renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`first-${++renders}`), samplePage('second')] }) }, {
    delayMs: 500, resetPageOnUpdate: true, deferUpdate: () => held, retainPagesOnHide: true,
  });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(500); await turns(); fixture.preview.page.value = 2;
  held = true; fixture.version.value++;
  assert.equal(fixture.preview.pages.value.length, 2);
  assert.equal(fixture.preview.page.value, 2);
  t.mock.timers.tick(1000); await turns(); assert.equal(renders, 1);
  fixture.preview.commit(); t.mock.timers.tick(500); await turns(); assert.equal(renders, 1, 'the external hold still applies');
  held = false; fixture.preview.commit(); t.mock.timers.tick(500); await turns();
  assert.equal(renders, 2); assert.equal(fixture.preview.page.value, 2, 'committing a held change does not reset the selected page');
  fixture.preview.commit(); t.mock.timers.tick(1000); await turns(); assert.equal(renders, 2, 'a clean commit starts no render');
  fixture.version.value++;
  assert.equal(fixture.preview.pages.value.length, 0); assert.equal(fixture.preview.page.value, 1);
  t.mock.timers.tick(500); await turns(); assert.equal(renders, 3);
  fixture.preview.page.value = 2; fixture.preview.request();
  assert.equal(fixture.preview.page.value, 2, 'an explicit retry resets no source page selection');
});

test('a deferred replacement failure clears pages retained during typing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fail = false;
  const fixture = mountPreview({ renderPreview: async () => {
    if (fail) throw new Error('Deferred paint failed');
    return { pages: [samplePage('previous')] };
  } });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(150); await turns();
  fixture.setTyping(true); fixture.version.value++;
  assert.equal(fixture.preview.pages.value[0]?.svg, 'previous');
  fail = true; fixture.commitInput(); t.mock.timers.tick(150); await turns();
  assert.equal(fixture.preview.pages.value.length, 0);
  assert.equal(fixture.preview.previewError.value, 'Deferred paint failed');
});

test('studio text deferral also retains hidden pages while invalidating their completed cache', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`render-${++renders}`), samplePage('second')] }) }, {
    delayMs: 500, retainPagesOnHide: true, resetPageOnUpdate: true,
  });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(500); await turns(); fixture.preview.page.value = 2;
  fixture.active.value = false; fixture.setTyping(true); fixture.version.value++;
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-1');
  assert.equal(fixture.preview.page.value, 2);
  assert.equal(fixture.preview.busy.value, false);
  t.mock.timers.tick(1000); await turns(); assert.equal(renders, 1);
  fixture.active.value = true;
  assert.equal(fixture.preview.busy.value, true, 'reactivation cannot treat retained pages as a current cache');
  t.mock.timers.tick(500); await turns();
  assert.equal(renders, 2); assert.equal(fixture.preview.pages.value[0]?.svg, 'render-2');
});

test('retaining pages on update never permits a different identity to remain visible', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let held = false;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage('original')] }) }, {
    retainPagesOnUpdate: true, retainPagesOnHide: true, deferUpdate: () => held,
  });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(150); await turns();
  held = true; fixture.identity.value = 'anonymized';
  assert.equal(fixture.preview.pages.value.length, 0);
  assert.equal(fixture.preview.busy.value, false);
});

test('manual cache-aware requests reuse nonempty output, while empty output only satisfies passive reactivation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let renders = 0, empty = false;
  const fixture = mountPreview({ renderPreview: async () => { renders++; return { pages: empty ? [] : [samplePage('cached')] }; } });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(150); await turns();
  fixture.preview.request(false); t.mock.timers.tick(1000); await turns(); assert.equal(renders, 1);
  empty = true; fixture.preview.request(); t.mock.timers.tick(150); await turns(); assert.equal(renders, 2);
  fixture.active.value = false; fixture.active.value = true;
  assert.equal(fixture.preview.busy.value, false);
  t.mock.timers.tick(1000); await turns(); assert.equal(renders, 2);
  fixture.preview.request(false); t.mock.timers.tick(150); await turns(); assert.equal(renders, 3);
});

test('privacy policy retries successful empty output when reopened', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => { renders++; return { pages: [] }; } }, {
    delayMs: 500, cacheEmptyPages: false, retainPagesOnHide: true,
  });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(500); await turns();
  assert.equal(renders, 1); assert.equal(fixture.preview.busy.value, false);
  fixture.active.value = false; fixture.active.value = true;
  assert.equal(fixture.preview.busy.value, true, 'empty private output cannot satisfy reopening from cache');
  t.mock.timers.tick(499); await turns(); assert.equal(renders, 1);
  t.mock.timers.tick(1); await turns(); assert.equal(renders, 2);
  assert.equal(fixture.preview.pages.value.length, 0); assert.equal(fixture.preview.busy.value, false);
});

test('preview and download errors stay separate while legacy error resets preserve application behavior', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = mountPreview({ renderPreview: async () => { throw new Error('Preview failed'); },
    exportToPdf: async () => { throw new Error('Download failed'); } });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(150); await turns();
  assert.equal(fixture.preview.previewError.value, 'Preview failed'); assert.equal(fixture.preview.error.value, 'Preview failed');
  const download = fixture.preview.download('cv');
  assert.equal(fixture.preview.error.value, '', 'starting a download clears the legacy error');
  assert.equal(fixture.preview.previewError.value, 'Preview failed');
  await download;
  assert.equal(fixture.preview.downloadError.value, 'Download failed'); assert.equal(fixture.preview.error.value, 'Download failed');
  fixture.version.value++;
  assert.equal(fixture.preview.previewError.value, ''); assert.equal(fixture.preview.error.value, '');
  assert.equal(fixture.preview.downloadError.value, 'Download failed', 'source updates do not discard the separate export error');
  fixture.preview.reset();
  assert.equal(fixture.preview.previewError.value, ''); assert.equal(fixture.preview.downloadError.value, '');
});

test('manual preview requests and immediate refreshes never cancel an unchanged export', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pdf = pendingResult<Blob>(); let signal!: AbortSignal;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage('current')] }),
    renderPdfBlob: async (_element, options) => { signal = options.signal!; return pdf.promise; } });
  t.after(fixture.unmount);
  const exporting = fixture.preview.getPdfBlob(); await turns();
  fixture.preview.request(); fixture.active.value = true; fixture.preview.request();
  await fixture.preview.refresh();
  assert.equal(signal.aborted, false);
  const blob = new Blob(['pdf']); pdf.resolve(blob); assert.equal(await exporting, blob);
});

test('studio export policy preserves edits and hiding, but reset still cancels the captured export', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pdf = pendingResult<Blob>(); let signal!: AbortSignal;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: async (_element, options) => { signal = options.signal!; return pdf.promise; } }, {
    cancelExportsOnSourceChange: false,
  });
  t.after(fixture.unmount);
  const exporting = fixture.preview.getPdfBlob(); await turns();
  fixture.version.value++; fixture.identity.value = 'new-version'; fixture.active.value = true; fixture.active.value = false;
  assert.equal(signal.aborted, false);
  fixture.preview.reset(); assert.equal(signal.aborted, true);
  pdf.resolve(new Blob(['obsolete'])); await assert.rejects(exporting, { name: 'AbortError' });
});

test('download guards are per controller and an obsolete finally cannot unlock a newer download after reset', async t => {
  const downloads: { signal: AbortSignal; result: ReturnType<typeof pendingResult<void>> }[] = [];
  const exportToPdf = async (_element: HTMLElement, _filename: string, options: RenderOptions) => {
    const result = pendingResult<void>(); downloads.push({ signal: options.signal!, result }); return result.promise;
  };
  const normal = mountPreview({ renderPreview: async () => ({ pages: [] }), exportToPdf });
  const privacy = mountPreview({ renderPreview: async () => ({ pages: [] }), exportToPdf });
  t.after(normal.unmount); t.after(privacy.unmount);
  const old = normal.preview.download('normal'); await normal.preview.download('duplicate');
  const other = privacy.preview.download('privacy'); await turns();
  assert.equal(downloads.length, 2, 'normal and privacy exports remain independent');
  normal.preview.reset(); assert.equal(downloads[0]!.signal.aborted, true);
  const newer = normal.preview.download('new'); await turns();
  downloads[0]!.result.reject(new Error('Late cancelled error')); await old;
  assert.equal(normal.preview.downloading.value, true);
  assert.equal(normal.preview.downloadError.value, '');
  downloads[2]!.result.resolve(); await newer;
  assert.equal(normal.preview.downloading.value, false);
  assert.equal(privacy.preview.downloading.value, true);
  downloads[1]!.result.resolve(); await other;
});

test('reset cancels deferred input and obsolete renders without clearing newer work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const renders: ReturnType<typeof pendingResult<{ pages: PreviewPage[] }>>[] = [];
  const fixture = mountPreview({ renderPreview: async () => { const result = pendingResult<{ pages: PreviewPage[] }>(); renders.push(result); return result.promise; } });
  t.after(fixture.unmount);
  fixture.active.value = true; t.mock.timers.tick(150); await turns();
  fixture.preview.reset(); fixture.preview.request(); t.mock.timers.tick(150); await turns();
  renders[0]!.reject(new Error('Reset render failed')); await turns();
  assert.equal(fixture.preview.busy.value, true); assert.equal(fixture.preview.error.value, '');
  renders[1]!.resolve({ pages: [samplePage('new')] }); await turns();
  fixture.setTyping(true); fixture.version.value++; fixture.preview.reset(); fixture.commitInput();
  t.mock.timers.tick(1000); await turns();
  assert.equal(renders.length, 2); assert.equal(fixture.preview.pages.value.length, 0); assert.equal(fixture.preview.page.value, 1);
});

test('injected renderers retain their download ownership and successful renders clamp the selected page both ways', async () => {
  const renderer: PdfPreviewRenderer = { renderPreview: async () => ({ pages: [samplePage('one'), samplePage('two')] }),
    renderPdfBlob: async () => new Blob(['pdf']), exportToPdf: async () => {} };
  const fixture = mountPreview({ renderPreview: async () => { assert.fail('The injected renderer must be used.'); } }, { renderer });
  fixture.active.value = true; fixture.preview.page.value = -4; await fixture.preview.refresh();
  assert.equal(fixture.preview.page.value, 1);
  fixture.preview.page.value = 20; await fixture.preview.refresh(); assert.equal(fixture.preview.page.value, 2);
  fixture.preview.reset(); fixture.unmount();
  assert.equal(fixture.revoked(), 0, 'the controller cannot revoke downloads owned by its caller');
  await fixture.preview.refresh(); fixture.preview.request(); fixture.preview.commit();
  assert.equal(fixture.preview.pages.value.length, 0, 'disposed public methods start no work');
});
