<script setup lang="ts">
import InfoHint from '../../shared/ui/InfoHint.vue';
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowReactive, shallowRef, watch } from 'vue';
import { faFilter, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CvState, SavedConfiguration } from '../../documents/cv/types';
import type { Application, Opportunity, OpportunityReviewState } from '../cloudTypes';
import { APPLICATION_STATUSES, TRACKING_STATUSES, OPPORTUNITY_REVIEW_STATES } from '../cloudTypes';
import { useCloudWorkspace } from '../composables/useCloudWorkspace';
import { safeEmailUrl } from '../../shared/lib/safeUrl';
import { isOpportunityDeadlinePassed, opportunityDeadlineSortKey, formatOpportunityDeadline } from '../../features/opportunities/domain/opportunityDeadline';
import { hasReviewedOpportunity, opportunityRecency } from '../../features/opportunities/domain/opportunityRecency';
import { fitScoreTone as fitTone } from '../../features/opportunities/domain/opportunityContext';
import { readLivingStandard } from '../../features/opportunities/domain/livingStandard';
import { applicationStatusHistory, applicationStatusLabel, applicationStatusTone, applicationTrackingStarted, applicationWasSubmitted } from '../../features/applications/domain/applicationTracking';
import { useApplicationNotesAutosave } from '../../shared/editing/useApplicationNotesAutosave';
import AutosaveTextarea from '../../shared/ui/AutosaveTextarea.vue';
import OpportunityFeedbackControls from '../../features/opportunities/components/OpportunityFeedbackControls.vue';
import OpportunityDispositionControls from '../../features/opportunities/components/OpportunityDispositionControls.vue';
import { isOpportunityInPast } from '../../features/opportunities/domain/opportunityDisposition';
import OpportunityContext from '../../features/opportunities/components/OpportunityContext.vue';
import ApplicationWorkspace from '../../features/applications/components/ApplicationWorkspace.vue';
import MetaSearchEditor from '../../features/meta-search/components/MetaSearchEditor.vue';
import ApplicationIdentifier from '../../features/applications/components/ApplicationIdentifier.vue';
import ApplicationDeadlineCalendar from '../../features/applications/components/ApplicationDeadlineCalendar.vue';
import WorkspaceDetailHeader from '../../shared/ui/WorkspaceDetailHeader.vue';
import { removeApplicationCv } from '../../features/applications/applicationCv';
import { useToasts, useToastWatch, useSaveStateToast } from '../../shared/ui/useToasts';
import DesktopSidebarPortal from '../../shared/ui/DesktopSidebarPortal.vue';
import { useDesktopSidebar } from '../../shared/ui/desktopSidebar';
import { createJobSwipe } from '../../features/opportunities/interaction/jobSwipe';
import { createJobCardSwipe } from '../../features/opportunities/interaction/jobCardSwipe';
import { useJobCardTrackHeight } from '../../features/opportunities/composables/useJobCardTrackHeight';
import { commitPendingTextareas } from '../../shared/editing/textareaCommit';
import { flushEditorSession } from '../../shared/editing/editorSession';

const props = withDefaults(defineProps<{
  client: SupabaseClient | null; userId: string; tab: 'opportunities' | 'applications'; lang: string;
  configurations: SavedConfiguration[]; selectedId: string; readVersion: (id: string) => CvState | null;
  createVariant?: (name: string, state: CvState) => string | null;
  projectId?: string;
  active?: boolean;
}>(), { active: true });
const desktopSidebar = useDesktopSidebar();
const sidebarActive = computed(() => desktopSidebar.value && props.active);
const emit = defineEmits<{ navigate: [tab: 'opportunities' | 'applications']; 'save-career-variant': [name: string, state: CvState]; 'edit-variant': [id: string] }>();
const { opportunities, applications, reviews, loading, saving, savingReview, error, opportunityReviewError, opportunityCommentError, createApplication,
  updateApplication, setApplicationStage, setApplicationChecklistItem, resetApplicationHistory, removeApplication, setOpportunityReview, setOpportunityComment, markOpportunityReviewed,
  saveOpportunityFeedback, saveOpportunityDisposition } = useCloudWorkspace(props.client, () => props.userId);
