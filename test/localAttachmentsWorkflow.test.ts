import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { computed, createRenderer, h, nextTick, ref, type Component } from 'vue';
import { PDFDocument } from 'pdf-lib';
import type { ApplicationPackageManifest, AttachmentMetadata, LocalDocument, LocalDocumentMetadata, PackageCompositionResult } from '../src/features/attachments/documentTypes';
import { LocalDocumentRepository, type LocalDocumentStorage } from '../src/features/attachments/data/localDocuments';
import { attachmentAccount, createAttachmentFixture } from './attachmentFixture';

const requireFromComponents = createRequire(new URL('../src/features/attachments/components/LocalAttachments.vue', import.meta.url));
const { registerTextareaCommit } = requireFromComponents('../../../shared/editing/textareaCommit') as typeof import('../src/shared/editing/textareaCommit');
const { useToasts } = requireFromComponents('../../../shared/ui/useToasts') as typeof import('../src/shared/ui/useToasts');

const componentPaths = {
  LocalAttachments: '../src/features/attachments/components/LocalAttachments.vue',
  ApplicationDocuments: '../src/features/applications/components/ApplicationDocuments.vue',
} as const;
function component(name: keyof typeof componentPaths) {
  const filename = new URL(componentPaths[name], import.meta.url);
  const { descriptor } = parse(readFileSync(filename, 'utf8'));
  const compiled = compileScript(descriptor, { id: `local-attachment-${name}` });
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { default?: Component } = {}; const requireComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => {
    if (path.endsWith('.vue')) return { default: {} };
    if (path.endsWith('/usePdfBlobPreview')) return { usePdfBlobPreview: (source: () => Blob | null) => ({
      pages: computed(() => source() ? [{ svg: '<svg />' }] : []), loading: ref(false), error: ref(''), retry() {},
    }) };
    return requireComponent(path);
  }, exports);
  return { ...exports.default, render: () => null };
}
const Library = component('LocalAttachments');
const Application = component('ApplicationDocuments');
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
type Entry = AttachmentMetadata & { local?: LocalDocumentMetadata };
interface LibraryState {
  loading: boolean; loadFailed: boolean; busy: boolean; error: string; name: string; description: string; file: File | null;
  formVisible: boolean; formCollapsed: boolean; dirty: boolean; flush(): boolean;
  commitDescription(): void; cancelEdit(): void; toggleForm(): void;
  entries: Entry[]; localDocuments: LocalDocumentMetadata[]; sharedDocuments: AttachmentMetadata[]; editingId: string;
  previewDocument: LocalDocument | null; previewUrl: string; previewPage: number;
  edit(entry?: Entry): void; chooseFile(event: Event): void; save(): Promise<void>; load(): Promise<void>;
  useFile(entry: Entry, action: 'open' | 'download'): Promise<void>; clearPreview(): void;
}
interface ApplicationState {
  loading: boolean; busy: boolean; error: string; selectedLibraryId: string; canAttach: boolean;
  manifest: ApplicationPackageManifest; libraryOptions: Entry[];
  composition: PackageCompositionResult | null; previewPage: number; previewBusy: boolean; previewFailed: boolean; buildPreview(): Promise<void>;
  moveItem(index: number, direction: number): void;
  attachLibraryDocument(): void; removeItem(id: string): void; load(): Promise<void>;
}
const pdf = () => new File(['%PDF-1.4\nSynthetic document bytes.'], 'PRIVATE-original-file-name.pdf', { type: 'application/pdf' });
function fileEvent(file: File) { return { target: { files: [file], value: file.name } } as unknown as Event; }
async function idle(setup: { loading: boolean; busy: boolean; previewBusy?: boolean }) {
  for (let i = 0; i < 1000; i++) { await nextTick(); await new Promise<void>(resolve => setTimeout(resolve, 5)); if (!setup.loading && !setup.busy && !setup.previewBusy) return; }
  assert.fail('Attachment component did not become idle.');
}
function mount<T extends LibraryState | ApplicationState>(t: TestContext, view: Component, fixture = createAttachmentFixture(), storage: LocalDocumentStorage = fixture.storage, overrides: Record<string, unknown> = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const draftData = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => draftData.get(key) ?? null,
    setItem: (key: string, value: string) => { draftData.set(key, value); },
    removeItem: (key: string) => { draftData.delete(key); },
  } });
  const target = new EventTarget(); Object.assign(target, { confirm: () => true, setTimeout: () => 1 });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  const owner = ref(attachmentAccount); let mounted: unknown;
  const props = ref(overrides);
  const app = renderer.createApp({ render: () => h(view, {
    userId: owner.value, client: fixture.client, storage, lang: 'en', applicationId: 'synthetic-application',
    cvState: null, letterReady: false, getCvPdf: async () => pdf(), getLetterPdf: async () => pdf(),
    ...props.value,
    ref: (value: unknown) => { mounted = value; },
  }) });
  let isMounted = true;
  const unmount = () => { if (isMounted) { app.unmount(); isMounted = false; } };
  app.mount({}); t.after(() => {
    try { unmount(); useToasts().clear(); }
    finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
  return { fixture, unmount, draftData, exposed: mounted as { flush(): boolean }, setup: (mounted as { $: { setupState: T } }).$.setupState, setProps(value: Record<string, unknown>) { props.value = { ...props.value, ...value }; }, switchAccount(value: string) { fixture.setOwner(value); owner.value = value; } };
}

test('attachment creation requires manual metadata, never derives it from the filename, and uploads only those fields', async t => {
  const { setup, fixture } = mount<LibraryState>(t, Library); await idle(setup);
  setup.edit(); setup.chooseFile(fileEvent(pdf()));
  assert.equal(setup.name, ''); assert.equal(setup.description, '');
  await setup.save(); assert.match(setup.error, /Enter a name and description yourself/);
  assert.equal(fixture.local.size, 0); assert.equal(fixture.rows.length, 0);
  setup.name = 'Transcript of records'; await setup.save(); assert.equal(fixture.local.size, 0);
  setup.description = 'Academic modules and grades for application preparation.'; await setup.save();
  assert.equal(setup.error, ''); assert.equal(setup.entries.length, 1); assert.equal(fixture.rows.length, 1);
  const saved = fixture.calls.find(call => call.name === 'save_local_attachment_metadata')!;
  assert.deepEqual(Object.keys(saved.args).sort(), ['p_description', 'p_id', 'p_name']);
  assert.equal(saved.args.p_name, 'Transcript of records');
  assert.doesNotMatch(JSON.stringify(fixture.calls), /PRIVATE-original-file-name|Synthetic document bytes|blob|mimeType/);
  const original = await new LocalDocumentRepository(attachmentAccount, fixture.storage).getDocument(String(saved.args.p_id));
  assert.equal(await original!.blob.text(), await pdf().text());
});

test('an unavailable local library stays in a recoverable error state until retry loads its files', async t => {
  const fixture = createAttachmentFixture();
  await new LocalDocumentRepository(attachmentAccount, fixture.storage).addDocument(pdf(), 'Saved transcript', 'Academic record.');
  let failRead = true;
  const storage = { ...fixture.storage, async list(...args: Parameters<LocalDocumentStorage['list']>) {
    if (failRead && args[1] === 'documents') throw new Error('Local file storage is temporarily unavailable');
    return fixture.storage.list(...args);
  } };
  const { setup } = mount<LibraryState>(t, Library, fixture, storage, { client: null });
  await idle(setup);
  assert.equal(setup.loading, false); assert.equal(setup.loadFailed, true);
  assert.equal(setup.entries.length, 0); assert.match(setup.error, /temporarily unavailable/);
  failRead = false; await setup.load(); await idle(setup);
  assert.equal(setup.loadFailed, false); assert.equal(setup.error, '');
  assert.equal(setup.entries.length, 1); assert.equal(setup.entries[0].name, 'Saved transcript');
});

test('failed metadata syncing preserves local bytes and retries the same attachment ID, including later edits', async t => {
  const { setup, fixture } = mount<LibraryState>(t, Library); await idle(setup); fixture.failSave(true);
  setup.edit(); setup.name = 'Recommendation'; setup.description = 'A reference describing research collaboration.'; setup.chooseFile(fileEvent(pdf()));
  await setup.save(); assert.match(setup.error, /saved locally.*sync failed/); assert.equal(setup.localDocuments.length, 1);
  const id = setup.editingId; assert.ok(id); assert.equal(setup.file, null); assert.equal(fixture.rows.length, 0);
  fixture.failSave(false); await setup.save(); assert.equal(setup.error, ''); assert.equal(setup.localDocuments.length, 1);
  assert.equal(fixture.rows.length, 1); assert.equal(fixture.rows[0].id, id);
  const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage); const original = await repo.getDocument(id);
  assert.equal(await original!.blob.text(), await pdf().text());
  setup.edit(setup.entries[0]); setup.description = 'The approved reference from a research supervisor.'; fixture.failSave(true);
  await setup.save(); assert.match(setup.error, /saved locally/); assert.equal((await repo.getDocument(id))?.description, setup.description);
  await setup.load(); assert.equal(setup.entries[0].description, setup.description, 'a cloud read cannot overwrite unsynced local metadata');
  fixture.failSave(false); await setup.save(); assert.equal(setup.error, ''); assert.equal(fixture.rows[0].description, 'The approved reference from a research supervisor.');
  assert.equal(fixture.rows.length, 1); assert.equal((await repo.listDocuments()).length, 1);
});

