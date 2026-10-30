import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, nextTick, ref, type Component } from 'vue';
import type { CvState } from '../src/documents/cv/types';
import type { RenderOptions } from '../src/documents/pdf/pdfTypes';

const filename = new URL('../src/app/App.vue', import.meta.url);
const script = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'app-preview-policy' });
const code = ts.transpileModule(script.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireFromApp = createRequire(filename);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let index = 0; index < 8; index++) await nextTick(); };
type Variant = 'normal' | 'privacy';
interface Page { svg: string }
interface Studio {
  state: CvState;
  pdfRenderSource: unknown; anonymizedPdfRenderSource: unknown;
  previewPages: Page[]; anonymizedPreviewPages: Page[]; previewPage: number; anonymizedPreviewPage: number;
  previewFailed: boolean; anonymizedPreviewFailed: boolean; isPreviewRendering: boolean; isAnonymizedPreviewRendering: boolean;
  isExporting: boolean; isAnonymizedExporting: boolean; pdfExportError: string;
  activeBuilderGroup: string; activeWorkspace: string; isMobile: boolean; previewMode: boolean; fullPreviewMode: string;
  requestPdfPreview(): void; requestAnonymizedPdfPreview(): void;
  handleExportPdf(): Promise<void>; handleAnonymizedExportPdf(): Promise<void>;
  handleVersionDeleted(): void; commitPrivacyPreview(): Promise<void>;
  onPreviewSliderPointerDown(event: PointerEvent): void; commitDeferredSliderPreview(): void;
}
class Field {
  isConnected = true;
  constructor(readonly kind: 'text' | 'range' = 'text') {}
  matches(selector: string) { return this.kind === 'range' ? selector === 'input[type="range"]' : selector.startsWith('textarea,'); }
  contains(target: unknown) { return target === this; }
  getClientRects() { return [{}]; }
}
function mountStudio(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'error', () => {});
  const document = Object.assign(new EventTarget(), { activeElement: null as Field | null, body: {}, hidden: false });
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  const globals = {
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    document, window, Element: Field, HTMLElement: Field, Node: Field,
    MutationObserver: class { observe() {} disconnect() {} },
  };
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  const elements = { normal: { variant: 'normal' as const }, privacy: { variant: 'privacy' as const } };
  const renders: { variant: Variant; options: RenderOptions; job: ReturnType<typeof deferred<{ pages: Page[] }>> }[] = [];
  const downloads: { variant: Variant; filename: string; options: RenderOptions; job: ReturnType<typeof deferred<void>> }[] = [];
  let revoked = 0;
  const exports: { default?: Component } = {};
  new Function('require', 'exports', code)((path: string) => {
    if (path.endsWith('.vue')) return { default: {} };
    if (path.endsWith('/useSupabaseAuth')) return { useSupabaseAuth: () => ({ user: ref(null), client: null }) };
    if (path.endsWith('/useCvDesign')) return { useCvDesign() {} };
    if (path.endsWith('/usePdfExport')) return { usePdfExport: () => ({
      renderPreview: (element: { variant: Variant }, options: RenderOptions) => {
        const job = deferred<{ pages: Page[] }>(); renders.push({ variant: element.variant, options, job }); return job.promise;
      },
      renderPdfBlob() { assert.fail('Studio downloads must use the existing export operation.'); },
      exportToPdf: (element: { variant: Variant }, filename: string, options: RenderOptions) => {
        const job = deferred<void>(); downloads.push({ variant: element.variant, filename, options, job }); return job.promise;
      },
      revokeDownloads() { revoked++; },
    }) };
    return requireFromApp(path);
  }, exports);
  const app = renderer.createApp({ ...exports.default, render: () => null });
  const instance = app.mount({}) as unknown as { $: { setupState: Studio } };
  const setup = instance.$.setupState;
  setup.pdfRenderSource = { querySelector: () => elements.normal };
  setup.anonymizedPdfRenderSource = { querySelector: () => elements.privacy };
  let mounted = true;
  function unmount() { if (mounted) { app.unmount(); mounted = false; } }
  t.after(() => {
    unmount();
    previous.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key));
  });
  const jobs = (variant: Variant) => renders.filter(render => render.variant === variant);
  async function tick(milliseconds: number) { t.mock.timers.tick(milliseconds); await settle(); }
  async function complete(variant: Variant, label: string, count = 1) {
    const pages = Array.from({ length: count }, (_, index) => ({ svg: label + '-' + index }));
    jobs(variant).at(-1)!.job.resolve({ pages }); await settle(); return pages;
  }
  function inputEvent(type: string, field: Field, values: Record<string, unknown> = {}) {
    const event = new Event(type);
    Object.entries({ target: field, ...values }).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
    document.dispatchEvent(event);
  }
  return { setup, document, window, renders, downloads, jobs, tick, complete, inputEvent, unmount, revoked: () => revoked };
}

