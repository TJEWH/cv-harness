import type { ApplicationPackageItem, ApplicationPackageManifest, LocalDocument, PackageCompositionResult } from '../../attachments/documentTypes';
import type { PDFPage } from 'pdf-lib';

export interface ApplicationPackageSources {
  cvReady: boolean;
  letterReady: boolean;
  getCvPdf: () => Promise<Blob>;
  getLetterPdf: () => Promise<Blob>;
  getDocument: (documentId: string) => Promise<LocalDocument | undefined>;
}

export function packageItemProblem(item: ApplicationPackageItem, availableDocumentIds: Set<string>, cvReady: boolean, letterReady: boolean): string | null {
  if (!item.included) return null;
  if (item.kind === 'cv' && !cvReady) return 'Assign a CV to this application first.';
  if (item.kind === 'letter' && !letterReady) return 'Finalize the motivation letter and resolve its placeholders first.';
  if (item.kind === 'attachment' && (!item.documentId || !availableDocumentIds.has(item.documentId))) return `${item.label}: unavailable on this device. Restore its document backup or remove it from the package.`;
  return null;
}

/** Retain PDF text/vectors and fit attachments to the generated document's page size. */
export async function composeApplicationPackage(manifest: ApplicationPackageManifest, sources: ApplicationPackageSources): Promise<PackageCompositionResult> {
  const included = manifest.items.filter((item) => item.included);
  if (!included.length) throw new Error('Include at least one document in the application package.');
  // Resolve every required input first: missing files must never yield a partial package.
  const resolved: { item: ApplicationPackageItem; blob: Blob; mimeType: string }[] = [];
  for (const item of included) {
    if (item.kind === 'cv') {
      if (!sources.cvReady) throw new Error('Assign a CV to this application first.');
      resolved.push({ item, blob: await sources.getCvPdf(), mimeType: 'application/pdf' });
    } else if (item.kind === 'letter') {
      if (!sources.letterReady) throw new Error('Finalize the motivation letter and resolve its placeholders first.');
      resolved.push({ item, blob: await sources.getLetterPdf(), mimeType: 'application/pdf' });
    } else {
      const document = item.documentId ? await sources.getDocument(item.documentId) : undefined;
      if (!document?.blob) throw new Error(`${item.label}: unavailable on this device. Restore its document backup or remove it from the package.`);
      resolved.push({ item, blob: document.blob, mimeType: document.mimeType });
    }
  }
  const { PDFDocument, PDFDict, PDFName, PageSizes, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await import('pdf-lib');
  const output = await PDFDocument.create();
  output.setTitle('Application documents');
  output.setCreator('CV Builder');
  const documents: PackageCompositionResult['documents'] = [];
  const attachmentPages: PDFPage[] = [];
  let cvSize: [number, number] | undefined;
  let letterSize: [number, number] | undefined;
  for (const { item, blob, mimeType } of resolved) {
    const firstPage = output.getPageCount() + 1;
    try {
      const bytes = await blob.arrayBuffer();
      if (mimeType === 'application/pdf') {
        const source = await PDFDocument.load(bytes);
        if (!source.getPageCount()) throw new Error('The PDF has no pages.');
        // Flatten supported form fields so their filled appearance survives page copying.
        // getForm() removes XFA automatically, so detect it before asking for the form.
        if (source.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.has(PDFName.of('XFA'))) throw new Error('This PDF uses an unsupported XFA form. Print it to a normal PDF before adding it.');
        const form = source.getForm();
        if (form.getFields().length) form.flatten();
        const pages = await output.copyPages(source, source.getPageIndices());
        for (const page of pages) output.addPage(page);
        if (item.kind === 'attachment') attachmentPages.push(...pages);
        else {
          const first = pages[0]!;
          const size: [number, number] = [first.getWidth(), first.getHeight()];
          if (item.kind === 'cv') cvSize = size;
          else letterSize = size;
        }
      } else if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
        const image = mimeType === 'image/png' ? await output.embedPng(bytes) : await output.embedJpg(bytes);
        const page = output.addPage(PageSizes.A4);
        const scale = Math.min(page.getWidth() / image.width, page.getHeight() / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height });
        attachmentPages.push(page);
      } else throw new Error('Unsupported document format.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The document could not be read.';
      throw new Error(`Could not include “${item.label}”. ${detail} Password-protected or damaged PDFs must be replaced with a readable copy.`);
    }
    documents.push({ itemId: item.id, label: item.label, firstPage, pageCount: output.getPageCount() - firstPage + 1 });
  }
  const [width, height] = cvSize ?? letterSize ?? PageSizes.A4;
  for (const page of attachmentPages) {
    const crop = page.getCropBox();
    const rotated = Math.abs(page.getRotation().angle % 180) === 90;
    const targetWidth = rotated ? height : width;
    const targetHeight = rotated ? width : height;
    const scale = Math.min(targetWidth / crop.width, targetHeight / crop.height);
    // Keep the original crop when adding space around a page, without rasterizing
    // its contents or losing links and flattened form appearances.
    page.node.normalize();
    page.node.wrapContentStreams(
      output.context.register(output.context.contentStream([pushGraphicsState(), rectangle(crop.x, crop.y, crop.width, crop.height), clip(), endPath()])),
      output.context.register(output.context.contentStream([popGraphicsState()])),
    );
    page.scaleContent(scale, scale);
    page.scaleAnnotations(scale, scale);
    const x = crop.x * scale - (targetWidth - crop.width * scale) / 2;
    const y = crop.y * scale - (targetHeight - crop.height * scale) / 2;
    page.setMediaBox(x, y, targetWidth, targetHeight);
    page.setCropBox(x, y, targetWidth, targetHeight);
    page.setBleedBox(x, y, targetWidth, targetHeight);
    page.setTrimBox(x, y, targetWidth, targetHeight);
    page.setArtBox(x, y, targetWidth, targetHeight);
    page.node.set(PDFName.of('UserUnit'), output.context.obj(1));
  }
  const bytes = await output.save();
  return { blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), pageCount: output.getPageCount(), documents };
}
