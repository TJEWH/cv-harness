import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, nextTick, ref, type Component } from 'vue';

const filename = new URL('../src/app/App.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'preview-recovery-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
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
const settle = async () => { for (let i = 0; i < 5; i++) await nextTick(); };

test('CV preview failures discard stale pages, retry, and ignore failures from superseded renders', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'error', () => {});
  const renders: ReturnType<typeof deferred<{ pages: { svg: string }[] }>>[] = [];
  const signals: AbortSignal[] = [];
  const downloads: ReturnType<typeof deferred<void>>[] = [];
  let app: ReturnType<typeof renderer.createApp>;
  t.after(() => app?.unmount());
  for (const [name, value] of Object.entries({
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
    document: { activeElement: null, addEventListener() {}, removeEventListener() {} }, Element: class {}, HTMLElement: class {},
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const exports: { default?: Component } = {};
  new Function('require', 'exports', code)((path: string) => {
    if (path.endsWith('.vue')) return { default: {} };
    if (path.endsWith('/useSupabaseAuth')) return { useSupabaseAuth: () => ({ user: ref(null), client: null }) };
    if (path.endsWith('/useCvDesign')) return { useCvDesign() {} };
    if (path.endsWith('/usePdfExport')) return { usePdfExport: () => ({
      renderPreview: (_element: unknown, options: { signal: AbortSignal }) => { signals.push(options.signal); const job = deferred<{ pages: { svg: string }[] }>(); renders.push(job); return job.promise; },
      exportToPdf: () => { const job = deferred<void>(); downloads.push(job); return job.promise; },
      revokeDownloads() {},
    }) };
    return requireFromApp(path);
  }, exports);
  app = renderer.createApp({ ...exports.default, render: () => null });
  const instance = app.mount({}) as unknown as { $: { setupState: {
    pdfRenderSource: unknown; anonymizedPdfRenderSource: unknown;
    previewPages: { svg: string }[]; anonymizedPreviewPages: { svg: string }[];
    previewFailed: boolean; anonymizedPreviewFailed: boolean; isPreviewRendering: boolean;
    activeBuilderGroup: string; activeWorkspace: string; isMobile: boolean; previewMode: boolean;
    state: { about: string };
    requestPdfPreview(): void; requestAnonymizedPdfPreview(): void;
    handleExportPdf(): Promise<void>; handleAnonymizedExportPdf(): Promise<void>;
  } } };
  const setup = instance.$.setupState;
  setup.pdfRenderSource = setup.anonymizedPdfRenderSource = { querySelector: () => ({}) };
  await settle();
  t.mock.timers.tick(100); await settle();
  renders.at(-1)!.resolve({ pages: [{ svg: '<svg>old</svg>' }] }); await settle();
  assert.equal(setup.previewPages.length, 1);

  setup.requestPdfPreview(); t.mock.timers.tick(100); await settle();
  renders.at(-1)!.reject(new Error('Font unavailable')); await settle();
  assert.equal(setup.previewFailed, true);
  assert.equal(setup.isPreviewRendering, false);
  assert.equal(setup.previewPages.length, 0, 'outdated pages must not masquerade as the failed new preview');

  setup.requestPdfPreview();
  assert.equal(setup.previewFailed, false);
  assert.equal(setup.isPreviewRendering, true);
  t.mock.timers.tick(100); await settle();
  const obsolete = renders.at(-1)!;
  setup.requestPdfPreview(); t.mock.timers.tick(100); await settle();
  renders.at(-1)!.resolve({ pages: [{ svg: '<svg>recovered</svg>' }] }); await settle();
  obsolete.reject(new Error('Late stale failure')); await settle();
  assert.equal(setup.previewFailed, false);
  assert.equal(setup.previewPages[0].svg, '<svg>recovered</svg>');

  setup.activeBuilderGroup = 'privacy'; await settle();
  setup.requestAnonymizedPdfPreview(); t.mock.timers.tick(500); await settle();
  renders.at(-1)!.reject(new Error('Private preview unavailable')); await settle();
  assert.equal(setup.anonymizedPreviewFailed, true);
  assert.equal(setup.previewFailed, false, 'privacy failures are independent from the ordinary preview');
  setup.requestAnonymizedPdfPreview(); t.mock.timers.tick(500); await settle();
  renders.at(-1)!.resolve({ pages: [{ svg: '<svg>private</svg>' }] }); await settle();
  assert.equal(setup.anonymizedPreviewFailed, false);
  assert.equal(setup.anonymizedPreviewPages.length, 1);

  for (const exportPdf of [setup.handleExportPdf, setup.handleAnonymizedExportPdf]) {
    const count = downloads.length;
    const pending = exportPdf();
    await exportPdf(); await settle();
    assert.equal(downloads.length, count + 1, 'repeated activation must not start duplicate exports');
    downloads.at(-1)!.resolve(); await pending;
  }

  const completed = renders.length;
  setup.activeBuilderGroup = 'templates'; await settle();
  setup.state.about = 'An edit made while the preview is hidden'; await settle();
  t.mock.timers.tick(1000); await settle();
  assert.equal(renders.length, completed, 'Templates does not spend time on hidden PDF layouts');
  setup.isMobile = true;
  setup.activeBuilderGroup = 'content'; await settle();
  t.mock.timers.tick(1000); await settle();
  assert.equal(renders.length, completed, 'phone editing leaves PDF work until the preview is opened');
  setup.previewMode = true; await settle();
  t.mock.timers.tick(100); await settle();
  assert.equal(renders.length, completed + 1, 'opening the phone preview renders the latest edits once');
  renders.at(-1)!.resolve({ pages: [{ svg: '<svg>phone</svg>' }] }); await settle();
  setup.previewMode = false; await settle();
  setup.previewMode = true; await settle();
  t.mock.timers.tick(1000); await settle();
  assert.equal(renders.length, completed + 1, 'reopening an unchanged preview reuses its pages');
  setup.previewMode = false;
  setup.state.about = 'A later edit'; await settle();
  setup.isMobile = false; await settle();
  t.mock.timers.tick(100); await settle();
  assert.equal(renders.length, completed + 2, 'returning to desktop refreshes its visible preview');
  setup.activeWorkspace = 'opportunities'; await settle();
  assert.equal(signals.at(-1)!.aborted, true, 'leaving CV Studio cancels an in-flight preview');
  renders.at(-1)!.resolve({ pages: [{ svg: '<svg>obsolete</svg>' }] }); await settle();
  assert.equal(setup.previewPages[0].svg, '<svg>phone</svg>', 'a hidden cancelled render cannot replace the last preview');
});
