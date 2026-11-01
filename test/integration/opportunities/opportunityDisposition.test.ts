import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import type { OpportunityDispositionPatch, OpportunityReview } from '../../../src/app/cloudTypes';
import { isOpportunityInPast, normalizeOpportunityDispositionPatch, readOpportunityDisposition } from '../../../src/features/opportunities/domain/opportunityDisposition';

const filename = new URL('../../../src/features/opportunities/components/OpportunityDispositionControls.vue', import.meta.url);
const source = readFileSync(filename, 'utf8'), { descriptor } = parse(source);
const compiled = compileScript(descriptor, { id: 'opportunity-disposition-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {}, requireLocal = createRequire(filename);
new Function('require', 'exports', code)((name: string) => name.endsWith('.vue') ? {} : requireLocal(name), exports);
const component = { ...exports.default, render: () => null };
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
const review = (id = 'opportunity-a', owner = 'owner-a'): OpportunityReview => ({ user_id: owner, opportunity_id: id, state: 'strong_interest',
  comment: 'Keep this evaluation', interest_rating: 8.2, manually_archived: false, technical_issue_category: null, technical_issue_note: null,
  reviewed_updated_at: null, created_at: '', updated_at: '' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); await nextTick(); }
function fixture(t: TestContext) {
  const storage = new Map<string, string>(), previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  const calls: { id: string; patch: OpportunityDispositionPatch }[] = [], rows = new Map([['opportunity-a', review()]]);
  const feedbackCalls: { id: string; patch: { feedback_excluded: boolean } }[] = [];
  const handlers: {
    save?: (id: string, patch: OpportunityDispositionPatch) => Promise<OpportunityReview | null>;
    feedback?: (id: string, patch: { feedback_excluded: boolean }) => Promise<OpportunityReview | null>;
  } = {};
  const props = reactive({ ownerId: 'owner-a', opportunityId: 'opportunity-a', review: review(), busy: false, lang: 'en',
    saveDisposition: async (id: string, patch: OpportunityDispositionPatch) => {
      calls.push({ id, patch });
      if (handlers.save) return handlers.save(id, patch);
      const saved = { ...(rows.get(id) ?? review(id, props.ownerId)), ...patch }; rows.set(id, saved);
      if (id === props.opportunityId) props.review = saved;
      return saved;
    },
    saveFeedback: async (id: string, patch: { feedback_excluded: boolean }) => {
      feedbackCalls.push({ id, patch });
      if (handlers.feedback) return handlers.feedback(id, patch);
      const saved = { ...(rows.get(id) ?? review(id, props.ownerId)), ...patch }; rows.set(id, saved);
      if (id === props.opportunityId) props.review = saved;
      return saved;
    } });
  let mounted: any;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) }); app.mount({});
  t.after(() => { app.unmount(); previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'); });
  return { props, setup: mounted.$.setupState as any, calls, feedbackCalls, handlers, storage, rows };
}

test('manual past classification is personal, reversible and independent of the deadline', () => {
  const now = new Date('2026-10-29T12:00:00Z'), details = { deadline: '2099-01-01' }, original = JSON.stringify(details);
  assert.equal(isOpportunityInPast(details, undefined, now), false);
  assert.equal(isOpportunityInPast(details, { manually_archived: true }, now), true);
  assert.equal(isOpportunityInPast(details, { manually_archived: false }, now), false);
  assert.equal(isOpportunityInPast({ deadline: '2000-01-01' }, { manually_archived: false }, now), true);
  assert.equal(JSON.stringify(details), original);
});
test('disposition patches are closed, bounded and preserve private technical text', () => {
  assert.deepEqual(readOpportunityDisposition({ state: 'interested', comment: 'Legacy private evaluation' }), {});
  assert.throws(() => readOpportunityDisposition({ manually_archived: 'true' }));
  assert.deepEqual(normalizeOpportunityDispositionPatch({ manually_archived: true, technical_issue_category: 'requirements', technical_issue_note: 'Degree prerequisite\nnot met.' }),
    { manually_archived: true, technical_issue_category: 'requirements', technical_issue_note: 'Degree prerequisite\nnot met.' });
  assert.equal(normalizeOpportunityDispositionPatch({ technical_issue_note: '😀'.repeat(1000) }).technical_issue_note?.length, 2000);
  for (const patch of [{}, { manually_archived: 'true' }, { technical_issue_category: 'dislike' }, { technical_issue_note: 'x'.repeat(1001) },
    { technical_issue_note: '\0' }, { interest_rating: 0 }]) assert.throws(() => normalizeOpportunityDispositionPatch(patch));
});
test('opening and archiving never change interest, catalogue evidence or sharing', async t => {
  const f = fixture(t); assert.equal(f.calls.length, 0);
  assert.equal(await f.setup.changeArchived({ target: { checked: true } }), true); await settle();
  assert.deepEqual(f.calls, [{ id: 'opportunity-a', patch: { manually_archived: true } }]);
  assert.equal(f.props.review.state, 'strong_interest'); assert.equal(f.props.review.interest_rating, 8.2);
  assert.equal(f.props.review.comment, 'Keep this evaluation'); assert.equal(await f.setup.flush(), true);
});
test('a failed exclusion remains retryable after another footer control saves', async t => {
  const f = fixture(t); f.handlers.feedback = async () => null;
  assert.equal(await f.setup.changeExcluded({ target: { checked: true } }), false); await settle();
  assert.equal(await f.setup.changeArchived({ target: { checked: true } }), true); await settle();
  assert.equal(await f.setup.flush(), false);
  assert.match(f.setup.actionError, /Retry before leaving/);
  assert.deepEqual(f.calls, [{ id: 'opportunity-a', patch: { manually_archived: true } }]);
  f.handlers.feedback = undefined;
  assert.equal(await f.setup.retry(), true); await settle();
  assert.equal(f.props.review.feedback_excluded, true);
  assert.equal(f.props.review.manually_archived, true);
  assert.equal(await f.setup.flush(), true);
  assert.deepEqual(f.feedbackCalls, Array.from({ length: 2 }, () => ({ id: 'opportunity-a', patch: { feedback_excluded: true } })));
});
test('technical notes stay local until commit and save separately from the evaluation', async t => {
  const f = fixture(t);
  f.setup.notes = 'Portal rejects my degree certificate.'; await settle(); assert.equal(f.calls.length, 0);
  assert.equal(await f.setup.flush(), true); await settle();
  assert.deepEqual(f.calls, [{ id: 'opportunity-a', patch: { technical_issue_note: 'Portal rejects my degree certificate.' } }]);
  assert.equal(f.props.review.comment, 'Keep this evaluation');
  assert.equal(await f.setup.changeCategory({ target: { value: 'application_problem' } }), true);
  assert.equal(f.props.review.technical_issue_category, 'application_problem');
});
test('a failed manual status retains its local selection and blocks navigation until exact retry', async t => {
  const f = fixture(t); f.handlers.save = async () => null;
  assert.equal(await f.setup.changeArchived({ target: { checked: true } }), false); await settle();
  assert.equal(f.setup.archivedDraft, true); assert.equal(await f.setup.flush(), false);
  delete f.handlers.save; assert.equal(await f.setup.retry(), true); await settle(); assert.equal(await f.setup.flush(), true);
  assert.deepEqual(f.calls[0], f.calls[1]);
});
test('technical note failure and overlong content preserve the complete local draft', async t => {
  const f = fixture(t); f.handlers.save = async () => null;
  f.setup.notes = 'Technical explanation'; assert.equal(await f.setup.flush(), false); assert.equal(f.setup.notes, 'Technical explanation');
  delete f.handlers.save; assert.equal(await f.setup.retry(), true); await settle(); assert.equal(await f.setup.flush(), true);
  f.setup.notes = 'x'.repeat(1001); assert.equal(await f.setup.flush(), false); assert.equal(f.setup.notes.length, 1001);
});
test('a record change flushes technical text under its original opportunity ID', async t => {
  const f = fixture(t); f.setup.notes = 'Original opportunity technical note';
  f.props.opportunityId = 'opportunity-b'; f.props.review = review('opportunity-b'); await settle();
  assert.equal(f.setup.notes, '');
  assert.deepEqual(f.calls, [{ id: 'opportunity-a', patch: { technical_issue_note: 'Original opportunity technical note' } }]);
});
test('an owner change cannot carry a pending status failure into the next account', async t => {
  const f = fixture(t), pending = deferred<OpportunityReview | null>(); f.handlers.save = () => pending.promise;
  const saving = f.setup.changeArchived({ target: { checked: true } }); await settle();
  f.props.ownerId = 'owner-b'; f.props.review = review('opportunity-a', 'owner-b'); await settle(); pending.resolve(null); await saving; await settle();
  assert.equal(f.setup.archivedDraft, false); assert.equal(f.setup.actionError, ''); assert.equal(f.setup.notes, '');
});
test('technical notes use the shared textarea commit contract', () => {
  assert.match(source, /<AutosaveTextarea[^>]*v-model="notes"[^>]*@commit="flushNote"/);
  assert.doesNotMatch(source, /<textarea\b|@input=.*save|setTimeout\(/);
});

test('leaving drains a technical-note commit queued behind an already pending status write', async t => {
  const f = fixture(t), pendingStatus = deferred<OpportunityReview | null>();
  f.handlers.save = async (_id, patch) => {
    if ('manually_archived' in patch) return pendingStatus.promise;
    const saved = { ...f.props.review, ...patch }; f.props.review = saved; return saved;
  };
  const status = f.setup.changeArchived({ target: { checked: true } });
  await settle();
  const { registerTextareaCommit } = requireLocal('../../../shared/editing/textareaCommit') as typeof import('../../../src/shared/editing/textareaCommit');
  let published = false;
  let committed: Promise<boolean> | undefined;
  const unregister = registerTextareaCommit(() => {
    if (published) return;
    published = true;
    f.setup.notes = 'The portal rejects the uploaded certificate.';
    committed = f.setup.flushNote();
  });
  t.after(unregister);
  const leaving = f.setup.flush();
  await settle();
  assert.equal(f.calls.length, 1, 'the technical note waits behind the status patch');
  f.props.review = { ...f.props.review, manually_archived: true };
  pendingStatus.resolve(f.props.review);
  assert.equal(await status, true);
  assert.equal(await leaving, true, 'navigation waits for the note rather than treating its pending write as a failure');
  assert.equal(await committed, true);
  assert.deepEqual(f.calls.map(call => call.patch), [
    { manually_archived: true }, { technical_issue_note: 'The portal rejects the uploaded certificate.' },
  ]);
});
