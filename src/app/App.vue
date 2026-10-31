<script setup lang="ts">
import { designNumber, resolveDesign } from '../documents/cv/defaults';
import type { CvState, CvDesign, SavedConfiguration, SaveStatus } from '../documents/cv/types';
import type { RenderOptions } from '../documents/pdf/pdfTypes';
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue';
import { debounce, loadLocal, saveLocal } from '../documents/cv/data/cvStorage';
import { useCvDesign } from '../documents/cv/composables/useCvDesign';
import { usePdfExport } from '../documents/pdf/composables/usePdfExport';
import { useDocumentPdfPreview } from '../documents/pdf/composables/useDocumentPdfPreview';
import { commitPendingTextareas } from '../shared/editing/textareaCommit';
import { flushEditorSession, flushEditorSessionSync, type SyncEditorSession } from '../shared/editing/editorSession';
import { CV_TEXTAREA_COMMIT } from '../documents/cv/composables/cvTextareaCommit';
import CvContentEditor from '../features/cv-studio/components/CvContentEditor.vue';
import CvDocument from '../documents/cv/components/CvDocument.vue';
import InlineDocumentPreview from '../documents/pdf/components/InlineDocumentPreview.vue';
import FullDocumentPreview from '../documents/pdf/components/FullDocumentPreview.vue';
import CvVariantManager from '../features/cv-studio/components/CvVariantManager.vue';
import DesignPanel from '../features/cv-studio/components/DesignPanel.vue';
import AnonymizationPanel from '../documents/privacy/components/AnonymizationPanel.vue';
import { makeT } from '../i18n/dict';
import { createNormalizedContentState, normalizeContentState } from '../documents/layout/contentLayout';
import { createEmptyDocument, EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID, isBuiltinDocument } from '../features/cv-studio/domain/builtinConfigurations';
import { readCvState } from '../documents/cv/domain/cvStateValidation';
import { createAnonymizedState } from '../documents/privacy/domain/anonymization';
import SupabaseAuth from '../platform/auth/components/SupabaseAuth.vue';
import CloudWorkspace from './components/CloudWorkspace.vue';
import { useSupabaseAuth } from '../platform/auth/useSupabaseAuth';
import LetterTemplateEditor from '../features/letter-templates/components/LetterTemplateEditor.vue';
import LocalAttachments from '../features/attachments/components/LocalAttachments.vue';
import AppToaster from '../shared/ui/AppToaster.vue';
import InfoHint from '../shared/ui/InfoHint.vue';
import { useToasts, useToastWatch } from '../shared/ui/useToasts';
import { provideDesktopSidebar } from '../shared/ui/desktopSidebar';
import DesktopSidebar from '../shared/ui/DesktopSidebar.vue';
import DesktopSidebarPortal from '../shared/ui/DesktopSidebarPortal.vue';

const state = reactive<CvState>(createEmptyDocument());
const { user: cloudUser, client: supabaseClient } = useSupabaseAuth();

const lang = computed({
  get: () => state.lang,
  set: (value) => { state.lang = value; },
});
const previewMode = ref(false);
const fullPreviewView = ref('pdf');
const mobileViewport = window.matchMedia('(max-width: 760px)');
const isMobile = ref(mobileViewport.matches);
provideDesktopSidebar(computed(() => !isMobile.value));
function syncMobileViewport() {
  isMobile.value = mobileViewport.matches;
}
onMounted(() => mobileViewport.addEventListener('change', syncMobileViewport));
onBeforeUnmount(() => mobileViewport.removeEventListener('change', syncMobileViewport));
const pdfRenderSource = ref<HTMLElement | null>(null);
const anonymizedPdfRenderSource = ref<HTMLElement | null>(null);
const fullPreviewVariant = ref('normal');
const t = makeT(lang);
const { notify } = useToasts();
type Workspace = 'opportunities' | 'cv-studio' | 'applications';
const activeWorkspace = ref<Workspace>('cv-studio');
const activeBuilderGroup = ref('content');
const studioNavigation = ref<HTMLElement | null>(null);
function revealActiveStudioSection() {
  const nav = studioNavigation.value;
  if (!isMobile.value || activeWorkspace.value !== 'cv-studio' || !nav?.clientWidth) return;
  const active = nav.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!active) return;
  const bounds = nav.getBoundingClientRect();
  const selected = active.getBoundingClientRect();
  if (selected.left < bounds.left) nav.scrollLeft += selected.left - bounds.left;
  else if (selected.right > bounds.right) nav.scrollLeft += selected.right - bounds.right;
}
watch([activeBuilderGroup, activeWorkspace, isMobile, previewMode, lang], () => nextTick(revealActiveStudioSection), { flush: 'post' });
onMounted(() => nextTick(revealActiveStudioSection));
try {
  const cached = JSON.parse(sessionStorage.getItem('CV_WORKSPACE_NAV') || '{}');
  if (['opportunities', 'cv-studio', 'applications'].includes(cached.workspace)) activeWorkspace.value = cached.workspace;
  if (['versions', 'content', 'design', 'privacy', 'templates', 'attachments'].includes(cached.cvTab)) activeBuilderGroup.value = cached.cvTab;
} catch { /* Navigation is available without browser storage. */ }
watch([activeWorkspace, activeBuilderGroup], () => {
  try { sessionStorage.setItem('CV_WORKSPACE_NAV', JSON.stringify({ workspace: activeWorkspace.value, cvTab: activeBuilderGroup.value })); } catch { /* Optional preference. */ }
});
const isCloudTab = computed(() => activeWorkspace.value !== 'cv-studio');
const studioHasPreview = computed(() => !['templates', 'attachments'].includes(activeBuilderGroup.value));
const isPrivacyStudioPreview = computed(() => !isCloudTab.value && activeBuilderGroup.value === 'privacy');
const normalPreviewVisible = computed(() => !isCloudTab.value && (previewMode.value
  ? fullPreviewView.value !== 'html' && fullPreviewVariant.value === 'normal'
  : !isMobile.value && studioHasPreview.value && !isPrivacyStudioPreview.value));
