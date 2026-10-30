import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { nextTick } from 'vue';
import { createRequire } from 'node:module';
import { idle, mount, refinementKey, type Workspace } from './refinementWorkflowHarness';

// Match the real helper loaded by the harness's CommonJS SFC loader.
const { markTextareaDraftChanged, registerTextareaCommit } = createRequire(import.meta.url)('../src/shared/editing/textareaCommit.ts') as typeof import('../src/shared/editing/textareaCommit');

interface EditorWorkspace extends Workspace {
  flush(): Promise<boolean>;
  flushTextareas(): Promise<boolean>;
  annotations: { flush(): Promise<boolean> } | null;
}
function deferred() {
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>(finish => { resolve = finish; });
  return { promise, resolve };
}
async function fixture(t: TestContext) {
  const f = mount(t);
  await idle(f.setup);
  return { ...f, editor: f.setup as EditorWorkspace };
}

test('application flush keeps parent evaluation, annotation, and local persistence in order even when inactive', async t => {
  const f = await fixture(t), order: string[] = [];
  Object.assign(f.props, { active: false, flushEvaluation: async () => { order.push('evaluation'); return true; } });
  await nextTick();
  f.editor.annotations = { flush: async () => { order.push('annotations'); return true; } };
  const write = f.storage.setItem.bind(f.storage);
  t.mock.method(f.storage, 'setItem', (key: string, value: string) => {
    if (key === refinementKey) order.push('local persistence');
    write(key, value);
  });
  f.data.delete(refinementKey);
  assert.equal(f.editor.flush, f.editor.flushTextareas);
  assert.equal(await f.editor.flush(), true);
  assert.deepEqual(order, ['evaluation', 'annotations', 'local persistence']);
  assert.ok(f.data.has(refinementKey));
});

test('failed application flush steps stop later persistence and retain the existing local save error', async t => {
  const f = await fixture(t);
  let evaluationSaved = false, annotationsSaved = false, annotationFlushes = 0;
  Object.assign(f.props, { flushEvaluation: async () => evaluationSaved });
  await nextTick();
  f.editor.annotations = { flush: async () => { annotationFlushes++; return annotationsSaved; } };
  f.data.delete(refinementKey); f.writes.length = 0;
  assert.equal(await f.editor.flush(), false);
  assert.equal(annotationFlushes, 0); assert.deepEqual(f.writes, []);
  evaluationSaved = true;
  assert.equal(await f.editor.flush(), false);
  assert.equal(annotationFlushes, 1); assert.deepEqual(f.writes, []);
  annotationsSaved = true; f.failSave(refinementKey);
  assert.equal(await f.editor.flush(), false);
  assert.match(f.editor.saveError, /Local save failed.*quota/);
  assert.equal(f.data.has(refinementKey), false);
  assert.equal(await f.editor.flush(), true);
  assert.equal(f.editor.saveError, ''); assert.ok(f.data.has(refinementKey));
});

test('new native typing during parent evaluation prevents annotation flush and local snapshot publication', async t => {
  const f = await fixture(t), saving = deferred();
  let annotationFlushes = 0, unpublishedDraft = false;
  Object.assign(f.props, { flushEvaluation: () => saving.promise });
  await nextTick();
  f.editor.annotations = { flush: async () => { annotationFlushes++; return true; } };
  const unregister = registerTextareaCommit(() => { if (unpublishedDraft) unpublishedDraft = false; });
  try {
    f.data.delete(refinementKey); f.writes.length = 0;
    const pending = f.editor.flush();
    unpublishedDraft = true; markTextareaDraftChanged();
    saving.resolve(true);
    assert.equal(await pending, false);
    assert.equal(annotationFlushes, 0); assert.deepEqual(f.writes, []);
    assert.equal(unpublishedDraft, true, 'continuations must not republish a newer lazy draft');
    assert.equal(f.data.has(refinementKey), false);
  } finally { unregister(); }
});

test('application owner, record, client, and activation A-B-A changes invalidate an awaiting session', async t => {
  for (const change of ['owner', 'record', 'client', 'active'] as const) await t.test(change, async t => {
    const f = await fixture(t), saving = deferred(), reopening = deferred();
    let annotationFlushes = 0, evaluationCalls = 0;
    Object.assign(f.props, { flushEvaluation: () => ++evaluationCalls === 1 ? saving.promise : reopening.promise, active: true });
    await nextTick();
    f.editor.annotations = { flush: async () => { annotationFlushes++; return true; } };
    const original = { owner: f.props.userId, application: f.props.application, client: f.props.client };
    const pending = f.editor.flush();
    Object.assign(f.props, change === 'owner' ? { userId: 'another-owner' }
      : change === 'record' ? { application: { ...original.application, id: 'another-application' } }
        : change === 'client' ? { client: null } : { active: false });
    await nextTick();
    Object.assign(f.props, change === 'owner' ? { userId: original.owner }
      : change === 'record' ? { application: original.application }
        : change === 'client' ? { client: original.client } : { active: true });
    await nextTick();
    saving.resolve(true);
    assert.equal(await pending, false); assert.equal(annotationFlushes, 0);
    reopening.resolve(false);
    await idle(f.editor);
  });
});

test('replacing the annotation editor or unmounting cannot continue an older application flush', async t => {
  for (const change of ['replace-child', 'unmount'] as const) await t.test(change, async t => {
    const f = await fixture(t), saving = deferred();
    let oldFlushes = 0, newFlushes = 0;
    Object.assign(f.props, { flushEvaluation: () => saving.promise });
    await nextTick();
    f.editor.annotations = { flush: async () => { oldFlushes++; return true; } };
    const pending = f.editor.flush();
    if (change === 'replace-child') f.editor.annotations = { flush: async () => { newFlushes++; return true; } };
    else f.close();
    saving.resolve(true);
    assert.equal(await pending, false); assert.equal(oldFlushes, 0); assert.equal(newFlushes, 0);
  });
});
