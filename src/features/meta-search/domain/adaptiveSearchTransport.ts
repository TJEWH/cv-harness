/** Bounded transport projections; all reads use the existing authorized startup helper. */
export const ADAPTIVE_STARTUP_PAGE_BYTES = 4096;
export const ADAPTIVE_STARTUP_MAX_PAGES = 70;
export const ADAPTIVE_STARTUP_MAX_BYTES = 262144;
export const ADAPTIVE_STARTUP_SECTIONS = ['context', 'planning', 'protocol_text', 'result_schema', 'feedback'] as const;
export type AdaptiveStartupSection = typeof ADAPTIVE_STARTUP_SECTIONS[number];
export interface AdaptiveStartupTransportScope { project_ref: string; search_id: string; run_id: string }
export interface AdaptiveStartupServerScope extends AdaptiveStartupTransportScope {
  user_id: string; authorization_epoch: string; authorization_revision: number;
}
export interface AdaptiveStartupSectionDescriptor {
  section: AdaptiveStartupSection; byte_length: number; sha256: string; page_count: number;
}
export interface AdaptiveStartupManifest {
  transport_version: 1; compatible: true; scope: AdaptiveStartupServerScope; bundle_hash: string;
  sections: AdaptiveStartupSectionDescriptor[];
}
export interface AdaptiveStartupPage extends AdaptiveStartupSectionDescriptor {
  transport_version: 1; compatible: true; scope: AdaptiveStartupServerScope; bundle_hash: string;
  index: number; data_base64: string;
}

/** Fixed templates are also embedded in the reviewed recurring instruction. */
export const ADAPTIVE_STARTUP_MANIFEST_SQL_TEMPLATE = `WITH startup AS MATERIALIZED (SELECT private.begin_adaptive_opportunity_search('{{search_id}}'::uuid,'<run-uuid>'::uuid) AS b)
SELECT CASE WHEN b->'compatible'='true'::jsonb THEN jsonb_build_object('transport_version',1,'compatible',true,'scope',b->'scope','bundle_hash',encode(sha256(convert_to(b::text,'UTF8')),'hex'),'sections',(SELECT jsonb_agg(jsonb_build_object('section',section,'byte_length',octet_length(v::text),'sha256',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'page_count',(octet_length(v::text)+4095)/4096) ORDER BY n) FROM (VALUES ('context',b-ARRAY['planning','protocol_text','result_schema','feedback'],1),('planning',b->'planning',2),('protocol_text',b->'protocol_text',3),('result_schema',b->'result_schema',4),('feedback',b->'feedback',5)) AS s(section,v,n))) ELSE jsonb_build_object('transport_version',1,'compatible',false,'error',b->'error') END AS startup_manifest FROM startup;`;

