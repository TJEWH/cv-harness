import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSearchTemplate } from '../../src/features/meta-search/data/searchTemplateRepository';
import { importCloudSearchTemplate, saveSearchTemplate, searchTemplateCloudSchedule } from '../../src/features/meta-search/data/searchTemplateCloud';
import { setSearchScheduleCadence } from '../../src/features/meta-search/domain/searchSchedule';
import { reset, sql } from './db';

before(() => reset());

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `E'${JSON.stringify(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'::jsonb`;

test('authenticated saves support hourly and calendar-day schedules with retry-safe revisions', async () => {
  reset();
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
  assert.equal(sql('select count(*) from public.opportunity_search_schedule_bindings;'), '0');
  assert.equal(sql('select count(*) from public.opportunity_search_runs;'), '0');
  assert.equal(sql('select count(*) from public.opportunity_search_runner_authorizations;'), '0');
  assert.equal(sql('select enabled from public.opportunity_search_adaptive_release where singleton;'), 'f');
});
