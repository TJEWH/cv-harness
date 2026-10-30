<script setup lang="ts">
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faArrowDown, faArrowUp, faFilePdf, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { SupabaseClient } from '@supabase/supabase-js';
import InlineDocumentPreview from '../../../documents/pdf/components/InlineDocumentPreview.vue';
import FullDocumentPreview from '../../../documents/pdf/components/FullDocumentPreview.vue';
import type { CvState } from '../../../documents/cv/types';
import type { ApplicationPackageManifest, AttachmentMetadata, LocalDocumentMetadata, PackageCompositionResult } from '../../attachments/documentTypes';
import { defaultPackageManifest, LocalDocumentRepository, newLocalId, safeDocumentFilename, type LocalDocumentStorage } from '../../attachments/data/localDocuments';
import { createAttachmentMetadataRepository } from '../../attachments/data/attachmentMetadata';
import { composeApplicationPackage, packageItemProblem } from '../domain/applicationPackage';
import { usePdfBlobPreview } from '../../../documents/pdf/composables/usePdfBlobPreview';
import { useToastWatch } from '../../../shared/ui/useToasts';
import DesktopSidebarPortal from '../../../shared/ui/DesktopSidebarPortal.vue';
import WorkspaceMobileActions from '../../../shared/ui/WorkspaceMobileActions.vue';
import { useDesktopSidebar } from '../../../shared/ui/desktopSidebar';

const props = withDefaults(defineProps<{
  applicationId: string;
  userId: string;
  lang: string;
  cvState: CvState | null;
  getCvPdf: () => Promise<Blob>;
  getLetterPdf: () => Promise<Blob>;
  letterReady: boolean;
  letterRevision?: string;
  cvReady?: boolean;
  exportReady?: boolean;
  mode?: 'prepare' | 'review' | 'tracking';
  client?: SupabaseClient | null;
  active?: boolean;
  storage?: LocalDocumentStorage;
}>(), { mode: 'review', cvReady: undefined, exportReady: true, client: null, active: true });
const emit = defineEmits<{ readiness: [value: { included: number; missing: number }] }>();
const desktopSidebar = useDesktopSidebar();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const documents = ref<LocalDocumentMetadata[]>([]);
const sharedDocuments = ref<AttachmentMetadata[]>([]);
const manifest = shallowRef<ApplicationPackageManifest>(defaultPackageManifest(props.applicationId));
const loading = ref(true);
const loadFailed = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const previewPage = ref(1);
const previewBusy = ref(false);
const previewFailed = ref(false);
const expanded = ref(false);
const composition = ref<PackageCompositionResult | null>(null);
const { pages: previewPages, loading: previewLoading, error: previewError, retry: retryPreview } = usePdfBlobPreview(
  () => props.active && props.mode === 'review' ? composition.value?.blob || null : null,
);
const selectedLibraryId = ref('');
let generation = 0;
const previewGeneration = ref(0);
let attemptedPreview = -1;
let disposed = false;
let reloadPending = false;
const repository = computed(() => new LocalDocumentRepository(props.userId, props.storage));
const cvAvailable = computed(() => props.cvReady ?? !!props.cvState);
const availableIds = computed(() => new Set(documents.value.map(({ id }) => id)));
const problems = computed(() => manifest.value.items.map((item) => ({ id: item.id, message: packageItemProblem(item, availableIds.value, cvAvailable.value, props.letterReady) })).filter((problem) => problem.message));
const includedCount = computed(() => manifest.value.items.filter(({ included }) => included).length);
const library = computed(() => {
  const byId = new Map<string, { id: string; name: string; description?: string }>(sharedDocuments.value.map((entry) => [entry.id, entry]));
  for (const entry of documents.value) if (entry.description?.trim() || !byId.has(entry.id)) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
});
const libraryOptions = computed(() => library.value.filter((document) => !manifest.value.items.some((item) => item.documentId === document.id)));
const selectedLibraryDocument = computed(() => libraryOptions.value.find(({ id }) => id === selectedLibraryId.value));
const canAttach = computed(() => !!selectedLibraryDocument.value?.description?.trim() && availableIds.value.has(selectedLibraryId.value));
const canBuild = computed(() => props.active && props.mode === 'review' && !loading.value && !loadFailed.value && !busy.value && !previewBusy.value && props.exportReady && !!includedCount.value && !problems.value.length);

