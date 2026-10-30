import { createApp, h, nextTick, ref, type App, type Component } from 'vue';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import LocalAttachments from '../../src/features/attachments/components/LocalAttachments.vue';
import ApplicationDocuments from '../../src/features/applications/components/ApplicationDocuments.vue';
import { LocalDocumentRepository } from '../../src/features/attachments/data/localDocuments';
import { createAttachmentFixture, attachmentAccount } from '../attachmentFixture';
import '../../src/assets/cv.css';
import './style.css';

const root = document.querySelector<HTMLElement>('#workspace')!;
const status = document.querySelector<HTMLElement>('#test-status')!;
const results = document.querySelector<HTMLOListElement>('#test-results')!;
const runButton = document.querySelector<HTMLButtonElement>('#run-tests')!;
// Keep the download URL associated with its original PDF bytes for export verification.
const previewBlobs = new Map<string, Blob>();
const createObjectURL = URL.createObjectURL.bind(URL), revokeObjectURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = value => { const url = createObjectURL(value); if (value instanceof Blob) previewBlobs.set(url, value); return url; };
URL.revokeObjectURL = url => { previewBlobs.delete(url); revokeObjectURL(url); };
const applicationId = '10000000-0000-4000-8000-000000000090';
const view = ref<'library' | 'prepare' | 'review'>('library');
let app: App | undefined, fixture = createAttachmentFixture();
let library: { loading: boolean; busy: boolean; error: string; previewError: string }, documents: typeof library & { composition: { blob: Blob } | null; previewBusy: boolean; previewLoading: boolean; previewPage: number };
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
async function pdf(width: number, secret: string, pageCount = 1) {
  const output = await PDFDocument.create(), font = await output.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pageCount; page++) output.addPage([width, 600]).drawText(pageCount > 1 ? `${secret} page ${page}` : secret, { x: 20, y: 500, font, size: 12 });
  return new Blob([new Uint8Array(await output.save())], { type: 'application/pdf' });
}
async function settle() {
  await nextTick();
  const deadline = performance.now() + 20000;
  while (library?.loading || library?.busy || documents?.loading || documents?.busy || documents?.previewBusy) {
    if (performance.now() > deadline) throw new Error('Attachment operation timed out.');
    await new Promise(resolve => setTimeout(resolve, 20)); await nextTick();
  }
  await new Promise(requestAnimationFrame); await nextTick();
}
const current = () => root.querySelector<HTMLElement>(view.value === 'library' ? '.local-attachments' : '.application-documents')!;
async function click(name: string, parent: ParentNode = current()) {
  const button = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name);
  assert(button && !button.disabled, `Missing or disabled button: ${name}`);
  button.click(); await settle();
}
async function fill(name: string, value: string) {
  const label = [...current().querySelectorAll('label')].find(node => node.firstChild?.textContent?.trim() === name);
  const input = (label?.control ?? label?.querySelector('input,textarea')) as HTMLInputElement | HTMLTextAreaElement | null;
  assert(input, `Missing field: ${name}`); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
}
async function chooseFile(blob: Blob, filename: string) {
  const input = current().querySelector<HTMLInputElement>('form input[type=file]'); assert(input, 'Missing local file selector');
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], filename, { type: blob.type })); input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true })); await settle();
}
async function mount() {
  app?.unmount(); root.replaceChildren(); fixture = createAttachmentFixture(); view.value = 'library';
  const generated = await pdf(400, 'Synthetic accepted generated document.');
  app = createApp({ render: () => h('div', { style: 'display:flex;flex-direction:column;min-height:0;flex:1;width:100%' }, [
    h('nav', { style: 'display:flex;gap:8px;margin-bottom:16px' }, [
      h('button', { class: 'btn', onClick: () => { view.value = 'library'; } }, 'CV Studio · Local attachments'),
      h('button', { class: 'btn', onClick: () => { view.value = 'prepare'; } }, 'Application preparation'),
      h('button', { class: 'btn', onClick: () => { view.value = 'review'; } }, 'Attachments'),
    ]),
    h(LocalAttachments as Component, { userId: attachmentAccount, client: fixture.client, storage: fixture.storage, lang: 'en', active: view.value === 'library',
      style: view.value === 'library' ? 'flex:1;min-height:0' : 'display:none',
      ref: (instance: unknown) => { if (instance) library = (instance as { $: { setupState: typeof library } }).$.setupState; } }),
    h(ApplicationDocuments as Component, { userId: attachmentAccount, client: fixture.client, storage: fixture.storage, applicationId, lang: 'en',
      active: view.value !== 'library', mode: view.value === 'review' ? 'review' : 'prepare', cvState: null, cvReady: true, letterReady: true, exportReady: true,
      getCvPdf: async () => generated, getLetterPdf: async () => generated,
      style: view.value === 'library' ? 'display:none' : 'flex:1;min-height:0',
      ref: (instance: unknown) => { if (instance) documents = (instance as { $: { setupState: typeof documents } }).$.setupState; } }),
  ]) });
  app.mount(root); await settle();
}
async function add(blob: Blob, filename: string, name: string, description: string) {
  await click('New attachment'); await chooseFile(blob, filename);
  const inputs = current().querySelector('form')!;
  assert(inputs.querySelector<HTMLInputElement>('input:not([type=file])')!.value === '' && inputs.querySelector<HTMLTextAreaElement>('textarea')!.value === '', 'Choosing a file generated a name or description');
  await fill('Attachment name', name); await fill('Description', description); await click('Save attachment');
  assert(!library.error, library.error);
  assert(current().textContent?.includes(name) && current().textContent?.includes(description), 'Library entry lost its manual name or description');
}
async function select(id: string) {
  const control = current().querySelector<HTMLSelectElement>('select[aria-label="Choose an existing document"]'); assert(control, 'Existing attachment picker unavailable');
  assert(!control.closest('.library-picker')?.querySelector('button'), 'Attachment selection still requires a manual Add button');
  control.value = id; control.dispatchEvent(new Event('change', { bubbles: true })); await settle(); assert(!documents.error, documents.error);
  const remainingControl = current().querySelector<HTMLSelectElement>('select[aria-label="Choose an existing document"]');
  assert(!remainingControl || remainingControl.value === '', 'Attachment picker did not reset after automatically adding the selection');
}
async function renderedPreview(pageNumber = 1, expectedText = '', fullscreen = false) {
  const deadline = performance.now() + 20000;
  for (;;) {
    const viewer = fullscreen ? document.querySelector<HTMLElement>('.document-full-preview[open]') : current().querySelector<HTMLElement>('.package-inline-pdf');
    const page = viewer?.querySelector<HTMLElement>(`.pdf-canvas-page[data-page-number="${pageNumber}"][data-rendered="true"]`);
    const canvas = page?.querySelector('canvas');
    if (canvas?.width && canvas.height && page?.querySelector('.textLayer')?.textContent?.includes(expectedText) && (view.value === 'library' || documents.composition)) {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = false;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3]! > 0 && Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) < 240) { ink = true; break; }
      }
      assert(ink, 'PDF canvas contains no rendered document content');
      return viewer!;
    }
    const state = view.value === 'library' ? library : documents;
    assert(!state.error && !state.previewError, state.error || state.previewError);
    if (performance.now() > deadline) throw new Error(`Shared PDF preview did not render page ${pageNumber}: ${expectedText}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function turnPage(viewer: ParentNode, direction: 'next' | 'previous') {
  const button = viewer.querySelector<HTMLButtonElement>(`.pdf-pagination__button--${direction}`);
  assert(button && !button.disabled, `Missing or disabled ${direction} page control`);
  button.click(); await settle();
}
async function downloadPdf(parent: ParentNode = current()) {
  let downloaded: Blob | undefined;
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith('.pdf')) downloaded = previewBlobs.get(this.href);
    else anchorClick.call(this);
  };
  try { await click('Download PDF', parent); } finally { HTMLAnchorElement.prototype.click = anchorClick; }
  assert(downloaded, 'Download did not use the local PDF bytes');
  return new Uint8Array(await downloaded.arrayBuffer());
}
runButton.addEventListener('click', async () => {
  runButton.disabled = true; results.replaceChildren(); status.textContent = 'Running'; document.body.dataset.result = 'running';
  const stage = (text: string) => { const item = document.createElement('li'); item.textContent = `PASS: ${text}`; results.append(item); };
  try {
    await mount();
    const transcript = await pdf(510, 'PRIVATE_TRANSCRIPT_CONTENT_83', 2), recommendation = await pdf(610, 'PRIVATE_RECOMMENDATION_CONTENT_97');
    await add(transcript, 'PRIVATE-original-transcript.pdf', 'Transcript of records', 'Course list and grades for my engineering degree.');
    await add(recommendation, 'PRIVATE-original-recommendation.pdf', 'Letter of recommendation', 'Academic recommendation describing my research work.');
    assert(fixture.rows.length === 2, 'Manual metadata was not saved to Supabase');
    const sent = JSON.stringify(fixture.calls);
    for (const secret of ['PRIVATE_', 'mimeType', 'size', 'blob', 'bytes', 'filename', 'application/pdf']) assert(!sent.includes(secret), `Cloud request included private file data: ${secret}`);
    const local = new LocalDocumentRepository(attachmentAccount, fixture.storage);
    const first = fixture.rows.find(row => row.name === 'Transcript of records')!, second = fixture.rows.find(row => row.name === 'Letter of recommendation')!;
    assert(await (await local.getDocument(first.id))!.blob.text() === await transcript.text(), 'Saving metadata changed the original file');
    stage('Manual names/descriptions sync; file bytes and filenames remain local');
    const transcriptRow = [...current().querySelectorAll('.attachment-list li')].find(row => row.querySelector('h3')?.textContent === 'Transcript of records')!;
    await click('Open', transcriptRow);
    const localFull = await renderedPreview(1, 'PRIVATE_TRANSCRIPT_CONTENT_83 page 1', true);
    assert(localFull.getAttribute('aria-label') === 'Transcript of records', 'Local preview lost its attachment title');
    assert(!document.querySelector('iframe') && localFull.querySelectorAll('button').length === 4, 'Local PDFs must use the shared fullscreen viewer with only back, download and page controls');
    await turnPage(localFull, 'next'); await renderedPreview(2, 'PRIVATE_TRANSCRIPT_CONTENT_83 page 2', true);
    const originalBytes = new Uint8Array(await transcript.arrayBuffer()), localDownload = await downloadPdf(localFull);
    assert(localDownload.length === originalBytes.length && localDownload.every((byte, index) => byte === originalBytes[index]), 'The local preview changed the downloaded attachment bytes');
    await click('Back to builder', localFull);
    assert(!document.querySelector('.document-full-preview[open]'), 'Back did not close the local attachment preview');
    await click('Open', transcriptRow); const reopened = await renderedPreview(1, 'PRIVATE_TRANSCRIPT_CONTENT_83 page 1', true);
    await click('Back to builder', reopened);
    assert(await (await local.getDocument(first.id))!.blob.text() === await transcript.text(), 'Viewing or downloading changed the stored original attachment');
    stage('Local PDF Open reuses fullscreen preview, navigates pages, reopens at page one and downloads unchanged originals');
    await click('Application preparation', root);
    assert(!current().querySelector('input[accept*="application/pdf"]'), 'Application preparation still has an independent upload form');
    await select(first.id); await select(second.id);
    assert(current().textContent?.includes(first.description) && current().textContent?.includes(second.description), 'Selected attachments do not show their descriptions');
    const selected = await local.getManifest(applicationId);
    assert(selected.items.filter(item => item.kind === 'attachment').length === 2, 'Application selection did not persist');
    stage('Selecting reusable attachments adds them automatically and retains both descriptions');
    await click('Attachments', root); assert(!documents.error, documents.error);
    for (const removed of ['Preview complete PDF', 'Manage attachments in CV Studio', 'Refresh attachments', 'Supporting documents & export', 'Package order', 'Frozen package archive']) {
      assert(!current().textContent?.includes(removed), `Redundant Attachments control remains: ${removed}`);
    }
    const inline = await renderedPreview(1, 'Synthetic accepted generated document.');
    assert(inline.classList.contains('document-inline-preview') && inline.getBoundingClientRect().height > 0, 'Shared inline PDF preview is hidden or was not reused');
    assert(!current().querySelector('iframe, .simple-pdf-viewer'), 'Attachments still mounts the native or separate custom viewer');
    assert(!inline.querySelector('.document-inline-preview__actions'), 'Inline PDF preview has duplicate open/download actions');
    assert(documents.composition?.blob, 'Composed PDF bytes missing');
    const compositionBytes = new Uint8Array(await documents.composition.blob.arrayBuffer());
    const composed = await PDFDocument.load(compositionBytes);
    assert(composed.getPageCount() === 5 && composed.getPages().every(page => page.getWidth() === 400 && page.getHeight() === 600), 'Attachment pages did not match CV and letter size');
    const actions = current().querySelector<HTMLElement>('.package-preview-actions');
    assert(actions?.querySelector('.page-map-summary summary')?.textContent?.trim() === 'Document order', 'Document order must appear in the PDF footer');
    const openPreview = actions!.querySelector<HTMLButtonElement>('button[aria-label="Open preview"]');
    assert(openPreview, 'Open preview must appear in the PDF footer');
    assert(actions!.getBoundingClientRect().top >= inline.getBoundingClientRect().bottom - 1, 'Document order and Open preview must sit below the package PDF');
    await turnPage(inline, 'next'); await renderedPreview(2, 'Synthetic accepted generated document.');
    await turnPage(inline, 'next'); await renderedPreview(3, 'PRIVATE_TRANSCRIPT_CONTENT_83');
    await turnPage(inline, 'next'); await renderedPreview(4, 'PRIVATE_TRANSCRIPT_CONTENT_83 page 2');
    await turnPage(inline, 'next'); await renderedPreview(5, 'PRIVATE_RECOMMENDATION_CONTENT_97');
    stage('Shared inline viewer renders generated PDFs and local attachments with selectable text and page navigation');
    await click('Open preview');
    const full = await renderedPreview(5, 'PRIVATE_RECOMMENDATION_CONTENT_97', true);
    assert(full.getBoundingClientRect().height > 0 && !full.querySelector('iframe'), 'Expanded shared PDF preview is hidden or uses a native frame');
    assert(full.querySelectorAll('button').length === 4 && !full.querySelector('input, select, textarea'), 'Package preview must expose only back, download and page controls');
    await turnPage(full, 'previous'); await renderedPreview(4, 'PRIVATE_TRANSCRIPT_CONTENT_83 page 2', true);
    await click('Back to builder', full); await renderedPreview(4, 'PRIVATE_TRANSCRIPT_CONTENT_83 page 2');
    assert(!document.querySelector('.document-full-preview[open]'), 'Back did not close the expanded preview');
    const originalBlob = documents.composition.blob;
    await click(`Move ${second.name} up`, current().querySelectorAll('.package-items li')[3]!);
    const reorderedInline = await renderedPreview(1, 'Synthetic accepted generated document.');
    assert(documents.composition?.blob !== originalBlob && documents.previewPage === 1, 'Reordering did not replace the PDF and reset its page');
    await turnPage(reorderedInline, 'next'); await renderedPreview(2, 'Synthetic accepted generated document.');
    await turnPage(reorderedInline, 'next'); await renderedPreview(3, 'PRIVATE_RECOMMENDATION_CONTENT_97');
    await turnPage(reorderedInline, 'next'); await renderedPreview(4, 'PRIVATE_TRANSCRIPT_CONTENT_83');
    await turnPage(reorderedInline, 'next'); await renderedPreview(5, 'PRIVATE_TRANSCRIPT_CONTENT_83 page 2');
    const expectedDownload = new Uint8Array(await documents.composition.blob.arrayBuffer());
    const downloaded = await downloadPdf();
    assert(downloaded.length === expectedDownload.length && downloaded.every((byte, index) => byte === expectedDownload[index]), 'PDF rendering changed the downloaded package bytes');
    assert((await local.listArchives(applicationId)).length === 0, 'Downloading unexpectedly created a frozen archive');
    stage('Fullscreen shares page selection; reordering replaces the preview and download retains the composed PDF bytes');
    const backup = await local.exportBackup();
    await local.removeDocument(first.id); window.dispatchEvent(new Event('cv-local-documents-updated')); await settle();
    assert(current().textContent?.includes('unavailable on this device'), 'Missing selected file was not reported');
    const downloadButton = current().querySelector<HTMLButtonElement>('button[aria-label="Download PDF"]');
    assert(downloadButton?.disabled && !documents.composition, 'Missing file did not block package export');
    assert(!current().querySelector('.package-inline-pdf'), 'Missing file retained the stale PDF page');
    await click('CV Studio · Local attachments', root);
    assert(current().querySelector('[role="img"][aria-label="File missing on this device"]') && fixture.rows.length === 2, 'Missing local file incorrectly removed its cloud metadata');
    stage('Missing files remain explicit and block export while metadata stays available');
    await local.importBackup(backup); window.dispatchEvent(new Event('cv-local-documents-updated')); await settle();
    await click('Attachments', root); assert(documents.composition, 'Restored files did not restore the automatic preview'); await renderedPreview();
    status.textContent = '6/6 attachment checks passed'; document.body.dataset.result = 'passed';
  } catch (reason) {
    const item = document.createElement('li'); item.dataset.result = 'fail'; item.textContent = `FAIL: ${reason instanceof Error ? reason.message : String(reason)}`; results.append(item);
    status.textContent = 'Attachment workflow failed'; document.body.dataset.result = 'failed';
  } finally { runButton.disabled = false; }
});