test('legacy files do not sync automatically and cloud metadata can be relinked to a local file without a duplicate', async t => {
  const fixture = createAttachmentFixture(); const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const legacy = await repo.addDocument(pdf(), 'Old transcript');
  const remoteId = '90000000-0000-4000-8000-000000000091';
  fixture.rows.push({ id: remoteId, user_id: attachmentAccount, name: 'Reference', description: 'A manually entered reference description.' });
  const { setup } = mount<LibraryState>(t, Library, fixture); await idle(setup);
  assert.equal(setup.entries.length, 2); assert.equal(fixture.calls.filter(call => call.name.startsWith('save')).length, 0);
  setup.edit(setup.entries.find(entry => entry.id === legacy.id)); assert.equal(setup.name, ''); assert.equal(setup.description, '');
  await setup.save(); assert.match(setup.error, /Enter a name and description yourself/);
  setup.description = 'A manually reviewed academic record.'; await setup.save(); assert.equal(fixture.rows.length, 1, 'the legacy filename is not an approved attachment name');
  setup.name = 'Manually named academic record'; await setup.save(); assert.equal(fixture.rows.length, 2);
  setup.edit(setup.entries.find(entry => entry.id === remoteId)); setup.chooseFile(fileEvent(pdf())); await setup.save();
  assert.equal(setup.error, ''); assert.equal(fixture.rows.length, 2); assert.ok(await repo.getDocument(remoteId));
  assert.equal((await repo.listDocuments()).length, 2);
});

