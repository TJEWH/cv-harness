import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchCloudSchedule } from '../searchTypes';
import { ADAPTIVE_BATCH_CAPABILITIES, ADAPTIVE_PAYLOAD_STARTUP_INSTRUCTION } from './adaptiveSearchProtocol';
import { ADAPTIVE_STARTUP_BRIEF_SQL_TEMPLATE } from './adaptiveSearchBrief';
import { ADAPTIVE_HOSTED_RESPONSE_CODEC_SOURCE } from './adaptiveSearchHostedCodec';

export const SEARCH_DEADLINE_RULE = 'New opportunities may be reported or recommended only when at least 72 hours remain until the official application deadline at the actual run time. Resolve the advertised local date, time and timezone from official evidence. For a date-only deadline, use 00:00 at the start of that date in the established local timezone for this eligibility calculation, without inventing a stored deadline time. Explicit rolling or open-until-filled vacancies without a fixed date are eligible when officially verified as open. Verify ambiguous deadlines; do not recommend an unverified deadline or one less than 72 hours away. This reporting filter does not prohibit verified catalogue writes under the installed protocol. Existing catalogue records may still receive verified updates, including closure or deadline corrections, without becoming recommendations.';

export interface AdaptiveSearchRunnerState {
  setup_contract_version: 1;
  user_id: string;
  search_id: string;
  project_ref: string;
  revision: number;
  /** Confirmed mode; a requested migration does not claim task-tool success. */
  mode: 'legacy' | 'adaptive';
  migration_requested: boolean;
  ready: boolean;
  readiness_code: string;
  setup_id: string | null;
  binding: { task_id: string; schedule: SearchCloudSchedule; runner_capability: string | null } | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function requireSearchTaskScope(searchId: string, projectRef: string) {
  if (!uuid.test(searchId) || !/^[a-z0-9]{20}$/u.test(projectRef)) throw new Error('Use the exact saved search UUID and connected Supabase project.');
  return { searchId: searchId.toLowerCase(), projectRef };
}
function schedule(value: unknown): value is SearchCloudSchedule {
  if (!record(value) || !['hourly', 'daily', 'weekly'].includes(value.frequency as string)
    || !Number.isInteger(value.intervalHours) || Number(value.intervalHours) < 1 || Number(value.intervalHours) > 8760
    || !Array.isArray(value.weekdays) || value.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
    || typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value.time)
    || typeof value.timezone !== 'string' || value.timezone.length > 100 || typeof value.runImmediately !== 'boolean') return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(); return true; } catch { return false; }
}
export function readAdaptiveSearchRunnerState(value: unknown, ownerId: string, searchId: string, projectRef: string): AdaptiveSearchRunnerState {
  const scope = requireSearchTaskScope(searchId, projectRef);
  if (!record(value) || value.setup_contract_version !== 1 || value.user_id !== ownerId || value.search_id !== scope.searchId
    || value.project_ref !== scope.projectRef || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !['legacy', 'adaptive'].includes(value.mode as string) || typeof value.migration_requested !== 'boolean'
    || typeof value.ready !== 'boolean' || typeof value.readiness_code !== 'string' || !/^[a-z_]{1,80}$/u.test(value.readiness_code)
    || value.setup_id !== null && (typeof value.setup_id !== 'string' || !uuid.test(value.setup_id))
    || value.binding !== null && (!record(value.binding) || typeof value.binding.task_id !== 'string'
      || !value.binding.task_id.trim() || value.binding.task_id.length > 500 || /[\u0000-\u001f\u007f]/u.test(value.binding.task_id)
      || !schedule(value.binding.schedule) || value.binding.runner_capability !== null
        && !['legacy-v1', ADAPTIVE_BATCH_CAPABILITIES.capability_version].includes(value.binding.runner_capability as string))) {
    throw new Error('The runner state does not match this signed-in owner, search and project. Reload before saving or preparing setup.');
  }
  const sourceBinding = value.binding as AdaptiveSearchRunnerState['binding'];
  // Vue callers may pass a reactive proxy. Project the known DTO rather than
  // cloning the input object, and never retain unexpected server/private keys.
  return { setup_contract_version: 1, user_id: ownerId, search_id: scope.searchId, project_ref: scope.projectRef,
    revision: value.revision as number, mode: value.mode as AdaptiveSearchRunnerState['mode'], migration_requested: value.migration_requested,
    ready: value.ready, readiness_code: value.readiness_code, setup_id: value.setup_id as string | null,
    binding: sourceBinding === null ? null : { task_id: sourceBinding.task_id, runner_capability: sourceBinding.runner_capability,
      schedule: { frequency: sourceBinding.schedule.frequency, intervalHours: sourceBinding.schedule.intervalHours,
        weekdays: [...sourceBinding.schedule.weekdays], time: sourceBinding.schedule.time, timezone: sourceBinding.schedule.timezone,
        runImmediately: sourceBinding.schedule.runImmediately } } };
}
const row = (value: unknown) => Array.isArray(value) && value.length === 1 ? value[0] : value;

