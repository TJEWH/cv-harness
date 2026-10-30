<script setup lang="ts">
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faAlignLeft, faCheck, faCopy, faFeatherPointed, faRotate, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, ApplicationStage } from '../../../app/cloudTypes';
import { supabaseConfiguration } from '../../../platform/supabase/supabase';
import type { CvState, SavedConfiguration } from '../../../documents/cv/types';
import type { ApplicationLetter, LetterFormatting, LetterTemplate } from '../../../documents/letter/letterTypes';
import type { ApprovedPrivacyContexts, AnnotationStatus, AnnotationReference, LocalRefinementRequest, RefinementApprovals, RefinementFeedback, RefinementProposalRow, RefinementRequestRow, RefinementReviewRow, RefinementScope, RefinementState } from '../../refinement/refinementTypes';
import { cloneCv, createApplicationCv, cvDifferences, isApplicationCvPublished, loadApplicationCv, saveApplicationCv, type ApplicationCvRecord } from '../applicationCv';
import { isMainCvVariant } from '../../cv-studio/domain/careerVariants';
import { addIncomingDraft, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter, finalizeLetter, formatLetter, letterContextVersion, letterFromEditableText, openLetterRevision, saveWorkingRevision, selectApplicationLetterTemplate, unresolvedLetterPlaceholders } from '../../../documents/letter/motivationLetters';
import { currentRefinementRequestId, applyRefinementProposal, createRefinementRepository, describeCvOperation, parseRefinementProposal, prepareRefinement, reconstructRefinementProposal, refinementSignature, sanitizeRefinementSetup, sanitizeRefinementText, validateLocalRefinementSource } from '../../refinement/applicationRefinement';
import { applicationStage, applicationStatusLabel, applicationStatusTone, applicationTrackingStarted } from '../domain/applicationTracking';
import { formatOpportunityDeadline } from '../../opportunities/domain/opportunityDeadline';
import FormBuilder from '../../cv-studio/components/FormBuilder.vue';
import DocumentCvPreview from '../../../documents/cv/components/DocumentCvPreview.vue';
import MotivationLetterPreview from '../../../documents/letter/components/MotivationLetterPreview.vue';
import LetterFormattingControls from '../../../documents/letter/components/LetterFormattingControls.vue';
import { resolveLetterFormatting } from '../../../documents/letter/domain/letterFormatting';
import { applyLetterHeader, captureLetterHeaderSource, resolveApplicationLetterState } from '../../../documents/letter/domain/letterContact';
import RefinementHistory from '../../refinement/components/RefinementHistory.vue';
import ApplicationDocuments from './ApplicationDocuments.vue';
import ApplicationIdentifier from './ApplicationIdentifier.vue';
import ApplicationDeadlineCalendar from './ApplicationDeadlineCalendar.vue';
import WorkspaceDetailHeader from '../../../shared/ui/WorkspaceDetailHeader.vue';
import WorkspaceMobileActions from '../../../shared/ui/WorkspaceMobileActions.vue';
import { provideWorkspaceMobileActions } from '../../../shared/ui/workspaceMobileActions';
import OpportunityContext from '../../opportunities/components/OpportunityContext.vue';
import { buildShortRefinementInstruction } from '../../refinement/domain/applicationReference';
import { resolveRefinementSettings, serializeRefinementDraft, sameRefinementInputs } from '../../refinement/domain/refinementSources';
import RefinementAnnotations from '../../refinement/components/RefinementAnnotations.vue';
import RefinementChangeReview from '../../refinement/components/RefinementChangeReview.vue';
import RefinementComparisonToggle from '../../refinement/components/RefinementComparisonToggle.vue';
import { annotationViews, retainedAnnotationViews, annotationReferenceChanged, annotationFeedback, validateAnnotationReview } from '../../refinement/domain/refinementAnnotations';
import { useToastWatch } from '../../../shared/ui/useToasts';
import DesktopSidebarPortal from '../../../shared/ui/DesktopSidebarPortal.vue';
import { refinementMatchesScope, visibleRefinementProposals } from '../../refinement/domain/refinementHistory';
import { useDesktopSidebar } from '../../../shared/ui/desktopSidebar';
import AutosaveTextarea from '../../../shared/ui/AutosaveTextarea.vue';
import { commitPendingTextareas } from '../../../shared/editing/textareaCommit';
import { copyPreparedText } from '../../../shared/lib/preparedClipboard';
import type { SearchTemplate } from '../../meta-search/searchTypes';
import { createSearchTemplateRepository } from '../../meta-search/data/useSearchTemplates';
import { isSearchTemplateSaved } from '../../meta-search/domain/searchPrompts';
import { importCloudSearchTemplate, listCloudSearchTemplates } from '../../meta-search/data/searchTemplateCloud';
import { captureMetaSearchInterests, letterTemplateWithSearchProfile } from '../../../documents/letter/searchLetterContext';

const props = withDefaults(defineProps<{
  projectId?: string; active?: boolean; checklistSaving?: boolean;
  application: Application; client: SupabaseClient | null; userId: string; lang: string;
  configurations: SavedConfiguration[]; readVersion: (id: string) => CvState | null;
  publishCv: (state: CvState) => Promise<Application | null>;
  createVariant?: (name: string, state: CvState) => string | null;
  flushEvaluation?: () => Promise<boolean>;
}>(), { active: true });
const emit = defineEmits<{ close: []; 'edit-variant': [id: string]; toggleChecklist: [key: string, completed: boolean]; 'change-stage': [stage: ApplicationStage] }>();
const desktopSidebar = useDesktopSidebar();
const mobileActions = ref<HTMLElement | null>(null);
const mobileScrollContent = ref<HTMLElement | null>(null);
const stageNavigation = ref<HTMLElement | null>(null);
const annotations = ref<InstanceType<typeof RefinementAnnotations> | null>(null);
provideWorkspaceMobileActions(mobileActions);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const storageKey = 'CV_REFINEMENT:1:' + encodeURIComponent(props.userId) + ':' + props.application.id;
const navigationKey = 'CV_APPLICATION_TAB:' + props.userId + ':' + props.application.id;
const stages = ['preparation', 'refinement', 'review', 'tracking'] as const;
type Stage = typeof stages[number];
const tab = ref<Stage>(applicationStage(props.application));
const record = ref<ApplicationCvRecord | null>(null);
const letter = ref<ApplicationLetter | null>(null);
const templates = ref<LetterTemplate[]>([]);
const searchTemplates = ref<SearchTemplate[]>([]);
const loadingSharedInterests = ref(false);
const approvals = ref<RefinementApprovals>({ cv: null, letter: null });
const variantName = ref('');
const savedVariant = ref<{ id: string; name: string; revision: string; previousIds?: string[] } | null>(null);
const privacyContexts = ref<ApprovedPrivacyContexts>({});
const localRequests = ref<Record<string, LocalRefinementRequest>>({});
type DocumentScope = 'cv' | 'letter';
type IterationNotes = { tone: string; structure: string; content: string };
const iterationNoteFields = ['tone', 'structure', 'content'] as const;
type IterationNoteField = typeof iterationNoteFields[number];
type IterationFeedbackSubmission = {
  id: string; text: string; requestId: string | null;
  draft?: { notes: IterationNotes; knownProposalIds: string[] };
};
const emptyIterationNotes = (): IterationNotes => ({ tone: '', structure: '', content: '' });
const iterationNotes = ref<Record<DocumentScope, IterationNotes>>({ cv: emptyIterationNotes(), letter: emptyIterationNotes() });
const iterationFeedbackSubmission = ref<Record<DocumentScope, IterationFeedbackSubmission | null>>({ cv: null, letter: null });
const selectedIterationNote = ref<IterationNoteField>('tone');
const visibleIterationNoteFields = computed(() => iterationNoteFields.filter(field => pane.value === 'letter' || field !== 'tone'));
const activeIterationNote = computed({
  get: () => visibleIterationNoteFields.value.includes(selectedIterationNote.value) ? selectedIterationNote.value : visibleIterationNoteFields.value[0]!,
  set: (field: IterationNoteField) => { commitPendingTextareas(); selectedIterationNote.value = field; },
});
const cvIterationNote = computed({
  get: () => iterationNoteFields.map(field => iterationNotes.value.cv[field]).filter(value => value.trim()).join('\n\n'),
  set: (value: string) => { iterationNotes.value.cv = { tone: '', structure: '', content: value }; },
});
const iterationNoteIcons = { tone: faFeatherPointed, structure: faAlignLeft, content: faAlignLeft };
const iterationNoteLabel = (field: IterationNoteField) => ({ tone: text('Tone', 'Tonalität'), structure: text('Structure', 'Struktur'), content: text('Content', 'Inhalt') })[field];
const iterationNotePlaceholder = computed(() => ({
  tone: text(
    'e.g. Use a confident, measured voice. Replace generic enthusiasm with specific reasons for my interest.',
    'Z. B. Schreibe selbstbewusst und sachlich. Ersetze allgemeine Begeisterung durch konkrete Gründe für mein Interesse.',
  ),
  structure: pane.value === 'cv' ? text(
    'e.g. Put research experience before education. Group related methods and place the strongest evidence first.',
    'Z. B. Stelle Forschungserfahrung vor Ausbildung. Bündele verwandte Methoden und nenne die stärksten Belege zuerst.',
  ) : text(
    'e.g. Open with my research interest, connect it to one relevant project, and close with my fit for the lab.',
    'Z. B. Beginne mit meinem Forschungsinteresse, verknüpfe es mit einem passenden Projekt und schließe mit meiner Eignung für die Arbeitsgruppe.',
  ),
  content: pane.value === 'cv' ? text(
    'e.g. Emphasize methods and outcomes relevant to this role. Quantify results only where my source material supports them.',
    'Z. B. Betone Methoden und Ergebnisse, die zur Stelle passen. Nenne Zahlen nur, wenn meine Unterlagen sie belegen.',
  ) : text(
    'e.g. Use my thesis methods to explain my fit for the lab. Include only details supported by my CV or answers.',
    'Z. B. Erkläre anhand der Methoden meiner Abschlussarbeit, wie ich zur Arbeitsgruppe passe. Nutze nur Angaben aus meinem CV oder meinen Antworten.',
  ),
})[activeIterationNote.value]);
const iterationNoteTabId = (field: IterationNoteField) => `${props.application.id}-${pane.value}-note-${field}`;
const iterationNotePanelId = computed(() => `${props.application.id}-${pane.value}-note-panel`);
function onIterationNoteKeydown(event: KeyboardEvent, field: IterationNoteField) {
  const fields = visibleIterationNoteFields.value;
  const index = fields.indexOf(field);
  const next = event.key === 'ArrowRight' ? fields[(index + 1) % fields.length]
    : event.key === 'ArrowLeft' ? fields[(index + fields.length - 1) % fields.length]
    : event.key === 'Home' ? fields[0] : event.key === 'End' ? fields.at(-1) : undefined;
  if (!next) return;
  event.preventDefault();
  const tabs = (event.currentTarget as HTMLElement).parentElement;
  void selectIterationNote(next).then(changed => {
    if (changed) tabs?.querySelector<HTMLButtonElement>(`[data-iteration-note="${next}"]`)?.focus();
  });
}
const pendingResetFeedback = ref<Record<DocumentScope, { id: string; text: string; requestId: string | null } | null>>({ cv: null, letter: null });
const parentProposalIds = ref<Record<DocumentScope, string | null>>({ cv: null, letter: null });
const resetRequestIds = ref<string[]>([]);
const resetRequestIdsByScope = ref<Record<DocumentScope, string[]>>({ cv: [], letter: [] });
// A reset may restore a pre-request CV that differs from its library baseline;
// surviving reset request IDs block refresh until cloud history confirms the clear.
const resetCvStateSignature = ref<string | null>(null);
const cloudState = ref<RefinementState | null>(null);
const requests = ref<RefinementRequestRow[]>([]);
const proposals = ref<RefinementProposalRow[]>([]);
const reviews = ref<RefinementReviewRow[]>([]);
const selectedProposalIds = ref<Record<DocumentScope, string>>({ cv: '', letter: '' });
const selectedProposalId = computed({ get: () => selectedProposalIds.value[pane.value], set: (id: string) => { selectedProposalIds.value[pane.value] = id; } });
// Activation updates the pending preview; the next matching reply commits its frozen source.
const selectedChangeIds = ref<string[]>([]);
const cvSelections = ref<Record<string, string[]>>({});
type ReviewTab = 'changes' | 'question';
const reviewTabs: ReviewTab[] = ['changes', 'question'];
const reviewTab = ref<ReviewTab>('changes');
const reviewTabLabel = (value: ReviewTab) => ({ changes: text('Changes', 'Änderungen'), question: text('Questions', 'Fragen') })[value];
const reviewTabId = (value: ReviewTab) => `${props.application.id}-${pane.value}-review-${value}`;
const reviewPanelId = computed(() => `${props.application.id}-${pane.value}-review-panel`);
const includeProposedLetter = ref(true);
const reviewActive = ref(false);
const reviewComparisons = ref<Record<string, 'original' | 'proposed'>>({});
const reviewComparison = computed({ get: () => reviewComparisons.value[selectedProposalId.value] || 'proposed', set: (value: 'original' | 'proposed') => { reviewComparisons.value[selectedProposalId.value] = value; } });
const feedbackScope = ref<RefinementScope>('cv');
const pane = computed(() => feedbackScope.value);
const currentRequestId = computed(() => currentRefinementRequestId(cloudState.value, pane.value));
const iterationNoteEditor = computed(() => {
  const scope = pane.value, field = activeIterationNote.value;
  return {
    key: `${scope}:${field}`, value: iterationNotes.value[scope][field],
    update: (value: string) => { iterationNotes.value[scope][field] = value; },
  };
});
const parentProposalId = computed({
  get: () => parentProposalIds.value[pane.value],
  set: (id: string | null) => {
    parentProposalIds.value[pane.value] = id;
  },
});
function isRequestReset(id: string, scope: DocumentScope = pane.value) {
  return resetRequestIds.value.includes(id) || resetRequestIdsByScope.value[scope].includes(id);
}
function matchesScope(row: RefinementRequestRow, scope: DocumentScope = pane.value) {
  return refinementMatchesScope(row.request_json.scope, scope, row.cleared_scopes);
}
let scopeWasChosen = false;
const shortInstruction = computed(() => {
  const request = requests.value.find(row => row.id === currentRequestId.value)?.request_json;
  const projectId = refinementProjectId(false);
  return buildShortRefinementInstruction(props.application, feedbackScope.value, projectId && request?.scope === feedbackScope.value
    ? { projectId, request } : undefined);
});
const shortInstructionNotice = ref('');
const shortInstructionError = ref('');
watch(shortInstruction, () => { shortInstructionNotice.value = ''; shortInstructionError.value = ''; });
const busy = ref(false);
const refreshing = ref(false);
const syncing = ref(false);
const error = ref('');
const notice = ref('');
const saveError = ref('');
const cloudLoaded = ref(false);
const historyOpen = ref(false);
const preview = ref<InstanceType<typeof DocumentCvPreview> | null>(null);
const letterPreview = ref<InstanceType<typeof MotivationLetterPreview> | null>(null);
const documentReadiness = ref({ included: 0, missing: 0 });
const repository = createRefinementRepository(props.client, () => props.userId);
const letterRepository = createLetterRepository(localStorage, props.userId);
const searchRepository = createSearchTemplateRepository(localStorage, props.userId);
let disposed = false;
let loadingCloud: Promise<void> | null = null;
let localReadError = '';
let committingSelection = false;
let refreshSnapshotsOnOpen = false;
let createdLetterOnOpen = false;
let initialLetterDraftEdited = false;
let sharedSearchHydrated = false;
let sharedSearchRead: Promise<void> | null = null;
const explicitHistorySelections = new Set<string>();