test('switching accounts ignores a delayed local read from the previous account', async t => {
  const fixture = createAttachmentFixture();
  await new LocalDocumentRepository(attachmentAccount, fixture.storage).addDocument(pdf(), 'Old account attachment', 'Old account description.');
  const nextOwner = '90000000-0000-4000-8000-000000000092';
  await new LocalDocumentRepository(nextOwner, fixture.storage).addDocument(pdf(), 'New account attachment', 'New account description.');
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const storage = { ...fixture.storage, async list(scope: string, collection: Parameters<LocalDocumentStorage['list']>[1]) {
    const result = await fixture.storage.list(scope, collection); if (scope === `account:${attachmentAccount}`) await blocked; return result;
  } };
  const { setup, switchAccount } = mount<LibraryState>(t, Library, fixture, storage);
  await nextTick(); switchAccount(nextOwner); await idle(setup);
  assert.equal(setup.entries[0].name, 'New account attachment'); release(); await idle(setup);
  assert.equal(setup.entries.length, 1); assert.equal(setup.entries[0].name, 'New account attachment');
});

test('local PDF preview keeps original bytes, resets page selection and ignores an older open request', async t => {
  const fixture = createAttachmentFixture(), repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const first = await repo.addDocument(pdf(), 'First attachment', 'First local document.');
  const latest = await repo.addDocument(pdf(), 'Latest attachment', 'Latest local document.');
  let release!: () => void, reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  const storage = { ...fixture.storage, async get(...args: Parameters<LocalDocumentStorage['get']>) {
    const result = await fixture.storage.get(...args);
    if (args[2] === first.id) { reading(); await blocked; }
    return result;
  } };
  const { setup, unmount } = mount<LibraryState>(t, Library, fixture, storage); await idle(setup);
  const stale = setup.useFile(setup.entries.find(entry => entry.id === first.id)!, 'open'); await started;
  await setup.useFile(setup.entries.find(entry => entry.id === latest.id)!, 'open');
  assert.equal(setup.previewDocument?.id, latest.id);
  assert.equal(setup.previewUrl, '', 'PDFs must go to the shared viewer without creating a native object URL');
  assert.equal(await setup.previewDocument!.blob.text(), await pdf().text());
  release(); await stale;
  assert.equal(setup.previewDocument?.id, latest.id, 'An earlier file read cannot replace the newest preview');
  setup.previewPage = 2; setup.clearPreview();
  assert.equal(setup.previewDocument, null); assert.equal(setup.previewPage, 1);
  await setup.useFile(setup.entries.find(entry => entry.id === latest.id)!, 'open');
  assert.equal((setup.previewDocument as LocalDocument | null)?.id, latest.id); assert.equal(setup.previewPage, 1);
  unmount(); assert.equal(setup.previewDocument, null);
});