test('Studio keeps 100/500ms policies, distinct page retention, explicit requests and completed-cache reuse', async t => {
  const f = mountStudio(t), s = f.setup;
  await settle(); await f.tick(99); assert.equal(f.renders.length, 0);
  await f.tick(1); assert.equal(f.jobs('normal').length, 1);
  await f.complete('normal', 'normal-initial', 3); s.previewPage = 3;
  s.state.contact.role = 'A changed role'; await settle();
  assert.equal(s.previewPages[0].svg, 'normal-initial-0', 'ordinary updates retain the last normal PDF');
  assert.equal(s.previewPage, 3); assert.equal(s.isPreviewRendering, true);
  await f.tick(99); assert.equal(f.jobs('normal').length, 1);
  await f.tick(1); assert.equal(f.jobs('normal').length, 2);
  await f.complete('normal', 'normal-update'); assert.equal(s.previewPage, 1, 'successful replacement clamps the selected page');

  s.requestPdfPreview(); await f.tick(100);
  assert.equal(f.jobs('normal').length, 3, 'an explicit normal request refreshes even a completed source');
  await f.complete('normal', 'normal-explicit', 2); s.previewPage = 2;
  s.activeBuilderGroup = 'privacy'; await settle();
  await f.tick(499); assert.equal(f.jobs('privacy').length, 0);
  await f.tick(1); assert.equal(f.jobs('privacy').length, 1);
  await f.complete('privacy', 'privacy-initial', 3); s.anonymizedPreviewPage = 3;
  s.requestAnonymizedPdfPreview(); await f.tick(1000);
  assert.equal(f.jobs('privacy').length, 1, 'an unchanged completed privacy source does not render again');
  assert.equal(s.anonymizedPreviewPage, 3);

  s.state.anonymization.excludedSections = ['hobbies']; await settle();
  assert.deepEqual(s.anonymizedPreviewPages, [], 'ordinary privacy changes remove the previous private projection immediately');
  assert.equal(s.anonymizedPreviewPage, 1);
  assert.equal(s.previewPages[0].svg, 'normal-explicit-0', 'privacy changes preserve the separate normal cache');
  await f.tick(500); await f.complete('privacy', 'privacy-update');
  s.activeBuilderGroup = 'content'; await settle(); await f.tick(1000);
  assert.equal(f.jobs('normal').length, 3, 'returning to an unchanged normal source reuses its completed pages');
  assert.equal(s.previewPage, 2);
  s.activeBuilderGroup = 'privacy'; await settle(); await f.tick(1000);
  assert.equal(f.jobs('privacy').length, 2, 'returning to an unchanged privacy source also reuses its cache');
});

test('Studio retries empty privacy output when its view reopens', async t => {
  const f = mountStudio(t), s = f.setup;
  await settle(); s.activeBuilderGroup = 'privacy'; await settle();
  await f.tick(500); await f.complete('privacy', 'empty', 0);
  assert.deepEqual(s.anonymizedPreviewPages, []);
  s.activeBuilderGroup = 'content'; await settle();
  s.activeBuilderGroup = 'privacy'; await settle();
  await f.tick(499); assert.equal(f.jobs('privacy').length, 1);
  await f.tick(1); assert.equal(f.jobs('privacy').length, 2, 'empty output cannot satisfy the privacy reactivation cache');
  await f.complete('privacy', 'retried');
});

