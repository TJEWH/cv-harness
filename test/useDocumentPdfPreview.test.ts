import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createRenderer, nextTick, ref } from 'vue';
import type { PreviewPage, RenderOptions } from '../src/documents/pdf/pdfTypes';
import type { useDocumentPdfPreview } from '../src/documents/pdf/composables/useDocumentPdfPreview';

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
function mountPreview(mock: {
  renderPreview: (_element: HTMLElement, options: RenderOptions) => Promise<{ pages: PreviewPage[] }>;
  renderPdfBlob?: (_element: HTMLElement, options: RenderOptions) => Promise<Blob>;
}) {
  let revoked = 0;
  let typing = false;
  let commitInput = () => {};
  const exports: { useDocumentPdfPreview?: typeof useDocumentPdfPreview } = {};
  new Function('require', 'exports', sourceCode)((path: string) => path === './usePdfExport' ? {
    usePdfExport: () => ({ ...mock, revokeDownloads: () => { revoked++; }, exportToPdf: async () => {} }),
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
