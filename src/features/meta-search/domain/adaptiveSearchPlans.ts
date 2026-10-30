import { opportunityFeedbackTextHash, sanitizeOpportunityFeedbackUrl } from '../../opportunities/domain/opportunityFeedbackPrivacy';

export const ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION = 2;
export const ADAPTIVE_SEARCH_MAX_QUERIES = 30;
export type AdaptiveQueryRole = 'core' | 'adaptive' | 'exploration';
export interface AdaptiveSearchPlanBasis {
  base_revision: number;
  feedback_revision: number;
  preference_revision: number;
  protocol_version: string;
}
export interface AdaptiveSearchQueryInput {
  query_id: string;
  query: string;
  role: AdaptiveQueryRole;
  manual?: boolean;
  sources?: readonly string[];
  source_registry_id?: string;
  text_hash?: string;
}
export interface AdaptiveSearchQuery {
  readonly query_id: string;
  readonly query: string;
  readonly text_hash: string;
  readonly role: AdaptiveQueryRole;
  readonly manual: boolean;
  readonly sources?: readonly string[];
  readonly source_registry_id?: string;
}
export interface AdaptiveSearchPlan {
  readonly schema_version: typeof ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION;
  readonly basis: Readonly<AdaptiveSearchPlanBasis>;
  readonly queries: readonly AdaptiveSearchQuery[];
}
/** Exact v2 wire document. Revision axes and its legacy query-revision anchor stay in row metadata. */
export interface AdaptiveSearchPlanDocument {
  readonly schema_version: typeof ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION;
  readonly queries: readonly AdaptiveSearchQuery[];
}
export interface LegacySearchQuery {
  readonly query: string;
  readonly sources?: readonly string[];
}
export type ReadSearchQueryPlan =
  | { readonly format: 'missing'; readonly queries: readonly []; readonly requires_migration: false }
  | { readonly format: 'legacy'; readonly queries: readonly LegacySearchQuery[]; readonly requires_migration: true }
  | { readonly format: 'adaptive-v2'; readonly plan: AdaptiveSearchPlan; readonly requires_migration: false };
export interface AdaptiveSearchPlanFreshness {
  readonly status: 'missing' | 'legacy' | 'current' | 'stale';
  readonly stale_axes: readonly ('base' | 'feedback' | 'preference' | 'protocol')[];
  readonly core_stale: boolean;
  readonly adaptive_stale: boolean;
  readonly requires_generation: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sha256 = /^[0-9a-f]{64}$/u;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const keysAre = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const queryText = (value: unknown): value is string => typeof value === 'string' && Array.from(value.trim()).length >= 3
  && Array.from(value.trim()).length <= 2000 && !/[\u0000-\u001f\u007f]/u.test(value);

function validateBasis(value: unknown): Readonly<AdaptiveSearchPlanBasis> {
  if (!record(value) || !keysAre(value, ['base_revision', 'feedback_revision', 'preference_revision', 'protocol_version'])
    || !integer(value.base_revision, 1) || !integer(value.feedback_revision) || !integer(value.preference_revision)
    || typeof value.protocol_version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value.protocol_version)) throw new TypeError('Invalid independent search-plan revisions.');
  return Object.freeze({ base_revision: value.base_revision, feedback_revision: value.feedback_revision,
    preference_revision: value.preference_revision, protocol_version: value.protocol_version });
}
function publicSource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = sanitizeOpportunityFeedbackUrl(value);
  if (url) return url;
  // A historical query source may be a public host hint. Do not invent its scheme or listing path.
  if (value.length <= 253 && /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u.test(value)
    && !/\.(?:local|localhost)$/iu.test(value)) return value.toLowerCase();
  return null;
}