test('Studio signatures ignore completion/favorite UI state while options retain their existing clamps', async t => {
  const f = mountStudio(t), s = f.setup;
  await settle(); await f.tick(100); await f.complete('normal', 'normal');
  s.state.completedSections = ['education'];
  s.state.design.favoriteControls = [];
  await settle(); await f.tick(1000);
  assert.equal(f.renders.length, 1, 'UI-only completion and favorite changes do not schedule document layouts');
  s.state.anonymization.excludedSections = ['jobs']; await settle(); await f.tick(1000);
  assert.equal(f.jobs('normal').length, 1, 'privacy configuration alone does not invalidate the normal source');
  s.state.design.pageMarginTop = '100mm'; s.state.design.pageMarginLeft = '-5mm'; s.state.design.headerBottomMargin = '80mm';
  await settle(); await f.tick(100);
  const options = f.jobs('normal').at(-1)!.options;
  assert(Array.isArray(options.margin));
  assert.equal(options.margin[0], 30); assert.equal(options.margin[1], 0);
  assert.equal(options.continuationTopPadding, 30, 'Studio continuation padding uses the existing margin clamp');
  s.previewPage = 0; await f.complete('normal', 'clamped'); assert.equal(s.previewPage, 1);
});

test('real text commits and slider release refresh only the latest source while retaining displayed pages', async t => {
  const f = mountStudio(t), s = f.setup;
  await settle(); await f.tick(100); await f.complete('normal', 'normal-before');
  const field = new Field(); f.document.activeElement = field;
  s.state.contact.name = 'Typing a new name'; await settle(); await f.tick(5000);
  assert.equal(f.jobs('normal').length, 1); assert.equal(s.previewPages[0].svg, 'normal-before-0');
  assert.equal(s.isPreviewRendering, false);
  for (const values of [{ key: 'Enter', shiftKey: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }]) {
    f.inputEvent('keyup', field, values); await settle(); await f.tick(1000);
  }
  assert.equal(f.jobs('normal').length, 1, 'Shift+Enter and IME confirmation do not refresh a deferred preview');
  f.inputEvent('keyup', field, { key: 'Enter' }); await settle(); await f.tick(99);
  assert.equal(f.jobs('normal').length, 1);
  await f.tick(1); assert.equal(f.jobs('normal').length, 2, 'Enter releases a refresh even while the field remains focused');
  await f.complete('normal', 'normal-committed'); f.document.activeElement = null;

  s.activeBuilderGroup = 'privacy'; await settle(); await f.tick(500); await f.complete('privacy', 'privacy-before', 2);
  s.anonymizedPreviewPage = 2;
  f.document.activeElement = field;
  s.state.anonymization.excludedSections = ['education'];
  const privacyCommit = s.commitPrivacyPreview();
  await settle(); await privacyCommit;
  assert.equal(s.anonymizedPreviewPages[0].svg, 'privacy-before-0', 'privacy commit releases the deferred update after its model watcher');
  assert.equal(s.anonymizedPreviewPage, 2);
  await f.tick(499); assert.equal(f.jobs('privacy').length, 1);
  await f.tick(1); assert.equal(f.jobs('privacy').length, 2);
  await f.complete('privacy', 'privacy-committed', 2);
  f.document.activeElement = null;

  const range = new Field('range');
  s.onPreviewSliderPointerDown({ target: range } as unknown as PointerEvent);
  s.state.design.h1 = '47px'; await settle(); await f.tick(2000);
  assert.equal(f.jobs('privacy').length, 2); assert.equal(s.anonymizedPreviewPages[0].svg, 'privacy-committed-0');
  assert.equal(s.isAnonymizedPreviewRendering, false);
  f.window.dispatchEvent(new Event('pointerup')); await settle(); await f.tick(499);
  assert.equal(f.jobs('privacy').length, 2);
  await f.tick(1); assert.equal(f.jobs('privacy').length, 3);
  assert.equal(f.jobs('normal').length, 2, 'the hidden normal channel does not render during privacy slider release');
  await f.complete('privacy', 'slider-current');
});