const privacyPreviewVisible = computed(() => !isCloudTab.value && (previewMode.value
  ? fullPreviewView.value !== 'html' && fullPreviewVariant.value === 'anonymized'
  : !isMobile.value && isPrivacyStudioPreview.value));
const cloudTab = computed(() => activeWorkspace.value === 'applications' ? 'applications' : 'opportunities');
const workspaceGroups = computed(() => [
  { key: 'cv-studio' as const, label: lang.value === 'de' ? 'CV-Studio' : 'CV Studio', icon: 'layer-group' },
  { key: 'opportunities' as const, label: lang.value === 'de' ? 'Stellenangebote' : 'Opportunities', icon: 'briefcase' },
  { key: 'applications' as const, label: lang.value === 'de' ? 'Bewerbungen' : 'Applications', icon: 'envelope' },
]);
const cloudWorkspace = ref<InstanceType<typeof CloudWorkspace> | null>(null);
let workspaceNavigationRequest = 0;
async function selectWorkspace(workspace: Workspace) {
  const request = ++workspaceNavigationRequest;
  const editor = cloudWorkspace.value;
  if (!prepareConfigurationChange()) return;
  if (!await flushCloudEditor(request, editor)) return;
  if (request !== workspaceNavigationRequest || editor !== cloudWorkspace.value) return;
  activeWorkspace.value = workspace; previewMode.value = false;
}
async function selectWorkspaceList(workspace: Workspace) {
  const request = ++workspaceNavigationRequest;
  const editor = cloudWorkspace.value;
  if (!prepareConfigurationChange()) return;
  const epoch = editorSessionEpoch;
  if (editor && !(workspace === 'cv-studio' ? await editor.flush() : await editor.openList(workspace))) return;
  if (appDisposed || epoch !== editorSessionEpoch || request !== workspaceNavigationRequest || editor !== cloudWorkspace.value) return;
  activeWorkspace.value = workspace; previewMode.value = false;
}
async function flushCloudEditor(request: number, editor = cloudWorkspace.value) {
  const epoch = editorSessionEpoch;
  const current = () => !appDisposed && epoch === editorSessionEpoch
    && request === workspaceNavigationRequest && editor === cloudWorkspace.value;
  const saved = await flushEditorSession({ current, steps: [() => editor ? editor.flush() : true] });
  return saved && current();
}
function saveCareerVariant(name: string, data: CvState) {
  const saved = cvVariantManager.value?.saveAsDocument(name, data) ?? false;
  if (!saved) pdfExportError.value = lang.value === 'de' ? 'Karrierevariante konnte nicht gespeichert werden.' : 'The career variant could not be saved.';
}
function createVariant(name: string, data: CvState): string | null {
  return cvVariantManager.value?.createVariant(name, data) ?? null;
}
async function openStudioVariant(id: string) {
  const request = ++workspaceNavigationRequest;
  const editor = cloudWorkspace.value;
  if (!prepareConfigurationChange() || !await flushCloudEditor(request, editor)) return;
  if (!cvVariantManager.value?.selectConfiguration(id)) return;
  activeWorkspace.value = 'cv-studio'; activeBuilderGroup.value = 'content'; previewMode.value = false;
}
const savedConfigurations = ref<SavedConfiguration[]>([]);
const selectedConfigurationId = ref('');
const isEmptyDocument = computed(() => selectedConfigurationId.value === EMPTY_DOCUMENT_ID);
const selectableConfigurations = computed(() => savedConfigurations.value.filter(({ id }) => !isBuiltinDocument(id)));
watch(isEmptyDocument, (empty) => {
  if (empty && ['content', 'design', 'privacy'].includes(activeBuilderGroup.value)) activeBuilderGroup.value = 'versions';
}, { flush: 'sync' });
const saveStatus = ref<SaveStatus>('saved');
const lastSavedAt = ref<number | null>(null);
const cvVariantManager = ref<InstanceType<typeof CvVariantManager> | null>(null);
const cvContentEditor = ref<InstanceType<typeof CvContentEditor> | null>(null);
const letterTemplates = ref<SyncEditorSession | null>(null);
const localAttachments = ref<SyncEditorSession | null>(null);
let editorSessionEpoch = 0;
let appDisposed = false;
watch([selectedConfigurationId, activeWorkspace, activeBuilderGroup, () => cloudUser.value?.id], () => {
  editorSessionEpoch++;
}, { flush: 'sync' });
function activeStudioLibrary() {
  if (activeWorkspace.value !== 'cv-studio') return null;
  return activeBuilderGroup.value === 'templates' ? letterTemplates.value
    : activeBuilderGroup.value === 'attachments' ? localAttachments.value : null;
}
function flushStudioEdits() {
  const epoch = editorSessionEpoch;
  const builder = cvContentEditor.value, library = activeStudioLibrary();
  return flushEditorSessionSync({
    current: () => !appDisposed && epoch === editorSessionEpoch
      && builder === cvContentEditor.value && library === activeStudioLibrary(),
    steps: [() => library ? library.flush() : true, flushStateSave, () => builder ? builder.flushSectionSaves() : true],
    settled: () => combinedSaveStatus.value === 'saved',
  });
}
provide(CV_TEXTAREA_COMMIT, flushStateSave);
const sectionSaveStatus = ref<SaveStatus>('saved');
const combinedSaveStatus = computed(() => {
  const statuses = [saveStatus.value, sectionSaveStatus.value];
  return statuses.includes('error') ? 'error' : statuses.includes('saving') ? 'saving' : 'saved';
});
const readSectionVersion = (id: string) => cvVariantManager.value?.readConfigData(id);
const saveSectionVersion = (id: string, data: CvState) => cvVariantManager.value?.saveVersion(id, data) ?? false;
function prepareConfigurationChange() {
  if (!flushStudioEdits()) return false;
  const builder = cvContentEditor.value;
  return builder ? builder.resetSectionVersions() : true;
}
const builderGroups = computed(() => [
  { key: 'versions', label: lang.value === 'de' ? 'Varianten' : 'Variants', icon: 'layer-group' },
  { key: 'content', label: t('content'), icon: 'table-cells-large' },
  { key: 'design', label: t('design'), icon: 'palette' },
  { key: 'privacy', label: t('privacy'), icon: 'user-secret' },
  { key: 'templates', label: lang.value === 'de' ? 'Briefvorlagen' : 'Letter templates', icon: 'envelope' },
  { key: 'attachments', label: lang.value === 'de' ? 'Lokale Anhänge' : 'Local attachments', icon: 'folder-open' },
]);
function groupDisabled(key: string) {
  return isEmptyDocument.value && ['content', 'design', 'privacy'].includes(key);
}
function readCloudVersion(id: string): CvState | null {
  if (!flushStudioEdits()) return null;
  if (id === selectedConfigurationId.value) return JSON.parse(JSON.stringify(state));
  return cvVariantManager.value?.readConfigData(id) || null;
}
const saveStatusLabel = computed(() => {
  const label = t({ saving: 'saving', saved: 'saved', error: 'saveFailed' }[combinedSaveStatus.value]);
  if (combinedSaveStatus.value !== 'saved' || lastSavedAt.value === null) return label;
  const time = new Intl.DateTimeFormat(lang.value === 'de' ? 'de-DE' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(lastSavedAt.value);
  return `${label} ${time}`;
});
let saveToastTimer: ReturnType<typeof setTimeout> | undefined;
watch(combinedSaveStatus, (status, previous) => {
  clearTimeout(saveToastTimer);
  if (status === 'error') {
    notify({ key: 'cv-autosave', message: t('saveFailed'), tone: 'error', action: {
      label: lang.value === 'de' ? 'Erneut speichern' : 'Retry save', run: retryStateSave,
    } });
  } else if (status === 'saved' && previous !== 'saved') {
    saveToastTimer = setTimeout(() => notify({ key: 'cv-autosave', message: saveStatusLabel.value, tone: 'success' }), 1500);
  }
}, { flush: 'sync' });
onBeforeUnmount(() => clearTimeout(saveToastTimer));

function persistState(): boolean {
  try {
    const versionSaveResult = cvVariantManager.value?.saveCurrent?.();
    const saved = typeof versionSaveResult === 'boolean'
      ? versionSaveResult
      : saveLocal(state);
    handleConfigurationSaveResult(saved);
    return saved;
  } catch (error) {
    console.warn('Failed to save CV state', error);
    saveStatus.value = 'error';
    return false;
  }
}
function retryStateSave(): boolean {
  commitPendingTextareas();
  const sectionsSaved = cvContentEditor.value?.flushSectionSaves() !== false;
  const stateSaved = persistState();
  return sectionsSaved && stateSaved && combinedSaveStatus.value === 'saved';
}

const saveDebounced = debounce(persistState, 250);
function scheduleStateSave() {
  if (isSliderPreviewUpdateDeferred) {
    sliderSaveUpdatePending = true;
    saveStatus.value = 'saving';
    return;
  }
  saveStatus.value = 'saving';
  saveDebounced();
}

function handleConfigurationSaveResult(saved: boolean) {
  saveStatus.value = saved ? 'saved' : 'error';
  if (saved) lastSavedAt.value = Date.now();
}

function toggleLanguage() {
  lang.value = lang.value === 'de' ? 'en' : 'de';
}

useCvDesign(() => state.design);

function mergeIn(data: unknown) {
  const nextState = createNormalizedContentState(readCvState(data));
  nextState.design = resolveDesign(nextState.design);
  for (const key of Object.keys(state)) if (!Object.hasOwn(nextState, key)) Reflect.deleteProperty(state, key);
  Object.assign(state, nextState);
}

normalizeContentState(state);

onMounted(async () => {
  try {
    const cached = cvVariantManager.value?.restoreActiveConfig?.() || loadLocal();
    if (cached) {
      mergeIn(cached);
      return;
    }

    const sample = cvVariantManager.value?.readConfigData(SAMPLE_DOCUMENT_ID);
    if (sample) {
      selectedConfigurationId.value = SAMPLE_DOCUMENT_ID;
      mergeIn(sample);
    }
  } catch (error) {
    console.warn('Failed to load default CV data', error);
  } finally {
    requestPdfPreview();
  }
});

const pdfRenderer = usePdfExport();
const pdfExportError = ref('');
useToastWatch(() => pdfExportError.value, { tone: 'error' });
let isSliderPreviewUpdateDeferred = false;
let sliderSaveUpdatePending = false;
let privacyDraftCommitPending = false;
async function commitPrivacyPreview() {
  // Privacy stores its local draft before releasing a still-focused preview.
  privacyDraftCommitPending = true;
  await nextTick();
  privacyDraftCommitPending = false;
  privacyPdfPreview.commit();
}

// Mark edits immediately, including an edit followed by navigation or pagehide
// in the same event. A queued watcher could leave the status at "Saved" and
// make flushStateSave miss that last change.
watch(state, scheduleStateSave, { deep: true, flush: 'sync' });

function exportMarginMillimeters(design: CvDesign, key: keyof CvDesign) {
  return Math.min(30, Math.max(0, designNumber(design, key)));
}

function getPdfMargins(input: CvDesign = {}) {
  const design = resolveDesign(input);
  return [
    exportMarginMillimeters(design, 'pageMarginTop'),
    exportMarginMillimeters(design, 'pageMarginLeft'),
    exportMarginMillimeters(design, 'pageMarginBottom'),
    exportMarginMillimeters(design, 'pageMarginRight'),
  ];
}

function getPdfRenderOptions(options: RenderOptions = {}) {
  const design = resolveDesign(state.design);
  return {
    margin: getPdfMargins(design),
    continuationTopPadding: exportMarginMillimeters(design, 'headerBottomMargin'),
    sidebarFillMode: design.sidebarFillMode,
    sidebarHeightMode: design.sidebarHeightMode,
    ...options,
  };
}

function getPdfSourceElement() {
  return pdfRenderSource.value?.querySelector<HTMLElement>('.page') || null;
}

function getAnonymizedPdfSourceElement() {
  return anonymizedPdfRenderSource.value?.querySelector<HTMLElement>('.page') || null;
}

const anonymizedState = computed(() => createAnonymizedState(state));

const previewDesign = computed(() => Object.keys(state.design || {}).reduce((design, key) => {
  if (key !== 'favoriteControls') Reflect.set(design, key, Reflect.get(state.design, key));
  return design;
}, {}));

const previewState = computed(() => ({
  disabled: state.disabled,
  lang: state.lang,
  // Favorite selection changes only the builder UI, never the CV itself.
  design: previewDesign.value,
  contact: state.contact,
  about: state.about,
  education: state.education,
  experience: state.experience,
  languages: state.languages,
  hobbies: state.hobbies,
  customSections: state.customSections,
  sidebarSections: state.sidebarSections,
  sectionNames: state.sectionNames,
  sectionHeaderSizes: state.sectionHeaderSizes,
  keepTogetherSections: state.keepTogetherSections,
  bodyOrder: state.bodyOrder,
  sidebarOrder: state.sidebarOrder,
}));

const anonymizedPreviewState = computed(() => ({
  ...previewState.value,
  anonymization: state.anonymization,
}));

// Studio keeps two independent completed previews while sharing cancellation,
// scheduling, deferred input commits, and export lifecycle with document editors.
const normalPdfPreview = useDocumentPdfPreview({
  source: async () => {
    await nextTick();
    const element = getPdfSourceElement();
    if (!element) throw new Error('CV preview element not found');
    return element;
  },
  options: getPdfRenderOptions,
  signature: () => previewState.value,
  active: () => normalPreviewVisible.value,
  renderer: pdfRenderer,
  delayMs: 100,
  watchFlush: 'post',
  deferUpdate: () => isSliderPreviewUpdateDeferred,
  retainPagesOnUpdate: true,
  retainPagesOnHide: true,
  cancelExportsOnSourceChange: false,
});
const privacyPdfPreview = useDocumentPdfPreview({
  source: async () => {
    await nextTick();
    const element = getAnonymizedPdfSourceElement();
    if (!element) throw new Error('Anonymized CV preview element not found');
    return element;
  },
  options: getPdfRenderOptions,
  signature: () => anonymizedPreviewState.value,
  active: () => privacyPreviewVisible.value,
  renderer: pdfRenderer,
  delayMs: 500,
  watchFlush: 'post',
  deferUpdate: () => isSliderPreviewUpdateDeferred || privacyDraftCommitPending,
  retainPagesOnHide: true,
  resetPageOnUpdate: true,
  cacheEmptyPages: false,
  cancelExportsOnSourceChange: false,
});
const { pages: previewPages, page: previewPage, busy: isPreviewRendering, downloading: isExporting } = normalPdfPreview;
const { pages: anonymizedPreviewPages, page: anonymizedPreviewPage,
  busy: isAnonymizedPreviewRendering, downloading: isAnonymizedExporting } = privacyPdfPreview;
const previewFailed = computed(() => !!normalPdfPreview.previewError.value);
const anonymizedPreviewFailed = computed(() => !!privacyPdfPreview.previewError.value);
// A preview retry never clears an export failure. Either export starts a new
// shared error cycle, while failures from both independent downloads are shown.
for (const preview of [normalPdfPreview, privacyPdfPreview]) {
  watch(preview.downloadError, error => { if (error) pdfExportError.value = error; }, { flush: 'sync' });
}
function requestPdfPreview() { normalPdfPreview.request(); }
function requestAnonymizedPdfPreview() { privacyPdfPreview.request(false); }

function handleVersionDeleted() {
  saveDebounced.cancel();
  isSliderPreviewUpdateDeferred = false;
  sliderSaveUpdatePending = false;
  normalPdfPreview.reset();
  privacyPdfPreview.reset();
  pdfRenderer.revokeDownloads();
  pdfExportError.value = '';
  previewMode.value = false;
  activeBuilderGroup.value = 'versions';
}
onBeforeUnmount(() => pdfRenderer.revokeDownloads());

function isRangeInput(element: EventTarget | null) {
  return element instanceof Element && element.matches('input[type="range"]');
}

function onPreviewSliderPointerDown(event: PointerEvent) {
  if (!isCloudTab.value && isRangeInput(event.target)) isSliderPreviewUpdateDeferred = true;
}

function commitDeferredSliderPreview() {
  if (!isSliderPreviewUpdateDeferred) return;
  const shouldSave = sliderSaveUpdatePending;
  isSliderPreviewUpdateDeferred = false;
  sliderSaveUpdatePending = false;
  normalPdfPreview.commit();
  privacyPdfPreview.commit();
  if (shouldSave) scheduleStateSave();
}

function flushStateSave(): boolean {
  const epoch = editorSessionEpoch;
  return flushEditorSessionSync({
    current: () => !appDisposed && epoch === editorSessionEpoch,
    steps: [() => {
      if (isSliderPreviewUpdateDeferred && sliderSaveUpdatePending) {
        isSliderPreviewUpdateDeferred = false;
        sliderSaveUpdatePending = false;
        return persistState();
      }
      // An idle debounce has no return value; the owning save status still
      // determines whether all committed CV content is durably saved.
      const saved = saveDebounced.flush();
      return saved !== false && saveStatus.value === 'saved';
    }],
  });
}

onMounted(() => {
  window.addEventListener('pagehide', flushStudioEdits);
  // A slider can be released outside the app or lose focus during a drag.
  window.addEventListener('pointerup', commitDeferredSliderPreview);
  window.addEventListener('pointercancel', commitDeferredSliderPreview);
  window.addEventListener('blur', commitDeferredSliderPreview);
});
onBeforeUnmount(() => {
  flushStudioEdits();
  appDisposed = true; editorSessionEpoch++;
  clearTimeout(saveToastTimer);
  window.removeEventListener('pagehide', flushStudioEdits);
  window.removeEventListener('pointerup', commitDeferredSliderPreview);
  window.removeEventListener('pointercancel', commitDeferredSliderPreview);
  window.removeEventListener('blur', commitDeferredSliderPreview);
});

async function handleExportPdf() {
  if (isExporting.value) return;
  pdfExportError.value = '';
  const filename = `${(state.contact?.name || 'CV').replace(/\s+/g, '_')}_CV`;
  await normalPdfPreview.download(filename);
}

async function handleAnonymizedExportPdf() {
  if (isAnonymizedExporting.value) return;
  pdfExportError.value = '';
  await privacyPdfPreview.download('anonymized-cv');
}

const isAnonymizedFullPreview = computed(() => fullPreviewVariant.value === 'anonymized');
const fullPreviewMode = computed({
  get: () => fullPreviewView.value === 'html' ? 'html' : fullPreviewVariant.value,
  set: (mode: string) => {
    fullPreviewView.value = mode === 'html' ? 'html' : 'pdf';
    fullPreviewVariant.value = mode === 'anonymized' ? 'anonymized' : 'normal';
  },
});
const isActiveFullPreviewExporting = computed(() => isAnonymizedFullPreview.value ? isAnonymizedExporting.value : isExporting.value);
const activeFullPreviewDownloadLabel = computed(() => isAnonymizedFullPreview.value
  ? t(isAnonymizedExporting.value ? 'exportingAnonymizedPdf' : 'downloadAnonymizedPdf')
  : t(isExporting.value ? 'exportingPdf' : 'downloadPdf'));

function exportActiveFullPreview() {
  return isAnonymizedFullPreview.value ? handleAnonymizedExportPdf() : handleExportPdf();
}

const activeFullPreviewPages = computed(() => (
  isAnonymizedFullPreview.value
    ? anonymizedPreviewPages.value
    : previewPages.value
));
const activeFullPreviewPage = computed({
  get: () => (isAnonymizedFullPreview.value ? anonymizedPreviewPage.value : previewPage.value),
  set: (value) => {
    if (isAnonymizedFullPreview.value) anonymizedPreviewPage.value = value;
    else previewPage.value = value;
  },
});
const isActiveFullPreviewRendering = computed(() => (
  isAnonymizedFullPreview.value ? isAnonymizedPreviewRendering.value : isPreviewRendering.value
));
const activeFullPreviewError = computed(() => (isAnonymizedFullPreview.value ? anonymizedPreviewFailed.value : previewFailed.value) ? t('previewFailed') : '');
function retryFullPreview() {
  if (isAnonymizedFullPreview.value) requestAnonymizedPdfPreview();
  else requestPdfPreview();
}
const studioPreviewPages = computed(() => isPrivacyStudioPreview.value ? anonymizedPreviewPages.value : previewPages.value);
const studioPreviewPage = computed({
  get: () => isPrivacyStudioPreview.value ? anonymizedPreviewPage.value : previewPage.value,
  set: (page: number) => {
    if (isPrivacyStudioPreview.value) anonymizedPreviewPage.value = page;
    else previewPage.value = page;
  },
});
const isStudioPreviewRendering = computed(() => isPrivacyStudioPreview.value ? isAnonymizedPreviewRendering.value : isPreviewRendering.value);
const studioPreviewError = computed(() => (isPrivacyStudioPreview.value ? anonymizedPreviewFailed.value : previewFailed.value) ? t('previewFailed') : '');
function retryStudioPreview() {
  if (isPrivacyStudioPreview.value) requestAnonymizedPdfPreview();
  else requestPdfPreview();
}
const isStudioPreviewExporting = computed(() => isPrivacyStudioPreview.value ? isAnonymizedExporting.value : isExporting.value);
function exportStudioPreview() {
  return isPrivacyStudioPreview.value ? handleAnonymizedExportPdf() : handleExportPdf();
}

function openFullPreview() {
  if (!flushStudioEdits()) return;
  fullPreviewMode.value = isPrivacyStudioPreview.value ? 'anonymized' : 'normal';
  previewMode.value = true;
}

function selectBuilderGroup(group: string) {
  if (group === 'opportunities' || group === 'applications') { selectWorkspace(group); return; }
  if (!flushStudioEdits()) return;
  activeBuilderGroup.value = group;
  previewMode.value = false;
}

</script>

<template>
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode, 'is-cloud-workspace': isCloudTab, 'has-mobile-context-row': !isCloudTab || !!cloudUser }" @pointerdown.capture="onPreviewSliderPointerDown" @pointerup.capture="commitDeferredSliderPreview" @pointercancel.capture="commitDeferredSliderPreview">
    <AppToaster :lang="lang" />
    <div ref="pdfRenderSource" class="pdf-render-source" aria-hidden="true">
      <CvDocument :state="state" export-source />
    </div>
    <div ref="anonymizedPdfRenderSource" class="pdf-render-source" aria-hidden="true">
      <CvDocument :state="anonymizedState" export-source />
    </div>

    <FullDocumentPreview v-model="previewMode" v-model:page="activeFullPreviewPage" v-model:mode="fullPreviewMode"
      :pages="activeFullPreviewPages" :is-updating="isActiveFullPreviewRendering" :lang="lang"
      :preview-error="activeFullPreviewError" @retry="retryFullPreview"
      :modes="[{ value: 'normal', label: t('normalPdf') }, { value: 'anonymized', label: t('privacyPdf') }, { value: 'html', label: t('rawHtml') }]"
      :downloading="isActiveFullPreviewExporting" :download-label="activeFullPreviewDownloadLabel" :title="t('liveCvPreview')" :error="pdfExportError" @download="exportActiveFullPreview">
      <template #html><CvDocument :state="isAnonymizedFullPreview ? anonymizedState : state" /></template>
    </FullDocumentPreview>

    <section v-show="!previewMode" class="builder-shell">
      <DesktopSidebar v-show="!isMobile" :lang="lang">
        <template #header><SupabaseAuth v-if="!isMobile" :lang="lang === 'de' ? 'de' : 'en'" /></template>
      </DesktopSidebar>
      <header v-if="!isMobile" class="builder-topbar">
        <nav class="builder-topbar__tabs" :aria-label="lang === 'de' ? 'Arbeitsbereiche' : 'Workspaces'">
          <button
            v-for="group in workspaceGroups"
            :key="group.key"
            class="builder-topbar__tab"
            :class="{ 'is-active': activeWorkspace === group.key }"
            type="button"
            :aria-pressed="activeWorkspace === group.key"
            @click="selectWorkspaceList(group.key)"
          >
            <font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" />
            <span>{{ group.label }}</span>
          </button>
        </nav>

      </header>

      <DesktopSidebarPortal area="subtabs" :active="!isCloudTab">
      <div v-show="!isCloudTab" class="cv-studio-navigation">
        <nav ref="studioNavigation" class="cv-studio-subtabs workspace-subtabs" :aria-label="lang === 'de' ? 'CV-Studio-Bereiche' : 'CV Studio sections'">
          <button v-for="group in builderGroups" :key="group.key" class="btn" :class="{ 'is-active': activeBuilderGroup === group.key }" :aria-pressed="activeBuilderGroup === group.key" :disabled="groupDisabled(group.key)" type="button" @click="selectBuilderGroup(group.key)"><font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" /><span>{{ isMobile && group.key === 'templates' ? (lang === 'de' ? 'Vorlagen' : 'Templates') : group.label }}</span></button>
        </nav>
        <button v-if="isMobile && studioHasPreview" class="btn cv-studio-open-preview" type="button" :aria-label="t('openPreview')" :title="t('openPreview')" :disabled="isEmptyDocument" @click="openFullPreview"><font-awesome-icon :icon="['fas', 'eye']" aria-hidden="true" /></button>
      </div>
      </DesktopSidebarPortal>
      <section v-if="isCloudTab && !cloudUser" class="workspace-sign-in"><h1>{{ activeWorkspace === 'opportunities' ? (lang === 'de' ? 'Stellenangebote entdecken' : 'Discover opportunities') : (lang === 'de' ? 'Bewerbungen vorbereiten' : 'Prepare applications') }}<InfoHint :lang="lang" :label="lang === 'de' ? 'Anmeldung' : 'Sign in'" :text="lang === 'de' ? 'Melde dich bei Supabase an, um auf deinen Bewerbungsbereich zuzugreifen. Das CV-Studio ist auch ohne Anmeldung verfügbar.' : 'Sign in to Supabase to access your application workspace. CV Studio remains available without an account.'" /></h1></section>

      <CloudWorkspace
        ref="cloudWorkspace"
        v-if="cloudUser"
        v-show="isCloudTab"
        :key="cloudUser.id"
        :client="supabaseClient"
        :user-id="cloudUser.id"
        :tab="cloudTab"
        :active="isCloudTab"
        :lang="lang"
        :configurations="selectableConfigurations"
        :selected-id="selectedConfigurationId"
        :read-version="readCloudVersion"
        :create-variant="createVariant"
        @navigate="selectBuilderGroup"
        @save-career-variant="saveCareerVariant"
        @edit-variant="openStudioVariant"
      />

      <DesktopSidebarPortal area="minor" :active="!isCloudTab && studioHasPreview">
        <div v-show="!isMobile && !isCloudTab && studioHasPreview" class="studio-sidebar-preview">
          <button class="btn" type="button" :disabled="isEmptyDocument" @click="openFullPreview">{{ t('openPreview') }}</button>
          <button class="btn btn--primary" type="button" :disabled="isStudioPreviewExporting || isEmptyDocument" @click="exportStudioPreview"><font-awesome-icon v-if="isStudioPreviewExporting" :icon="['fas', 'spinner']" spin />{{ t(isStudioPreviewExporting ? 'exportingPdf' : 'downloadPdf') }}</button>
        </div>
      </DesktopSidebarPortal>

      <section v-show="!isCloudTab" id="builder-group-cv-studio" class="builder-layout" :class="{ 'builder-layout--library': !studioHasPreview }">
        <div class="builder-layout__controls">
          <Transition name="builder-group">
            <CvVariantManager
              v-show="activeBuilderGroup === 'versions'"
              id="builder-group-versions"
              ref="cvVariantManager"
              class="builder-group-panel"
              :state="state"
              :lang="lang"
              :selector-target="isMobile ? '' : '#desktop-sidebar-major'"
              :selector-visible="!isCloudTab && activeBuilderGroup === 'versions'"
              :selected-id="selectedConfigurationId"
              :on-save="scheduleStateSave"
              :on-load="mergeIn"
              :before-load="prepareConfigurationChange"
              @update:selected-id="selectedConfigurationId = $event"
              @configs-change="savedConfigurations = $event"
              @save-result="handleConfigurationSaveResult"
              @version-deleted="handleVersionDeleted"
              @toggle-language="toggleLanguage"
            />
          </Transition>
          <Transition name="builder-group">
            <CvContentEditor v-show="activeBuilderGroup === 'content' && !isEmptyDocument" id="builder-group-content" ref="cvContentEditor" class="builder-group-panel" :toolbar-target="isMobile ? '#cv-studio-content-tools' : '#desktop-sidebar-major'" :toolbar-visible="!isCloudTab && activeBuilderGroup === 'content' && !isEmptyDocument" :state="state" :configurations="selectableConfigurations" :selected-id="selectedConfigurationId" :read-version="readSectionVersion" :save-version="saveSectionVersion" @section-save-status="sectionSaveStatus = $event">
              <template #before-content><div v-if="isMobile" id="cv-studio-content-tools" /></template>
            </CvContentEditor>
          </Transition>
          <Transition name="builder-group">
            <DesignPanel
              v-show="activeBuilderGroup === 'design' && !isEmptyDocument"
              id="builder-group-design"
              class="builder-group-panel"
              v-model="state.design"
              :lang="lang"
              :sidebar-active="!isCloudTab && activeBuilderGroup === 'design' && !isEmptyDocument"
            />
          </Transition>
          <Transition name="builder-group">
            <AnonymizationPanel
              @commit="commitPrivacyPreview"
              v-show="activeBuilderGroup === 'privacy' && !isEmptyDocument"
              id="builder-group-privacy"
              class="builder-group-panel"
              :state="state"
              :lang="lang"
            />
          </Transition>
          <LetterTemplateEditor ref="letterTemplates" v-show="activeBuilderGroup === 'templates'" class="builder-group-panel studio-templates" :client="supabaseClient" :user-id="cloudUser?.id || 'local'" :lang="lang" :sidebar-active="!isCloudTab && activeBuilderGroup === 'templates'" />
          <LocalAttachments ref="localAttachments" v-show="activeBuilderGroup === 'attachments'" class="builder-group-panel studio-attachments" :user-id="cloudUser?.id || ''" :client="supabaseClient" :lang="lang" :active="!isCloudTab && activeBuilderGroup === 'attachments'" :sidebar-active="!isCloudTab && activeBuilderGroup === 'attachments'" />
        </div>

        <InlineDocumentPreview v-if="!isMobile && studioHasPreview" class="studio-inline-preview" hide-actions v-model:page="studioPreviewPage" :pages="studioPreviewPages" :is-updating="isStudioPreviewRendering" :error="studioPreviewError" @retry="retryStudioPreview" :lang="lang" :downloading="isStudioPreviewExporting" :title="t(isPrivacyStudioPreview ? 'privacyPreview' : 'liveCvPreview')" @open="openFullPreview" @download="exportStudioPreview">
        </InlineDocumentPreview>
      </section>
    </section>

    <nav class="mobile-bottom-tabs" :aria-label="lang === 'de' ? 'Arbeitsbereiche' : 'Workspaces'">
      <button v-for="group in workspaceGroups" :key="group.key" class="builder-topbar__tab" :class="{ 'is-active': activeWorkspace === group.key }" :aria-pressed="activeWorkspace === group.key" type="button" @click="selectWorkspaceList(group.key)"><font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" /><span>{{ group.label }}</span></button>
      <SupabaseAuth v-if="isMobile" class="mobile-bottom-auth" :lang="lang === 'de' ? 'de' : 'en'" bottom-bar />
    </nav>
  </main>
