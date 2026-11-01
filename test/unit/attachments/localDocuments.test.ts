import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalDocumentRepository, defaultPackageManifest } from '../../../src/features/attachments/data/localDocuments';
import type { LocalDocumentStorage, LocalDocumentWrite } from '../../../src/features/attachments/data/localDocuments';

class MemoryStorage implements LocalDocumentStorage {
  rows = new Map<string, { scope: string; collection: string; value: unknown }>();
  writes = 0;
  failWrites = false;
  async get(scope: string, collection: string, id: string) { return structuredClone(this.rows.get(JSON.stringify([scope, collection, id]))?.value); }
  async list(scope: string, collection: string) { return [...this.rows.values()].filter((row) => row.scope === scope && row.collection === collection).map(({ value }) => structuredClone(value)); }
  async write(scope: string, entries: LocalDocumentWrite[]) {
    if (this.failWrites) throw new Error('Quota exceeded');
    this.writes++;
    for (const entry of entries) this.rows.set(JSON.stringify([scope, entry.collection, entry.id]), { scope, collection: entry.collection, value: structuredClone(entry.value) });
  }
  async remove(scope: string, collection: string, id: string) { this.rows.delete(JSON.stringify([scope, collection, id])); }
}

const pdf = (body: string) => new File([`%PDF-1.7\n${body}`], 'private-name-with-grades.pdf', { type: 'application/pdf' });

test('manual attachment metadata is independent of file names and file replacements retain references', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalDocumentRepository('owner', storage);
  const file = pdf('private original');
  const document = await repository.addDocument(file, 'Transcript / records', '  Degree courses and grades.  ');
  assert.equal(document.name, 'Transcript / records');
  assert.equal(document.description, 'Degree courses and grades.');
  assert.doesNotMatch(JSON.stringify(await repository.listDocuments()), /private-name-with-grades|private original/);
  const manifest = defaultPackageManifest('application');
  manifest.items.push({ id: 'transcript', kind: 'attachment', documentId: document.id, label: document.name, included: true });
  await repository.saveManifest(manifest);
  const updated = await repository.updateDocumentMetadata(document.id, 'Transcript', 'Current transcript for university applications.');
  assert.equal((await repository.getDocument(document.id))!.blob.size, file.size);
  assert.equal(await (await repository.getDocument(document.id))!.blob.text(), await file.text());
  const replaced = await repository.replaceDocumentFile(document.id, pdf('replacement private content'));
  assert.equal(replaced.id, document.id);
  assert.equal(replaced.createdAt, document.createdAt);
  assert.equal(replaced.name, updated.name);
  assert.equal(replaced.description, updated.description);
  assert.match(await (await repository.getDocument(document.id))!.blob.text(), /replacement private content/);
  assert.equal((await repository.getManifest('application')).items[2]!.documentId, document.id);
});

test('a cloud metadata reference can regain a local file on a new device without creating another attachment', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalDocumentRepository('owner', storage);
  const id = crypto.randomUUID();
  const created = await repository.putDocumentFile(id, pdf('private original'), 'Recommendation', 'Recommendation from a research supervisor.');
  assert.equal(created.id, id);
  await repository.putDocumentFile(id, pdf('private replacement'), 'Recommendation', created.description!);
  assert.equal((await repository.listDocuments()).length, 1);
  assert.match(await (await repository.getDocument(id))!.blob.text(), /private replacement/);
  assert.deepEqual(await new LocalDocumentRepository('other-account', storage).listDocuments(), []);
});

test('backups preserve descriptions, manual names and original bytes while legacy attachments remain local-only', async () => {
  const source = new LocalDocumentRepository('owner', new MemoryStorage());
  const manual = await source.addDocument(pdf('private original'), 'Records / transcript', 'Courses\nResearch project');
  const legacy = await source.addDocument(pdf('legacy'), '../old-transcript.pdf');
  assert.equal('description' in legacy, false);
  const target = new LocalDocumentRepository('owner', new MemoryStorage());
  await target.importBackup(await source.exportBackup());
  const restored = await target.getDocument(manual.id);
  assert.equal(restored!.name, manual.name);
  assert.equal(restored!.description, manual.description);
  assert.equal(await restored!.blob.text(), await (await source.getDocument(manual.id))!.blob.text());
  assert.equal('description' in (await target.getDocument(legacy.id))!, false);
});

test('invalid metadata, invalid replacement bytes and persistence failure leave all local originals intact', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalDocumentRepository('owner', storage);
  const document = await repository.addDocument(pdf('private original'), 'Transcript', 'Approved metadata');
  const before = await repository.getDocument(document.id);
  await assert.rejects(repository.updateDocumentMetadata(document.id, 'Transcript', ''), /description/);
  await assert.rejects(repository.replaceDocumentFile(document.id, new Blob(['not a PDF'])), /Choose a PDF/);
  const parsed = JSON.parse(await (await repository.exportBackup()).text());
  parsed.documents[0].description = 42;
  const writes = storage.writes;
  await assert.rejects(repository.importBackup(new Blob([JSON.stringify(parsed)])), /description/);
  assert.equal(storage.writes, writes);
  storage.failWrites = true;
  await assert.rejects(repository.updateDocumentMetadata(document.id, 'Changed', 'Changed description'), /Quota/);
  await assert.rejects(repository.replaceDocumentFile(document.id, pdf('replacement')), /Quota/);
  const after = await repository.getDocument(document.id);
  assert.equal(after!.name, before!.name);
  assert.equal(after!.description, before!.description);
  assert.equal(await after!.blob.text(), await before!.blob.text());
});
