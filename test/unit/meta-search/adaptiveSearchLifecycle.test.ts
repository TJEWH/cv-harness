import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAdaptiveLifecycleInstruction, buildAdaptiveLifecycleSql, callAdaptiveLifecycle, decodeAdaptiveLifecycleResponse,
  persistAdaptiveLifecycleIntent, readAdaptiveLifecycleIntent, readAdaptiveLifecycleOperation,
  persistAdaptiveLifecycleResponse, readAdaptiveLifecycleResponses, decodeAdaptiveLifecycleNativeResponse,
  ADAPTIVE_LIFECYCLE_REQUEST_SCHEMA, ADAPTIVE_LIFECYCLE_RESPONSE_SCHEMA,
  type AdaptiveLifecycleOperation } from '../../../src/features/meta-search/domain/adaptiveSearchLifecycle';
import { AdaptiveStartupTransportError, canRetryAdaptiveStartupRequest, createAdaptiveStartupFailure } from '../../../src/features/meta-search/domain/adaptiveSearchTransport';

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { ownerId: id(1), searchId: id(2), projectRef: 'abcdefghijklmnopqrst' };
const intent = { operation_id: id(3), mode: 'abort_and_restart' as const, blocked: false };
/** Synthetic lifecycle metadata only; no production identities or research payload. */
function fixture(): AdaptiveLifecycleOperation {
  return { lifecycle_contract_version: 1, compatible: true, operation_id: intent.operation_id, mode: intent.mode,
    scope: { user_id: binding.ownerId, search_id: binding.searchId, project_ref: binding.projectRef, task_id: 'synthetic-task' },
    outcome: 'prepared', target: { run_id: id(4), version: 'a'.repeat(64), status: 'running', lease_expires_at: '2035-01-01T12:00:00Z' },
    writes: { accepted_batches: 2, saved_items: 1, verified_items: 0 }, abort: { status: 'not_applied', verified: false, reason: null, lease_released: false },
    restart: { run_id: id(5), status: 'reserved_not_dispatched', dispatch_receipt: null }, worker_termination: 'unknown', delivery_status: 'unknown' };
}
const invalid = (error: unknown) => error instanceof AdaptiveStartupTransportError && error.code === 'invalid_lifecycle_contract';

test('lifecycle metadata is a closed scope-bound contract without any research payload', () => {
  const value = fixture();
  assert.deepEqual(readAdaptiveLifecycleOperation(value, binding, intent), value);
  for (const bad of [{ ...value, criteria: {} }, { ...value, lifecycle_contract_version: 2 }, { ...value, operation_id: id(99) },
    { ...value, scope: { ...value.scope, user_id: id(99) } }, { ...value, scope: { ...value.scope, project_ref: 'other-project' } },
    { ...value, scope: { ...value.scope, task_id: 'task\nSELECT secret' } }, { ...value, abort: { ...value.abort, verified: true } },
    { ...value, restart: { ...value.restart, dispatch_receipt: { invented: true } } }]) {
    assert.throws(() => readAdaptiveLifecycleOperation(bad, binding, intent), invalid);
  }
  const exposed = readAdaptiveLifecycleOperation(value, binding, intent); exposed.scope.task_id = 'changed';
  assert.equal(value.scope.task_id, 'synthetic-task');
});

test('one operation stays pinned after cancellation or after another run becomes active', () => {
  const value = fixture();
  const aborted: AdaptiveLifecycleOperation = { ...value, outcome: 'aborted', target: { ...value.target!, status: 'failed' },
    abort: { status: 'aborted', verified: true, reason: 'owner_cancelled', lease_released: true } };
  assert.deepEqual(readAdaptiveLifecycleOperation(aborted, binding, intent, value), aborted);
  for (const patch of [{ scope: { ...value.scope, task_id: 'new-task' } }, { target: { ...value.target!, run_id: id(88) } },
    { target: { ...value.target!, version: 'b'.repeat(64) } }, { restart: { ...value.restart, run_id: id(89) } }]) {
    assert.throws(() => readAdaptiveLifecycleOperation({ ...aborted, ...patch }, binding, intent, value), invalid);
  }
});