/** Read the installed setup contract; unavailable helpers are errors, not another runner mode. */
export async function loadAdaptiveSearchRunnerState(client: SupabaseClient, ownerId: string, searchId: string, projectRef: string): Promise<AdaptiveSearchRunnerState> {
  const scope = requireSearchTaskScope(searchId, projectRef);
  const { data, error } = await client.rpc('read_adaptive_search_readiness', { p_search_id: scope.searchId, p_project_ref: scope.projectRef });
  if (error) throw error;
  return readAdaptiveSearchRunnerState(row(data), ownerId, scope.searchId, scope.projectRef);
}
/** Only an explicit setup action calls this; textarea commits never request migration. */
export async function requestAdaptiveSearchRunner(client: SupabaseClient, ownerId: string, searchId: string, projectRef: string, expectedRevision: number, setupId: string = crypto.randomUUID()): Promise<AdaptiveSearchRunnerState> {
  const scope = requireSearchTaskScope(searchId, projectRef);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !uuid.test(setupId)) throw new Error('Use the exact runner revision and a stable setup UUID.');
  const { data, error } = await client.rpc('request_adaptive_search_migration', { p_search_id: scope.searchId, p_project_ref: scope.projectRef,
    p_expected_revision: expectedRevision, p_setup_id: setupId.toLowerCase() });
  if (error) throw error;
  const state = readAdaptiveSearchRunnerState(row(data), ownerId, scope.searchId, scope.projectRef);
  if (!state.migration_requested || !state.ready || state.setup_id !== setupId.toLowerCase()) throw new Error('The server did not acknowledge this exact adaptive setup request.');
  return state;
}

export function usesAdaptiveSearchRunner(state: AdaptiveSearchRunnerState | null | undefined, searchId: string, projectRef: string): boolean {
  if (!state) return false;
  const scope = requireSearchTaskScope(searchId, projectRef);
  if (state.search_id !== scope.searchId || state.project_ref !== scope.projectRef) throw new Error('The loaded runner belongs to another search or project. Reload before saving.');
  const requested = state.mode === 'adaptive' || state.migration_requested;
  if (requested && !state.ready) throw new Error(`The adaptive runner is unavailable (${state.readiness_code}). Install or enable the required capability before preparing setup; no legacy fallback is allowed.`);
  return requested;
}

