<script setup lang="ts">
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { faCloud, faCloudArrowUp, faLaptop, faTriangleExclamation, faPen, faPaperclip, faChevronDown, faFolderOpen, faLinkSlash, faDownload, faTrash, faPlus } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import PreviewDialog from '../../../shared/ui/PreviewDialog.vue';
import FullDocumentPreview from '../../../documents/pdf/components/FullDocumentPreview.vue';
import type { AttachmentMetadata, LocalDocument, LocalDocumentMetadata } from '../documentTypes';
import { LocalDocumentRepository, safeDocumentFilename, type LocalDocumentStorage } from '../data/localDocuments';
import { createAttachmentMetadataRepository } from '../data/attachmentMetadata';
import { usePdfBlobPreview } from '../../../documents/pdf/composables/usePdfBlobPreview';
import { useToastWatch } from '../../../shared/ui/useToasts';
import DesktopSidebarPortal from '../../../shared/ui/DesktopSidebarPortal.vue';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import SectionHeading from '../../../shared/ui/SectionHeading.vue';
import { commitPendingTextareas } from '../../../shared/editing/textareaCommit';
import { flushEditorSessionSync } from '../../../shared/editing/editorSession';
import { useDesktopSidebar } from '../../../shared/ui/desktopSidebar';

const props = withDefaults(defineProps<{ userId: string; lang?: string; client?: SupabaseClient | null; active?: boolean; sidebarActive?: boolean; storage?: LocalDocumentStorage }>(), { active: true, sidebarActive: true, client: null });
const emit = defineEmits<{ changed: [] }>();
const desktopSidebar = useDesktopSidebar();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
type Entry = { id: string; name: string; description?: string; local?: LocalDocumentMetadata; shared?: AttachmentMetadata };
const localDocuments = ref<LocalDocumentMetadata[]>([]);
const sharedDocuments = ref<AttachmentMetadata[]>([]);
const entries = computed<Entry[]>(() => {
  const byId = new Map<string, Entry>(sharedDocuments.value.map((shared) => [shared.id, { ...shared, shared }]));
  for (const local of localDocuments.value) {
    const shared = byId.get(local.id)?.shared;
    // Legacy names may be original filenames; only explicit metadata or approved cloud text is shareable.
    byId.set(local.id, { ...(local.description?.trim() ? local : shared || local), local, shared });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
});
const connected = computed(() => !!props.userId && !!props.client);
const loading = ref(false);
const loadFailed = ref(false);
const cloudFailed = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const draftRetry = shallowRef<(() => boolean) | null>(null);
let draftFailure = '';
useToastWatch(() => notice.value, { tone: 'success' });
useToastWatch(() => props.active && loading.value ? text('Loading attachments…', 'Anhänge werden geladen…') : '', { passive: true });
useToastWatch(() => error.value, () => ({
  tone: 'error',
  ...(draftRetry.value && error.value === draftFailure ? { action: { label: text('Retry', 'Erneut versuchen'), run: draftRetry.value } } : (loadFailed.value || cloudFailed.value) ? { action: { label: text('Retry', 'Erneut versuchen'), run: scopedLoadRetry() } } : {}),
}));
const editingId = ref('');
const formVisible = ref(false);
const formCollapsed = ref(false);
const formContentId = `attachment-editor-${useId()}`;
const name = ref('');
const description = ref('');
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dirty = ref(false);
const editingEntry = computed(() => entries.value.find((entry) => entry.id === editingId.value));
const attachmentRows = computed<{ key: string; entry: Entry | null; editor: boolean }[]>(() => {
  const rows = entries.value.map(entry => ({ key: `${props.userId}:${entry.id}`, entry, editor: formVisible.value && editingId.value === entry.id }));
  if (formVisible.value && !editingEntry.value) return [...rows, { key: `${props.userId}:editor:${editingId.value || 'new'}`, entry: null, editor: true }];
  return rows;
});
const attachmentList = ref<HTMLUListElement | null>(null);
const attachmentForm = ref<HTMLFormElement | null>(null);
const newAttachmentButton = ref<HTMLButtonElement | null>(null);
let formElementKey = '', fileElementKey = '';
function setAttachmentForm(key: string, element: unknown) {
  if (element) { attachmentForm.value = element as HTMLFormElement; formElementKey = key; }
  else if (formElementKey === key) { attachmentForm.value = null; formElementKey = ''; }
}
function setFileInput(key: string, element: unknown) {
  if (element) { fileInput.value = element as HTMLInputElement; fileElementKey = key; }
  else if (fileElementKey === key) { fileInput.value = null; fileElementKey = ''; }
}
const previewDocument = shallowRef<LocalDocument | null>(null);
const previewUrl = ref('');
const previewName = computed(() => previewDocument.value?.name || '');
const previewPage = ref(1);
const previewPdfOpen = computed(() => props.active && previewDocument.value?.mimeType === 'application/pdf');
const { pages: previewPages, loading: previewLoading, error: previewError, retry: retryPreview } = usePdfBlobPreview(
  () => previewPdfOpen.value ? previewDocument.value!.blob : null,
);
useToastWatch(() => previewError.value, () => ({ tone: 'error', action: { label: text('Retry preview', 'Vorschau erneut versuchen'), run: scopedPreviewRetry() } }));
let previewGeneration = 0;
let generation = 0;
let disposed = false;
let draftOwner = props.userId;
let editorGeneration = 0;
let replacingDraft = false;
type FailedDraft = { id: string; name: string; description: string; file: File | null; collapsed: boolean; error: string };
// Recovery stays in this component and retains at most one blocked editor per owner.
const failedDrafts = new Map<string, FailedDraft>();
function snapshotDraft(): FailedDraft { return { id: editingId.value, name: name.value, description: description.value, file: file.value, collapsed: formCollapsed.value, error: draftFailure }; }
function retainFailedDraft() { if (formVisible.value && dirty.value) failedDrafts.set(draftOwner, snapshotDraft()); }
function scopedLoadRetry() {
  const owner = props.userId; const id = editingId.value; const token = editorGeneration;
  return () => !disposed && props.userId === owner && draftOwner === owner && editingId.value === id && token === editorGeneration ? load() : false;
}
function scopedPreviewRetry() {
  const owner = props.userId; const id = previewDocument.value?.id; const token = previewGeneration;
  return () => !disposed && props.userId === owner && previewDocument.value?.id === id && token === previewGeneration ? retryPreview() : false;
}
function retryDraft() {
  const owner = draftOwner; const id = editingId.value; const token = editorGeneration;
  return () => !disposed && props.userId === owner && draftOwner === owner && editingId.value === id && token === editorGeneration ? flush() : false;
}
function restoreFailedDraft() {
  const retained = failedDrafts.get(draftOwner);
  if (!retained) return;
  replacingDraft = true;
  editingId.value = retained.id; name.value = retained.name; description.value = retained.description;
  file.value = retained.file; formVisible.value = true; formCollapsed.value = retained.collapsed; dirty.value = true;
  replacingDraft = false;
  draftFailure = retained.error; draftRetry.value = retryDraft(); error.value = retained.error;
  const owner = draftOwner; const token = editorGeneration;
  void nextTick(() => {
    if (disposed || draftOwner !== owner || props.userId !== owner || token !== editorGeneration || !fileInput.value || file.value !== retained.file || !retained.file || typeof DataTransfer === 'undefined') return;
    const transfer = new DataTransfer(); transfer.items.add(retained.file); fileInput.value.files = transfer.files;
  });
}
const repository = () => new LocalDocumentRepository(props.userId, props.storage);
const cloudRepository = () => { const owner = props.userId; return props.client && owner ? createAttachmentMetadataRepository(props.client, () => owner) : null; };
const current = (token: number) => token === generation && !disposed;
function message(reason: unknown) { return reason instanceof Error ? reason.message : text('The operation failed. Please retry.', 'Der Vorgang ist fehlgeschlagen. Bitte erneut versuchen.'); }
function clearPreview() {
  previewGeneration++;
  previewDocument.value = null;
  previewPage.value = 1;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
}
function changed() { emit('changed'); window.dispatchEvent(new Event('cv-local-documents-updated')); }
const draftKey = (id = editingId.value, owner = draftOwner) => `cv-attachment-draft:v1:${encodeURIComponent(owner)}:${encodeURIComponent(id || 'new')}`;
function persistDraft(): boolean {
  if (!formVisible.value || !dirty.value) return true;
  try {
    if (typeof localStorage === 'undefined' || !localStorage) throw new Error(text('Private draft storage is unavailable. Please retry before leaving.', 'Der private Entwurfsspeicher ist nicht verfügbar. Vor dem Verlassen erneut versuchen.'));
    localStorage.setItem(draftKey(), JSON.stringify({ name: name.value, description: description.value }));
    const retained = failedDrafts.get(draftOwner);
    if (retained?.id === editingId.value && retained.name === name.value && retained.description === description.value && retained.file === file.value) failedDrafts.delete(draftOwner);
    if (error.value === draftFailure) error.value = '';
    draftFailure = ''; draftRetry.value = null;
    return true;
  } catch (reason) {
    draftFailure = message(reason); draftRetry.value = retryDraft(); error.value = draftFailure; retainFailedDraft(); return false;
  }
}
function flushDraft(): boolean {
  const owner = draftOwner; const id = editingId.value; const token = editorGeneration;
  return flushEditorSessionSync({ steps: [persistDraft], current: () => owner === draftOwner && id === editingId.value && token === editorGeneration, settled: () => !busy.value });
}
function flush(): boolean { return !disposed && draftOwner === props.userId && flushDraft(); }
defineExpose({ flush });
function commitDescription() { dirty.value = true; persistDraft(); }
function restoreDraft() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(draftKey());
    if (!raw) return;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || !('name' in saved) || !('description' in saved)
      || typeof saved.name !== 'string' || typeof saved.description !== 'string'
      || saved.name.length > 200 || saved.description.length > 4000) return;
    name.value = saved.name; description.value = saved.description; dirty.value = true;
  } catch (reason) { error.value = message(reason); }
}
function clearDraft(key = draftKey()) {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch (reason) { error.value = message(reason); }
}
function focusEditorTrigger(id = '') {
  const owner = draftOwner; const token = editorGeneration;
  void nextTick(() => {
    if (!props.active || disposed || owner !== draftOwner || owner !== props.userId || token !== editorGeneration) return;
    const trigger = id ? [...(attachmentList.value?.querySelectorAll<HTMLButtonElement>('button[data-attachment-edit]') || [])].find(button => button.dataset.attachmentEdit === id) : null;
    (trigger || newAttachmentButton.value)?.focus({ preventScroll: true });
  });
}
function cancelEdit() { const id = editingId.value; clearDraft(); if (failedDrafts.get(draftOwner)?.id === editingId.value) failedDrafts.delete(draftOwner); resetForm(); error.value = ''; focusEditorTrigger(id); }
function resetForm() {
  replacingDraft = true;
  draftRetry.value = null; draftFailure = '';
  editingId.value = ''; formVisible.value = false; formCollapsed.value = false; name.value = ''; description.value = ''; file.value = null; dirty.value = false;
  if (fileInput.value) fileInput.value.value = '';
  replacingDraft = false;
}
function focusAttachmentForm() {
  const owner = draftOwner; const id = editingId.value; const token = editorGeneration;
  void nextTick(() => {
    const form = attachmentForm.value;
    if (!form || !props.active || disposed || owner !== draftOwner || owner !== props.userId || id !== editingId.value || token !== editorGeneration) return;
    form.querySelector('input')?.focus({ preventScroll: true });
    form.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}
function toggleForm() {
  if (!flush()) return;
  formCollapsed.value = !formCollapsed.value;
}
function edit(entry?: Entry) {
  if (busy.value) return;
  if (!flush()) return;
  if (formVisible.value && editingId.value === (entry?.id || '')) {
    formCollapsed.value = false;
    focusAttachmentForm();
    return;
  }
  editorGeneration++;
  editingId.value = entry?.id || ''; name.value = entry?.description?.trim() ? entry.name : ''; description.value = entry?.description || '';
  file.value = null; dirty.value = false; formVisible.value = true; formCollapsed.value = false; error.value = ''; notice.value = '';
  restoreDraft();
  focusAttachmentForm();
  if (fileInput.value) fileInput.value.value = '';
}
function chooseFile(event: Event) { file.value = (event.target as HTMLInputElement).files?.[0] || null; dirty.value = true; }
function syncState(entry: Entry) {
  if (!entry.description?.trim()) return { icon: faTriangleExclamation, label: text('Add a description to share this entry', 'Zum Teilen eine Beschreibung ergänzen'), warning: true };
  if (!connected.value) return { icon: faLaptop, label: text('Saved on this device', 'Auf diesem Gerät gespeichert') };
  if (cloudFailed.value) return { icon: faTriangleExclamation, label: text('Cloud status unavailable', 'Cloud-Status nicht verfügbar'), warning: true };
  return entry.shared?.name === entry.name && entry.shared?.description === entry.description
    ? { icon: faCloud, label: text('Name and description saved to Supabase', 'Name und Beschreibung in Supabase gespeichert') }
    : { icon: faCloudArrowUp, label: text('Metadata not yet synced — edit and save to retry', 'Metadaten noch nicht synchronisiert — bearbeiten und erneut speichern'), warning: true };
}
async function load() {
  if (busy.value || disposed) return;
  const token = ++generation;
  const repo = repository(); const cloud = cloudRepository();
  loading.value = true; loadFailed.value = false; cloudFailed.value = false; error.value = '';
  const [local, remote] = await Promise.allSettled([repo.listDocuments(), cloud ? cloud.list() : Promise.resolve([])]);
  if (!current(token)) return;
  if (local.status === 'fulfilled') localDocuments.value = local.value;
  else { loadFailed.value = true; error.value = message(local.reason); }
  if (remote.status === 'fulfilled') sharedDocuments.value = remote.value;
  else { cloudFailed.value = true; error.value = text('Local files remain available. Could not load shared names and descriptions: ', 'Lokale Dateien bleiben verfügbar. Geteilte Namen und Beschreibungen konnten nicht geladen werden: ') + message(remote.reason); }
  loading.value = false;
  // A refresh never replaces an in-progress manual edit or unsynced local metadata.
  if (formVisible.value && editingId.value && !dirty.value && editingEntry.value) {
    name.value = editingEntry.value.description?.trim() ? editingEntry.value.name : ''; description.value = editingEntry.value.description || '';
  }
}
watch(() => [name.value, description.value, file.value, formCollapsed.value], () => {
  if (!replacingDraft && failedDrafts.get(draftOwner)?.id === editingId.value) retainFailedDraft();
}, { flush: 'sync' });
watch(() => [props.userId, props.client], () => {
  if (!flushDraft()) retainFailedDraft();
  draftOwner = props.userId; editorGeneration++;
  generation++; busy.value = false; localDocuments.value = []; sharedDocuments.value = []; resetForm(); clearPreview(); notice.value = ''; error.value = '';
  void load(); restoreFailedDraft();
}, { immediate: true });
watch(() => props.active, (active) => { if (active) void load(); else { flushDraft(); clearPreview(); } });
function refreshIfActive() { if (props.active && !busy.value) void load(); }
onMounted(() => { window.addEventListener('focus', refreshIfActive); window.addEventListener('cv-local-documents-updated', refreshIfActive); });
onBeforeUnmount(() => { flushDraft(); disposed = true; generation++; clearPreview(); window.removeEventListener('focus', refreshIfActive); window.removeEventListener('cv-local-documents-updated', refreshIfActive); });
async function save() {
  if (!commitPendingTextareas()) return;
  persistDraft();
  if (busy.value || loading.value || loadFailed.value) return;
  const token = generation; const repo = repository(); const cloud = cloudRepository();
  const savedDraftKey = draftKey();
  const savedDraft = snapshotDraft();
  const nextName = name.value.trim(); const nextDescription = description.value.trim(); const nextFile = file.value;
  if (!nextName || !nextDescription) { error.value = text('Enter a name and description yourself before saving.', 'Vor dem Speichern einen Namen und eine Beschreibung selbst eingeben.'); return; }
  if (!editingId.value && !nextFile) { error.value = text('Choose a local PDF or image for this attachment.', 'Ein lokales PDF oder Bild für diesen Anhang auswählen.'); return; }
  busy.value = true; error.value = ''; notice.value = '';
  let localSaved = false;
  let cloudSaved = false;
  try {
    let id = editingId.value;
    const local = localDocuments.value.find((entry) => entry.id === id);
    if (nextFile) {
      const saved = id ? await repo.putDocumentFile(id, nextFile, nextName, nextDescription) : await repo.addDocument(nextFile, nextName, nextDescription);
      id = saved.id; localSaved = true;
      if (!current(token)) return;
      // Retain the generated ID if cloud syncing fails, so retrying cannot duplicate a file.
      const retained = failedDrafts.get(draftOwner)?.id === editingId.value;
      editingId.value = id; file.value = null; if (fileInput.value) fileInput.value.value = '';
      if (retained) retainFailedDraft();
      localDocuments.value = [saved, ...localDocuments.value.filter((entry) => entry.id !== id)];
    } else if (local) {
      const saved = await repo.updateDocumentMetadata(id, nextName, nextDescription); localSaved = true;
      if (!current(token)) return;
      localDocuments.value = localDocuments.value.map((entry) => entry.id === id ? saved : entry);
    }
    if (!current(token)) return;
    if (cloud) {
      const saved = await cloud.save({ id, name: nextName, description: nextDescription });
      if (!current(token)) return;
      cloudSaved = true;
      sharedDocuments.value = [saved, ...sharedDocuments.value.filter((entry) => entry.id !== id)]; cloudFailed.value = false;
    } else if (!localSaved) throw new Error(text('The local file is unavailable. Attach it before saving offline.', 'Die lokale Datei fehlt. Zum Offline-Speichern zuerst hinzufügen.'));
    clearDraft(savedDraftKey); clearDraft();
    const retained = failedDrafts.get(draftOwner);
    if (retained?.id === editingId.value && retained.name === savedDraft.name && retained.description === savedDraft.description && (!retained.file || retained.file === savedDraft.file)) failedDrafts.delete(draftOwner);
    dirty.value = false; resetForm(); focusEditorTrigger(savedDraft.id);
    notice.value = cloud ? text('Saved. Only your name and description were shared; the file stays on this device.', 'Gespeichert. Nur der eingegebene Name und die Beschreibung wurden geteilt; die Datei bleibt auf diesem Gerät.') : text('Attachment saved in this local profile. To use it in an account, sign in and add the file, name and description to that account’s library.', 'Anhang in diesem lokalen Profil gespeichert. Zur Verwendung in einem Konto anmelden und Datei, Name und Beschreibung zu dessen Bibliothek hinzufügen.');
  } catch (reason) {
    if (current(token)) error.value = (localSaved ? text('The file and your metadata are saved locally. Cloud sync failed; save again to retry. ', 'Datei und Metadaten sind lokal gespeichert. Cloud-Synchronisierung fehlgeschlagen; zum Wiederholen erneut speichern. ') : '') + message(reason);
  } finally {
    if (current(token)) { if (localSaved || cloudSaved) changed(); busy.value = false; }
  }
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeDocumentFilename(filename); anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadDocument(document: LocalDocument) {
  const extension = document.mimeType === 'application/pdf' ? 'pdf' : document.mimeType === 'image/png' ? 'png' : 'jpg';
  const matchingExtension = new RegExp(`\\.${extension === 'jpg' ? 'jpe?g' : extension}$`, 'i');
  download(document.blob, matchingExtension.test(document.name) ? document.name : `${document.name}.${extension}`);
}
function downloadPreview() { if (previewDocument.value) downloadDocument(previewDocument.value); }
async function useFile(entry: Entry, action: 'open' | 'download') {
  const token = generation; error.value = '';
  if (action === 'open') { clearPreview(); if (!props.active) return; }
  const previewToken = previewGeneration;
  const valid = () => current(token) && (action !== 'open' || (previewToken === previewGeneration && props.active));
  try {
    const document = await repository().getDocument(entry.id);
    if (!valid()) return;
    if (!document) throw new Error(text('This file is missing on this device. Edit the attachment to add it.', 'Diese Datei fehlt auf diesem Gerät. Zum Hinzufügen den Anhang bearbeiten.'));
    if (action === 'download') downloadDocument(document);
    else {
      if (document.mimeType !== 'application/pdf') previewUrl.value = URL.createObjectURL(document.blob);
      previewDocument.value = document;
    }
  } catch (reason) { if (valid()) error.value = message(reason); }
}
async function remove(entry: Entry) {
  if (!window.confirm(text(`Delete “${entry.name}” and its shared name and description? Applications using it will show a missing attachment. Back up the file first if needed.`, `„${entry.name}“ samt geteiltem Namen und Beschreibung löschen? Bewerbungen, die diesen Anhang verwenden, zeigen dann eine fehlende Datei an. Bei Bedarf vorher sichern.`))) return;
  const token = generation; const repo = repository(); const cloud = cloudRepository(); busy.value = true; error.value = ''; notice.value = '';
  try {
    // A cloud failure must leave the local original intact for retry and backup.
    if (cloud) await cloud.remove(entry.id);
    if (!current(token)) return;
    if (entry.local) await repo.removeDocument(entry.id);
    if (!current(token)) return;
    localDocuments.value = localDocuments.value.filter(({ id }) => id !== entry.id); sharedDocuments.value = sharedDocuments.value.filter(({ id }) => id !== entry.id);
    clearDraft(draftKey(entry.id));
    if (editingId.value === entry.id) resetForm(); clearPreview(); changed();
    notice.value = text('Attachment deleted. Existing package references are kept so missing files remain visible.', 'Anhang gelöscht. Bestehende Zusammenstellungen zeigen die fehlende Datei weiterhin an.');
  } catch (reason) { if (current(token)) error.value = message(reason); }
  finally { if (current(token)) busy.value = false; }
}
async function exportBackup() {
  const token = generation; busy.value = true; error.value = '';
  try { const blob = await repository().exportBackup(); if (current(token)) download(blob, `application-documents-backup-${new Date().toISOString().slice(0, 10)}.json`); }
  catch (reason) { if (current(token)) error.value = message(reason); }
  finally { if (current(token)) busy.value = false; }
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement; const backup = input.files?.[0]; input.value = '';
  if (!backup || !window.confirm(text('Restore local attachments and packages? Matching local records will be replaced. Cloud metadata is not changed.', 'Lokale Anhänge und Zusammenstellungen wiederherstellen? Passende lokale Einträge werden ersetzt. Cloud-Metadaten bleiben unverändert.'))) return;
  const token = generation; const repo = repository(); busy.value = true; error.value = '';
  try {
    const result = await repo.importBackup(backup); const documents = await repo.listDocuments(); if (!current(token)) return;
    localDocuments.value = documents; clearPreview(); resetForm(); changed(); notice.value = text(`Restored ${result.documents} local attachments. Save an entry to sync its manually approved name and description.`, `${result.documents} lokale Anhänge wiederhergestellt. Einen Eintrag speichern, um seinen manuell bestätigten Namen und seine Beschreibung zu synchronisieren.`);
  } catch (reason) { if (current(token)) error.value = message(reason); }
  finally { if (current(token)) busy.value = false; }
}
</script>

<template>
  <section class="local-attachments">
    <header class="attachments-heading workspace-page-heading">
      <h2>{{ text('Local attachments', 'Lokale Anhänge') }}<InfoHint :lang="lang" :label="text('Local attachments', 'Lokale Anhänge')" :text="text('Keep PDFs and images on this device for application packages. When signed in, share only the name and description you enter.', 'Bewahre PDFs und Bilder auf diesem Gerät für Bewerbungsunterlagen auf. Nach der Anmeldung teilst du nur den selbst eingegebenen Namen und die Beschreibung.')" /></h2>
      <DesktopSidebarPortal area="minor" :active="sidebarActive && active">
        <div class="actions backup-actions" :class="{ 'backup-actions--sidebar': desktopSidebar && sidebarActive && active }"><button type="button" :disabled="busy || loading || loadFailed" @click="exportBackup">{{ text('Back up files & packages', 'Dateien & Zusammenstellungen sichern') }}</button><label class="file-button">{{ text('Restore backup', 'Backup wiederherstellen') }}<input type="file" accept="application/json,.json" :disabled="busy || loading || loadFailed" @change="importBackup" /></label></div>
      </DesktopSidebarPortal>
    </header>
    <div class="attachments-scroll group-panel__scroll-body">
      <div v-if="loadFailed" class="attachment-load-error">
        <button type="button" :disabled="loading || busy" @click="load">{{ text('Retry loading files', 'Dateien erneut laden') }}</button>
      </div>
      <p v-else-if="!loading && !entries.length && !formVisible" class="empty app-hint">{{ text('No attachments yet. Add a local file and give it a name and description.', 'Noch keine Anhänge. Eine lokale Datei hinzufügen und Name und Beschreibung eingeben.') }}</p>
      <ul ref="attachmentList" class="attachment-list">
        <li v-for="row in attachmentRows" :key="row.key" :class="{ 'attachment-editor-row': !row.entry }">
          <template v-if="row.entry">
            <div class="attachment-header">
              <div class="attachment-title">
                <h3>{{ row.entry.name }}<InfoHint v-if="!row.entry.description" :lang="lang" :label="row.entry.name" :text="text('Edit this attachment to add a description.', 'Bearbeite diesen Anhang, um eine Beschreibung zu ergänzen.')" /></h3>
                <div class="attachment-status">
                  <span role="img" :title="row.entry.local ? text('File available on this device', 'Datei auf diesem Gerät vorhanden') : text('File missing on this device', 'Datei fehlt auf diesem Gerät')" :aria-label="row.entry.local ? text('File available on this device', 'Datei auf diesem Gerät vorhanden') : text('File missing on this device', 'Datei fehlt auf diesem Gerät')" :class="{ missing: !row.entry.local }"><FontAwesomeIcon :icon="row.entry.local ? faFolderOpen : faLinkSlash" aria-hidden="true" /></span>
                  <span role="img" :title="syncState(row.entry).label" :aria-label="syncState(row.entry).label" :class="{ missing: syncState(row.entry).warning }"><FontAwesomeIcon :icon="syncState(row.entry).icon" aria-hidden="true" /></span>
                </div>
              </div>
              <div class="actions attachment-actions">
                <button type="button" :disabled="busy || loading" :aria-label="`${text('Edit', 'Bearbeiten')}: ${row.entry.name}`" :title="text('Edit', 'Bearbeiten')" :data-attachment-edit="row.entry.id" @click="edit(row.entry)"><FontAwesomeIcon :icon="faPen" aria-hidden="true" /><span>{{ text('Edit', 'Bearbeiten') }}</span></button>
                <button type="button" :disabled="busy || !row.entry.local" :aria-label="`${text('Open', 'Öffnen')}: ${row.entry.name}`" :title="text('Open', 'Öffnen')" @click="useFile(row.entry, 'open')"><FontAwesomeIcon :icon="faFolderOpen" aria-hidden="true" /><span>{{ text('Open', 'Öffnen') }}</span></button>
                <button type="button" :disabled="busy || !row.entry.local" :aria-label="`${text('Download', 'Herunterladen')}: ${row.entry.name}`" :title="text('Download', 'Herunterladen')" @click="useFile(row.entry, 'download')"><FontAwesomeIcon :icon="faDownload" aria-hidden="true" /><span>{{ text('Download', 'Herunterladen') }}</span></button>
                <button type="button" :disabled="busy || loading || loadFailed" :aria-label="`${text('Delete', 'Löschen')}: ${row.entry.name}`" :title="text('Delete', 'Löschen')" @click="remove(row.entry)"><FontAwesomeIcon :icon="faTrash" aria-hidden="true" /><span>{{ text('Delete', 'Löschen') }}</span></button>
              </div>
            </div>
            <p v-if="row.entry.description" class="attachment-description">{{ row.entry.description }}</p>
          </template>
          <form v-if="row.editor" :key="`${userId}:${editingId}`" :ref="element => setAttachmentForm(row.key, element)" class="attachment-form editor-subsection" :class="{ collapsed: formCollapsed }" @submit.prevent="save">
            <div class="section-head" @click="toggleForm">
              <FontAwesomeIcon :icon="faPaperclip" class="attachment-form__icon" aria-hidden="true" />
              <SectionHeading :title="editingId ? text('Edit attachment', 'Anhang bearbeiten') : text('New attachment', 'Neuer Anhang')" :collapsed="formCollapsed" :controls="formContentId" @activate="toggleForm" />
              <FontAwesomeIcon :icon="faChevronDown" class="attachment-form__chevron" aria-hidden="true" />
            </div>
            <div v-show="!formCollapsed" :id="formContentId" class="attachment-form__body" :inert="formCollapsed">
              <label>{{ text('Attachment name', 'Name des Anhangs') }}<input v-model="name" maxlength="200" required :disabled="busy" @input="dirty = true" /></label>
              <div class="attachment-description-field"><div class="hint-label-row"><label :for="`${formContentId}-description`">{{ text('Description', 'Beschreibung') }}</label><InfoHint :lang="lang" :label="text('Description', 'Beschreibung')" :text="text('Write the context you want to share, without copying private details you want to keep local.', 'Den gewünschten Kontext eingeben und private Angaben weglassen, die lokal bleiben sollen.')" /></div><AutosaveTextarea :id="`${formContentId}-description`" v-model="description" @commit="commitDescription" maxlength="4000" rows="4" required :disabled="busy" @input="dirty = true" /></div>
              <div class="attachment-file-field"><div class="hint-label-row"><label :for="`${formContentId}-file`">{{ editingEntry?.local ? text('Replace local file (optional)', 'Lokale Datei ersetzen (optional)') : text('Local PDF or image', 'Lokales PDF oder Bild') }}</label><InfoHint :lang="lang" :label="editingEntry?.local ? text('Replace local file (optional)', 'Lokale Datei ersetzen (optional)') : text('Local PDF or image', 'Lokales PDF oder Bild')" :text="text('PDF, PNG or JPEG, up to 50 MB. Choosing a file never fills the name or description.', 'PDF, PNG oder JPEG, bis 50 MB. Die Dateiauswahl füllt Name und Beschreibung nicht aus.') + (editingEntry && !editingEntry.local && !file ? ' ' + text('This attachment has no file on this device. Add the original file to use it in a PDF package.', 'Für diesen Anhang fehlt die Datei auf diesem Gerät. Zum Verwenden in einer PDF-Zusammenstellung die Originaldatei hinzufügen.') : '')" /></div><input :id="`${formContentId}-file`" :ref="element => setFileInput(row.key, element)" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" :required="!editingId && !file" :disabled="busy" @change="chooseFile" /></div>
              <div class="actions"><button class="primary" type="submit" :disabled="busy || loading || loadFailed">{{ busy ? text('Saving…', 'Speichern…') : text('Save attachment', 'Anhang speichern') }}</button><button type="button" :disabled="busy" @click="cancelEdit">{{ text('Cancel', 'Abbrechen') }}</button></div>
            </div>
          </form>
        </li>
      </ul>
      <button ref="newAttachmentButton" class="add-attachment-row" type="button" :disabled="busy || loading || loadFailed" @click="edit()"><FontAwesomeIcon :icon="faPlus" aria-hidden="true" />{{ text('New attachment', 'Neuer Anhang') }}</button>

    </div>
    <FullDocumentPreview :model-value="previewPdfOpen" v-model:page="previewPage" :pages="previewPages" :is-updating="previewLoading" :title="previewName" :lang="lang || 'en'" :error="previewError" @update:model-value="(open) => { if (!open) clearPreview(); }" @download="downloadPreview">
      <template v-if="previewError" #header><button class="btn" type="button" @click="retryPreview">{{ text('Retry preview', 'Vorschau erneut versuchen') }}</button></template>
    </FullDocumentPreview>
    <PreviewDialog :model-value="!!previewUrl" :title="previewName" :lang="lang" @update:model-value="(open) => { if (!open) clearPreview(); }"><img v-if="previewUrl" class="attachment-image" :src="previewUrl" :alt="previewName" /></PreviewDialog>
  </section>
</template>

<style scoped>
.local-attachments{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--ui-text);font-family:var(--font-ui,system-ui)}
.attachments-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin:0;padding-bottom:10px;border-bottom:1px solid var(--ui-divider)}.attachments-heading h2{font:700 22px/1.3 var(--font-ui);margin:0;color:var(--ui-text);text-transform:none;letter-spacing:0}.local-attachments p{font-size:13px;line-height:1.6;color:var(--ui-muted);margin:0}.attachments-heading button{flex-shrink:0}
.attachment-load-error{display:grid;justify-items:start;gap:10px;margin-bottom:18px}
.attachments-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;padding-right:4px}
.local-attachments :where(button:not(.info-hint__button),input,textarea,.file-button){font:inherit;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-control);color:var(--ui-text);padding:9px 12px;box-sizing:border-box}.local-attachments :where(button:not(.info-hint__button),.file-button){font-size:12px;cursor:pointer;min-height:38px}.local-attachments :where(button:hover:not(:disabled):not(.info-hint__button)){background:var(--ui-surface-hover)}.local-attachments button:disabled{opacity:.5;cursor:not-allowed}.local-attachments :is(button,input,textarea):focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}.local-attachments .primary{background:var(--ui-active);border-color:var(--ui-accent-border);color:var(--ui-accent)}.local-attachments .primary:hover:not(:disabled){background:var(--ui-active);border-color:var(--ui-accent);color:var(--ui-text)}
.backup-actions :is(button,.file-button){font:inherit;font-size:12px;min-height:38px;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-control);color:var(--ui-text);padding:9px 12px;box-sizing:border-box;cursor:pointer}.backup-actions button:hover:not(:disabled),.backup-actions .file-button:hover:not(:has(input:disabled)){background:var(--ui-surface-hover)}.backup-actions button:disabled,.backup-actions .file-button:has(input:disabled){opacity:.5;cursor:not-allowed}.backup-actions button:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.attachment-form{padding:8px 0 0;background:transparent;border:0;border-radius:0;margin:0;min-width:0}
.attachment-form > .section-head{display:flex;align-items:center;gap:8px;min-height:48px;margin-bottom:8px;cursor:pointer}
.attachment-form__icon{width:16px;flex:0 0 16px;color:var(--ui-accent)}
.attachment-form__chevron{width:12px;flex:0 0 12px;color:var(--ui-muted);transform:rotate(180deg)}
.attachment-form.collapsed .attachment-form__chevron{transform:none}
.attachment-form :deep(.section-name-label){flex:1;min-width:0}
.attachment-form :deep(.section-heading-button),.attachment-form :deep(.section-heading-button:hover){min-height:40px;padding:5px 6px;border:1px solid transparent;background:transparent;font:inherit}
.attachment-form.collapsed > .section-head{margin-bottom:0}
.attachment-form__body{display:grid;gap:16px;margin:0 0 12px;padding:0 16px}
.attachment-file-field{display:grid;gap:7px}
.attachment-form h3,.attachment-title h3{font:600 15px/1.4 var(--font-ui,system-ui);margin:0;color:var(--ui-text);text-transform:none;letter-spacing:0}
.attachment-form label{display:grid;gap:7px;font:600 12px/1.4 var(--font-ui);color:var(--ui-text)}
.attachment-form :is(input,textarea){font:400 14px/1.5 var(--font-ui);min-width:0;width:100%}
.attachment-form textarea{resize:vertical}
.attachment-form small{font-weight:400;color:var(--ui-muted);line-height:1.5}
.attachment-list{padding:0;margin:0;list-style:none}.attachment-list > li{display:flex;flex-direction:column;gap:0;padding:12px 0;border-top:1px solid var(--ui-divider)}.attachment-list > li:first-child{border-top:0}.attachment-list > .attachment-editor-row{padding:0}.attachment-list > .attachment-editor-row .attachment-form{padding-top:0}.attachment-header{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;width:100%;min-width:0}.attachment-title{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 180px}.attachment-title h3{min-width:0;overflow-wrap:anywhere}.local-attachments .attachment-description{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}.local-attachments .missing{color:var(--ui-score-yellow)}.actions{display:flex;gap:7px;flex-wrap:wrap}.attachment-list .actions{flex-shrink:0;flex-wrap:nowrap}.attachment-actions button{display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap}.attachment-status{display:flex;flex-shrink:0;gap:8px;color:var(--ui-muted);}.attachment-status [role=img]{display:inline-flex;align-items:center;justify-content:center;min-height:24px}.local-attachments .empty{margin-bottom:14px}.backup-actions{flex-shrink:0;justify-content:flex-end}.backup-actions .file-button{position:relative;display:inline-flex;align-items:center;white-space:nowrap}.local-attachments .add-attachment-row{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin:0;min-height:54px;padding:8px;border:0;border-top:1px dashed var(--ui-border);border-bottom:1px dashed var(--ui-border);border-radius:0;background:transparent;color:var(--ui-muted);font:inherit}.local-attachments .add-attachment-row:is(:hover,:focus-visible):not(:disabled){border-color:var(--ui-accent-border);background:var(--ui-surface-hover);color:var(--ui-accent)}.backup-actions .file-button input{position:absolute;inset:50% auto auto 0;width:1px;min-width:0;height:1px;padding:0;border:0;opacity:0}.attachment-image{display:block;width:100%;height:100%;object-fit:contain}.file-button:focus-within{outline:2px solid var(--ui-accent);outline-offset:2px}
.local-attachments .add-attachment-row:focus-visible{outline-offset:-3px}
.backup-actions--sidebar{display:grid;width:100%;grid-template-columns:minmax(0,1fr)}.backup-actions--sidebar :is(button,.file-button){width:100%;white-space:normal;text-align:left;justify-content:flex-start}
@media(max-width:850px){.attachment-list li{flex-direction:column}.attachment-list .actions{max-width:none}}@media(max-width:700px){.attachment-actions button{min-width:44px}.attachment-actions button span{display:none}.backup-actions{width:100%;justify-content:flex-end}.backup-actions button,.backup-actions .file-button{font-size:11px;padding:8px}.attachments-heading{flex-direction:column;gap:10px}.attachment-form__body{padding-inline:4px}.attachments-scroll{padding-right:0}}
@media (max-width:760px), (max-width:960px) and (max-height:500px) and (pointer:coarse) {
  .local-attachments{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--ui-scrollbar) transparent}
  .local-attachments > .attachments-heading{flex:0 0 auto}
  .local-attachments > .attachments-scroll.group-panel__scroll-body{flex:0 0 auto;min-height:auto;overflow:visible;padding-right:0}
  .attachment-list li{flex-direction:column}
  .attachment-list .actions{flex-wrap:wrap;max-width:100%}
  .attachment-form :is(input,textarea){font-size:16px}
  .attachment-form :deep(.section-heading-button),.attachment-form :deep(.section-heading-button:hover){min-height:44px}
  .local-attachments button,.backup-actions :is(button,.file-button){min-height:44px}
  .attachment-actions button{min-width:44px}
  .backup-actions :is(button,.file-button){max-width:100%;white-space:normal;overflow-wrap:anywhere}
}
</style>