</template>

<style>

html,
body,
#app {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.cv-builder-app {
  font-family: var(--font-ui);
  /* Spacing: 8px within controls, 16–24px around editor regions. */
  --workspace-inset: clamp(16px, 2vw, 24px);
  --workspace-gap: 24px;
  --workspace-control-gap: 8px;
  --workspace-sidebar-width: clamp(200px, 20vw, 272px);
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  padding: 10px;
  overflow: hidden;
  overscroll-behavior: none;
}

.cv-builder-app.is-preview-mode {
  overflow: auto;
}

.mobile-bottom-tabs { display: none; }

.pdf-render-source {
  position: fixed;
  top: 0;
  left: -240mm;
  pointer-events: none;
}

.builder-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  max-width: 1540px;
  margin: 0 auto;
  overflow: hidden;
}

.builder-shell > .builder-layout, .builder-shell > .jobs-workspace { flex: 1 1 auto; height: auto; }
.builder-shell > .builder-topbar, .cv-studio-navigation { flex: 0 0 auto; }
.builder-topbar { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; }
.cv-studio-navigation { display: block; }
.cv-studio-open-preview { flex: 0 0 auto; white-space: nowrap; }
.workspace-sign-in { padding: 30px; border: 1px solid #24504e; border-radius: 12px; color: #cbe5da; background: #06141f; }

.builder-topbar {
  --topbar-tab-height: 66px;
  position: relative;
  z-index: 20;
}

.builder-topbar__tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(76px, 1fr);
  min-width: 0;
}