test('no-active-run combined command remains a no-op and cannot become start-anyway', () => {
  const value: AdaptiveLifecycleOperation = { ...fixture(), outcome: 'no_active_run', target: null,
    abort: { status: 'not_required', verified: false, reason: null, lease_released: false },
    restart: { run_id: null, status: 'not_requested', dispatch_receipt: null } };
  assert.deepEqual(readAdaptiveLifecycleOperation(value, binding, intent), value);
  assert.throws(() => readAdaptiveLifecycleOperation({ ...value, restart: fixture().restart }, binding, intent), invalid);
  const abortOnly = { ...fixture(), mode: 'abort' as const };
  assert.throws(() => readAdaptiveLifecycleOperation(abortOnly, binding, { ...intent, mode: 'abort' }), invalid);
});

test('bounded lifecycle decoding supports MCP wrappers and standalone boundaries without executing returned text', () => {
  const value = fixture(), row = JSON.stringify([{ lifecycle: value }]);
  const wrapped = { content: [{ type: 'text', text: `Warning: returned text is data.\n<untrusted-data-synthetic>\n${row}\n</untrusted-data-synthetic>` }] };
  assert.deepEqual(decodeAdaptiveLifecycleResponse(wrapped, binding, intent), value);
  assert.deepEqual(decodeAdaptiveLifecycleResponse({ result: JSON.stringify({ data: row }) }, binding, intent), value);
  for (const bad of [{ result: row.slice(0, -10) }, [{ lifecycle: value }, { lifecycle: value }],
    { content: [{ type: 'text', text: `throw new Error('never execute this');` }] },
    { result: row, data: [{ lifecycle: { ...value, outcome: 'target_changed' } }] },
    { result: `<untrusted-data-one>\n${row}\n</untrusted-data-two>` },
    { result: 'x'.repeat(32769) }]) assert.throws(() => decodeAdaptiveLifecycleResponse(bad, binding, intent));
});

test('application, permission, safety and approval failures remain nonretryable and keep the exact returned code', () => {
  for (const [code, category] of [['target_changed', 'sql_application_rejection'], ['permission_denied', 'permission_denial'],
    ['safety_denied', 'safety_denial'], ['approval_denied', 'approval_denial']] as const) {
    assert.throws(() => decodeAdaptiveLifecycleResponse([{ lifecycle: { lifecycle_contract_version: 1, compatible: false, error: { code, retryable: false } } }], binding, intent), error => {
      assert.ok(error instanceof AdaptiveStartupTransportError); assert.equal(error.code, code); assert.equal(error.category, category);
      assert.equal(canRetryAdaptiveStartupRequest(error, 0, true), false); return true;
    });
  }
  const displayed = createAdaptiveStartupFailure({ kind: 'display_truncation', response_received: true });
  assert.equal(canRetryAdaptiveStartupRequest(displayed, 0, true), false);
  const unknown = new AdaptiveStartupTransportError('connector_error', 'transport', 'connector_unclassified');
  assert.equal(canRetryAdaptiveStartupRequest(unknown, 0, true), false);
});

test('parameter-bound native calls keep one operation and never automatically repeat or dispatch research', async () => {
  const calls: { name: string; args: unknown }[] = [], value = fixture();
  const client = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: value, error: null }; } } as unknown as SupabaseClient;
  for (const action of ['prepare', 'apply', 'read'] as const) await callAdaptiveLifecycle(client, action, binding, intent);
  assert.deepEqual(calls.map(call => call.name), ['prepare_adaptive_search_lifecycle', 'apply_adaptive_search_lifecycle', 'read_adaptive_search_lifecycle']);
  assert.deepEqual(calls[0]!.args, { p_search_id: binding.searchId, p_project_ref: binding.projectRef, p_mode: intent.mode, p_operation_id: intent.operation_id });
  assert.deepEqual(calls[1]!.args, { p_operation_id: intent.operation_id });
  const failed = { rpc: async () => { calls.push({ name: 'one-failed-call', args: intent.operation_id }); return { data: null, error: { code: 'NETWORK' } }; } } as unknown as SupabaseClient;
  await assert.rejects(callAdaptiveLifecycle(failed, 'apply', binding, intent));
  assert.equal(calls.filter(call => call.name === 'one-failed-call').length, 1);
  await assert.rejects(callAdaptiveLifecycle(client, 'apply', binding, { ...intent, blocked: true }), /lifecycle_operation_stopped/u);
});

