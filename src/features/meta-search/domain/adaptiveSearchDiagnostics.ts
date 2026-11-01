import {
  ADAPTIVE_STARTUP_MAX_PAGES, ADAPTIVE_STARTUP_SECTIONS, AdaptiveStartupTransportError,
  buildAdaptiveStartupManifestSql, buildAdaptiveStartupPageSql, canRetryAdaptiveStartupRequest,
  type AdaptiveStartupFailureCategory, type AdaptiveStartupSection, type AdaptiveStartupTransportScope,
} from './adaptiveSearchTransport';

type RequestKind = 'startup_manifest' | 'startup_page';
export const ADAPTIVE_STARTUP_DIAGNOSTIC_INSTRUCTION = 'DIAGNOSTICS: Persist bounded before/after-call records: stage, request kind, fixed helper, exact-SQL SHA-256, template/project match, page index/count and checkpoint write/readback. Never log SQL text, criteria, feedback, Base64, URLs, credentials or full errors. Classify observed failures as local_processing, lost_transport, sql_application_rejection, approval_denial, permission_denial, safety_denial or connector_unclassified; retain known structured codes and evidence origin. Unknown cause stays unknown. Denials never retry. Lost transport requires runtime proof of dispatch and no received response; display truncation stays local.';
const helper = 'private.begin_adaptive_opportunity_search(uuid,uuid)';
const categories: readonly AdaptiveStartupFailureCategory[] = ['local_processing', 'lost_transport', 'sql_application_rejection',
  'approval_denial', 'permission_denial', 'safety_denial', 'connector_unclassified'];
const diagnosticCodes = new Set([
  'runner_disabled', 'authorization_revoked', 'scope_unavailable', 'incompatible_release', 'invalid_bundle', 'scope_oversized',
  'setup_conversion_required', 'run_in_progress', 'lease_expired', 'approval_denied', 'approval_rejected', 'approval_required',
  'permission_denied', 'insufficient_privilege', 'access_denied', 'unauthorized', 'forbidden', '401', '403', '42501',
  'safety_denied', 'safety_blocked', 'safety_block', 'blocked_by_safety', 'safety_policy_denied',
  'invalid_observation', 'response_not_received', 'local_display_truncated', 'connector_error', 'invalid_server_error',
  'invalid_scope', 'invalid_header', 'invalid_section', 'invalid_manifest', 'invalid_page', 'response_oversized',
  'invalid_response', 'response_nesting', 'ambiguous_rows', 'invalid_row', 'invalid_base64', 'invalid_page_length',
  'invalid_context', 'scope_mismatch', 'snapshot_changed', 'manifest_required', 'section_mismatch', 'conflicting_page',
  'section_hash_mismatch', 'invalid_section_utf8', 'invalid_section_json', 'incomplete_transport', 'invalid_section_shape',
  'checkpoint_scope_invalid', 'checkpoint_preflight_required', 'checkpoint_oversized', 'checkpoint_invalid_json',
  'checkpoint_invalid', 'checkpoint_probe_invalid', 'checkpoint_already_exists', 'checkpoint_probe_mismatch',
  'checkpoint_storage_failed', 'checkpoint_blocked', 'checkpoint_profile_mismatch', 'checkpoint_lease_invalid',
  'checkpoint_run_inactive', 'checkpoint_context_first_required', 'checkpoint_local_failure', 'checkpoint_request_invalid',
  'checkpoint_request_changed', 'checkpoint_response_unreconciled',
  'checkpoint_retry_exhausted', 'checkpoint_response_mismatch', 'checkpoint_local_readback_required',
  'checkpoint_lease_expired', 'checkpoint_readback_failed', 'checkpoint_not_verified', 'checkpoint_stale',
]);
const count = (value: number | undefined, maximum = ADAPTIVE_STARTUP_MAX_PAGES) =>
  Number.isSafeInteger(value) && value! >= 0 && value! <= maximum ? value! : null;
