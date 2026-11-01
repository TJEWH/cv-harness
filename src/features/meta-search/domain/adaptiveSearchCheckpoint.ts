import {
  AdaptiveStartupCollector, AdaptiveStartupTransportError, decodeAdaptiveStartupTransportResponse,
  canRetryAdaptiveStartupRequest, ADAPTIVE_STARTUP_MAX_PAGES, ADAPTIVE_STARTUP_SECTIONS,
  type AdaptiveStartupManifest, type AdaptiveStartupPage, type AdaptiveStartupSection, type AdaptiveStartupTransportScope,
} from './adaptiveSearchTransport';

/** Implementations must keep this private data local and scope the backing key to the binding. */
export interface AdaptiveStartupCheckpointStore {
  read(): Promise<string | null>;
  /** Must compare and replace atomically; a read followed by an unconditional write is insufficient. */
  compareAndSwap(expected: string | null, replacement: string): Promise<boolean>;
}
export interface AdaptiveStartupCheckpointBinding {
  profile_id: string;
  scope: AdaptiveStartupTransportScope;
}
export type AdaptiveStartupCheckpointRequest = { kind: 'manifest' } | { kind: 'page'; section: AdaptiveStartupSection; index: number };
type Fault = { code: string; category: string };
interface RequestLedger {
  request: AdaptiveStartupCheckpointRequest;
  query_sha256: string;
  attempts: 1 | 2;
  status: 'dispatched' | 'response_missing';
}
interface Checkpoint {
  checkpoint_version: 1;
  binding: AdaptiveStartupCheckpointBinding;
  status: 'probe' | 'ready' | 'collecting' | 'blocked';
  nonce: string | null;
  manifest: AdaptiveStartupManifest | null;
  pages: AdaptiveStartupPage[];
  fault: Fault | null;
  request_ledger: RequestLedger | null;
  local_readback_required: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = <T>(value: T): T => structuredClone(value);
const faultCategories = new Set(['local_processing', 'lost_transport', 'sql_application_rejection', 'approval_denial',
  'permission_denial', 'safety_denial', 'connector_unclassified']);
// Provider codes are untrusted strings, even when their spelling resembles an identifier.
const faultCodes = new Set(['checkpoint_scope_invalid', 'checkpoint_preflight_required', 'checkpoint_oversized', 'checkpoint_invalid_json',
  'checkpoint_invalid', 'checkpoint_probe_invalid', 'checkpoint_already_exists', 'checkpoint_probe_mismatch', 'checkpoint_readback_failed',
  'checkpoint_storage_failed', 'checkpoint_blocked', 'checkpoint_profile_mismatch', 'checkpoint_lease_invalid', 'checkpoint_run_inactive',
  'checkpoint_lease_expired', 'checkpoint_context_first_required', 'checkpoint_local_failure', 'invalid_header', 'invalid_scope',
  'checkpoint_request_invalid', 'checkpoint_request_changed', 'checkpoint_response_unreconciled',
  'checkpoint_retry_exhausted', 'checkpoint_response_mismatch', 'checkpoint_local_readback_required', 'checkpoint_stale',
  'invalid_manifest', 'invalid_page', 'invalid_section', 'invalid_response', 'invalid_row', 'ambiguous_rows', 'scope_oversized',
  'manifest_required', 'scope_mismatch', 'snapshot_changed', 'section_mismatch', 'conflicting_page', 'section_hash_mismatch',
  'invalid_section_utf8', 'invalid_section_json', 'invalid_section_shape', 'invalid_context', 'invalid_base64', 'invalid_page_length',
  'response_nesting', 'response_oversized',
  'invalid_server_error', 'connector_error', 'authorization_revoked', 'scope_unavailable', 'incompatible_release', 'runner_disabled',
  'run_in_progress', 'lease_expired', 'run_aborted', 'abort_verification_required', 'restart_unavailable',
  'permission_denied', 'approval_denied', 'safety_denied']);
function fail(code: string): never { throw new AdaptiveStartupTransportError(code); }
function binding(value: AdaptiveStartupCheckpointBinding): AdaptiveStartupCheckpointBinding {
  if (!record(value) || !record(value.scope) || typeof value.profile_id !== 'string' || !uuid.test(value.profile_id)
    || typeof value.scope.project_ref !== 'string' || !/^[a-z0-9]{20}$/u.test(value.scope.project_ref)
    || typeof value.scope.search_id !== 'string' || !uuid.test(value.scope.search_id)
    || typeof value.scope.run_id !== 'string' || !uuid.test(value.scope.run_id)) fail('checkpoint_scope_invalid');
  return { profile_id: value.profile_id.toLowerCase(), scope: { project_ref: value.scope.project_ref,
    search_id: value.scope.search_id.toLowerCase(), run_id: value.scope.run_id.toLowerCase() } };
}
function sameBinding(left: unknown, right: AdaptiveStartupCheckpointBinding): boolean {
  return record(left) && record(left.scope) && left.profile_id === right.profile_id
    && left.scope.project_ref === right.scope.project_ref && left.scope.search_id === right.scope.search_id && left.scope.run_id === right.scope.run_id;
}
function initial(value: AdaptiveStartupCheckpointBinding, status: Checkpoint['status'], nonce: string | null): Checkpoint {
  return { checkpoint_version: 1, binding: binding(value), status, nonce, manifest: null, pages: [], fault: null,
    request_ledger: null, local_readback_required: false };
}
function validRequest(value: unknown): value is AdaptiveStartupCheckpointRequest {
  return record(value) && (value.kind === 'manifest' && Object.keys(value).length === 1
    || value.kind === 'page' && Object.keys(value).sort().join('|') === 'index|kind|section'
      && (ADAPTIVE_STARTUP_SECTIONS as readonly string[]).includes(value.section as string)
      && Number.isSafeInteger(value.index) && (value.index as number) >= 0 && (value.index as number) < ADAPTIVE_STARTUP_MAX_PAGES);
}
function sameRequest(left: AdaptiveStartupCheckpointRequest, right: AdaptiveStartupCheckpointRequest): boolean {
  return left.kind === right.kind && (left.kind === 'manifest' || right.kind === 'page' && left.section === right.section && left.index === right.index);
}
function readCheckpoint(value: string | null, expected: AdaptiveStartupCheckpointBinding): Checkpoint {
  if (value === null) fail('checkpoint_preflight_required');
  if (typeof value !== 'string') fail('checkpoint_invalid');
  if (value.length > 1024 * 1024) fail('checkpoint_oversized');
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return fail('checkpoint_invalid_json'); }
  if (!record(raw) || Object.keys(raw).sort().join('|') !== ['checkpoint_version','binding','status','nonce','manifest','pages','fault','request_ledger','local_readback_required'].sort().join('|')
    || raw.checkpoint_version !== 1 || !sameBinding(raw.binding, expected)
    || !['probe', 'ready', 'collecting', 'blocked'].includes(raw.status as string)
    || !(raw.nonce === null || typeof raw.nonce === 'string') || !Array.isArray(raw.pages) || raw.pages.length > ADAPTIVE_STARTUP_MAX_PAGES
    || typeof raw.local_readback_required !== 'boolean') fail('checkpoint_invalid');
  const ledger = raw.request_ledger;
  if (ledger !== null && (!record(ledger) || Object.keys(ledger).sort().join('|') !== 'attempts|query_sha256|request|status'
    || !validRequest(ledger.request) || typeof ledger.query_sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(ledger.query_sha256)
    || ![1, 2].includes(ledger.attempts as number) || !['dispatched', 'response_missing'].includes(ledger.status as string))) fail('checkpoint_invalid');
  return raw as unknown as Checkpoint;
}
async function readStore(store: AdaptiveStartupCheckpointStore): Promise<string | null> {
  try { return await store.read(); } catch { return fail('checkpoint_storage_failed'); }
}
async function writeAndReadback(store: AdaptiveStartupCheckpointStore, expected: string | null, value: Checkpoint): Promise<string> {
  const serialized = JSON.stringify(value);
  try {
    if (!await store.compareAndSwap(expected, serialized)) fail('checkpoint_stale');
    if (await store.read() !== serialized) fail('checkpoint_readback_failed');
    return serialized;
  } catch (error) {
    if (error instanceof AdaptiveStartupTransportError) throw error;
    fail('checkpoint_storage_failed');
  }
}

