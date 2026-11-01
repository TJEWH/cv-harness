import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { file, reset, sql } from '../../support/database/postgres';

before(() => reset());
import { readAdaptiveSearchDashboard } from '../../../src/features/meta-search/composables/adaptiveSearchDashboard';
let privateAclBefore = '';

test('AF-10 exact feedback preview preserves privacy, proof and runner semantics', () => {
  privateAclBefore = sql("select nspacl::text from pg_namespace where nspname='private';");
  sql(file('supabase/tests/opportunity_search_feedback_preview.sql'));
});

test('AF-10 dashboard reads and partial CAS actions preserve independent base intent and ownership', () => {
  sql(file('supabase/tests/opportunity_search_dashboard.sql'));
  assert.equal(sql("select nspacl::text from pg_namespace where nspname='private';"), privateAclBefore);
});

test('current SQL dashboard decodes through the UI boundary with an identical outgoing packet', async () => {
  const fixture = file('supabase/tests/opportunity_search_dashboard.sql');
  // Keep synthetic rows for the actual SQL-to-UI decoder boundary.
  sql(fixture.replace(/rollback;\s*$/u, 'commit;'));
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
