// Full application layout fixture. Use the isolated test/e2e Vite configuration.
// All browser storage is synthetic; no saved CVs, files or sessions are read.
import { createSampleDocument, SAMPLE_DOCUMENT_ID } from '../../src/features/cv-studio/domain/builtinConfigurations';
import { indexedDocumentStorage } from '../../src/features/attachments/data/localDocuments';
import { createAttachmentFixture } from '../attachmentFixture';

const sample = createSampleDocument();
sample.lang = 'en';
sample.contact.name = 'Synthetic Elena';
sample.anonymization.excludedSections = ['jobs'];
// Opt-in stress data for keyboard, wrapping, and translated control checks.
const stress = new URLSearchParams(location.search).has('stress');
// Opt-in DOM work counter for hidden-preview performance checks.
if (new URLSearchParams(location.search).has('performance')) {
  let layouts = 0;
  document.body.dataset.previewLayouts = '0';
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element && node.matches('.pdf-layout-snapshot')) layouts++;
    }
    document.body.dataset.previewLayouts = String(layouts);
  }).observe(document.body, { childList: true });
}
if (stress) {
  sample.lang = 'de';
  sample.sectionNames = { ...sample.sectionNames, jobs: 'InterdisziplinäreForschungserfahrungen'.repeat(4) };
  sample.contact.name = 'Éléonore · 山田 · الباحثة';
  sample.customSections[0].name = 'ForschungsprojekteUndWissenschaftlicheVeröffentlichungen'.repeat(3);
}
const values = new Map<string, string>([
  ['CV_CONF_ACTIVE_ID', SAMPLE_DOCUMENT_ID],
  [`CV_CONF_DATA:${SAMPLE_DOCUMENT_ID}`, JSON.stringify({ __meta: { id: SAMPLE_DOCUMENT_ID, name: 'Synthetic CV' }, data: sample })],
  ['CV_WORKSPACE_NAV', JSON.stringify({ workspace: 'cv-studio', cvTab: stress ? 'content' : 'templates' })],
]);
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(window, 'sessionStorage', { configurable: true, value: storage });
Object.assign(indexedDocumentStorage, createAttachmentFixture().storage);
await import('../../src/main');