export const ADAPTIVE_STARTUP_PAGE_SQL_TEMPLATE = `WITH startup AS MATERIALIZED (SELECT private.begin_adaptive_opportunity_search('{{search_id}}'::uuid,'<run-uuid>'::uuid) AS b), section_data AS (SELECT b,CASE WHEN '<section>'='context' THEN b-ARRAY['planning','protocol_text','result_schema','feedback'] ELSE b->'<section>' END AS v FROM startup)
SELECT CASE WHEN b->'compatible'='true'::jsonb THEN jsonb_build_object('transport_version',1,'compatible',true,'scope',b->'scope','bundle_hash',encode(sha256(convert_to(b::text,'UTF8')),'hex'),'section','<section>','index',<page-index>,'byte_length',octet_length(v::text),'sha256',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'page_count',(octet_length(v::text)+4095)/4096,'data_base64',replace(encode(substring(convert_to(v::text,'UTF8') FROM (<page-index>*4096+1) FOR 4096),'base64'),E'\\n','')) ELSE jsonb_build_object('transport_version',1,'compatible',false,'error',b->'error') END AS startup_page FROM section_data;`;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hash = /^[0-9a-f]{64}$/u;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
function requestScope(value: AdaptiveStartupTransportScope): AdaptiveStartupTransportScope {
  if (!record(value) || !ownKeys(value, ['project_ref', 'search_id', 'run_id']) || typeof value.project_ref !== 'string'
    || !/^[a-z0-9]{20}$/u.test(value.project_ref) || typeof value.search_id !== 'string' || !uuid.test(value.search_id)
    || typeof value.run_id !== 'string' || !uuid.test(value.run_id)) throw new TypeError('Use the exact authorized startup scope.');
  return { project_ref: value.project_ref, search_id: value.search_id.toLowerCase(), run_id: value.run_id.toLowerCase() };
}
export function buildAdaptiveStartupManifestSql(scope: AdaptiveStartupTransportScope): string {
  const exact = requestScope(scope);
  return ADAPTIVE_STARTUP_MANIFEST_SQL_TEMPLATE.replaceAll('{{search_id}}', exact.search_id).replaceAll('<run-uuid>', exact.run_id);
}
export function buildAdaptiveStartupPageSql(scope: AdaptiveStartupTransportScope, section: AdaptiveStartupSection, index: number): string {
  const exact = requestScope(scope);
  if (!(ADAPTIVE_STARTUP_SECTIONS as readonly string[]).includes(section) || !Number.isSafeInteger(index) || index < 0 || index >= ADAPTIVE_STARTUP_MAX_PAGES) {
    throw new TypeError('Use a fixed startup section and bounded page index.');
  }
  return ADAPTIVE_STARTUP_PAGE_SQL_TEMPLATE.replaceAll('{{search_id}}', exact.search_id).replaceAll('<run-uuid>', exact.run_id)
    .replaceAll('<section>', section).replaceAll('<page-index>', String(index));
}

export type AdaptiveStartupFailureCategory = 'local_processing' | 'lost_transport' | 'sql_application_rejection'
  | 'approval_denial' | 'permission_denial' | 'safety_denial' | 'connector_unclassified';
export type AdaptiveStartupFailureEvidence = 'decoder' | 'server_contract' | 'structured_metadata' | 'runtime_observation';
const safeErrorCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(value);
export class AdaptiveStartupTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, readonly source: 'transport' | 'server' = 'transport',
    readonly category: AdaptiveStartupFailureCategory = source === 'server' ? 'sql_application_rejection' : 'local_processing',
    readonly evidence: AdaptiveStartupFailureEvidence = source === 'server' ? 'server_contract' : 'decoder') {
    const safe = safeErrorCode(code) ? code : 'unclassified_error';
    super(`Startup ${category} (${safe}).`);
    this.name = 'AdaptiveStartupTransportError'; this.code = safe;
    // A decoded response, a malformed local value, or a denial is never proof
    // that a server response was lost. Only the runtime can attest no receipt.
    this.retryable = category === 'lost_transport' && source === 'transport' && evidence === 'runtime_observation';
  }
}
export type AdaptiveStartupFailureObservation =
  | { kind: 'no_response'; request_dispatched: true; response_received: false; code?: string }
  | { kind: 'display_truncation'; response_received: true; code?: string }
  | { kind: Exclude<AdaptiveStartupFailureCategory, 'lost_transport'>; code: string };
