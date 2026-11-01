import assert from 'node:assert/strict';
import test from 'node:test';
import { AdaptiveStartupTransportError, decodeAdaptiveSearchSqlResponse } from '../../../src/features/meta-search/domain/adaptiveSearchTransport';

const decode = (value: unknown) => decodeAdaptiveSearchSqlResponse(value, 'startup', row => row);

test('nested non-JSON response logs the exact wrapper path without exposing or mutating its contents', context => {
  const logs: unknown[][] = [];
  context.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  const response = { text: JSON.stringify({ result: 'PRIVATE criteria, https://example.invalid/secret?token=private 🧠' }) };
  const original = structuredClone(response);
  assert.throws(() => decode(response), error => error instanceof AdaptiveStartupTransportError
    && error.code === 'invalid_response' && error.category === 'local_processing' && !error.retryable);
  assert.deepEqual(response, original);
  assert.deepEqual(logs, [['[CV Harness] response_decode_failed', {
    diagnostic_version: 1, column: 'startup', wrapper_path: ['text', 'result'], reason: 'missing_boundary',
    json_error_position: null, serialized_response_bytes: Buffer.byteLength(JSON.stringify(response)),
    input_present: true, category: 'local_processing', code: 'invalid_response', evidence: 'decoder',
  }]]);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|example\.invalid|token|🧠/u);
});

test('boundary mismatch and invalid enclosed JSON have different diagnostic reasons', context => {
  const logs: Record<string, unknown>[] = [];
  context.mock.method(console, 'error', (_label: string, record: Record<string, unknown>) => logs.push(record));
  assert.throws(() => decode({ result: '<untrusted-data-a>\n{}\n</untrusted-data-b>' }));
  assert.throws(() => decode({ result: '<untrusted-data-a>\n{"PRIVATE":invalid}\n</untrusted-data-a>' }));
  assert.throws(() => decode({ result: '{"PRIVATE":invalid}' }));
  assert.deepEqual(logs.map(log => log.reason), ['ambiguous_boundary', 'boundary_json', 'invalid_json']);
  assert.ok(logs[1]!.json_error_position === null || typeof logs[1]!.json_error_position === 'number');
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|Unexpected token|SyntaxError/u);
});

test('denials retain their classification and cannot be disguised by a successful mirror', context => {
  const logs: Record<string, unknown>[] = [];
  context.mock.method(console, 'error', (_label: string, record: Record<string, unknown>) => logs.push(record));
  const response = { text: JSON.stringify({ result: [{ startup: { compatible: true } }] }),
    structuredContent: { error: { code: 'SAFETY_DENIED', message: 'PRIVATE error details' } } };
  assert.throws(() => decode(response), error => error instanceof AdaptiveStartupTransportError
    && error.category === 'safety_denial' && !error.retryable);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.category, 'safety_denial');
  assert.equal(logs[0]!.code, 'SAFETY_DENIED');
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/u);
});

test('success is silent and logging failures do not mask the original decoding error', context => {
  const logger = context.mock.method(console, 'error', () => { throw new Error('Console unavailable'); });
  assert.deepEqual(decode({ text: JSON.stringify({ result: [{ startup: { compatible: true } }] }) }), { compatible: true });
  assert.equal(logger.mock.callCount(), 0);
  assert.throws(() => decode({ text: 'not JSON' }), error => error instanceof AdaptiveStartupTransportError
    && error.code === 'invalid_response');
  assert.equal(logger.mock.callCount(), 1);
});

test('unknown errors, circular data and unknown column names never leak through the log', context => {
  const logs: unknown[][] = [];
  context.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  const cause = new Error('PRIVATE normalizer error');
  assert.throws(() => decodeAdaptiveSearchSqlResponse([{ startup: {} }], 'startup', () => { throw cause; }), error => error === cause);
  const circular: { self?: unknown } = {}; circular.self = circular;
  assert.throws(() => decode(circular));
  assert.throws(() => decodeAdaptiveSearchSqlResponse({}, 'private_secret_column', row => row));
  assert.equal(logs.length, 3);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|private_secret_column|stack|self/u);
});