try {
  record.value = loadApplicationCv(props.userId, props.application.id);
  // Keep the saved copy until current refinement history confirms it can be refreshed.
  if (record.value) { record.value.detached = true; saveApplicationCv(record.value); }
  templates.value = letterRepository.listTemplates();
  reloadSearchTemplates();
  letter.value = letterRepository.load(props.application.id);
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    const value = JSON.parse(stored);
    if (value.version !== 1) throw new Error('Unsupported refinement backup version.');
    approvals.value = { cv: typeof value.approvals?.cv === 'string' ? value.approvals.cv : null, letter: typeof value.approvals?.letter === 'string' ? value.approvals.letter : null };
    if (typeof value.savedVariant?.id === 'string' && typeof value.savedVariant.name === 'string' && typeof value.savedVariant.revision === 'string') savedVariant.value = {
      id: value.savedVariant.id, name: value.savedVariant.name, revision: value.savedVariant.revision,
      previousIds: Array.isArray(value.savedVariant.previousIds) ? value.savedVariant.previousIds.filter((id: unknown) => typeof id === 'string') : undefined,
    };
    // Retired imports and v1 requests cannot take part in the connected v2 workflow.
    // Keep each current request's full private reconstruction snapshot intact.
    localRequests.value = Object.fromEntries(Object.entries(value.requests || {})
      .filter((entry): entry is [string, LocalRefinementRequest] => {
        const local = entry[1] as Partial<LocalRefinementRequest> | null;
        return !!local && local.request?.schemaVersion === 2;
      }));
    privacyContexts.value = value.privacyContexts || {};
    cvSelections.value = Object.fromEntries(Object.entries(value.cvSelections || {}).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every(id => typeof id === 'string')));
    for (const scope of ['cv', 'letter'] as const) {
      const parent = value.parentProposalIds ? value.parentProposalIds[scope] : value.parentProposalId;
      parentProposalIds.value[scope] = typeof parent === 'string' ? parent : null;
      resetRequestIdsByScope.value[scope] = Array.isArray(value.resetRequestIdsByScope?.[scope]) ? value.resetRequestIdsByScope[scope].filter((id: unknown) => typeof id === 'string') : [];
      for (const field of ['tone', 'structure', 'content'] as const) {
        const draft = value.iterationNotes?.[scope]?.[field];
        if (typeof draft === 'string') iterationNotes.value[scope][field] = draft;
      }
      const submission = value.iterationFeedbackSubmission?.[scope];
      if (submission && typeof submission.id === 'string' && typeof submission.text === 'string' && (submission.requestId === null || typeof submission.requestId === 'string')) {
        const draft = submission.draft;
        iterationFeedbackSubmission.value[scope] = {
          id: submission.id, text: submission.text, requestId: submission.requestId,
          ...(draft && iterationNoteFields.every(field => typeof draft.notes?.[field] === 'string') && Array.isArray(draft.knownProposalIds) && draft.knownProposalIds.every((id: unknown) => typeof id === 'string') ? { draft } : {}),
        };
      }
      const reset = value.pendingResetFeedback?.[scope];
      if (reset && typeof reset.id === 'string' && typeof reset.text === 'string' && (reset.requestId === null || typeof reset.requestId === 'string')) pendingResetFeedback.value[scope] = reset;
    }
    resetRequestIds.value = Array.isArray(value.resetRequestIds) ? value.resetRequestIds : [];
    resetCvStateSignature.value = typeof value.resetCvStateSignature === 'string' ? value.resetCvStateSignature : null;
    if (value.selectedProposalIds && typeof value.selectedProposalIds === 'object') {
      for (const scope of ['cv', 'letter'] as const) if (typeof value.selectedProposalIds[scope] === 'string') selectedProposalIds.value[scope] = value.selectedProposalIds[scope];
    }
    if (['cv', 'letter'].includes(value.scope)) { feedbackScope.value = value.scope; scopeWasChosen = true; }
  }
  // Initialize only untouched applications; missing working copies with saved history need recovery.
  if (!letter.value && !record.value && !stored && !props.application.cv_variant_id) {
    const template = letterRepository.defaultTemplate();
    if (template) {
      const interests = template.useMetaSearchInterests === true ? captureMetaSearchInterests(searchTemplates.value[0]) : undefined;
      const initialContext = letterContextVersion(props.application, null, letterTemplateWithSearchProfile(template, interests), template.language, '', template.maxWords);
      const initial = createApplicationLetter(props.userId, props.application.id, template, initialContext, template.language);
      if (interests) initial.searchProfile = interests;
      letter.value = letterRepository.save(initial);
      createdLetterOnOpen = true;
    }
  }
  const previous = sessionStorage.getItem(navigationKey);
  const mapped = ({ overview: 'preparation', cv: 'refinement', letter: 'refinement', documents: 'review' } as Record<string, Stage>)[previous || ''] || previous;
  if (!props.application.workflow_stage && !applicationTrackingStarted(props.application) && stages.includes(mapped as Stage)) tab.value = mapped as Stage;
} catch (cause) {
  localReadError = text('Saved application data could not be read. Recover the local application data before saving: ', 'Gespeicherte Bewerbungsdaten konnten nicht gelesen werden. Vor dem Speichern die lokalen Bewerbungsdaten wiederherstellen: ') + String(cause);
  saveError.value = localReadError;
}
const selectedCvId = computed(() => record.value?.variantId || record.value?.baseId || '');
const preparationVariants = computed(() => props.configurations.filter(isMainCvVariant));
const selectedTemplate = computed(() => letter.value?.templateSnapshot || templates.value.find(item => item.id === letter.value?.templateId) || DEFAULT_LETTER_TEMPLATES[0]!);
const effectiveLetterTemplate = computed(() => letterTemplateWithSearchProfile(selectedTemplate.value, letter.value?.searchProfile));
const effectiveLetterFormatting = computed(() => resolveLetterFormatting(letter.value?.formatting, selectedTemplate.value.formatting));
const missingLetterTemplate = computed(() => !!letter.value && !letter.value.templateSnapshot);
const selectedTemplateId = computed(() => {
  const template = templates.value.find(item => item.id === letter.value?.templateId);
  return template && template.revision === letter.value?.templateSnapshot?.revision ? template.id : '';
});
const effectiveSettings = computed(() => resolveRefinementSettings(effectiveLetterTemplate.value, letter.value));
const setup = computed(() => effectiveSettings.value.setup);
const letterText = computed(() => serializeRefinementDraft(letter.value?.working).text);
const letterCvState = computed(() => {
  const cv = record.value;
  if (!cv) return null;
  const source = cv.letterHeaderSource?.sourceCvId === selectedCvId.value ? cv.letterHeaderSource : undefined;
  return resolveApplicationLetterState(cv.state, cv.baseState, source);
});
const context = computed(() => letterContextVersion(props.application, letterCvState.value, effectiveLetterTemplate.value, setup.value.language, letter.value?.instructions || '', setup.value.maxWords, letter.value?.formatting));
function documentSignature(scope: DocumentScope, cvState = record.value?.state) {
  return scope === 'cv'
    ? refinementSignature([cvState, record.value?.variantId || record.value?.baseId, props.application.context_json])
    : refinementSignature([letterText.value, setup.value, letter.value?.instructions || '', letter.value?.working, letter.value?.formatting, props.application.context_json]);
}
function currentSourceSignature(local: LocalRefinementRequest) {
  return local.baselineScope ? documentSignature(local.baselineScope) : baselineSignature.value;
}
const baselineSignature = computed(() => refinementSignature([record.value?.state, letterText.value, setup.value, letter.value?.instructions || '', props.application.context_json, letter.value?.working]));
const cvRevision = computed(() => refinementSignature([record.value?.state, props.application.context_json]));
const letterRevision = computed(() => refinementSignature([letterText.value, setup.value, letter.value?.instructions || '', letterCvState.value?.design, letterCvState.value?.contact, letterCvState.value?.disabled.includes('header'), props.application.context_json, context.value.theme]));
const cvApproved = computed(() => !!record.value && approvals.value.cv === cvRevision.value && !saveError.value);
function suggestedVariantName() { return record.value ? `${record.value.baseName} · ${String(props.application.context_json.title || text('Refined CV', 'Überarbeiteter CV'))}` : ''; }
variantName.value = savedVariant.value?.name || suggestedVariantName();
const savedVariantId = computed(() => savedVariant.value?.id || '');
const currentVariantSaved = computed(() => {
  const receipt = savedVariant.value;
  const snapshot = previewCvState.value;
  if (!snapshot || !receipt || receipt.revision !== refinementSignature([snapshot, props.application.context_json]) || receipt.name !== variantName.value.trim()) return false;
  const variant = props.configurations.find(item => item.id === savedVariantId.value);
  if (!variant || !isMainCvVariant(variant) || variant.name !== receipt.name) return false;
  // Library saves signal changes to the stored snapshot through their metadata.
  void variant.mtime;
  return refinementSignature(props.readVersion(variant.id)) === refinementSignature(snapshot);
});
const unresolved = computed(() => letter.value ? unresolvedLetterPlaceholders(letter.value.working, letterCvState.value?.contact || null) : []);
const letterApproved = computed(() => !!letterText.value.trim() && approvals.value.letter === letterRevision.value && !unresolved.value.length && !saveError.value);
const words = computed(() => letterText.value.trim().split(/\s+/).filter(Boolean).length);
const published = computed(() => !!record.value && isApplicationCvPublished(record.value, props.application.cv_variant_id));
const selectedProposal = computed(() => proposals.value.find(item => item.id === selectedProposalId.value));
const selectedRequest = computed(() => requests.value.find(item => item.id === selectedProposal.value?.request_id));
const selectedLocalRequest = computed(() => selectedProposal.value ? localRequests.value[selectedProposal.value.request_id] : undefined);
const reviewScope = computed(() => selectedLocalRequest.value?.request.scope || selectedRequest.value?.request_json.scope);
const showReviewPreview = computed(() => reviewActive.value && tab.value === 'refinement');
const showCvReview = computed(() => tab.value === 'refinement' && pane.value === 'cv' && hasActiveProposal.value && reviewScope.value !== 'letter');
const showLetterComparison = computed(() => tab.value === 'refinement' && pane.value === 'letter' && hasActiveProposal.value && reviewScope.value !== 'cv');
const showLetterReview = computed(() => (showReviewPreview.value || showLetterComparison.value) && reviewScope.value !== 'cv');
const currentPublishedRequest = computed(() => requests.value.find(item => item.id === currentRequestId.value) || null);
const publishedSource = computed(() => currentPublishedRequest.value || requests.value.find(row => row.request_json.scope === pane.value) || null);
function nextCvSource(): { state: CvState; parentId: string | null; pending?: LocalRefinementRequest['pendingCvSelection'] } {
  const parent = proposals.value.find(row => row.id === parentProposalId.value);
  const fallback = { state: record.value!.state, parentId: parent && requests.value.some(row => row.id === parent.request_id && row.request_json.scope === pane.value) ? parent.id : null };
  if (feedbackScope.value !== 'cv' || cvApproved.value) return fallback;
  const pendingLocal = currentPublishedRequest.value && localRequests.value[currentPublishedRequest.value.id];
  if (pendingLocal?.pendingCvSelection && !pendingLocal.pendingCvSelection.applied
    && pendingLocal.pendingCvSelection.workingRevision === cvRevision.value) {
    return { state: pendingLocal.cv.baselineState, parentId: pendingLocal.pendingCvSelection.proposalId, pending: pendingLocal.pendingCvSelection };
  }
  const row = selectedProposal.value;
  if (!row || row.request_id !== currentRequestId.value || selectedRequest.value?.request_json.scope !== 'cv') return fallback;
  try {
    const result = checkedProposalResult(true);
    return { state: result.state, parentId: row.id, pending: { requestId: row.request_id, proposalId: row.id, selectedIds: [...selectedChangeIds.value], workingRevision: cvRevision.value } };
  } catch { return fallback; } // A manual edit starts a fresh source instead of replaying an older selection.
}
const sourcePreparation = computed(() => {
  if (!record.value || !letter.value || missingLetterTemplate.value) return { local: null, error: '' };
  try {
    const source = nextCvSource();
    const sourceSignature = documentSignature(pane.value, source.state);
    const local = prepareRefinement({ applicationId: props.application.id, state: source.state, variantId: record.value.variantId || record.value.baseId, setup: setup.value, letterText: letterText.value, letterContent: letter.value.working, instructions: letter.value.instructions, opportunity: props.application.context_json, scope: feedbackScope.value, feedback: feedbackHistory(), parentProposalId: source.parentId, baselineSignature: sourceSignature, baselineScope: pane.value, privacyContexts: privacyContexts.value });
    if (source.pending) local.pendingCvSelection = clone(source.pending);
    local.source = { cv: { name: record.value.baseName, variantId: record.value.variantId || record.value.baseId, baseRevision: record.value.baseRevision, hasApplicationEdits: cvDifferences(record.value.baseState, source.state).length > 0 }, letter: { updatedAt: letter.value.updatedAt, version: refinementSignature(letterText.value) }, contextCapturedAt: props.application.context_captured_at };
    return { local, error: '' };
  } catch (cause) { return { local: null, error: cause instanceof Error ? cause.message : String(cause) }; }
});
const preparedSource = computed(() => sourcePreparation.value.local);
const sourceError = computed(() => sourcePreparation.value.error);
function previewOutgoingText(value: string) {
  try { return record.value ? sanitizeRefinementText(value.trim(), record.value.state) : ''; }
  catch { return text('Privacy preview unavailable. Remove unsupported control characters before sharing.', 'Datenschutzvorschau nicht verfügbar. Nicht unterstützte Steuerzeichen vor dem Teilen entfernen.'); }
}
const publicationStatus = computed<'unpublished' | 'current' | 'outdated' | 'unverifiable'>(() => {
  if (!publishedSource.value) return 'unpublished';
  if (!currentPublishedRequest.value || !matchesScope(currentPublishedRequest.value) || isRequestReset(currentPublishedRequest.value.id)) return 'outdated';
  const local = localRequests.value[currentPublishedRequest.value.id];
  if (!local || !record.value || !letter.value) return 'unverifiable';
  return preparedSource.value && sameRefinementInputs(local, preparedSource.value) ? 'current' : 'outdated';
});
const proposalChanges = computed(() => {
  const proposal = selectedProposal.value?.proposal_json, request = selectedRequest.value?.request_json;
  if (!proposal || !request) return [];
  const receipt = selectedLocalRequest.value?.acceptances?.filter(item => item.proposalId === selectedProposal.value?.id).at(-1);
  const decision = receipt ? reviews.value.find(item => item.id === receipt.reviewId)
    : [...reviews.value].reverse().find(item => item.kind === 'cv_decisions' && item.payload.proposalId === selectedProposal.value?.id);
  const applied = selectedLocalRequest.value?.appliedCvSelection;
  const status = (id: string): 'proposed' | 'accepted' | 'rejected' => applied?.proposalId === selectedProposal.value?.id
    ? applied!.selectedIds.includes(id) ? 'accepted' : 'rejected'
    : (decision?.payload.accepted as string[] | undefined)?.includes(id) ? 'accepted' : (decision?.payload.rejected as string[] | undefined)?.includes(id) ? 'rejected' : 'proposed';
  return proposal.cvOperations.map(operation => ({
    ...describeCvOperation(operation, request.cvStructure), id: operation.id, type: operation.type, explanation: operation.explanation, status: status(operation.id),
  }));
});
const proposalComments = computed(() => (selectedProposal.value?.proposal_json.cvComments || []).map(comment => ({
  ...comment, target: selectedRequest.value?.request_json.cv.fields.find(field => field.id === comment.fieldId)?.label || comment.fieldId,
})));
const scopedRequests = computed(() => requests.value.filter(row => matchesScope(row)));
function hasDocumentProposal(scope: DocumentScope) {
  // A local reset starts before cloud deletion. Keep the source locked until
  // Clear history succeeds and removes this scope from the saved requests.
  return requests.value.some(request => request.request_json.scope === scope && matchesScope(request, scope)
    && proposals.value.some(proposal => proposal.request_id === request.id));
}
const cvSelectionLocked = computed(() => hasDocumentProposal('cv'));
const letterSelectionLocked = computed(() => hasDocumentProposal('letter'));
const preparationBusy = computed(() => busy.value || refreshing.value || syncing.value || !!props.client && !cloudLoaded.value);
const availableProposals = computed(() => visibleRefinementProposals(proposals.value.filter(row => !isRequestReset(row.request_id)), currentRequestId.value, selectedProposalId.value)
  .filter(row => scopedRequests.value.some(request => request.id === row.request_id)));
const originalRequest = computed(() => [...scopedRequests.value].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0]);
function reviewMatchesScope(row: RefinementReviewRow, scope: DocumentScope = pane.value) {
  if (row.cleared_scopes?.includes(scope)) return false;
  const ownScope = row.kind === 'feedback' ? row.payload.scope : row.kind === 'annotation'
    ? proposals.value.find(proposal => proposal.id === row.payload.proposalId)?.proposal_json.annotations?.find(annotation => annotation.id === row.payload.annotationId)?.document
    : row.kind === 'cv_decisions' ? requests.value.find(request => request.id === row.request_id)?.request_json.scope
    : row.kind.includes('letter') ? 'letter' : 'cv';
  return ownScope === scope || ownScope === 'both';
}
const canClearHistory = computed(() => cloudLoaded.value && !!(scopedRequests.value.length || reviews.value.some(row => reviewMatchesScope(row))
  || Object.values(localRequests.value).some(local => !local.publishedAt && refinementMatchesScope(local.request.scope, pane.value))));
const legacyReview = computed(() => selectedRequest.value?.request_json.scope === 'both');
const scopeLocked = computed(() => pane.value === 'cv' ? cvApproved.value : letterApproved.value);
const hasActiveProposal = computed(() => !!selectedProposal.value && availableProposals.value.some(row => row.id === selectedProposalId.value));
// The refinement phase survives selection changes and waiting for a later proposal.
const showInitialRefinement = computed(() => !proposals.value.some(row => {
  return !isRequestReset(row.request_id) && scopedRequests.value.some(request => request.id === row.request_id && request.request_json.scope === pane.value) || row.id === selectedProposalId.value;
}));
const iterationPending = computed(() => currentPublishedRequest.value?.request_json.scope === feedbackScope.value
  && !!currentPublishedRequest.value.request_json.parentProposalId
  && !proposals.value.some(row => row.request_id === currentPublishedRequest.value!.id));
function selectionKey(row: RefinementProposalRow, selected = selectedChangeIds.value, includeLetter = includeProposedLetter.value) {
  return refinementSignature([row.id, row.request_id, row.proposal_json, [...selected].sort(), includeLetter]);
}
const proposalAlreadyApplied = computed(() => {
  const row = selectedProposal.value;
  const applied = selectedLocalRequest.value?.appliedCvSelection;
  if (row && applied?.proposalId === row.id) return refinementSignature([...applied.selectedIds].sort()) === refinementSignature([...selectedChangeIds.value].sort());
  return !!row && localRequests.value[row.request_id]?.acceptances?.at(-1)?.key === selectionKey(row);
});
const cvChangeReviewError = computed(() => {
  if (!selectedProposal.value || pane.value !== 'cv') return '';
  try { checkedProposalResult(true); return ''; }
  catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
});
// The latest accepted letter remains editable while its source stays available
// for comparison. CV-only acceptances and older letter proposals do not replace it.
const selectedWorkingLetter = computed(() => {
  const latest = [...(letter.value?.revisions || [])].reverse().find(revision => revision.kind === 'generated'
    && revision.cloudDraftId && revision.cloudContextId && !isRequestReset(revision.cloudContextId, 'letter')
    && localRequests.value[revision.cloudContextId]?.acceptances?.some(receipt => receipt.proposalId === revision.cloudDraftId));
  return !!latest && latest.cloudDraftId === selectedProposal.value?.id;
});
const comparingWorkingLetter = computed(() => showLetterComparison.value && !reviewActive.value && reviewComparison.value === 'proposed' && selectedWorkingLetter.value);
watch(() => selectedProposal.value?.id, () => {
  const saved = cvSelections.value[selectedProposalId.value];
  selectedChangeIds.value = saved ? proposalChanges.value.filter(change => saved.includes(change.id)).map(change => change.id)
    : proposalChanges.value.filter(change => change.status !== 'rejected').map(change => change.id);
  includeProposedLetter.value = !letterApproved.value && selectedRequest.value?.request_json.scope !== 'cv';
  reviewActive.value = !!selectedProposal.value && pane.value !== 'letter';
}, { flush: 'sync' });
const temporaryReview = computed(() => {
  if (!reviewActive.value && !showCvReview.value && !showLetterComparison.value) return { result: null, error: '' };
  try {
    const row = selectedProposal.value, local = selectedLocalRequest.value, source = selectedRequest.value;
    if (!row || !local) throw new Error(text('Restore the original local snapshot to preview this proposal.', 'Ursprünglichen lokalen Snapshot wiederherstellen, um diesen Vorschlag anzusehen.'));
    if (!source || source.application_id !== props.application.id || row.application_id !== props.application.id || source.user_id !== props.userId || row.user_id !== props.userId || row.request_id !== source.id || row.proposal_json.requestId !== source.id || refinementSignature(source.request_json) !== refinementSignature(local.request)) throw new Error(text('The proposal and its source request do not match this application.', 'Vorschlag und Quellanfrage passen nicht zu dieser Bewerbung.'));
    return { result: reconstructRefinementProposal(local, row.proposal_json, selectedChangeIds.value, props.application.id), error: '' };
  }
  catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : String(cause) }; }
});
const reviewAcceptanceError = computed(() => {
  if ((!reviewActive.value && !showLetterComparison.value) || proposalAlreadyApplied.value || showLetterComparison.value && selectedWorkingLetter.value) return '';
  try { checkedProposalResult(pane.value === 'cv'); return ''; }
  catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
});
const documentPreviewKey = computed(() => JSON.stringify([
  props.application.id, showCvReview.value, showLetterComparison.value, reviewComparison.value,
  selectedProposal.value?.id, includeProposedLetter.value,
]));
const currentCvState = computed(() => {
  // An editable current document must never replay an outdated selection over
  // manual changes, an approved CV, or a newer refinement round.
  if (!showCvReview.value) return record.value?.state || null;
  if (!temporaryReview.value.result) return null;
  if (cvChangeReviewError.value || cvApproved.value) return record.value?.state || null;
  return temporaryReview.value.result.state;
});
const previewCvState = computed(() => {
  if (showCvReview.value && reviewComparison.value === 'original' && temporaryReview.value.result) return selectedLocalRequest.value!.cv.baselineState;
  return currentCvState.value;
});
const cvEditorState = ref<CvState | null>(null);
let syncingCvEditor = false;
watch(() => refinementSignature(currentCvState.value || record.value?.state), () => {
  const current = currentCvState.value || record.value?.state;
  if (refinementSignature(cvEditorState.value) === refinementSignature(current)) return;
  syncingCvEditor = true;
  try { cvEditorState.value = current ? cloneCv(current) : null; }
  finally { syncingCvEditor = false; }
}, { immediate: true, flush: 'sync' });
watch(cvEditorState, state => {
  if (syncingCvEditor || !state || !record.value || cvApproved.value || busy.value
    || refinementSignature(state) === refinementSignature(currentCvState.value)) return;
  // FormBuilder publishes textarea changes on commit. Materialize the displayed
  // selection together with that edit locally, without publishing or approving.
  record.value = { ...record.value, state: cloneCv(state), revision: record.value.revision + 1, updatedAt: new Date().toISOString() };
  reviewComparison.value = 'proposed';
  reviewActive.value = false;
  persist();
}, { deep: true, flush: 'sync' });
async function selectComparison(value: 'original' | 'proposed') {
  if (await flushTextareas()) reviewComparison.value = value;
}
const previewLetterContent = computed(() => {
  if (!showLetterReview.value || comparingWorkingLetter.value) return letter.value?.working;
  if (!temporaryReview.value.result || !selectedLocalRequest.value?.letterBaseline) return undefined;
  const original = reviewComparison.value === 'original' || (!showLetterComparison.value && !includeProposedLetter.value);
  if (original && selectedLocalRequest.value.letterBaseline.content) return selectedLocalRequest.value.letterBaseline.content;
  return letterFromEditableText(original ? selectedLocalRequest.value.letterBaseline.text : temporaryReview.value.result.letterText);
});
// Proposal wording keeps its historical snapshot; sender details follow the
// current application header so removed fields cannot return in comparisons.
const previewLetterCvState = computed(() => {
  if (!showLetterReview.value || comparingWorkingLetter.value) return letterCvState.value;
  const snapshot = reviewComparison.value === 'proposed' ? temporaryReview.value.result?.state : selectedLocalRequest.value?.cv.baselineState;
  if (!snapshot) return null;
  return letterCvState.value ? applyLetterHeader(snapshot, captureLetterHeaderSource(selectedCvId.value, letterCvState.value)) : snapshot;
});
const previewLetterLanguage = computed(() => showLetterReview.value && !comparingWorkingLetter.value ? selectedLocalRequest.value?.letterBaseline?.setup.language || props.lang : letter.value?.language || props.lang);
const annotationProposals = computed(() => proposals.value.filter(proposal => requests.value.some(request => request.id === proposal.request_id
  && request.request_json.scope === pane.value && !isRequestReset(request.id) && matchesScope(request))));