test('closing, leaving the library or changing accounts prevents a delayed attachment from reopening', async t => {
  for (const invalidate of ['close', 'inactive', 'account'] as const) await t.test(invalidate, async child => {
    const fixture = createAttachmentFixture(), repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
    const saved = await repo.addDocument(pdf(), 'Private attachment', 'Local document from the current account.');
    let release!: () => void, reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
    const storage = { ...fixture.storage, async get(...args: Parameters<LocalDocumentStorage['get']>) {
      const result = await fixture.storage.get(...args); if (args[2] === saved.id) { reading(); await blocked; } return result;
    } };
    const { setup, setProps, switchAccount } = mount<LibraryState>(child, Library, fixture, storage); await idle(setup);
    const pending = setup.useFile(setup.entries[0]!, 'open'); await started;
    if (invalidate === 'close') setup.clearPreview();
    else if (invalidate === 'inactive') setProps({ active: false });
    else switchAccount('90000000-0000-4000-8000-000000000092');
    await nextTick(); release(); await pending; await idle(setup);
    assert.equal(setup.previewDocument, null); assert.equal(setup.previewUrl, ''); assert.equal(setup.error, '');
  });
});

test('switching accounts during a local save does not publish metadata to the next account', async t => {
  const fixture = createAttachmentFixture(); let blockWrites = false;
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const storage = { ...fixture.storage, async write(...args: Parameters<LocalDocumentStorage['write']>) {
    await fixture.storage.write(...args); if (blockWrites) await blocked;
  } };
  const { setup, switchAccount } = mount<LibraryState>(t, Library, fixture, storage); await idle(setup);
  setup.edit(); setup.name = 'Old account file'; setup.description = 'Old account private description.'; setup.chooseFile(fileEvent(pdf()));
  blockWrites = true; const save = setup.save(); await nextTick(); await new Promise<void>(resolve => setImmediate(resolve));
  switchAccount('90000000-0000-4000-8000-000000000092'); await idle(setup); release(); await save;
  assert.equal(setup.entries.length, 0); assert.equal(setup.name, '');
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
  assert.equal((await new LocalDocumentRepository(attachmentAccount, fixture.storage).listDocuments()).length, 1);
});

test('applications select reusable files once, remove only the package reference, and block unavailable or undescribed entries', async t => {
  const fixture = createAttachmentFixture(); const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const saved = await repo.addDocument(pdf(), 'Transcript', 'Academic record.'), legacy = await repo.addDocument(pdf(), 'Legacy reference');
  const missingId = '90000000-0000-4000-8000-000000000093';
  fixture.rows.push({ id: missingId, user_id: attachmentAccount, name: 'Missing local file', description: 'A known file on another device.' });
  const { setup } = mount<ApplicationState>(t, Application, fixture); await idle(setup);
  setup.selectedLibraryId = missingId; assert.equal(setup.canAttach, false); setup.attachLibraryDocument();
  setup.selectedLibraryId = legacy.id; assert.equal(setup.canAttach, false); setup.attachLibraryDocument();
  assert.equal(setup.manifest.items.length, 2);
  setup.selectedLibraryId = saved.id; assert.equal(setup.canAttach, true); setup.attachLibraryDocument(); await idle(setup);
  assert.equal(setup.manifest.items.length, 3); assert.equal(setup.libraryOptions.some(entry => entry.id === saved.id), false);
  setup.selectedLibraryId = saved.id; setup.attachLibraryDocument(); await idle(setup); assert.equal(setup.manifest.items.length, 3);
  const item = setup.manifest.items.find(item => item.documentId === saved.id)!; setup.removeItem(item.id); await idle(setup);
  assert.equal(setup.manifest.items.length, 2); assert.ok(await repo.getDocument(saved.id)); assert.equal(fixture.rows.length, 1);
});

