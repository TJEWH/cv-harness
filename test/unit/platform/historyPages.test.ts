import assert from 'node:assert/strict';
import test from 'node:test';
import { readHistoryPages } from '../../../src/platform/supabase/historyPages';

test('history reads all ordered pages beyond the default database row limit', async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => ({ id: String(index) }));
  const calls: [number, number][] = [];
  const result = await readHistoryPages(async (from, to) => { calls.push([from, to]); return rows.slice(from, to + 1); });
  assert.deepEqual(result, rows); assert.equal(calls.length, 13); assert.deepEqual(calls.at(-1), [1200, 1299]);
});
test('concurrent append overlap is deduplicated and a nonadvancing page fails explicitly', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({ id: String(index) }));
  const result = await readHistoryPages(async from => from === 0 ? rows.slice(0, 100) : rows.slice(95));
  assert.deepEqual(result, rows);
  await assert.rejects(() => readHistoryPages(async () => rows.slice(0, 100)), /History changed/);
});
test('a failed or unauthorized later page never returns a misleading partial history', async () => {
  await assert.rejects(() => readHistoryPages(async from => {
    if (from) throw new Error('Account changed');
    return Array.from({ length: 100 }, (_, index) => ({ id: String(index) }));
  }), /Account changed/);
});
