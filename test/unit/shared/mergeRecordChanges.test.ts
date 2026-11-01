import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRecordChanges } from '../../../src/shared/lib/mergeRecordChanges';

test('independent edits merge while metadata and untouched remote fields retain their current values', () => {
  const baseline = { id: 'original', revision: 1, updatedAt: 'earlier', title: 'Old title', guidance: 'Old guidance' };
  const incoming = { ...baseline, id: 'draft-id', revision: 30, updatedAt: 'draft-time', title: 'Edited title' };
  const current = { ...baseline, revision: 2, updatedAt: 'saved-time', guidance: 'New guidance from another tab' };
  const result = mergeRecordChanges(baseline, incoming, current, ['id', 'revision', 'updatedAt']);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value, { ...current, title: 'Edited title' });
});

test('identical concurrent edits are accepted alongside edits whose current field still matches the baseline', () => {
  const baseline = { name: 'Before', instructions: 'Before' };
  const incoming = { name: 'Shared new name', instructions: 'Only my change' };
  const current = { name: 'Shared new name', instructions: 'Before' };
  assert.deepEqual(mergeRecordChanges(baseline, incoming, current), { value: incoming, conflicts: [] });
});

test('all conflicting fields are reported in baseline/incoming key order and retain their current values', () => {
  interface RecordValue { first: string; second: string; independent: string; added?: string }
  const baseline: RecordValue = { first: 'before', second: 'before', independent: 'before' };
  const incoming: RecordValue = { first: 'mine', second: 'mine', independent: 'mine', added: 'mine' };
  const current: RecordValue = { first: 'theirs', second: 'theirs', independent: 'before', added: 'theirs' };
  assert.deepEqual(mergeRecordChanges(baseline, incoming, current), {
    value: { first: 'theirs', second: 'theirs', independent: 'mine', added: 'theirs' },
    conflicts: ['first', 'second', 'added'],
  });
});

test('current-only keys survive and fields added by the incoming editor can merge', () => {
  interface RecordValue { name: string; localOnly?: string; currentOnly?: string }
  const baseline: RecordValue = { name: 'Before' };
  const incoming: RecordValue = { name: 'Before', localOnly: 'Added in this editor' };
  const current: RecordValue = { name: 'Remote name', currentOnly: 'Keep this remote addition' };
  const result = mergeRecordChanges(baseline, incoming, current);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value, { ...current, localOnly: 'Added in this editor' });
});

test('removed incoming fields become own undefined properties while unchanged missing fields retain remote additions', () => {
  interface RecordValue { required: string; removed?: string; missing?: string }
  const baseline: RecordValue = { required: 'Same', removed: 'Remove me' };
  const incoming: RecordValue = { required: 'Same' };
  const current: RecordValue = { ...baseline, missing: 'Added elsewhere' };
  const result = mergeRecordChanges(baseline, incoming, current);
  assert.deepEqual(result.conflicts, []);
  assert.equal(Object.hasOwn(result.value, 'removed'), true);
  assert.equal(result.value.removed, undefined);
  assert.equal(result.value.missing, 'Added elsewhere');
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), { required: 'Same', missing: 'Added elsewhere' });
});

test('missing and explicit undefined compare equally without resurrecting a field deleted remotely', () => {
  interface RecordValue { name: string; optional?: string }
  const baseline: RecordValue = { name: 'Same', optional: 'Earlier' };
  const incoming: RecordValue = { ...baseline };
  const current: RecordValue = { name: 'Same' };
  assert.equal(Object.hasOwn(mergeRecordChanges(baseline, incoming, current).value, 'optional'), false);
  const absent: RecordValue = { name: 'Same' };
  assert.deepEqual(mergeRecordChanges(absent, { ...absent, optional: undefined }, { ...absent, optional: 'Remote addition' }), {
    value: { name: 'Same', optional: 'Remote addition' }, conflicts: [],
  });
});

test('arrays and nested objects merge as complete field values rather than merging their contents', () => {
  const baseline = { tags: ['before'], formatting: { margin: 10, size: 11 } };
  const incoming = { tags: ['mine'], formatting: { margin: 12, size: 11 } };
  const current = { tags: ['before'], formatting: { margin: 10, size: 13 } };
  const result = mergeRecordChanges(baseline, incoming, current);
  assert.deepEqual(result.conflicts, ['formatting']);
  assert.equal(result.value.tags, incoming.tags);
  assert.equal(result.value.formatting, current.formatting);
  const same = mergeRecordChanges(baseline, incoming, { ...current, tags: ['mine'] });
  assert.deepEqual(same.conflicts, ['formatting']);
});

test('comparison preserves JSON.stringify object-key order and undefined omission semantics', () => {
  const baseline: { fields: Record<string, number | undefined> } = { fields: { first: 1, second: 2 } };
  const reordered = { fields: { second: 2, first: 1 } };
  const current = { fields: { first: 1, second: 3 } };
  assert.deepEqual(mergeRecordChanges(baseline, reordered, current), { value: current, conflicts: ['fields'] });
  const omitted = { fields: { ...baseline.fields, empty: undefined } };
  assert.deepEqual(mergeRecordChanges(baseline, omitted, current), { value: current, conflicts: [] });
});

test('merging frozen records creates a shallow result and never changes input records or nested values', () => {
  interface RecordValue { readonly title: string; readonly nested: { readonly value: string } }
  const originalNested = Object.freeze({ value: 'original' });
  const remoteNested = Object.freeze({ value: 'remote' });
  const baseline: RecordValue = Object.freeze({ title: 'Before', nested: originalNested });
  const incoming: RecordValue = Object.freeze({ title: 'Edited', nested: originalNested });
  const current: RecordValue = Object.freeze({ title: 'Before', nested: remoteNested });
  const result = mergeRecordChanges(baseline, incoming, current);
  assert.notEqual(result.value, current);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.value.title, 'Edited');
  assert.equal(result.value.nested, remoteNested);
  assert.deepEqual(baseline, { title: 'Before', nested: { value: 'original' } });
  assert.deepEqual(incoming, { title: 'Edited', nested: { value: 'original' } });
  assert.deepEqual(current, { title: 'Before', nested: { value: 'remote' } });
});

test('ignored keys follow the caller list without imposing a built-in metadata policy', () => {
  const baseline = { revision: 1, guidance: 'Earlier' };
  const incoming = { revision: 3, guidance: 'My guidance' };
  const current = { revision: 2, guidance: 'Their guidance' };
  assert.deepEqual(mergeRecordChanges(baseline, incoming, current, ['guidance']), {
    value: current, conflicts: ['revision'],
  });
});
