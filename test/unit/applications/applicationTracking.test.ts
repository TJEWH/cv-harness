import assert from 'node:assert/strict';
import test from 'node:test';
import type { Application } from '../../../src/app/cloudTypes';
import { applicationStage, applicationStatusHistory, applicationTrackingStarted, applicationWasSubmitted, normalizeApplication } from '../../../src/features/applications/domain/applicationTracking';
import { createSyntheticRefinementWorkspace } from '../../support/fixtures/refinement';

test('status history preserves repeated states in server order and never guesses missing transition dates', () => {
  const { props } = createSyntheticRefinementWorkspace();
  const application = { ...props.application, status: 'contacted' as const,
    contacted_at: '2026-09-30T10:00:00Z', submitted_at: '2026-10-01T08:00:00Z',
    status_history: [
      { status: 'ready' as const, changedAt: null },
      { status: 'contacted' as const, changedAt: '2026-10-01T09:00:00Z' },
      { status: 'submitted' as const, changedAt: '2026-10-01T10:00:00Z' },
      { status: 'contacted' as const, changedAt: '2026-10-02T08:00:00Z' },
    ] };
  assert.deepEqual(applicationStatusHistory(application), application.status_history);
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: undefined }), [{ status: 'contacted', changedAt: null }]);
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: [] }), [{ status: 'contacted', changedAt: null }]);
  assert.deepEqual(applicationStatusHistory({ ...application, status: 'interview' }).at(-1), { status: 'interview', changedAt: null });
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: [{ status: 'ready', changedAt: 'invalid' }] }), [{ status: 'contacted', changedAt: null }]);
});

test('saved tab is restored independently from an explicit tracking status', () => {
  const { props } = createSyntheticRefinementWorkspace();
  for (const workflow_stage of ['preparation', 'refinement', 'review', 'tracking'] as const) {
    const application = { ...props.application, status: 'submitted' as const, workflow_stage, tracking_started: true };
    assert.equal(applicationStage(application), workflow_stage);
    assert.equal(applicationTrackingStarted(application), true);
  }
  assert.equal(applicationTrackingStarted({ ...props.application, status: 'ready', tracking_started: true }), true);
  assert.equal(applicationTrackingStarted({ ...props.application, status: 'ready', tracking_started: false }), false);
});

test('applied grouping distinguishes submission from preparation, contact and withdrawal', () => {
  const { props } = createSyntheticRefinementWorkspace();
  const baseline = { ...props.application, submitted_at: null, status_history: undefined };
  for (const status of ['preparation', 'refinement', 'attachments', 'ready', 'contacted', 'withdrawn'] as const) {
    assert.equal(applicationWasSubmitted({ ...baseline, status }), false, status);
  }
  for (const status of ['submitted', 'interview', 'offer', 'rejected'] as const) {
    assert.equal(applicationWasSubmitted({ ...baseline, status }), true, status);
  }
  assert.equal(applicationWasSubmitted({ ...baseline, status: 'withdrawn', submitted_at: '2026-10-01T08:00:00Z' }), true);
  assert.equal(applicationWasSubmitted({ ...baseline, status: 'withdrawn', submitted_at: 'invalid' }), false);
  assert.equal(applicationWasSubmitted({ ...baseline, status: 'withdrawn', status_history: [
    { status: 'submitted', changedAt: null }, { status: 'withdrawn', changedAt: null },
  ] }), true);
  assert.equal(applicationWasSubmitted({ ...baseline, status: 'refinement', status_history: [
    { status: 'interview', changedAt: null }, { status: 'refinement', changedAt: null },
  ] }), true, 'reopening document work does not undo a recorded submission');
});

test('application records reject retired statuses instead of translating them into current decisions', () => {
  const { props } = createSyntheticRefinementWorkspace();
  for (const patch of [{ status: 'shortlist' }, { status_history: [{ status: 'shortlist', changedAt: null }] }]) {
    const application = { ...props.application, ...patch } as unknown as Application;
    assert.throws(() => normalizeApplication(application), /unsupported status/);
    assert.throws(() => applicationStatusHistory(application), /unsupported status/);
  }
  const current = { ...props.application, status: 'ready' as const, status_history: [{ status: 'ready' as const, changedAt: null }] };
  assert.deepEqual(normalizeApplication(current), current);
  assert.deepEqual(applicationStatusHistory(current), current.status_history);
});