async function sha256(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface AdaptiveStartupRequestDiagnostic {
  diagnostic_version: 1;
  event: 'request_preflight';
  request_kind: RequestKind | 'unrecognized';
  expected_helper: typeof helper;
  scope: AdaptiveStartupTransportScope | null;
  section: AdaptiveStartupSection | null;
  index: number | null;
  attempt: 0 | 1 | null;
  request_sha256: string | null;
  template_matches: boolean;
  connector_project_matches: boolean;
  checkpoint_readback_verified: boolean;
  local_preflight_passed: boolean;
  runtime_authorization: 'not_observed';
  failure_code: 'invalid_request' | 'connector_project_mismatch' | 'request_template_mismatch' | 'checkpoint_not_verified' | null;
}

/** Local evidence only. A template match is never permission to invoke a tool. */
export async function inspectAdaptiveStartupRequest(input: {
  scope: AdaptiveStartupTransportScope; kind: RequestKind; section?: AdaptiveStartupSection; index?: number;
  connector_project_id: string; query: string; attempt: 0 | 1; checkpoint_readback_verified: boolean;
}): Promise<AdaptiveStartupRequestDiagnostic> {
  let expected: string | undefined, scope: AdaptiveStartupTransportScope | null = null;
  const kind = ['startup_manifest', 'startup_page'].includes(input.kind) ? input.kind : 'unrecognized';
  const section = input.section && (ADAPTIVE_STARTUP_SECTIONS as readonly string[]).includes(input.section) ? input.section : null;
  const index = count(input.index, ADAPTIVE_STARTUP_MAX_PAGES - 1);
  const attempt = input.attempt === 0 || input.attempt === 1 ? input.attempt : null;
  try {
    if (kind === 'startup_manifest' && input.section === undefined && input.index === undefined) expected = buildAdaptiveStartupManifestSql(input.scope);
    else if (kind === 'startup_page' && section && index !== null) expected = buildAdaptiveStartupPageSql(input.scope, section, index);
    if (expected) scope = { project_ref: input.scope.project_ref, search_id: input.scope.search_id.toLowerCase(), run_id: input.scope.run_id.toLowerCase() };
  } catch { /* Invalid local scope cannot become a connector request. */ }
  const queryValid = typeof input.query === 'string' && input.query.length <= 65536;
  const templateMatches = expected !== undefined && queryValid && expected === input.query;
  const projectMatches = scope !== null && input.connector_project_id === scope.project_ref;
  const readback = input.checkpoint_readback_verified === true;
  const invalid = !scope || attempt === null || !queryValid;
  return {
    diagnostic_version: 1, event: 'request_preflight', request_kind: kind, expected_helper: helper,
    scope, section, index, attempt, request_sha256: queryValid ? await sha256(input.query) : null,
    template_matches: templateMatches, connector_project_matches: projectMatches, checkpoint_readback_verified: readback,
    local_preflight_passed: !invalid && templateMatches && projectMatches && readback,
    runtime_authorization: 'not_observed',
    failure_code: invalid ? 'invalid_request' : !projectMatches ? 'connector_project_mismatch'
      : !templateMatches ? 'request_template_mismatch' : !readback ? 'checkpoint_not_verified' : null,
  };
}

export interface AdaptiveStartupDiagnosticProgress {
  stage: 'preflight' | 'manifest' | 'context' | 'pages' | 'assembly' | 'checkpoint';
  verified_pages?: number; expected_pages?: number; missing_pages?: number; checkpoint_revision?: number;
  checkpoint_readback?: 'verified' | 'failed' | 'not_checked';
}

function diagnosticRequest(value: AdaptiveStartupRequestDiagnostic): AdaptiveStartupRequestDiagnostic {
  let scope: AdaptiveStartupTransportScope | null = null;
  try {
    if (value.scope) {
      buildAdaptiveStartupManifestSql(value.scope);
      scope = { project_ref: value.scope.project_ref, search_id: value.scope.search_id.toLowerCase(), run_id: value.scope.run_id.toLowerCase() };
    }
  } catch { /* Do not echo malformed scope data. */ }
  const requestHash = typeof value.request_sha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.request_sha256) ? value.request_sha256 : null;
  const attempt = value.attempt === 0 || value.attempt === 1 ? value.attempt : null;
  return {
    diagnostic_version: 1, event: 'request_preflight',
    request_kind: ['startup_manifest', 'startup_page'].includes(value.request_kind) ? value.request_kind : 'unrecognized',
    expected_helper: helper, scope,
    section: value.section && (ADAPTIVE_STARTUP_SECTIONS as readonly string[]).includes(value.section) ? value.section : null,
    index: value.index === null ? null : count(value.index, ADAPTIVE_STARTUP_MAX_PAGES - 1), attempt, request_sha256: requestHash,
    template_matches: value.template_matches === true, connector_project_matches: value.connector_project_matches === true,
    checkpoint_readback_verified: value.checkpoint_readback_verified === true,
    local_preflight_passed: Boolean(scope && requestHash && attempt !== null && value.local_preflight_passed === true
      && value.template_matches === true && value.connector_project_matches === true && value.checkpoint_readback_verified === true),
    runtime_authorization: 'not_observed',
    failure_code: ['invalid_request', 'connector_project_mismatch', 'request_template_mismatch', 'checkpoint_not_verified'].includes(value.failure_code ?? '')
      ? value.failure_code : null,
  };
}