test('Studio exports remain independent from previews and share only the last download error cycle', async t => {
  const f = mountStudio(t), s = f.setup;
  await settle(); await f.tick(100); await f.complete('normal', 'normal');
  const normal = s.handleExportPdf(), privacy = s.handleAnonymizedExportPdf(); await settle();
  assert.equal(f.downloads.length, 2); assert.equal(s.isExporting, true); assert.equal(s.isAnonymizedExporting, true);
  await s.handleExportPdf(); await s.handleAnonymizedExportPdf();
  assert.equal(f.downloads.length, 2, 'each variant independently deduplicates repeated activation');
  s.state.contact.name = 'Edited during both exports'; s.activeWorkspace = 'opportunities'; await settle();
  assert(f.downloads.every(download => !download.options.signal!.aborted), 'source edits and leaving Studio must preserve its existing export policy');
  f.downloads[0].job.reject(new Error('Normal download unavailable')); await normal;
  assert.equal(s.pdfExportError, 'Normal download unavailable'); assert.equal(s.isExporting, false); assert.equal(s.isAnonymizedExporting, true);
  f.downloads[1].job.resolve(); await privacy;
  assert.equal(s.pdfExportError, 'Normal download unavailable', 'another in-flight export succeeding does not clear the last failure');

  s.activeWorkspace = 'cv-studio'; s.requestPdfPreview(); await settle(); await f.tick(100);
  f.jobs('normal').at(-1)!.job.reject(new Error('Preview unavailable')); await settle();
  assert.equal(s.previewFailed, true); assert.equal(s.pdfExportError, 'Normal download unavailable', 'preview failure never replaces a download failure');
  s.requestPdfPreview(); await f.tick(100); await f.complete('normal', 'preview-recovered');
  assert.equal(s.pdfExportError, 'Normal download unavailable', 'preview success never clears a download failure');
  const retryPrivacy = s.handleAnonymizedExportPdf(); await settle();
  assert.equal(s.pdfExportError, '', 'starting either variant begins a new shared download error cycle');
  f.downloads.at(-1)!.job.reject(new Error('Privacy download unavailable')); await retryPrivacy;
  assert.equal(s.pdfExportError, 'Privacy download unavailable');
  const retryNormal = s.handleExportPdf(); await settle(); assert.equal(s.pdfExportError, '');
  f.downloads.at(-1)!.job.resolve(); await retryNormal; assert.equal(s.pdfExportError, '');
});

test('Studio deletion and disposal cancel outstanding exports and clean up the injected renderer once per owner action', async t => {
  const f = mountStudio(t), s = f.setup;
  await settle(); await f.tick(100); await f.complete('normal', 'before-delete');
  const deleted = s.handleExportPdf(); await settle();
  s.handleVersionDeleted();
  assert.equal(f.downloads[0].options.signal!.aborted, true);
  assert.deepEqual(s.previewPages, []); assert.equal(s.previewPage, 1); assert.equal(s.anonymizedPreviewPage, 1);
  assert.equal(s.previewMode, false); assert.equal(s.activeBuilderGroup, 'versions');
  assert.equal(f.revoked(), 1, 'the App owns injected-renderer download cleanup on deletion');
  f.downloads[0].job.resolve(); await deleted;
  const disposed = s.handleAnonymizedExportPdf(); await settle(); f.unmount();
  assert.equal(f.downloads[1].options.signal!.aborted, true);
  assert.equal(f.revoked(), 2, 'two shared controllers must not duplicate App-owned disposal');
  f.downloads[1].job.resolve(); await disposed;
});
