import assert from 'node:assert/strict';
import test from 'node:test';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { composeApplicationPackage, packageItemProblem } from '../src/features/applications/domain/applicationPackage';
import { defaultPackageManifest, LocalDocumentRepository, safeDocumentFilename } from '../src/features/attachments/data/localDocuments';
import type { LocalDocumentStorage, LocalDocumentWrite } from '../src/features/attachments/data/localDocuments';
import type { ApplicationPackageManifest, LocalDocument } from '../src/features/attachments/documentTypes';

class MemoryStorage implements LocalDocumentStorage {
  records = new Map<string, { scope: string; collection: string; value: unknown }>();
  writes = 0;
  failWrites = false;
  async get(scope: string, collection: string, id: string) { return structuredClone(this.records.get(JSON.stringify([scope, collection, id]))?.value); }
  async list(scope: string, collection: string) { return [...this.records.values()].filter((row) => row.scope === scope && row.collection === collection).map(({ value }) => structuredClone(value)); }
  async write(scope: string, entries: LocalDocumentWrite[]) {
    if (this.failWrites) throw new Error('Quota exceeded');
    this.writes++;
    for (const { collection, id, value } of entries) this.records.set(JSON.stringify([scope, collection, id]), { scope, collection, value: structuredClone(value) });
  }
  async remove(scope: string, collection: string, id: string) { this.records.delete(JSON.stringify([scope, collection, id])); }
}

async function pdf(widths: number[], label = 'Selectable text'): Promise<Blob> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const width of widths) document.addPage([width, 600]).drawText(label, { x: 20, y: 400, font });
  return new Blob([new Uint8Array(await document.save())], { type: 'application/pdf' });
}

function attachment(id: string, blob: Blob): LocalDocument {
  return { id, name: 'Certificate.pdf', mimeType: 'application/pdf', size: blob.size, createdAt: new Date().toISOString(), blob };
}

test('composition follows manifest order, fits attachments to CV size, preserves generated pages and text, and skips excluded inputs', async () => {
  const [cv, letter, certificate] = await Promise.all([pdf([410, 420]), pdf([510]), pdf([610])]);
  const manifest: ApplicationPackageManifest = { ...defaultPackageManifest('application'), items: [
    { id: 'certificate', kind: 'attachment', documentId: 'doc-1', label: 'Certificate', included: true },
    { id: 'cv', kind: 'cv', label: 'CV', included: true },
    { id: 'letter', kind: 'letter', label: 'Letter', included: false },
    { id: 'excluded-missing', kind: 'attachment', documentId: 'missing', label: 'Old transcript', included: false },
  ] };
  let letterCalls = 0;
  const result = await composeApplicationPackage(manifest, {
    cvReady: true, letterReady: false, getCvPdf: async () => cv,
    getLetterPdf: async () => { letterCalls++; return letter; },
    getDocument: async (id) => id === 'doc-1' ? attachment(id, certificate) : undefined,
  });
  const composed = await PDFDocument.load(await result.blob.arrayBuffer());
  assert.deepEqual(composed.getPages().map((page) => page.getWidth()), [410, 410, 420]);
  assert.equal(result.pageCount, 3);
  assert.equal(letterCalls, 0);
  assert.deepEqual(result.documents.map(({ firstPage, pageCount }) => [firstPage, pageCount]), [[1, 1], [2, 2]]);
  for (const page of composed.getPages()) assert.ok(page.node.Resources()?.get(PDFName.of('Font')), 'Original vector/text resources must remain, without rasterizing PDF pages');
});

test('small cropped and rotated attachments grow to document size with centered content and scaled links', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([200, 300]);
  page.drawText('Small certificate', { x: 25, y: 60, size: 8 });
  page.setCropBox(20, 40, 100, 200);
  page.setRotation(degrees(90));
  page.node.set(PDFName.of('Annots'), source.context.obj([source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [25, 60, 80, 70], A: { S: 'URI', URI: 'https://example.com' },
  }))]));
  const small = new Blob([new Uint8Array(await source.save())], { type: 'application/pdf' });
  const manifest: ApplicationPackageManifest = { ...defaultPackageManifest('application'), items: [
    { id: 'scan', kind: 'attachment', documentId: 'scan', label: 'Scan', included: true },
    { id: 'letter', kind: 'letter', label: 'Letter', included: true },
  ] };
  const result = await composeApplicationPackage(manifest, {
    cvReady: false, letterReady: true, getCvPdf: async () => { throw new Error('Excluded CV should not render'); },
    getLetterPdf: async () => pdf([400]), getDocument: async () => attachment('scan', small),
  });
  const output = await PDFDocument.load(await result.blob.arrayBuffer());
  const fitted = output.getPage(0);
  assert.equal(fitted.getRotation().angle, 90);
  assert.deepEqual(fitted.getSize(), { width: 600, height: 400 }, 'Rotated page displays at the same 400 × 600 size as the letter');
  assert.deepEqual(fitted.getCropBox(), { x: -160, y: 80, width: 600, height: 400 });
  const link = fitted.node.Annots()!.lookup(0, PDFDict);
  assert.deepEqual(link.lookup(PDFName.of('Rect'), PDFArray).asArray().map(value => Number(value.toString())), [50, 120, 160, 140]);
  assert.ok(fitted.node.Resources()?.get(PDFName.of('Font')));
});