const allAnnotations = computed(() => annotationProposals.value.flatMap(proposal => annotationViews(proposal, reviews.value))
  .filter(view => view.annotation.document === pane.value));
const proposalAnnotations = computed(() => retainedAnnotationViews(selectedProposal.value, annotationProposals.value, reviews.value,
  selectedRequest.value?.created_at || currentPublishedRequest.value?.created_at || selectedProposal.value?.created_at || '').map(view => {
  const currentLetter = record.value ? sanitizeRefinementText(serializeRefinementDraft(previewLetterContent.value).text, record.value.state) : '';
  const a = view.annotation;
  const source = requests.value.find(request => request.id === view.requestId);
  const proposal = proposals.value.find(proposal => proposal.id === view.proposalId);
  return { ...view,
    target: a.document === 'letter' ? text('Motivation letter', 'Motivationsschreiben') : 'CV' + (a.location ? ' · ' + (source?.request_json.cv.fields.find(field => field.id === a.location?.fieldId)?.label || a.location.fieldId) : ''),
    referenceChanged: annotationReferenceChanged(a, proposal?.proposal_json.letterText || '', currentLetter),
    included: view.status === 'resolved' && reviews.value.some(row => row.kind === 'feedback' && (row.payload.annotation as AnnotationReference | undefined)?.proposalId === view.proposalId && (row.payload.annotation as AnnotationReference).annotationId === a.id && (row.payload.annotation as AnnotationReference).reviewId === view.reviewId),
  };
}));
const currentAnnotations = computed(() => proposalAnnotations.value.filter(item => item.annotation.document === pane.value));
const reviewCounts = computed(() => ({
  changes: pane.value === 'cv' ? proposalChanges.value.length : 0,
  question: currentAnnotations.value.length + (pane.value === 'cv' ? proposalComments.value.length : 0),
}));
async function selectReviewTab(value: ReviewTab) {
  if (!await flushTextareas()) return false;
  reviewTab.value = value;
  return true;
}
function onReviewTabKeydown(event: KeyboardEvent, value: ReviewTab) {
  const index = reviewTabs.indexOf(value);
  const next = event.key === 'ArrowRight' ? reviewTabs[(index + 1) % reviewTabs.length]
    : event.key === 'ArrowLeft' ? reviewTabs[(index + reviewTabs.length - 1) % reviewTabs.length]
    : event.key === 'Home' ? reviewTabs[0] : event.key === 'End' ? reviewTabs.at(-1) : undefined;
  if (!next) return;
  event.preventDefault();
  const tabs = (event.currentTarget as HTMLElement).parentElement;
  void selectReviewTab(next).then(changed => { if (changed) tabs?.querySelector<HTMLButtonElement>(`[data-review-tab="${next}"]`)?.focus(); });
}
// The comparison stays available on return; only the acceptance transaction ends.
watch(tab, value => { if (value !== 'refinement') discardReview(); });
watch([cvApproved, letterApproved], ([cv, letter]) => {
  if (committingSelection) return;
  if (cv && !letter && feedbackScope.value !== 'letter') feedbackScope.value = 'letter';
  else if (letter && !cv && feedbackScope.value !== 'cv') feedbackScope.value = 'cv';
}, { immediate: true });
watch(tab, value => {
  try { sessionStorage.setItem(navigationKey, value); } catch { /* Navigation remains available. */ }
  emit('change-stage', value);
});
watch(tab, () => {
  if (mobileScrollContent.value) mobileScrollContent.value.scrollTop = 0;
}, { flush: 'post' });
watch([tab, stageNavigation, desktopSidebar, () => props.active, () => props.lang], () => {
  if (props.active && stageNavigation.value && window.matchMedia('(max-width: 760px)').matches) {
    stageNavigation.value?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}, { flush: 'post' });
async function flushTextareas(): Promise<boolean> {
  commitPendingTextareas();
  if (props.flushEvaluation && !await props.flushEvaluation()) return false;
  if (annotations.value && !await annotations.value.flush()) return false;
  persist();
  return !saveError.value;
}
defineExpose({ flushTextareas });
async function selectIterationNote(field: IterationNoteField): Promise<boolean> {
  if (!await flushTextareas()) return false;
  activeIterationNote.value = field;
  return true;
}
async function selectScope(event: Event) {
  const target = event.target as HTMLSelectElement;
  const scope = target.value as RefinementScope;
  if (await flushTextareas()) feedbackScope.value = scope;
  else target.value = feedbackScope.value;
}
async function selectStage(stage: Stage) {
  if (!await flushTextareas()) return;
  if (stage === tab.value) emit('change-stage', stage);
  else tab.value = stage;
}

function persist() {
  if (committingSelection) return;
  if (localReadError) { saveError.value = localReadError; return; }
  const previous = new Map<string, string | null>();
  try {
    const writes = new Map<string, string>();
    const stagedStore = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => { writes.set(key, value); }, removeItem() {} };
    if (record.value) saveApplicationCv(record.value, stagedStore);
    if (letter.value) createLetterRepository(stagedStore, props.userId).save(letter.value);
    writes.set(storageKey, JSON.stringify({ version: 1, privacyContexts: privacyContexts.value, approvals: approvals.value, savedVariant: savedVariant.value, requests: localRequests.value, cvSelections: cvSelections.value, parentProposalId: parentProposalId.value, parentProposalIds: parentProposalIds.value, scope: feedbackScope.value, selectedProposalIds: selectedProposalIds.value, resetRequestIds: resetRequestIds.value, resetRequestIdsByScope: resetRequestIdsByScope.value, resetCvStateSignature: resetCvStateSignature.value, iterationNotes: iterationNotes.value, iterationFeedbackSubmission: iterationFeedbackSubmission.value, pendingResetFeedback: pendingResetFeedback.value }));
    for (const [key, value] of writes) {
      const saved = localStorage.getItem(key);
      if (saved === value) continue;
      previous.set(key, saved); localStorage.setItem(key, value);
    }
    saveError.value = '';
  } catch (cause) {
    for (const [key, value] of previous) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Preserve the original save error and block acceptance/export. */ }
    }
    saveError.value = text('Local save failed: ', 'Lokales Speichern fehlgeschlagen: ') + String(cause);
  }
}
watch([record, letter, approvals, localRequests, parentProposalIds, privacyContexts, iterationNotes, iterationFeedbackSubmission, pendingResetFeedback, resetRequestIdsByScope, selectedProposalIds], persist, { deep: true, flush: 'sync' });
function selectScopeProposal(closePreview = true) {
  const relevant = (row: RefinementProposalRow) => !isRequestReset(row.request_id) && scopedRequests.value.some(request => request.id === row.request_id)
    && (row.request_id === currentRequestId.value || explicitHistorySelections.has(row.id));
  if (!proposals.value.some(row => row.id === selectedProposalId.value && relevant(row))) {
    selectedProposalId.value = proposals.value.find(row => row.request_id === currentRequestId.value && relevant(row))?.id || '';
  }
  if (closePreview) reviewActive.value = false;
}
watch(feedbackScope, () => { commitPendingTextareas(); reviewTab.value = pane.value === 'cv' ? 'changes' : 'question'; scopeWasChosen = true; if (!committingSelection) selectScopeProposal(); persist(); }, { flush: 'sync' });
watch(cvRevision, () => { if (approvals.value.cv && approvals.value.cv !== cvRevision.value) approvals.value.cv = null; });
watch(letterRevision, () => { if (approvals.value.letter && approvals.value.letter !== letterRevision.value) approvals.value.letter = null; });
function refreshLetterHeader() {
  if (!record.value || localReadError) return;
  const id = selectedCvId.value;
  if (!props.configurations.some(item => item.id === id)) return;
  try {
    const source = props.readVersion(id);
    if (!source) return;
    const header = captureLetterHeaderSource(id, source);
    if (refinementSignature(header) !== refinementSignature(record.value.letterHeaderSource)) record.value.letterHeaderSource = header;
  } catch (cause) { report(cause); }
}
watch(() => [selectedCvId.value, props.configurations.find(item => item.id === selectedCvId.value)?.mtime,
  props.configurations.some(item => item.id === selectedCvId.value)], refreshLetterHeader, { immediate: true, flush: 'post' });
function report(cause: unknown) {
  error.value = cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
    ? cause.message : typeof cause === 'string' ? cause : text('The operation could not be completed. Please try again.', 'Der Vorgang konnte nicht abgeschlossen werden. Bitte erneut versuchen.');
}
async function run(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await operation(); } catch (cause) { if (!disposed) report(cause); }
  finally { busy.value = false; }
}
async function refreshCloud() {
  if (!props.client) return;
  if (loadingCloud) return loadingCloud;
  loadingCloud = (async () => {
    refreshing.value = true;
    const initialSignature = baselineSignature.value;
    const initialDocumentSignatures = { cv: documentSignature('cv'), letter: documentSignature('letter') };
    const [state, nextRequests, nextProposals, nextReviews] = await Promise.all([
      repository.loadState(props.application.id), repository.listRequests(props.application.id), repository.listProposals(props.application.id), repository.listReviews(props.application.id),
    ]);
    if (disposed) return;
    // Validate target references before the review UI can describe or preview them.
    const requestById = new Map(nextRequests.map(row => [row.id, row]));
    const requestIds = new Set(requestById.keys());
    // Shared history can be cleared on another device. Do not resurrect its local snapshots.
    const remainingLocalRequests = Object.fromEntries(Object.entries(localRequests.value)
      .filter(([id, local]) => !local.publishedAt || requestIds.has(id))
      .map(([id, local]) => [id, requestById.has(id) && !local.publishedAt ? { ...local, publishedAt: requestById.get(id)!.created_at } : local]));
    for (const proposal of nextProposals) {
      const source = nextRequests.find(request => request.id === proposal.request_id);
      if (!source) throw new Error('The proposal source request is unavailable. Reload refinement history.');
      if (proposal.application_id !== props.application.id || proposal.user_id !== props.userId) throw new Error('The proposal belongs to another application or account.');
      parseRefinementProposal(proposal.proposal_json, source.request_json);
    }
    cloudState.value = state; requests.value = nextRequests; proposals.value = nextProposals;
    reviews.value = mergeReviews(nextReviews.filter(review => review.request_id === null || requestIds.has(review.request_id)));
    localRequests.value = remainingLocalRequests;
    for (const local of Object.values(localRequests.value)) {
      if (!local.baselineScope && local.request.scope !== 'both' && local.baselineSignature === initialSignature && initialSignature === baselineSignature.value) {
        local.baselineScope = local.request.scope; local.baselineSignature = initialDocumentSignatures[local.request.scope];
      }
    }
    resetRequestIds.value = resetRequestIds.value.filter(id => requestIds.has(id));
    for (const scope of ['cv', 'letter'] as const) {
      resetRequestIdsByScope.value[scope] = resetRequestIdsByScope.value[scope].filter(id => requestIds.has(id));
      const parent = nextProposals.find(item => item.id === parentProposalIds.value[scope]);
      if (!parent || isRequestReset(parent.request_id, scope) || !nextRequests.some(row => row.id === parent.request_id && row.request_json.scope === scope && matchesScope(row, scope))) parentProposalIds.value[scope] = null;
      const submission = iterationFeedbackSubmission.value[scope];
      const submittedDraft = submission?.draft;
      // Only a new, validated response to these notes consumes them. Preserve any
      // fields edited since submission, including while another scope is open.
      const answered = submission && submittedDraft && nextProposals.some(proposal => {
        const source = requestById.get(proposal.request_id)!;
        return !submittedDraft.knownProposalIds.includes(proposal.id) && !isRequestReset(source.id, scope)
          && matchesScope(source, scope) && source.request_json.feedback.some(feedback => feedback.id === submission.id);
      });
      if (answered && submittedDraft) {
        for (const field of iterationNoteFields) {
          if (iterationNotes.value[scope][field] === submittedDraft.notes[field]) iterationNotes.value[scope][field] = '';
        }
        iterationFeedbackSubmission.value[scope] = null;
      } else if (submission?.requestId && !nextRequests.some(row => row.id === submission.requestId && matchesScope(row, scope))) iterationFeedbackSubmission.value[scope] = null;
      const reset = pendingResetFeedback.value[scope];
      if (reset?.requestId && !nextRequests.some(row => row.id === reset.requestId && matchesScope(row, scope))) pendingResetFeedback.value[scope] = null;
    }
    if (selectedProposalId.value && !nextProposals.some(item => item.id === selectedProposalId.value)) reviewActive.value = false;
    if (state && initialSignature === baselineSignature.value) approvals.value = clone(state.approvals_json);
    if (!scopeWasChosen && currentPublishedRequest.value) {
      const scope = currentPublishedRequest.value.request_json.scope === 'letter' ? 'letter' : 'cv';
      if ((!cvApproved.value || scope === 'letter') && (!letterApproved.value || scope === 'cv')) feedbackScope.value = scope;
    }
    cloudLoaded.value = true;
    selectScopeProposal(false);
    persist();
  })();
  try { await loadingCloud; }
  finally { loadingCloud = null; refreshing.value = false; }
}
async function selectReviewProposal(id: string) {
  if (busy.value || !proposals.value.some(row => row.id === id) || !await flushTextareas()) return;
  explicitHistorySelections.add(id);
  tab.value = 'refinement'; selectedProposalId.value = id; openProposal();
}
async function checkProposals(navigate = true) { if (!await flushTextareas()) return; if (navigate) tab.value = 'refinement'; await run(async () => { await refreshCloud(); notice.value = proposals.value.length ? text('Proposals loaded. Review one before applying it.', 'Vorschläge geladen. Vor dem Übernehmen prüfen.') : text('No proposal yet. Run the copied prompt in ChatGPT, then check again.', 'Noch kein Vorschlag. Kopierten Prompt in ChatGPT ausführen und erneut prüfen.'); }); }
function refreshOnFocus() {
  refreshLetterHeader();
  if (busy.value || syncing.value || props.active === false) return;
  if (refreshSnapshotsOnOpen) { void syncRefinement(); return; }
  void flushTextareas().then(async saved => { if (!saved) return; await refreshCloud(); if (tab.value === 'refinement') await applyCurrentProposal(); }).catch(report);
}
watch(() => props.active, active => { if (active) void syncRefinement(true); });
watch(tab, stage => { if (stage === 'refinement') refreshOnFocus(); });
function reloadTemplates() { try { templates.value = letterRepository.listTemplates(); } catch (cause) { report(cause); } }
function reloadSearchTemplates() {
  try {
    const raw = localStorage.getItem(`cv.search-templates.v1:${encodeURIComponent(props.userId || 'local')}`);
    if (raw !== null) searchTemplates.value = searchRepository.listTemplates();
    else if (!sharedSearchHydrated) searchTemplates.value = [];
  } catch (cause) { report(cause); }
}
async function ensureSharedInterestsLoaded(force = false) {
  reloadSearchTemplates();
  const localKey = `cv.search-templates.v1:${encodeURIComponent(props.userId || 'local')}`;
  const localRaw = localStorage.getItem(localKey);
  const local = searchTemplates.value[0];
  // Local committed edits can be ahead of the server; never replace that draft.
  if (!props.client || localRaw !== null && (!force || !local || !isSearchTemplateSaved(local)) || sharedSearchHydrated && !force) return;
  if (!sharedSearchRead) {
    const owner = props.userId;
    const client = props.client;
    loadingSharedInterests.value = true;
    sharedSearchRead = (async () => {
      const rows = await listCloudSearchTemplates(client, owner);
      if (disposed || owner !== props.userId) return;
      if (localStorage.getItem(localKey) !== localRaw) { reloadSearchTemplates(); return; }
      const row = local?.cloud ? rows.find(item => item.id === local.cloud!.id) : rows.find(item => item.meta_search?.version === 1) || rows[0];
      searchTemplates.value = row ? [importCloudSearchTemplate(row)] : [];
      sharedSearchHydrated = true;
    })().finally(() => { sharedSearchRead = null; if (!disposed) loadingSharedInterests.value = false; });
  }
  await sharedSearchRead;
}
function markInitialLetterDraftInput() { initialLetterDraftEdited = true; }
function captureInitialSharedInterests(allowWorkingDraft = false) {
  if (!createdLetterOnOpen || !letter.value || letter.value.searchProfile || letter.value.templateSnapshot?.useMetaSearchInterests !== true
    || letterApproved.value || letter.value.finalRevisionId || !allowWorkingDraft && (initialLetterDraftEdited || !serializeRefinementDraft(letter.value.working).empty || !!letter.value.instructions.trim())
    || requests.value.some(row => matchesScope(row, 'letter'))) return;
  const snapshot = captureMetaSearchInterests(searchTemplates.value[0]);
  if (!snapshot) return;
  const next = { ...clone(letter.value), searchProfile: snapshot };
  if (!initialLetterDraftEdited && serializeRefinementDraft(next.working).empty && !next.instructions.trim()) next.workingContext = letterContextVersion(props.application, letterCvState.value, letterTemplateWithSearchProfile(next.templateSnapshot!, snapshot), next.language, next.instructions, next.maxWords, next.formatting);
  letter.value = next; persist(); createdLetterOnOpen = false;
}
onMounted(() => {
  if (!props.application.workflow_stage) emit('change-stage', tab.value);
  void syncRefinement(true);
  window.addEventListener('focus', refreshOnFocus);
  window.addEventListener('cv-letter-templates-updated', reloadTemplates);
  reloadSearchTemplates();
  window.addEventListener('cv-search-templates-updated', reloadSearchTemplates);
  window.addEventListener('focus', reloadSearchTemplates);
});
onBeforeUnmount(() => { disposed = true; window.removeEventListener('focus', refreshOnFocus); window.removeEventListener('cv-letter-templates-updated', reloadTemplates); window.removeEventListener('cv-search-templates-updated', reloadSearchTemplates); window.removeEventListener('focus', reloadSearchTemplates); });