.builder-topbar__tab {
  position: relative;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  min-height: var(--topbar-tab-height, 66px);
  padding: 8px;
  border: none;
  background: none;
  color: var(--ui-muted);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  transition: background-color .12s ease-out, color .12s ease-out;
}

.builder-topbar__tab .svg-inline--fa { font-size: 17px; }
.builder-topbar__tab:hover,
.builder-topbar__tab:focus-visible { background: var(--ui-surface-hover); color: var(--ui-text); }
.builder-topbar__tab:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -3px; }
.builder-topbar__tab.is-active { background: var(--ui-active); color: var(--ui-accent); }
.builder-topbar__tab.is-active::after { content: ''; position: absolute; inset: auto 12px 0; height: 1px; background: var(--ui-accent); }
.builder-topbar__tab:disabled { opacity: .4; cursor: not-allowed; border-color: transparent; background: transparent; color: #94a3b8; box-shadow: none; transform: none; }

.builder-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  gap: 0;
  height: 100%;
  min-height: 0;
  margin: 0;
  max-width: none;
  overflow: hidden;
}

.builder-layout__controls {
  container: cv-editor / inline-size;
  position: relative;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  gap: 0;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  isolation: isolate;
}

.builder-layout__controls .builder-group-panel {
  display: flex;
  flex-direction: column;
  grid-area: 1 / 1;
  align-self: start;
  width: 100%;
  height: auto;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.builder-layout__controls #builder-group-content,
.builder-layout__controls .anonymization-panel { height: 100%; }
.builder-layout__controls .studio-templates,.builder-layout__controls .studio-attachments { height: 100%; overflow: hidden; }
.builder-layout.builder-layout--library { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }

.builder-group-panel > .group-panel__scroll-body,
.builder-group-panel > .editor-panel__body,
.builder-group-panel > .design-panel__scroll-body,
.builder-group-panel .content-panel__scroll-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scrollbar) transparent;
}

