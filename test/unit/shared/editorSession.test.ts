import assert from 'node:assert/strict';
import test from 'node:test';
import { flushEditorSession, flushEditorSessionSync, type EditorFlushStep } from '../../../src/shared/editing/editorSession';
import { canCommitTextareas, commitPendingTextareas, getTextareaDraftRevision, markTextareaDraftChanged, registerTextareaCommit } from '../../../src/shared/editing/textareaCommit';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('publication is synchronous, persistence stays ordered, and settled runs only after all steps', async t => {
  const calls: string[] = [], first = deferred<boolean>();
  let settled = false;
  t.after(registerTextareaCommit(() => { calls.push('publish'); }));
  const flushing = flushEditorSession({ current: () => true,
    steps: [() => { calls.push('first'); return first.promise; }, () => { calls.push('second'); settled = true; return true; }],
    settled: () => { calls.push('settled'); return settled; },
  });
  assert.deepEqual(calls, ['publish', 'first']);
  first.resolve(true); assert.equal(await flushing, true);
  assert.deepEqual(calls, ['publish', 'first', 'second', 'settled']);
});

for (const kind of ['false', 'undefined', 'throw', 'reject'] as const) test(`${kind} from a flush step stops the session before later persistence`, async () => {
  let later = 0, settled = 0;
  const step: EditorFlushStep = kind === 'false' ? () => false
    : kind === 'undefined' ? (() => undefined) as unknown as EditorFlushStep
      : kind === 'throw' ? () => { throw new Error('Storage unavailable'); }
        : () => Promise.reject(new Error('Cloud unavailable'));
  assert.equal(await flushEditorSession({ current: () => true, steps: [step, () => { later++; return true; }],
    settled: () => { settled++; return true; } }), false);
  assert.equal(later, 0); assert.equal(settled, 0);
});

test('stale or unready sessions do not publish drafts or start persistence', async t => {
  let published = 0, saved = 0, composing = false;
  t.after(registerTextareaCommit(() => { published++; }, () => !composing));
  const steps = [() => { saved++; return true; }];
  assert.equal(await flushEditorSession({ current: () => false, steps }), false);
  assert.equal(flushEditorSessionSync({ current: () => false, steps }), false);
  composing = true;
  assert.equal(await flushEditorSession({ current: () => true, steps }), false);
  assert.equal(flushEditorSessionSync({ current: () => true, steps }), false);
  assert.equal(published, 0); assert.equal(saved, 0);
});

test('new typing during the first request prevents a later child from publishing or saving it', async t => {
  const first = deferred<boolean>();
  let published = 0, later = 0;
  t.after(registerTextareaCommit(() => { published++; }));
  const flushing = flushEditorSession({ current: () => true, steps: [() => first.promise,
    () => flushEditorSession({ current: () => true, steps: [() => { later++; return true; }] })],
  });
  assert.equal(published, 1);
  markTextareaDraftChanged();
  first.resolve(true);
  assert.equal(await flushing, false);
  assert.equal(later, 0);
  assert.equal(published, 1, 'the later child never republishes newly typed text');
});

test('composition starting during a request blocks continuation even before the native model changes', async t => {
  const first = deferred<boolean>();
  let composing = false, later = 0;
  t.after(registerTextareaCommit(() => {}, () => !composing));
  const revision = getTextareaDraftRevision();
  const flushing = flushEditorSession({ current: () => true, steps: [() => first.promise, () => { later++; return true; }] });
  composing = true;
  assert.equal(getTextareaDraftRevision(), revision);
  first.resolve(true);
  assert.equal(await flushing, false); assert.equal(later, 0);
  composing = false;
  assert.equal(await flushEditorSession({ current: () => true, steps: [() => true] }), true);
});

test('owner lifecycle generations reject A to B to A stale work', async () => {
  const first = deferred<boolean>(); let owner = 'A', generation = 1, later = 0;
  const capturedOwner = owner, capturedGeneration = generation;
  const flushing = flushEditorSession({ current: () => owner === capturedOwner && generation === capturedGeneration,
    steps: [() => first.promise, () => { later++; return true; }],
  });
  owner = 'B'; generation++; owner = 'A'; generation++;
  first.resolve(true);
  assert.equal(await flushing, false); assert.equal(later, 0);
});

test('owner disposal during persistence blocks continuation and final success', async () => {
  const first = deferred<boolean>(); let disposed = false, later = 0;
  const flushing = flushEditorSession({ current: () => !disposed, steps: [() => first.promise, () => { later++; return true; }] });
  disposed = true; first.resolve(true);
  assert.equal(await flushing, false); assert.equal(later, 0);
});

