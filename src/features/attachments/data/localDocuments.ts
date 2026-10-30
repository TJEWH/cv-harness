import type { ApplicationPackageManifest, ApplicationPackageItem, LocalDocument, LocalDocumentMetadata, LocalDocumentMime, LocalPackageArchive } from '../documentTypes';
import { validateAttachmentId, validateAttachmentMetadata } from './attachmentMetadata';

export const MAX_LOCAL_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENT_BACKUP_BYTES = 350 * 1024 * 1024;
type Collection = 'documents' | 'manifests' | 'archives';
export interface LocalDocumentWrite { collection: Collection; id: string; value: unknown }

/** Injectable boundary keeps IndexedDB details separate from local document rules. */
export interface LocalDocumentStorage {
  get(scope: string, collection: Collection, id: string): Promise<unknown | undefined>;
  list(scope: string, collection: Collection): Promise<unknown[]>;
  write(scope: string, entries: LocalDocumentWrite[]): Promise<void>;
  remove(scope: string, collection: Collection, id: string): Promise<void>;
}

let databasePromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Browser document storage is unavailable. Enable browser storage to keep documents locally.'));
  if (!databasePromise) databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('cv-builder-local-documents', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('records', { keyPath: 'key' });
      store.createIndex('scopeCollection', ['scope', 'collection']);
    };
    request.onerror = () => reject(new Error('Could not open local document storage. Check browser storage permissions.'));
    request.onblocked = () => reject(new Error('Local document storage is blocked by another open tab. Close other app tabs and retry.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  }).catch((error) => { databasePromise = undefined; throw error; });
  return databasePromise;
}

const recordKey = (scope: string, collection: Collection, id: string) => JSON.stringify([scope, collection, id]);
function transactionError(transaction: IDBTransaction): Error {
  return new Error(transaction.error?.name === 'QuotaExceededError'
    ? 'Browser storage is full. Download a backup, then remove unused local files before retrying.'
    : 'Could not save local documents. Check browser storage permissions and retry.');
}

export const indexedDocumentStorage: LocalDocumentStorage = {
  async get(scope, collection, id) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly');
      const request = transaction.objectStore('records').get(recordKey(scope, collection, id));
      let result: unknown;
      request.onsuccess = () => { result = request.result?.value; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transactionError(transaction));
    });
  },
  async list(scope, collection) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly');
      const request = transaction.objectStore('records').index('scopeCollection').getAll([scope, collection]);
      let result: unknown[] = [];
      request.onsuccess = () => { result = request.result.map((record: { value: unknown }) => record.value); };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transactionError(transaction));
    });
  },
  async write(scope, entries) {
    const db = await database();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      for (const { collection, id, value } of entries) store.put({ key: recordKey(scope, collection, id), scope, collection, id, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transactionError(transaction));
    });
  },
  async remove(scope, collection, id) {
    const db = await database();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').delete(recordKey(scope, collection, id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transactionError(transaction));
    });
  },
};

export function safeDocumentFilename(value: string, fallback = 'document'): string {
  return value.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/^\.+/, '').trim().slice(0, 180) || fallback;
}

export function newLocalId(): string { return globalThis.crypto.randomUUID(); }

export function defaultPackageManifest(applicationId: string): ApplicationPackageManifest {
  return { applicationId, updatedAt: new Date().toISOString(), items: [
    { id: 'letter', kind: 'letter', label: 'Motivation letter', included: true },
    { id: 'cv', kind: 'cv', label: 'Application CV', included: true },
  ] };
}