async function publishCurrentCv() {
  if (!record.value) throw new Error(text('Select a CV template first.', 'Zuerst eine CV-Vorlage auswählen.'));
  persist(); if (saveError.value) throw new Error(saveError.value);
  if (published.value) return;
  const target = record.value; const state = cloneCv(target.state);
  const result = await props.publishCv(state);
  if (disposed || target !== record.value || cvDifferences(state, target.state).length) throw new Error('The CV changed while saving. Save preparation again.');
  if (!result) throw new Error(text('The anonymized CV could not be saved. Retry saving preparation.', 'Der anonymisierte CV konnte nicht gespeichert werden. Vorbereitung erneut speichern.'));
  target.publishedState = state; target.publishedSnapshotId = result.cv_variant_id; persist();
}
async function saveSetup() {
  if (!record.value || !letter.value) throw new Error(text('Select both templates first.', 'Zuerst beide Vorlagen auswählen.'));
  if (missingLetterTemplate.value) throw new Error(text('The original letter template is unavailable. Select a template in Preparation. Your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. In Vorbereitung eine Vorlage auswählen. Der bestehende Brief bleibt erhalten.'));
  if (!cloudLoaded.value) await refreshCloud();
  if (createdLetterOnOpen && selectedTemplate.value.useMetaSearchInterests === true && !letter.value.searchProfile) await ensureSharedInterestsLoaded();
  captureInitialSharedInterests(true);
  const signature = baselineSignature.value;
  await publishCurrentCv();
  const safeSetup = sanitizeRefinementSetup(setup.value, record.value.state);
  const currentApprovals = { cv: cvApproved.value ? cvRevision.value : null, letter: letterApproved.value ? letterRevision.value : null };
  if (cloudState.value && refinementSignature(cloudState.value.setup_json) === refinementSignature(safeSetup) && refinementSignature(cloudState.value.approvals_json) === refinementSignature(currentApprovals)) return;
  const saved = await repository.saveState(props.application.id, safeSetup, currentApprovals, cloudState.value?.revision || 0);
  if (disposed) return;
  cloudState.value = saved;
  if (signature !== baselineSignature.value) throw new Error('Documents changed while saving. Save preparation again.');
}
async function selectCv(id: string) {
  if (preparationBusy.value || cvSelectionLocked.value) return;
  const variant = preparationVariants.value.find(item => item.id === id); const state = variant && props.readVersion(id);
  if (!variant || !state) return;
  await run(async () => {
    await refreshCloud();
    if (disposed || cvSelectionLocked.value) return;
    record.value = createApplicationCv(props.userId, props.application.id, id, variant.name, state);
    record.value.variantId = id; record.value.detached = true;
    resetCvStateSignature.value = null;
    variantName.value = suggestedVariantName();
    approvals.value = { cv: null, letter: null }; persist();
    await publishCurrentCv(); if (letter.value) await saveSetup();
    notice.value = text('CV selected for this application.', 'CV für diese Bewerbung ausgewählt.');
  });
}
async function selectLetterTemplate(id: string) {
  if (preparationBusy.value || letterSelectionLocked.value) return;
  const template = templates.value.find(item => item.id === id);
  if (!template) return;
  await run(async () => {
    await refreshCloud();
    if (disposed || letterSelectionLocked.value) return;
    if (template.useMetaSearchInterests !== false) await ensureSharedInterestsLoaded(true);
    if (disposed || letterSelectionLocked.value) return;
    const snapshot = template.useMetaSearchInterests !== false ? captureMetaSearchInterests(searchTemplates.value[0]) : undefined;
    const selected = { ...template, useMetaSearchInterests: template.useMetaSearchInterests !== false };
    const effective = letterTemplateWithSearchProfile(selected, snapshot);
    const initialContext = letterContextVersion(props.application, letterCvState.value, effective, selected.language, '', selected.maxWords);
    const next = letter.value ? selectApplicationLetterTemplate(letter.value, selected)
      : createApplicationLetter(props.userId, props.application.id, selected, initialContext, selected.language);
    if (snapshot) next.searchProfile = snapshot; else delete next.searchProfile;
    letter.value = next;
    createdLetterOnOpen = false;
    approvals.value.letter = null; persist();
    if (record.value) await saveSetup();
    notice.value = text('Letter template selected for this application.', 'Briefvorlage für diese Bewerbung ausgewählt.');
  });
}
async function refreshSharedResearchInterests() {
  if (!letter.value || selectedTemplate.value.useMetaSearchInterests !== true || missingLetterTemplate.value || preparationBusy.value
    || letterSelectionLocked.value || letterApproved.value || reviewActive.value || !await flushTextareas()) return;
  await run(async () => {
    await refreshCloud();
    if (disposed || !letter.value || letterSelectionLocked.value || letterApproved.value || reviewActive.value) return;
    await ensureSharedInterestsLoaded(true);
    if (disposed || !letter.value || letterSelectionLocked.value || letterApproved.value) return;
    const snapshot = captureMetaSearchInterests(searchTemplates.value[0]);
    letterTemplateWithSearchProfile(selectedTemplate.value, snapshot);
    const next = { ...clone(letter.value), finalRevisionId: null, updatedAt: new Date().toISOString() };
    if (snapshot) next.searchProfile = snapshot; else delete next.searchProfile;
    letter.value = next; approvals.value.letter = null; createdLetterOnOpen = false; persist();
    if (saveError.value) throw new Error(saveError.value);
    notice.value = text('Shared research interests copied to this letter. Review the privacy preview before publishing sources.', 'Gemeinsame Forschungsinteressen für diesen Brief übernommen. Vor dem Veröffentlichen der Quellen die Datenschutzvorschau prüfen.');
  });
}
function updateLetter(value: string) { initialLetterDraftEdited = true; if (letter.value) letter.value = editLetter(letter.value, letterFromEditableText(value)); }
function updateLetterFormatting(formatting?: LetterFormatting) {
  if (!letter.value || letterApproved.value || busy.value || reviewActive.value) return;
  letter.value = formatLetter(letter.value, formatting);
}
function mergeReviews(...groups: RefinementReviewRow[][]): RefinementReviewRow[] {
  return [...new Map(groups.flat().map(row => [row.id, row])).values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
function feedbackHistory(): RefinementFeedback[] {
  return mergeReviews(reviews.value).filter(item => item.kind === 'feedback' && item.payload.scope === pane.value && !item.cleared_scopes?.includes(pane.value)
    && (!item.request_id || requests.value.some(request => request.id === item.request_id && request.request_json.scope === pane.value))).map(item => {
    const annotation = item.payload.annotation as AnnotationReference | undefined;
    return { id: item.id, text: String(item.payload.text), scope: item.payload.scope as RefinementScope, createdAt: item.created_at,
      ...(annotation ? { annotation: clone(annotation) } : {}) };
  });
}
async function saveAnnotation(id: string, status: AnnotationStatus, response: string, previousReviewId: string | null, proposalId = selectedProposalId.value): Promise<boolean> {
  let saved = false;
  await run(async () => {
    const view = proposalAnnotations.value.find(item => item.annotation.id === id && item.proposalId === proposalId);
    if (legacyReview.value || view && requests.value.find(row => row.id === view.requestId)?.request_json.scope === 'both') throw new Error('Combined refinement is read-only history. Publish a separate request.');
    if (!view || !record.value) throw new Error('Restore the local CV before saving an anonymized response.');
    const safeResponse = response.trim() ? sanitizeRefinementText(response.trim(), record.value.state) : null;
    const payload = { proposalId: view.proposalId, annotationId: id, status, response: safeResponse, previousReviewId };
    validateAnnotationReview(payload);
    if (view.reviewId !== previousReviewId) throw new Error('Annotation changed elsewhere; reload the saved annotation.');
    // A retry after feedback failed must reuse the saved response and its exact reference.
    if (view.status !== status || view.response !== safeResponse) {
      const row = await repository.saveReview(props.application.id, view.requestId, 'annotation', payload);
      if (disposed) return;
      if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
    }
    await includeAnnotationFeedback(id, proposalId);
    if (disposed) return;
    saved = true;
    notice.value = status === 'resolved' && safeResponse
      ? text('Response saved and included as feedback.', 'Antwort gespeichert und als Feedback übernommen.')
      : status === 'ignored' ? text('Comment ignored. It will be ignored in future refinement.', 'Kommentar verworfen. Er wird bei künftigen Überarbeitungen ignoriert.')
      : text('Comment saved.', 'Kommentar gespeichert.');
  });
  return saved;
}
async function includeAnnotationFeedback(id: string, proposalId = selectedProposalId.value) {
  const view = allAnnotations.value.find(item => item.annotation.id === id && item.proposalId === proposalId);
  if (!view || !record.value) return;
  const annotation = { proposalId: view.proposalId, annotationId: id, reviewId: view.reviewId };
  const prefix = `Annotation: ${view.proposalId}/${id}`;
  const previouslyIncluded = reviews.value.some(row => row.kind === 'feedback' &&
    ((row.payload.annotation as AnnotationReference | undefined)?.proposalId === view.proposalId && (row.payload.annotation as AnnotationReference).annotationId === id
      || String(row.payload.text).startsWith(prefix)));
  const resolved = view.status === 'resolved' && !!view.response;
  const pending = view.status === 'open';
  if (!pending && !resolved && !previouslyIncluded) return;
  const safeText = sanitizeRefinementText(annotationFeedback(view), record.value.state);
  const hash = refinementSignature([pending ? 'annotation-pending' : 'annotation-feedback', props.application.id, annotation]).slice(3, 35);
  const reviewId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
  if (reviews.value.some(row => row.id === reviewId)) return;
  // Review history is immutable. A cancellation supersedes the older answer;
  // it does not send that answer again or rewrite an already published request.
  const row = await repository.saveReview(props.application.id, view.requestId, 'feedback', {
    text: safeText, scope: view.annotation.document, ...(pending || resolved ? { annotation } : {}),
  }, reviewId);
  if (disposed) return;
  if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
}
async function copyShortInstruction() {
  shortInstructionNotice.value = ''; shortInstructionError.value = '';
  const value = shortInstruction.value;
  try {
    await navigator.clipboard.writeText(value);
    if (shortInstruction.value === value) shortInstructionNotice.value = text('ChatGPT instruction copied.', 'ChatGPT-Anweisung kopiert.');
  } catch {
    if (shortInstruction.value === value) shortInstructionError.value = text('Copy unavailable. Select and copy the instruction below.', 'Kopieren nicht verfügbar. Die Anweisung unten markieren und kopieren.');
  }
}
function refinementProjectId(required = true) {
  const projectId = props.projectId || (supabaseConfiguration.status === 'ready' ? new URL(supabaseConfiguration.url).hostname.split('.')[0]! : '');
  if (required && !projectId) throw new Error('The Supabase project configuration is unavailable.');
  return projectId;
}
async function createRound(scope: RefinementScope) {
  if (reviewActive.value) throw new Error('Accept or close the temporary review before publishing working documents.');
  scopeWasChosen = true;
  await refreshCloud();
  if (createdLetterOnOpen && selectedTemplate.value.useMetaSearchInterests === true && !letter.value?.searchProfile) await ensureSharedInterestsLoaded();
  captureInitialSharedInterests(true);
  await savePendingResetFeedback(scope);
  if (!record.value || !letter.value) throw new Error('Select CV and letter templates first.');
  if (saveError.value) throw new Error(saveError.value);
  if (cvApproved.value && scope !== 'letter' || letterApproved.value && scope !== 'cv') throw new Error(text('Reopen the approved document before requesting changes to it.', 'Das freigegebene Dokument vor weiteren Änderungen wieder öffnen.'));
  if (!preparedSource.value) throw new Error(sourceError.value || text('Select both templates in Preparation first.', 'Zuerst beide Vorlagen in Vorbereitung auswählen.'));
  // Reconcile pending questions and later closures before freezing the request,
  // including status saves from another device whose feedback step failed.
  // Failed or partial writes are retried with deterministic IDs.
  for (const view of allAnnotations.value) {
    await includeAnnotationFeedback(view.annotation.id, view.proposalId);
    if (disposed) return;
  }
  // Reuse the current immutable receipt without writing state, changing timestamps,
  // or creating another request. Old receipts cannot be reactivated by retrying them.
  const current = currentPublishedRequest.value;
  if (current && publicationStatus.value === 'current') {
    return;
  }
  await saveSetup(); await refreshCloud();
  const candidate = preparedSource.value;
  if (!candidate || candidate.request.scope !== scope) throw new Error(sourceError.value || 'Sources changed while preparing. Review them and publish again.');
  // Retry a failed publication with the same UUID. Reverting document contents
  // must not select an older published request.
  const pending = Object.values(localRequests.value).find(item => !item.publishedAt && !requests.value.some(row => row.id === item.request.requestId) && sameRefinementInputs(item, candidate));
  const local = pending || candidate;
  localRequests.value = { ...localRequests.value, [local.request.requestId]: clone(local) }; persist();
  if (saveError.value) throw new Error(saveError.value);
  const saved = await repository.publishRequest(local.request);
  if (disposed) return;
  if (!requests.value.some(item => item.id === saved.id)) requests.value.unshift(saved);
  localRequests.value[saved.id]!.publishedAt = saved.created_at;
  cloudState.value = await repository.loadState(props.application.id);
  if (disposed) return;
  if (!preparedSource.value || !sameRefinementInputs(local, preparedSource.value)) throw new Error('Sources changed while publishing. Review them and publish a new round.');
  if (currentRequestId.value !== saved.id) throw new Error('A different request is current. Check for updates before publishing again.');
  notice.value = text('Sources published. Copy the task to continue in ChatGPT.', 'Quellen veröffentlicht. Die Aufgabe kopieren, um in ChatGPT fortzufahren.');
}
async function publishSources(loadProposals = false) {
  if (!await flushTextareas()) return;
  await run(async () => {
    await createRound(feedbackScope.value);
    if (loadProposals) await refreshCloud();
  });
}
async function applyPendingCvSelection(local: LocalRefinementRequest) {
  const pending = local.pendingCvSelection;
  if (!pending || pending.applied) return;
  const row = proposals.value.find(item => item.id === pending.proposalId && item.request_id === pending.requestId);
  const parent = localRequests.value[pending.requestId];
  const parentSource = requests.value.find(item => item.id === pending.requestId);
  if (!row || !parent || !parentSource || refinementSignature(parentSource.request_json) !== refinementSignature(parent.request)
    || local.request.parentProposalId !== row.id || local.request.scope !== 'cv') throw new Error('The previous CV selection is unavailable. Restore its original snapshot before continuing.');
  validateLocalRefinementSource(local, props.application.id);
  const result = reconstructRefinementProposal(parent, row.proposal_json, pending.selectedIds, props.application.id);
  if (refinementSignature(result.state) !== refinementSignature(local.cv.baselineState)) throw new Error('The saved CV selection does not match the next refinement source.');
  const checkCurrent = () => {
    if (!record.value || cvApproved.value || pending.workingRevision !== cvRevision.value
      || local.cv.sourceVariantId !== (record.value.variantId || record.value.baseId)
      || currentRequestId.value !== local.request.requestId) throw new Error(text('The CV changed while waiting for this refinement. Your edits were kept; create a new round from the current CV.', 'Der CV wurde während dieser Überarbeitung geändert. Ihre Änderungen bleiben erhalten; starten Sie eine neue Runde mit dem aktuellen CV.'));
  };
  checkCurrent();
  const previousRecord = record.value!, previousSelection = parent.appliedCvSelection, previousParent = parentProposalIds.value.cv;
  const nextRecord = clone(previousRecord);
  if (refinementSignature(nextRecord.state) !== refinementSignature(result.state)) {
    nextRecord.state = cloneCv(result.state); nextRecord.revision++; nextRecord.updatedAt = new Date().toISOString();
  }
  committingSelection = true;
  try {
    record.value = nextRecord;
    parent.appliedCvSelection = { proposalId: row.id, selectedIds: [...pending.selectedIds], nextRequestId: local.request.requestId };
    parentProposalIds.value.cv = row.id;
    pending.applied = true;
  } finally { committingSelection = false; }
  persist();
  if (saveError.value) {
    committingSelection = true;
    try { record.value = previousRecord; parent.appliedCvSelection = previousSelection; parentProposalIds.value.cv = previousParent; delete pending.applied; }
    finally { committingSelection = false; }
    throw new Error(saveError.value);
  }
}
async function applyCurrentProposal(id?: string) {
  if (busy.value || disposed || !record.value || !letter.value || scopeLocked.value) return;
  const currentId = currentRequestId.value;
  if (!currentId || isRequestReset(currentId) || !currentPublishedRequest.value || !matchesScope(currentPublishedRequest.value)) return;
  const local = localRequests.value[currentId];
  if (!local) return;
  const candidate = id ? proposals.value.find(row => row.id === id && row.request_id === currentId)
    : proposals.value.find(row => row.request_id === currentId);
  if (!candidate || requests.value.find(row => row.id === currentId)?.request_json.scope !== feedbackScope.value) return;
  if (selectedProposalId.value !== candidate.id && !await flushTextareas()) return;
  if (local.request.scope === 'cv') {
    try { reconstructRefinementProposal(local, candidate.proposal_json, undefined, props.application.id); }
    catch (cause) { report(cause); return; }
    await run(async () => { await applyPendingCvSelection(local); });
    if (error.value || disposed) return;
    selectedProposalId.value = candidate.id;
    reviewActive.value = tab.value === 'refinement' && !cvChangeReviewError.value;
    return;
  }
  if (local.acceptances?.some(receipt => receipt.proposalId === candidate.id)) return;
  // A return for an older working version must never overwrite manual corrections.
  if (local.baselineSignature !== currentSourceSignature(local)) {
    if (!id) reviewActive.value = false;
    return;
  }
  try { reconstructRefinementProposal(local, candidate.proposal_json, undefined, props.application.id); }
  catch (cause) { report(cause); return; }
  selectedProposalId.value = candidate.id;
  selectedChangeIds.value = [];
  for (const change of proposalChanges.value) toggleProposedChange(change.id, true);
  toggleProposedLetter(feedbackScope.value !== 'cv');
  // Background sync can accept from Preparation too, where the passive letter
  // comparison is not mounted. Keep that transaction separate from its UI lock.
  reviewActive.value = true;
  try { await acceptSelectedChanges(); }
  finally { if (pane.value === 'letter') reviewActive.value = false; }
  if (!error.value) notice.value = text('Proposal loaded and applied to the working document.', 'Vorschlag geladen und in die Arbeitsfassung übernommen.');
}
function refreshUnrefinedSnapshots(opening: { cv: string; letter: string }) {
  if (!cloudLoaded.value || localReadError || saveError.value) return;
  const refined = (scope: DocumentScope) => requests.value.some(request => matchesScope(request, scope)
    && (proposals.value.some(proposal => proposal.request_id === request.id) || resetRequestIdsByScope.value[scope].includes(request.id)));
  let nextRecord = record.value, nextLetter = letter.value;
  const sourceId = selectedCvId.value;
  const variant = props.configurations.find(item => item.id === sourceId);
  if (nextRecord && variant && !cvApproved.value && !refined('cv') && opening.cv === documentSignature('cv')
    && (!cvDifferences(nextRecord.baseState, nextRecord.state).length || resetCvStateSignature.value === refinementSignature(nextRecord.state))) {
    const source = props.readVersion(sourceId);
    if (source && cvDifferences(nextRecord.baseState, source).length) {
      nextRecord = { ...clone(nextRecord), baseId: sourceId, baseName: variant.name,
        baseState: cloneCv(source), state: cloneCv(source), baseRevision: nextRecord.baseRevision + 1,
        revision: nextRecord.revision + 1, updatedAt: new Date().toISOString(),
        publishedState: null, publishedSnapshotId: null, letterHeaderSource: captureLetterHeaderSource(sourceId, source) };
    }
  }
  const latestTemplates = letterRepository.listTemplates();
  let template = latestTemplates.find(item => item.id === nextLetter?.templateId);
  // A new library default must not silently link a frozen, older application.
  if (template && nextLetter?.templateSnapshot && template.useMetaSearchInterests !== nextLetter.templateSnapshot.useMetaSearchInterests) {
    template = { ...template };
    if (nextLetter.templateSnapshot.useMetaSearchInterests === undefined) delete template.useMetaSearchInterests;
    else template.useMetaSearchInterests = nextLetter.templateSnapshot.useMetaSearchInterests;
  }
  if (nextLetter && template && !letterApproved.value && !nextLetter.finalRevisionId && !refined('letter')
    && opening.letter === documentSignature('letter') && serializeRefinementDraft(nextLetter.working).empty
    && refinementSignature(template) !== refinementSignature(nextLetter.templateSnapshot)) {
    const previousTemplate = nextLetter.templateSnapshot;
    const language = previousTemplate && nextLetter.language !== previousTemplate.language ? nextLetter.language : template.language;
    const maxWords = previousTemplate && nextLetter.maxWords !== previousTemplate.maxWords ? nextLetter.maxWords : template.maxWords;
    nextLetter = { ...selectApplicationLetterTemplate(nextLetter, template), language, maxWords };
    const cv = nextRecord ? resolveApplicationLetterState(nextRecord.state, nextRecord.baseState, nextRecord.letterHeaderSource) : null;
    nextLetter.workingContext = letterContextVersion(props.application, cv, letterTemplateWithSearchProfile(template, nextLetter.searchProfile), language, nextLetter.instructions, maxWords, nextLetter.formatting);
  }
  templates.value = latestTemplates;
  if (nextRecord === record.value && nextLetter === letter.value) return;
  const previous = { record: record.value, letter: letter.value, approvals: approvals.value, resetCvStateSignature: resetCvStateSignature.value };
  committingSelection = true;
  try {
    record.value = nextRecord; letter.value = nextLetter;
    approvals.value = { cv: nextRecord !== previous.record ? null : approvals.value.cv,
      letter: nextLetter !== previous.letter ? null : approvals.value.letter };
    if (nextRecord !== previous.record) resetCvStateSignature.value = null;
  } finally { committingSelection = false; }
  persist();
  if (saveError.value) {
    committingSelection = true;
    try {
      record.value = previous.record; letter.value = previous.letter; approvals.value = previous.approvals;
      resetCvStateSignature.value = previous.resetCvStateSignature;
    } finally { committingSelection = false; }
    throw new Error(saveError.value);
  }
}
async function syncRefinement(refreshSnapshots = false) {
  if (refreshSnapshots) refreshSnapshotsOnOpen = true;
  const stopped = () => disposed || props.active === false;
  if (stopped() || !props.client || busy.value || syncing.value) return;
  refreshLetterHeader();
  syncing.value = true;
  try {
    const refreshOpeningSnapshots = refreshSnapshotsOnOpen;
    if (refreshOpeningSnapshots && !await flushTextareas()) return;
    const opening = { cv: documentSignature('cv'), letter: documentSignature('letter') };
    // Sync also runs on application load and must preserve the selected workflow stage.
    await checkProposals(false);
    if (stopped() || error.value) return;
    if (createdLetterOnOpen && selectedTemplate.value.useMetaSearchInterests === true && !letter.value?.searchProfile) {
      // Metadata is a background read; it must not prevent choosing an opt-out
      // template while the required proposal/approval history is already loaded.
      void ensureSharedInterestsLoaded().then(() => { if (!stopped()) captureInitialSharedInterests(); })
        .catch(cause => { if (!stopped() && createdLetterOnOpen && selectedTemplate.value.useMetaSearchInterests === true) report(cause); });
    }
    if (refreshOpeningSnapshots) {
      // Publish drafts typed during the history fetch before checking eligibility.
      if (!await flushTextareas() || stopped()) return;
      refreshUnrefinedSnapshots(opening);
      refreshSnapshotsOnOpen = false;
    }
    await applyCurrentProposal();
    if (stopped() || error.value) return;
    const currentCvProposal = currentPublishedRequest.value?.request_json.scope === 'cv' && pane.value === 'cv'
      && proposals.value.some(row => row.request_id === currentRequestId.value);
    if (!reviewActive.value && !currentCvProposal && preparedSource.value && !scopeLocked.value) {
      const current = currentPublishedRequest.value;
      const appliedCurrent = !!parentProposalId.value && proposals.value.some(row => row.id === parentProposalId.value && row.request_id === current?.id);
      if (current && isRequestReset(current.id)) await run(saveSetup);
      else if (!current || current.request_json.scope !== feedbackScope.value || publicationStatus.value !== 'current' && !appliedCurrent) await publishSources(true);
      else await run(saveSetup);
      if (stopped() || error.value) return;
      await applyCurrentProposal();
      if (stopped() || error.value) return;
    }
    notice.value = proposals.value.length || !preparedSource.value || scopeLocked.value
      ? text('Synced. Available proposals are up to date.', 'Synchronisiert. Verfügbare Vorschläge sind aktuell.')
      : text('Snapshot synced. Copy the task to create the initial draft.', 'Snapshot synchronisiert. Aufgabe kopieren, um den ersten Entwurf zu erstellen.');
  } catch (cause) { if (!stopped()) report(cause); }
  finally { syncing.value = false; }
}
async function copyIterationTask() {
  if (busy.value || refreshing.value || scopeLocked.value) return;
  shortInstructionNotice.value = ''; shortInstructionError.value = '';
  const result = await copyPreparedText(async () => {
    if (!await flushTextareas() || busy.value || refreshing.value || scopeLocked.value) return null;
    // The CV selection becomes a frozen request source, not a working-document commit.
    reviewActive.value = false;
    const scope = pane.value, requestedScope = feedbackScope.value;
    let instruction: string | null = null;
    await run(async () => {
      await refreshCloud();
      const draft = clone(iterationNotes.value[scope]);
      await savePendingResetFeedback(requestedScope);
      await submitIterationFeedback(scope, draft);
      await createRound(requestedScope);
      if (disposed) return;
      persist();
      if (saveError.value) throw new Error(saveError.value);
      refinementProjectId();
      requestToCopy();
      instruction = shortInstruction.value;
    });
    return disposed || error.value ? null : instruction;
  });
  if (!result || disposed || shortInstruction.value !== result.value) return;
  if (result.copied) shortInstructionNotice.value = text('ChatGPT instruction copied.', 'ChatGPT-Anweisung kopiert.');
  else shortInstructionError.value = text('Copy unavailable. Select and copy the instruction below.', 'Kopieren nicht verfügbar. Die Anweisung unten markieren und kopieren.');
}
async function savePendingResetFeedback(scope: RefinementScope) {
  for (const document of [scope]) {
    const pending = pendingResetFeedback.value[document];
    if (!pending) continue;
    const saved = await repository.saveReview(props.application.id, pending.requestId, 'feedback', { text: pending.text, scope: document }, pending.id);
    if (disposed) return;
    reviews.value = mergeReviews(reviews.value, [saved]);
    if (pendingResetFeedback.value[document]?.id === pending.id) pendingResetFeedback.value[document] = null;
    persist();
    if (saveError.value) throw new Error(saveError.value);
  }
}
async function submitIterationFeedback(scope: DocumentScope, draft: IterationNotes) {
  const fields = ['tone', 'structure', 'content'] as const;
  if (scope === 'cv' ? fields.map(field => draft[field]).filter(value => value.trim()).join('\n\n').length > 12000 : fields.some(field => draft[field].length > 4000)) throw new Error(scope === 'cv' ? text('Keep the CV request within 12,000 characters.', 'Den CV-Überarbeitungswunsch auf 12.000 Zeichen begrenzen.') : text('Keep each refinement request within 4,000 characters.', 'Jeden Überarbeitungswunsch auf 4.000 Zeichen begrenzen.'));
  const sections = fields.filter(field => draft[field].trim()).map(field => scope === 'cv' ? draft[field].trim() : `${field[0]!.toUpperCase()}${field.slice(1)}:\n${draft[field].trim()}`);
  if (!sections.length) return;
  if (!record.value) throw new Error('Restore the local CV before sharing refinement requests.');
  const safeText = sanitizeRefinementText(sections.join('\n\n'), record.value.state);
  let submission = iterationFeedbackSubmission.value[scope];
  if (!submission || submission.text !== safeText) {
    submission = { id: crypto.randomUUID(), text: safeText, requestId: scopedRequests.value.find(row => row.request_json.scope === scope)?.id || null };
  }
  submission.draft = { notes: clone(draft), knownProposalIds: submission.draft?.knownProposalIds ?? proposals.value.map(proposal => proposal.id) };
  iterationFeedbackSubmission.value[scope] = submission;
  persist();
  if (saveError.value) throw new Error(saveError.value);
  if (reviews.value.some(row => row.id === submission!.id)) return;
  const saved = await repository.saveReview(props.application.id, submission.requestId, 'feedback', { text: submission.text, scope }, submission.id);
  if (!disposed) reviews.value = mergeReviews(reviews.value, [saved]);
}
function requestToCopy() {
  if (!currentPublishedRequest.value || publicationStatus.value !== 'current') throw new Error(text('Publish the current sources before copying the task.', 'Die aktuellen Quellen vor dem Kopieren der Aufgabe veröffentlichen.'));
  return currentPublishedRequest.value;
}
async function copyTask() { await run(async () => {
  refinementProjectId();
  requestToCopy();
  await copyShortInstruction();
}); }
function checkedProposalResult(cvSelectionOnly = false) {
  if (!record.value || !letter.value || !selectedProposal.value) throw new Error('Select a proposal and restore its local source documents first.');
  if (saveError.value) throw new Error(saveError.value);
  const row = selectedProposal.value;
  if (selectedRequest.value?.request_json.scope !== feedbackScope.value) throw new Error(text('Publish a separate request for the selected document before accepting changes.', 'Vor der Übernahme eine eigene Anfrage für das ausgewählte Dokument veröffentlichen.'));
  if (currentRequestId.value !== row.request_id) throw new Error(text('This proposal belongs to a superseded round. Review the proposal for the current round or create a new round.', 'Dieser Vorschlag gehört zu einer überholten Runde. Den Vorschlag der aktuellen Runde prüfen oder eine neue Runde erstellen.'));
  const local = localRequests.value[row.request_id];
  if (!local) throw new Error(text('This device is missing the original private snapshot. Restore your documents if needed, then create a new round.', 'Der ursprüngliche private Snapshot fehlt auf diesem Gerät. Dokumente bei Bedarf wiederherstellen und eine neue Runde erstellen.'));
  const request = selectedRequest.value;
  if (row.application_id !== props.application.id || row.user_id !== props.userId || local.request.applicationId !== props.application.id
    || row.request_id !== local.request.requestId || row.proposal_json.requestId !== row.request_id || !request
    || request.application_id !== props.application.id || request.user_id !== props.userId
    || refinementSignature(request.request_json) !== refinementSignature(local.request)) throw new Error('The proposal, request and local application references do not match. Restore the original local sources.');
  if (local.request.scope === 'cv' && local.cv.sourceVariantId !== (record.value.variantId || record.value.baseId)) throw new Error('The source CV variant changed after publication. This proposal is outdated; publish a new round.');
  if (cvApproved.value && (cvSelectionOnly || selectedChangeIds.value.length) || !cvSelectionOnly && letterApproved.value && includeProposedLetter.value && row.proposal_json.letterText !== local.request.letter.text) throw new Error('Reopen the approved document before applying changes.');
  if (!cvSelectionOnly && local.request.scope !== 'cv' && includeProposedLetter.value && letter.value.finalRevisionId) throw new Error('Reopen the finalized letter before accepting a proposed draft. The finalized letter has been preserved.');
  if (cvSelectionOnly && local.request.scope !== 'letter') {
    const receipt = local.acceptances?.at(-1);
    if (receipt) {
      const decision = reviews.value.find(review => review.id === receipt.reviewId && review.kind === 'cv_decisions' && review.payload.proposalId === row.id);
      if (receipt.proposalId !== row.id || parentProposalIds.value.cv !== row.id || !decision || !Array.isArray(decision.payload.accepted)) throw new Error(text('Review the latest applied CV proposal before changing its selection.', 'Prüfen Sie den zuletzt übernommenen CV-Vorschlag, bevor Sie seine Auswahl ändern.'));
      const previous = reconstructRefinementProposal(local, row.proposal_json, decision.payload.accepted as string[], props.application.id);
      if (refinementSignature(previous.state) !== refinementSignature(record.value.state) || decision.payload.revision !== cvRevision.value) throw new Error(text('The CV changed after this proposal was applied. Create a new refinement to preserve your edits.', 'Der CV wurde nach der Übernahme dieses Vorschlags geändert. Starten Sie eine neue Überarbeitung, um Ihre Änderungen zu bewahren.'));
      return reconstructRefinementProposal(local, row.proposal_json, selectedChangeIds.value, props.application.id);
    }
  }
  return applyRefinementProposal(local, row.proposal_json, record.value.state, currentSourceSignature(local), selectedChangeIds.value);
}
function openProposal() {
  try {
    error.value = ''; notice.value = '';
    reviewComparison.value = 'proposed'; reviewActive.value = pane.value !== 'letter';
    if (temporaryReview.value.error) throw new Error(temporaryReview.value.error);
    notice.value = pane.value === 'cv'
      ? text('Showing the current CV with active changes and its previous snapshot.', 'Aktueller CV mit aktiven Änderungen und vorherigem Snapshot angezeigt.')
      : text('Temporary review only. Saved documents and approvals remain unchanged until you accept the selection.', 'Nur temporäre Prüfung. Gespeicherte Dokumente und Freigaben bleiben bis zur Übernahme unverändert.');
  } catch (cause) { report(cause); }
}
function toggleProposedChange(id: string, included: boolean) {
  if (busy.value || cvApproved.value) return;
  if (!proposalChanges.value.some(change => change.id === id)) return;
  selectedChangeIds.value = included ? [...new Set([...selectedChangeIds.value, id])] : selectedChangeIds.value.filter(value => value !== id);
  reviewComparison.value = 'proposed'; reviewActive.value = true;
}
async function setCvChangeActive(id: string, included: boolean) {
  if (!await flushTextareas() || busy.value || refreshing.value || syncing.value || pane.value !== 'cv') return;
  if (cvChangeReviewError.value) { error.value = cvChangeReviewError.value; return; }
  if (!proposalChanges.value.some(change => change.id === id) || selectedChangeIds.value.includes(id) === included) return;
  const previousSelection = [...selectedChangeIds.value], previousSaved = cvSelections.value[selectedProposalId.value], wasReviewing = reviewActive.value;
  toggleProposedChange(id, included);
  cvSelections.value[selectedProposalId.value] = [...selectedChangeIds.value];
  error.value = ''; persist();
  if (saveError.value) {
    if (previousSaved) cvSelections.value[selectedProposalId.value] = previousSaved;
    else delete cvSelections.value[selectedProposalId.value];
    selectedChangeIds.value = previousSelection;
    reviewActive.value = wasReviewing;
    error.value = saveError.value;
  }
}
function toggleProposedLetter(included: boolean) {
  if (busy.value || letterApproved.value || proposalAlreadyApplied.value) return;
  includeProposedLetter.value = included; reviewComparison.value = 'proposed'; reviewActive.value = pane.value !== 'letter';
}
function discardReview() { reviewActive.value = false; }
async function acceptSelectedChanges() {
  if (!await flushTextareas()) return;
  await run(async () => {
    if ((!reviewActive.value && !showLetterComparison.value) || proposalAlreadyApplied.value) throw new Error('Preview the selection before accepting it.');
    const result = checkedProposalResult(pane.value === 'cv');
    const row = selectedProposal.value!, local = localRequests.value[row.request_id]!;
    const signature = currentSourceSignature(local);
    const selected = [...selectedChangeIds.value], includeLetter = includeProposedLetter.value;
    const key = selectionKey(row, selected, includeLetter);
    // Construct and validate both documents before any local document write.
    if (!temporaryReview.value.result || refinementSignature(temporaryReview.value.result) !== refinementSignature(result)) throw new Error('The proposal preview changed. Review the current selection before accepting.');
    const nextRecord = clone(record.value!);
    const cvChanged = local.request.scope === 'cv' && refinementSignature(result.state) !== refinementSignature(nextRecord.state);
    if (cvChanged) {
      nextRecord.state = cloneCv(result.state);
      nextRecord.revision++; nextRecord.updatedAt = new Date().toISOString();
    }
    let nextLetter = clone(letter.value!);
    if (local.request.scope === 'letter' && includeLetter && !letterApproved.value) {
      const candidateContext = letterContextVersion(props.application, resolveApplicationLetterState(nextRecord.state, nextRecord.baseState, nextRecord.letterHeaderSource), effectiveLetterTemplate.value, setup.value.language, nextLetter.instructions, setup.value.maxWords, nextLetter.formatting);
      const incoming = addIncomingDraft(nextLetter, letterFromEditableText(result.letterText), candidateContext, { cloudDraftId: row.id, cloudContextId: row.request_id });
      const revision = incoming.revisions.find(item => item.cloudDraftId === row.id)!;
      if (refinementSignature(revision.content) !== refinementSignature(letterFromEditableText(result.letterText))) throw new Error('The saved incoming letter does not match this proposal. Restore its original local history before accepting.');
      nextLetter = openLetterRevision(incoming, revision.id);
    }
    const payload = { proposalId: row.id, accepted: selected, rejected: proposalChanges.value.filter(change => !selected.includes(change.id)).map(change => change.id), revision: refinementSignature([result.state, props.application.context_json]) };
    const decision = await repository.saveReview(props.application.id, row.request_id, 'cv_decisions', payload);
    if (disposed) return;
    if (!reviews.value.some(item => item.id === decision.id)) reviews.value.push(decision);
    if (signature !== currentSourceSignature(local) || selectionKey(row) !== key || selectedProposal.value?.id !== row.id) throw new Error('The working documents or selection changed while saving your decision. They were preserved. Review the proposal again.');
    checkedProposalResult(pane.value === 'cv');
    // The recorded decision does not grant document approval; review the saved result separately.
    const previousRecord = record.value, previousLetter = letter.value, previousParent = parentProposalId.value;
    const previousAcceptances = local.acceptances;
    const previousSelection = cvSelections.value[row.id];
    committingSelection = true;
    try {
      if (local.request.scope === 'cv') { record.value = nextRecord; cvSelections.value[row.id] = selected; }
      if (local.request.scope === 'letter') letter.value = nextLetter;
      local.acceptances = [...(local.acceptances || []), { key, proposalId: row.id, variantId: null, reviewId: decision.id, acceptedAt: new Date().toISOString() }];
      parentProposalId.value = row.id;
      reviewActive.value = false;
    } finally { committingSelection = false; }
    persist();
    if (saveError.value) {
      committingSelection = true;
      try {
        if (local.request.scope === 'cv') {
          record.value = previousRecord;
          if (previousSelection) cvSelections.value[row.id] = previousSelection;
          else delete cvSelections.value[row.id];
        }
        if (local.request.scope === 'letter') letter.value = previousLetter;
        parentProposalId.value = previousParent;
        local.acceptances = previousAcceptances; reviewActive.value = pane.value !== 'letter';
      } finally { committingSelection = false; }
      throw new Error(saveError.value);
    }
    notice.value = text('Selection accepted into this application. Excluded CV changes were recorded as rejected. Review and approve each document.', 'Auswahl in diese Bewerbung übernommen. Ausgeschlossene CV-Änderungen wurden als abgelehnt protokolliert. Jedes Dokument prüfen und freigeben.');
  });
}
async function approve(kind: 'cv' | 'letter', reopen = false) {
  if (!await flushTextareas()) return;
  if (kind === 'cv' && !reopen && showCvReview.value && !cvChangeReviewError.value && !proposalAlreadyApplied.value) {
    // Approval applies to Current, even when Previous is selected for comparison.
    reviewActive.value = true;
    await acceptSelectedChanges();
    if (error.value || saveError.value) return;
  }
  if (kind === 'cv') reviewActive.value = false;
  await run(async () => {
    if (reviewActive.value && pane.value === kind) throw new Error('Accept or close the temporary review before approving working documents.');
    if (!record.value || !letter.value) throw new Error('Select both templates first.');
    if (!reopen && kind === 'letter' && (!letterText.value.trim() || unresolved.value.length)) throw new Error(text('Write a letter and resolve its placeholders first.', 'Zuerst einen Brief schreiben und Platzhalter auflösen.'));
    await saveSetup();
    const revision = kind === 'cv' ? cvRevision.value : letterRevision.value;
    await repository.saveReview(props.application.id, currentRefinementRequestId(cloudState.value, kind), (reopen ? 'reopen_' : 'approve_') + kind as RefinementReviewRow['kind'], { ...(reopen ? {} : { revision }), expectedRevision: cloudState.value!.revision });
    cloudState.value = await repository.loadState(props.application.id);
    if (disposed) return;
    approvals.value = clone(cloudState.value!.approvals_json);
    if (!reopen && kind === 'letter' && letterRevision.value === revision) letter.value = finalizeLetter(letter.value, context.value, letterCvState.value?.contact || null);
    if (reopen && kind === 'letter') letter.value = { ...clone(letter.value), finalRevisionId: null };
    persist();
    if (!saveError.value && (reopen || (kind === 'cv' ? cvApproved.value : letterApproved.value))) notice.value = kind === 'cv'
      ? reopen ? text('CV reopened for editing.', 'CV zur Bearbeitung wieder geöffnet.') : text('CV approved.', 'CV freigegeben.')
      : reopen ? text('Letter reopened for editing.', 'Brief zur Bearbeitung wieder geöffnet.') : text('Letter approved.', 'Brief freigegeben.');
  });
}
async function saveCurrentVariant() {
  if (busy.value || refreshing.value || syncing.value) return;
  if (!await flushTextareas()) {
    if (saveError.value) error.value = saveError.value;
    return;
  }
  await run(async () => {
    if (!record.value) throw new Error(text('Select a CV before saving a variant.', 'Vor dem Speichern einer Variante einen CV auswählen.'));
    const visibleState = previewCvState.value;
    if (!visibleState) throw new Error(temporaryReview.value.error || text('The current CV preview is unavailable. Restore its source before saving.', 'Die aktuelle CV-Vorschau ist nicht verfügbar. Vor dem Speichern ihre Quelle wiederherstellen.'));
    const name = variantName.value.trim();
    if (!name) throw new Error(text('Enter a name for the new variant.', 'Einen Namen für die neue Variante eingeben.'));
    if (!props.createVariant) throw new Error(text('The variant library is unavailable. Reopen this application and try again.', 'Die Variantenbibliothek ist nicht verfügbar. Diese Bewerbung erneut öffnen und es noch einmal versuchen.'));
    if (currentVariantSaved.value) { notice.value = text('This CV is already saved in your variant library.', 'Dieser CV ist bereits in der Variantenbibliothek gespeichert.'); return; }
    // Flatten the displayed version into a full CV, with private originals restored.
    // Library persistence does not retain proposal operations or a parent dependency.
    const snapshot = cloneCv(visibleState);
    const revision = refinementSignature([snapshot, props.application.context_json]);
    const previousReceipt = savedVariant.value;
    const recovering = previousReceipt?.id === '' && previousReceipt.name === name && previousReceipt.revision === revision;
    // Record the intended name before creating anything so an interrupted final
    // receipt can recover the completed library snapshot after reopening.
    savedVariant.value = { id: '', name, revision, previousIds: recovering ? previousReceipt.previousIds : props.configurations.map(item => item.id) };
    persist();
    if (saveError.value) { savedVariant.value = previousReceipt; throw new Error(saveError.value); }
    const existing = recovering ? props.configurations.find(item => isMainCvVariant(item) && !previousReceipt.previousIds?.includes(item.id)
      && item.name === name && refinementSignature(props.readVersion(item.id)) === refinementSignature(snapshot)) : undefined;
    const id = existing?.id || props.createVariant(name, snapshot);
    if (!id) throw new Error(text('The variant could not be saved. Try again.', 'Die Variante konnte nicht gespeichert werden. Erneut versuchen.'));
    savedVariant.value = { id, name, revision };
    persist();
    if (saveError.value) throw new Error(text('The variant was saved, but its local save record could not be stored. Retry saving to complete it.', 'Die Variante wurde gespeichert, aber der lokale Speichernachweis konnte nicht gesichert werden. Zum Abschließen erneut speichern.'));
    notice.value = text(`Saved “${name}” to your variant library.`, `„${name}“ in der Variantenbibliothek gespeichert.`);
  });
}
async function resetDocumentBeforeClearing(scope: DocumentScope) {
  if (!record.value || !letter.value) throw new Error(text('Select both templates first.', 'Zuerst beide Vorlagen auswählen.'));
  const row = originalRequest.value;
  const local = row && localRequests.value[row.id];
  let nextRecord = record.value;
  let nextLetter = letter.value;
  if (scope === 'cv') {
    if (!row || !local) throw new Error(text('The original private snapshot is unavailable on this device.', 'Der ursprüngliche private Snapshot ist auf diesem Gerät nicht verfügbar.'));
    if (row.application_id !== props.application.id || row.user_id !== props.userId || refinementSignature(row.request_json) !== refinementSignature(local.request)) throw new Error('The original snapshot does not match this application.');
    validateLocalRefinementSource(local, props.application.id);
    nextRecord = { ...clone(record.value), state: cloneCv(local.cv.baselineState), variantId: local.cv.sourceVariantId, revision: record.value.revision + 1, updatedAt: new Date().toISOString() };
  } else {
    let template = letter.value.templateSnapshot;
    if (!template) {
      const source = requests.value.find(request => matchesScope(request, 'letter')
        && localRequests.value[request.id]?.letterBaseline?.setup.template.id === letter.value?.templateId);
      const captured = source && localRequests.value[source.id];
      if (captured) {
        validateLocalRefinementSource(captured, props.application.id);
        template = captured.letterBaseline!.setup.template;
      } else template = templates.value.find(item => item.id === letter.value?.templateId);
    }
    if (!template) throw new Error(text('Restore the original letter template or its local refinement backup before clearing history.', 'Vor dem Löschen des Verlaufs die ursprüngliche Briefvorlage oder ihre lokale Überarbeitungssicherung wiederherstellen.'));
    const templateContext = letterContextVersion(props.application, letterCvState.value, letterTemplateWithSearchProfile(template, letter.value.searchProfile), template.language, '', template.maxWords);
    nextLetter = createApplicationLetter(props.userId, props.application.id, template, templateContext);
    if (letter.value.searchProfile) nextLetter.searchProfile = clone(letter.value.searchProfile);
    nextLetter.revisions = saveWorkingRevision(letter.value).revisions;
  }
  const previous = { record: record.value, letter: letter.value, approvals: approvals.value, parent: parentProposalIds.value[scope], selected: selectedProposalId.value, review: reviewActive.value, resetRequests: resetRequestIdsByScope.value[scope], pendingReset: pendingResetFeedback.value[scope], iterationSubmission: iterationFeedbackSubmission.value[scope], resetCvStateSignature: resetCvStateSignature.value };
  const resetFeedback = pendingResetFeedback.value[scope] || (feedbackHistory().length ? {
    id: crypto.randomUUID(), requestId: row?.request_json.scope === scope ? row.id : null,
    text: `Workflow reset: for the ${scope === 'cv' ? 'CV' : 'motivation letter'} only, ignore earlier feedback and annotation answers. Start from ${scope === 'cv' ? 'the restored original CV' : 'an empty letter using the selected template'} and use only feedback explicitly provided after this reset. Keep the other document’s guidance active.`,
  } : null);
  committingSelection = true;
  try {
    record.value = nextRecord; letter.value = nextLetter; approvals.value = { ...approvals.value, [scope]: null };
    parentProposalIds.value[scope] = null; selectedProposalId.value = ''; reviewActive.value = false;
    resetRequestIdsByScope.value[scope] = [...new Set([...resetRequestIdsByScope.value[scope], ...scopedRequests.value.map(request => request.id)])];
    // Save the restored state before clearing remotely. Surviving request IDs
    // keep this receipt ineligible until a history read confirms the reset.
    if (scope === 'cv') resetCvStateSignature.value = refinementSignature(nextRecord.state);
    // Commit the retry receipt with the restored documents before the cloud write.
    pendingResetFeedback.value[scope] = resetFeedback;
    iterationFeedbackSubmission.value[scope] = null;
  } finally { committingSelection = false; }
  persist();
  if (saveError.value) {
    committingSelection = true;
    try {
      record.value = previous.record; letter.value = previous.letter; approvals.value = previous.approvals;
      parentProposalIds.value[scope] = previous.parent; selectedProposalId.value = previous.selected; reviewActive.value = previous.review;
      resetRequestIdsByScope.value[scope] = previous.resetRequests;
      pendingResetFeedback.value[scope] = previous.pendingReset;
      iterationFeedbackSubmission.value[scope] = previous.iterationSubmission;
      resetCvStateSignature.value = previous.resetCvStateSignature;
    } finally { committingSelection = false; }
    throw new Error(saveError.value);
  }
  await savePendingResetFeedback(scope);
  await saveSetup();
}
async function clearRefinementHistory() {
  if (refreshing.value || syncing.value || !canClearHistory.value) return;
  await run(async () => {
    const scope = pane.value;
    await resetDocumentBeforeClearing(scope);
    if (disposed) return;
    await repository.clearHistory(props.application.id, cloudState.value?.revision || 0, scope);
    if (disposed) return;
    await refreshCloud();
    committingSelection = true;
    try {
      localRequests.value = Object.fromEntries(Object.entries(localRequests.value).filter(([, local]) => local.publishedAt || !refinementMatchesScope(local.request.scope, scope)));
      parentProposalIds.value[scope] = null; selectedProposalId.value = '';
      iterationFeedbackSubmission.value[scope] = null;
      pendingResetFeedback.value[scope] = null;
      selectedChangeIds.value = []; reviewActive.value = false; reviewComparison.value = 'proposed';
    } finally { committingSelection = false; }
    persist();
    if (saveError.value) throw new Error(text('Shared history was cleared, but local cleanup could not be saved. Retry saving before continuing.', 'Der geteilte Verlauf wurde gelöscht, aber die lokale Bereinigung konnte nicht gespeichert werden. Vor dem Fortfahren erneut speichern.'));
    notice.value = scope === 'cv' ? text('Original CV restored and CV history cleared. Letter retained.', 'Ursprünglichen CV wiederhergestellt und CV-Verlauf gelöscht. Brief bleibt erhalten.') : text('Letter reset to its template and letter history cleared. CV retained.', 'Brief auf seine Vorlage zurückgesetzt und Briefverlauf gelöscht. CV bleibt erhalten.');
  });
}
function exportHistory(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}
function exportRequest(id: string) { const row = requests.value.find(row => row.id === id); if (row) exportHistory(row.request_json, 'refinement-request-' + id + '.json'); }
function exportProposal(id: string) { const row = proposals.value.find(row => row.id === id); if (row) exportHistory(row.proposal_json, 'refinement-proposal-' + id + '.json'); }
async function getCvPdf() {
  // Finish the stage's source/identity updates before starting a cancellable export.
  await nextTick();
  if (disposed) throw new Error('The application is closed.');
  if (showCvReview.value) throw new Error('Open Attachments to export the approved working CV.');
  if (!cvApproved.value || !preview.value) throw new Error(text('Approve the CV before export.', 'Den CV vor dem Export freigeben.'));
  const revision = cvRevision.value; const blob = await preview.value.getPdfBlob();
  if (disposed || revision !== cvRevision.value || !cvApproved.value) throw new Error('The CV changed during export. Preview again.');
  return blob;
}
async function getLetterPdf() {
  await nextTick();
  if (disposed) throw new Error('The application is closed.');
  if (showLetterComparison.value) throw new Error('Open Attachments to export the approved working letter.');
  if (!letterApproved.value || !letterPreview.value) throw new Error(text('Approve the letter before export.', 'Den Brief vor dem Export freigeben.'));
  const revision = letterRevision.value; const blob = await letterPreview.value.getPdfBlob();
  if (disposed || revision !== letterRevision.value || !letterApproved.value) throw new Error('The letter changed during export. Preview again.');
  return blob;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
useToastWatch(() => error.value, { tone: 'error' });
useToastWatch(() => notice.value);
// Proposal validation traverses whole document snapshots; announce the settled result after Vue batches an edit.
useToastWatch(() => props.active && tab.value === 'refinement' ? sourceError.value : '', { tone: 'error' }, { flush: 'post' });
useToastWatch(() => props.active && tab.value === 'refinement' ? cvChangeReviewError.value : '', { tone: 'warning' }, { flush: 'post' });
useToastWatch(() => props.active && tab.value === 'refinement' ? reviewAcceptanceError.value : '', { tone: 'error' }, { flush: 'post' });
useToastWatch(() => props.active && tab.value === 'refinement' && (pane.value === 'cv' ? showCvReview.value : showLetterReview.value) ? temporaryReview.value.error : '', { tone: 'error' }, { flush: 'post' });
useToastWatch(() => props.active && tab.value === 'refinement' && iterationPending.value ? text('Waiting for the next draft. Sync to load it.', 'Der nächste Entwurf steht aus. Zum Laden synchronisieren.') : '', { passive: true }, { flush: 'post' });
useToastWatch(() => saveError.value, () => ({
  tone: 'error',
  action: { label: text('Retry save', 'Erneut speichern'), run: () => { persist(); return !saveError.value; } },
}));
useToastWatch(() => shortInstructionNotice.value, { tone: 'success' });
useToastWatch(() => shortInstructionError.value, { tone: 'error' });
</script>

<template>
  <section class="application-workspace" :class="{ 'application-workspace--sidebar': desktopSidebar, 'application-workspace--preparation': tab === 'preparation' }">
    <h1 class="application-mobile-title">{{ String(application.context_json.title || text('Application', 'Bewerbung')) }}</h1>
    <div ref="mobileScrollContent" class="application-scroll-content">
    <WorkspaceDetailHeader class="application-header" :title="String(application.context_json.title || text('Application', 'Bewerbung'))" :subtitle="String(application.context_json.institution || application.context_json.university || '')" :back-label="text('All applications', 'Alle Bewerbungen')" @back="emit('close')">
      <template #actions><slot name="actions" /><div ref="mobileActions" class="application-mobile-actions" /></template>
      <template #metadata><ApplicationIdentifier :application="application" :lang="lang" /><span>{{ text('Deadline', 'Bewerbungsfrist') }}: {{ formatOpportunityDeadline(application.context_json, lang) }}</span><ApplicationDeadlineCalendar :application="application" :lang="lang" /><span class="jobs-badge application-header__state" :class="`application-status--${applicationStatusTone(application.status)}`">{{ applicationStatusLabel(application.status, lang) }}</span></template>
    </WorkspaceDetailHeader>
    <div class="workflow-body" :class="{ 'workflow-body--refinement': tab === 'refinement', 'workflow-body--review': tab === 'review' }">
      <section v-show="tab === 'preparation'" class="preparation-stage">
        <DesktopSidebarPortal area="major" :active="active && tab === 'preparation'">
          <div class="preparation-selection" :class="{ 'preparation-selection--sidebar': desktopSidebar }">
            <div class="preparation-template-field"><div class="hint-label-row"><label :for="`${application.id}-cv-selection`">{{ text('Saved CV', 'Gespeicherter CV') }}</label><InfoHint v-if="cvSelectionLocked || !preparationVariants.length" :id="`${application.id}-cv-selection-lock`" :lang="lang" :label="text('Saved CV', 'Gespeicherter CV')" :text="cvSelectionLocked ? text('Clear CV history in Refinement to choose another variant.', 'Den CV-Verlauf unter Überarbeitung löschen, um eine andere Variante zu wählen.') : text('Save a CV in CV Studio to select it here.', 'Einen CV im CV-Studio speichern, um ihn hier auszuwählen.')" /></div><select :id="`${application.id}-cv-selection`" :value="selectedCvId" :aria-label="text('Saved CV', 'Gespeicherter CV')" :disabled="preparationBusy || cvSelectionLocked" :aria-describedby="cvSelectionLocked ? `${application.id}-cv-selection-lock` : undefined" @change="selectCv(($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ text('Choose a CV…', 'CV wählen…') }}</option><option v-if="record && !preparationVariants.some(item => item.id === selectedCvId)" :value="selectedCvId" disabled>{{ configurations.find(item => item.id === selectedCvId)?.name || record.baseName }} · {{ text('Saved application copy', 'Gespeicherte Bewerbungskopie') }}</option><option v-for="variant in preparationVariants" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></div>
            <div class="preparation-template-field"><div class="hint-label-row"><label :for="`${application.id}-letter-selection`">{{ text('Letter template', 'Briefvorlage') }}</label><InfoHint v-if="letterSelectionLocked || missingLetterTemplate" :id="`${application.id}-letter-selection-lock`" :lang="lang" :label="text('Letter template', 'Briefvorlage')" :text="letterSelectionLocked ? text('Clear letter history in Refinement to choose another template.', 'Den Briefverlauf unter Überarbeitung löschen, um eine andere Vorlage zu wählen.') : text('The original letter template is unavailable. Choose a template to continue; your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. Zum Fortfahren eine Vorlage auswählen; der bestehende Brief bleibt erhalten.')" /></div><select :id="`${application.id}-letter-selection`" :value="selectedTemplateId" :aria-label="text('Letter template', 'Briefvorlage')" :disabled="preparationBusy || letterSelectionLocked" :aria-describedby="letterSelectionLocked ? `${application.id}-letter-selection-lock` : undefined" @change="selectLetterTemplate(($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ letter && !missingLetterTemplate ? selectedTemplate.name + ' · ' + text('Saved revision', 'Gespeicherte Revision') + ' ' + selectedTemplate.revision : text('Choose a letter template…', 'Briefvorlage wählen…') }}</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option></select></div>
            <div v-if="letter && selectedTemplate.useMetaSearchInterests" class="preparation-shared-interests">
              <div class="hint-label-row"><span>{{ text('Shared research interests', 'Gemeinsame Forschungsinteressen') }}</span><InfoHint :lang="lang" :label="text('Shared research interests', 'Gemeinsame Forschungsinteressen')" :text="text('The selected letter template uses the shared meta-search interests. This application keeps its own copy. Refresh explicitly to adopt later changes; drafts and approved letters are never replaced by a search edit.', 'Die gewählte Briefvorlage verwendet die gemeinsamen Forschungsinteressen der Metasuche. Diese Bewerbung behält eine eigene Kopie. Spätere Änderungen ausdrücklich übernehmen; Suchänderungen ersetzen keine Entwürfe oder freigegebenen Briefe.')" /></div>
              <button type="button" :disabled="missingLetterTemplate || preparationBusy || letterSelectionLocked || letterApproved || reviewActive" @click="refreshSharedResearchInterests">{{ loadingSharedInterests ? text('Loading interests…', 'Interessen werden geladen…') : text('Refresh shared interests', 'Gemeinsame Interessen aktualisieren') }}</button>
            </div>
          </div>
        </DesktopSidebarPortal>
        <DesktopSidebarPortal area="minor" :active="active && tab === 'preparation'">
          <div v-if="letter" class="preparation-settings" :class="{ 'preparation-settings--sidebar': desktopSidebar }">
            <label>{{ text('Language', 'Sprache') }}<select v-model="letter.language" :disabled="busy || reviewActive || letterApproved"><option value="en">English</option><option value="de">Deutsch</option></select></label>
            <label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="letter.maxWords" type="number" min="50" max="2000" :disabled="busy || reviewActive || letterApproved" /></label>
          </div>
        </DesktopSidebarPortal>
        <slot name="preparation-evaluation" />
        <details v-if="letter?.searchProfile?.researchInterests" class="disclosure-row preparation-profile-context">
          <summary>{{ text('Saved research interests', 'Gespeicherte Forschungsinteressen') }}</summary>
          <p>{{ letter.searchProfile.templateName }} · {{ text('Revision', 'Revision') }} {{ letter.searchProfile.revision }}</p>
          <p v-if="letter.searchProfile.researchInterests" class="pre-wrap">{{ letter.searchProfile.researchInterests }}</p>
        </details>
        <OpportunityContext :context="application.context_json" :lang="lang" :default-open-groups="['overview', 'requirements', 'documents']" />
        <DesktopSidebarPortal v-if="$slots['preparation-actions']" area="minor" :active="active && tab === 'preparation'">
          <div class="preparation-actions" :class="{ 'preparation-actions--sidebar': desktopSidebar }"><slot name="preparation-actions" /></div>
        </DesktopSidebarPortal>
      </section>
      <section v-show="tab === 'refinement'" class="refinement-stage">
        <DesktopSidebarPortal area="major" :active="active && tab === 'refinement'">
        <div class="refinement-toolbar" :class="{ 'refinement-toolbar--sidebar': desktopSidebar }">
          <WorkspaceMobileActions :active="active && tab === 'refinement'">
          <label class="refinement-scope"><span>{{ text('Refinement scope', 'Umfang der Überarbeitung') }}</span><select :value="feedbackScope" :disabled="busy" @change="selectScope"><option value="cv">CV</option><option value="letter">{{ text('Letter', 'Brief') }}</option></select></label>
          <div class="action-row refinement-approval">
            <button v-if="pane === 'cv' && record" class="primary refinement-icon-action" type="button" :disabled="busy || !letter || !!saveError" @click="approve('cv', cvApproved)"><FontAwesomeIcon :icon="cvApproved ? faRotateLeft : faCheck" aria-hidden="true" />{{ cvApproved ? text('Reopen CV', 'CV wieder öffnen') : text('Approve CV', 'CV freigeben') }}</button>
            <button v-if="pane === 'letter' && letter" class="primary refinement-icon-action" type="button" :disabled="busy || reviewActive || !record || !letterText.trim() || !!saveError || (unresolved.length > 0 && !letter.finalRevisionId)" @click="approve('letter', letterApproved || !!letter.finalRevisionId)"><FontAwesomeIcon :icon="letterApproved || letter.finalRevisionId ? faRotateLeft : faCheck" aria-hidden="true" />{{ letterApproved || letter.finalRevisionId ? text('Reopen letter', 'Brief wieder öffnen') : text('Approve letter', 'Brief freigeben') }}</button>
          </div>
          </WorkspaceMobileActions>
          <div v-if="pane === 'cv' && record && createVariant" class="refinement-variant-save">
            <div><div class="hint-label-row"><label :for="`${application.id}-variant-name`">{{ text('Variant name', 'Variantenname') }}</label><InfoHint :lang="lang" :label="text('Variant name', 'Variantenname')" :text="text('Saves the displayed CV as an independent copy that remains after clearing refinement history.', 'Speichert den angezeigten CV als eigenständige Kopie, die nach dem Löschen des Überarbeitungsverlaufs erhalten bleibt.')" /></div><input :id="`${application.id}-variant-name`" v-model="variantName" type="text" :disabled="busy || refreshing || syncing" /></div>
            <button type="button" :disabled="busy || refreshing || syncing || !previewCvState || !variantName.trim() || currentVariantSaved" @click="saveCurrentVariant">{{ currentVariantSaved ? text('Variant saved', 'Variante gespeichert') : text('Save as new CV variant', 'Als neue CV-Variante speichern') }}</button>
          </div>
        </div>
        </DesktopSidebarPortal>
        <DesktopSidebarPortal area="minor" :active="active && tab === 'refinement'">
          <div class="proposal-preview-action" :class="{ 'proposal-preview-action--sidebar': desktopSidebar }">
            <RefinementComparisonToggle v-if="showCvReview || showLetterComparison" :model-value="reviewComparison" :lang="lang" :disabled="busy" @update:model-value="selectComparison" />
            <button class="refinement-icon-action" type="button" :disabled="busy || refreshing || syncing" @click="syncRefinement()"><FontAwesomeIcon :icon="faRotate" aria-hidden="true" />{{ syncing ? text('Syncing…', 'Synchronisieren…') : text('Sync', 'Synchronisieren') }}</button>
          </div>
        </DesktopSidebarPortal>
        <div class="refinement-controls">
          <p v-if="!record || !letter" class="app-hint">{{ text('Select both templates in Preparation to begin. Existing proposals remain available below.', 'Zum Start beide Vorlagen in Vorbereitung auswählen. Bestehende Vorschläge bleiben unten verfügbar.') }}</p>
            <section v-if="!showInitialRefinement" class="iteration-step current-review">
              <h3>{{ text('Current Review', 'Aktuelle Prüfung') }}<InfoHint :lang="lang" :label="text('Current Review', 'Aktuelle Prüfung')" :text="legacyReview ? text('Combined round · read-only history. Create a separate request to continue.', 'Gemeinsame Runde · schreibgeschützter Verlauf. Zum Fortfahren eine eigene Anfrage erstellen.') : text('Activate the changes to keep for the next iteration. Your selection is saved with the next request and applied when its ChatGPT reply arrives.', 'Aktivieren Sie die Änderungen für die nächste Runde. Ihre Auswahl wird mit der nächsten Anfrage gespeichert und übernommen, sobald die ChatGPT-Antwort eintrifft.')" /></h3>
              <div v-if="hasActiveProposal || currentAnnotations.length" class="proposal-content">
                <h4 v-if="pane === 'letter'" :id="reviewTabId('question')">{{ text('Questions', 'Fragen') }} <span class="review-tab-count">{{ reviewCounts.question }}</span></h4>
                <div v-if="pane === 'cv'" class="review-tabs" role="tablist" :aria-label="text('Proposal review', 'Vorschlag prüfen')">
                  <button v-for="item in reviewTabs" :id="reviewTabId(item)" :key="item" type="button" role="tab" :data-review-tab="item" :aria-controls="reviewPanelId" :aria-selected="reviewTab === item" :tabindex="reviewTab === item ? 0 : -1" @click="selectReviewTab(item)" @keydown="onReviewTabKeydown($event, item)">{{ reviewTabLabel(item) }} <span class="review-tab-count">{{ reviewCounts[item] }}</span></button>
                </div>
                <div :id="reviewPanelId" class="review-panel" :role="pane === 'cv' ? 'tabpanel' : 'region'" :aria-labelledby="reviewTabId(pane === 'cv' ? reviewTab : 'question')" :tabindex="pane === 'cv' ? 0 : undefined">
                  <template v-if="pane === 'cv' && reviewTab === 'changes'">
                    <template v-if="hasActiveProposal && reviewScope !== 'letter'">
                      <RefinementChangeReview :changes="proposalChanges" :selected="selectedChangeIds" :comments="[]" :lang="lang" :disabled="busy || refreshing || syncing || !record" :locked="!!cvChangeReviewError" @toggle="setCvChangeActive" />
                    </template>
                    <p v-else class="review-guidance">{{ text('No individual CV changes for this document.', 'Keine einzelnen CV-Änderungen für dieses Dokument.') }}</p>
                  </template>
                  <RefinementAnnotations v-show="pane === 'letter' || reviewTab === 'question'" ref="annotations" :items="currentAnnotations" :comments="pane === 'cv' ? proposalComments : []" hide-heading :lang="lang" :disabled="!record || legacyReview" :busy="busy" :save="saveAnnotation" :privacy-preview="previewOutgoingText" />
                  <p v-if="(pane === 'letter' || reviewTab === 'question') && !reviewCounts.question" class="review-guidance">{{ text('No questions.', 'Keine Fragen.') }}</p>
                </div>
              </div>
              <p v-if="!hasActiveProposal">{{ text('Waiting for a proposal.', 'Vorschlag ausstehend.') }}</p>
            </section>
            <section class="iteration-step refinement-task" :class="showInitialRefinement ? 'initial-refinement' : 'next-refinement'">
              <h3>{{ showInitialRefinement ? text('Initial Refinement', 'Erste Überarbeitung') : text('Next Refinement', 'Nächste Überarbeitung') }}<InfoHint :lang="lang" :label="showInitialRefinement ? text('Initial Refinement', 'Erste Überarbeitung') : text('Next Refinement', 'Nächste Überarbeitung')" :text="text('Optional requests for this document. Included with your answers and open questions when you copy the task.', 'Optionale Wünsche für dieses Dokument. Sie werden beim Kopieren der Aufgabe zusammen mit Ihren Antworten und offenen Fragen übermittelt.') + (preparedSource && feedbackScope !== 'cv' && !preparedSource.request.letter.text.trim() ? ' ' + text('Initial letter draft: the source letter is empty. ChatGPT should create the first draft from the published CV, opportunity and template.', 'Erster Briefentwurf: Der Quellbrief ist leer. ChatGPT soll anhand des veröffentlichten CVs, der Ausschreibung und der Vorlage einen ersten Entwurf erstellen.') : '')" /></h3>
              <label v-if="pane === 'cv'" class="cv-refinement-request"><span>{{ text('Refinement request', 'Überarbeitungswunsch') }}</span><AutosaveTextarea v-model.lazy="cvIterationNote" rows="4" maxlength="12000" :placeholder="text('What should the next CV refinement focus on?', 'Worauf soll sich die nächste CV-Überarbeitung konzentrieren?')" :disabled="busy || scopeLocked" /></label>
              <div v-if="pane === 'letter'" class="iteration-note-tabs" role="tablist" :aria-label="text('Refinement requests', 'Überarbeitungswünsche')">
                <button v-for="field in visibleIterationNoteFields" :id="iterationNoteTabId(field)" :key="field" type="button" role="tab" :data-iteration-note="field" :aria-controls="iterationNotePanelId" :aria-selected="activeIterationNote === field" :tabindex="activeIterationNote === field ? 0 : -1" @click="selectIterationNote(field)" @keydown="onIterationNoteKeydown($event, field)"><FontAwesomeIcon :icon="iterationNoteIcons[field]" aria-hidden="true" />{{ iterationNoteLabel(field) }}</button>
              </div>
              <div v-if="pane === 'letter'" :id="iterationNotePanelId" class="iteration-note-panel" role="tabpanel" :aria-labelledby="iterationNoteTabId(activeIterationNote)">
                <AutosaveTextarea :model-value="iterationNoteEditor.value" :model-modifiers="{ lazy: true }" @update:model-value="iterationNoteEditor.update" rows="4" maxlength="4000" :placeholder="iterationNotePlaceholder" :aria-labelledby="iterationNoteTabId(activeIterationNote)" :disabled="busy || scopeLocked" />
              </div>
              <button class="refinement-copy-action" type="button" :disabled="busy || refreshing || !preparedSource || scopeLocked" @click="copyIterationTask"><FontAwesomeIcon :icon="faCopy" aria-hidden="true" />{{ showInitialRefinement ? text('Copy task', 'Aufgabe kopieren') : text('Copy feedback', 'Feedback kopieren') }}</button>
            </section>
            <template v-if="shortInstructionError">
              <button type="button" :disabled="busy || refreshing" @click="copyTask">{{ text('Retry copy', 'Kopieren erneut versuchen') }}</button>
              <AutosaveTextarea :model-value="shortInstruction" readonly rows="5" :aria-label="text('Short ChatGPT instruction', 'Kurze ChatGPT-Anweisung')" />
            </template>
          <details class="disclosure-row"><summary>{{ text('Edit manually', 'Manuell bearbeiten') }}<InfoHint v-if="pane === 'cv'" :lang="lang" :label="text('Edit manually', 'Manuell bearbeiten')" :text="text('Edit the current CV, including active changes. Previous stays unchanged.', 'Aktuellen CV einschließlich aktiver Änderungen bearbeiten. Der vorherige Stand bleibt unverändert.')" /></summary>

          <section v-if="cvEditorState" v-show="pane === 'cv'" class="working-document"><fieldset :disabled="cvApproved || busy"><FormBuilder :state="cvEditorState" :read-version="() => null" :save-version="() => false" /></fieldset></section>
          <section v-if="letter" v-show="pane === 'letter'" class="working-document"><label>{{ text('Complete letter text', 'Vollständiger Brieftext') }}<AutosaveTextarea :model-value="letterText" :model-modifiers="{ lazy: true }" rows="18" :disabled="letterApproved || busy || reviewActive" @input="markInitialLetterDraftInput" @update:model-value="updateLetter" /></label><p :class="{ warning: words > setup.maxWords }">{{ words }} / {{ setup.maxWords }} {{ text('target words (complete letter)', 'Zielwörter (vollständiger Brief)') }}</p><InfoHint v-if="words > setup.maxWords" :lang="lang" :label="text('Target words', 'Zielwortzahl')" :text="text('Over the target. Review the tender limit; approval and export remain available.', 'Über der Zielwortzahl. Vorgabe prüfen; Freigabe und Export bleiben möglich.')" /><p v-if="unresolved.length" class="app-hint warning">{{ text('Resolve placeholders:', 'Platzhalter auflösen:') }} {{ unresolved.join(', ') }}</p><LetterFormattingControls :formatting="letter.formatting" :base-formatting="selectedTemplate.formatting" :lang="lang" :disabled="letterApproved || busy || reviewActive" @change="updateLetterFormatting" /></section>
          </details>
          <RefinementHistory :scope="pane" :requests="requests" :proposals="proposals" :local-requests="localRequests" :current-request-id="currentRequestId" :active-id="selectedProposalId" :review-active="reviewActive" :accepted="proposalAlreadyApplied" :publication-status="publicationStatus" :open="historyOpen" :lang="lang" :busy="busy || refreshing || syncing" :can-clear="canClearHistory" @clear="clearRefinementHistory" @select="selectReviewProposal" @details="historyOpen = $event" @export-request="exportRequest" @export-proposal="exportProposal" />
        </div>
        <div class="refinement-preview">
          <DocumentCvPreview v-if="previewCvState" v-show="pane === 'cv'" ref="preview" :preview-key="documentPreviewKey" :state="previewCvState" :active="active && tab === 'refinement' && feedbackScope === 'cv'" hide-actions :download-disabled="!cvApproved || showCvReview" />
          <MotivationLetterPreview v-if="previewLetterContent" v-show="pane === 'letter'" ref="letterPreview" :preview-key="documentPreviewKey" :cv-state="previewLetterCvState" :content="previewLetterContent" :formatting="effectiveLetterFormatting" :lang="previewLetterLanguage" :active="active && tab === 'refinement' && feedbackScope === 'letter'" hide-actions :download-disabled="!letterApproved || showReviewPreview" />
        </div>
      </section>
      <ApplicationDocuments v-show="tab === 'review'" :client="client" :active="active && tab === 'review'" mode="review" :application-id="application.id" :user-id="userId" :lang="lang" :cv-state="record?.state || null" :cv-ready="cvApproved" :export-ready="cvApproved && letterApproved" :get-cv-pdf="getCvPdf" :get-letter-pdf="getLetterPdf" :letter-ready="letterApproved" :letter-revision="letterRevision" @readiness="documentReadiness = $event">
        <OpportunityContext :context="application.context_json" :lang="lang" :only-groups="['documents']" checklist :completed-keys="application.completed_checklist_keys || []" :saving="checklistSaving" @toggle-checklist="(key, completed) => emit('toggleChecklist', key, completed)" />
      </ApplicationDocuments>
      <section v-show="tab === 'tracking'" class="tracking-stage">
        <WorkspaceMobileActions :active="active && tab === 'tracking'"><slot name="tracking-actions" /></WorkspaceMobileActions>
        <slot name="tracking" />
      </section>
    </div>
    </div>
    <DesktopSidebarPortal area="subtabs" :active="active">
    <footer class="workflow-navigation" :class="{ 'workflow-navigation--sidebar': desktopSidebar }">
      <button class="workflow-back" type="button" :aria-label="text('All applications', 'Alle Bewerbungen')" @click="emit('close')"><svg class="workflow-back__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 4-6 6 6 6M2 10h16" /></svg><span class="workflow-back__label">{{ text('All applications', 'Alle Bewerbungen') }}</span></button>
      <nav ref="stageNavigation" class="workspace-subtabs" :aria-label="text('Application stages', 'Bewerbungsphasen')">
        <button v-for="(stage, index) in stages" :key="stage" type="button" :class="[`application-status--${applicationStatusTone(stage)}`, { 'is-active': tab === stage }]" :aria-pressed="tab === stage" @click="selectStage(stage)"><span class="stage-number">{{ index + 1 }}</span>{{ ({ preparation: text('Preparation', 'Vorbereitung'), refinement: text('Refinement', 'Überarbeitung'), review: text('Attachments', 'Anhänge'), tracking: text('Tracking', 'Verlauf') })[stage] }}</button>
      </nav>
    </footer>
    </DesktopSidebarPortal>
  </section>
</template>

<style scoped>
.iteration-note-tabs{display:flex;border-bottom:1px solid var(--ui-border);margin-bottom:10px}
.iteration-note-tabs button{display:inline-flex;align-items:center;justify-content:center;gap:8px;flex:1;min-width:0;min-height:44px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--ui-muted)}
.iteration-note-tabs svg{width:1em;flex-shrink:0}
.iteration-note-tabs button[aria-selected="true"]{border-bottom-color:var(--ui-accent);color:var(--ui-accent);font-weight:600}
.review-tabs{display:flex;flex-wrap:wrap;margin:16px 0 12px;gap:0 4px}
.review-tabs button{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1 1 auto;min-height:44px;padding:8px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--ui-muted)}
.review-tabs button[aria-selected="true"]{border-bottom-color:var(--ui-accent);color:var(--ui-accent);font-weight:600}
.review-tab-count{font-variant-numeric:tabular-nums;font-size:.85em}
@media(max-width:760px){.review-tabs{display:grid;grid-template-columns:1fr 1fr}}
.review-panel{min-width:0}.review-panel:focus-visible,.review-tabs button:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.review-guidance{color:var(--ui-muted);margin:0 0 20px}.cv-refinement-request{margin:16px 0 12px}
.iteration-note-panel{margin-bottom:12px}
.iteration-note-panel textarea{display:block}
.application-header__state{margin-left:auto;margin-top:0;align-self:flex-end;line-height:1.5}
.application-mobile-actions{display:none}
.application-mobile-title{display:none}
.application-scroll-content{display:contents}
.iteration-step{padding:16px 0;}.iteration-step:first-child{padding-top:0}.iteration-step:last-of-type{border-bottom:0}.iteration-step h3{margin-bottom:10px}.iteration-step h4{font-size:14px;margin:20px 0 10px}.proposal-summary{color:#b8d9cf;font-weight:600}.proposal-preview-action{display:flex;flex-wrap:wrap;gap:8px}.proposal-preview-action--sidebar{flex-direction:column}.proposal-preview-action--sidebar button{width:100%;text-align:left}.refinement-icon-action{display:inline-flex;align-items:center;gap:8px}.refinement-icon-action svg{width:1em;flex-shrink:0}

.selection-checkbox{display:flex;align-items:center;gap:9px;min-height:36px;cursor:pointer}.selection-checkbox input{width:18px;height:18px;accent-color:#67c8a6}.preview-review-label{font-size:12px;color:#efcc87;margin:0}.application-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;color:var(--ui-text);font-family:var(--font-ui,system-ui)}
.workflow-navigation{display:contents}.workflow-back{display:none}
.workflow-back__icon{width:16px;height:16px;flex-shrink:0}
.workspace-subtabs{display:flex;gap:6px;flex:1;min-width:0}
.workspace-subtabs button{display:flex;align-items:center;gap:8px;flex:1;text-align:left;color:var(--ui-accent)}.workspace-subtabs .is-active,.workspace-subtabs button.is-active:hover{background:var(--ui-active);border-color:var(--ui-accent-border);color:var(--ui-accent)}.stage-number{color:inherit;font-size:12px;font-variant-numeric:tabular-nums}
.workflow-body{flex:1;min-height:0;min-width:0;overflow:auto;padding:14px 0 0 0}.workflow-body--refinement,.workflow-body--review{display:flex;flex-direction:column;overflow:hidden}
.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){flex:1 0 auto;min-height:360px}
.preparation-actions{display:flex;justify-content:center;}
.refinement-toolbar{position:sticky;top:0;z-index:10;min-width:0;padding-bottom:12px;border-bottom:1px solid var(--ui-border);background:#0b0f14}
.refinement-toolbar > .action-row{margin:0}
.refinement-variant-save > div{display:grid;gap:7px;margin-bottom:12px}
.refinement-variant-save{margin-top:16px;padding-top:16px;border-top:1px solid var(--ui-border)}.refinement-variant-save button{width:100%}
@media(max-width:760px){.refinement-toolbar{position:static;padding:0;border:0;background:transparent;flex-shrink:0}}
@media(min-width:761px) and (max-width:1180px){.workflow-body--review :deep(.application-documents){min-height:640px}}
@media(min-width:761px){.application-workspace{margin-bottom:40px;padding:32px;}.workflow-body{padding:20px 0 0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable}.application-header :deep(.workspace-detail-header__back){display:none}.workflow-navigation{position:fixed;inset-inline:0;bottom:0;z-index:30;display:flex;align-items:center;gap:20px;min-height:66px;padding:12px max(20px,calc((100vw - 1484px)/2));border-top:1px solid #24504e;background:var(--ui-shell);box-shadow:0 -6px 20px #0003}.workflow-back{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}.workspace-subtabs button{justify-content:center}.preparation-stage{padding-bottom:6px}}
.preparation-stage,.tracking-stage{display:grid}.stage-heading{display:flex;justify-content:space-between;align-items:start;gap:18px;margin-bottom:18px}.stage-heading h2,.tracking-stage h2{color:var(--ui-accent);font-size:21px;margin:0 0 8px}.stage-heading p,p.hint{font-size:13px;color:var(--ui-muted);line-height:1.6}.stage-heading button{flex-shrink:0}
h3{font-size:16px;margin:0 0 14px}p{line-height:1.6;font-size:13px}button,input,select,textarea{font:inherit;color:inherit;border:1px solid var(--ui-border);background:var(--ui-control);border-radius:7px;padding:9px 11px;box-sizing:border-box}button{cursor:pointer;font-size:13px}button:disabled{opacity:.45;cursor:not-allowed}button:hover:enabled{background:var(--ui-surface-hover)}.primary{background:var(--ui-active);border-color:var(--ui-accent-border);color:var(--ui-accent)}label{display:grid;gap:7px;font-size:12px;font-weight:600;margin-bottom:12px}input,select,textarea{width:100%;min-width:0;font-size:14px;font-weight:400}textarea{resize:vertical;line-height:1.6}select{max-width:100%}pre{font-size:11px;overflow:auto;max-height:300px;white-space:pre-wrap;overflow-wrap:anywhere}.pre-wrap{white-space:pre-wrap;overflow-wrap:anywhere}.preparation-selection,.preparation-settings{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px}.preparation-selection label,.preparation-settings label{margin:0}.preparation-template-field{display:grid;gap:7px}.preparation-selection p{grid-column:1 / -1;margin:0}.preparation-selection--sidebar,.preparation-settings--sidebar{grid-template-columns:minmax(0,1fr)}.workflow-card{border:1px solid var(--ui-border);border-radius:10px;padding:18px;background:#091923}.workflow-card p{margin:10px 0}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.action-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.action-row span{font-size:12px;color:var(--ui-muted)}.error{color:#fecaca}.warning{color:#efcc87;font-size:13px}.refinement-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,30%);gap:24px;flex:1;min-height:0;overflow:hidden}.refinement-controls{overflow:auto;min-height:0;padding-right:8px}.refinement-preview{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:1;min-height:0}.refinement-preview :deep(.document-inline-preview__viewport){display:block}.working-document{margin-bottom:24px}.working-document fieldset{border:0;padding:0;min-width:0}.working-document :deep(.builder){height:auto;overflow:visible}.working-document :deep(.content-panel),.working-document :deep(.content-panel__scroll-body){height:auto;overflow:visible;overscroll-behavior:auto;flex:0 0 auto}.cv-change{display:grid;gap:7px;margin:16px 0;font-size:13px;white-space:pre-wrap}.cv-change del{background:#3a1720;padding:9px;text-decoration:none;color:#fecaca}.cv-change ins{background:#10382c;padding:9px;text-decoration:none;color:#a7f3d0}.review-heading{flex:0 0 auto}.review-heading .stage-heading{margin-bottom:10px}.review-heading details{max-height:25vh;overflow:auto;margin-bottom:10px}.preparation-stage :deep(.opportunity-context){overflow:visible}
@media(max-width:900px){.preparation-selection{grid-template-columns:1fr}.refinement-stage{grid-template-columns:minmax(0,1fr) minmax(270px,38%);gap:12px}.stage-heading{flex-direction:column}}
@media(max-width:760px){.application-workspace{--mobile-application-tabs-height:48px;padding-bottom:var(--mobile-application-tabs-height)}.workspace-subtabs{position:fixed;inset-inline:0;bottom:var(--mobile-tabs-height,76px);z-index:36;height:48px;margin:0;padding:4px 8px;overflow-x:auto;flex-wrap:nowrap;background:var(--ui-shell);border-top:1px solid #24504e}.workspace-subtabs button{font-size:12px;white-space:nowrap;padding:7px;gap:4px}.stage-number{display:none}.workflow-body{padding:8px}.workflow-body--refinement{overflow:auto}.refinement-stage{display:flex;flex-direction:column;gap:10px;overflow:visible;flex:0 0 auto}.refinement-controls{flex:0 0 auto;overflow:visible}.refinement-preview{flex:0 0 auto}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:0 0 auto}.refinement-preview :deep(.document-inline-preview){min-height:0}.refinement-preview :deep(.document-inline-preview__viewport){display:block;max-height:60vh}.stage-heading{gap:10px}.stage-heading h2{font-size:20px}.workflow-card{padding:14px}.workflow-body input,.workflow-body textarea,.workflow-body select{font-size:16px}.workflow-body p{font-size:15px}.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){min-height:430px;flex:1 0 auto}.review-heading details{max-height:180px}.tracking-stage{gap:12px}}
@media(min-width:761px){.refinement-stage{grid-template-rows:auto auto minmax(0,1fr);row-gap:12px}.refinement-toolbar{grid-column:1;grid-row:1;margin-right:8px}.proposal-preview-action{grid-column:1;grid-row:2}.refinement-controls{grid-column:1;grid-row:3}.refinement-preview{grid-column:2;grid-row:1 / 4}}
.application-workspace--sidebar{margin-bottom:0}
.application-workspace--sidebar .refinement-stage{grid-template-rows:minmax(0,1fr)}
.application-workspace--sidebar .refinement-controls{grid-row:1}
.application-workspace--sidebar .refinement-preview{grid-row:1}
.workflow-navigation--sidebar{position:static;display:flex;flex-direction:column;align-items:stretch;gap:8px;min-height:0;padding:0;border:0;background:transparent;box-shadow:none}
.workflow-navigation--sidebar .workspace-subtabs{flex-direction:column;gap:6px}
.workflow-navigation--sidebar .workspace-subtabs button{justify-content:flex-start;width:100%}
.workflow-navigation--sidebar .workflow-back{display:flex;width:100%}
.preparation-actions--sidebar{display:flex;padding:0;border:0}
.preparation-actions--sidebar :deep(button){width:100%}
.refinement-toolbar--sidebar{position:static;padding:0;margin:0;border:0;background:transparent}
.refinement-toolbar--sidebar .action-row{display:flex;flex-direction:column;align-items:stretch;gap:8px}
.refinement-toolbar--sidebar .action-row button{width:100%;text-align:left}
.refinement-copy-action{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:44px;padding:12px 18px;background:var(--ui-accent);border-color:var(--ui-accent);color:var(--ui-shell);font-size:14px;font-weight:700}
.refinement-copy-action:hover:enabled{background:var(--ui-text);border-color:var(--ui-text)}
.refinement-copy-action:focus-visible{outline:2px solid var(--ui-accent);outline-offset:3px}
.preparation-selection select:disabled{background:var(--ui-shell);color:var(--ui-muted);cursor:not-allowed;opacity:.65}
@media(max-width:760px){
  .application-workspace{--mobile-application-tabs-height:53px;border:1px solid var(--ui-divider);background:var(--ui-surface)}
  /* The app shell already reserves one bottom row; preparation needs only navigation. */
  .application-workspace--preparation{padding-bottom:0}
  .workflow-navigation{position:fixed;inset-inline:0;bottom:var(--mobile-tabs-height,76px);z-index:36;display:flex;align-items:center;gap:8px;height:var(--mobile-application-tabs-height);padding:4px max(8px,env(safe-area-inset-right,0px)) 4px max(8px,env(safe-area-inset-left,0px));border-top:1px solid var(--ui-divider);background:var(--ui-shell)}
  .workflow-back{display:inline-flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;height:44px;padding:0;border:0;border-right:1px solid var(--ui-divider);border-radius:0;background:transparent;color:var(--ui-text)}
  .workflow-back__icon{width:20px;height:20px}
  .workflow-back__label{display:none}
  .workspace-subtabs{position:static;inset:auto;flex:1;min-width:0;height:44px;gap:0;margin:0;padding:0;border:0;background:transparent;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none}
  .workspace-subtabs::-webkit-scrollbar{display:none}
  .workspace-subtabs button{flex:1 0 auto;justify-content:center;min-height:44px;padding:6px 8px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--ui-accent)}
  .workspace-subtabs .is-active{border-bottom-color:var(--ui-accent);background:var(--ui-active);color:var(--ui-accent)}
  .workflow-navigation button:focus-visible{outline:2px solid var(--ui-accent);outline-offset:-2px}
  .application-mobile-title{display:block;flex-shrink:0;margin:0;padding:10px 12px;font-size:16px;line-height:1.35;overflow-wrap:anywhere;border-bottom:1px solid var(--ui-divider);background:var(--ui-shell)}
  .application-scroll-content{display:block;flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scroll-padding-block:8px}
  .application-header{padding-top:8px}
  .application-header :deep(.workspace-detail-header__back){display:none}
  .application-workspace--preparation .application-header :deep(.workspace-detail-header__controls){display:none}
  .application-header :deep(.workspace-detail-header__controls){padding-block:4px;border-top-color:var(--ui-divider)}
  .application-header :deep(.workspace-detail-header__title h1){display:none}
  .application-header :deep(.application-identifier),.application-header :deep(.application-deadline-calendar){display:none}
  .workflow-body{flex:1 0 auto;overflow:visible;padding:12px}
  .stage-heading h2{font-size:17px;line-height:1.35}
  .refinement-controls{padding-right:0}
  .refinement-toolbar:not(:has(.refinement-variant-save)){display:none}
  .refinement-variant-save{margin-top:0;padding-top:0;border-top:0}
  .proposal-preview-action button,.refinement-variant-save button,.preparation-selection select,.preparation-settings input,.preparation-settings select{min-height:44px}
  .application-mobile-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex:1;min-width:0}
  .application-mobile-actions :deep(button),.application-mobile-actions :deep(select){min-height:44px;max-width:100%}
  .application-mobile-actions :deep(select){font-size:16px}
  .application-mobile-actions :deep(label){min-width:0;margin:0}
  .application-mobile-actions :deep(.jobs-action-label),.application-mobile-actions .refinement-scope > span{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  .application-mobile-actions .refinement-scope{flex:1}
  .application-mobile-actions .refinement-approval{flex-shrink:0;margin:0}
  .application-mobile-actions .refinement-approval button{gap:6px;padding-inline:8px}
  .application-mobile-actions :deep(.jobs-detail-state){flex:1}
  .application-mobile-actions :deep(.jobs-detail-state select){width:100%}
  .application-mobile-actions :deep(.package-actions){order:1;margin:0;min-width:0}
  .application-mobile-actions :deep(.package-preview-open){order:2}
  .application-mobile-actions :deep(.package-actions button),.application-mobile-actions :deep(.package-preview-open){padding-inline:8px}
}
@media(min-width:761px) and (max-width:1050px){
  .application-workspace{padding:20px}
  .workflow-body--refinement{overflow:auto}
  .refinement-stage{display:flex;flex-direction:column;gap:20px;flex:0 0 auto;overflow:visible}
  .refinement-controls{flex:none;overflow:visible;padding-right:0}
  .refinement-preview{flex:none;overflow:visible}
  .refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:none;height:auto;overflow:visible}
  .refinement-preview :deep(.document-inline-preview){height:auto;overflow:visible}
  .refinement-preview :deep(.document-inline-preview__viewport){display:block;overflow:visible;overscroll-behavior:auto}
}
@media(min-width:761px) and (max-height:600px){
  .application-workspace{padding-block:12px}
}
</style>
