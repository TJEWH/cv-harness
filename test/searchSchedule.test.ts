import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchCloudSchedule, SearchCloudTemplate, SearchTemplate } from '../src/features/meta-search/searchTypes';
import { createSearchTemplate, readSearchTemplate, searchTemplateContentKey } from '../src/features/meta-search/data/useSearchTemplates';
import { importCloudSearchTemplate, saveSearchTemplate, searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../src/features/meta-search/data/searchTemplateCloud';
import { readSearchScheduleCadence, readSearchScheduleControls, searchCadenceFromCloud, setSearchScheduleCadence } from '../src/features/meta-search/domain/searchSchedule';
import { buildReplaceSearchPrompt } from '../src/features/meta-search/domain/searchPrompts';

const owner = '96000000-0000-4000-8000-000000000001';
const search = '96000000-0000-4000-8000-000000000002';
function template(): SearchTemplate { return createSearchTemplate('Synthetic search', 'Europe/Tirane'); }
function row(input: SearchTemplate, schedule = searchTemplateCloudSchedule(input)): SearchCloudTemplate {
  return { id: search, user_id: owner, name: input.name, revision: 3, criteria: searchTemplateCloudCriteria(input),
    schedule, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z',
    meta_search: { version: 1, active: true, editor: structuredClone(input), systemPrompt: 'Synthetic system prompt', userPrompt: 'Synthetic user prompt', recurringPrompt: 'Synthetic recurring prompt' } };
}

test('daily defaults preserve the original schedule and local content identity', () => {
  const input = template(), key = searchTemplateContentKey(input);
  assert.deepEqual(readSearchScheduleControls(input), { unit: 'days', interval: 1, weekdays: [] });
  assert.deepEqual(searchTemplateCloudSchedule(input), { frequency: 'daily', intervalHours: 1, weekdays: [], time: '09:00', timezone: 'Europe/Tirane', runImmediately: true });
  const imported = importCloudSearchTemplate(row(input));
  assert.equal(imported.cadence, undefined);
  assert.equal(searchTemplateContentKey(imported), key);
});

test('hourly and calendar-day intervals preserve their units and change the committed content identity', () => {
  const input = template(), key = searchTemplateContentKey(input);
  for (const [unit, interval, frequency, intervalHours] of [
    ['hours', 1, 'hourly', 1], ['hours', 6, 'hourly', 6], ['hours', 23, 'hourly', 23],
    ['days', 1, 'daily', 1], ['days', 2, 'daily', 48], ['days', 365, 'daily', 8760],
  ] as const) {
    const changed = { ...input, cadence: setSearchScheduleCadence(input, unit, interval) };
    assert.deepEqual(readSearchScheduleControls(changed), { unit, interval, weekdays: [] });
    assert.equal(searchTemplateCloudSchedule(changed).frequency, frequency);
    assert.equal(searchTemplateCloudSchedule(changed).intervalHours, intervalHours);
    if (unit === 'days' && interval === 1) assert.equal(searchTemplateContentKey(changed), key);
    else assert.notEqual(searchTemplateContentKey(changed), key);
  }
});

test('invalid intervals and incomplete input do not become a default saved cadence', () => {
  const input = template();
  for (const [unit, interval] of [['hours', 0], ['hours', 24], ['days', 366], ['days', 1.5], ['days', NaN], ['days', Infinity], ['weeks', 2]] as const) {
    assert.throws(() => setSearchScheduleCadence(input, unit, interval), /interval/);
  }
  for (const value of [null, {}, { frequency: 'daily', intervalHours: '', weekdays: [], runImmediately: true },
    { frequency: 'daily', intervalHours: 1, weekdays: [], runImmediately: true, hidden: 'extra' },
    { frequency: 'weekly', intervalHours: 1, weekdays: [], runImmediately: true },
    { frequency: 'daily', intervalHours: 1, weekdays: [8], runImmediately: true }]) assert.throws(() => readSearchScheduleCadence(value));
  assert.equal(input.cadence, undefined);
});

test('cloud imports keep hourly and weekly schedules while treating the row as authoritative', () => {
  const input = template();
  input.cadence = setSearchScheduleCadence(input, 'days', 3);
  for (const schedule of [
    { frequency: 'hourly', intervalHours: 48, weekdays: [], time: '17:30', timezone: 'UTC', runImmediately: false },
    { frequency: 'weekly', intervalHours: 1, weekdays: [1, 3, 5], time: '07:45', timezone: 'Europe/Paris', runImmediately: false },
  ] satisfies SearchCloudSchedule[]) {
    const imported = importCloudSearchTemplate(row(input, schedule));
    assert.deepEqual(searchTemplateCloudSchedule(imported), schedule);
    assert.deepEqual(imported.cadence, searchCadenceFromCloud(schedule));
    imported.researchInterests = 'Updated profile, same cadence';
    assert.deepEqual(searchTemplateCloudSchedule(imported), schedule, 'ordinary profile edits cannot reset an imported schedule');
  }
  const weekly = { ...input, cadence: { frequency: 'weekly' as const, intervalHours: 1, weekdays: [1, 4], runImmediately: false } };
  assert.deepEqual(readSearchScheduleControls(weekly), { unit: 'weeks', interval: 1, weekdays: [1, 4] });
  assert.deepEqual(setSearchScheduleCadence(weekly, 'weeks', 1, [2, 5]), { frequency: 'weekly', intervalHours: 1, weekdays: [2, 5], runImmediately: false });
});

test('saved non-daily cadence keeps editor and row schedule consistent through a cloud round trip', async () => {
  const input = template();
  input.cadence = setSearchScheduleCadence(input, 'days', 30);
  const calls: Record<string, unknown>[] = [];
  const client = { rpc: async (name: string, args: Record<string, any>) => {
    assert.equal(name, 'save_opportunity_meta_search'); calls.push(structuredClone(args));
    return { error: null, data: { ...row(input), id: args.p_id, revision: args.p_expected_revision + 1,
      name: args.p_name, criteria: args.p_criteria, schedule: args.p_schedule, meta_search: args.p_meta_search } };
  } } as unknown as SupabaseClient;
  const saved = await saveSearchTemplate(client, owner, input);
  assert.equal(calls.length, 1);
  assert.equal((calls[0]!.p_schedule as SearchCloudSchedule).intervalHours, 720);
  assert.deepEqual((calls[0]!.p_meta_search as any).editor.cadence, input.cadence);
  assert.deepEqual(saved.cadence, input.cadence);
  assert.equal(saved.cloud!.contentKey, searchTemplateContentKey(saved));
  const restored = importCloudSearchTemplate({ ...row(input), id: saved.cloud!.id, revision: saved.cloud!.revision,
    meta_search: calls[0]!.p_meta_search as SearchCloudTemplate['meta_search'] });
  assert.equal(searchTemplateContentKey(restored), searchTemplateContentKey(saved));
  assert.deepEqual(searchTemplateCloudSchedule(restored), searchTemplateCloudSchedule(input));
});

test('the setup instruction specifies calendar days, timezone behavior and unsupported-task recovery', () => {
  const input = template(); input.cadence = setSearchScheduleCadence(input, 'days', 2);
  input.cloud = { id: search, revision: 1, contentKey: searchTemplateContentKey(input) };
  const runner = { setup_contract_version: 1 as const, user_id: owner, search_id: search, project_ref: 'abcdefghijklmnopqrst',
    revision: 1, mode: 'adaptive' as const, migration_requested: false, ready: true, readiness_code: 'ready', setup_id: null, binding: null };
  const prompt = buildReplaceSearchPrompt(readSearchTemplate(input), { runner, projectId: runner.project_ref });
  for (const required of ['repeat every intervalHours hours', 'intervalHours=1 means every day', 'intervalHours/24 calendar days',
    'Preserve local time across daylight-saving', 'Keep the exact original schedule JSON', 'task tool cannot represent']) assert(prompt.includes(required), required);
});
