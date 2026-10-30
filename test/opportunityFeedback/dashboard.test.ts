import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { file, reset, sql, upgradeCurrentFeedbackContract } from './db';
import { ADAPTIVE_RELEASE_MIGRATIONS } from '../../scripts/adaptiveSearchRelease';
import { readAdaptiveSearchDashboard } from '../../src/features/meta-search/composables/adaptiveSearchDashboard';
let privateAclBefore = '';

test('AF-10 exact feedback preview preserves privacy, proof and runner semantics', () => {
  reset({ searchProtocol: true });
  for (const path of ['opportunity_feedback_signals.sql', 'opportunity_feedback_sharing.sql',
    'opportunity_feedback_projection.sql', 'opportunity_feedback_snapshots.sql', 'opportunity_search_plans.sql',
    'opportunity_search_attribution.sql', 'opportunity_search_prediction_baselines.sql', 'opportunity_search_quality_metrics.sql',
    'opportunity_search_preferences.sql', 'opportunity_search_adaptation_sources.sql', 'opportunity_search_adaptive_startup.sql',
    'opportunity_search_adaptive_batches.sql', 'opportunity_search_adaptive_completion.sql', 'opportunity_search_adaptive_setup.sql']) sql(file(`../../supabase/${path}`));
  privateAclBefore = sql("select nspacl::text from pg_namespace where nspname='private';");
  const original = sql("select pg_get_functiondef('private.opportunity_feedback_projection_text(text,integer)'::regprocedure);");
  const changed = original.replace('AS $function$', 'AS $function$\n-- Synthetic unreviewed prerequisite change\n');
  assert.notEqual(changed, original);
  try {
    sql(changed);
    assert.throws(() => sql(file('../../supabase/opportunity_search_feedback_preview.sql')), /prerequisite|fingerprint|reviewed/iu);
    assert.equal(sql("select to_regclass('public.opportunity_feedback_prediction_proofs') is null;"), 't');
  } finally { sql(original); }
  sql(file('../../supabase/opportunity_search_feedback_preview.sql'));
  sql(file('../../supabase/tests/opportunity_search_feedback_preview.sql'));
});

test('AF-10 dashboard reads and partial CAS actions preserve independent base intent and ownership', () => {
  sql(file('../../supabase/opportunity_search_dashboard.sql'));
  sql(file('../../supabase/tests/opportunity_search_dashboard.sql'));
  assert.equal(sql("select nspacl::text from pg_namespace where nspname='private';"), privateAclBefore);
});

test('current SQL dashboard decodes through the UI boundary with an identical outgoing packet', async () => {
  const fixture = file('../../supabase/tests/opportunity_search_dashboard.sql');
  // Exercise the historical assertions before upgrading their persisted synthetic data.
  sql(fixture.replace(/rollback;\s*$/u, 'commit;'));
  const dashboardIndex = ADAPTIVE_RELEASE_MIGRATIONS.indexOf('opportunity_search_dashboard.sql');
  for (const path of ADAPTIVE_RELEASE_MIGRATIONS.slice(dashboardIndex + 1)) sql(file(`../../supabase/${path}`));
  upgradeCurrentFeedbackContract();
  const projection = `
    begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'is_anonymous',false)::text,true)
      from public.opportunity_search_templates where name='Synthetic dashboard';
    update public.opportunity_search_runs set created_at=clock_timestamp()+interval '1 second' where status='failed';
    update public.opportunity_search_runs set created_at=clock_timestamp()+interval '2 seconds' where execution_report_status='complete';
    set local role authenticated;
    select public.read_opportunity_search_dashboard(id,'dddddddddddddddddddd') from public.opportunity_search_templates where name='Synthetic dashboard';
    reset role;
    rollback;
  `;
  const output = sql(projection);
  const raw = output.split('\n').map(line => JSON.parse(line)).find(value => value.dashboard_version === 1);
  assert(raw);
  const parsed = await readAdaptiveSearchDashboard(raw, raw.user_id, raw.search_id, raw.project_ref);
  assert.deepEqual(parsed.feedback_preview, raw.feedback_preview);
  assert(!JSON.stringify(parsed).includes('PRIVATE_CANARY'));
  // Explicit synthetic browser fixture artifact; never read production captures.
  writeFileSync('/tmp/cv-adaptive-dashboard-fixture.json', JSON.stringify(raw, null, 2) + '\n');
});