test('attachment changes during PDF composition invalidate the pending preview before it can be downloaded', async t => {
  const fixture = createAttachmentFixture(); const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const document = await PDFDocument.create(); document.addPage();
  const saved = await repo.addDocument(new Blob([new Uint8Array(await document.save())], { type: 'application/pdf' }), 'Transcript', 'Approved academic record.');
  await repo.saveManifest({ applicationId: 'synthetic-application', updatedAt: new Date().toISOString(), items: [{ id: 'selected-attachment', kind: 'attachment', documentId: saved.id, label: saved.name, included: true }] });
  let release!: () => void, reading!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { reading = resolve; });
  const storage = { ...fixture.storage, async get(...args: Parameters<LocalDocumentStorage['get']>) {
    const result = await fixture.storage.get(...args); if (args[1] === 'documents') { reading(); await blocked; } return result;
  } };
  const { setup } = mount<ApplicationState>(t, Application, fixture, storage); await started;
  await repo.removeDocument(saved.id); window.dispatchEvent(new Event('cv-local-documents-updated')); release();
  await idle(setup);
  assert.equal(setup.composition, null); assert.equal(setup.previewPage, 1);
  assert.equal(setup.manifest.items.length, 1, 'the manifest keeps the missing attachment reference');
  assert.equal(setup.libraryOptions.length, 0);
});

async function renderedPdf(width = 595.28) {
  const output = await PDFDocument.create(); output.addPage([width, 841.89]);
  return new Blob([new Uint8Array(await output.save())], { type: 'application/pdf' });
}

test('ready packages preview automatically only in the active review, and update after order and readiness changes', async t => {
  const fixture = createAttachmentFixture(); const generated = await renderedPdf(); let calls = 0;
  const { setup, setProps, unmount } = mount<ApplicationState>(t, Application, fixture, fixture.storage, {
    active: true, mode: 'prepare', cvReady: true, letterReady: true,
    getCvPdf: async () => { calls++; return generated; }, getLetterPdf: async () => generated,
  });
  await idle(setup); assert.equal(calls, 0); assert.equal(Boolean(setup.composition), false);
  setProps({ mode: 'review', active: false }); await idle(setup); assert.equal(calls, 0);
  setProps({ active: true }); await idle(setup);
  assert.equal(calls, 1); assert.equal(setup.composition?.pageCount, 2); assert.ok(setup.composition);
  assert.equal(setup.previewPage, 1);
  setup.previewPage = 2;
  const firstBlob = setup.composition!.blob;
  const originalOrder = setup.composition!.documents.map(item => item.itemId);
  setup.moveItem(0, 1); await idle(setup);
  assert.equal(calls, 2); assert.deepEqual(setup.composition!.documents.map(item => item.itemId), originalOrder.reverse());
  assert.notEqual(setup.composition!.blob, firstBlob); assert.equal(setup.previewPage, 1, 'A rebuilt package resets page navigation');
  setup.previewPage = 2;
  setProps({ exportReady: false }); await idle(setup);
  assert.equal(setup.previewPage, 1); assert.equal(setup.composition, null); assert.equal(calls, 2);
  setProps({ exportReady: true }); await idle(setup); assert.equal(calls, 3); assert.ok(setup.composition);
  assert.equal(setup.previewPage, 1);
  unmount(); assert.equal(setup.composition, null, 'Unmounting must clear the composed document');
});

