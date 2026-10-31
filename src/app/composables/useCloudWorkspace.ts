import { onScopeDispose, ref, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, ApplicationContext, ApplicationStage, CloudCvSnapshot, CloudCvVariant, CreateApplicationInput, Opportunity, OpportunityReview, OpportunityReviewState, OpportunityFeedbackPatch, OpportunityDispositionPatch, UpdateApplicationInput } from '../cloudTypes';
import { APPLICATION_STAGES, APPLICATION_STATUSES, TRACKING_STATUSES, OPPORTUNITY_REVIEW_STATES } from '../cloudTypes';
import { SAMPLE_CONTACT } from '../../documents/cv/defaults';
import { CV_STATE_VERSION } from '../../documents/cv/types';
import { createCloudCvSnapshot } from '../../documents/privacy/domain/cloudCvPrivacy';
import { isRecord, readCvConfig, readCvContent } from '../../documents/cv/domain/cvStateValidation';
import { hasReviewedOpportunity } from '../../features/opportunities/domain/opportunityRecency';
import { normalizeApplication } from '../../features/applications/domain/applicationTracking';
import { OPPORTUNITY_COLUMNS, readOpportunity } from '../../features/opportunities/domain/readOpportunity';
import { parseOpportunityInterestRating, normalizeOpportunityInterestReasons } from '../../features/opportunities/domain/opportunityFeedback';
import { normalizeOpportunityDispositionPatch, readOpportunityDisposition } from '../../features/opportunities/domain/opportunityDisposition';
import { MAX_OPPORTUNITY_EVALUATION_LENGTH, migrateOpportunityEvaluationDrafts } from '../../features/opportunities/domain/opportunityEvaluation';

const PAGE_SIZE = 500;
const CV_SUMMARY_FIELDS = 'id,user_id,name,cv_version,revision,created_at';

/** Decode the canonical catalogue directly; frozen application snapshots have their own reader. */
export const normalizeOpportunity = readOpportunity;

function errorMessage(reason: unknown, fallback: string): string {
  if (isRecord(reason) && reason.code === '23505') return 'An application already exists for this opportunity. Refresh to view it.';
  if (isRecord(reason) && (reason.code === 'PGRST202' || reason.code === '42P01')) return 'The job workspace database setup is incomplete. Ask the workspace administrator to check its schema.';
  if (isRecord(reason) && (reason.code === '42501' || reason.code === 'PGRST301')) return 'Your session cannot access this workspace. Sign in again and retry.';
  return reason instanceof Error ? reason.message : fallback;
}

function contactEmail(value: string | null): string | null {
  const email = value?.trim();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Enter the employer’s valid contact email.');
  return email;
}

function dateValue(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (!Number.isFinite(Date.parse(value))) throw new Error('Enter a valid application date.');
  return new Date(value).toISOString();
}

interface PendingSnapshot { fingerprint: string; applicationId: string; snapshot: CloudCvSnapshot }
interface PendingApplication { opportunityId: string; applicationId: string }

function cloudSnapshot(value: unknown, account: string): CloudCvSnapshot {
  if (!isRecord(value) || value.user_id !== account || typeof value.id !== 'string' || typeof value.name !== 'string'
    || value.cv_version !== CV_STATE_VERSION || typeof value.revision !== 'number' || typeof value.is_base_variant !== 'boolean') {
    throw new Error('The assigned CV snapshot is invalid or unavailable.');
  }
  const content = readCvContent(value.content_json);
  for (const key of Object.keys(SAMPLE_CONTACT) as (keyof typeof SAMPLE_CONTACT)[]) {
    if (content.contact[key] !== '' && content.contact[key] !== SAMPLE_CONTACT[key]) {
      throw new Error('The assigned CV is not a privacy snapshot. Assign a new privacy CV before exporting.');
    }
  }
  return { id: value.id, name: value.name, content_json: content, config_json: readCvConfig(value.config_json),
    cv_version: value.cv_version, revision: value.revision, is_base_variant: value.is_base_variant };
}

