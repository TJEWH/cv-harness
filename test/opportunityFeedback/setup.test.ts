import { test } from 'node:test';
import assert from 'node:assert/strict';
import { file, reset, sql } from './db';
import { buildSearchSetupReadSql } from '../../src/features/meta-search/domain/searchPrompts';

test('AF-09 setup gates explicit migration, reads one safe handoff and records only setup receipts', () => {
  reset({ searchProtocol: true });
  for (const path of ['opportunity_feedback_signals.sql', 'opportunity_feedback_sharing.sql',
    'opportunity_feedback_projection.sql', 'opportunity_feedback_snapshots.sql', 'opportunity_search_plans.sql',
    'opportunity_search_attribution.sql', 'opportunity_search_prediction_baselines.sql', 'opportunity_search_quality_metrics.sql',
    'opportunity_search_preferences.sql', 'opportunity_search_adaptation_sources.sql', 'opportunity_search_adaptive_startup.sql',
    'opportunity_search_adaptive_batches.sql', 'opportunity_search_adaptive_completion.sql', 'opportunity_search_adaptive_setup.sql']) {
    sql(file(`../../supabase/${path}`));
  }
  sql(file('../../supabase/tests/opportunity_search_adaptive_setup.sql'));
});

test('historical AF-09 recurring instructions retain the exact reviewed migration text', () => {
  const search = '11111111-1111-4111-8111-111111111111', project = 'abcdefghijklmnopqrst';
  const installed = JSON.parse(sql(`select to_jsonb(private.adaptive_search_recurring_prompt('${search}'::uuid,'${project}'::text));`));
  const template = file('../../supabase/opportunity_search_adaptive_setup.sql').split('$adaptive_recurring$')[1];
  assert(template, 'The historical reviewed recurring template is present.');
  assert.equal(installed, template.replaceAll('{{search_id}}', search).replaceAll('{{project_ref}}', project));
  assert.equal((installed.match(/SELECT private\./gu) || []).length, 1);
  assert(!installed.includes('private.read_adaptive_search_setup('));
  assert(!installed.includes('private.ack_adaptive_search_setup('));
});

test('the copied setup query returns one flat SQL row with the complete contract and unescaped prompt', () => {
  const owner = '11111111-1111-4111-8111-111111111112', search = '11111111-1111-4111-8111-111111111113';
  const setup = '11111111-1111-4111-8111-111111111114', project = 'abcdefghijklmnopqrst';
  const prompt = 'Run the saved shared research.\nKeep "quotes", apostrophes and Unicode: Ä.';
  const meta = JSON.stringify({ version: 1, active: true, editor: {}, systemPrompt: 'Synthetic system', userPrompt: 'Synthetic intent', recurringPrompt: prompt }).replaceAll("'", "''");
  const read = buildSearchSetupReadSql(search, setup, project).slice(0, -1);
  const rows = JSON.parse(sql(`begin;
    insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search) values
      ('${search}','${owner}','Synthetic connector response','{"topicsAndMethods":"Synthetic acoustics"}',
       '{"frequency":"daily","intervalHours":1,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}', '${meta}'::jsonb);
    select jsonb_agg(to_jsonb(projected)) from (${read}) projected;
    rollback;`));
  assert.equal(rows.length, 1);
  const handoff = rows[0];
  assert.equal(handoff.setup_contract_version, 1); assert.equal(handoff.compatible, true);
  assert.equal(handoff.setup_id, setup); assert.equal(handoff.scope.search_id, search); assert.equal(handoff.scope.project_ref, project);
  assert.equal(handoff.recurringPrompt, prompt); assert.equal(handoff.schedule.time, '09:00');
  assert.deepEqual(handoff.target, { kind: 'selection_required', task_id: null, requires_explicit_selection: true });
  assert.equal(handoff.acknowledgement.helper, 'private.ack_adaptive_search_setup(uuid,uuid,jsonb)');
  assert.equal(handoff.acknowledgement.payload_template.recurring_prompt_hash, handoff.recurring_prompt_hash);
  assert.equal(handoff.error, null);
});