test('edits during automatic PDF rendering discard stale results and render the newest revision', async t => {
  const fixture = createAttachmentFixture(); const [oldPdf, newPdf] = await Promise.all([renderedPdf(300), renderedPdf(500)]);
  let release!: () => void, reading!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { reading = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const { setup, setProps } = mount<ApplicationState>(t, Application, fixture, fixture.storage, {
    cvReady: true, letterReady: true, getLetterPdf: async () => newPdf,
    getCvPdf: async () => { calls++; if (calls === 1) { reading(); await blocked; return oldPdf; } return newPdf; },
  });
  await started; setProps({ letterRevision: 'new revision' }); await nextTick(); release(); await idle(setup);
  assert.equal(calls, 2); assert.ok(setup.composition); assert.equal(setup.error, '');
  assert.equal(setup.previewPage, 1);
  const output = await PDFDocument.load(await setup.composition!.blob.arrayBuffer());
  assert.ok(output.getPages().every(page => page.getWidth() === 500));
});

test('a failed automatic preview stops retrying and can recover with a single explicit retry', async t => {
  const fixture = createAttachmentFixture(); const generated = await renderedPdf(); let calls = 0, fail = true;
  const { setup } = mount<ApplicationState>(t, Application, fixture, fixture.storage, {
    cvReady: true, letterReady: true, getLetterPdf: async () => generated,
    getCvPdf: async () => { calls++; if (fail) throw new Error('Synthetic PDF render failure'); return generated; },
  });
  await idle(setup); assert.equal(calls, 1); assert.equal(setup.previewFailed, true); assert.equal(setup.composition, null);
  assert.equal(setup.previewPage, 1);
  assert.match(setup.error, /Synthetic PDF render failure/);
  await idle(setup); assert.equal(calls, 1, 'A failed PDF must not cause an automatic retry loop');
  fail = false; await setup.buildPreview(); await idle(setup);
  assert.equal(calls, 2); assert.equal(setup.previewFailed, false); assert.equal(setup.error, ''); assert.ok(setup.composition);
});


test('attachment description commits retain a private draft until the explicit attachment save', async t => {
  const fixture = createAttachmentFixture();
  const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const saved = await repo.addDocument(pdf(), 'Transcript', 'Previously approved description.');
  const { setup, draftData, switchAccount } = mount<LibraryState>(t, Library, fixture);
  await idle(setup);
  setup.edit(setup.entries[0]);
  setup.description = 'A new description waiting for approval.';
  assert.equal(draftData.size, 0, 'typing does not persist the textarea');
  setup.commitDescription();
  assert.equal(draftData.size, 1, 'blur or Enter saves a local draft');
  assert.equal((await repo.getDocument(saved.id))?.description, 'Previously approved description.');
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0, 'a textarea commit cannot approve metadata for sharing');

  setup.edit(); assert.equal(setup.description, '');
  setup.edit(setup.entries[0]); assert.equal(setup.description, 'A new description waiting for approval.');
  switchAccount('90000000-0000-4000-8000-000000000092'); await idle(setup);
  setup.edit(); assert.equal(setup.description, '', 'account changes cannot expose another account’s private draft');
  switchAccount(attachmentAccount); await idle(setup);
  setup.edit(setup.entries[0]); assert.equal(setup.description, 'A new description waiting for approval.');
  await setup.save();
  assert.equal(draftData.size, 0, 'successful explicit save clears the matching draft');
  assert.equal(fixture.rows[0]?.description, 'A new description waiting for approval.');
});

test('reopening the new attachment editor preserves its selected file and commits only a private draft', async t => {
  const { setup, fixture, draftData } = mount<LibraryState>(t, Library); await idle(setup);
  const selectedFile = pdf();
  setup.edit(); setup.name = 'Research reference'; setup.chooseFile(fileEvent(selectedFile));
  let pendingDescription = 'A private description waiting for the explicit attachment save.';
  const unregister = registerTextareaCommit(() => {
    if (!pendingDescription) return;
    setup.description = pendingDescription; pendingDescription = ''; setup.commitDescription();
  });
  t.after(unregister);

  setup.edit();

  assert.equal(setup.formVisible, true); assert.equal(setup.formCollapsed, false);
  assert.equal(setup.editingId, ''); assert.equal(setup.name, 'Research reference');
  assert.equal(setup.description, 'A private description waiting for the explicit attachment save.');
  assert.equal(setup.file, selectedFile, 'reopening an existing new draft cannot discard the selected file');
  assert.deepEqual([...draftData.values()].map(value => JSON.parse(value)), [{ name: setup.name, description: setup.description }]);
  assert.equal(fixture.local.size, 0, 'reopening a draft cannot create a local attachment');
  assert.equal(fixture.rows.length, 0);
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
});

test('collapsing and reopening the attachment editor retains its file and private text without publishing metadata', async t => {
  const { setup, fixture, draftData } = mount<LibraryState>(t, Library); await idle(setup);
  const selectedFile = pdf();
  setup.edit(); setup.name = 'Academic record'; setup.chooseFile(fileEvent(selectedFile));
  let pendingDescription = 'Academic modules and grades, still a private draft.';
  const unregister = registerTextareaCommit(() => {
    if (!pendingDescription) return;
    setup.description = pendingDescription; pendingDescription = ''; setup.commitDescription();
  });
  t.after(unregister);

  setup.toggleForm();
  assert.equal(setup.formCollapsed, true); assert.equal(setup.formVisible, true);
  assert.equal(setup.description, 'Academic modules and grades, still a private draft.');
  assert.deepEqual([...draftData.values()].map(value => JSON.parse(value)), [{ name: setup.name, description: setup.description }]);
  setup.toggleForm();
  assert.equal(setup.formCollapsed, false); assert.equal(setup.file, selectedFile);
  setup.toggleForm(); setup.edit();
  assert.equal(setup.formCollapsed, false, 'New attachment reopens its existing collapsed draft');
  assert.equal(setup.name, 'Academic record'); assert.equal(setup.file, selectedFile);
  assert.equal(fixture.local.size, 0); assert.equal(fixture.rows.length, 0);
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
});