/** Excludes SQL, response text, credentials, criteria, feedback and page bytes. */
export function adaptiveStartupFailureDiagnostic(request: AdaptiveStartupRequestDiagnostic,
  error: unknown, progress: AdaptiveStartupDiagnosticProgress) {
  const safeRequest = diagnosticRequest(request);
  const typed = error instanceof AdaptiveStartupTransportError ? error : null;
  const knownCode = typed && (diagnosticCodes.has(typed.code.toLowerCase())
    || typed.source === 'server' && typed.evidence === 'structured_metadata' && /^[0-9A-Z]{5}$/u.test(typed.code) && /[0-9]/u.test(typed.code));
  const stage = ['preflight', 'manifest', 'context', 'pages', 'assembly', 'checkpoint'].includes(progress.stage) ? progress.stage : 'preflight';
  return {
    diagnostic_version: 1 as const, event: 'startup_failure' as const, request: safeRequest, stage,
    category: typed && categories.includes(typed.category) ? typed.category : 'connector_unclassified',
    code: knownCode ? typed!.code : null, code_redacted: !knownCode,
    evidence: typed && ['decoder', 'server_contract', 'structured_metadata', 'runtime_observation'].includes(typed.evidence) ? typed.evidence : null,
    source: typed && ['transport', 'server'].includes(typed.source) ? typed.source : null,
    retry_eligible: Boolean(typed && safeRequest.local_preflight_passed && safeRequest.attempt === 0
      && canRetryAdaptiveStartupRequest(typed, 0, true)),
    verified_pages: count(progress.verified_pages), expected_pages: count(progress.expected_pages), missing_pages: count(progress.missing_pages),
    checkpoint_revision: count(progress.checkpoint_revision, Number.MAX_SAFE_INTEGER),
    checkpoint_readback: ['verified', 'failed', 'not_checked'].includes(progress.checkpoint_readback ?? '') ? progress.checkpoint_readback : 'not_checked',
  };
}

/** Only one absent-response retry of the identical persisted request is eligible. */
export function canRetryAdaptiveStartupDiagnostic(previous: AdaptiveStartupRequestDiagnostic, next: AdaptiveStartupRequestDiagnostic, error: unknown): boolean {
  return previous.local_preflight_passed && next.local_preflight_passed && previous.attempt === 0 && next.attempt === 1
    && previous.request_sha256 !== null && previous.request_sha256 === next.request_sha256
    && JSON.stringify(previous.scope) === JSON.stringify(next.scope)
    && previous.request_kind === next.request_kind && previous.section === next.section && previous.index === next.index
    && canRetryAdaptiveStartupRequest(error, 0, true);
}