/** These are deliberately separate actions: a write in one action does not prove persistence in another. */
export async function writeAdaptiveStartupCheckpointProbe(store: AdaptiveStartupCheckpointStore,
  value: AdaptiveStartupCheckpointBinding, nonce: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{16,128}$/u.test(nonce)) fail('checkpoint_probe_invalid');
  try {
    if (!await store.compareAndSwap(null, JSON.stringify(initial(value, 'probe', nonce)))) fail('checkpoint_already_exists');
  } catch (error) {
    if (error instanceof AdaptiveStartupTransportError) throw error;
    fail('checkpoint_storage_failed');
  }
}
export async function confirmAdaptiveStartupCheckpointProbe(store: AdaptiveStartupCheckpointStore,
  value: AdaptiveStartupCheckpointBinding, nonce: string): Promise<void> {
  const expected = binding(value), serialized = await readStore(store), saved = readCheckpoint(serialized, expected);
  if (saved.status !== 'probe' || saved.nonce !== nonce || saved.manifest !== null || saved.pages.length || saved.fault !== null
    || saved.request_ledger !== null || saved.local_readback_required) fail('checkpoint_probe_mismatch');
  await writeAndReadback(store, serialized, initial(expected, 'ready', null));
}

/** Offline state machine: it plans requests and accepts captures, but has no connector or network capability. */
export class AdaptiveStartupCheckpointSession {
  private readonly collector: AdaptiveStartupCollector;
  private state: Checkpoint;
  private constructor(private readonly expected: AdaptiveStartupCheckpointBinding, private readonly store: AdaptiveStartupCheckpointStore,
    private readonly now: () => number, state: Checkpoint, private serialized: string) {
    this.state = state;
    this.collector = new AdaptiveStartupCollector(expected.scope);
  }
  static async restore(value: AdaptiveStartupCheckpointBinding, store: AdaptiveStartupCheckpointStore,
    now: () => number = Date.now): Promise<AdaptiveStartupCheckpointSession> {
    const expected = binding(value), serialized = await readStore(store), state = readCheckpoint(serialized, expected);
    if (state.status === 'blocked') fail('checkpoint_blocked');
    if (state.status === 'probe') fail('checkpoint_preflight_required');
    if (state.nonce !== null || state.fault !== null || state.status === 'ready' && (state.manifest !== null || state.pages.length)
      || state.status === 'collecting' && state.manifest === null) fail('checkpoint_invalid');
    const session = new AdaptiveStartupCheckpointSession(expected, store, now, copy(state), serialized!);
    try {
      if (state.manifest !== null) {
        const manifest = decodeAdaptiveStartupTransportResponse([{ startup_manifest: state.manifest }], 'startup_manifest');
        if (manifest.scope.user_id !== expected.profile_id) fail('checkpoint_profile_mismatch');
        await session.collector.acceptManifest(manifest);
        for (const page of state.pages) await session.collector.acceptPage(page);
      }
      session.checkLease();
      const planned = session.plannedRequest();
      if (state.request_ledger !== null && (planned === null || !sameRequest(planned, state.request_ledger.request))) fail('checkpoint_request_changed');
      await session.assertFresh();
      return session;
    } catch (error) { await session.block(error); throw error; }
  }
  private checkActive(): void { if (this.state.status === 'blocked') fail('checkpoint_blocked'); }
  private invalidate(): void {
    this.collector.reset();
    this.state = { ...initial(this.expected, 'blocked', null), fault: { code: 'checkpoint_stale', category: 'local_processing' } };
  }
  private async assertFresh(): Promise<void> {
    try { if (await readStore(this.store) !== this.serialized) fail('checkpoint_stale'); }
    catch (error) { this.invalidate(); throw error; }
  }
  private async persist(): Promise<void> {
    try { this.serialized = await writeAndReadback(this.store, this.serialized, this.state); }
    catch (error) {
      // Never overwrite a newer durable checkpoint, including another session's denial tombstone.
      this.invalidate();
      throw error;
    }
  }
  private checkLease(): void {
    this.checkActive();
    const context = this.collector.getSection('context');
    if (context === undefined) return;
    const lease = (context as Record<string, unknown>).lease;
    if (!record(lease) || typeof lease.expires_at !== 'string' || !Number.isFinite(Date.parse(lease.expires_at))) fail('checkpoint_lease_invalid');
    if (lease.status !== 'active') fail('checkpoint_run_inactive');
    if (Date.parse(lease.expires_at) <= this.now()) fail('checkpoint_lease_expired');
  }
  private async block(error: unknown): Promise<void> {
    if (this.state.status === 'blocked') return;
    this.collector.reset();
    const safe = error instanceof AdaptiveStartupTransportError ? error : new AdaptiveStartupTransportError('checkpoint_local_failure');
    const category = 'category' in safe && typeof safe.category === 'string' && faultCategories.has(safe.category)
      ? safe.category : safe.source === 'server' ? 'sql_application_rejection' : 'local_processing';
    const code = faultCodes.has(safe.code) ? safe.code : 'checkpoint_local_failure';
    this.state = { ...initial(this.expected, 'blocked', null), fault: { code, category } };
    await this.persist();
  }
  private plannedRequest(): AdaptiveStartupCheckpointRequest | null {
    if (this.state.manifest === null) return { kind: 'manifest' };
    const page = this.collector.missingPages()[0];
    return page ? { kind: 'page', ...page } : null;
  }
  async nextRequest(): Promise<AdaptiveStartupCheckpointRequest | null> {
    try {
      await this.assertFresh();
      this.checkLease();
      if (this.state.local_readback_required) fail('checkpoint_local_readback_required');
      if (this.state.request_ledger?.status === 'dispatched') fail('checkpoint_response_unreconciled');
      return this.plannedRequest();
    } catch (error) {
      if (error instanceof AdaptiveStartupTransportError && ['checkpoint_local_readback_required', 'checkpoint_response_unreconciled'].includes(error.code)) throw error;
      await this.block(error); throw error;
    }
  }
  /** Persist before a caller dispatches. This method never executes SQL or a connector action. */
  async recordDispatch(request: AdaptiveStartupCheckpointRequest, querySha256: string): Promise<void> {
    try {
      await this.assertFresh();
      this.checkLease();
      if (!validRequest(request) || !/^[a-f0-9]{64}$/u.test(querySha256)) fail('checkpoint_request_invalid');
      if (this.state.local_readback_required) fail('checkpoint_local_readback_required');
      const planned = this.plannedRequest(), prior = this.state.request_ledger;
      if (planned === null || !sameRequest(request, planned)) fail('checkpoint_request_changed');
      if (prior && (!sameRequest(request, prior.request) || querySha256 !== prior.query_sha256)) fail('checkpoint_request_changed');
      if (prior?.status === 'dispatched') fail('checkpoint_response_unreconciled');
      if (prior?.attempts === 2) fail('checkpoint_retry_exhausted');
      this.state.request_ledger = { request: copy(request), query_sha256: querySha256, attempts: prior ? 2 : 1, status: 'dispatched' };
      await this.persist();
    } catch (error) { await this.block(error); throw error; }
  }
  async acceptResponse(value: unknown, column: 'startup_manifest' | 'startup_page'): Promise<void> {
    try {
      await this.assertFresh();
      this.checkLease();
      const pending = this.state.request_ledger?.request;
      if (column === 'startup_manifest') {
        if (pending && pending.kind !== 'manifest') fail('checkpoint_response_mismatch');
        const manifest = decodeAdaptiveStartupTransportResponse(value, column);
        if (manifest.scope.user_id !== this.expected.profile_id) fail('checkpoint_profile_mismatch');
        await this.collector.acceptManifest(manifest);
        this.state.manifest = manifest;
        this.state.status = 'collecting';
      } else {
        const page = decodeAdaptiveStartupTransportResponse(value, column);
        if (pending && (pending.kind !== 'page' || pending.section !== page.section || pending.index !== page.index)) fail('checkpoint_response_mismatch');
        if (this.collector.getSection('context') === undefined && page.section !== 'context') fail('checkpoint_context_first_required');
        await this.collector.acceptPage(page);
        if (!this.state.pages.some(known => known.section === page.section && known.index === page.index)) this.state.pages.push(page);
      }
      this.state.request_ledger = null;
      this.state.local_readback_required = false;
      this.checkLease();
      await this.persist();
    } catch (error) { await this.block(error); throw error; }
  }
  /** A trusted executor may report genuine transport loss; it must not pass denial/display text as this observation. */
  async recordFailure(error: AdaptiveStartupTransportError): Promise<void> {
    await this.assertFresh();
    this.checkActive();
    if (error.category === 'local_processing' && error.source === 'transport' && error.evidence === 'runtime_observation'
      && error.code === 'local_display_truncated') {
      this.state.local_readback_required = true;
      await this.persist();
      return;
    }
    const ledger = this.state.request_ledger;
    if (canRetryAdaptiveStartupRequest(error, ledger ? ledger.attempts - 1 : 0, ledger !== null)) {
      if (ledger!.status !== 'dispatched') fail('checkpoint_response_unreconciled');
      ledger!.status = 'response_missing';
      await this.persist();
      return;
    }
    await this.block(error);
  }
  async assemble(): Promise<Record<string, unknown>> {
    try { await this.assertFresh(); this.checkLease(); return await this.collector.assemble(); }
    catch (error) {
      if (error instanceof AdaptiveStartupTransportError && error.code === 'incomplete_transport') throw error;
      await this.block(error); throw error;
    }
  }
}