/** New v2 publication validates hashes and source hints without changing the legacy writer's strict input shape. */
export async function validateAdaptiveSearchQueries(value: unknown): Promise<readonly AdaptiveSearchQuery[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > ADAPTIVE_SEARCH_MAX_QUERIES) throw new RangeError('Publish between 1 and 30 search queries.');
  const identities = new Set<string>();
  const queries = await Promise.all(value.map(async (item): Promise<AdaptiveSearchQuery> => {
    if (!record(item) || !keysAre(item, ['query_id', 'query', 'text_hash', 'role', 'manual', 'sources', 'source_registry_id'])
      || typeof item.query_id !== 'string' || !uuid.test(item.query_id) || !queryText(item.query)
      || !['core', 'adaptive', 'exploration'].includes(item.role as string) || item.manual !== undefined && typeof item.manual !== 'boolean'
      || item.manual === true && item.role !== 'core'
      || item.source_registry_id !== undefined && (typeof item.source_registry_id !== 'string' || !uuid.test(item.source_registry_id))) throw new TypeError('Invalid version 2 search query.');
    const id = item.query_id.toLowerCase();
    if (identities.has(id)) throw new TypeError('A search plan cannot repeat a query identity.');
    identities.add(id);
    let sources: readonly string[] | undefined;
    if (item.sources !== undefined) {
      if (!Array.isArray(item.sources) || item.sources.length > 16) throw new TypeError('Use at most 16 public source hints per query.');
      const normalized = item.sources.map(publicSource);
      if (normalized.some(source => source === null)) throw new TypeError('Invalid public query source.');
      // Existing immutable core revisions compare this exact source-hint array.
      // Registry URL normalization belongs to the separate registry contract.
      sources = Object.freeze([...item.sources as string[]]);
    }
    const query = item.query, role = item.role as AdaptiveQueryRole, manual = item.manual === true,
      sourceRegistryId = item.source_registry_id === undefined ? undefined : (item.source_registry_id as string).toLowerCase(), expectedHash = item.text_hash;
    const hash = await opportunityFeedbackTextHash(query);
    if (expectedHash !== undefined && (typeof expectedHash !== 'string' || !sha256.test(expectedHash) || expectedHash !== hash)) throw new TypeError('The query text hash does not match its exact text.');
    return Object.freeze({ query_id: id, query, text_hash: hash, role, manual,
      ...(sources === undefined ? {} : { sources }), ...(sourceRegistryId === undefined ? {} : { source_registry_id: sourceRegistryId }) });
  }));
  return Object.freeze(queries);
}

export async function createAdaptiveSearchPlan(basis: AdaptiveSearchPlanBasis, queries: readonly AdaptiveSearchQueryInput[]): Promise<AdaptiveSearchPlan> {
  const capturedBasis = validateBasis(basis);
  const capturedQueries = await validateAdaptiveSearchQueries(queries);
  return Object.freeze({ schema_version: ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION, basis: capturedBasis, queries: capturedQueries });
}

/** Historical arrays stay historical. No generated IDs, timestamps, authorship or discovery attribution. */
export async function readSearchQueryPlan(value: unknown, basis?: AdaptiveSearchPlanBasis): Promise<ReadSearchQueryPlan> {
  if (value === null || value === undefined || Array.isArray(value) && value.length === 0) return Object.freeze({ format: 'missing', queries: Object.freeze([]) as readonly [], requires_migration: false });
  if (Array.isArray(value)) {
    if (value.length > ADAPTIVE_SEARCH_MAX_QUERIES) throw new RangeError('Historical search queries exceed the supported ceiling.');
    const legacy: LegacySearchQuery[] = [];
    for (const item of value) {
      // The old validator accepts any source strings. Reading is not approval to publish or execute them.
      if (!record(item) || !keysAre(item, ['query', 'sources']) || typeof item.query !== 'string'
        || Array.from(item.query.trim()).length < 3 || Array.from(item.query.trim()).length > 2000
        || item.sources !== undefined && (!Array.isArray(item.sources) || item.sources.some(source => typeof source !== 'string'))) throw new TypeError('Invalid historical query array.');
      legacy.push(Object.freeze({ query: item.query, ...(item.sources === undefined ? {} : { sources: Object.freeze([...item.sources as string[]]) }) }));
    }
    return Object.freeze({ format: 'legacy', queries: Object.freeze(legacy), requires_migration: true });
  }
  if (!record(value) || !keysAre(value, ['schema_version', 'queries']) || value.schema_version !== ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION) throw new TypeError('Unsupported search-query plan format.');
  const plan = await createAdaptiveSearchPlan(validateBasis(basis), value.queries as readonly AdaptiveSearchQueryInput[]);
  return Object.freeze({ format: 'adaptive-v2', plan, requires_migration: false });
}