test('nested synchronous and asynchronous helpers can run during publication without publishing twice', async t => {
  let published = 0, syncSaved = 0, asyncSaved = 0, nestedSync = false;
  let nestedAsync: Promise<boolean> | undefined;
  t.after(registerTextareaCommit(() => {
    published++;
    nestedSync = flushEditorSessionSync({ current: () => true, steps: [() => { syncSaved++; return true; }] });
    nestedAsync = flushEditorSession({ current: () => true, steps: [() => { asyncSaved++; return true; }] });
  }, () => true));
  assert.equal(commitPendingTextareas(), true);
  assert.equal(nestedSync, true); assert.equal(await nestedAsync, true);
  assert.equal(published, 1); assert.equal(syncSaved, 1); assert.equal(asyncSaved, 1);
});

test('nested publication still reports a composition guard, independently of a dirty draft', t => {
  let composing = false, nested = true, published = 0;
  t.after(registerTextareaCommit(() => { composing = true; nested = commitPendingTextareas(); published++; }, () => !composing));
  assert.equal(canCommitTextareas(), true);
  assert.equal(commitPendingTextareas(), false);
  assert.equal(nested, false); assert.equal(published, 1);
  composing = false;
});

test('independent concurrent sessions keep their own guards without a global asynchronous lock', async () => {
  const first = deferred<boolean>(), second = deferred<boolean>();
  const calls: string[] = [];
  const a = flushEditorSession({ current: () => true, steps: [() => { calls.push('A'); return first.promise; }] });
  const b = flushEditorSession({ current: () => true, steps: [() => { calls.push('B'); return second.promise; }] });
  assert.deepEqual(calls, ['A', 'B']);
  second.resolve(true); assert.equal(await b, true);
  first.resolve(true); assert.equal(await a, true);
});

test('synchronous sessions preserve boolean results and guard changes inside each step', t => {
  const calls: string[] = [];
  t.after(registerTextareaCommit(() => { calls.push('publish'); }));
  assert.equal(flushEditorSessionSync({ current: () => true,
    steps: [() => { calls.push('save'); return true; }], settled: () => { calls.push('settled'); return true; } }), true);
  assert.deepEqual(calls, ['publish', 'save', 'settled']);
  let later = 0;
  assert.equal(flushEditorSessionSync({ current: () => true,
    steps: [() => { markTextareaDraftChanged(); return true; }, () => { later++; return true; }] }), false);
  assert.equal(later, 0);
  assert.equal(flushEditorSessionSync({ current: () => true, steps: [(() => undefined) as unknown as () => boolean] }), false);
  assert.equal(flushEditorSessionSync({ current: () => true, steps: [() => { throw new Error('Failed'); }] }), false);
});

test('settled is owner-specific and its final scope/readiness changes cannot produce success', async t => {
  let composing = false;
  t.after(registerTextareaCommit(() => {}, () => !composing));
  assert.equal(await flushEditorSession({ current: () => true, steps: [], settled: () => false }), false);
  assert.equal(flushEditorSessionSync({ current: () => true, steps: [], settled: () => false }), false);
  assert.equal(await flushEditorSession({ current: () => true, steps: [], settled: () => { composing = true; return true; } }), false);
  composing = false;
  assert.equal(flushEditorSessionSync({ current: () => true, steps: [], settled: () => { composing = true; return true; } }), false);
  composing = false;
  assert.equal(await flushEditorSession({ current: () => true, steps: [], settled: () => { throw new Error('Check failed'); } }), false);
});

test('publication failures return false, release the publication guard, and leave retry available', () => {
  const unregister = registerTextareaCommit(() => { throw new Error('Cannot publish'); });
  try { assert.equal(flushEditorSessionSync({ current: () => true, steps: [() => true] }), false); }
  finally { unregister(); }
  let published = 0;
  const cleanup = registerTextareaCommit(() => { published++; });
  try { assert.equal(flushEditorSessionSync({ current: () => true, steps: [() => true] }), true); }
  finally { cleanup(); }
  assert.equal(published, 1);
});

test('the edit revision is captured after publication and readiness is released on unregister', async () => {
  const cleanup = registerTextareaCommit(markTextareaDraftChanged);
  try { assert.equal(await flushEditorSession({ current: () => true, steps: [() => true] }), true); }
  finally { cleanup(); }
  const blocked = registerTextareaCommit(() => {}, () => false);
  assert.equal(canCommitTextareas(), false); blocked();
  assert.equal(canCommitTextareas(), true);
  assert.equal(await flushEditorSession({ current: () => true, steps: [] }), true);
});