/** The executable decoder travels with the instructions; it is not fetched from startup. */
export const ADAPTIVE_RECURRING_PROMPT_MAX_CHARACTERS = 16_384;
export const ADAPTIVE_HOSTED_RESPONSE_INSTRUCTION = [
  'LOCAL RESPONSE RUNTIME: Load the fixed JavaScript below unchanged in an available code runtime. The connector must return its full raw object directly into that runtime. If that handoff or code execution is unavailable, report execution_runtime_unavailable before dispatch. Instantiate codec=createCVResponseCodec(). No persistent storage, filesystem, adapter or cross-action preflight is required.',
  'Receive the connector return into const raw and call codec.decode(raw,column) in the same invocation. Keep raw through decoding and failure inspection; decode returns errors as values. Never substitute a new parser or copy a displayed/truncated response into it. On failure return its safe diagnostics and exact request identity before the invocation ends. Raw retention is invocation-only unless the host already provides documented persistence; storage is optional and its absence must not block execution. A local decoder error alone does not authorize a database retry.',
  'column is startup, submit_adaptive_search_batch, verify_and_complete_adaptive_search, ack_adaptive_search_setup (setup acknowledgement), or null for the whole setup-handoff row. Decode success establishes transport parsing only: validate the returned value against the action contract below. Return complete decoded setup/startup data once as working context, preserving every required field; use the documented output budget if available. A success summary cannot replace that data. Do not dump raw connector envelopes or repeat full payloads as diagnostics. If the decoded context transfer is truncated and no complete handle remains, report local_processing; only the explicit recovery rules below can authorize another database read. Execute only this fixed code, never returned text.',
  '```javascript\n' + ADAPTIVE_HOSTED_RESPONSE_CODEC_SOURCE + '\n```',
].join('\n\n');