.builder-layout__controls .builder-group-panel > .content-panel {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.builder-group-panel > .group-panel__scroll-body::-webkit-scrollbar,
.builder-group-panel > .editor-panel__body::-webkit-scrollbar,
.builder-group-panel > .design-panel__scroll-body::-webkit-scrollbar,
.builder-group-panel .content-panel__scroll-body::-webkit-scrollbar {
  width: 6px;
}

.builder-group-panel > .group-panel__scroll-body::-webkit-scrollbar-thumb,
.builder-group-panel > .editor-panel__body::-webkit-scrollbar-thumb,
.builder-group-panel > .design-panel__scroll-body::-webkit-scrollbar-thumb,
.builder-group-panel .content-panel__scroll-body::-webkit-scrollbar-thumb {
  background: var(--ui-scrollbar);
  border-radius: 6px;
}

.builder-group-enter-active, .builder-group-leave-active { transition: opacity .12s ease-out; }
.builder-group-enter-active { position: relative; z-index: 1; }
.builder-group-leave-active {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  pointer-events: none;
}
.builder-group-enter-from, .builder-group-leave-to { opacity: 0; }

.builder-layout__controls .builder-group-panel { padding: 16px; box-sizing: border-box; background: transparent; border: 0; border-radius: 0; box-shadow: none; }
.builder-layout__controls .builder-group-panel > .content-panel { padding: 0; background: transparent; border: 0; border-radius: 0; }
.studio-sidebar-preview { display: flex; flex-direction: column; gap: 8px; }
.studio-sidebar-preview .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; width: 100%; }