function clearPreview() {
  expanded.value = false;
  previewGeneration.value++;
  previewFailed.value = false;
  previewPage.value = 1;
  composition.value = null;
}
function reportError(reason: unknown) { error.value = reason instanceof Error ? reason.message : text('The operation failed. Please retry.', 'Der Vorgang ist fehlgeschlagen. Bitte erneut versuchen.'); }
function itemLabel(item: ApplicationPackageManifest['items'][number]) {
  return item.kind === 'cv' ? text('Application CV', 'Bewerbungslebenslauf') : item.kind === 'letter' ? text('Motivation letter', 'Motivationsschreiben') : library.value.find(({ id }) => id === item.documentId)?.name || item.label;
}
function itemDescription(id?: string) { return library.value.find((entry) => entry.id === id)?.description; }

async function load() {
  const token = ++generation;
  reloadPending = false;
  const repo = repository.value;
  const applicationId = props.applicationId;
  const owner = props.userId;
  const cloud = props.client && owner ? createAttachmentMetadataRepository(props.client, () => owner) : null;
  loading.value = true; loadFailed.value = false; busy.value = false; error.value = ''; notice.value = ''; selectedLibraryId.value = '';
  documents.value = []; sharedDocuments.value = []; manifest.value = defaultPackageManifest(applicationId); clearPreview();
  try {
    const [nextDocuments, nextManifest, remote] = await Promise.all([repo.listDocuments(), repo.getManifest(applicationId), cloud ? cloud.list().then((value) => ({ value, error: '' })).catch(() => ({ value: [], error: text('Shared attachment descriptions could not be loaded. Local files remain available. Reopen PDF review to retry.', 'Geteilte Anhangsbeschreibungen konnten nicht geladen werden. Lokale Dateien bleiben verfügbar. Zum Wiederholen die PDF-Prüfung erneut öffnen.') })) : Promise.resolve({ value: [], error: '' })]);
    if (token !== generation || disposed) return;
    documents.value = nextDocuments; sharedDocuments.value = remote.value; manifest.value = nextManifest; error.value = remote.error;
  } catch (reason) { if (token === generation && !disposed) { loadFailed.value = true; reportError(reason); } }
  finally { if (token === generation && !disposed) { loading.value = false; flushPendingRefresh(); } }
}
watch(() => [props.userId, props.applicationId, props.client], load, { immediate: true });
watch(() => props.active, (active) => { if (active) refreshIfActive(); });
function flushPendingRefresh() { if (reloadPending && props.active && !busy.value && !loading.value) void load(); }
function refreshIfActive() { if (props.active) { reloadPending = true; clearPreview(); flushPendingRefresh(); } }
function attachmentFilesChanged() { reloadPending = true; clearPreview(); flushPendingRefresh(); }
onMounted(() => { window.addEventListener('focus', refreshIfActive); window.addEventListener('cv-local-documents-updated', attachmentFilesChanged); });
watch(() => [props.cvState, props.cvReady, props.exportReady, props.letterReady, props.letterRevision], clearPreview, { deep: true });
watch([includedCount, problems], () => emit('readiness', { included: includedCount.value, missing: problems.value.length }), { immediate: true });

