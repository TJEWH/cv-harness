import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { effectScope, onScopeDispose, ref } from 'vue';
import { useApplicationNotesAutosave } from '../../../src/shared/editing/useApplicationNotesAutosave';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function fixture(t: TestContext, save: (id: string, notes: string) => Promise<boolean>, storage: ReturnType<typeof memoryStorage> | null = null) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const application = ref<{ id: string; notes: string } | null>({ id: 'first', notes: 'Saved notes' });
  const busy = ref(false), owner = ref('owner');
  const scope = effectScope();
  const autosave = scope.run(() => useApplicationNotesAutosave({
    application: () => application.value, owner: () => owner.value,
    busy: () => busy.value, save, errorMessage: () => 'Connection failed', storage,
  }))!;
  t.after(() => scope.stop());
  return { application, busy, owner, autosave, scope };
}

test('typing preserves an unsaved draft until an explicit flush and opening an application never writes', async t => {
  const calls: string[] = [];
  const storage = memoryStorage();
  const { autosave } = fixture(t, async (_id, notes) => { calls.push(notes); return true; }, storage);
  t.mock.timers.tick(500);
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(autosave.status.value, 'saved');
  autosave.notes.value = 'First edit';
  t.mock.timers.tick(200);
  autosave.notes.value = 'Latest edit';
  t.mock.timers.tick(60_000);
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(autosave.status.value, 'unsaved');
  assert.equal(autosave.dirty.value, true);
  assert.deepEqual(JSON.parse([...storage.values.values()][0]!), { value: 'Latest edit' });
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(calls, ['Latest edit']);
  assert.equal(autosave.status.value, 'saved');
  assert.equal(autosave.dirty.value, false);
  assert.equal(storage.values.size, 0);
});

test('typing during an in-flight save remains unsaved until another explicit flush', async t => {
  const first = deferred<boolean>();
  const calls: string[] = [];
  const { autosave, application } = fixture(t, async (_id, notes) => {
    calls.push(notes);
    if (calls.length === 1) return first.promise;
    return true;
  });
  autosave.notes.value = 'Submitted snapshot';
  const flushed = autosave.flush();
  await settle();
  autosave.notes.value = 'More typing';
  autosave.notes.value = 'Latest typing';
  application.value = { id: 'first', notes: 'Submitted snapshot' };
  assert.equal(autosave.notes.value, 'Latest typing');
  first.resolve(true);
  assert.equal(await flushed, false, 'the caller cannot navigate away while a newer draft remains');
  t.mock.timers.tick(60_000);
  await settle();
  assert.deepEqual(calls, ['Submitted snapshot']);
  assert.equal(autosave.notes.value, 'Latest typing');
  assert.equal(autosave.status.value, 'unsaved');
  assert.equal(autosave.dirty.value, true);
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(calls, ['Submitted snapshot', 'Latest typing']);
  assert.equal(autosave.dirty.value, false);
  assert.equal(autosave.status.value, 'saved');
});

test('explicit flushes capture their values immediately, serialize distinct snapshots, and coalesce duplicates', async t => {
  const first = deferred<boolean>();
  const second = deferred<boolean>();
  const calls: string[] = [];
  const { autosave, busy } = fixture(t, async (_id, notes) => {
    calls.push(notes);
    return calls.length === 1 ? first.promise : second.promise;
  });
  busy.value = true;
  autosave.notes.value = 'First committed snapshot';
  const firstFlush = autosave.flush();
  autosave.notes.value = 'Second committed snapshot';
  const secondFlush = autosave.flush();
  const duplicateFlush = autosave.flush();
  await settle();
  assert.deepEqual(calls, [], 'workspace mutations delay sending, not snapshot capture');
  busy.value = false;
  await settle();
  assert.deepEqual(calls, ['First committed snapshot']);
  assert.equal(autosave.status.value, 'saving');
  first.resolve(true);
  assert.equal(await firstFlush, false, 'the first snapshot does not include the later committed edit');
  await settle();
  assert.deepEqual(calls, ['First committed snapshot', 'Second committed snapshot']);
  second.resolve(true);
  assert.deepEqual(await Promise.all([secondFlush, duplicateFlush]), [true, true]);
  assert.deepEqual(calls, ['First committed snapshot', 'Second committed snapshot'], 'duplicate commits must not issue duplicate writes');
  assert.equal(autosave.notes.value, 'Second committed snapshot');
  assert.equal(autosave.dirty.value, false);
  assert.equal(autosave.status.value, 'saved');
});

