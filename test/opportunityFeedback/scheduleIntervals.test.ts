import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADAPTIVE_RELEASE_MIGRATIONS } from '../../scripts/adaptiveSearchRelease';
import { createSearchTemplate } from '../../src/features/meta-search/data/useSearchTemplates';
import { importCloudSearchTemplate, saveSearchTemplate, searchTemplateCloudSchedule } from '../../src/features/meta-search/data/searchTemplateCloud';
import { setSearchScheduleCadence } from '../../src/features/meta-search/domain/searchSchedule';
import { file, reset, sql } from './db';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `E'${JSON.stringify(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'::jsonb`;

test('interval upgrade preserves saved state and ACLs while authenticated saves support hourly and calendar-day schedules', async () => {
  reset({ searchProtocol: true });
  for (const name of ADAPTIVE_RELEASE_MIGRATIONS) sql(file(`../../supabase/${name}`));
  for (const name of ['opportunity_description.sql', 'application_removal_review.sql', 'opportunity_evaluation.sql', 'opportunity_feedback_defaults.sql', 'opportunity_search_adaptive_payload_contract.sql']) sql(file(`../../supabase/${name}`));
  const owner = randomUUID();
  sql(`insert into auth.users(id) values(${quote(owner)});`);
  const requests: Record<string, unknown>[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, 'save_opportunity_meta_search'); requests.push(structuredClone(args));
    const response = sql(`begin;
      do $$ begin perform set_config('request.jwt.claims',${quote(JSON.stringify({ sub: owner, is_anonymous: false }))},true); end $$;
      set local role authenticated;
      select to_jsonb(public.save_opportunity_meta_search(${quote(String(args.p_id))}::uuid,${Number(args.p_expected_revision)},
        ${quote(String(args.p_name))},${json(args.p_criteria)},${json(args.p_schedule)},${json(args.p_meta_search)}));
      commit;`);
    return { data: JSON.parse(response), error: null };
  } } as unknown as SupabaseClient;
  let saved = await saveSearchTemplate(client, owner, createSearchTemplate('Synthetic interval search', 'Europe/Tirane'));
  const originalRows = sql('select jsonb_agg(to_jsonb(t) order by t.id) from public.opportunity_search_templates t;');
  const validator = "'private.validate_opportunity_search_definition(text,jsonb,jsonb)'::regprocedure";
  const originalDefinition = sql(`select pg_get_functiondef(${validator});`);
  const setupReader = "'private.read_adaptive_search_setup_internal(uuid,uuid,text)'::regprocedure";
  const originalReader = sql(`select pg_get_functiondef(${setupReader});`);
  const acl = () => sql(`select jsonb_agg(jsonb_build_array(p.oid,p.prosecdef,p.proacl::text,n.nspacl::text) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in(${validator},${setupReader});`);
  const originalAcl = acl();
  const attempted = { ...saved, cadence: setSearchScheduleCadence(saved, 'days', 30) };
  await assert.rejects(saveSearchTemplate(client, owner, attempted), /Invalid search schedule/);
  assert.equal(sql('select jsonb_agg(to_jsonb(t) order by t.id) from public.opportunity_search_templates t;'), originalRows);

  sql(file('../../supabase/opportunity_search_schedule_intervals.sql'));
  assert.equal(acl(), originalAcl, 'the upgrade changes no invoker/definer or permission boundaries');
  assert.equal(sql('select jsonb_agg(to_jsonb(t) order by t.id) from public.opportunity_search_templates t;'), originalRows, 'installing interval support does not change the existing schedule');
  assert.equal(sql(`select pg_get_functiondef(${validator});`).replace('not between 1 and 8760', 'not between 1 and 168'), originalDefinition,
    'only the reviewed numeric limit changes');
  assert.equal(sql(`select pg_get_functiondef(${setupReader});`).replace("'dailyTime','timezone','cadence','cloud'", "'dailyTime','timezone','cloud'"), originalReader,
    'setup keeps its existing privacy and target checks while admitting the typed cadence field');

  for (const [unit, interval, expectedHours] of [['hours', 6, 6], ['days', 2, 48], ['days', 30, 720], ['days', 365, 8760]] as const) {
    const input = { ...saved, cadence: setSearchScheduleCadence(saved, unit, interval) };
    const result = await saveSearchTemplate(client, owner, input);
    const last = requests.at(-1)!;
    assert.equal((last.p_schedule as any).intervalHours, expectedHours);
    assert.deepEqual((last.p_meta_search as any).editor.cadence, input.cadence, 'cadence-only saves carry a changed editor snapshot');
    const retry = await saveSearchTemplate(client, owner, input);
    assert.deepEqual(retry, result, 'a lost-response retry returns the same exact saved revision');
    const stored = JSON.parse(sql(`select to_jsonb(t) from public.opportunity_search_templates t where id=${quote(result.cloud!.id)};`));
    saved = importCloudSearchTemplate(stored);
    assert.deepEqual(searchTemplateCloudSchedule(saved), stored.schedule);
    assert.deepEqual(searchTemplateCloudSchedule(saved), searchTemplateCloudSchedule(result));
    assert.equal(saved.cloud!.contentKey, result.cloud!.contentKey);
    const handoff = JSON.parse(sql(`begin;
      select private.read_adaptive_search_setup(${quote(saved.cloud!.id)}::uuid,${quote(randomUUID())}::uuid,'iiiiiiiiiiiiiiiiiiii');
      rollback;`));
    assert.equal(handoff.compatible, true, JSON.stringify(handoff.error));
    assert.equal(handoff.mode, 'legacy');
    assert.deepEqual(handoff.schedule, stored.schedule, 'setup carries the exact saved interval without changing the task');
  }
  for (const interval of [0, 8761, 1.5]) assert.throws(() => sql(`select private.validate_opportunity_search_definition('Invalid',
    '{"topicsAndMethods":"Synthetic acoustics"}',${json({ ...searchTemplateCloudSchedule(saved), intervalHours: interval })});`), /Invalid search schedule/);
  assert.throws(() => sql(file('../../supabase/opportunity_search_schedule_intervals.sql')), /requires the reviewed PostgreSQL 17/,
    'unexpected or already-upgraded definitions require review');
  assert.equal(sql('select count(*) from public.opportunity_search_schedule_bindings;'), '0');
  assert.equal(sql('select count(*) from public.opportunity_search_runs;'), '0');
  assert.equal(sql('select count(*) from public.opportunity_search_runner_authorizations;'), '0');
  assert.equal(sql('select enabled from public.opportunity_search_adaptive_release where singleton;'), 'f');
});