test('included missing files, unavailable CVs and unfinalized letters fail explicitly instead of emitting partial packages', async () => {
  const manifest: ApplicationPackageManifest = { ...defaultPackageManifest('application'), items: [
    { id: 'missing', kind: 'attachment', documentId: 'missing-id', label: 'University transcript', included: true },
  ] };
  const sources = { cvReady: false, letterReady: false, getCvPdf: async () => pdf([400]), getLetterPdf: async () => pdf([500]), getDocument: async () => undefined };
  await assert.rejects(composeApplicationPackage(manifest, sources), /University transcript.*unavailable on this device/);
  await assert.rejects(composeApplicationPackage(defaultPackageManifest('application'), sources), /Finalize the motivation letter/);
  await assert.rejects(composeApplicationPackage({ ...manifest, items: [{ id: 'cv', kind: 'cv', label: 'CV', included: true }] }, sources), /Assign a CV/);
  await assert.rejects(composeApplicationPackage({ ...manifest, items: [] }, sources), /at least one document/);
  assert.match(packageItemProblem(manifest.items[0]!, new Set(), true, true)!, /unavailable on this device/);
  assert.equal(packageItemProblem({ ...manifest.items[0]!, included: false }, new Set(), true, true), null);
});

test('malformed or protected attachment errors identify the document and block export', async () => {
  const manifest: ApplicationPackageManifest = { ...defaultPackageManifest('application'), items: [{ id: 'broken', kind: 'attachment', documentId: 'broken', label: 'Broken certificate', included: true }] };
  await assert.rejects(composeApplicationPackage(manifest, {
    cvReady: true, letterReady: true, getCvPdf: async () => pdf([400]), getLetterPdf: async () => pdf([500]),
    getDocument: async () => attachment('broken', new Blob(['%PDF-invalid'])),
  }), /Could not include “Broken certificate”/);
});

test('filled PDF form appearances survive composition as flattened page content', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([400, 600]);
  const field = source.getForm().createTextField('certificate-name');
  field.setText('Example applicant');
  field.addToPage(page, { x: 30, y: 350, width: 250, height: 30 });
  const filled = new Blob([new Uint8Array(await source.save())], { type: 'application/pdf' });
  const manifest: ApplicationPackageManifest = { ...defaultPackageManifest('application'), items: [{ id: 'form', kind: 'attachment', documentId: 'form', label: 'Filled certificate', included: true }] };
  const result = await composeApplicationPackage(manifest, {
    cvReady: false, letterReady: false, getCvPdf: async () => pdf([400]), getLetterPdf: async () => pdf([500]), getDocument: async () => attachment('form', filled),
  });
  const merged = await PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(merged.getForm().getFields().length, 0);
  assert.ok(merged.getPage(0).node.Resources()?.get(PDFName.of('XObject')), 'Filled form appearance remains a vector page resource');
});

test('unsupported XFA forms are rejected before the PDF library can strip their form data', async () => {
  const source = await PDFDocument.create();
  source.addPage([400, 600]);
  source.getForm();
  source.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('XFA'), source.context.obj([]));
  const xfa = new Blob([new Uint8Array(await source.save())], { type: 'application/pdf' });
  const manifest: ApplicationPackageManifest = { ...defaultPackageManifest('application'), items: [{ id: 'xfa', kind: 'attachment', documentId: 'xfa', label: 'Dynamic form', included: true }] };
  await assert.rejects(composeApplicationPackage(manifest, {
    cvReady: false, letterReady: false, getCvPdf: async () => pdf([400]), getLetterPdf: async () => pdf([500]), getDocument: async () => attachment('xfa', xfa),
  }), /unsupported XFA form/);
});

