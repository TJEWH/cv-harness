import assert from 'node:assert/strict';
import test from 'node:test';
import type { Application } from '../src/app/cloudTypes';
import { applicationIdentifier, buildShortRefinementInstruction } from '../src/features/refinement/domain/applicationReference';

const id = '81c40a65-c850-4faa-b539-4fe8c5c51327';
function application(code?: string | null): Application {
  return { id, application_code: code, user_id: 'owner', opportunity_id: 'opportunity', cv_variant_id: null,
    contact_email: null, status: 'preparation', workflow_stage: 'preparation', tracking_started: false, completed_checklist_keys: [], notes: null, contacted_at: null, submitted_at: null,
    context_json: { title: 'PhD in robotics' }, context_captured_at: '2026-10-01T08:00:00Z',
    created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z' };
}

test('application references preserve opaque server codes without deriving them from mutable research titles', () => {
  const app = application('External.Code/AbC_017');
  assert.equal(applicationIdentifier(app), 'External.Code/AbC_017');
  const renamed = { ...app, context_json: { title: 'Renamed robotics programme', university: 'Another presentation label' } };
  assert.equal(applicationIdentifier(renamed), applicationIdentifier(app));
  assert.throws(() => buildShortRefinementInstruction(renamed, 'both' as never), /separate CV or letter/);
});

test('legacy and incomplete server rows retain their complete UUID as an unambiguous fallback', () => {
  for (const code of [undefined, null, '', '   ']) {
    assert.equal(applicationIdentifier(application(code)), id);
    assert.equal(buildShortRefinementInstruction(application(code), 'letter'), `phd-workflow: ${id} — refine motivation letter.`);
  }
});

test('short refinement instructions keep the same application reference for every document scope', () => {
  const app = application('PHD-7K4A');
  assert.equal(buildShortRefinementInstruction(app, 'cv'), 'phd-workflow: PHD-7K4A — refine CV.');
  assert.equal(buildShortRefinementInstruction(app, 'letter'), 'phd-workflow: PHD-7K4A — refine motivation letter.');
  assert.throws(() => buildShortRefinementInstruction(app, 'both' as never), /separate CV or letter/);
});