test('reverting to the saved value still commits the revert after an earlier edit is in flight', async t => {
  const first = deferred<boolean>();
  const calls: string[] = [];
  const storage = memoryStorage();
  const { autosave } = fixture(t, async (_id, notes) => {
    calls.push(notes);
    return calls.length === 1 ? first.promise : true;
  }, storage);
  autosave.notes.value = 'Edit already sent';
  const firstFlush = autosave.flush();
  await settle();
  autosave.notes.value = 'Saved notes';
  const revertFlush = autosave.flush();
  assert.equal(storage.values.size, 1, 'the revert is still needed if the earlier request succeeds');
  first.resolve(true);
  assert.equal(await firstFlush, false);
  assert.equal(await revertFlush, true);
  assert.deepEqual(calls, ['Edit already sent', 'Saved notes']);
  assert.equal(autosave.notes.value, 'Saved notes');
  assert.equal(autosave.dirty.value, false);
  assert.equal(storage.values.size, 0);
});

test('blur or navigation flush waits for another workspace mutation instead of dropping the save', async t => {
  const calls: string[] = [];
  const { autosave, busy } = fixture(t, async (_id, notes) => { calls.push(notes); return true; });
  busy.value = true;
  autosave.notes.value = 'Pending notes';
  let finished = false;
  const flushing = autosave.flush().then(saved => { finished = true; return saved; });
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(finished, false);
  busy.value = false;
  assert.equal(await flushing, true);
  assert.deepEqual(calls, ['Pending notes']);
});

test('failed commits retain the draft and can be retried without another input event', async t => {
  let succeeds = false;
  const { autosave, application } = fixture(t, async () => succeeds);
  autosave.notes.value = 'Unsaved draft';
  assert.equal(await autosave.flush(), false);
  assert.equal(autosave.status.value, 'error');
  assert.equal(autosave.error.value, 'Connection failed');
  application.value = { id: 'first', notes: 'Saved notes' };
  assert.equal(autosave.notes.value, 'Unsaved draft');
  assert.equal(autosave.dirty.value, true);
  succeeds = true;
  assert.equal(await autosave.flush(), true);
  assert.equal(autosave.status.value, 'saved');
  assert.equal(autosave.error.value, '');
});

test('switching applications flushes the old draft without overwriting the new editor', async t => {
  const first = deferred<boolean>();
  const calls: [string, string][] = [];
  const { autosave, application } = fixture(t, async (id, notes) => {
    calls.push([id, notes]);
    return id === 'first' ? first.promise : true;
  });
  autosave.notes.value = 'First application edit';
  application.value = { id: 'second', notes: 'Second saved' };
  await settle();
  autosave.notes.value = 'Second application edit';
  const flushed = autosave.flush();
  first.resolve(true);
  assert.equal(await flushed, true);
  assert.deepEqual(calls, [['first', 'First application edit'], ['second', 'Second application edit']]);
  assert.equal(autosave.notes.value, 'Second application edit');
});

test('queued drafts are cancelled across accounts and stale failures do not affect the new editor', async t => {
  const first = deferred<boolean>();
  const calls: [string, string][] = [];
  const { autosave, application, owner } = fixture(t, async (id, notes) => { calls.push([id, notes]); return first.promise; });
  autosave.notes.value = 'Old account notes';
  const flushed = autosave.flush();
  await settle();
  autosave.notes.value = 'Old account queued notes';
  const queued = autosave.flush();
  owner.value = 'other';
  application.value = { id: 'second', notes: 'Other account notes' };
  first.resolve(false);
  assert.equal(await flushed, false);
  assert.equal(await queued, false);
  assert.equal(autosave.notes.value, 'Other account notes');
  assert.equal(autosave.status.value, 'saved');
  assert.equal(autosave.error.value, '');
  assert.deepEqual(calls, [['first', 'Old account notes']]);
});