/** Cloud state is ephemeral and account-scoped; this never changes the local CV store. */
export function useCloudWorkspace(client: SupabaseClient | null, userId: MaybeRefOrGetter<string | null | undefined>) {
  const opportunities = ref<Opportunity[]>([]);
  const applications = ref<Application[]>([]);
  const cvVariants = ref<CloudCvVariant[]>([]);
  const reviews = ref<OpportunityReview[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const savingReview = ref(false);
  const error = ref('');
  const opportunityReviewError = ref('');
  const opportunityCommentError = ref('');
  const opportunityFeedbackError = ref('');
  let epoch = 0;
  let loadSequence = 0;
  let loadController: AbortController | null = null;
  const controllers = new Set<AbortController>();
  const pendingReviews = new Set<string>();
  let pendingCreate: PendingApplication | null = null;
  let pendingAssignment: PendingSnapshot | null = null;
  let mutationTail: Promise<void> = Promise.resolve();
  let disposed = false;

  const current = (account: string, generation: number) => !disposed && epoch === generation && toValue(userId) === account;
  function reset() {
    epoch++;
    loadSequence++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    pendingReviews.clear();
    loadController = null;
    opportunities.value = []; applications.value = []; cvVariants.value = []; reviews.value = [];
    loading.value = false; saving.value = false; savingReview.value = false;
    error.value = ''; opportunityReviewError.value = ''; opportunityCommentError.value = ''; opportunityFeedbackError.value = '';
    pendingCreate = null; pendingAssignment = null;
    mutationTail = Promise.resolve();
  }

  async function rows(table: string, fields: string, account: string, signal: AbortSignal) {
    const result: Record<string, unknown>[] = [];
    for (let offset = 0; ;) {
      if (signal.aborted) throw new Error('Request cancelled.');
      const orderColumn = table === 'opportunity_reviews' ? 'opportunity_id' : 'id';
      let query = client!.from(table).select(fields, { count: 'exact' }).order(orderColumn, { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      // Opportunities are a shared, authenticated-read-only catalogue. RLS enforces access.
      if (table !== 'opportunities') query = query.eq('user_id', account);
      const { data, count, error: queryError } = await query.abortSignal(signal);
      if (queryError) throw queryError;
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      result.push(...page);
      // Respect projects configured with a lower API row cap than our requested page size.
      offset += page.length;
      if (!page.length || (count !== null && count !== undefined ? offset >= count : page.length < PAGE_SIZE)) return result;
    }
  }

  async function refresh(): Promise<boolean> {
    const account = toValue(userId);
    if (disposed || !client || !account || saving.value) return false;
    const generation = epoch;
    const sequence = ++loadSequence;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    controllers.add(controller);
    loading.value = true; error.value = '';
    try {
      const [opportunityRows, applicationRows, cvRows, reviewRows] = await Promise.all([
        rows('opportunities', OPPORTUNITY_COLUMNS, account, controller.signal), rows('applications', '*', account, controller.signal),
        rows('cv_variants', CV_SUMMARY_FIELDS, account, controller.signal),
        rows('opportunity_reviews', '*', account, controller.signal),
      ]);
      if (!current(account, generation) || sequence !== loadSequence) return false;
      const nextOpportunities = opportunityRows.map(normalizeOpportunity);
      const nextApplications = (applicationRows as unknown as Application[]).map(normalizeApplication);
      const nextReviews = reviewRows.map(row => { readOpportunityDisposition(row); return row as unknown as OpportunityReview; });
      migrateOpportunityEvaluationDrafts(account, reviewRows);
      // Opening an editor must observe its saved evaluation and migrated recovery together.
      reviews.value = nextReviews;
      opportunities.value = nextOpportunities;
      applications.value = nextApplications;
      cvVariants.value = cvRows as unknown as CloudCvVariant[];
      return true;
    } catch (reason) {
      if (current(account, generation) && sequence === loadSequence) error.value = errorMessage(reason, 'Could not load the job workspace. Check your connection and retry.');
      return false;
    } finally {
      controllers.delete(controller);
      if (current(account, generation) && sequence === loadSequence) { loading.value = false; loadController = null; }
    }
  }

  function snapshotParameters(snapshot: CloudCvSnapshot) {
    return { p_cv_variant_id: snapshot.id, p_cv_name: snapshot.name, p_content_json: snapshot.content_json,
      p_config_json: snapshot.config_json, p_cv_version: snapshot.cv_version };
  }

  async function runMutation<T>(action: (account: string, generation: number, signal: AbortSignal) => Promise<T>, saveResult: (value: T) => void,
    failureMessage = 'Could not save the application. Check your connection and retry.', operationError = error, isReviewMutation = false): Promise<T | null> {
    const account = toValue(userId);
    if (disposed || !client || !account) return null;
    const generation = epoch;
    // Tab changes and autosaves can overlap. Keep every patch in user order and
    // prevent an older response from replacing a newer application row.
    const previousMutation = mutationTail;
    let releaseMutation!: () => void;
    mutationTail = new Promise<void>(resolve => { releaseMutation = resolve; });
    await previousMutation;
    if (!current(account, generation)) { releaseMutation(); return null; }
    const controller = new AbortController();
    controllers.add(controller);
    // An older read must not overwrite the results of a newer write.
    loadSequence++; loadController?.abort(); loading.value = false;
    // Interest writes retain the shared queue and refresh protection while the
    // UI can allow navigation and accept an application-start request.
    saving.value = true; savingReview.value = isReviewMutation; operationError.value = '';
    try {
      const result = await action(account, generation, controller.signal);
      if (!current(account, generation)) return null;
      saveResult(result);
      return result;
    } catch (reason) {
      if (current(account, generation)) operationError.value = errorMessage(reason, failureMessage);
      return null;
    } finally {
      controllers.delete(controller);
      if (current(account, generation)) { saving.value = false; savingReview.value = false; }
      releaseMutation();
    }
  }

  async function applicationById(id: string, account: string, signal: AbortSignal): Promise<Application> {
    const { data, error: queryError } = await client!.from('applications').select('*').eq('user_id', account).eq('id', id).abortSignal(signal).single();
    if (queryError) throw queryError;
    if (!data || data.user_id !== account || data.id !== id) throw new Error('The saved application could not be loaded. Refresh the workspace.');
    return normalizeApplication(data as Application);
  }

  function recordSnapshot(snapshot: CloudCvSnapshot, account: string, generation: number) {
    if (!current(account, generation)) return;
    const summary: CloudCvVariant = { id: snapshot.id, user_id: account, name: snapshot.name,
      cv_version: snapshot.cv_version, revision: snapshot.revision, created_at: new Date().toISOString() };
    cvVariants.value = [summary, ...cvVariants.value.filter(({ id }) => id !== snapshot.id)];
  }

  function rememberApplication(application: Application) {
    applications.value = [application, ...applications.value.filter(({ id }) => id !== application.id)];
  }

  function createApplication(input: CreateApplicationInput): Promise<Application | null> {
    return runMutation(async (account, generation, signal) => {
      if (!input.opportunityId) throw new Error('Select an opportunity to create an application.');
      if (pendingCreate?.opportunityId !== input.opportunityId) pendingCreate = { opportunityId: input.opportunityId, applicationId: crypto.randomUUID() };
      const operation = pendingCreate;
      const { data, error: queryError } = await client!.rpc('create_job_application', {
        p_application_id: operation.applicationId, p_opportunity_id: input.opportunityId,
      }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!current(account, generation)) throw new Error('Session changed.');
      if (typeof data !== 'string' || !data) throw new Error('The application could not be confirmed. Refresh the workspace.');
      // The RPC returns an existing application for repeated clicks on the same opportunity.
      const application = await applicationById(data, account, signal);
      if (current(account, generation)) pendingCreate = null;
      return application;
    }, rememberApplication);
  }

  function updateApplication(id: string, input: UpdateApplicationInput): Promise<Application | null> {
    return runMutation(async (account, generation, signal) => {
      const patch: Record<string, unknown> = {};
      if (input.status !== undefined) {
        if (!(TRACKING_STATUSES as readonly string[]).includes(input.status)) throw new Error('Select a valid tracking status.');
        patch.status = input.status;
        // The assignment RPC marks this itself whenever p_changes has status.
        if (!input.cvState) patch.tracking_started = true;
      }
      if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
      if (input.contactEmail !== undefined) patch.contact_email = contactEmail(input.contactEmail);
      if (input.contactedAt !== undefined) patch.contacted_at = dateValue(input.contactedAt);
      if (input.submittedAt !== undefined) patch.submitted_at = dateValue(input.submittedAt);
      if (input.cvState) {
        const next = createCloudCvSnapshot(input.cvState);
        const fingerprint = JSON.stringify([account, id, next.content_json, next.config_json]);
        if (pendingAssignment?.fingerprint !== fingerprint) pendingAssignment = { fingerprint, applicationId: id, snapshot: next };
        const operation = pendingAssignment;
        const { error: queryError } = await client!.rpc('assign_job_application_cv', {
          p_application_id: id, p_changes: patch, ...snapshotParameters(operation.snapshot),
        }).abortSignal(signal);
        if (queryError) throw queryError;
        if (!current(account, generation)) throw new Error('Session changed.');
        recordSnapshot(operation.snapshot, account, generation);
      }
      if (!current(account, generation)) throw new Error('Session changed.');
      let application: Application;
      if (!input.cvState && Object.keys(patch).length) {
        const { data, error: queryError } = await client!.from('applications').update(patch).eq('id', id).eq('user_id', account).select('*').abortSignal(signal).single();
        if (queryError) throw queryError;
        if (!data) throw new Error('The application could not be updated. Refresh the workspace.');
        application = normalizeApplication(data as Application);
      } else application = await applicationById(id, account, signal);
      if (current(account, generation)) pendingAssignment = null;
      return application;
    }, rememberApplication);
  }

  function setApplicationStage(id: string, stage: ApplicationStage): Promise<Application | null> {
    return runMutation(async (account, _generation, signal) => {
      if (!APPLICATION_STAGES.includes(stage)) throw new Error('Select a valid application stage.');
      const { data, error: queryError } = await client!.rpc('set_job_application_stage', {
        p_application_id: id, p_stage: stage,
      }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!data || data.id !== id || data.user_id !== account) throw new Error('The application stage could not be confirmed. Refresh the workspace.');
      return normalizeApplication(data as Application);
    }, rememberApplication, 'Could not save the application stage. Check your connection and retry.');
  }

  function resetApplicationHistory(id: string): Promise<Application | null> {
    return runMutation(async (account, _generation, signal) => {
      const { data, error: queryError } = await client!.rpc('reset_job_application_history', {
        p_application_id: id,
      }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!isRecord(data) || data.id !== id || data.user_id !== account || !Array.isArray(data.status_history)
        || data.status_history.length !== 1 || !isRecord(data.status_history[0])) {
        throw new Error('The application history reset could not be confirmed. Refresh the workspace.');
      }
      const application = normalizeApplication(data as unknown as Application);
      const entry = application.status_history![0];
      if (!APPLICATION_STATUSES.includes(application.status) || entry.status !== application.status
        || !(entry.changedAt === null || typeof entry.changedAt === 'string' && Number.isFinite(Date.parse(entry.changedAt)))) {
        throw new Error('The application history reset could not be confirmed. Refresh the workspace.');
      }
      return application;
    }, rememberApplication, 'Could not reset the application history. Check your connection and retry.');
  }

  function setApplicationChecklistItem(id: string, key: string, completed: boolean): Promise<Application | null> {
    return runMutation(async (account, _generation, signal) => {
      if (!/^(requirements|documents):/.test(key) || key.length > 16000) throw new Error('Invalid checklist item.');
      const { data, error: queryError } = await client!.rpc('set_job_application_checklist_item', {
        p_application_id: id, p_item_key: key, p_completed: completed,
      }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!data || data.id !== id || data.user_id !== account || !Array.isArray(data.completed_checklist_keys)) {
        throw new Error('The checklist could not be saved. Refresh and retry.');
      }
      return normalizeApplication(data as Application);
    }, rememberApplication, 'Could not save checklist progress. Check your connection and retry.');
  }

  function removeApplication(id: string): Promise<string | null> {
    const applicationLoaded = applications.value.some((application) => application.id === id);
    return runMutation(async (account, generation, signal) => {
      if (!applicationLoaded) throw new Error('Refresh to load the application before removing it.');
      const { data, error: queryError } = await client!.rpc('remove_job_application', { p_application_id: id }).abortSignal(signal);
      if (queryError) throw queryError;
      if (data !== id) throw new Error('Removal could not be confirmed. Refresh and retry.');
      if (!current(account, generation)) throw new Error('Session changed.');
      return id;
    }, () => {
      applications.value = applications.value.filter((application) => application.id !== id);
      if (pendingCreate?.applicationId === id) pendingCreate = null;
      if (pendingAssignment?.applicationId === id) pendingAssignment = null;
    }, 'Could not remove the application. Check your connection and retry.');
  }

  /** Refresh only the trusted catalogue snapshot; the server preserves application edits and CV assignment. */
  function refreshApplicationContext(id: string): Promise<Application | null> {
    return runMutation(async (account, generation, signal) => {
      const { data, error: queryError } = await client!.rpc('refresh_job_application_context', { p_application_id: id }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!current(account, generation)) throw new Error('Session changed.');
      if (data !== id) throw new Error('The research refresh could not be confirmed. Refresh the workspace.');
      return applicationById(id, account, signal);
    }, rememberApplication, 'Could not refresh the application research. Check your connection and retry.');
  }

  async function saveOpportunityReview(account: string, opportunityId: string, observedVersion: string | null, state: OpportunityReviewState | null, signal: AbortSignal): Promise<OpportunityReview> {
    const { data, error: queryError } = await client!.rpc('review_job_opportunity', {
      p_opportunity_id: opportunityId, p_observed_updated_at: observedVersion, p_state: state,
    }).abortSignal(signal);
    if (queryError) throw queryError;
    if (!data || data.user_id !== account || data.opportunity_id !== opportunityId
      || !OPPORTUNITY_REVIEW_STATES.includes(data.state)) throw new Error('The review could not be saved. Refresh and retry.');
    return data as OpportunityReview;
  }

  function rememberReview(review: OpportunityReview, receiptOnly = false) {
    readOpportunityDisposition(review as unknown as Record<string, unknown>);
    const previous = reviews.value.find(({ opportunity_id }) => opportunity_id === review.opportunity_id);
    const saved = receiptOnly && previous ? { ...previous } : { ...previous, ...review };
    // Receipts can finish alongside state/comment saves. Preserve explicit edits and the newest viewed version.
    saved.reviewed_updated_at = previous?.reviewed_updated_at
      && (!review.reviewed_updated_at || Date.parse(previous.reviewed_updated_at) > Date.parse(review.reviewed_updated_at))
      ? previous.reviewed_updated_at : review.reviewed_updated_at;
    reviews.value = [saved, ...reviews.value.filter(({ opportunity_id }) => opportunity_id !== review.opportunity_id)];
  }

  function feedbackReviewRpc(name: string, opportunityId: string, parameters: Record<string, unknown>): Promise<OpportunityReview | null> {
    return runMutation(async (account, _generation, signal) => {
      const { data, error: queryError } = await client!.rpc(name, { p_opportunity_id: opportunityId, ...parameters }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!data || data.user_id !== account || data.opportunity_id !== opportunityId
        || !OPPORTUNITY_REVIEW_STATES.includes(data.state)) throw new Error('The feedback could not be confirmed. Refresh and retry.');
      return data as OpportunityReview;
    }, review => rememberReview(review), 'Could not save feedback. Your draft is retained.', opportunityFeedbackError);
  }

  function saveOpportunityFeedback(opportunityId: string, patch: OpportunityFeedbackPatch): Promise<OpportunityReview | null> {
    try {
      if (!isRecord(patch) || Object.keys(patch).some(key => !['interest_rating', 'interest_reasons', 'feedback_excluded', 'manually_archived', 'technical_issue_category', 'technical_issue_note'].includes(key))) {
        throw new Error('Select only supported feedback fields.');
      }
      const clean = { ...patch };
      const disposition = Object.fromEntries(Object.entries(patch).filter(([key]) => ['manually_archived', 'technical_issue_category', 'technical_issue_note'].includes(key)));
      if (Object.keys(disposition).length) Object.assign(clean, normalizeOpportunityDispositionPatch(disposition));
      if ('interest_rating' in patch) clean.interest_rating = parseOpportunityInterestRating(patch.interest_rating);
      if ('interest_reasons' in patch) clean.interest_reasons = normalizeOpportunityInterestReasons(patch.interest_reasons);
      if ('feedback_excluded' in patch && typeof patch.feedback_excluded !== 'boolean') throw new Error('Invalid feedback exclusion.');
      return feedbackReviewRpc('save_opportunity_feedback', opportunityId, { p_patch: clean });
    } catch (reason) {
      opportunityFeedbackError.value = errorMessage(reason, 'Invalid feedback.');
      return Promise.resolve(null);
    }
  }

  function saveOpportunityDisposition(opportunityId: string, patch: OpportunityDispositionPatch): Promise<OpportunityReview | null> {
    try { return saveOpportunityFeedback(opportunityId, normalizeOpportunityDispositionPatch(patch)); }
    catch (reason) { opportunityFeedbackError.value = errorMessage(reason, 'Invalid opportunity disposition.'); return Promise.resolve(null); }
  }

  function setOpportunityReview(opportunityId: string, state: OpportunityReviewState): Promise<OpportunityReview | null> {
    const opportunity = opportunities.value.find(({ id }) => id === opportunityId);
    const observedVersion = opportunity?.updated_at || opportunity?.created_at || null;
    return runMutation(async (account, _generation, signal) => {
      if (!opportunityId || !OPPORTUNITY_REVIEW_STATES.includes(state)) throw new Error('Select a valid opportunity review state.');
      return saveOpportunityReview(account, opportunityId, observedVersion, state, signal);
    }, (review) => rememberReview(review),
    'Could not save the opportunity review. Check your connection and retry.', opportunityReviewError, true);
  }

  function setOpportunityComment(opportunityId: string, comment: string): Promise<OpportunityReview | null> {
    return runMutation(async (account, _generation, signal) => {
      if (!opportunityId) throw new Error('Select an opportunity before adding a comment.');
      if (typeof comment !== 'string') throw new Error('Enter evaluation text.');
      const normalizedComment = comment === '' ? null : comment;
      if (Array.from(comment).length > MAX_OPPORTUNITY_EVALUATION_LENGTH) throw new Error('Keep the evaluation to 12,000 characters or fewer.');
      const { data, error: queryError } = await client!.rpc('save_opportunity_comment', {
        p_opportunity_id: opportunityId, p_comment: normalizedComment,
      }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!data || data.user_id !== account || data.opportunity_id !== opportunityId
        || !OPPORTUNITY_REVIEW_STATES.includes(data.state)
        || data.comment !== normalizedComment || !Number.isSafeInteger(data.evaluation_revision) || data.evaluation_revision < 0) {
        throw new Error('The comment could not be saved. Refresh and retry.');
      }
      return data as OpportunityReview;
    }, (review) => rememberReview(review), 'Could not save the opportunity comment. Check your connection and retry.', opportunityCommentError);
  }

  /** A read receipt never blocks another row, changes interest, or acknowledges an unseen source update. */
  async function markOpportunityReviewed(opportunity: Opportunity): Promise<OpportunityReview | null> {
    const account = toValue(userId);
    const observedVersion = opportunity.updated_at || opportunity.created_at;
    const previous = reviews.value.find(({ opportunity_id }) => opportunity_id === opportunity.id);
    if (!client || !account || !observedVersion || hasReviewedOpportunity(opportunity, previous?.reviewed_updated_at)) return null;
    const generation = epoch;
    const key = `${generation}:${opportunity.id}:${observedVersion}`;
    if (pendingReviews.has(key)) return null;
    pendingReviews.add(key);
    const controller = new AbortController();
    controllers.add(controller);
    error.value = '';
    try {
      const review = await saveOpportunityReview(account, opportunity.id, observedVersion, null, controller.signal);
      if (!current(account, generation)) return null;
      // A refresh started before this write completed may contain the old receipt.
      loadSequence++; loadController?.abort(); loading.value = false;
      rememberReview(review, true);
      return review;
    } catch (reason) {
      if (current(account, generation)) error.value = errorMessage(reason, 'Could not mark the opportunity as reviewed. Reopen it to retry.');
      return null;
    } finally {
      pendingReviews.delete(key);
      controllers.delete(controller);
    }
  }

  /** Fetch only on explicit export/inspection. The context and CV refer to the same stored application. */
  async function getApplicationContext(id: string): Promise<ApplicationContext | null> {
    const account = toValue(userId);
    if (!client || !account) return null;
    const generation = epoch;
    const controller = new AbortController();
    controllers.add(controller);
    error.value = '';
    try {
      const application = await applicationById(id, account, controller.signal);
      if (!current(account, generation)) return null;
      if (!application.cv_variant_id) return { application, cv: null };
      const { data, error: queryError } = await client.from('cv_variants')
        .select('id,user_id,name,content_json,config_json,cv_version,revision,is_base_variant')
        .eq('id', application.cv_variant_id).eq('user_id', account).abortSignal(controller.signal).single();
      if (queryError) throw queryError;
      if (!current(account, generation)) return null;
      const cv = cloudSnapshot(data, account);
      if (cv.id !== application.cv_variant_id) throw new Error('The assigned CV snapshot could not be verified.');
      return { application, cv };
    } catch (reason) {
      if (current(account, generation)) error.value = errorMessage(reason, 'Could not load the application context. Check your connection and retry.');
      return null;
    } finally {
      controllers.delete(controller);
    }
  }

  watch(() => toValue(userId), () => { reset(); void refresh(); }, { immediate: true, flush: 'sync' });
  onScopeDispose(() => { disposed = true; reset(); });
  return { opportunities, applications, cvVariants, reviews, loading, saving, savingReview, error, opportunityReviewError, opportunityCommentError,
    opportunityFeedbackError, saveOpportunityFeedback, saveOpportunityDisposition,
    refresh, createApplication, updateApplication, setApplicationStage, resetApplicationHistory, setApplicationChecklistItem, removeApplication, refreshApplicationContext, setOpportunityReview, setOpportunityComment, markOpportunityReviewed, getApplicationContext };
}
