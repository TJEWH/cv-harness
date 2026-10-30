import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRefinementRepository } from '../src/features/refinement/applicationRefinement';
import { stub } from './helpers';

const applicationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';
const createdAt = '2026-10-09T10:00:00.000Z';
const validationRejection = { code: '22023', message: 'Invalid or unanonymized annotation review.' };
type Call = { name: string; params?: Record<string, unknown> };
function fakeClient(handler: (call: Call) => { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  function query(name: string, params?: Record<string, unknown>) {
    const call = { name, params: params && structuredClone(params) };
    const builder = {
      select() { return builder; }, eq() { return builder; }, order() { return builder; }, range() { return builder; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        calls.push(call); return Promise.resolve().then(() => handler(call)).then(resolve, reject);
      },
    };
    return builder;
  }
  return { client: stub<SupabaseClient>({ rpc: query, from: query }), calls };
}
function annotation(status = 'ignored') {
  return { proposalId, annotationId: 'annotation-1', status, response: 'This detail is not relevant.', previousReviewId: null };
}
function receipt(call: Call) {
  return { id: call.params!.p_id, application_id: applicationId, user_id: 'owner', request_id: call.params!.p_request_id,
    kind: call.params!.p_kind, payload: structuredClone(call.params!.p_payload), created_at: createdAt };
}

test('current workspaces save ignored annotations once without changing their payload', async () => {
  const { client, calls } = fakeClient(call => ({ data: receipt(call), error: null }));
  const payload = annotation(); const before = structuredClone(payload);
  const saved = await createRefinementRepository(client, () => 'owner').saveReview(applicationId, requestId, 'annotation', payload);
  assert.equal(calls.length, 1);
  assert.deepEqual(saved.payload, before);
  assert.deepEqual(calls[0].params!.p_payload, before);
  assert.deepEqual(payload, before);
});

test('uncertain saves retry the same payload and UUID', async () => {
  let failed = false;
  const { client, calls } = fakeClient(call => {
    if (!failed) { failed = true; return { data: null, error: { message: 'Connection interrupted after saving.' } }; }
    return { data: receipt(call), error: null };
  });
  const repo = createRefinementRepository(client, () => 'owner');
  await assert.rejects(repo.saveReview(applicationId, requestId, 'annotation', annotation()), /Connection interrupted after saving/);
  const saved = await repo.saveReview(applicationId, requestId, 'annotation', annotation());
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, calls[0].params);
  assert.equal(saved.payload.status, 'ignored');
});


for (const [status, error] of [
  ['resolved', validationRejection],
  ['ignored', { code: '22023', message: 'Invalid annotation reference.' }],
  ['ignored', { code: '40001', message: validationRejection.message }],
  ['ignored', { code: '22023', message: 'Invalid or unanonymized annotation review. Additional failure.' }],
] as const) test(`annotation saves do not retry ${status} with ${error.code}: ${error.message}`, async () => {
  const { client, calls } = fakeClient(() => ({ data: null, error }));
  await assert.rejects(createRefinementRepository(client, () => 'owner').saveReview(applicationId, requestId, 'annotation', annotation(status)),
    cause => cause instanceof Error && cause.message === error.message);
  assert.equal(calls.length, 1);
});

test('invalid local annotation responses and changed sessions stop immediately', async () => {
  const invalid = fakeClient(() => ({ data: null, error: validationRejection }));
  await assert.rejects(createRefinementRepository(invalid.client, () => 'owner').saveReview(applicationId, requestId, 'annotation', { ...annotation(), response: 'Invalid\u0000detail' }), /Invalid annotation review/);
  assert.equal(invalid.calls.length, 0);
  let owner = 'owner';
  const switched = fakeClient(() => { owner = 'other'; return { data: null, error: validationRejection }; });
  await assert.rejects(createRefinementRepository(switched.client, () => owner).saveReview(applicationId, requestId, 'annotation', annotation()), /Session changed/);
  assert.equal(switched.calls.length, 1);
});

test('annotation saves preserve privacy rejection and verify the exact saved response', async () => {
  const rejected = fakeClient(() => ({ data: null, error: validationRejection }));
  await assert.rejects(createRefinementRepository(rejected.client, () => 'owner').saveReview(applicationId, requestId, 'annotation', annotation()),
    cause => cause instanceof Error && cause.message === validationRejection.message);
  assert.equal(rejected.calls.length, 1);
  const altered = fakeClient(call => {
    return { data: { ...receipt(call), payload: { ...annotation(), response: 'Altered response.' } }, error: null };
  });
  await assert.rejects(createRefinementRepository(altered.client, () => 'owner').saveReview(applicationId, requestId, 'annotation', annotation()), /could not be confirmed/);
});

test('plain RPC failures and unknown error objects always become useful Error messages', async () => {
  for (const [error, expected] of [
    [{ code: '40001', message: 'Annotation changed elsewhere. Reload the saved annotation.' }, 'Annotation changed elsewhere. Reload the saved annotation.'],
    [{ code: 'unknown' }, 'The refinement request failed. Please try again.'],
    ['Network unavailable.', 'Network unavailable.'],
  ] as const) {
    const { client } = fakeClient(() => ({ data: null, error }));
    await assert.rejects(createRefinementRepository(client, () => 'owner').saveReview(applicationId, requestId, 'annotation', annotation()),
      cause => cause instanceof Error && cause.message === expected && !String(cause).includes('[object Object]'));
  }
});