export function adaptiveSearchPlanDocument(plan: AdaptiveSearchPlan): AdaptiveSearchPlanDocument {
  return Object.freeze({ schema_version: ADAPTIVE_SEARCH_QUERY_CONTRACT_VERSION, queries: plan.queries });
}

/** Management publication protection. A base edit can regenerate generated core queries, but never silently replace manual ones. */
export function validateAdaptiveSearchPlanTransition(previous: AdaptiveSearchPlan, next: AdaptiveSearchPlan): void {
  const protectAllCore = previous.basis.base_revision === next.basis.base_revision;
  for (const query of previous.queries.filter(item => item.role === 'core' && (protectAllCore || item.manual))) {
    const replacement = next.queries.find(item => item.query_id === query.query_id);
    if (!replacement || replacement.query !== query.query || replacement.text_hash !== query.text_hash || replacement.role !== query.role
      || replacement.manual !== query.manual || replacement.source_registry_id !== query.source_registry_id
      || JSON.stringify(replacement.sources) !== JSON.stringify(query.sources)) throw new TypeError('Adaptive publication must preserve protected core queries and source targets.');
  }
}

/** Preserve the real immutable legacy core anchor without inventing historical authorship or query IDs. */
export function validateLegacyCoreQueryAnchor(legacy: readonly LegacySearchQuery[], plan: AdaptiveSearchPlan): void {
  for (const previous of legacy) {
    if (!plan.queries.some(query => query.role === 'core' && query.query === previous.query
      && JSON.stringify(query.sources) === JSON.stringify(previous.sources))) throw new TypeError('The v2 plan must preserve its exact saved legacy core queries and source hints.');
  }
}

export function searchPlanFreshness(plan: ReadSearchQueryPlan, current: AdaptiveSearchPlanBasis): AdaptiveSearchPlanFreshness {
  const basis = validateBasis(current);
  if (plan.format === 'missing' || plan.format === 'legacy') return Object.freeze({ status: plan.format, stale_axes: Object.freeze([]),
    core_stale: true, adaptive_stale: true, requires_generation: true });
  const previous = plan.plan.basis;
  const axes: ('base' | 'feedback' | 'preference' | 'protocol')[] = [];
  if (previous.base_revision !== basis.base_revision) axes.push('base');
  if (previous.feedback_revision !== basis.feedback_revision) axes.push('feedback');
  if (previous.preference_revision !== basis.preference_revision) axes.push('preference');
  if (previous.protocol_version !== basis.protocol_version) axes.push('protocol');
  const coreStale = axes.includes('base') || axes.includes('protocol');
  return Object.freeze({ status: axes.length ? 'stale' : 'current', stale_axes: Object.freeze(axes), core_stale: coreStale,
    adaptive_stale: axes.length > 0, requires_generation: axes.length > 0 });
}

/** Composition only: preserves all current core queries and their source targets; no learning or query generation. */
export async function replaceAdaptiveSearchSlice(previous: AdaptiveSearchPlan, replacement: readonly AdaptiveSearchQueryInput[], basis: AdaptiveSearchPlanBasis): Promise<AdaptiveSearchPlan> {
  if (replacement.some(query => query.role === 'core' || query.manual)) throw new TypeError('Adaptive changes cannot replace manual or core queries.');
  const core = previous.queries.filter(query => query.role === 'core');
  const next = await createAdaptiveSearchPlan(basis, [...core, ...replacement]);
  validateAdaptiveSearchPlanTransition(previous, next);
  return next;
}

/** Explicit adapter for legacy bootstrap composition, never pass v2-only fields to its old strict writer. */
export function legacySearchQueriesPayload(plan: AdaptiveSearchPlan): readonly LegacySearchQuery[] {
  return Object.freeze(plan.queries.map(query => Object.freeze({ query: query.query,
    ...(query.sources === undefined ? {} : { sources: Object.freeze([...query.sources]) }) })));
}