test('scope disposal flushes an uncommitted edit', async t => {
  const calls: string[] = [];
  const { autosave, scope } = fixture(t, async (_id, notes) => { calls.push(notes); return true; });
  autosave.notes.value = 'Closing edit';
  scope.stop();
  await settle();
  assert.deepEqual(calls, ['Closing edit']);
});

test('an account change at the idle boundary cancels the old draft before sending it', async t => {
  const calls: string[] = [];
  const { autosave, owner } = fixture(t, async (_id, notes) => { calls.push(notes); return true; });
  autosave.notes.value = 'Old account draft';
  const flushing = autosave.flush();
  await Promise.resolve();
  owner.value = 'other';
  assert.equal(await flushing, false);
  assert.deepEqual(calls, []);
});

test('an account switch clears retained drafts even with no application currently open', async t => {
  const calls: [string, string][] = [];
  const { autosave, application, owner, busy } = fixture(t, async (id, notes) => { calls.push([id, notes]); return true; });
  busy.value = true;
  autosave.notes.value = 'Old account pending draft';
  application.value = null;
  await settle();
  owner.value = 'other';
  application.value = { id: 'first', notes: 'New account saved notes' };
  busy.value = false;
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(autosave.notes.value, 'New account saved notes');
  assert.equal(autosave.dirty.value, false);
});

test('an aborted in-flight save on disposal recovers the latest typing when the owner reopens', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = memoryStorage();
  const request = deferred<boolean>();
  const scope = effectScope();
  const application = () => ({ id: 'first', notes: 'Saved notes' });
  const autosave = scope.run(() => {
    // The workspace disposes before notes autosave and aborts its request.
    onScopeDispose(() => { request.resolve(false); });
    return useApplicationNotesAutosave({ application, owner: () => 'owner', storage, save: () => request.promise });
  })!;
  autosave.notes.value = 'Snapshot already sent';
  const pending = autosave.flush();
  await settle();
  autosave.notes.value = 'Latest typing before closing';
  scope.stop();
  assert.equal(await pending, false);
  assert.equal(storage.values.size, 1);

  const writes: string[] = [];
  const reopened = effectScope();
  const recovered = reopened.run(() => useApplicationNotesAutosave({
    application, owner: () => 'owner', storage, save: async (_id, notes) => { writes.push(notes); return true; },
  }))!;
  t.after(() => reopened.stop());
  assert.equal(recovered.notes.value, 'Latest typing before closing');
  assert.equal(recovered.dirty.value, true);
  assert.equal(recovered.status.value, 'unsaved');
  t.mock.timers.tick(60_000);
  await settle();
  assert.deepEqual(writes, [], 'recovered drafts wait for an explicit commit');
  assert.equal(storage.values.size, 1);
  assert.equal(await recovered.flush(), true);
  assert.deepEqual(writes, ['Latest typing before closing']);
  assert.equal(storage.values.size, 0);
  assert.equal(recovered.status.value, 'saved');
});

test('local recovery remains isolated by account and application and is removed when an edit is reverted', async t => {
  const storage = memoryStorage();
  const { autosave, owner, application, busy } = fixture(t, async () => true, storage);
  autosave.notes.value = 'An unsaved edit';
  autosave.notes.value = 'Saved notes';
  assert.equal(storage.values.size, 0, 'a reverted edit must not reappear after reopening');
  busy.value = true;
  autosave.notes.value = 'Owner first application draft';
  owner.value = 'other';
  assert.equal(autosave.notes.value, 'Saved notes');
  owner.value = 'owner';
  application.value = { id: 'second', notes: 'Second saved' };
  assert.equal(autosave.notes.value, 'Second saved');
  application.value = { id: 'first', notes: 'Saved notes' };
  assert.equal(autosave.notes.value, 'Owner first application draft');
  busy.value = false;
  assert.equal(await autosave.flush(), true);
  assert.equal(storage.values.size, 0);
});