export async function detectDocumentMime(blob: Blob): Promise<LocalDocumentMime> {
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  throw new Error('Choose a PDF, PNG, or JPEG file. Convert office documents to PDF before adding them.');
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500;
function validItems(value: unknown): value is ApplicationPackageItem[] {
  if (!Array.isArray(value) || value.length > 1000) return false;
  const ids = new Set<string>();
  const generated = new Set<string>();
  return value.every((item) => {
    if (!isRecord(item) || !validString(item.id) || ids.has(item.id) || !validString(item.label) || typeof item.included !== 'boolean') return false;
    if (item.kind !== 'letter' && item.kind !== 'cv' && item.kind !== 'attachment') return false;
    if (item.kind === 'attachment' ? !validString(item.documentId) : generated.has(item.kind)) return false;
    ids.add(item.id);
    if (item.kind !== 'attachment') generated.add(item.kind);
    return true;
  });
}

function validateManifest(value: unknown): asserts value is ApplicationPackageManifest {
  if (!isRecord(value) || !validString(value.applicationId) || !validString(value.updatedAt) || !validItems(value.items)) throw new Error('The document package data is invalid.');
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function base64Blob(value: unknown, type: string): Blob {
  if (typeof value !== 'string' || value.length > MAX_DOCUMENT_BACKUP_BYTES || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('The backup contains invalid file bytes.');
  let binary: string;
  try { binary = atob(value); } catch { throw new Error('The backup contains invalid file bytes.'); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export class LocalDocumentRepository {
  readonly scope: string;
  constructor(readonly userId: string, private storage: LocalDocumentStorage = indexedDocumentStorage) {
    this.scope = userId ? `account:${userId}` : 'device';
  }

  async listDocuments(): Promise<LocalDocumentMetadata[]> {
    return (await this.storage.list(this.scope, 'documents') as LocalDocument[])
      .map(({ blob: _blob, ...metadata }) => metadata).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getDocument(id: string): Promise<LocalDocument | undefined> {
    return await this.storage.get(this.scope, 'documents', id) as LocalDocument | undefined;
  }
  async addDocument(file: Blob, name: string, description?: string): Promise<LocalDocumentMetadata> {
    const fields = description === undefined ? { name: safeDocumentFilename(name) } : validateAttachmentMetadata(name, description);
    return this.writeDocumentFile(newLocalId(), file, fields);
  }
  private async writeDocumentFile(id: string, file: Blob, fields: Pick<LocalDocumentMetadata, 'name' | 'description'>, createdAt = new Date().toISOString()): Promise<LocalDocumentMetadata> {
    if (!file.size || file.size > MAX_LOCAL_DOCUMENT_BYTES) throw new Error('Choose a nonempty file smaller than 50 MB.');
    const mimeType = await detectDocumentMime(file);
    const document: LocalDocument = { id, ...fields, mimeType, size: file.size, createdAt, blob: file.slice(0, file.size, mimeType) };
    await this.storage.write(this.scope, [{ collection: 'documents', id: document.id, value: document }]);
    const { blob: _blob, ...metadata } = document;
    return metadata;
  }
  /** Attach file bytes to an existing metadata reference, including on a new device. */
  async putDocumentFile(id: string, file: Blob, name: string, description: string): Promise<LocalDocumentMetadata> {
    validateAttachmentId(id);
    const fields = validateAttachmentMetadata(name, description);
    const previous = await this.getDocument(id);
    return this.writeDocumentFile(id, file, fields, previous?.createdAt);
  }
  async replaceDocumentFile(id: string, file: Blob): Promise<LocalDocumentMetadata> {
    const previous = await this.getDocument(id);
    if (!previous) throw new Error('This attachment is unavailable on this device. Select its local file again.');
    return this.writeDocumentFile(id, file, { name: previous.name, ...(previous.description === undefined ? {} : { description: previous.description }) }, previous.createdAt);
  }
  async updateDocumentMetadata(id: string, name: string, description: string): Promise<LocalDocumentMetadata> {
    const fields = validateAttachmentMetadata(name, description);
    const previous = await this.getDocument(id);
    if (!previous) throw new Error('This attachment is unavailable on this device. Select its local file again.');
    const document = { ...previous, ...fields };
    await this.storage.write(this.scope, [{ collection: 'documents', id, value: document }]);
    const { blob: _blob, ...metadata } = document;
    return metadata;
  }
  /** Retain manifest references so missing files block export with an error. */
  async removeDocument(id: string): Promise<void> { await this.storage.remove(this.scope, 'documents', id); }
  async getManifest(applicationId: string): Promise<ApplicationPackageManifest> {
    const stored = await this.storage.get(this.scope, 'manifests', applicationId);
    if (!stored) return defaultPackageManifest(applicationId);
    validateManifest(stored);
    return stored;
  }
  async saveManifest(manifest: ApplicationPackageManifest): Promise<void> {
    validateManifest(manifest);
    await this.storage.write(this.scope, [{ collection: 'manifests', id: manifest.applicationId, value: { ...manifest, updatedAt: new Date().toISOString() } }]);
  }
  async archivePackage(applicationId: string, blob: Blob, pageCount: number, items: ApplicationPackageItem[]): Promise<LocalPackageArchive> {
    if (!validString(applicationId) || !Number.isSafeInteger(pageCount) || pageCount < 1 || !validItems(items)) throw new Error('The completed package has invalid metadata.');
    if (await detectDocumentMime(blob) !== 'application/pdf') throw new Error('Only a completed PDF package can be archived.');
    const archive: LocalPackageArchive = { id: newLocalId(), applicationId, name: safeDocumentFilename(`application-${applicationId}-${new Date().toISOString().slice(0, 10)}.pdf`), createdAt: new Date().toISOString(), pageCount, items: structuredClone(items), blob };
    await this.storage.write(this.scope, [{ collection: 'archives', id: archive.id, value: archive }]);
    return archive;
  }
  async listArchives(applicationId: string): Promise<LocalPackageArchive[]> {
    return (await this.storage.list(this.scope, 'archives') as LocalPackageArchive[]).filter((archive) => archive.applicationId === applicationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async removeArchive(id: string): Promise<void> { await this.storage.remove(this.scope, 'archives', id); }
  async exportBackup(): Promise<Blob> {
    const [documents, manifests, archives] = await Promise.all([
      this.storage.list(this.scope, 'documents') as Promise<LocalDocument[]>,
      this.storage.list(this.scope, 'manifests'),
      this.storage.list(this.scope, 'archives') as Promise<LocalPackageArchive[]>,
    ]);
    const encodedBytes = [...documents, ...archives].reduce((total, item) => total + 4 * Math.ceil(item.blob.size / 3), 0);
    if (encodedBytes > MAX_DOCUMENT_BACKUP_BYTES) throw new Error('This backup exceeds 350 MB. Download individual archives and remove unused documents before retrying.');
    const serialize = async <T extends { blob: Blob }>(item: T) => { const { blob, ...metadata } = item; return { ...metadata, bytes: await blobBase64(blob) }; };
    const result = new Blob([JSON.stringify({ format: 'cv-local-documents', version: 1, owner: this.scope, exportedAt: new Date().toISOString(), documents: await Promise.all(documents.map(serialize)), manifests, archives: await Promise.all(archives.map(serialize)) })], { type: 'application/json' });
    if (result.size > MAX_DOCUMENT_BACKUP_BYTES) throw new Error('This backup exceeds 350 MB. Download individual archives and remove unused documents before retrying.');
    return result;
  }
  /** Validation completes before a single atomic transaction writes any restored data. */
  async importBackup(file: Blob): Promise<{ documents: number; packages: number }> {
    if (file.size > MAX_DOCUMENT_BACKUP_BYTES) throw new Error('Document backup must be smaller than 350 MB.');
    let value: unknown;
    try { value = JSON.parse(await file.text()); } catch { throw new Error('Choose a valid local document backup JSON file.'); }
    if (!isRecord(value) || value.format !== 'cv-local-documents' || value.version !== 1 || !Array.isArray(value.documents) || !Array.isArray(value.manifests) || !Array.isArray(value.archives)) throw new Error('This is not a supported local document backup.');
    if (value.owner !== this.scope) throw new Error('This backup belongs to a different account. Sign in to its original account to restore application associations.');
    const entries: LocalDocumentWrite[] = [];
    const unique = new Set<string>();
    const add = (entry: LocalDocumentWrite) => {
      const key = `${entry.collection}:${entry.id}`;
      if (unique.has(key)) throw new Error('The backup contains duplicate records.');
      unique.add(key); entries.push(entry);
    };
    for (const document of value.documents) {
      if (!isRecord(document) || !validString(document.id) || !validString(document.name) || !validString(document.createdAt) || !['application/pdf', 'image/png', 'image/jpeg'].includes(String(document.mimeType))) throw new Error('The backup contains invalid document metadata.');
      const fields = document.description === undefined ? { name: safeDocumentFilename(document.name) } : validateAttachmentMetadata(document.name, document.description);
      const blob = base64Blob(document.bytes, String(document.mimeType));
      if (!blob.size || blob.size > MAX_LOCAL_DOCUMENT_BYTES || blob.size !== document.size || await detectDocumentMime(blob) !== document.mimeType) throw new Error('A document in the backup is invalid or too large.');
      add({ collection: 'documents', id: document.id, value: { id: document.id, ...fields, createdAt: document.createdAt, size: blob.size, mimeType: document.mimeType, blob } });
    }
    for (const manifest of value.manifests) { validateManifest(manifest); add({ collection: 'manifests', id: manifest.applicationId, value: manifest }); }
    for (const archive of value.archives) {
      if (!isRecord(archive) || !validString(archive.id) || !validString(archive.applicationId) || !validString(archive.name) || !validString(archive.createdAt) || !Number.isSafeInteger(archive.pageCount) || Number(archive.pageCount) < 1 || !validItems(archive.items)) throw new Error('The backup contains an invalid package archive.');
      const blob = base64Blob(archive.bytes, 'application/pdf');
      if (await detectDocumentMime(blob) !== 'application/pdf') throw new Error('An archived package contains invalid PDF bytes.');
      add({ collection: 'archives', id: archive.id, value: { id: archive.id, applicationId: archive.applicationId, name: safeDocumentFilename(archive.name), createdAt: archive.createdAt, pageCount: archive.pageCount, items: archive.items, blob } });
    }
    await this.storage.write(this.scope, entries);
    return { documents: value.documents.length, packages: value.manifests.length };
  }
}