test('a failed attachment draft write prevents collapse and preserves the editor for retry', async t => {
  const { setup, fixture, draftData } = mount<LibraryState>(t, Library); await idle(setup);
  const selectedFile = pdf();
  setup.edit(); setup.name = 'Reference letter'; setup.description = 'Unsaved private context.'; setup.chooseFile(fileEvent(selectedFile));
  const writes = t.mock.method(localStorage, 'setItem', () => { throw new Error('Storage full'); });

  setup.toggleForm();

  assert.equal(setup.formVisible, true); assert.equal(setup.formCollapsed, false);
  assert.equal(setup.name, 'Reference letter'); assert.equal(setup.description, 'Unsaved private context.');
  assert.equal(setup.file, selectedFile); assert.equal(setup.error, 'Storage full');
  assert.equal(draftData.size, 0); assert.equal(fixture.local.size, 0); assert.equal(fixture.rows.length, 0);
  writes.mock.restore(); setup.toggleForm();
  assert.equal(setup.formCollapsed, true); assert.equal(setup.file, selectedFile);
  assert.deepEqual([...draftData.values()].map(value => JSON.parse(value)), [{ name: setup.name, description: setup.description }]);
});

test('cancelling attachment edits clears the private description draft', async t => {
  const { setup, draftData } = mount<LibraryState>(t, Library); await idle(setup);
  setup.edit(); setup.description = 'Unapproved local description.'; setup.commitDescription();
  assert.equal(draftData.size, 1);
  setup.cancelEdit(); assert.equal(draftData.size, 0);
  setup.edit(); assert.equal(setup.description, '');
});

test('a failed attachment draft commit keeps the current editor until a retry succeeds', async t => {
  const fixture = createAttachmentFixture();
  await new LocalDocumentRepository(attachmentAccount, fixture.storage).addDocument(pdf(), 'Transcript', 'Approved description.');
  const { setup } = mount<LibraryState>(t, Library, fixture); await idle(setup);
  const selected = setup.entries[0]; setup.edit(selected);
  setup.description = 'Unsaved description that must remain available.';
  const writes = t.mock.method(localStorage, 'setItem', () => { throw new Error('Storage full'); });
  setup.commitDescription(); setup.edit();
  assert.equal(setup.editingId, selected.id);
  assert.equal(setup.description, 'Unsaved description that must remain available.');
  assert.equal(setup.error, 'Storage full');
  writes.mock.restore(); setup.edit(); assert.equal(setup.editingId, '');
  setup.edit(selected); assert.equal(setup.description, 'Unsaved description that must remain available.');
});

test('the public attachment flush waits for native readiness and writes private text without saving or sharing a file', async t => {
  const { setup, exposed, fixture, draftData } = mount<LibraryState>(t, Library); await idle(setup);
  assert.equal(exposed.flush(), true); assert.equal(draftData.size, 0);
  setup.edit(); const selectedFile = pdf(); setup.chooseFile(fileEvent(selectedFile)); setup.name = 'Private reference';
  let ready = false; let published = false;
  const unregister = registerTextareaCommit(() => {
    if (published) return;
    published = true; setup.description = 'A native description awaiting explicit approval.'; setup.commitDescription();
  }, () => ready);
  t.after(unregister);
  assert.equal(exposed.flush(), false); setup.toggleForm();
  assert.equal(published, false); assert.equal(setup.formCollapsed, false); assert.equal(draftData.size, 0);
  ready = true; assert.equal(exposed.flush(), true);
  assert.equal(published, true); assert.equal(setup.file, selectedFile);
  assert.deepEqual([...draftData.values()].map(value => JSON.parse(value)), [{ name: setup.name, description: setup.description }]);
  assert.doesNotMatch([...draftData.values()].join(''), /PRIVATE-original-file-name|Synthetic document bytes|mimeType/);
  assert.equal(fixture.local.size, 0); assert.equal(fixture.rows.length, 0);
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
});

test('unavailable private attachment storage blocks flush and retries without approving metadata', async t => {
  const { setup, exposed, fixture, draftData } = mount<LibraryState>(t, Library); await idle(setup);
  const storage = localStorage;
  setup.edit(); setup.name = 'Private record'; setup.description = 'Recovery text'; setup.chooseFile(fileEvent(pdf()));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  assert.equal(exposed.flush(), false); assert.match(setup.error, /draft storage is unavailable/i);
  assert.equal(useToasts().toasts.value.at(-1)?.tone, 'error');
  const retry = useToasts().toasts.value.at(-1)?.action?.run; assert.ok(retry);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  assert.equal(await retry(), true); assert.equal(setup.error, ''); assert.equal(draftData.size, 1);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage access denied'); } });
  assert.equal(exposed.flush(), false); assert.equal(setup.error, 'Storage access denied');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  assert.equal(exposed.flush(), true);
  assert.equal(fixture.local.size, 0); assert.equal(fixture.rows.length, 0);
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
});