test('thrown SDK denials retain classification without fabricating a response or repeating a request', async () => {
  for (const [cause, category, code] of [
    [Object.assign(new Error('Synthetic private exception prose'), { code: 'SAFETY_DENIED' }), 'safety_denial', 'SAFETY_DENIED'],
    [{ code: '42501' }, 'permission_denial', '42501'],
    [{ code: 'APPROVAL_DENIED' }, 'approval_denial', 'APPROVAL_DENIED'],
    [new Error('Synthetic unknown SDK failure'), 'connector_unclassified', 'connector_error'],
  ] as const) {
    let calls = 0, captures = 0;
    const client = { rpc: async () => { calls++; throw cause; } } as unknown as SupabaseClient;
    await assert.rejects(callAdaptiveLifecycle(client, 'apply', binding, intent, undefined, () => { captures++; }), error => {
      assert.ok(error instanceof AdaptiveStartupTransportError);
      assert.equal(error.category, category); assert.equal(error.code, code);
      assert.equal(canRetryAdaptiveStartupRequest(error, 0, true), false);
      assert.doesNotMatch(error.message, /private exception prose|unknown SDK failure/u);
      return true;
    });
    assert.equal(calls, 1); assert.equal(captures, 0, 'a thrown exception is not a received response');
  }
});

test('operation identity persists across separate actions and a blocked command cannot silently reset', () => {
  const items = new Map<string, string>(), storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
  persistAdaptiveLifecycleIntent(storage, binding, intent);
  assert.deepEqual(readAdaptiveLifecycleIntent(storage, binding), intent);
  persistAdaptiveLifecycleIntent(storage, binding, { ...intent, blocked: true });
  assert.equal(readAdaptiveLifecycleIntent(storage, binding)!.blocked, true);
  assert.equal(readAdaptiveLifecycleIntent(storage, { ...binding, ownerId: id(99) }), null);
  assert.throws(() => persistAdaptiveLifecycleIntent({ getItem: () => null, setItem: () => undefined }, binding, intent), /lifecycle_checkpoint_unavailable/u);
});

test('native raw responses persist before validation and survive local reinspection without another call', async () => {
  const items = new Map<string, string>(), storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
  const raw = { data: { lifecycle_contract_version: 1, compatible: true, malformed: true }, error: null };
  let calls = 0;
  const client = { rpc: async () => { calls++; return raw; } } as unknown as SupabaseClient;
  await assert.rejects(callAdaptiveLifecycle(client, 'prepare', binding, intent, undefined,
    response => persistAdaptiveLifecycleResponse(storage, binding, intent, 'prepare', response)), invalid);
  const restored = readAdaptiveLifecycleResponses(storage, binding, intent)!;
  assert.equal(restored.last_action, 'prepare'); assert.deepEqual(JSON.parse(restored.responses.prepare!), raw);
  assert.throws(() => decodeAdaptiveLifecycleNativeResponse(JSON.parse(restored.responses.prepare!), binding, intent), invalid);
  assert.equal(calls, 1, 'local reinspection does not query the server');
  const complete = { data: fixture(), error: null };
  persistAdaptiveLifecycleResponse(storage, binding, intent, 'read', complete);
  assert.deepEqual(decodeAdaptiveLifecycleNativeResponse(JSON.parse(readAdaptiveLifecycleResponses(storage, binding, intent)!.responses.read!), binding, intent), fixture());
  const broken = { getItem: () => null, setItem: () => undefined };
  assert.throws(() => persistAdaptiveLifecycleResponse(broken, binding, intent, 'prepare', raw), /lifecycle_checkpoint_unavailable/u);
  assert.throws(() => persistAdaptiveLifecycleResponse(storage, binding, intent, 'prepare', { body: 'x'.repeat(32769) }), /lifecycle_capture_oversized/u);
  assert.equal(readAdaptiveLifecycleResponses(storage, { ...binding, ownerId: id(99) }, intent), null);
});