const blockingSave = computed(() => saving.value && !savingReview.value);
const startingApplication = shallowRef<{ opportunityId: string } | null>(null);
watch(() => props.userId, () => { startingApplication.value = null; }, { flush: 'sync' });
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const queries = reactive({ opportunities: '', applications: '' });
const query = computed({ get: () => queries[props.tab], set: (value: string) => { queries[props.tab] = value; } });
const statusFilter = ref('');
const reviewFilter = ref('all');
const showLowInterest = ref(false);
const deadlineFilter = ref<'current' | 'past'>('current');
const applicationDeadlineFilter = ref<'current' | 'past'>('current');
const filtersOpen = ref(false);
const filterToggle = ref<HTMLButtonElement | null>(null);
const showWithApplications = ref(false);
const sortBy = ref('deadline');
const applicationSortBy = ref('deadline');
const showApplicationIds = ref(false);
const showApplicationCalendars = ref(false);
const removingId = ref<string | null>(null);
const removalDialog = ref<HTMLDialogElement | null>(null);
const removedOpportunityId = ref<string | null>(null);
const visitedOpportunityVersions = ref(new Map<string, string | null>());
const selectedOpportunityId = ref<string | null>(null);
try { selectedOpportunityId.value = sessionStorage.getItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`); } catch { /* Optional navigation state. */ }
watch(selectedOpportunityId, (id) => { try { if (id) sessionStorage.setItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`, id); else sessionStorage.removeItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`); } catch { /* Optional navigation state. */ } });
const editingId = ref<string | null>(null);
try { editingId.value = sessionStorage.getItem(`CV_SELECTED_APPLICATION:${props.userId}`); } catch { /* Optional navigation state. */ }
watch(editingId, (id) => { try { if (id) sessionStorage.setItem(`CV_SELECTED_APPLICATION:${props.userId}`, id); else sessionStorage.removeItem(`CV_SELECTED_APPLICATION:${props.userId}`); } catch { /* Optional preference. */ } });
const notice = ref('');
const formError = ref('');
const resettingHistory = ref(false);
const historyResetError = ref('');
const tableScroll = ref<HTMLElement | null>(null);
const workspaceElement = ref<HTMLElement | null>(null);
const opportunityDetail = ref<HTMLElement | null>(null);
const applicationWorkspace = ref<InstanceType<typeof ApplicationWorkspace> | null>(null);
const searchTemplates = ref<InstanceType<typeof MetaSearchEditor> | null>(null);
const opportunityFeedback = ref<{ flush(): Promise<boolean> } | null>(null);
const applicationFeedback = ref<{ flush(): Promise<boolean> } | null>(null);
const opportunityDisposition = ref<{ flush(): Promise<boolean> } | null>(null);
const applicationDisposition = ref<{ flush(): Promise<boolean> } | null>(null);
const opportunityView = ref<'catalogue' | 'searches'>('catalogue');
const showingSearchTemplates = computed(() => props.tab === 'opportunities' && opportunityView.value === 'searches');
async function selectOpportunityView(view: 'catalogue' | 'searches') {
  if (!await flushTextareas()) return;
  opportunityView.value = view;
}
const opportunityNavigationIds = ref<string[]>([]);
const applicationNavigationIds = ref<string[]>([]);
let detailNavigationPending = false;
let listNavigationRequest = 0;
const now = ref(new Date());
const clockTimer = window.setInterval(() => { now.value = new Date(); }, 30_000);
onBeforeUnmount(() => { window.clearInterval(clockTimer); });
const reviewById = computed(() => new Map(reviews.value.map((item) => [item.opportunity_id, item])));
const reviewedVersionById = computed(() => new Map(opportunities.value.map((item) => {
  const localVisit = visitedOpportunityVersions.value.get(item.id);
  const savedVisit = reviewById.value.get(item.id)?.reviewed_updated_at;
  const versions = [localVisit, savedVisit].filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  return [item.id, versions.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0]];
})));
const recencyById = computed(() => new Map(opportunities.value.map((item) => [item.id, opportunityRecency(item, now.value, reviewedVersionById.value.get(item.id))])));
// The visit marker persists after the 24-hour badge and priority grouping expire.
const unseenById = computed(() => new Map(opportunities.value.map((item) => {
  const reviewedVersion = reviewedVersionById.value.get(item.id);
  const visitedWithoutVersion = !item.updated_at && !item.created_at && (visitedOpportunityVersions.value.has(item.id) || !!reviewedVersion);
  return [item.id, hasReviewedOpportunity(item, reviewedVersion) || visitedWithoutVersion ? null : recencyById.value.get(item.id) || (reviewedVersion ? 'updated' : 'new')];
})));
const fitScoreById = computed(() => new Map(opportunities.value.map((item) => [item.id, item.personal_fit.score ?? undefined])));
function showPersonalFitBadge(item: Opportunity): boolean {
  const score = fitScoreById.value.get(item.id);
  return score !== undefined && score > 9;
}
const salaryScoreById = computed(() => new Map(opportunities.value.map((item) => [item.id,
  readLivingStandard(item.data.living_standard)?.factors.affordability.score ?? undefined,
])));
function researchSummary(item: Opportunity): string {
  return item.research_summary?.trim() || '';
}
function opportunityLocation(item: Opportunity): string {
  return [...new Set([item.city?.trim(), item.country].filter(Boolean))].join(', ') || '—';
}
function fitLabel(score: number | undefined) { return score === undefined ? '' : props.lang === 'de' ? String(score).replace('.', ',') : String(score); }
const reviewState = (id: string): OpportunityReviewState => reviewById.value.get(id)?.state || 'unreviewed';
// Keep the control responsive while the persistence queue saves in user order.
// Filters continue to use confirmed state, so a failed save cannot hide a card.
const pendingReviewSelections = shallowReactive(new Map<string, { state: OpportunityReviewState; status: 'saving' | 'error' }>());
const reviewSelection = (id: string) => pendingReviewSelections.get(id)?.state ?? reviewState(id);
const reviewToasts = useToasts();
const reviewToastIds = new Map<string, number>();
function clearReviewSelections() {
  pendingReviewSelections.clear();
  reviewToastIds.forEach(id => reviewToasts.dismiss(id));
  reviewToastIds.clear();
}
watch(() => props.userId, clearReviewSelections, { flush: 'sync' });
onBeforeUnmount(clearReviewSelections);
const applicationByOpportunity = computed(() => new Map(applications.value.map((item) => [item.opportunity_id, item])));
const filteredOpportunities = computed(() => {
  const needle = query.value.toLocaleLowerCase().trim();
  return opportunities.value.filter((item) => (isOpportunityInPast(item, reviewById.value.get(item.id), now.value) === (deadlineFilter.value === 'past'))
    && (showWithApplications.value || !applicationByOpportunity.value.has(item.id))
    && (showLowInterest.value || reviewState(item.id) !== 'not_interested')
    && (reviewFilter.value === 'all' || reviewState(item.id) === reviewFilter.value)
    && (!needle || [item.title, item.institution, item.country, ...item.topics].join(' ').toLocaleLowerCase().includes(needle)))
    .toSorted((a, b) => sortBy.value === 'personal_fit' ? (fitScoreById.value.get(b.id) ?? -1) - (fitScoreById.value.get(a.id) ?? -1)
      : sortBy.value === 'salary_score' ? (salaryScoreById.value.get(b.id) ?? -1) - (salaryScoreById.value.get(a.id) ?? -1)
      : sortBy.value === 'title' ? a.title.localeCompare(b.title)
      : sortBy.value === 'institution' ? (a.institution || '').localeCompare(b.institution || '')
        : (opportunityDeadlineSortKey(a) - opportunityDeadlineSortKey(b)) * (deadlineFilter.value === 'past' ? -1 : 1));
});
const opportunityGroups = computed(() => {
  const recent: Opportunity[] = [];
  const other: Opportunity[] = [];
  for (const item of filteredOpportunities.value) {
    (recencyById.value.get(item.id) ? recent : other).push(item);
  }
  return [
    { key: 'recent', title: text('New & updated · 24h', 'Neu & aktualisiert · 24 Std.'), items: recent },
    { key: 'other', title: recent.length ? text('Other opportunities', 'Weitere Stellenangebote') : '', items: other },
  ].filter((group) => group.items.length);
});
const opportunityById = computed(() => new Map(opportunities.value.map((item) => [item.id, item])));
const filteredApplications = computed(() => applications.value.filter((item) => (isOpportunityInPast(item.context_json, reviewById.value.get(item.opportunity_id), now.value) === (applicationDeadlineFilter.value === 'past'))
  && (!statusFilter.value || item.status === statusFilter.value)
  && [item.application_code, item.id, item.context_json.title, item.context_json.institution, item.context_json.university].join(' ').toLocaleLowerCase().includes(query.value.toLocaleLowerCase().trim()))
  .toSorted((a, b) => applicationSortBy.value === 'title' ? contextTitle(a).localeCompare(contextTitle(b))
    : applicationSortBy.value === 'institution' ? contextInstitution(a).localeCompare(contextInstitution(b))
      : (opportunityDeadlineSortKey(a.context_json) - opportunityDeadlineSortKey(b.context_json)) * (applicationDeadlineFilter.value === 'past' ? -1 : 1)));
const applicationGroups = computed(() => {
  if (applicationDeadlineFilter.value === 'current') return [{ key: 'current', title: '', items: filteredApplications.value }];
  const applied: Application[] = [];
  const notApplied: Application[] = [];
  for (const item of filteredApplications.value) (applicationWasSubmitted(item) ? applied : notApplied).push(item);
  return [
    { key: 'applied', title: text('Applied', 'Beworben'), items: applied },
    { key: 'not-applied', title: text('Not applied', 'Nicht beworben'), items: notApplied },
  ].filter(group => group.items.length);
});
const editingApplication = computed(() => applications.value.find(({ id }) => id === editingId.value));
const { notes, status: notesStatus, error: notesError, flush: flushNotes } = useApplicationNotesAutosave({
  application: () => editingApplication.value,
  save: async (id, notes) => Boolean(await updateApplication(id, { notes })),
  owner: () => props.userId,
  errorMessage: () => error.value || text('Could not save notes. Please retry.', 'Notizen konnten nicht gespeichert werden. Bitte erneut versuchen.'),
});
useSaveStateToast(() => notesStatus.value, {
  scope: () => editingApplication.value ? `${props.userId}:${editingApplication.value.id}` : null,
  active: () => Boolean(props.active && props.tab === 'applications'),
  messages: {
    saving: () => text('Saving notes…', 'Notizen werden gespeichert…'),
    saved: () => text('Notes saved.', 'Notizen gespeichert.'),
    error: () => notesError.value,
  },
  retry: { label: () => text('Retry', 'Erneut versuchen'), run: flushNotes },
});
const selectedOpportunity = computed(() => opportunityById.value.get(selectedOpportunityId.value || ''));
// Both editors share one draft and recovery key for the underlying opportunity.
const evaluationOpportunityId = computed(() => props.tab === 'applications'
  ? editingApplication.value?.opportunity_id : selectedOpportunity.value?.id);
let editorSessionEpoch = 0;
let editorDisposed = false;
watch([() => props.userId, () => props.client, () => props.active, () => props.tab,
  () => props.tab === 'applications' ? editingId.value : selectedOpportunityId.value, evaluationOpportunityId, opportunityView], () => { editorSessionEpoch++; }, { flush: 'sync' });
onBeforeUnmount(() => { editorDisposed = true; editorSessionEpoch++; });
const { notes: opportunityComment, status: commentStatus, error: commentError, flush: flushComment } = useApplicationNotesAutosave({
  application: () => evaluationOpportunityId.value ? { id: evaluationOpportunityId.value,
    notes: reviewById.value.get(evaluationOpportunityId.value)?.comment } : null,
  save: async (id, comment) => {
    const owner = props.userId;
    const saved = await setOpportunityComment(id, comment);
    return Boolean(saved && props.userId === owner);
  },
  owner: () => props.userId,
  storagePrefix: 'CV_OPPORTUNITY_COMMENT_DRAFT',
  // Save validation enforces 12,000 codepoints; oversized failed drafts remain recoverable.
  maxLength: Number.MAX_SAFE_INTEGER,
  errorMessage: () => opportunityCommentError.value || text('Could not save your evaluation. Please retry.', 'Deine Einschätzung konnte nicht gespeichert werden. Bitte erneut versuchen.'),
});
const commentToasts = useToasts();
let commentToastId = 0;
let commentToastStatus = '';
function clearCommentToast() {
  if (commentToastId && commentToastStatus !== 'saved') commentToasts.dismiss(commentToastId);
  commentToastId = 0;
}
watch([() => props.userId, evaluationOpportunityId, () => props.tab, () => props.active, commentStatus, commentError],
  ([owner, id, tab, active, status, message], previous) => {
    const changedItem = owner !== previous?.[0] || id !== previous?.[1] || tab !== previous?.[2];
    if (changedItem || !active) clearCommentToast();
    if (!id || !active) return;
    if (status === 'unsaved') {
      if (commentToastId) commentToasts.dismiss(commentToastId);
      commentToastId = 0;
      return;
    }
    if (status === 'saved' && (changedItem || previous?.[4] !== 'saving')) return;
    commentToastStatus = status;
    commentToastId = commentToasts.notify({
      key: `opportunity-comment:${owner}:${id}`,
      message: status === 'error' ? message : status === 'saving'
        ? text('Saving evaluation…', 'Einschätzung wird gespeichert…')
        : text('Evaluation saved.', 'Einschätzung gespeichert.'),
      tone: status === 'error' ? 'error' : status === 'saving' ? 'info' : 'success',
      passive: status === 'saving',
      action: status === 'error' ? { label: text('Retry', 'Erneut versuchen'), run: () => {
        if (props.userId !== owner || evaluationOpportunityId.value !== id || props.tab !== tab || !props.active) return true;
        return flushComment();
      } } : undefined,
    });
  });
onBeforeUnmount(clearCommentToast);
const showingDetail = computed(() => props.tab === 'opportunities' ? Boolean(selectedOpportunity.value) : Boolean(editingApplication.value));
useJobCardTrackHeight(tableScroll, () => props.active && !showingDetail.value);
const statusNames: Record<string, [string, string]> = {
  unreviewed: ['Not reviewed', 'Ungeprüft'], not_interested: ['Low', 'Gering'], interested: ['Medium', 'Mittel'], strong_interest: ['High', 'Hoch'],
};
function statusLabel(value: string) { const pair = statusNames[value]; return pair ? text(...pair) : applicationStatusLabel(value, props.lang); }
function contextTitle(item: Application) { return String(item.context_json.title || opportunityById.value.get(item.opportunity_id)?.title || text('Application', 'Bewerbung')); }
function contextInstitution(item: Application) { return String(item.context_json.institution || item.context_json.university || ''); }
function contacts(item: Application): { name: string; email: string }[] {
  const raw = item.context_json.contacts ?? item.context_json.contact ?? item.context_json.supervisors ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  const people = values.flatMap((entry) => {
    if (typeof entry === 'string') return [{ name: safeEmailUrl(entry) ? '' : entry, email: safeEmailUrl(entry) ? entry : '' }];
    if (!entry || typeof entry !== 'object') return [];
    return [{ name: typeof entry.name === 'string' ? entry.name : '', email: typeof entry.email === 'string' ? entry.email : '' }];
  }).filter(({ name, email }) => name || email);
  return people.length ? people : item.contact_email ? [{ name: '', email: item.contact_email }] : [];
}
const statusHistory = computed(() => editingApplication.value ? applicationStatusHistory(editingApplication.value) : []);
watch([editingId, () => props.userId], () => { historyResetError.value = ''; });
function timestampLabel(value: string) {
  return new Intl.DateTimeFormat(props.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
}
watch(() => props.tab, () => { filtersOpen.value = false; notice.value = ''; cancelRemoval(); removedOpportunityId.value = null; });
watch(() => props.userId, () => { filtersOpen.value = false; editingId.value = null; selectedOpportunityId.value = null; cancelRemoval(); removedOpportunityId.value = null; visitedOpportunityVersions.value = new Map(); });
watch(() => props.active, active => { if (!active) filtersOpen.value = false; });
function closeFilters(event: KeyboardEvent) {
  if (!filtersOpen.value) return;
  event.preventDefault();
  event.stopPropagation();
  filtersOpen.value = false;
  nextTick(() => filterToggle.value?.focus({ preventScroll: true }));
}
function focusResult(kind: 'opportunities' | 'applications', id: string) {
  nextTick(() => {
    if (props.tab !== kind) return;
    const row = Array.from(tableScroll.value?.querySelectorAll<HTMLElement>('[data-item-id]') || []).find((item) => item.dataset.itemId === id);
    if (row && window.matchMedia('(max-width: 760px)').matches) {
      const track = row.closest<HTMLElement>('.jobs-card-track');
      if (track) {
        const inset = track.clientLeft + (parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0);
        track.scrollTo({ left: track.scrollLeft + row.getBoundingClientRect().left - track.getBoundingClientRect().left - inset, behavior: 'instant' });
      }
    }
    row?.querySelector<HTMLButtonElement>('.jobs-row-toggle')?.focus({ preventScroll: true });
  });
}
function openOpportunity(id: string, keepOrder = false) {
  const opportunity = opportunityById.value.get(id);
  if (!opportunity) return;
  listNavigationRequest++;
  if (!keepOrder) opportunityNavigationIds.value = opportunityGroups.value.flatMap(group => group.items.map(item => item.id));
  filtersOpen.value = false;
  recordOpportunityVisit(opportunity);
  selectedOpportunityId.value = id;
  nextTick(() => {
    opportunityDetail.value?.querySelector('.opportunity-detail__body')?.scrollTo({ top: 0 });
    opportunityDetail.value?.focus({ preventScroll: true });
  });
}
function recordOpportunityVisit(opportunity: Opportunity) {
  const version = opportunity.updated_at || opportunity.created_at;
  if (visitedOpportunityVersions.value.has(opportunity.id) && visitedOpportunityVersions.value.get(opportunity.id) === version) return;
  // Move an opened result immediately, including while its remote receipt is pending.
  visitedOpportunityVersions.value.set(opportunity.id, version);
  void markOpportunityReviewed(opportunity);
}
watch([selectedOpportunity, () => props.tab], ([opportunity, tab]) => {
  if (opportunity && tab === 'opportunities') recordOpportunityVisit(opportunity);
}, { immediate: true });
async function closeOpportunity() {
  const id = selectedOpportunityId.value;
  commitPendingTextareas();
  if (((commentStatus.value !== 'saved' || opportunityFeedback.value || applicationFeedback.value || opportunityDisposition.value) && !await flushEvaluation()) || selectedOpportunityId.value !== id) return;
  const opportunity = id ? opportunityById.value.get(id) : undefined;
  if (opportunity) deadlineFilter.value = isOpportunityInPast(opportunity, reviewById.value.get(opportunity.id), now.value) ? 'past' : 'current';
  selectedOpportunityId.value = null;
  if (id) focusResult('opportunities', id);
}
function changeReview(item: Opportunity, event: Event) {
  return saveReviewSelection(item, (event.target as HTMLSelectElement).value as OpportunityReviewState);
}
async function saveReviewSelection(item: Opportunity, state: OpportunityReviewState): Promise<boolean> {
  notice.value = '';
  const owner = props.userId;
  const selection = { state, status: 'saving' as const };
  const previousToast = reviewToastIds.get(item.id);
  if (previousToast) reviewToasts.dismiss(previousToast);
  reviewToastIds.delete(item.id);
  pendingReviewSelections.set(item.id, selection);
  const result = await setOpportunityReview(item.id, selection.state);
  // An older response must never replace a newer choice or another account's draft.
  if (props.userId !== owner || pendingReviewSelections.get(item.id) !== selection) return true;
  if (!result) {
    const failed = { state, status: 'error' as const };
    pendingReviewSelections.set(item.id, failed);
    const message = opportunityReviewError.value || text('Could not save interest. Please retry.', 'Interesse konnte nicht gespeichert werden. Bitte erneut versuchen.');
    reviewToastIds.set(item.id, reviewToasts.notify({
      key: `opportunity-interest:${owner}:${item.id}`, tone: 'error',
      message: `${item.title}: ${message} ${text('Your choice is kept until you retry.', 'Deine Auswahl bleibt bis zum erneuten Versuch erhalten.')}`,
      action: { label: text('Retry', 'Erneut versuchen'), run: () => {
        if (props.userId !== owner || pendingReviewSelections.get(item.id) !== failed) return true;
        return saveReviewSelection(item, failed.state);
      } },
    }));
    return false;
  }
  pendingReviewSelections.delete(item.id);
  notice.value = result.state === 'not_interested' && !showLowInterest.value
    ? text('Marked as low interest. Check “Show low interest” to show it again.', 'Mit geringem Interesse markiert. Aktiviere „Geringes Interesse anzeigen“, um die Stelle wieder anzuzeigen.')
    : text('Your review state was saved.', 'Deine Bewertung wurde gespeichert.');
  return true;
}
function openApplication(application: Application, keepOrder = false) {
  listNavigationRequest++;
  if (!keepOrder) applicationNavigationIds.value = applicationGroups.value.flatMap(group => group.items.map(item => item.id));
  filtersOpen.value = false;
  editingId.value = application.id;
  formError.value = '';
  nextTick(() => workspaceElement.value?.querySelector<HTMLElement>('.application-workspace')?.focus({ preventScroll: true }));
}
watch(editingApplication, (application, previous) => { if (application && !previous) openApplication(application); });
async function closeApplication() {
  formError.value = '';
  const id = editingId.value;
  if (!await flushApplicationTextareas() || editingId.value !== id) return;
  const application = applications.value.find(item => item.id === id);
  if (application) applicationDeadlineFilter.value = isOpportunityInPast(application.context_json, reviewById.value.get(application.opportunity_id), now.value) ? 'past' : 'current';
  editingId.value = null;
  if (id) focusResult('applications', id);
}
// The main workspace buttons always open a list, even when its tab is already active.
// Keep this separate from internal navigation that opens a particular application.
async function openList(kind: 'opportunities' | 'applications'): Promise<boolean> {
  const request = ++listNavigationRequest;
  const owner = props.userId;
  const opportunityId = selectedOpportunityId.value;
  const applicationId = editingId.value;
  if (!await flushTextareas()) return false;
  if (request !== listNavigationRequest || props.userId !== owner || selectedOpportunityId.value !== opportunityId || editingId.value !== applicationId) return false;
  filtersOpen.value = false;
  cancelRemoval();
  notice.value = '';
  if (kind === 'opportunities' && opportunityId) {
    const opportunity = opportunityById.value.get(opportunityId);
    if (opportunity) deadlineFilter.value = isOpportunityInPast(opportunity, reviewById.value.get(opportunity.id), now.value) ? 'past' : 'current';
  } else if (kind === 'applications' && applicationId) {
    const application = applications.value.find(item => item.id === applicationId);
    if (application) applicationDeadlineFilter.value = isOpportunityInPast(application.context_json, reviewById.value.get(application.opportunity_id), now.value) ? 'past' : 'current';
  }
  if (kind === 'opportunities') selectedOpportunityId.value = null;
  else editingId.value = null;
  const id = kind === 'opportunities' ? opportunityId : applicationId;
  if (id) focusResult(kind, id);
  return true;
}
function flushApplicationTextareas() {
  const epoch = editorSessionEpoch;
  const workspace = applicationWorkspace.value, feedback = applicationFeedback.value, disposition = applicationDisposition.value;
  return flushEditorSession({
    current: () => !editorDisposed && epoch === editorSessionEpoch && workspace === applicationWorkspace.value
      && feedback === applicationFeedback.value && disposition === applicationDisposition.value,
    steps: [
      ...(workspace ? [() => workspace.flush()] : []),
      ...(feedback ? [() => feedback.flush()] : []),
      ...(disposition ? [() => disposition.flush()] : []),
      flushNotes,
    ],
  });
}
function flushEvaluation() {
  const epoch = editorSessionEpoch;
  const feedback = opportunityFeedback.value, disposition = opportunityDisposition.value;
  const applicationAction = applicationDisposition.value, applicationReview = applicationFeedback.value;
  return flushEditorSession({
    current: () => !editorDisposed && epoch === editorSessionEpoch && feedback === opportunityFeedback.value
      && disposition === opportunityDisposition.value && applicationAction === applicationDisposition.value && applicationReview === applicationFeedback.value,
    steps: [
      flushComment,
      ...(feedback ? [() => feedback.flush()] : []),
      ...(disposition ? [() => disposition.flush()] : []),
      ...(applicationAction ? [() => applicationAction.flush()] : []),
      ...(applicationReview ? [() => applicationReview.flush()] : []),
    ],
  });
}
function flushTextareas() {
  const epoch = editorSessionEpoch, searches = searchTemplates.value;
  return flushEditorSession({
    current: () => !editorDisposed && epoch === editorSessionEpoch && searches === searchTemplates.value,
    steps: [...(searches ? [() => searches.flush()] : []), flushEvaluation, flushApplicationTextareas],
  });
}
const flush = flushTextareas;
defineExpose({ openList, flush, flushTextareas });

let swipeAnimations: Animation[] = [];
function cancelSwipeTransition() {
  swipeAnimations.forEach(animation => animation.cancel());
  swipeAnimations = [];
}
function animateSwipedDetail(kind: 'opportunities' | 'applications', direction: -1 | 1) {
  cancelSwipeTransition();
  const root = workspaceElement.value;
  if (!root || !window.matchMedia('(max-width: 760px)').matches) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Animate content only: transforming the whole workspace would move its fixed controls.
  const selector = kind === 'opportunities'
    ? '.opportunity-detail__body, .opportunity-detail .workspace-detail-header__title, .opportunity-detail .workspace-detail-header__metadata'
    : '.application-mobile-title, .application-workspace .workflow-body, .application-header .workspace-detail-header__title, .application-header .workspace-detail-header__metadata';
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (!element.animate || !element.getClientRects().length) continue;
    swipeAnimations.push(element.animate([
      { opacity: 0.82, transform: reducedMotion ? 'none' : `translateX(${direction * 20}px)` },
      { opacity: 1, transform: reducedMotion ? 'none' : 'translateX(0)' },
    ], { duration: reducedMotion ? 100 : 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }));
  }
}

async function navigateDetail(direction: -1 | 1) {
  if (detailNavigationPending || blockingSave.value || startingApplication.value || removingId.value) return;
  const kind = props.tab;
  const owner = props.userId;
  const currentId = kind === 'opportunities' ? selectedOpportunityId.value : editingId.value;
  const orderedIds = kind === 'opportunities'
    ? (opportunityNavigationIds.value.length ? opportunityNavigationIds.value : opportunityGroups.value.flatMap(group => group.items.map(item => item.id)))
      .filter(id => opportunityById.value.has(id))
    : (applicationNavigationIds.value.length ? applicationNavigationIds.value : applicationGroups.value.flatMap(group => group.items.map(item => item.id)))
      .filter(id => applications.value.some(item => item.id === id));
  const index = orderedIds.indexOf(currentId || '');
  const nextId = index < 0 ? undefined : orderedIds[index + direction];
  if (!nextId) return;
  detailNavigationPending = true;
  try {
    if (kind === 'opportunities') commitPendingTextareas();
    const saved = await (kind === 'opportunities' ? flushEvaluation() : flushApplicationTextareas());
    if (!saved || props.userId !== owner || props.tab !== kind || !props.active
      || currentId !== (kind === 'opportunities' ? selectedOpportunityId.value : editingId.value)) return;
    if (kind === 'opportunities') openOpportunity(nextId, true);
    else {
      const application = applications.value.find(item => item.id === nextId);
      if (application) openApplication(application, true);
    }
    await nextTick();
    if (props.userId === owner && props.tab === kind && props.active
      && nextId === (kind === 'opportunities' ? selectedOpportunityId.value : editingId.value)) animateSwipedDetail(kind, direction);
  } finally { detailNavigationPending = false; }
}
const swipe = createJobSwipe({
  enabled: () => props.active && !showingSearchTemplates.value && showingDetail.value && !blockingSave.value && !startingApplication.value && !removingId.value
    && window.matchMedia('(max-width: 760px)').matches,
  onSwipe: direction => { void navigateDetail(direction); },
});
const cardSwipe = createJobCardSwipe({
  enabled: () => props.active && !showingSearchTemplates.value && !showingDetail.value && !filtersOpen.value
    && window.matchMedia('(max-width: 760px)').matches,
  root: () => tableScroll.value,
});
watch([() => props.tab, () => props.active, () => props.userId, selectedOpportunityId, editingId], () => { swipe.cancel(); cardSwipe.cancel(); cancelSwipeTransition(); });
onBeforeUnmount(() => { swipe.cancel(); cardSwipe.cancel(); cancelSwipeTransition(); });
async function toggleApplication(application: Application) {
  if (saving.value) return;
  formError.value = '';
  const previous = editingId.value;
  if (!await flushApplicationTextareas() || editingId.value !== previous) return;
  if (editingId.value !== application.id) {
    openApplication(application);
    return;
  }
  editingId.value = null;
}
async function startApplication(item: Opportunity) {
  if (startingApplication.value || blockingSave.value) return;
  const operation = { opportunityId: item.id };
  startingApplication.value = operation;
  const owner = props.userId;
  const kind = props.tab;
  const selectedId = selectedOpportunityId.value;
  const request = listNavigationRequest;
  const stillCurrent = () => props.userId === owner && props.tab === kind && props.active && selectedOpportunityId.value === selectedId && listNavigationRequest === request;
  notice.value = '';
  try {
    commitPendingTextareas();
    if (selectedId === item.id && !await flushEvaluation()) return;
    if (!stillCurrent()) return;
    const existing = applicationByOpportunity.value.get(item.id);
    const application = existing || await createApplication({ opportunityId: item.id });
    if (!application || !stillCurrent()) return;
    emit('navigate', 'applications');
    await nextTick();
    // The parent may still be flushing editors before activating Applications.
    if (props.userId !== owner || !props.active || listNavigationRequest !== request) return;
    applicationDeadlineFilter.value = isOpportunityInPast(application.context_json, reviewById.value.get(application.opportunity_id), now.value) ? 'past' : 'current';
    openApplication(application);
    notice.value = existing ? '' : text('Application created with all opportunity context. Assign a career variant in the CV tab when ready.', 'Bewerbung mit allen Stellendaten angelegt. Weise im CV-Tab eine Karrierevariante zu, sobald du bereit bist.');
  } finally {
    if (startingApplication.value === operation) startingApplication.value = null;
  }
}
async function changeApplicationStatus(item: Application, event: Event) {
  notice.value = '';
  const target = event.target as HTMLSelectElement;
  const status = target.value as Application['status'];
  if (!await flushApplicationTextareas()) { target.value = applicationTrackingStarted(item) ? item.status : ''; return; }
  const result = await updateApplication(item.id, { status });
  if (!result) target.value = applicationTrackingStarted(item) ? item.status : '';
  else { notice.value = text('Application status saved.', 'Bewerbungsstatus gespeichert.'); }
}
async function resetTrackingHistory(item: Application) {
  if (saving.value || resettingHistory.value || statusHistory.value.length < 2) return;
  const owner = props.userId;
  resettingHistory.value = true;
  historyResetError.value = '';
  try {
    const draftsSaved = await flushApplicationTextareas();
    if (props.userId !== owner || editingId.value !== item.id) return;
    if (!draftsSaved) {
      historyResetError.value = text('Pending edits could not be saved. Please retry.', 'Ausstehende Änderungen konnten nicht gespeichert werden. Bitte erneut versuchen.');
      return;
    }
    const result = await resetApplicationHistory(item.id);
    if (props.userId !== owner || editingId.value !== item.id) return;
    if (!result) historyResetError.value = text('Could not reset history. Please retry.', 'Der Verlauf konnte nicht zurückgesetzt werden. Bitte erneut versuchen.');
    else notice.value = text('Application history reset.', 'Bewerbungsverlauf zurückgesetzt.');
  } finally { resettingHistory.value = false; }
}
async function changeChecklist(item: Application, key: string, completed: boolean) {
  await setApplicationChecklistItem(item.id, key, completed);
}
async function confirmRemoval(item: Application) {
  notice.value = '';
  if (!await flushApplicationTextareas()) return;
  if (!await removeApplication(item.id)) return;
  cancelRemoval();
  if (editingId.value === item.id) editingId.value = null;
  try { removeApplicationCv(props.userId, item.id); } catch { /* Other local backups remain available. */ }
  removedOpportunityId.value = item.opportunity_id;
  notice.value = text('Application removed. The opportunity is available again.', 'Bewerbung entfernt. Die Stelle ist wieder verfügbar.');
}
async function requestDetailRemoval(item: Application) {
  removingId.value = item.id;
  await nextTick();
  if (editingId.value === item.id && removingId.value === item.id && !removalDialog.value?.open) removalDialog.value?.showModal();
}
function cancelRemoval() {
  removingId.value = null;
  removalDialog.value?.close();
}
async function showRemovedOpportunity(id: string) {
  const opportunity = id && opportunityById.value.get(id);
  emit('navigate', 'opportunities');
  await nextTick();
  query.value = ''; reviewFilter.value = 'all'; showLowInterest.value = false;
  if (opportunity) {
    deadlineFilter.value = isOpportunityInPast(opportunity, reviewById.value.get(opportunity.id), now.value) ? 'past' : 'current';
    openOpportunity(opportunity.id);
  }
}
useToastWatch(() => error.value, { tone: 'error' });
useToastWatch(() => historyResetError.value, { tone: 'error' });
useToastWatch(() => props.active && loading.value ? text('Loading workspace…', 'Arbeitsbereich wird geladen…') : '', { passive: true });
useToastWatch(() => formError.value !== error.value ? formError.value : '', { tone: 'error' });
useToastWatch(() => notice.value, () => {
  const id = removedOpportunityId.value;
  const removed = notice.value === text('Application removed. The opportunity is available again.', 'Bewerbung entfernt. Die Stelle ist wieder verfügbar.');
  return { tone: 'success', action: id && removed ? { label: text('View opportunity', 'Stelle ansehen'), run: () => showRemovedOpportunity(id) } : undefined };
});
</script>

<template>
  <section :id="`builder-group-${tab}`" ref="workspaceElement" class="jobs-workspace" :aria-busy="loading || blockingSave" :aria-label="tab === 'opportunities' ? text('Opportunities', 'Stellenangebote') : text('Applications', 'Bewerbungen')"
    @touchstart.passive="swipe.onTouchStart" @touchmove="swipe.onTouchMove" @touchend.passive="swipe.onTouchEnd" @touchcancel.passive="swipe.cancel" @click.capture="swipe.onClickCapture">
    <DesktopSidebarPortal area="subtabs" :active="props.active && tab === 'opportunities' && (!showingDetail || showingSearchTemplates)">
      <div v-if="tab === 'opportunities' && (!showingDetail || showingSearchTemplates)" class="opportunity-navigation">
        <nav class="opportunity-subtabs workspace-subtabs" :aria-label="text('Opportunity sections', 'Bereiche für Stellenangebote')">
          <button class="btn" :class="{ 'is-active': opportunityView === 'catalogue' }" type="button" :aria-pressed="opportunityView === 'catalogue'" @click="selectOpportunityView('catalogue')"><font-awesome-icon :icon="['fas', 'briefcase']" aria-hidden="true" /><span>{{ text('Results', 'Ergebnisse') }}</span></button>
          <button class="btn" :class="{ 'is-active': opportunityView === 'searches' }" type="button" :aria-pressed="opportunityView === 'searches'" @click="selectOpportunityView('searches')"><font-awesome-icon :icon="faMagnifyingGlass" aria-hidden="true" /><span>{{ text('Meta research', 'Metasuche') }}</span></button>
        </nav>
      </div>
    </DesktopSidebarPortal>
    <MetaSearchEditor v-if="showingSearchTemplates" ref="searchTemplates" :client="client" :user-id="userId" :lang="lang" :sidebar-active="props.active" :project-id="projectId" />
    <template v-else>
    <DesktopSidebarPortal area="major" :active="props.active !== false && !showingDetail">
    <div v-show="!showingDetail" class="jobs-toolbar jobs-sidebar-controls" :class="{ 'jobs-toolbar--sidebar': sidebarActive }" @keydown.esc="closeFilters">
      <label class="jobs-search"><span>{{ text('Search', 'Suchen') }}</span><input v-model="query" type="search" :placeholder="tab === 'applications' ? text('Title, institution or application ID…', 'Titel, Einrichtung oder Bewerbungs-ID…') : text('Title, institution or country…', 'Titel, Einrichtung oder Land…')" /></label>
      <button ref="filterToggle" class="btn jobs-filter-toggle" type="button" :aria-label="text('Filters', 'Filter')" :title="text('Filters', 'Filter')" :aria-expanded="filtersOpen" :aria-controls="`jobs-${tab}-filters`" @click="filtersOpen = !filtersOpen"><font-awesome-icon :icon="faFilter" aria-hidden="true" /></button>
      <div :id="`jobs-${tab}-filters`" class="jobs-filters" :class="{ 'is-open': filtersOpen }">
        <template v-if="tab === 'opportunities'">
        <label>{{ text('Review state', 'Bewertung') }}<select v-model="reviewFilter"><option value="all">{{ text('All review states', 'Alle Bewertungen') }}</option><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label>
        <label>{{ text('Opportunities', 'Stellenangebote') }}<select v-model="deadlineFilter"><option value="current">{{ text('Current opportunities', 'Aktuelle Stellenangebote') }}</option><option value="past">{{ text('Past opportunities', 'Vergangene Stellenangebote') }}</option></select></label>
        <label>{{ text('Sort by', 'Sortieren nach') }}<select v-model="sortBy"><option value="deadline">{{ text('Deadline', 'Frist') }}</option><option value="title">{{ text('Title', 'Titel') }}</option><option value="institution">{{ text('Institution', 'Einrichtung') }}</option><option value="personal_fit">{{ text('Personal fit: high to low', 'Persönliche Passung: absteigend') }}</option><option value="salary_score">{{ text('Salary score: high to low', 'Gehaltsbewertung: absteigend') }}</option></select></label>
        <DesktopSidebarPortal area="minor" :active="props.active !== false && !showingDetail">
          <div class="jobs-filter-checks jobs-sidebar-controls"><label class="jobs-check"><input v-model="showWithApplications" type="checkbox" /> {{ text('Show opportunities with applications', 'Stellen mit Bewerbungen anzeigen') }}</label><label class="jobs-check"><input v-model="showLowInterest" type="checkbox" /> {{ text('Show low interest', 'Geringes Interesse anzeigen') }}</label></div>
        </DesktopSidebarPortal>
        </template>
        <template v-else><label>{{ text('Status', 'Status') }}<select v-model="statusFilter"><option value="">{{ text('All statuses', 'Alle Status') }}</option><option v-for="status in APPLICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></label>
        <label>{{ text('Applications', 'Bewerbungen') }}<select v-model="applicationDeadlineFilter"><option value="current">{{ text('Current applications', 'Aktuelle Bewerbungen') }}</option><option value="past">{{ text('Past applications', 'Vergangene Bewerbungen') }}</option></select></label>
        <label>{{ text('Sort by', 'Sortieren nach') }}<select v-model="applicationSortBy"><option value="deadline">{{ text('Deadline', 'Frist') }}</option><option value="title">{{ text('Title', 'Titel') }}</option><option value="institution">{{ text('Institution', 'Einrichtung') }}</option></select></label>
        <DesktopSidebarPortal area="minor" :active="props.active !== false && !showingDetail">
          <div class="jobs-filter-checks jobs-sidebar-controls jobs-application-display-options">
            <label class="jobs-check"><input v-model="showApplicationIds" type="checkbox" /> {{ text('Show application ID', 'Bewerbungs-ID anzeigen') }}</label>
            <label class="jobs-check"><input v-model="showApplicationCalendars" type="checkbox" /> {{ text('Show ICS download', 'ICS-Download anzeigen') }}</label>
          </div>
        </DesktopSidebarPortal>
        </template>
      </div>
      <span class="jobs-count">{{ tab === 'opportunities' ? filteredOpportunities.length : filteredApplications.length }} {{ text('results', 'Ergebnisse') }}</span>
    </div>
    </DesktopSidebarPortal>
    <div v-show="!showingDetail" ref="tableScroll" class="jobs-table-scroll" :class="{ 'jobs-table-scroll--opportunities': tab === 'opportunities' }" tabindex="0" :aria-label="text('Job results', 'Stellen und Bewerbungen')"
      @touchstart.passive="cardSwipe.onTouchStart" @touchmove="cardSwipe.onTouchMove" @touchend.passive="cardSwipe.onTouchEnd" @touchcancel.passive="cardSwipe.cancel" @wheel.passive="cardSwipe.onWheel" @click.capture="cardSwipe.onClickCapture">
      <table v-if="tab === 'opportunities'" class="jobs-opportunities-table">
        <colgroup><col style="width: 38%" /><col style="width: 25%" /><col style="width: 10%" /><col style="width: 12%" /><col style="width: 15%" /></colgroup>
        <thead><tr><th scope="col">{{ text('Opportunity', 'Stelle') }}</th><th scope="col">{{ text('Topics', 'Themen') }}</th><th scope="col">{{ text('Country', 'Land') }}</th><th scope="col">{{ text('Deadline', 'Frist') }}</th><th scope="col">{{ text('Your review', 'Deine Bewertung') }}</th></tr></thead>
        <tbody v-if="filteredOpportunities.length" class="jobs-card-track">
        <template v-for="group in opportunityGroups" :key="group.key">
          <tr v-if="group.title" class="jobs-group-row" :data-opportunity-group="group.key"><th scope="rowgroup" colspan="5">{{ group.title }} <span>{{ group.items.length }}</span></th></tr>
          <template v-for="item in group.items" :key="item.id">
          <tr :data-item-id="item.id" class="jobs-result-row" :class="{ 'jobs-opportunity--new': recencyById.get(item.id) === 'new', 'jobs-opportunity--updated': recencyById.get(item.id) === 'updated', 'jobs-opportunity--unseen-new': unseenById.get(item.id) === 'new', 'jobs-opportunity--unseen-updated': unseenById.get(item.id) === 'updated' }" @click="openOpportunity(item.id)">
            <td class="jobs-cell-heading"><button class="jobs-row-toggle" type="button" :aria-label="`${text('Open opportunity:', 'Stelle öffnen:')} ${item.title}`" @click.stop="openOpportunity(item.id)"><strong>{{ item.title }}</strong></button><span class="jobs-subline">{{ item.institution || '—' }}</span><div v-if="recencyById.get(item.id) || (showPersonalFitBadge(item))" class="jobs-opportunity-badges"><span v-if="recencyById.get(item.id)" class="jobs-badge" :class="`jobs-badge--${recencyById.get(item.id)}`" :title="recencyById.get(item.id) === 'new' ? text('Added within the last 24 hours', 'In den letzten 24 Stunden hinzugefügt') : text('Updated within the last 24 hours', 'In den letzten 24 Stunden aktualisiert')">{{ recencyById.get(item.id) === 'new' ? text('New · 24h', 'Neu · 24 Std.') : text('Updated · 24h', 'Aktualisiert · 24 Std.') }}</span><span v-if="showPersonalFitBadge(item)" class="jobs-badge jobs-fit-score" :class="fitTone(fitScoreById.get(item.id)) && `jobs-fit-score--${fitTone(fitScoreById.get(item.id))}`" :aria-label="`${text('Personal fit', 'Persönliche Passung')}: ${fitLabel(fitScoreById.get(item.id))}`" :title="text('Personal fit score', 'Bewertung der persönlichen Passung')">{{ fitLabel(fitScoreById.get(item.id)) }}</span></div></td>
            <td v-if="researchSummary(item)" class="jobs-card-summary jobs-cell-wide"><p>{{ researchSummary(item) }}</p></td>
            <td class="jobs-topics jobs-cell-wide" :data-label="text('Topics', 'Themen')">{{ item.topics.join(' · ') || '—' }}</td>
            <td class="jobs-card-location" :data-label="text('Country', 'Land')" :data-mobile-label="text('Location', 'Ort')"><span class="jobs-card-country">{{ item.country || '—' }}</span><span class="jobs-card-location-text">{{ opportunityLocation(item) }}</span></td><td class="jobs-card-deadline" :data-label="text('Deadline', 'Frist')"><span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(item, now) }">{{ formatOpportunityDeadline(item, lang) }}</span></td>
            <td class="jobs-cell-state" :data-label="text('Your review', 'Deine Bewertung')" @click.stop><select class="jobs-review-select" :aria-label="`${text('Review state for', 'Bewertung für')} ${item.title}`" :aria-invalid="pendingReviewSelections.get(item.id)?.status === 'error' || undefined" :value="reviewSelection(item.id)" @change="changeReview(item, $event)"><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select><button v-if="pendingReviewSelections.get(item.id)?.status === 'error'" class="btn" type="button" @click="saveReviewSelection(item, reviewSelection(item.id))">{{ text('Retry interest save', 'Interesse erneut speichern') }}</button></td>
            <td v-if="reviewById.get(item.id)?.comment?.trim()" class="jobs-cell-wide jobs-card-evaluation" :data-label="text('Personal Evaluation', 'Persönliche Einschätzung')"><p>{{ reviewById.get(item.id)?.comment }}</p></td>
          </tr>
        </template></template></tbody><tbody v-if="!loading && !filteredOpportunities.length"><tr><td colspan="5" class="jobs-empty"><p>{{ text('No matching opportunities. Adjust the deadline, application, review or search filters.', 'Keine passenden Stellen. Ändere die Frist-, Bewerbungs-, Bewertungs- oder Suchfilter.') }}</p></td></tr></tbody>
      </table>
      <table v-else class="jobs-applications-table">
        <colgroup><col style="width: 48%" /><col style="width: 18%" /><col style="width: 22%" /><col style="width: 12%" /></colgroup>
        <thead><tr><th scope="col">{{ text('Application', 'Bewerbung') }}</th><th scope="col">{{ text('Deadline', 'Frist') }}</th><th scope="col">{{ text('Contact person', 'Kontaktperson') }}</th><th scope="col">{{ text('Status', 'Status') }}</th></tr></thead>
        <template v-for="group in applicationGroups" :key="group.key">
        <tbody v-if="group.title" class="jobs-application-group-heading">
          <tr class="jobs-group-row" :data-application-group="group.key"><th :id="`jobs-application-group-${group.key}`" scope="rowgroup" colspan="4">{{ group.title }} <span>{{ group.items.length }}</span></th></tr>
        </tbody>
        <tbody v-if="group.items.length" class="jobs-card-track" :aria-labelledby="group.title ? `jobs-application-group-${group.key}` : undefined">
          <template v-for="item in group.items" :key="item.id">
          <tr :data-item-id="item.id" class="jobs-result-row" :class="{ 'is-expanded': editingId === item.id }" :aria-disabled="saving" @click="toggleApplication(item)"><td class="jobs-cell-heading"><button class="jobs-row-toggle" type="button" :disabled="saving" :aria-label="`${text('Open application:', 'Bewerbung öffnen:')} ${contextTitle(item)}`" @click.stop="toggleApplication(item)"><strong>{{ contextTitle(item) }}</strong></button><span class="jobs-subline">{{ contextInstitution(item) }}</span><ApplicationIdentifier v-if="showApplicationIds" :application="item" :lang="lang" /></td><td class="jobs-cell-wide" :data-label="text('Deadline', 'Frist')"><div class="jobs-application-deadline"><span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(item.context_json, now) }">{{ formatOpportunityDeadline(item.context_json, lang) }}</span><ApplicationDeadlineCalendar v-if="showApplicationCalendars" :application="item" :lang="lang" /></div></td>
            <td class="jobs-cell-wide jobs-cell-contacts" :data-label="text('Contact person', 'Kontaktperson')"><template v-for="(person, index) in contacts(item)" :key="index"><span class="jobs-subline">{{ person.name }}</span><a v-if="safeEmailUrl(person.email)" :href="safeEmailUrl(person.email)!" @click.stop>{{ person.email }}</a><span v-else>{{ person.email }}</span></template><span v-if="!contacts(item).length">{{ text('Not recorded', 'Nicht erfasst') }}</span></td>
            <td class="jobs-cell-state jobs-application-state" :data-label="text('Status', 'Status')" @click.stop><span class="jobs-badge" :class="`application-status--${applicationStatusTone(item.status)}`">{{ statusLabel(item.status) }}</span></td>
            <td v-if="reviewById.get(item.opportunity_id)?.comment?.trim()" class="jobs-cell-wide jobs-card-evaluation" :data-label="text('Personal Evaluation', 'Persönliche Einschätzung')"><p>{{ reviewById.get(item.opportunity_id)?.comment }}</p></td>
          </tr>

        </template></tbody></template><tbody v-if="!loading && !filteredApplications.length"><tr><td colspan="4" class="jobs-empty"><p>{{ applications.length ? text('No matching applications. Adjust the deadline, status or search filters.', 'Keine passenden Bewerbungen. Ändere die Frist-, Status- oder Suchfilter.') : text('No applications yet. Create one from an opportunity.', 'Noch keine Bewerbungen. Lege eine aus einem Stellenangebot an.') }}</p><button class="btn" type="button" @click="emit('navigate', 'opportunities')">{{ text('Browse opportunities', 'Stellenangebote ansehen') }}</button></td></tr></tbody>
      </table>
    </div>
    <section v-if="selectedOpportunity" v-show="tab === 'opportunities'" ref="opportunityDetail" class="opportunity-detail" :class="{ 'opportunity-detail--sidebar': sidebarActive }" :aria-label="selectedOpportunity.title" tabindex="-1">
      <WorkspaceDetailHeader class="opportunity-detail__header" :class="{ 'opportunity-detail__header--sidebar': sidebarActive }" :sidebar-active="props.active !== false && tab === 'opportunities'" :title="selectedOpportunity.title" :subtitle="selectedOpportunity.institution || undefined" :back-label="text('All opportunities', 'Alle Stellenangebote')" @back="closeOpportunity">
        <template #metadata>
          <span v-if="selectedOpportunity.country" class="opportunity-detail__country" :title="selectedOpportunity.country">{{ selectedOpportunity.country }}</span>
          <span class="opportunity-detail__deadline" :class="{ 'jobs-expired': isOpportunityDeadlinePassed(selectedOpportunity, now) }" :title="`${text('Deadline', 'Frist')}: ${formatOpportunityDeadline(selectedOpportunity, lang)}`" :aria-label="`${text('Deadline', 'Frist')}: ${formatOpportunityDeadline(selectedOpportunity, lang)}`"><span class="opportunity-detail__deadline-label">{{ text('Deadline', 'Frist') }}: </span>{{ formatOpportunityDeadline(selectedOpportunity, lang) }}</span>
          <span v-if="showPersonalFitBadge(selectedOpportunity)" class="jobs-badge jobs-fit-score opportunity-detail__fit" :class="fitTone(fitScoreById.get(selectedOpportunity.id)) && `jobs-fit-score--${fitTone(fitScoreById.get(selectedOpportunity.id))}`" :aria-label="`${text('Personal fit', 'Persönliche Passung')}: ${fitLabel(fitScoreById.get(selectedOpportunity.id))}`" :title="text('Personal fit score', 'Bewertung der persönlichen Passung')">{{ fitLabel(fitScoreById.get(selectedOpportunity.id)) }}</span>
        </template>
        <template v-if="applicationByOpportunity.has(selectedOpportunity.id)" #secondary-actions>
          <ApplicationIdentifier :application="applicationByOpportunity.get(selectedOpportunity.id)!" :lang="lang" />
        </template>
        <template #actions>
          <label class="jobs-detail-state jobs-sidebar-controls"><span class="jobs-action-label">{{ text('Your review', 'Deine Bewertung') }}</span><select :key="selectedOpportunity.id" :aria-label="text('Your review', 'Deine Bewertung')" :aria-invalid="pendingReviewSelections.get(selectedOpportunity.id)?.status === 'error' || undefined" :value="reviewSelection(selectedOpportunity.id)" @change="changeReview(selectedOpportunity, $event)"><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label>
          <button class="btn btn--success jobs-detail-action" type="button" :disabled="blockingSave || !!startingApplication" :aria-busy="!!startingApplication" @click="startApplication(selectedOpportunity)">
            <span v-if="startingApplication">{{ applicationByOpportunity.has(selectedOpportunity.id) ? text('Opening…', 'Öffnet…') : text('Creating…', 'Wird angelegt…') }}</span>
            <template v-else><span class="jobs-action-desktop">{{ applicationByOpportunity.has(selectedOpportunity.id) ? text('Open application', 'Bewerbung öffnen') : text('Create application', 'Bewerbung anlegen') }}</span><span class="jobs-action-mobile">{{ applicationByOpportunity.has(selectedOpportunity.id) ? text('Open', 'Öffnen') : text('Apply', 'Bewerben') }}</span></template>
          </button>
        </template>
      </WorkspaceDetailHeader>
      <div class="opportunity-detail__body">
        <button v-if="pendingReviewSelections.get(selectedOpportunity.id)?.status === 'error'" class="btn" type="button" @click="saveReviewSelection(selectedOpportunity, reviewSelection(selectedOpportunity.id))">{{ text('Retry interest save', 'Interesse erneut speichern') }}</button>
        <details :key="selectedOpportunity.id" class="opportunity-evaluation personal-evaluation disclosure-row" open>
          <summary id="opportunity-evaluation-heading">{{ text('Personal Evaluation', 'Persönliche Einschätzung') }}</summary>
          <OpportunityFeedbackControls v-if="tab === 'opportunities' && active" ref="opportunityFeedback" :owner-id="userId" :opportunity="selectedOpportunity" :review="reviewById.get(selectedOpportunity.id)"
            v-model:evaluation-text="opportunityComment" :evaluation-status="commentStatus" :evaluation-error="commentError" evaluation-input-id="opportunity-comment" evaluation-labelledby="opportunity-evaluation-heading"
            :application="applicationByOpportunity.get(selectedOpportunity.id)" :lang="lang" :busy="saving"
            :save-feedback="saveOpportunityFeedback" :flush-private-comment="flushComment" />
          <div v-else class="opportunity-comment">
            <AutosaveTextarea id="opportunity-comment" v-model="opportunityComment" aria-labelledby="opportunity-evaluation-heading" rows="2" :aria-invalid="commentError ? true : undefined" :placeholder="text('Add your assessment…', 'Deine Einschätzung…')" @commit="flushComment" />
          </div>
          <OpportunityDispositionControls v-if="tab === 'opportunities' && active" ref="opportunityDisposition" :owner-id="userId" :opportunity-id="selectedOpportunity.id" :review="reviewById.get(selectedOpportunity.id)" :save-disposition="saveOpportunityDisposition" :save-feedback="saveOpportunityFeedback" :busy="saving" :lang="lang" />
        </details>
        <OpportunityContext :key="selectedOpportunity.id" :context="selectedOpportunity" :lang="lang" />
      </div>
    </section>
    <ApplicationWorkspace ref="applicationWorkspace" tabindex="-1" :aria-label="editingApplication ? contextTitle(editingApplication) : undefined" v-if="editingApplication" v-show="tab === 'applications'" :active="props.active !== false && tab === 'applications'" :checklist-saving="saving" @toggle-checklist="(key, completed) => changeChecklist(editingApplication!, key, completed)" :key="userId + ':' + editingApplication.id" :application="editingApplication" :client="client" :user-id="userId" :lang="lang" :project-id="projectId" :configurations="configurations" :read-version="readVersion" :create-variant="createVariant" :flush-evaluation="flushEvaluation" :publish-cv="(state) => updateApplication(editingApplication!.id, { cvState: state })" @change-stage="stage => setApplicationStage(editingApplication!.id, stage)" @close="closeApplication" @edit-variant="id => emit('edit-variant', id)">
      <template #preparation-evaluation>
        <details class="application-evaluation personal-evaluation disclosure-row" open>
          <summary :id="`application-evaluation-${editingApplication.id}`">{{ text('Personal Evaluation', 'Persönliche Einschätzung') }}</summary>
          <OpportunityFeedbackControls v-if="tab === 'applications' && active && opportunityById.get(editingApplication.opportunity_id)" ref="applicationFeedback" :owner-id="userId" :opportunity="opportunityById.get(editingApplication.opportunity_id)!" :review="reviewById.get(editingApplication.opportunity_id)"
            v-model:evaluation-text="opportunityComment" :evaluation-status="commentStatus" :evaluation-error="commentError" :evaluation-labelledby="`application-evaluation-${editingApplication.id}`"
            :application="editingApplication" :lang="lang" :busy="saving"
            :save-feedback="saveOpportunityFeedback" :flush-private-comment="flushComment" />
          <div v-else class="opportunity-comment">
            <AutosaveTextarea v-model="opportunityComment" :aria-labelledby="`application-evaluation-${editingApplication.id}`" rows="3" :aria-invalid="commentError ? true : undefined" :placeholder="text('Add your assessment…', 'Deine Einschätzung…')" @commit="flushComment" />
          </div>
          <OpportunityDispositionControls v-if="tab === 'applications' && active" ref="applicationDisposition" :owner-id="userId" :opportunity-id="editingApplication.opportunity_id" :review="reviewById.get(editingApplication.opportunity_id)" :save-disposition="saveOpportunityDisposition" :save-feedback="saveOpportunityFeedback" :busy="saving" :lang="lang" />
        </details>
      </template>
      <template #preparation-actions>
        <button class="btn btn--danger jobs-remove-application" type="button" :disabled="saving" :aria-label="`${text('Remove application for', 'Bewerbung entfernen für')} ${contextTitle(editingApplication)}`" @click="requestDetailRemoval(editingApplication)">{{ text('Remove application', 'Bewerbung entfernen') }}</button>
      </template>
      <template #tracking-actions>
        <label class="jobs-detail-state"><span class="jobs-action-label">{{ text('Status', 'Status') }}</span><select class="application-status" :class="`application-status--${applicationStatusTone(applicationTrackingStarted(editingApplication) ? editingApplication.status : '')}`" :aria-label="`${text('Status for', 'Status für')} ${contextTitle(editingApplication)}`" :value="applicationTrackingStarted(editingApplication) ? editingApplication.status : ''" :disabled="saving" @change="changeApplicationStatus(editingApplication, $event)"><option value="" disabled>{{ text('Choose tracking status…', 'Verlaufsstatus wählen…') }}</option><option v-for="status in TRACKING_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></label>
      </template>
      <template #tracking>
        <section class="application-status-history" :aria-label="text('Status history', 'Statusverlauf')">
          <div class="application-status-history__header"><h3>{{ text('Status history', 'Statusverlauf') }}<InfoHint v-if="statusHistory.some(entry => !entry.changedAt)" :lang="lang" :label="text('Status history', 'Statusverlauf')" :text="text('Earlier status changes and their times were not recorded.', 'Frühere Statusänderungen und ihre Zeitpunkte wurden nicht erfasst.')" /></h3><button class="btn" type="button" :disabled="saving || resettingHistory || statusHistory.length < 2" @click="resetTrackingHistory(editingApplication)">{{ resettingHistory ? text('Resetting…', 'Wird zurückgesetzt…') : text('Reset history', 'Verlauf zurücksetzen') }}</button></div>
          <ol><li v-for="(entry, index) in statusHistory" :key="index" :class="`application-status--${applicationStatusTone(entry.status)}`" :aria-current="index === statusHistory.length - 1 ? 'step' : undefined">
            <strong>{{ statusLabel(entry.status) }}</strong><span v-if="index === statusHistory.length - 1" class="jobs-badge">{{ text('Current', 'Aktuell') }}</span>
            <time v-if="entry.changedAt" :datetime="entry.changedAt">{{ timestampLabel(entry.changedAt) }}</time><span v-else class="jobs-subline">{{ text('Time not recorded', 'Zeitpunkt nicht erfasst') }}</span>
          </li></ol>
        </section>
            <div class="application-inline-form">
              <div class="application-fields">
                <label class="application-notes">{{ text('Notes', 'Notizen') }}<AutosaveTextarea v-model="notes" rows="3" maxlength="20000" @commit="flushNotes" /></label>
                <button v-if="notesError" class="btn" type="button" @click="flushNotes">{{ text('Retry save', 'Speichern erneut versuchen') }}</button>
              </div>
            </div>

      </template>
    </ApplicationWorkspace>
    <dialog ref="removalDialog" class="jobs-removal-dialog" :aria-label="text('Remove application', 'Bewerbung entfernen')" @cancel="removingId = null">
      <div v-if="editingApplication && removingId === editingApplication.id" class="jobs-removal-confirm">
        <p class="app-hint">{{ text('Remove this application? Its notes, checklist progress and saved drafts will be deleted. Your CV versions remain available.', 'Bewerbung entfernen? Notizen, Checklistenfortschritt und gespeicherte Entwürfe werden gelöscht. Deine CV-Versionen bleiben erhalten.') }}</p>
        <div class="jobs-row-actions"><button class="btn" type="button" autofocus :disabled="saving" @click="cancelRemoval">{{ text('Cancel', 'Abbrechen') }}</button><button class="btn btn--danger" type="button" :disabled="saving" @click="confirmRemoval(editingApplication)">{{ text('Remove application', 'Bewerbung entfernen') }}</button></div>
      </div>
    </dialog>
    </template>
  </section>
</template>

<style scoped>
.jobs-workspace { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; color: var(--ui-text); scrollbar-width: thin; }
.jobs-workspace > .search-templates { flex: 1 1 auto; min-height: 0; }
.opportunity-navigation { flex: 0 0 auto; }

.jobs-workspace > :not(.jobs-table-scroll) { flex-shrink: 0; }
.jobs-workspace > .search-templates, .jobs-workspace > .application-workspace, .jobs-workspace > .opportunity-detail { flex: 1 1 auto; min-height: 0; }
.jobs-workspace > .application-workspace:focus, .opportunity-detail:focus { outline: none; }
.opportunity-detail { display: flex; flex-direction: column; min-width: 0; padding: 32px; overflow: hidden;}
.opportunity-detail__body { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-gutter: stable; }
.opportunity-comment { display: grid; gap: 8px; margin-bottom: 24px; }
.jobs-workspace .opportunity-comment label { display: block; font-size: 14px; font-weight: 600; }
.jobs-workspace .opportunity-comment textarea { box-sizing: border-box; min-height: 76px; resize: vertical; font-size: 14px; line-height: 1.5; }
.opportunity-comment textarea::placeholder { color: var(--ui-muted); opacity: 1; }
.jobs-workspace .personal-evaluation { border-top-color: transparent; }
.personal-evaluation .opportunity-comment { margin-bottom: 0; }
.application-status-history h3 { color: var(--ui-accent); margin: 0 0 12px; }
.application-status-history__header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.application-status-history__header h3 { margin: 0; }
.application-status-history__header .btn { min-height: 44px; }
.application-status-history ol { list-style: none; margin: 12px 0 0 5px; padding: 0 0 0 18px; border-left: 2px solid var(--ui-accent-border); }
.application-status-history li { position: relative; padding: 0 0 18px; font-size: 13px; }
.application-status-history li strong { color: var(--ui-accent); }
.application-status-history li::before { content: ''; position: absolute; left: -24px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--ui-accent-border); }
.application-status-history li[aria-current=step]::before { background: var(--ui-accent); }
.application-status-history time { display: block; margin-top: 5px; color: var(--ui-muted); font-variant-numeric: tabular-nums; }
.application-status-history .jobs-badge { margin-left: 9px; }
.jobs-workspace .jobs-detail-state { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.jobs-workspace .jobs-detail-state select { width: auto; min-width: 0; max-width: 100%; padding: 6px 9px; }
.jobs-workspace select.application-status { color: var(--ui-accent); background: var(--ui-active); border-color: var(--ui-accent-border); }
.jobs-workspace select.application-status option { color: var(--ui-text); background: var(--ui-control); }
.jobs-action-mobile { display: none; }
.jobs-remove-application { width: 100%; min-height: 44px; padding: 10px 16px; border-color: #ef4444; background: #b91c1c; color: #fff; font-weight: 600; }
.jobs-remove-application:hover:not(:disabled) { border-color: #f87171; background: #991b1b; }
.jobs-workspace > .jobs-table-scroll { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; }
.jobs-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.jobs-heading h1 { margin: 4px 0 8px; font-size: 27px; letter-spacing: -.6px; }
.jobs-heading p { margin: 0 0 12px; color: var(--ui-muted); line-height: 1.55; }
.jobs-toolbar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin: 14px 0 18px; }
.jobs-workspace label, .jobs-sidebar-controls label, label.jobs-sidebar-controls { display: grid; gap: 8px; font-size: 12px; }
.jobs-search { flex: 1; min-width: 200px; max-width: 450px; }
.jobs-toolbar .jobs-check, .jobs-filter-checks .jobs-check { display: flex; align-items: center; }
.jobs-filter-checks { display: grid; gap: 2px; }
.jobs-filters { display: contents; }
.jobs-filter-toggle { display: none; }
.jobs-count { margin-left: auto; color: var(--ui-muted); font-size: 12px; padding-bottom: 10px; font-variant-numeric: tabular-nums; }
.jobs-workspace input, .jobs-workspace select, .jobs-workspace textarea, .jobs-sidebar-controls :is(input, select, textarea) { width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); font: inherit; color-scheme: dark; }
.jobs-workspace input[type=checkbox], .jobs-sidebar-controls input[type=checkbox] { flex-shrink: 0; width: auto; }
.jobs-workspace :is(button, input, select, textarea, summary, a):focus-visible, .jobs-sidebar-controls :is(button, input, select, textarea):focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.jobs-workspace button:disabled, .jobs-sidebar-controls button:disabled { opacity: .5; cursor: not-allowed; }
.jobs-table-scroll { overflow-x: auto; }
.jobs-table-scroll:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; text-align: left; }
.jobs-opportunities-table, .jobs-applications-table { table-layout: fixed; min-width: 960px; }
.jobs-workspace td { min-width: 0; max-width: none; overflow-wrap: anywhere; }
.jobs-workspace th { position: sticky; top: 0; z-index: 1; }
th { padding: 13px 14px; white-space: nowrap; background: var(--ui-surface); color: var(--ui-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
.jobs-workspace .jobs-group-row th { position: static; padding: 11px 14px; border-top: 1px solid var(--ui-border); color: var(--ui-accent); background: var(--ui-control); font-size: 12px; text-transform: none; letter-spacing: 0; }
.jobs-group-row th span { margin-left: 6px; color: var(--ui-muted); font-weight: normal; }
td { padding: 16px 14px; vertical-align: top; border-top: 1px solid var(--ui-divider); line-height: 1.5; }
td:first-child { min-width: 220px; max-width: 340px; }
td a { color: var(--ui-accent); overflow-wrap: anywhere; }
.jobs-application-state { vertical-align: top; text-align: left; }
.jobs-application-state .jobs-badge { margin-top: 0; }
.jobs-application-deadline { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.jobs-application-deadline :deep(.application-deadline-calendar) { max-width: 100%; }
.jobs-subline { display: block; margin-top: 5px; color: var(--ui-muted); font-size: 11px; }
.jobs-topics { min-width: 130px; max-width: 220px; color: var(--ui-muted); }
.jobs-workspace .jobs-card-evaluation, .jobs-workspace .jobs-card-summary, .jobs-card-location-text { display: none; }
.jobs-workspace .jobs-review-select, .jobs-workspace .jobs-row-select { width: 100%; min-width: 0; padding: 7px 5px; font-size: 11px; cursor: pointer; }
.jobs-review-select, .jobs-detail-state select { touch-action: manipulation; }
.jobs-removal-confirm { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; color: #fecaca; }
.jobs-removal-confirm p { flex: 1; min-width: 240px; margin: 0; }
.jobs-removal-dialog { width: min(520px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 22px; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-surface); color: var(--ui-text); overflow: auto; box-sizing: border-box; }
.jobs-removal-dialog::backdrop { background: rgb(0 0 0 / 65%); }
.jobs-removal-dialog .jobs-row-actions { justify-content: flex-end; width: 100%; }
.jobs-row-actions { display: flex; flex-wrap: wrap; gap: 7px; min-width: 145px; }
.jobs-row-actions .btn { font-size: 11px; white-space: nowrap; }
.jobs-expired { color: #dfbc8a; }
.jobs-empty { padding: 45px 20px; text-align: center; color: var(--ui-muted); }
.jobs-empty .btn { display: block; margin: 16px auto 0; }
.jobs-opportunity-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.jobs-badge--new { background: #153e57; color: #b9e5ff; }
.jobs-badge--updated { background: #49351c; color: #ffe0a0; }
.jobs-fit-score--red { background: var(--ui-score-red-bg); color: var(--ui-score-red); }
.jobs-fit-score--yellow { background: var(--ui-score-yellow-bg); color: var(--ui-score-yellow); }
tr.jobs-opportunity--new { background: #0b202e; }
tr.jobs-opportunity--updated { background: #24241e; }
.jobs-opportunity--unseen-new > td:first-child { box-shadow: inset 3px 0 #77caff; }
.jobs-opportunity--unseen-updated > td:first-child { box-shadow: inset 3px 0 #efbf69; }
tr.is-expanded { background: var(--ui-active); }
.jobs-result-row { cursor: pointer; }
.jobs-result-row[aria-disabled="true"] { cursor: wait; }
.jobs-result-row:hover, .jobs-result-row:focus-within { background: var(--ui-surface-hover); }
.jobs-row-toggle { display: flex; align-items: baseline; gap: 8px; width: 100%; min-width: 0; padding: 0; border: 0; border-radius: 3px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.jobs-row-toggle strong { min-width: 0; overflow-wrap: anywhere; }
.jobs-review-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: 0 0 22px; }
.jobs-review-toolbar h2 { margin: 0 auto 0 0; font-size: 18px; color: var(--ui-accent); }
.jobs-review-toolbar > span { color: #92afa6; font-size: 11px; }
.application-inline-form { display: grid; gap: 14px; padding: 0; background: transparent; border: 0; border-radius: 0; }
.application-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.application-notes { grid-column: 1 / -1; }
.jobs-upload-preview summary { color: #a0e7ca; cursor: pointer; }
.jobs-upload-preview pre { max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #041016; font: 11px/1.5 monospace; }
@media (max-width: 1000px) {
  .jobs-opportunities-table, .jobs-applications-table { display: block; table-layout: auto; min-width: 0; }
  table colgroup { display: none; }
  table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  table tbody { display: grid; gap: 12px; }
  table tbody + tbody { margin-top: 12px; }
  table tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; min-width: 0; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-surface); }
  .jobs-workspace td { display: block; min-width: 0; max-width: none; padding: 11px 12px; border: 0; }
  td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 5px; color: var(--ui-muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; }
  .jobs-cell-heading, .jobs-cell-wide, .jobs-empty { grid-column: 1 / -1; }
  .jobs-workspace .jobs-application-state { display: flex; grid-column: 1 / -1; justify-content: flex-end; align-self: end; }
  .jobs-workspace .jobs-application-state::before { display: none; }
  .jobs-group-row { display: block; border: 0; border-radius: 0; }
  .jobs-group-row th { display: block; }
  .jobs-cell-heading { background: var(--ui-surface-hover); border-bottom: 1px solid var(--ui-border); }
  .jobs-row-toggle { font-size: 14px; }
  .jobs-workspace .jobs-row-select, .jobs-workspace .jobs-review-select { min-height: 40px; font-size: 12px; }
  .jobs-result-row .btn { min-height: 40px; }
  .jobs-removal-confirm p { min-width: 0; flex-basis: 100%; }
}
@media (min-width: 761px) {
  .opportunity-detail:not(.opportunity-detail--sidebar) { margin-bottom: 40px; }
  .opportunity-detail__header:not(.opportunity-detail__header--sidebar) :deep(.workspace-detail-header__controls) { position: fixed; inset-inline: 0; bottom: 0; z-index: 30; display: flex; align-items: center; gap: 20px; min-height: 66px; padding: 12px max(20px, calc((100vw - 1484px) / 2)); box-sizing: border-box; border-top: 1px solid var(--ui-border); background: var(--ui-shell); box-shadow: 0 -6px 20px #0003; }
  .opportunity-detail__header :deep(.workspace-detail-header__back) { gap: 8px; font-size: 13px; }
  .opportunity-detail__header :deep(.workspace-detail-header__actions) { flex: 1; justify-content: flex-end; gap: 20px; }
  .opportunity-detail__header .jobs-detail-action { font-size: 13px; }
  .jobs-toolbar--sidebar { display: grid; align-items: stretch; gap: 16px; margin: 0; }
  .jobs-toolbar--sidebar .jobs-search { min-width: 0; max-width: none; }
  .jobs-toolbar--sidebar .jobs-count { margin-left: 0; padding: 0; }
  .jobs-filter-checks { gap: 12px; }
}
@media (min-width: 761px) and (max-height: 600px) {
  .jobs-workspace { padding: 0; }
  .opportunity-detail { padding: 32px; }
}
@media (max-width: 760px) {
  .jobs-application-display-options,
  .jobs-applications-table :deep(.application-identifier),
  .jobs-applications-table :deep(.application-deadline-calendar) { display: none; }
  .jobs-workspace {
    --ui-surface: #112129;
    --ui-surface-hover: #20363e;
    --ui-control: #1a2d35;
    --ui-shell: #101c24;
    --ui-border: #3b555d;
    --ui-divider: #2b424b;
    padding: 0;
    font-size: 14px;
  }
  .opportunity-detail__body, .jobs-workspace :deep(.application-scroll-content) { overflow-x: hidden; }
  .jobs-heading h1 { font-size: 23px; }
  .jobs-heading p { font-size: 12px; }
  .jobs-toolbar { position: fixed; left: 0; right: 0; bottom: var(--mobile-tabs-height, 76px); z-index: 35; height: var(--mobile-context-row-height, 52px); box-sizing: border-box; align-items: center; margin: 0; padding: 3px max(8px, env(safe-area-inset-right, 0px)) 3px max(8px, env(safe-area-inset-left, 0px)); border-top: 1px solid var(--ui-border); background: var(--ui-shell); }
  .jobs-toolbar > :not(.jobs-search) { display: none; }
  .jobs-toolbar > .jobs-filter-toggle { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 44px; min-height: 44px; padding: 10px; }
  .jobs-toolbar:has(.jobs-filter-toggle) .jobs-search { flex-basis: 0; }
  .jobs-toolbar > .jobs-filters.is-open { display: grid; position: absolute; bottom: 100%; left: 0; right: 0; max-height: calc(100dvh - var(--mobile-tabs-height, 76px) - var(--mobile-context-row-height, 52px) - env(safe-area-inset-top, 0px) - 12px); overflow: auto; overscroll-behavior: contain; gap: 14px; padding: 16px max(16px, env(safe-area-inset-right, 0px)) 16px max(16px, env(safe-area-inset-left, 0px)); border-top: 1px solid var(--ui-border); background: var(--ui-shell); box-shadow: 0 -8px 24px rgb(0 0 0 / 25%); }
  .jobs-filters :is(select, .jobs-check) { min-height: 44px; }
  .jobs-search { flex-basis: 100%; max-width: none; min-width: 0; }
  .jobs-workspace .jobs-search input { height: 44px; padding: 8px 12px; }
  .jobs-search > span { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .jobs-workspace :is(input, select, textarea) { font-size: 16px; }
  .jobs-workspace label { font-size: 14px; }
  .jobs-workspace > .jobs-table-scroll { padding: 2px; scrollbar-gutter: auto; }
  .jobs-workspace > .jobs-table-scroll--opportunities { scrollbar-width: none; }
  .jobs-table-scroll--opportunities::-webkit-scrollbar { display: none; }
  .jobs-workspace .jobs-card-track {
    --jobs-card-peek: 24px;
    --jobs-card-gap: 12px;
    display: flex;
    align-items: flex-start;
    gap: var(--jobs-card-gap);
    width: 100%;
    height: var(--jobs-card-track-height, auto);
    box-sizing: border-box;
    margin-top: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: 0;
    overscroll-behavior-x: none;
    scrollbar-width: none;
  }
  .jobs-card-track::-webkit-scrollbar { display: none; }
  /* Give the last card enough scroll range to reach the same start snap point. */
  .jobs-workspace .jobs-card-track:has(> .jobs-result-row ~ .jobs-result-row)::after {
    content: '';
    flex: 0 0 calc(var(--jobs-card-peek) - var(--jobs-card-gap));
  }
  .jobs-workspace .jobs-card-track > .jobs-result-row {
    flex: 0 0 calc(100% - var(--jobs-card-peek));
    box-sizing: border-box;
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }
  .jobs-workspace .jobs-card-track:not(:has(> .jobs-result-row ~ .jobs-result-row)) > .jobs-result-row { flex-basis: 100%; }
  table { font-size: 14px; }
  .jobs-row-toggle { min-height: 44px; align-items: center; font-size: 16px; line-height: 1.35; }
  .jobs-workspace .jobs-row-toggle:focus-visible { outline-offset: -2px; }
  .jobs-subline { margin-top: 4px; font-size: 13px; line-height: 1.5; }
  .jobs-topics { font-size: 14px; }
  td[data-label]::before { margin-bottom: 4px; font-size: 12px; text-transform: none; letter-spacing: 0; }
  .jobs-workspace .jobs-group-row th { font-size: 15px; padding: 12px 2px 4px; border: 0; background: transparent; }
  table tbody { gap: 12px; }
  table tr { column-gap: 0; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-surface); }
  table .jobs-group-row { display: none; }
  .jobs-applications-table .jobs-group-row { display: block; }
  .jobs-applications-table .jobs-application-group-heading + tbody { margin-top: 0; }
  .jobs-workspace td { padding: 10px 14px; }
  .jobs-workspace .jobs-cell-state { display: none; }
  .jobs-workspace .jobs-application-state { display: flex; padding-top: 0; }
  .jobs-workspace .jobs-cell-heading { padding-top: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--ui-divider); background: rgb(220 230 226 / 4%); }
  .jobs-cell-heading :deep(.application-identifier) { margin-top: 8px; }
  .jobs-opportunities-table .jobs-cell-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; }
  .jobs-opportunities-table .jobs-cell-heading > .jobs-row-toggle { grid-area: 1 / 1 / 2 / -1; }
  .jobs-opportunities-table .jobs-cell-heading > .jobs-subline { grid-area: 3 / 1; align-self: end; }
  .jobs-opportunity-badges { display: contents; }
  .jobs-opportunity-badges > .jobs-badge:not(.jobs-fit-score) { grid-area: 2 / 1 / 3 / -1; justify-self: start; margin: 4px 0 2px; }
  .jobs-opportunity-badges > .jobs-fit-score { grid-area: 3 / 2; align-self: end; justify-self: end; margin: 0; }
  .jobs-opportunity--unseen-new { border-width: 2px; border-color: #55b6ff; }
  .jobs-opportunity--unseen-updated { border-width: 2px; border-color: #f2d24f; }
  .jobs-opportunity--unseen-new > td:first-child, .jobs-opportunity--unseen-updated > td:first-child { box-shadow: none; }
  .jobs-result-row:active { background: var(--ui-active); }
  .jobs-workspace .jobs-cell-contacts .jobs-subline:first-child { margin-top: 0; }
  .jobs-workspace .jobs-card-evaluation { display: block; border-top: 1px solid var(--ui-divider); }
  .jobs-workspace .jobs-card-summary { display: block; }
  .jobs-card-evaluation p, .jobs-card-summary p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; }
  .jobs-opportunities-table .jobs-cell-heading { order: 0; }
  .jobs-card-summary { order: 1; }
  .jobs-card-deadline { order: 2; }
  .jobs-card-location { order: 3; }
  .jobs-workspace .jobs-card-location::before { content: attr(data-mobile-label); }
  .jobs-card-country { display: none; }
  .jobs-card-location-text { display: inline; }
  .jobs-opportunities-table .jobs-card-evaluation { order: 4; }
  .jobs-opportunities-table .jobs-topics { order: 5; border-top: 1px solid var(--ui-divider); }
  .jobs-opportunities-table { font-size: 14px; }
  .jobs-opportunities-table .jobs-row-toggle { font-size: 16px; }
  .jobs-opportunities-table .jobs-subline { font-size: 13px; }
  .jobs-opportunities-table .jobs-topics { font-size: 14px; }
  .jobs-workspace .jobs-opportunities-table td { padding: 8px 12px; }
  .jobs-workspace .jobs-opportunities-table .jobs-cell-heading { padding-block: 10px; }
  .jobs-workspace .jobs-opportunities-table .jobs-group-row th { font-size: 13px; }
  .opportunity-detail { padding: 0; border: 1px solid var(--ui-divider); border-radius: 0; background: var(--ui-surface); }
  .opportunity-detail__header :deep(.workspace-detail-header__title h1) { font-size: 16px; line-height: 1.35; }
  .opportunity-detail__header :deep(.workspace-detail-header__metadata) { flex-wrap: nowrap; gap: 8px; }
  .opportunity-detail__country { flex: 0 1 auto; max-width: 28%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opportunity-detail__deadline { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opportunity-detail__deadline-label { display: none; }
  .opportunity-detail__fit { flex-shrink: 0; margin: 0; padding: 0; border-radius: 0; background: transparent; font-size: 12px; }
  .opportunity-detail__body { padding: 12px 12px 0; scrollbar-gutter: auto; }
  .opportunity-comment { gap: 8px; margin-bottom: 16px; }
  .jobs-workspace .opportunity-comment label { font-size: 13px; }
  .jobs-workspace .opportunity-comment textarea { min-height: 64px; padding: 8px 10px; font-size: 16px; line-height: 1.4; }
  .jobs-workspace :deep(.opportunity-context__group) { --disclosure-row-inset: 10px; border-top: 1px solid var(--ui-divider); background: transparent; }
  .jobs-workspace :deep(.opportunity-context__group > summary) { min-height: 44px; padding-block: 11px; font-size: 14px; line-height: 1.5; }
  .jobs-workspace :deep(.opportunity-context__group > summary:active) { background: var(--ui-surface-hover); }
  .jobs-workspace :deep(.opportunity-context__group[open]) { padding-bottom: 16px; }
  .jobs-workspace :deep(.opportunity-context__group[open] > summary) { margin-bottom: 12px; border-bottom: 1px solid var(--ui-divider); }
  .jobs-workspace :deep(.opportunity-context__fields) { gap: 16px; }
  .jobs-workspace :deep(.opportunity-context__field dt) { margin-bottom: 4px; color: var(--ui-muted); font-size: 12px; }
  .jobs-workspace :deep(.opportunity-context__value) { font-size: 14px; line-height: 1.5; }
  .jobs-workspace :deep(.opportunity-context__score) { gap: 6px; margin: 4px 0 8px; }
  .jobs-workspace :deep(.opportunity-context__score-details > summary) { padding: 8px 10px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-control); }
  .jobs-workspace :deep(.opportunity-context__score-details:not([open]) > summary) { margin-bottom: 0; }
  .jobs-workspace :deep(.opportunity-context__score-details[open] > summary) { border-color: var(--ui-accent-border); }
  .jobs-workspace :deep(.opportunity-context__score-details > summary:active) { background: var(--ui-surface-hover); }
  .jobs-workspace :deep(.opportunity-context__score-number) { font-size: 18px; }
  .jobs-workspace :deep(.opportunity-context__score-track) { height: 6px; }
  .jobs-workspace :deep(.opportunity-context__list), .jobs-workspace :deep(.opportunity-context__values) { gap: 6px; }
  .jobs-workspace :deep(.opportunity-context__requirements-table th), .jobs-workspace :deep(.opportunity-context__requirements-table td) { padding-block: 8px; border-bottom-color: var(--ui-divider); }
  .jobs-toolbar > .btn, .jobs-workspace :deep(.workspace-detail-header__controls .btn:not(.btn--danger)) { background: var(--ui-control); }
  .jobs-workspace :is(input, select, textarea):focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
  .jobs-workspace .jobs-detail-state { flex: 1; }
  .jobs-workspace .jobs-detail-state select { width: 100%; height: 44px; padding: 6px; }
  .jobs-detail-action { flex-shrink: 0; min-height: 40px; padding: 7px 10px; }
  .jobs-action-label, .jobs-action-desktop { display: none; }
  .jobs-action-mobile { display: inline; }
  .jobs-removal-dialog { padding: 18px; }
  .jobs-removal-dialog .jobs-row-actions .btn { font-size: 16px; }
  .application-fields { grid-template-columns: 1fr; }
  .application-inline-form { padding: 0; border: 0; border-radius: 0; background: transparent; }
  .jobs-review-toolbar { align-items: stretch; gap: 10px; margin-bottom: 16px; }
  .jobs-review-toolbar h2 { display: none; }
  .jobs-workspace :deep(.opportunity-context__group dl) { gap: 14px; }
  .jobs-workspace :deep(.opportunity-context__field--fit) { padding: 0; border: 0; border-radius: 0; background: transparent; }
}
</style>