@media (min-width: 761px) and (max-height: 600px) {
  .builder-topbar { --topbar-tab-height: 42px; }
  .builder-topbar__tab .svg-inline--fa { display: none; }
}

@media (max-width: 760px) {
  .builder-layout__controls .studio-templates { overflow-y: auto; }
  .builder-layout__controls .builder-group-panel { padding: 8px; }
  .cv-builder-app {
    --mobile-tabs-height: calc(72px + env(safe-area-inset-bottom, 0px));
    --mobile-context-row-height: 53px;
    --mobile-context-row-space: 0px;
    padding: max(8px, env(safe-area-inset-top, 0px)) max(8px, env(safe-area-inset-right, 0px)) calc(var(--mobile-tabs-height) + var(--mobile-context-row-space) + 8px) max(8px, env(safe-area-inset-left, 0px));
  }

  .cv-builder-app.has-mobile-context-row { --mobile-context-row-space: var(--mobile-context-row-height); }
  #cv-studio-content-tools { min-width: 0; padding: 8px 0 12px; border-bottom: 1px solid var(--ui-divider); }
  #cv-studio-content-tools button, .builder-layout__controls .backup-manager__actions :is(button, select) { min-height: 44px; }
  .builder-layout__controls .backup-manager__actions { flex-wrap: nowrap; margin-bottom: 8px; }
  .builder-layout__controls .backup-manager__actions select { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); font: inherit; font-size: 16px; }
  .builder-layout__controls .backup-manager__actions .btn { flex-shrink: 0; }
  .cv-builder-app.is-preview-mode { overflow: hidden; }
  .cv-studio-navigation { position: fixed; inset: auto 0 var(--mobile-tabs-height); z-index: 35; display: flex; align-items: center; gap: 8px; height: var(--mobile-context-row-height); padding: 4px max(8px, env(safe-area-inset-right, 0px)) 4px max(8px, env(safe-area-inset-left, 0px)); border-top: 1px solid #2b424b; background: #101c24; }
  .cv-studio-navigation .cv-studio-open-preview { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 0; border-left: 1px solid #2b424b; border-radius: 0; background: transparent; color: var(--ui-text); font-size: 20px; }
  .cv-studio-navigation .btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
  .builder-shell { grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
  .builder-layout { grid-template-rows: minmax(0, 1fr); gap: 0; }

  .mobile-bottom-tabs {
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: visible;
    gap: 4px;
    height: var(--mobile-tabs-height);
    padding: 8px max(8px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px));
    border-top: 1px solid var(--ui-divider);
    background: #06141f;
  }
  .mobile-bottom-tabs .builder-topbar__tab { min-width: 0; min-height: 0; padding: 4px 2px; gap: 5px; font-size: 10px; border: none; }
  .mobile-bottom-tabs .builder-topbar__tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .mobile-bottom-auth { min-width: 0; height: 100%; }


}

/* Keep the attachment library reachable when phone instructions wrap to many lines. */
@media (max-width: 760px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse) {
  .builder-layout__controls .studio-attachments { overflow-y: auto; }
  .builder-layout__controls .studio-attachments > .group-panel__scroll-body { flex: 0 0 auto; min-height: auto; overflow: visible; }
}

@media (min-width: 761px) {
  .cv-builder-app { padding: 0; }
  .builder-shell { --topbar-tab-height: 66px; display: grid; grid-template-columns: var(--workspace-sidebar-width) minmax(0, 1fr); grid-template-rows: var(--topbar-tab-height) minmax(0, 1fr); gap: 0; width: 100%; max-width: none; }
  .builder-shell > .desktop-sidebar { grid-column: 1; grid-row: 1 / 3; }
  .builder-shell > .builder-topbar { grid-column: 2; grid-row: 1; display: block; min-width: 0}
  .builder-topbar__tabs { height: 100%; }
  .builder-shell > .builder-layout, .builder-shell > .jobs-workspace, .builder-shell > .workspace-sign-in { grid-column: 2; grid-row: 2; min-width: 0; min-height: 0; margin-bottom: 0; }
  .builder-layout { padding: var(--workspace-inset); }
  .builder-layout:not(.builder-layout--library) { grid-template-columns: minmax(0, 1fr) minmax(280px, 34%); grid-template-rows: minmax(0, 1fr); gap: var(--workspace-gap); }
  .builder-layout__controls .builder-group-panel { padding: 0; }
  .builder-layout > .studio-inline-preview { width: 100%; min-width: 0; max-width: none; margin: 0; }
  .workspace-sign-in { margin: 20px 16px; align-self: start; }
}
@media (min-width: 761px) and (max-height: 600px) {
  .builder-shell { --topbar-tab-height: 42px; }
}
@media (min-width: 761px) and (max-width: 1050px) {
  .builder-layout:not(.builder-layout--library) { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(220px, 38vh); }
  .builder-layout > .studio-inline-preview { width: min(100%, 520px); justify-self: center; }
}
/* The shared preview hides in short windows; release its grid track too.
   The sidebar's Open preview action remains available at these sizes. */
@media (min-width: 761px) and (max-width: 1180px) and (max-height: 600px) {
  .builder-layout:not(.builder-layout--library) { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .builder-layout > .studio-inline-preview { display: none; }
}

/* Fields adapt to the editing column, independently of the PDF's layout. */
.builder-layout__controls label { min-width: 0; }
@container cv-editor (max-width: 600px) {
  .builder :is(.row, .row-2, .row-3, .row-4, .grid-2, .grid-3) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .builder .section-name-label { min-width: 0; overflow-wrap: anywhere; }
  .builder .section-head__actions:empty { display: none; }
}
@container cv-editor (max-width: 440px) {
  .builder :is(.row, .row-2, .row-3, .row-4, .grid-2, .grid-3) { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .builder-topbar__tab, .builder-group-enter-active, .builder-group-leave-active { transition: none; }
}
</style>