test('PNG attachments become centered A4 pages alongside original PDFs', async () => {
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5+/h8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  const manifest: ApplicationPackageManifest = { ...defaultPackageManifest('application'), items: [{ id: 'image', kind: 'attachment', documentId: 'image', label: 'Certificate scan', included: true }] };
  const result = await composeApplicationPackage(manifest, {
    cvReady: false, letterReady: false, getCvPdf: async () => pdf([400]), getLetterPdf: async () => pdf([500]),
    getDocument: async () => ({ ...attachment('image', png), mimeType: 'image/png' }),
  });
  const document = await PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(document.getPageCount(), 1);
  assert.equal(Math.round(document.getPage(0).getWidth()), 595);
  assert.ok(document.getPage(0).node.Resources()?.get(PDFName.of('XObject')));
});

test('local document libraries, package manifests and archives are isolated by account', async () => {
  const storage = new MemoryStorage();
  const alice = new LocalDocumentRepository('alice', storage);
  const bob = new LocalDocumentRepository('bob', storage);
  const bytes = await pdf([400]);
  const document = await alice.addDocument(bytes, '../private/transcript.pdf');
  const manifest = defaultPackageManifest('same-application-id');
  manifest.items.push({ id: 'transcript', kind: 'attachment', documentId: document.id, label: document.name, included: true });
  await alice.saveManifest(manifest);
  await alice.archivePackage(manifest.applicationId, bytes, 1, manifest.items);
  assert.equal((await alice.listDocuments()).length, 1);
  assert.deepEqual(await bob.listDocuments(), []);
  assert.equal(await bob.getDocument(document.id), undefined);
  assert.equal((await bob.getManifest(manifest.applicationId)).items.length, 2);
  assert.deepEqual(await bob.listArchives(manifest.applicationId), []);
  await assert.rejects(bob.importBackup(await alice.exportBackup()), /different account/);
  assert.equal(document.name, '-private-transcript.pdf');
  assert.equal(safeDocumentFilename('../../bad\u0000name\\file.pdf'), '-..-bad-name-file.pdf');
});

test('document backup restores original bytes, associations, order and frozen package bytes on a new device', async () => {
  const source = new LocalDocumentRepository('alice', new MemoryStorage());
  const file = await pdf([400, 450]);
  const document = await source.addDocument(file, 'Diploma.pdf');
  const manifest = defaultPackageManifest('application');
  manifest.items.unshift({ id: 'diploma', kind: 'attachment', documentId: document.id, label: document.name, included: true });
  await source.saveManifest(manifest);
  const archive = await source.archivePackage('application', file, 2, manifest.items);
  // Changes to the later editable manifest do not mutate the archived copy.
  manifest.items[0]!.included = false;
  await source.saveManifest(manifest);
  assert.equal((await source.listArchives('application'))[0]!.items[0]!.included, true);
  const restored = new LocalDocumentRepository('alice', new MemoryStorage());
  assert.deepEqual(await restored.importBackup(await source.exportBackup()), { documents: 1, packages: 1 });
  assert.deepEqual(new Uint8Array(await (await restored.getDocument(document.id))!.blob.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
  assert.deepEqual((await restored.getManifest('application')).items, manifest.items);
  const saved = (await restored.listArchives('application'))[0]!;
  assert.equal(saved.id, archive.id);
  assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()), new Uint8Array(await archive.blob.arrayBuffer()));
  await restored.removeDocument(document.id);
  assert.equal(await restored.getDocument(document.id), undefined);
  assert.equal((await restored.getManifest('application')).items[0]!.documentId, document.id, 'Missing references must remain visible rather than silently disappear');
});

test('invalid backups validate completely before writing and failed persistence never reports success', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalDocumentRepository('alice', storage);
  const file = await pdf([400]);
  await repository.addDocument(file, 'Original.pdf');
  const parsed = JSON.parse(await (await repository.exportBackup()).text());
  parsed.manifests.push({ applicationId: 'invalid', updatedAt: 'today', items: [{ id: '1', kind: 'attachment', label: 'Missing document ID', included: true }] });
  const before = storage.writes;
  await assert.rejects(repository.importBackup(new Blob([JSON.stringify(parsed)])), /package data is invalid/);
  assert.equal(storage.writes, before);
  storage.failWrites = true;
  await assert.rejects(repository.addDocument(file, 'Not saved.pdf'), /Quota exceeded/);
  assert.equal((await repository.listDocuments()).length, 1);
  await assert.rejects(repository.addDocument(new Blob(['fake'], { type: 'application/pdf' }), 'Fake.pdf'), /Choose a PDF/);
});
