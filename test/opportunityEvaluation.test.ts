import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_OPPORTUNITY_EVALUATION_LENGTH, migrateOpportunityEvaluationDrafts } from '../src/features/opportunities/domain/opportunityEvaluation';

const owner = 'owner:one', id = 'opportunity:one';
const oldKey = (account = owner, opportunity = id) => `CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:${encodeURIComponent(account)}:${encodeURIComponent(opportunity)}`;
const currentKey = (account = owner, opportunity = id) => `CV_OPPORTUNITY_COMMENT_DRAFT:${encodeURIComponent(account)}:${encodeURIComponent(opportunity)}`;
function fixture() {
  const values = new Map<string,string>();
  const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => { values.set(key,value); },
    removeItem: (key: string) => { values.delete(key); } };
  return { values, storage };
}
const draft = (value: string) => JSON.stringify({ value });

test('retired local feedback moves once into the current owner-scoped recovery key without saving', () => {
  const { values, storage } = fixture();
  values.set(oldKey(),draft('Recovered feedback.'));
  values.set(oldKey('other'),draft('Other owner private feedback.'));
  migrateOpportunityEvaluationDrafts(owner,[],storage);
  assert.equal(values.get(currentKey()),draft('Recovered feedback.'));
  assert.equal(values.has(oldKey()),false);
  assert.equal(values.get(oldKey('other')),draft('Other owner private feedback.'));
  const once = [...values];
  migrateOpportunityEvaluationDrafts(owner,[],storage);
  assert.deepEqual([...values],once);
});

test('one-time local recovery preserves exact distinct text, containment, empty edits and Unicode', () => {
  for (const [evaluation,feedback,expected] of [
    ['Private evaluation.','Feedback.','Private evaluation.\n\nFeedback.'],
    ['Includes feedback.','feedback.','Includes feedback.'],
    ['feedback.','Includes feedback.','Includes feedback.'],
    ['Same','Same','Same'], ['', '', ''], ['  \r\n','\t ', '  \r\n\n\n\t '],
    ['🧪'.repeat(MAX_OPPORTUNITY_EVALUATION_LENGTH),'🦻'.repeat(600),`${'🧪'.repeat(MAX_OPPORTUNITY_EVALUATION_LENGTH)}\n\n${'🦻'.repeat(600)}`],
  ]) {
    const { values,storage } = fixture();
    values.set(currentKey(),draft(evaluation!)); values.set(oldKey(),draft(feedback!));
    migrateOpportunityEvaluationDrafts(owner,[],storage);
    assert.equal(values.get(currentKey()),draft(expected!));
    assert.equal(values.has(oldKey()),false);
  }
});

test('malformed or unrecognized recovery is kept intact instead of overwriting either source', () => {
  for (const value of ['invalid','null','{}','{"value":42}',draft('x'.repeat(601))]) {
    const { values,storage } = fixture(); values.set(oldKey(),value);
    migrateOpportunityEvaluationDrafts(owner,[],storage);
    assert.equal(values.get(oldKey()),value); assert.equal(values.has(currentKey()),false);
  }
  const { values,storage } = fixture(); values.set(oldKey(),draft('Feedback.')); values.set(currentKey(),'malformed');
  migrateOpportunityEvaluationDrafts(owner,[],storage);
  assert.equal(values.get(oldKey()),draft('Feedback.')); assert.equal(values.get(currentKey()),'malformed');
});

test('storage failure and a newer retired draft never clear the only recoverable source', () => {
  const { values,storage } = fixture(); values.set(oldKey(),draft('Original.'));
  migrateOpportunityEvaluationDrafts(owner,[],{ ...storage, setItem() { throw new Error('Quota exceeded'); } });
  assert.equal(values.get(oldKey()),draft('Original.'));
  migrateOpportunityEvaluationDrafts(owner,[],{ ...storage, setItem(key,value) { storage.setItem(key,value); storage.setItem(oldKey(),draft('Newer.')); } });
  assert.equal(values.get(oldKey()),draft('Newer.')); assert.equal(values.get(currentKey()),draft('Original.'));
});

test('missing or inaccessible browser storage does not affect cloud evaluation saving', () => {
  assert.doesNotThrow(() => migrateOpportunityEvaluationDrafts(owner,[],null));
  const original = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    Object.defineProperty(globalThis,'localStorage',{ configurable:true,get() { throw new Error('Denied'); } });
    assert.doesNotThrow(() => migrateOpportunityEvaluationDrafts(owner,[]));
  } finally { original ? Object.defineProperty(globalThis,'localStorage',original) : Reflect.deleteProperty(globalThis,'localStorage'); }
});

test('a newer local evaluation observed during migration remains authoritative', () => {
  const { values,storage } = fixture(); values.set(oldKey(),draft('Recovered feedback.'));
  values.set(currentKey(),draft('Original local evaluation.'));
  let reads = 0;
  migrateOpportunityEvaluationDrafts(owner,[],{ ...storage, getItem(key) {
    if (key === currentKey() && ++reads === 2) values.set(key,draft('Newer local evaluation.'));
    return storage.getItem(key);
  } });
  assert.equal(values.get(currentKey()),draft('Newer local evaluation.'));
  assert.equal(values.get(oldKey()),draft('Recovered feedback.'));
});

test('a summary-only local draft incorporates the migrated saved evaluation once without reviving it over a newer local edit', () => {
  const { values,storage } = fixture();
  const reviews = [{ user_id:owner,opportunity_id:id,comment:'Saved complete evaluation.' }];
  values.set(oldKey(),draft('Recovered feedback.'));
  migrateOpportunityEvaluationDrafts(owner,reviews,storage);
  assert.equal(values.get(currentKey()),draft('Saved complete evaluation.\n\nRecovered feedback.'));
  values.set(currentKey(),draft('New replacement evaluation.')); values.set(oldKey(),draft('Another local feedback draft.'));
  migrateOpportunityEvaluationDrafts(owner,reviews,storage);
  assert.equal(values.get(currentKey()),draft('New replacement evaluation.\n\nAnother local feedback draft.'));
  assert.doesNotMatch(values.get(currentKey())!,/Saved complete/);
});