async function perform(operation: (repo: LocalDocumentRepository, applicationId: string, token: number) => Promise<void>) {
  if (busy.value || loading.value || loadFailed.value) return;
  const token = generation;
  busy.value = true; error.value = ''; notice.value = '';
  try { await operation(repository.value, props.applicationId, token); }
  catch (reason) { if (token === generation && !disposed) reportError(reason); }
  finally { if (token === generation && !disposed) { busy.value = false; flushPendingRefresh(); } }
}
function current(token: number) { return token === generation && !disposed; }
async function updateManifest(next: ApplicationPackageManifest) {
  await perform(async (repo, _applicationId, token) => {
    await repo.saveManifest(next);
    if (!current(token)) return;
    manifest.value = next; clearPreview();
  });
}
function toggleItem(id: string, included: boolean) {
  void updateManifest({ ...manifest.value, items: manifest.value.items.map((item) => item.id === id ? { ...item, included } : item) });
}
function moveItem(index: number, direction: number) {
  const items = manifest.value.items.slice();
  const target = index + direction;
  if (target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target]!, items[index]!];
  void updateManifest({ ...manifest.value, items });
}
function removeItem(id: string) { void updateManifest({ ...manifest.value, items: manifest.value.items.filter((item) => item.id !== id) }); }
function attachLibraryDocument() {
  const document = selectedLibraryDocument.value;
  if (busy.value || loading.value || loadFailed.value || !document || !canAttach.value) return;
  void updateManifest({ ...manifest.value, items: [...manifest.value.items, { id: newLocalId(), kind: 'attachment', documentId: document.id, label: document.name, included: true }] });
  selectedLibraryId.value = '';
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = safeDocumentFilename(filename); anchor.hidden = true;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  // The browser must consume the navigation before the temporary URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function buildPreview() {
  if (!canBuild.value) return;
  const previewToken = previewGeneration.value;
  attemptedPreview = previewToken;
  previewBusy.value = true;
  previewFailed.value = false;
  try {
    await perform(async (repo, _applicationId, token) => {
      try {
        const result = await composeApplicationPackage(structuredClone(manifest.value), { cvReady: cvAvailable.value, letterReady: props.letterReady, getCvPdf: props.getCvPdf, getLetterPdf: props.getLetterPdf, getDocument: (id) => repo.getDocument(id) });
        if (!current(token) || previewToken !== previewGeneration.value) return;
        composition.value = result;
      } catch (reason) {
        if (!current(token) || previewToken !== previewGeneration.value) return;
        previewFailed.value = true;
        throw reason;
      }
    });
  } finally { previewBusy.value = false; }
}
// Retry changed inputs after an in-flight render finishes, but never loop on a failed PDF.
watch([canBuild, previewGeneration], () => {
  if (canBuild.value && attemptedPreview !== previewGeneration.value) void buildPreview();
}, { flush: 'post' });
function downloadPackage() {
  const result = composition.value;
  if (!result || busy.value) return;
  downloadBlob(result.blob, `application-${props.applicationId}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
async function exportBackup() {
  await perform(async (repo, _applicationId, token) => {
    const blob = await repo.exportBackup();
    if (current(token)) downloadBlob(blob, `application-documents-backup-${new Date().toISOString().slice(0, 10)}.json`);
  });
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  if (!window.confirm(text('Restore documents and package arrangements from this backup? Matching records will be replaced. Other files remain available.', 'Dokumente und Zusammenstellungen aus diesem Backup wiederherstellen? Übereinstimmende Einträge werden ersetzt. Andere Dateien bleiben verfügbar.'))) return;
  await perform(async (repo, applicationId, token) => {
    const restored = await repo.importBackup(file);
    const [nextDocuments, nextManifest] = await Promise.all([repo.listDocuments(), repo.getManifest(applicationId)]);
    if (!current(token)) return;
    documents.value = nextDocuments; manifest.value = nextManifest; clearPreview();
    notice.value = text(`Restored ${restored.documents} documents and ${restored.packages} package arrangements.`, `${restored.documents} Dokumente und ${restored.packages} Zusammenstellungen wiederhergestellt.`);
  });
}
onBeforeUnmount(() => { disposed = true; generation++; clearPreview(); window.removeEventListener('focus', refreshIfActive); window.removeEventListener('cv-local-documents-updated', attachmentFilesChanged); });
useToastWatch(() => notice.value, { tone: 'success' });
useToastWatch(() => props.active && loading.value ? text('Loading local documents…', 'Lokale Dokumente werden geladen…') : '', { passive: true });
useToastWatch(() => props.active && previewBusy.value ? text('Updating PDF preview…', 'PDF-Vorschau wird aktualisiert…') : '', { key: 'pdf-preview-progress', passive: true });
useToastWatch(() => error.value, () => ({
  tone: 'error',
  action: loadFailed.value
    ? { label: text('Retry local storage', 'Lokalen Speicher erneut öffnen'), run: load }
    : previewFailed.value ? { label: text('Retry preview', 'Vorschau erneut versuchen'), run: buildPreview } : undefined,
}));
useToastWatch(() => previewError.value, () => ({
  tone: 'error', action: { label: text('Retry preview', 'Vorschau erneut versuchen'), run: () => { retryPreview(); } },
}));
</script>

<template>
  <section :class="['application-documents', 'documents-mode-' + mode]" :aria-label="text('Documents and export', 'Dokumente und Export')">
      <div class="documents-controls">
        <template v-if="!loading && !loadFailed">
        <slot v-if="mode !== 'review'" />
        <section v-show="mode !== 'tracking'" class="document-section">
          <ol class="package-items">
            <li v-for="(item, index) in manifest.items" :key="item.id" :class="{ excluded: !item.included, missing: problems.some((problem) => problem.id === item.id) }">
              <div class="package-item-main"><input :id="`package-${item.id}`" type="checkbox" :checked="item.included" :disabled="busy" @change="toggleItem(item.id, ($event.target as HTMLInputElement).checked)" /><label :for="`package-${item.id}`">{{ itemLabel(item) }}</label><InfoHint v-if="(mode === 'review' || item.kind === 'attachment') && problems.find((problem) => problem.id === item.id)" :lang="lang" :label="itemLabel(item)" :text="problems.find((problem) => problem.id === item.id)?.message || ''" /><InfoHint v-else-if="item.kind === 'attachment' && !itemDescription(item.documentId)" :lang="lang" :label="itemLabel(item)" :text="text('Description missing. Edit this attachment in CV Studio to add one.', 'Beschreibung fehlt. Diesen Anhang im CV-Studio bearbeiten und eine Beschreibung ergänzen.')" /></div>
              <div class="item-actions"><button type="button" :disabled="busy || index === 0" :aria-label="text(`Move ${itemLabel(item)} up`, `${itemLabel(item)} nach oben`)" @click="moveItem(index, -1)"><FontAwesomeIcon :icon="faArrowUp" aria-hidden="true" /></button><button type="button" :disabled="busy || index === manifest.items.length - 1" :aria-label="text(`Move ${itemLabel(item)} down`, `${itemLabel(item)} nach unten`)" @click="moveItem(index, 1)"><FontAwesomeIcon :icon="faArrowDown" aria-hidden="true" /></button><button v-if="item.kind === 'attachment'" type="button" :disabled="busy" :aria-label="text(`Remove ${item.label} from package`, `${item.label} aus Zusammenstellung entfernen`)" @click="removeItem(item.id)"><FontAwesomeIcon :icon="faXmark" aria-hidden="true" /></button></div>
              <p v-if="item.kind === 'attachment' && itemDescription(item.documentId)" class="attachment-description">{{ itemDescription(item.documentId) }}</p>
            </li>
          </ol>
          <InfoHint v-if="!includedCount" :lang="lang" :label="text('PDF package', 'PDF-Zusammenstellung')" :text="text('Include at least one document to create a package.', 'Mindestens ein Dokument für die Zusammenstellung auswählen.')" />
          <div v-if="libraryOptions.length" class="library-picker"><select v-model="selectedLibraryId" :disabled="busy" :aria-label="text('Choose an existing document', 'Vorhandenes Dokument auswählen')" @change="attachLibraryDocument"><option value="">{{ text('From local attachment library…', 'Aus lokaler Anhangsbibliothek…') }}</option><option v-for="document in libraryOptions" :key="document.id" :value="document.id" :disabled="!availableIds.has(document.id) || !document.description?.trim()">{{ document.name }}{{ !availableIds.has(document.id) ? text(' — file missing on this device', ' — Datei fehlt auf diesem Gerät') : !document.description?.trim() ? text(' — description needed in CV Studio', ' — Beschreibung im CV-Studio ergänzen') : '' }}</option></select></div>
          <p v-if="!library.length" class="app-hint muted">{{ text('Add a named attachment with a description in CV Studio, then select it here.', 'Einen benannten Anhang mit Beschreibung im CV-Studio hinzufügen und dann hier auswählen.') }}</p>
          <DesktopSidebarPortal v-if="mode === 'review'" area="major" :active="active">
            <WorkspaceMobileActions :active="active && mode === 'review'">
            <div class="package-actions" :class="{ 'package-actions--sidebar': desktopSidebar }"><button type="button" :aria-label="text('Download PDF', 'PDF herunterladen')" :disabled="busy || !composition" @click="downloadPackage"><span class="package-action-label">{{ text('Download PDF', 'PDF herunterladen') }}</span><span class="package-action-label--mobile">{{ text('Download', 'Herunterladen') }}</span></button></div>
            </WorkspaceMobileActions>
          </DesktopSidebarPortal>
        </section>
        <details v-if="mode === 'tracking'" class="document-section">
          <summary>{{ text('Local backup', 'Lokales Backup') }}<InfoHint :lang="lang" :label="text('Local backup', 'Lokales Backup')" :text="text('Manage reusable files, names and descriptions in CV Studio → Local attachments. This backup includes local attachments, package order, and archived PDFs. Clearing browser data removes local files; keep a backup. Back up your editable CVs separately in CV Studio.', 'Wiederverwendbare Dateien, Namen und Beschreibungen unter CV-Studio → Lokale Anhänge verwalten. Dieses Backup enthält lokale Anhänge, die Reihenfolge und archivierte PDFs. Beim Löschen der Browserdaten gehen lokale Dateien verloren; ein Backup aufbewahren. Bearbeitbare Lebensläufe separat im CV-Studio sichern.')" /></summary>
          <div class="backup-actions"><button type="button" :disabled="busy" @click="exportBackup">{{ text('Back up files & packages', 'Dateien & Zusammenstellungen sichern') }}</button><label class="file-button secondary" :class="{ disabled: busy }">{{ text('Restore backup', 'Backup wiederherstellen') }}<input type="file" accept="application/json,.json" :disabled="busy" @change="importBackup" /></label></div>
        </details>
        </template>
      </div>
      <section v-show="mode === 'review'" class="package-preview document-section" :aria-label="text('Complete PDF preview', 'Vorschau des gesamten PDFs')">
        <InlineDocumentPreview v-if="composition && !previewError" class="package-inline-pdf" v-model:page="previewPage" :pages="previewPages" :is-updating="previewBusy || previewLoading" :lang="lang" :title="text('Complete application PDF', 'Vollständige Bewerbungsunterlagen als PDF')" hide-actions show-on-mobile />
        <div v-else class="preview-empty" :aria-busy="previewBusy || previewLoading"><FontAwesomeIcon class="preview-empty-icon" :icon="faFilePdf" aria-hidden="true" /><InfoHint :lang="lang" :label="text('Complete PDF preview', 'Vorschau des gesamten PDFs')" :text="text('The complete PDF appears automatically once the selected documents are ready.', 'Das gesamte PDF erscheint automatisch, sobald die ausgewählten Unterlagen bereit sind.')" /><button v-if="previewFailed || previewError" type="button" :disabled="!canBuild" @click="previewError ? retryPreview() : buildPreview()">{{ text('Retry preview', 'Vorschau erneut versuchen') }}</button></div>
        <div class="package-preview-actions">
          <details v-if="composition" class="page-map-summary"><summary>{{ text('Document order', 'Dokumentreihenfolge') }}</summary><ul class="page-map"><li v-for="document in composition.documents" :key="document.itemId">{{ document.label }} <span>{{ text('p.', 'S.') }} {{ document.firstPage }}<template v-if="document.pageCount > 1">–{{ document.firstPage + document.pageCount - 1 }}</template></span></li></ul></details>
          <DesktopSidebarPortal area="minor" :active="active && mode === 'review'">
            <WorkspaceMobileActions :active="active && mode === 'review'">
            <button class="package-preview-open" type="button" :aria-label="text('Open preview', 'Vorschau öffnen')" :disabled="!previewPages.length || !!previewError" @click="expanded = true"><span class="package-action-label">{{ text('Open preview', 'Vorschau öffnen') }}</span><span class="package-action-label--mobile">{{ text('Preview', 'Vorschau') }}</span></button>
            </WorkspaceMobileActions>
          </DesktopSidebarPortal>
        </div>
      </section>
      <section v-if="mode === 'review' && $slots.default" class="application-checklist"><slot /></section>
    <FullDocumentPreview v-model="expanded" v-model:page="previewPage" :pages="previewPages" :is-updating="previewBusy || previewLoading" :title="text('Complete application PDF', 'Vollständige Bewerbungsunterlagen als PDF')" :lang="lang" :error="previewError" :download-disabled="busy || !composition" @download="downloadPackage" />
  </section>
</template>

<style scoped>
.application-documents.documents-mode-prepare,.application-documents.documents-mode-tracking{display:block;overflow:visible;flex:none;padding-bottom:20px}.documents-mode-prepare .documents-controls,.documents-mode-tracking .documents-controls{overflow:visible}

.application-documents { display:grid; flex:1 1 auto; grid-template-columns:minmax(0,1fr) minmax(360px,30%); align-items:start; align-content:start; gap:20px; min-width:0; min-height:0; overflow:visible; color:#d1fae5; background:transparent; padding:0; color-scheme:dark; }
h3,h4,p { margin:0; } h3 { color:inherit; font-size:1.2rem; } h4 { color:inherit; font-size:1rem; margin-bottom:10px; }
.muted { color:#a6c1b9; font-size:.88rem; line-height:1.5; margin-top:7px; }
.documents-controls { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:visible; padding-right:4px; }
.documents-controls > * { flex-shrink:0; }
.package-preview { display:flex; flex-direction:column; min-height:0; overflow:visible; gap:10px; }
.package-preview > :not(.package-inline-pdf):not(.preview-empty) { flex-shrink:0; }
.document-section { min-width:0; }
.application-checklist { grid-column:1 / -1; min-width:0; }
.documents-controls > details.document-section { padding-top:16px; border-top:1px solid #28534e; }
summary { font-weight:650; cursor:pointer; }
button,.file-button,select { font:inherit; font-size:.84rem; border-radius:7px; border:1px solid #28534e; padding:8px 11px; background:#06141f; color:#d1fae5; cursor:pointer; }
button:hover:not(:disabled),.file-button:hover:not(.disabled) { background:#15362f; }
button:focus-visible,.file-button:focus-within,select:focus-visible { outline:2px solid #67c8a6; outline-offset:2px; }
button:disabled,.disabled { opacity:.5; cursor:not-allowed; }
.primary,.file-button { background:#185b4c; color:#effff6; border-color:#438f76; }
.primary:hover:not(:disabled),.file-button:hover:not(.disabled) { background:#216c58; }
.file-button { display:inline-block; position:relative; overflow:hidden; }
.file-button input { position:absolute; width:1px; height:1px; opacity:0; }
.secondary { background:#06141f; color:#d1fae5; border-color:#28534e; }
.secondary:hover:not(.disabled) { background:#15362f; }
.package-items { padding:0; list-style:none; margin:12px 0; display:flex; flex-direction:column; gap:4px; }
.package-items li { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 0; border-bottom:1px solid #173b37; }
.package-item-main { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
.package-item-main label { color:inherit; overflow-wrap:anywhere; font-size:.88rem; cursor:pointer; }
input[type="checkbox"] { accent-color:#67c8a6; width:16px; height:16px; flex-shrink:0; }
.excluded .package-item-main { opacity:.5; }
.package-items .missing { border-color:#805840; }
.item-actions { display:flex; gap:4px; flex-wrap:wrap; }
.item-actions button { display:inline-flex; align-items:center; justify-content:center; padding:4px 8px; min-width:36px; min-height:36px; }
.item-actions svg { width:1em; height:1em; }
.attachment-description { flex-basis:100%; color:#a6c1b9; white-space:pre-wrap; overflow-wrap:anywhere; font-size:.82rem; line-height:1.5; }
.package-actions,.backup-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }
.package-actions--sidebar { margin-top:0; }
.package-actions--sidebar button { width:100%; }
.package-action-label--mobile{display:none}
.library-picker { display:flex; gap:7px; margin-top:10px; } select { min-width:0; flex:1; }
.page-map { list-style:none; padding:0; margin:14px 0; }
.package-inline-pdf { width:100%; height:auto; flex:none; overflow:visible; }
.package-inline-pdf :deep(.document-inline-preview__viewport) { overflow:visible; overscroll-behavior:auto; }
.package-preview-actions { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.package-preview-actions > button { flex-shrink:0; margin-left:auto; }
.page-map-summary { flex:1; min-width:0; }
.package-preview a { font-size:.84rem; color:#9ee6c7; }
.page-map li { display:flex; justify-content:space-between; gap:15px; font-size:.82rem; padding:5px 0; } .page-map span { flex-shrink:0; color:#a6c1b9; }
.preview-empty { flex:none; height:65vh; min-height:360px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; max-width:300px; margin:auto; }
.preview-empty-icon { font-size:46px; color:var(--ui-muted); margin-bottom:16px; }
@media(max-width:1180px) { .application-documents { grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto; } }
@media(max-width:760px){
  .package-action-label{display:none}
  .package-action-label--mobile{display:inline;white-space:nowrap}
  .preview-empty{height:auto;min-height:0;max-width:none;width:100%;padding:16px 0;gap:12px}
  .preview-empty-icon{font-size:32px;margin-bottom:0}
  .preview-empty button{min-height:44px}
}
@media(max-width:760px),(any-pointer:coarse){
  .item-actions button{min-width:44px;min-height:44px}
  .package-item-main{min-height:44px}
  .package-item-main label{display:flex;align-items:center;align-self:stretch;flex:1}
}
@media(max-width:760px), (max-width:1180px) and (max-height:600px) {
  .application-documents { display:flex; flex-direction:column; align-items:stretch; gap:20px; }
  .documents-controls { flex:none; overflow:visible; padding-right:0; }
  .package-preview { flex:none; }
}
</style>