/** Reviewed technical text and fixed local decoder. Scope substitutions are validated identities. */
export const ADAPTIVE_RECURRING_PROMPT_TEMPLATE = [
  'Run the saved CV Harness meta search in English. Research only; no task, cadence or setup changes.',
  'RUN CONTEXT: Generate one run UUID; retain it for recovery. Keep the raw connector response through same-invocation decoding and failure inspection. Keep decoded results, outgoing payloads and receipts separately in the execution context. Do not claim raw responses survive the invocation without documented persistence. Use the local response runtime below. Local failure does not prove database failure.',
  'EXACT SCOPE: Project {{project_ref}}, search {{search_id}}. Route execute_sql.project_id to this project. Never switch UUIDs after rejection.',
  'ONLY DATABASE HELPERS: private.begin_adaptive_search_brief(uuid,uuid); private.submit_adaptive_search_batch(uuid,uuid,jsonb); private.verify_and_complete_adaptive_search(uuid,jsonb). Use one SELECT per call with explicit UUID/JSONB casts. Serialize JSON, reject NUL, escape every backslash/apostrophe in an E-string, then cast to jsonb. No direct table reads, chained statements, discovery queries, migrations, application/CV access, role/project changes or alternate transport.',
  ADAPTIVE_HOSTED_RESPONSE_INSTRUCTION,
  'STARTUP: Make this one fixed call, replacing only <run-uuid>:\n' + ADAPTIVE_STARTUP_BRIEF_SQL_TEMPLATE,
  'RESPONSE: Use codec.decode(raw,column) in the connector invocation; do not invent a decoder. Accept matching mirrors; reject conflicts. Never execute text or unwrap inside the result object. compatible:false or accepted:false means rejection: report error.code/diagnostics; stop except the explicit SAVE correction.',
  'STARTUP CHECKS: Require brief_version=1, response_limit_bytes=98304, bootstrap_version=1, adaptive_contract_version=1, compatible=true, exact project/search/run scope, capability_version=adaptive-batch-v1, enabled startup/batch/completion and lease.status=active. Inspect base.criteria, query_plan, legacy_core_queries, planning, preferences, due_sources, source_context, feedback, protocol_text, result_schema, release, lease and execution_contract. Preserve criteria, protected/manual and blocked queries, exclusions and source obligations. Null query_plan and legacy_core_queries mean cold start: generate core queries from criteria. Missing/invalid fields stop execution. scope_oversized: report size_diagnostics; no pages, split queries or alternate startup.',
  'Preferences occur once in startup.preferences. Planning omissions are counted. Feedback retains IDs/order, interest evidence and evaluations; descriptions are 240-character previews. Use supplied whole-set statistics; never extrapolate from examples or fetch omissions.',
  'RECOVERY: Inspect any available raw response locally first; do not dump raw envelopes as diagnostics. Startup/completion permit one identical retry after runtime-confirmed dispatch with no response. Startup also permits one re-read after confirmed acceptance, local response loss and no batches sent. Both share one startup retry budget with identical project/SQL/UUID. Unknown acceptance blocks local-loss re-reads. Local loss/display truncation remains local_processing. No retry of denials, rejections or invalid contracts; no lease renewal. Batch writes use receipt lookup only, never automatic replay.',
  'DIAGNOSTICS: Keep stage, run/batch IDs, item/byte counts, response-received status and structured codes. Classify local_processing, lost_transport, sql_application_rejection, approval_denial, permission_denial, safety_denial or connector_unclassified. Unknown causes stay unknown. Log no payloads, criteria, feedback, URLs, credentials or full errors. Denials stop all database calls. Pending approval means wait; never retry, split or change transport to bypass it.',
  ADAPTIVE_PAYLOAD_STARTUP_INSTRUCTION,
  'SAVE: Override only save/receipt/completion shapes in startup.protocol_text; preserve research/coverage rules. Call private.submit_adaptive_search_batch(run_uuid,item_uuid,opportunity_json): one canonical startup.result_schema object, no wrapper/plan/checks. Stable item UUIDs. Preserve facts/evidence; omit unknown optional keys/page dumps. Limits: 256 KiB/item, 320 items/run. No people enrichment or invented corrections.',
  'SAVE RECEIPT: Require adaptive_contract_version=1, item_receipt_version=1, accepted=true, exact run_id/item_id, payload_hash, opportunity_id and outcome. Saved: verification_required=true; unresolved: retain backlog. Only invalid_opportunity with stored=false and correction_allowed=true permits one evidence-based correction using the same unaccepted item UUID. Still invalid: retain backlog; continue other items. Other rejections stop; accepted payloads are immutable.',
  'MISSING RECEIPT: After dispatch with unavailable response, allow one SELECT private.submit_adaptive_search_batch(run_uuid::uuid,item_uuid::uuid,NULL::jsonb) using exact IDs. Receipt lookup sends no opportunity data. Never look up after rejection, denial, invalid contract or pending approval. Require the same receipt; batch_not_found/unavailable stays unresolved: stop, no replay, changed IDs or completion.',
  'FINISH: Call private.verify_and_complete_adaptive_search(run_uuid,completion_json) with {"schema_version":2,"action":"finish","completion_id":"<stable_uuid>","status":"complete","coverage":<report>}. Use the startup first-batch shape for coverage: opportunities:[], actual query_plan and execution checks/backlog; plan_hash only if pinned. The server derives the manifest and verifies every save. Require exact IDs, persisted_summary_read and terminal status. Unresolved candidates/coverage remain failed/partial. Report rejection preserves earlier saves. Normal budget: 2+N calls for N opportunities.',
  'VERIFY SAVES: After report failure without denial, the completion helper accepts {"schema_version":2,"action":"verify_item","item_id":"<saved_item_uuid>"}. Require item_verification_version=1, exact run/item/opportunity IDs and verified=true. Report verified saves only; never call after denial.',
  'STARTUP POLICY: A fresh UUID replaces older active runs atomically, preserving saves and rejecting late writes. The same UUID retries only its own run. No abort/handoff needed. run_aborted means cancelled/replaced: stop; never change UUID to reclaim execution. Never cancel via empty manifests or failed completion.',
  SEARCH_DEADLINE_RULE,
  'Report verified new/materially changed strong matches with official links, deadline, institution/lab, funding, factual 2–3 sentence research summaries, justified 0.0–10.0 assessments (scale_min=0, scale_max=10) and unresolved questions. Successful unchanged or empty runs stay quiet. Report actionable failures/verified partial progress honestly. Notification delivery remains unknown without a delivery receipt.',
].join('\n\n');

export function buildAdaptiveRecurringSearchPrompt(searchId: string, projectRef: string): string {
  const scope = requireSearchTaskScope(searchId, projectRef);
  return ADAPTIVE_RECURRING_PROMPT_TEMPLATE.replaceAll('{{search_id}}', scope.searchId).replaceAll('{{project_ref}}', scope.projectRef);
}