test('a successful older request cannot clear a newer recovery value written in another tab', async t => {
  const storage = memoryStorage();
  const request = deferred<boolean>();
  const { autosave } = fixture(t, async () => request.promise, storage);
  autosave.notes.value = 'First tab snapshot';
  const pending = autosave.flush();
  await settle();
  const key = [...storage.values.keys()][0]!;
  storage.setItem(key, JSON.stringify({ value: 'Another tab latest typing' }));
  request.resolve(true);
  assert.equal(await pending, true);
  assert.deepEqual(JSON.parse(storage.getItem(key)!), { value: 'Another tab latest typing' });
});

test('comment drafts and application notes recover and save independently for the same owner and item ID', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = memoryStorage();
  const notesKey = 'CV_APPLICATION_NOTES_DRAFT:owner:first';
  const commentKey = 'CV_OPPORTUNITY_COMMENT_DRAFT:owner:first';
  storage.setItem(notesKey, JSON.stringify({ value: 'Application notes draft' }));
  storage.setItem(commentKey, JSON.stringify({ value: 'Reason for strong interest' }));
  const scope = effectScope();
  t.after(() => scope.stop());
  const writes: [string, string][] = [];
  const options = {
    application: () => ({ id: 'first', notes: '' }), owner: () => 'owner', storage,
  };
  const notes = scope.run(() => useApplicationNotesAutosave({
    ...options, save: async (_id, value) => { writes.push(['notes', value]); return true; },
  }))!;
  const comment = scope.run(() => useApplicationNotesAutosave({
    ...options, storagePrefix: 'CV_OPPORTUNITY_COMMENT_DRAFT', maxLength: 5_000,
    save: async (_id, value) => { writes.push(['comment', value]); return true; },
  }))!;
  assert.equal(notes.notes.value, 'Application notes draft');
  assert.equal(comment.notes.value, 'Reason for strong interest');
  comment.notes.value = 'The role matches my experience';
  assert.deepEqual(JSON.parse(storage.getItem(commentKey)!), { value: 'The role matches my experience' });
  assert.equal(await notes.flush(), true);
  assert.equal(storage.getItem(notesKey), null);
  assert.notEqual(storage.getItem(commentKey), null);
  assert.equal(await comment.flush(), true);
  assert.deepEqual(writes, [['notes', 'Application notes draft'], ['comment', 'The role matches my experience']]);
  assert.equal(storage.values.size, 0);
});

for (const { name, storagePrefix, maxLength, limit } of [
  { name: 'comments', storagePrefix: 'CV_OPPORTUNITY_COMMENT_DRAFT', maxLength: 5_000, limit: 5_000 },
  { name: 'application notes by default', storagePrefix: undefined, maxLength: undefined, limit: 20_000 },
]) {
  test(`draft recovery accepts the maximum length and ignores oversized drafts for ${name}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const storage = memoryStorage();
    const prefix = storagePrefix ?? 'CV_APPLICATION_NOTES_DRAFT';
    const allowed = 'a'.repeat(limit);
    storage.setItem(`${prefix}:owner:first`, JSON.stringify({ value: allowed }));
    storage.setItem(`${prefix}:owner:second`, JSON.stringify({ value: 'b'.repeat(limit + 1) }));
    const application = ref({ id: 'first', notes: 'Saved notes' });
    const writes: [string, string][] = [];
    const scope = effectScope();
    t.after(() => scope.stop());
    const autosave = scope.run(() => useApplicationNotesAutosave({
      application: () => application.value, owner: () => 'owner', storage, storagePrefix, maxLength,
      save: async (id, value) => { writes.push([id, value]); return true; },
    }))!;
    assert.equal(autosave.notes.value, allowed);
    assert.equal(await autosave.flush(), true);
    application.value = { id: 'second', notes: 'Saved second notes' };
    assert.equal(autosave.notes.value, 'Saved second notes');
    assert.equal(autosave.dirty.value, false);
    t.mock.timers.tick(250);
    await settle();
    assert.deepEqual(writes, [['first', allowed]]);
  });
}
