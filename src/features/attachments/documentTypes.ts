export type LocalDocumentMime = 'application/pdf' | 'image/png' | 'image/jpeg';

/** Only these manually supplied fields, plus ownership, may leave this device. */
export interface AttachmentMetadata {
  id: string;
  name: string;
  description: string;
}

export interface LocalDocumentMetadata {
  id: string;
  name: string;
  /** Absent on legacy local documents until the user supplies a description. */
  description?: string;
  mimeType: LocalDocumentMime;
  size: number;
  createdAt: string;
}

/** Original file bytes never cross the browser storage boundary. */
export interface LocalDocument extends LocalDocumentMetadata { blob: Blob }

export interface ApplicationPackageItem {
  id: string;
  kind: 'letter' | 'cv' | 'attachment';
  documentId?: string;
  label: string;
  included: boolean;
}

export interface ApplicationPackageManifest {
  applicationId: string;
  items: ApplicationPackageItem[];
  updatedAt: string;
}

export interface LocalPackageArchive {
  id: string;
  applicationId: string;
  name: string;
  createdAt: string;
  pageCount: number;
  items: ApplicationPackageItem[];
  blob: Blob;
}

export interface PackageCompositionResult {
  blob: Blob;
  pageCount: number;
  documents: { itemId: string; label: string; firstPage: number; pageCount: number }[];
}