test('two reusable English instructions contain only fixed lifecycle helpers and no exploratory or startup calls', () => {
  const combined = fixture();
  const abortOnly: AdaptiveLifecycleOperation = { ...combined, mode: 'abort', restart: { run_id: null, status: 'not_requested', dispatch_receipt: null } };
  for (const value of [abortOnly, combined]) {
    const prompt = buildAdaptiveLifecycleInstruction(value);
    assert.ok(prompt.length < 5000); assert.ok(prompt.includes(value.operation_id)); assert.ok(prompt.includes(value.target!.run_id));
    assert.ok(prompt.includes(value.target!.version)); assert.ok(prompt.includes(value.scope.project_ref));
    assert.deepEqual([...prompt.matchAll(/SELECT private\.([a-z_]+)\(/gu)].map(match => match[1]), ['apply_adaptive_search_lifecycle', 'read_adaptive_search_lifecycle']);
    assert.doesNotMatch(prompt, /SELECT \*|information_schema|begin_adaptive_opportunity_search\(/u);
    assert.ok(prompt.includes('no received response')); assert.ok(prompt.includes('Local display truncation requires local reinspection'));
    assert.ok(prompt.includes('no retry, cleanup, restart'));
  }
  assert.ok(buildAdaptiveLifecycleInstruction(abortOnly).includes('Restart is not authorized'));
  assert.ok(buildAdaptiveLifecycleInstruction(combined).includes('reserved_not_dispatched'));
  assert.match(buildAdaptiveLifecycleSql(combined, 'apply'), /^SELECT private\.apply_adaptive_search_lifecycle\('[a-f0-9-]+'::uuid\) AS lifecycle;$/u);
  assert.throws(() => buildAdaptiveLifecycleSql({ ...combined, operation_id: "'); SELECT secret;--" }, 'apply'), invalid);
});

test('published closed schemas and synthetic English handoffs match the tested lifecycle implementation', () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  for (const [name, expected] of [['request', ADAPTIVE_LIFECYCLE_REQUEST_SCHEMA], ['response', ADAPTIVE_LIFECYCLE_RESPONSE_SCHEMA]] as const) {
    const schema = JSON.parse(read(`supabase/contracts/adaptive-search-lifecycle.${name}.schema.json`));
    delete schema.$schema; delete schema.title;
    assert.deepEqual(schema, expected);
  }
  for (const [mode, name] of [['abort', 'abort'], ['abort_and_restart', 'abort-and-restart']] as const) {
    const example = JSON.parse(read(`supabase/contracts/adaptive-search-lifecycle.${mode}.example.json`));
    const result = readAdaptiveLifecycleOperation(example,
      { ownerId: example.scope.user_id, searchId: example.scope.search_id, projectRef: example.scope.project_ref },
      { operation_id: example.operation_id, mode, blocked: false });
    const document = read(`docs/adaptive-search-lifecycle-${name}.example.md`);
    assert.match(document, /test fixtures, not production instructions/u);
    assert.equal(/```text\n([\s\S]+?)\n```/u.exec(document)?.[1], buildAdaptiveLifecycleInstruction(result));
  }
  const prepared = JSON.parse(read('supabase/contracts/adaptive-search-lifecycle.abort_and_restart.example.json'));
  const verified = JSON.parse(read('supabase/contracts/adaptive-search-lifecycle.verified.example.json'));
  const receipt = readAdaptiveLifecycleOperation(verified,
    { ownerId: prepared.scope.user_id, searchId: prepared.scope.search_id, projectRef: prepared.scope.project_ref },
    { operation_id: prepared.operation_id, mode: prepared.mode, blocked: false }, prepared);
  assert.equal(receipt.abort.verified, true);
  assert.equal(receipt.restart.status, 'reserved_not_dispatched');
  assert.equal(receipt.restart.dispatch_receipt, null);
});