/** Caller observations are host/runtime evidence, never instructions in SQL data. */
export function createAdaptiveStartupFailure(observation: AdaptiveStartupFailureObservation): AdaptiveStartupTransportError {
  if (!record(observation)) return new AdaptiveStartupTransportError('invalid_observation');
  const denial = safeErrorCode(observation.code) ? denialCategory(observation.code) : undefined;
  if (denial) return new AdaptiveStartupTransportError(observation.code!, 'transport', denial, 'runtime_observation');
  if (observation.kind === 'no_response') {
    return observation.request_dispatched === true && observation.response_received === false
      ? new AdaptiveStartupTransportError(observation.code ?? 'response_not_received', 'transport', 'lost_transport', 'runtime_observation')
      : new AdaptiveStartupTransportError('invalid_observation');
  }
  if (observation.kind === 'display_truncation') {
    return observation.response_received === true
      ? new AdaptiveStartupTransportError(observation.code ?? 'local_display_truncated', 'transport', 'local_processing', 'runtime_observation')
      : new AdaptiveStartupTransportError('invalid_observation');
  }
  if (!['local_processing', 'sql_application_rejection', 'approval_denial', 'permission_denial', 'safety_denial', 'connector_unclassified'].includes(observation.kind)) {
    return new AdaptiveStartupTransportError('invalid_observation');
  }
  return new AdaptiveStartupTransportError(observation.code, observation.kind === 'sql_application_rejection' ? 'server' : 'transport',
    observation.kind, 'runtime_observation');
}
export function isAdaptiveStartupDenial(error: unknown): boolean {
  return error instanceof AdaptiveStartupTransportError && ['approval_denial', 'permission_denial', 'safety_denial'].includes(error.category);
}
/** The caller must compare the persisted request identity, not merely its run ID. */
export function canRetryAdaptiveStartupRequest(error: unknown, identicalRetriesUsed: number, identicalRequest = false): boolean {
  return error instanceof AdaptiveStartupTransportError && error.category === 'lost_transport' && error.retryable
    && error.source === 'transport' && error.evidence === 'runtime_observation'
    && identicalRetriesUsed === 0 && identicalRequest === true;
}
function failure(code: string): never { throw new AdaptiveStartupTransportError(code); }
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => ownKeys(value, allowed) && allowed.every(key => key in value);
const integer = (value: unknown, minimum: number, maximum: number): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
function serverRejection(value: unknown): void {
  if (record(value) && value.compatible === false) {
    if (!record(value.error) || typeof value.error.code !== 'string' || !/^[a-z_]{1,80}$/u.test(value.error.code)
      || value.error.retryable !== false) failure('invalid_server_error');
    throw createAdaptiveSearchContractError(value.error.code);
  }
}
const denialCodes: Record<string, AdaptiveStartupFailureCategory> = {
  approval_denied: 'approval_denial', approval_rejected: 'approval_denial', approval_required: 'approval_denial',
  permission_denied: 'permission_denial', insufficient_privilege: 'permission_denial', access_denied: 'permission_denial',
  unauthorized: 'permission_denial', forbidden: 'permission_denial', '42501': 'permission_denial',
  authorization_revoked: 'permission_denial',
  safety_denied: 'safety_denial', safety_blocked: 'safety_denial', safety_block: 'safety_denial',
  blocked_by_safety: 'safety_denial', safety_policy_denied: 'safety_denial',
};
function denialCategory(code: string): AdaptiveStartupFailureCategory | undefined {
  const key = code.toLowerCase();
  return Object.hasOwn(denialCodes, key) ? denialCodes[key] : undefined;
}
/** Known contract denials share one classification across research and lifecycle operations. */
export function createAdaptiveSearchContractError(code: string): AdaptiveStartupTransportError {
  return new AdaptiveStartupTransportError(code, 'server', denialCategory(code) ?? 'sql_application_rejection', 'server_contract');
}
const sqlstateCode = (value: unknown): value is string => typeof value === 'string' && /^[0-9A-Z]{5}$/u.test(value);
function hasFailureMetadata(value: unknown): boolean {
  return record(value) && (value.error !== undefined && value.error !== null || safeErrorCode(value.error_code)
    || ['code', 'sqlstate', 'sql_state'].some(key => safeErrorCode(value[key])
      && (denialCategory(value[key]) !== undefined || sqlstateCode(value[key])))
    || [value.status, value.status_code].some(status => status === 401 || status === 403));
}
function connectorFailure(value: Record<string, unknown>): never {
  const metadata: Record<string, unknown>[] = [];
  const add = (candidate: unknown, depth = 0) => {
    if (depth > 16) return;
    // Inspect only bounded structured data in known connector wrappers. Error
    // prose is not evidence of a denial and is never evaluated as code.
    if (typeof candidate === 'string') {
      if (candidate.length > 16384) return;
      try { add(JSON.parse(candidate), depth + 1); } catch { /* Unstructured failures stay unclassified. */ }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) add(item, depth + 1);
      return;
    }
    if (!record(candidate)) return;
    metadata.push(candidate);
    if (record(candidate.error)) add(candidate.error, depth + 1);
    for (const key of ['structuredContent', 'result', 'data']) add(candidate[key], depth + 1);
    if (candidate.type === undefined || candidate.type === 'text') add(candidate.text, depth + 1);
    if (Array.isArray(candidate.content)) for (const block of candidate.content) {
      if (record(block) && block.type === 'text') add(block.text, depth + 1);
    }
  };
  add(value);
  // A generic outer HTTP status must not hide the connector's more specific
  // approval/safety/permission code in another structured representation.
  for (const item of metadata) for (const key of ['error_code', 'code', 'sqlstate', 'sql_state']) {
    const current = item[key];
    if (!safeErrorCode(current)) continue;
    const category = denialCategory(current);
    if (category) throw new AdaptiveStartupTransportError(current, 'transport', category, 'structured_metadata');
  }
  let code: string | undefined;
  let sqlstate: string | undefined;
  for (const item of metadata) {
    for (const key of ['error_code', 'code', 'sqlstate', 'sql_state']) {
      const current = item[key];
      if (!safeErrorCode(current)) continue;
      code ??= current;
      if (['code', 'sqlstate', 'sql_state'].includes(key) && sqlstateCode(current)) sqlstate = current;
    }
    const deniedStatus = [item.status, item.status_code].find(status => status === 401 || status === 403);
    if (deniedStatus !== undefined) {
      throw new AdaptiveStartupTransportError(String(deniedStatus), 'transport', 'permission_denial', 'structured_metadata');
    }
    // This is the connector's structured SQL-error formatter, not a search
    // over user text or a free-form denial-message heuristic.
    if (typeof item.message === 'string') {
      const state = /^Failed to run sql query:\s*ERROR:\s*([0-9A-Z]{5}):/u.exec(item.message)?.[1];
      if (state) {
        if (state === '42501') throw new AdaptiveStartupTransportError(state, 'server', 'permission_denial', 'structured_metadata');
        sqlstate = state;
      }
    }
  }
  if (sqlstate) throw new AdaptiveStartupTransportError(sqlstate, 'server', 'sql_application_rejection', 'structured_metadata');
  throw new AdaptiveStartupTransportError(code ?? 'connector_error', 'transport', 'connector_unclassified', 'structured_metadata');
}
function serverScope(value: unknown): AdaptiveStartupServerScope {
  if (!record(value) || !keys(value, ['project_ref', 'search_id', 'run_id', 'user_id', 'authorization_epoch', 'authorization_revision'])
    || typeof value.project_ref !== 'string' || !/^[a-z0-9]{20}$/u.test(value.project_ref)
    || !integer(value.authorization_revision, 0, Number.MAX_SAFE_INTEGER)
    || ['search_id', 'run_id', 'user_id', 'authorization_epoch'].some(key => typeof value[key] !== 'string' || !uuid.test(value[key] as string))) failure('invalid_scope');
  return { project_ref: value.project_ref, search_id: (value.search_id as string).toLowerCase(), run_id: (value.run_id as string).toLowerCase(),
    user_id: (value.user_id as string).toLowerCase(), authorization_epoch: (value.authorization_epoch as string).toLowerCase(), authorization_revision: value.authorization_revision };
}
function header(value: unknown): { row: Record<string, unknown>; scope: AdaptiveStartupServerScope; bundle_hash: string } {
  serverRejection(value);
  if (!record(value) || value.transport_version !== 1 || value.compatible !== true || typeof value.bundle_hash !== 'string' || !hash.test(value.bundle_hash)) failure('invalid_header');
  return { row: value, scope: serverScope(value.scope), bundle_hash: value.bundle_hash };
}
function descriptor(value: unknown): AdaptiveStartupSectionDescriptor {
  if (!record(value) || !keys(value, ['section', 'byte_length', 'sha256', 'page_count'])
    || !(ADAPTIVE_STARTUP_SECTIONS as readonly unknown[]).includes(value.section)
    || !integer(value.byte_length, 1, ADAPTIVE_STARTUP_MAX_BYTES) || typeof value.sha256 !== 'string' || !hash.test(value.sha256)
    || !integer(value.page_count, 1, ADAPTIVE_STARTUP_MAX_PAGES)
    || value.page_count !== Math.ceil(value.byte_length / ADAPTIVE_STARTUP_PAGE_BYTES)) failure('invalid_section');
  return { section: value.section as AdaptiveStartupSection, byte_length: value.byte_length, sha256: value.sha256, page_count: value.page_count };
}
function manifest(value: unknown): AdaptiveStartupManifest {
  const h = header(value);
  if (!keys(h.row, ['transport_version', 'compatible', 'scope', 'bundle_hash', 'sections']) || !Array.isArray(h.row.sections)
    || h.row.sections.length !== ADAPTIVE_STARTUP_SECTIONS.length) failure('invalid_manifest');
  const sections = h.row.sections.map(descriptor);
  if (sections.some((section, index) => section.section !== ADAPTIVE_STARTUP_SECTIONS[index])
    || sections.reduce((sum, section) => sum + section.page_count, 0) > ADAPTIVE_STARTUP_MAX_PAGES
    || sections.reduce((sum, section) => sum + section.byte_length, 0) > ADAPTIVE_STARTUP_MAX_BYTES
    || sections.find(section => section.section === 'feedback')!.byte_length > 65536) failure('scope_oversized');
  return { transport_version: 1, compatible: true, scope: h.scope, bundle_hash: h.bundle_hash, sections };
}
function page(value: unknown): AdaptiveStartupPage {
  const h = header(value);
  if (!keys(h.row, ['transport_version', 'compatible', 'scope', 'bundle_hash', 'section', 'index', 'byte_length', 'sha256', 'page_count', 'data_base64'])) failure('invalid_page');
  const d = descriptor({ section: h.row.section, byte_length: h.row.byte_length, sha256: h.row.sha256, page_count: h.row.page_count });
  if (!integer(h.row.index, 0, d.page_count - 1) || typeof h.row.data_base64 !== 'string'
    || h.row.data_base64.length > Math.ceil(ADAPTIVE_STARTUP_PAGE_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(h.row.data_base64)) failure('invalid_page');
  return { transport_version: 1, compatible: true, scope: h.scope, bundle_hash: h.bundle_hash, ...d, index: h.row.index, data_base64: h.row.data_base64 };
}
function parseString(value: string, maximumCharacters: number): unknown {
  if (value.length > maximumCharacters) failure('response_oversized');
  try { return JSON.parse(value); } catch { /* Connector warnings surround the actual SQL JSON. */ }
  const matches = [...value.matchAll(/^[\t ]*<untrusted-data-([A-Za-z0-9-]+)>[\t ]*\r?\n([\s\S]*?)\r?\n[\t ]*<\/untrusted-data-\1>[\t ]*$/gmu)];
  const boundaries = [...value.matchAll(/^[\t ]*<\/?untrusted-data-[A-Za-z0-9-]+>[\t ]*\r?$/gmu)];
  if (matches.length !== 1 || boundaries.length !== 2) failure('invalid_response');
  try { return JSON.parse(matches[0]![2]!); } catch { return failure('invalid_response'); }
}
interface SqlResponseDecoder<T> { column: string; normalize: (row: unknown) => T; maximumCharacters: number }
function decodedRow<T>(value: unknown, decoder: SqlResponseDecoder<T>): T {
  let decoded = value, depth = 0;
  while (typeof decoded === 'string') {
    if (++depth > 16) failure('response_nesting');
    decoded = parseString(decoded, decoder.maximumCharacters);
  }
  return decoder.normalize(decoded);
}
function mirroredRows<T>(representations: unknown[][], decoder: SqlResponseDecoder<T>): unknown[] {
  if (representations.length === 0) failure('invalid_response');
  if (representations.length === 1) return representations[0]!;
  if (representations.some(rows => rows.length !== 1)) failure('ambiguous_rows');
  // MCP normally mirrors the same row in content and structuredContent. Compare
  // validated, normalized rows so key order and JSON-string wrapping do not
  // select one representation over a conflicting result.
  const rows = representations.map(values => decodedRow(values[0], decoder));
  const canonical = (row: unknown) => JSON.stringify(row, (_key, entry: unknown) => record(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
  const first = canonical(rows[0]);
  if (rows.some(row => canonical(row) !== first)) failure('ambiguous_rows');
  return [rows[0]];
}
function sqlRows<T>(value: unknown, decoder: SqlResponseDecoder<T>, depth = 0): unknown[] {
  const column = decoder.column;
  if (depth > 16) failure('response_nesting');
  if (typeof value === 'string') return sqlRows(parseString(value, decoder.maximumCharacters), decoder, depth + 1);
  if (Array.isArray(value)) {
    if (value.length > 1) failure('ambiguous_rows');
    return value.flatMap(row => sqlRows(row, decoder, depth + 1));
  }
  if (!record(value)) failure('invalid_response');
  if (value.isError === true || hasFailureMetadata(value) || hasFailureMetadata(value.structuredContent)) connectorFailure(value);
  if (Object.hasOwn(value, column)) {
    if (!keys(value, [column])) failure('invalid_row');
    return [value[column]];
  }
  const representations: unknown[][] = [];
  if (Array.isArray(value.content)) {
    const texts = value.content.filter(block => record(block) && block.type === 'text' && typeof block.text === 'string');
    // MCP may put ordinary warning prose in its own text block. Ignore only
    // unstructured prose; a malformed JSON/boundary candidate still fails.
    const candidates = texts.filter(block => {
      const text = (block as { text: string }).text;
      return ['[', '{', '"'].some(prefix => text.trimStart().startsWith(prefix))
        || /^[\t ]*<\/?untrusted-data-[A-Za-z0-9-]+>[\t ]*\r?$/mu.test(text);
    });
    if (candidates.length) representations.push(candidates.flatMap(block => sqlRows((block as { text: string }).text, decoder, depth + 1)));
  }
  // Some connector hosts return a text envelope without the MCP type marker.
  // Compare it with every other representation; never select a convenient one.
  if (Object.hasOwn(value, 'text')) {
    if (typeof value.text !== 'string' || value.type !== undefined && value.type !== 'text') failure('invalid_response');
    representations.push(sqlRows(value.text, decoder, depth + 1));
  }
  if (value.structuredContent !== undefined && value.structuredContent !== null) representations.push(sqlRows(value.structuredContent, decoder, depth + 1));
  if (Object.hasOwn(value, 'result')) representations.push(sqlRows(value.result, decoder, depth + 1));
  if (Object.hasOwn(value, 'data')) representations.push(sqlRows(value.data, decoder, depth + 1));
  return mirroredRows(representations, decoder);
}
/** Shared bounded SQL/MCP decoder. normalize must validate and project a closed DTO; no returned text is executed. */
export function decodeAdaptiveSearchSqlResponse<T>(value: unknown, column: string, normalize: (row: unknown) => T,
  maximumCharacters = 2 * 1024 * 1024): T {
  if (!/^[a-z_]{1,64}$/u.test(column) || !Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1
    || maximumCharacters > 2 * 1024 * 1024) failure('invalid_row');
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { return failure('invalid_response'); }
  if (serialized === undefined) failure('invalid_response');
  if (serialized.length > maximumCharacters) failure('response_oversized');
  const decoder = { column, normalize, maximumCharacters }, rows = sqlRows(value, decoder);
  if (rows.length !== 1) failure('ambiguous_rows');
  return decodedRow(rows[0], decoder);
}
export function decodeAdaptiveStartupTransportResponse(value: unknown, column: 'startup_manifest'): AdaptiveStartupManifest;
export function decodeAdaptiveStartupTransportResponse(value: unknown, column: 'startup_page'): AdaptiveStartupPage;
export function decodeAdaptiveStartupTransportResponse(value: unknown, column: 'startup_manifest' | 'startup_page'): AdaptiveStartupManifest | AdaptiveStartupPage {
  if (!['startup_manifest', 'startup_page'].includes(column)) failure('invalid_row');
  return decodeAdaptiveSearchSqlResponse(value, column, row => column === 'startup_manifest' ? manifest(row) : page(row));
}
const sameScope = (a: AdaptiveStartupServerScope, b: AdaptiveStartupServerScope) => a.project_ref === b.project_ref && a.search_id === b.search_id
  && a.run_id === b.run_id && a.user_id === b.user_id && a.authorization_epoch === b.authorization_epoch && a.authorization_revision === b.authorization_revision;
const clone = <T>(value: T): T => structuredClone(value);
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function decodedBytes(value: AdaptiveStartupPage): Uint8Array {
  let raw: string;
  try { raw = atob(value.data_base64); } catch { return failure('invalid_base64'); }
  if (btoa(raw) !== value.data_base64 || raw.length !== Math.min(ADAPTIVE_STARTUP_PAGE_BYTES, value.byte_length - value.index * ADAPTIVE_STARTUP_PAGE_BYTES)) failure('invalid_page_length');
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
const contextFields = ['adaptive_contract_version', 'bootstrap_version', 'compatible', 'scope', 'release', 'base', 'preferences', 'query_plan',
  'legacy_core_queries', 'due_sources', 'source_context', 'refresh', 'lease', 'capabilities', 'execution_contract'] as const;
function context(value: unknown, expected: AdaptiveStartupServerScope): Record<string, unknown> {
  if (!record(value) || !contextFields.every(key => Object.hasOwn(value, key)) || !ownKeys(value, [...contextFields, 'source_retention'])
    || value.adaptive_contract_version !== 1 || value.bootstrap_version !== 1 || value.compatible !== true
    || !sameScope(serverScope(value.scope), expected) || !record(value.base) || !integer(value.base.revision, 0, Number.MAX_SAFE_INTEGER)
    || !record(value.base.criteria) || !ownKeys(value.base.criteria, ['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions', 'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting'])
    || Object.values(value.base.criteria).some(field => typeof field !== 'string')
    || !record(value.preferences) || !Array.isArray(value.preferences.approved_rules) || !Array.isArray(value.preferences.approved_preferences)
    || !record(value.capabilities) || value.capabilities.capability_version !== 'adaptive-batch-v1'
    || value.capabilities.startup !== true || value.capabilities.batch !== true || value.capabilities.completion !== true
    || !Array.isArray(value.capabilities.allowed_helpers) || value.capabilities.allowed_helpers.join('|') !== [
      'private.begin_adaptive_opportunity_search(uuid,uuid)', 'private.submit_adaptive_search_batch(uuid,uuid,jsonb)', 'private.verify_and_complete_adaptive_search(uuid,jsonb)',
    ].join('|') || !record(value.execution_contract) || value.execution_contract.maximum_bundle_bytes !== ADAPTIVE_STARTUP_MAX_BYTES
    || !record(value.release) || !record(value.refresh) || !record(value.lease)) failure('invalid_context');
  if (value.query_plan !== null && (!record(value.query_plan) || !record(value.query_plan.document) || !Array.isArray(value.query_plan.document.queries))
    || value.legacy_core_queries !== null && (!record(value.legacy_core_queries) || !Array.isArray(value.legacy_core_queries.queries))) failure('invalid_context');
  for (const key of ['due_sources', 'source_context'] as const) {
    const rows = value[key];
    if (!Array.isArray(rows) || rows.length > 64 || rows.some(row => !record(row) || typeof row.registry_id !== 'string' || !uuid.test(row.registry_id)
      || typeof row.listing_url !== 'string')) failure('invalid_context');
  }
  return value;
}

/** No network access: verified pages are collected before any research can begin. */
export class AdaptiveStartupCollector {
  private readonly expected: AdaptiveStartupTransportScope;
  private current: AdaptiveStartupManifest | null = null;
  private generation = 0;
  private readonly pages = new Map<AdaptiveStartupSection, Map<number, { text: string; bytes: Uint8Array }>>();
  private readonly values = new Map<AdaptiveStartupSection, unknown>();
  constructor(scope: AdaptiveStartupTransportScope) { this.expected = requestScope(scope); }
  reset(): void { this.generation++; this.current = null; this.pages.clear(); this.values.clear(); }
  async acceptManifest(value: unknown): Promise<void> {
    try {
      const next = manifest(value);
      if (next.scope.project_ref !== this.expected.project_ref || next.scope.search_id !== this.expected.search_id || next.scope.run_id !== this.expected.run_id) failure('scope_mismatch');
      if (this.current && JSON.stringify(this.current) !== JSON.stringify(next)) failure('snapshot_changed');
      this.current = next;
    } catch (error) { this.reset(); throw error; }
  }
  async acceptPage(value: unknown): Promise<void> {
    try {
      const next = page(value), current = this.current, generation = this.generation;
      if (!current) failure('manifest_required');
      if (next.bundle_hash !== current.bundle_hash) failure('snapshot_changed');
      if (!sameScope(next.scope, current.scope)) failure('scope_mismatch');
      const expected = current.sections.find(section => section.section === next.section)!;
      if (next.byte_length !== expected.byte_length || next.sha256 !== expected.sha256 || next.page_count !== expected.page_count) failure('section_mismatch');
      const bytes = decodedBytes(next), known = this.pages.get(next.section) ?? new Map();
      const prior = known.get(next.index);
      if (prior) { if (prior.text !== next.data_base64) failure('conflicting_page'); return; }
      known.set(next.index, { text: next.data_base64, bytes }); this.pages.set(next.section, known);
      if (known.size === expected.page_count) {
        const joined = new Uint8Array(expected.byte_length);
        for (let index = 0; index < expected.page_count; index++) joined.set(known.get(index)!.bytes, index * ADAPTIVE_STARTUP_PAGE_BYTES);
        if (await sha256(joined) !== expected.sha256) failure('section_hash_mismatch');
        if (this.generation !== generation || this.current !== current) failure('snapshot_changed');
        let text: string, decoded: unknown;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(joined); }
        catch { return failure('invalid_section_utf8'); }
        try { decoded = JSON.parse(text); }
        catch { return failure('invalid_section_json'); }
        if (next.section === 'context') context(decoded, current.scope);
        this.values.set(next.section, decoded);
      }
    } catch (error) { this.reset(); throw error; }
  }
  async acceptResponse(value: unknown, column: 'startup_manifest' | 'startup_page'): Promise<void> {
    try {
      if (column === 'startup_manifest') await this.acceptManifest(decodeAdaptiveStartupTransportResponse(value, column));
      else await this.acceptPage(decodeAdaptiveStartupTransportResponse(value, column));
    } catch (error) { this.reset(); throw error; }
  }
  missingPages(): { section: AdaptiveStartupSection; index: number }[] {
    if (!this.current) return [];
    return this.current.sections.flatMap(section => Array.from({ length: section.page_count }, (_, index) => ({ section: section.section, index }))
      .filter(page => !this.pages.get(page.section)?.has(page.index)));
  }
  getSection(section: AdaptiveStartupSection): unknown { return this.values.has(section) ? clone(this.values.get(section)) : undefined; }
  async assemble(): Promise<Record<string, unknown>> {
    if (!this.current || this.missingPages().length || this.values.size !== ADAPTIVE_STARTUP_SECTIONS.length) failure('incomplete_transport');
    try {
      const core = context(this.values.get('context'), this.current.scope);
      const planning = this.values.get('planning'), protocol_text = this.values.get('protocol_text'), result_schema = this.values.get('result_schema'), feedback = this.values.get('feedback');
      if (!record(planning) || typeof protocol_text !== 'string' || !protocol_text.trim() || !record(result_schema) || !record(feedback)) failure('invalid_section_shape');
      const result = { ...core, planning, protocol_text, result_schema, feedback };
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > ADAPTIVE_STARTUP_MAX_BYTES) failure('scope_oversized');
      return clone(result);
    } catch (error) { this.reset(); throw error; }
  }
}