test('failed private attachment drafts restore only to their owner and stale retry actions never publish them', async t => {
  const fixture = createAttachmentFixture();
  const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const saved = await repo.addDocument(pdf(), 'Approved transcript', 'Previously approved text.');
  const { setup, exposed, switchAccount, draftData } = mount<LibraryState>(t, Library, fixture); await idle(setup);
  setup.edit(setup.entries[0]); const ownerFile = pdf(); setup.chooseFile(fileEvent(ownerFile));
  setup.name = 'Private owner name'; setup.description = 'Private owner description.';
  const writes = t.mock.method(localStorage, 'setItem', () => { throw new Error('Private storage full'); });
  assert.equal(exposed.flush(), false);
  const ownerRetry = useToasts().toasts.value.at(-1)?.action?.run; assert.ok(ownerRetry);
  setup.description = 'Latest private owner description.';
  const other = '90000000-0000-4000-8000-000000000092';
  switchAccount(other); await idle(setup);
  assert.equal(setup.formVisible, false); assert.equal(setup.file, null); assert.equal(setup.description, '');
  assert.equal(await ownerRetry(), false);
  setup.edit(); const otherFile = pdf(); setup.chooseFile(fileEvent(otherFile));
  setup.name = 'Other private name'; setup.description = 'Other private description.';
  assert.equal(exposed.flush(), false);
  const otherRetry = useToasts().toasts.value.at(-1)?.action?.run; assert.ok(otherRetry);
  switchAccount(attachmentAccount); await idle(setup);
  assert.equal(setup.editingId, saved.id); assert.equal(setup.name, 'Private owner name');
  assert.equal(setup.description, 'Latest private owner description.'); assert.equal(setup.file, ownerFile);
  assert.equal(await ownerRetry(), false, 'an earlier owner session cannot resume after a forced reset');
  assert.equal(await otherRetry(), false); assert.equal(draftData.size, 0);
  const currentRetry = useToasts().toasts.value.at(-1)?.action?.run; assert.ok(currentRetry);
  writes.mock.restore(); assert.equal(await currentRetry(), true);
  assert.equal(setup.file, ownerFile); assert.equal(setup.formVisible, true);
  assert.equal((await repo.getDocument(saved.id))?.description, 'Previously approved text.');
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
  switchAccount(other); await idle(setup);
  assert.equal(setup.name, 'Other private name'); assert.equal(setup.file, otherFile);
  setup.cancelEdit();
  switchAccount(attachmentAccount); await idle(setup);
  assert.equal(setup.formVisible, false, 'successfully recovered drafts no longer have a failed in-memory editor');
  switchAccount(other); await idle(setup);
  assert.equal(setup.formVisible, false, 'explicit discard removes the other owner’s failed in-memory editor');
  assert.equal(fixture.rows.length, 0); assert.equal((await repo.listDocuments()).length, 1);
});

test('attachment flush rejects a synchronous record A–B–A change during native publication', async t => {
  const fixture = createAttachmentFixture();
  await new LocalDocumentRepository(attachmentAccount, fixture.storage).addDocument(pdf(), 'Approved transcript', 'Previously approved text.');
  const { setup, exposed, draftData } = mount<LibraryState>(t, Library, fixture); await idle(setup);
  setup.edit(); setup.name = 'Private new record'; setup.description = 'Earlier private draft.'; setup.chooseFile(fileEvent(pdf()));
  let pending = true;
  const unregister = registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    setup.edit(setup.entries[0]); setup.edit();
    setup.description = 'A later private draft from the replacement editor lifecycle.';
  });
  try {
    assert.equal(exposed.flush(), false);
    assert.equal(setup.editingId, '');
    const saved = [...draftData.entries()].find(([key]) => key.endsWith(':new'));
    assert.equal(JSON.parse(saved![1]).description, 'Earlier private draft.', 'the outer flush cannot persist text from a replacement editor lifecycle');
    assert.equal(setup.description, 'A later private draft from the replacement editor lifecycle.');
    assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
  } finally { unregister(); }
  assert.equal(exposed.flush(), true);
  assert.ok([...draftData.values()].some(value => JSON.parse(value).description === setup.description));
});
