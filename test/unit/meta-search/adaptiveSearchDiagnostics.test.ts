import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveStartupFailureDiagnostic, canRetryAdaptiveStartupDiagnostic, inspectAdaptiveStartupRequest } from '../../../src/features/meta-search/domain/adaptiveSearchDiagnostics';
import { AdaptiveStartupTransportError, buildAdaptiveStartupManifestSql, buildAdaptiveStartupPageSql, createAdaptiveStartupFailure } from '../../../src/features/meta-search/domain/adaptiveSearchTransport';

const scope = { project_ref: 'abcdefghijklmnopqrst', search_id: '90000000-0000-4000-8000-000000000001', run_id: '90000000-0000-4000-8000-000000000002' };
const request = (patch: Partial<Parameters<typeof inspectAdaptiveStartupRequest>[0]> = {}) => inspectAdaptiveStartupRequest({
  scope, kind: 'startup_manifest', connector_project_id: scope.project_ref, query: buildAdaptiveStartupManifestSql(scope),
  attempt: 0, checkpoint_readback_verified: true, ...patch,
});

test('offline request evidence binds the actual connector project and exact SQL without claiming authorization', async () => {
  const valid = await request();
  assert.equal(valid.local_preflight_passed, true); assert.equal(valid.template_matches, true);
  assert.equal(valid.runtime_authorization, 'not_observed'); assert.match(valid.request_sha256!, /^[a-f0-9]{64}$/u);
  const misrouted = await request({ connector_project_id: 'another-project' });
  assert.equal(misrouted.local_preflight_passed, false); assert.equal(misrouted.failure_code, 'connector_project_mismatch');
  const unreviewed = await request({ query: 'SELECT * FROM private.synthetic_records;' });
  assert.equal(unreviewed.local_preflight_passed, false); assert.equal(unreviewed.template_matches, false);
  assert.equal(unreviewed.failure_code, 'request_template_mismatch');
  assert.equal((await request({ checkpoint_readback_verified: false })).failure_code, 'checkpoint_not_verified');
});

test('page diagnostics distinguish indices and refuse partial or malformed local scope', async () => {
  const page = await request({ kind: 'startup_page', section: 'context', index: 0, query: buildAdaptiveStartupPageSql(scope, 'context', 0) });
  assert.equal(page.local_preflight_passed, true); assert.equal(page.section, 'context');
  assert.equal((await request({ kind: 'startup_page', section: 'context' })).failure_code, 'invalid_request');
  assert.equal((await request({ scope: { ...scope, search_id: '' } })).failure_code, 'invalid_request');
});

test('diagnostic logs retain bounded failure evidence and omit payloads, SQL and unknown provider codes', async () => {
  const secret = 'SYNTHETIC_PRIVATE_EVALUATION_CANARY';
  const diagnostic = await request({ query: `SELECT '${secret}', 'https://example.invalid/private?token=synthetic-secret';` });
  const failure = adaptiveStartupFailureDiagnostic({ ...diagnostic, raw_response: secret } as typeof diagnostic, new AdaptiveStartupTransportError(secret, 'transport', 'connector_unclassified'),
    { stage: 'pages', verified_pages: 2, expected_pages: 27, missing_pages: 25, checkpoint_revision: 4, checkpoint_readback: 'verified' });
  const encoded = JSON.stringify(failure);
  assert.doesNotMatch(encoded, /PRIVATE_EVALUATION|synthetic-secret|https:|SELECT |data_base64/u);
  assert.equal(failure.code, null); assert.equal(failure.code_redacted, true); assert.equal(failure.retry_eligible, false);
  assert.equal(failure.verified_pages, 2); assert.equal(failure.expected_pages, 27);
  const uppercase = adaptiveStartupFailureDiagnostic(await request(),
    new AdaptiveStartupTransportError('APPROVAL_DENIED', 'transport', 'approval_denial', 'structured_metadata'), { stage: 'manifest' });
  assert.equal(uppercase.code, 'APPROVAL_DENIED'); assert.equal(uppercase.code_redacted, false);
  const unknownCode = adaptiveStartupFailureDiagnostic(await request(),
    new AdaptiveStartupTransportError('X1234', 'transport', 'connector_unclassified', 'structured_metadata'), { stage: 'manifest' });
  assert.equal(unknownCode.code, null); assert.equal(unknownCode.code_redacted, true);
});

test('approval, permission, safety and application rejections never become retryable diagnostic failures', async () => {
  const valid = await request();
  for (const kind of ['approval_denial', 'permission_denial', 'safety_denial', 'sql_application_rejection'] as const) {
    const code = { approval_denial: 'approval_denied', permission_denial: '42501', safety_denial: 'safety_blocked', sql_application_rejection: 'lease_expired' }[kind];
    const error = createAdaptiveStartupFailure({ kind, code });
    const failure = adaptiveStartupFailureDiagnostic(valid, error, { stage: 'manifest' });
    assert.equal(failure.category, kind); assert.equal(failure.code, code); assert.equal(failure.retry_eligible, false);
  }
});

test('only an explicitly dispatched absent response may retry once with identical project, SQL and run identity', async () => {
  const initial = await request(), retry = await request({ attempt: 1 });
  const lost = createAdaptiveStartupFailure({ kind: 'no_response', request_dispatched: true, response_received: false });
  assert.equal(canRetryAdaptiveStartupDiagnostic(initial, retry, lost), true);
  assert.equal(canRetryAdaptiveStartupDiagnostic(retry, retry, lost), false);
  const changed = await request({ attempt: 1, kind: 'startup_page', section: 'context', index: 0, query: buildAdaptiveStartupPageSql(scope, 'context', 0) });
  assert.equal(canRetryAdaptiveStartupDiagnostic(initial, changed, lost), false);
  const newScope = { ...scope, run_id: '90000000-0000-4000-8000-000000000003' };
  const replaced = await request({ attempt: 1, scope: newScope, query: buildAdaptiveStartupManifestSql(newScope) });
  assert.equal(canRetryAdaptiveStartupDiagnostic(initial, replaced, lost), false);
  const displayed = createAdaptiveStartupFailure({ kind: 'display_truncation', response_received: true });
  assert.equal(canRetryAdaptiveStartupDiagnostic(initial, retry, displayed), false);
  assert.equal(adaptiveStartupFailureDiagnostic(initial, displayed, { stage: 'pages' }).category, 'local_processing');
});
