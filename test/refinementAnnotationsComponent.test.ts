import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import type { AnnotationStatus } from '../src/features/refinement/refinementTypes';
import type { AnnotationView } from '../src/features/refinement/domain/refinementAnnotations';

type Item = AnnotationView & { target: string; referenceChanged: boolean; included: boolean };
interface Draft {
  status: AnnotationStatus; response: string; reviewId: string | null;
  savedStatus: AnnotationStatus; savedResponse: string; committedResponse: string;
  failed: boolean; failedStatus: AnnotationStatus | null; partialFailure: boolean; saving: boolean;
}
interface Setup {
  drafts: Record<string, Draft>;
  controlsDisabled: boolean;
  key(item: Item): string;
  save(item: Item): Promise<boolean>;
  commitAnswer(item: Item): Promise<boolean>;
  selectStatus(item: Item, status: 'resolved' | 'ignored'): Promise<boolean>;
  flush(): Promise<boolean>;
  failureMessage(item: Item): string;
}
const filename = new URL('../src/features/refinement/components/RefinementAnnotations.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'refinement-annotations-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireFromComponent = createRequire(filename);
const { registerTextareaCommit } = requireFromComponent('../../../shared/editing/textareaCommit') as typeof import('../src/shared/editing/textareaCommit');
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireFromComponent(path), componentExports);
const component = { ...componentExports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {},
  setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});

function mount(t: TestContext, initial: Partial<Item> = {}) {
  const item: Item = {
    annotation: { id: 'annotation-1', type: 'question', document: 'cv', location: { fieldId: 'field-1' }, text: 'Which methods did you use?' },
    proposalId: 'proposal-1', requestId: 'request-1', status: 'resolved', response: 'Saved answer.', reviewId: 'review-1',
    target: 'CV · Experience 2: bullets', referenceChanged: false, included: true,
    ...initial,
  };
  const props = reactive({ items: [item], lang: 'en', disabled: false, busy: false,
    save: async (_id: string, _status: AnnotationStatus, _response: string, _reviewId: string | null, _proposalId?: string): Promise<boolean> => false,
    privacyPreview: (value: string) => value,
  });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
  app.mount({}); t.after(() => app.unmount());
  const setup = (mounted as { $: { setupState: Setup } }).$.setupState;
  return { props, setup, item: props.items[0]!, draft: () => setup.drafts[setup.key(props.items[0]!)]! };
}

function acknowledgeSaves(fixture: ReturnType<typeof mount>) {
  const writes: { status: AnnotationStatus; response: string; reviewId: string | null }[] = [];
  fixture.props.save = async (_id, status, response, reviewId) => {
    writes.push({ status, response, reviewId });
    fixture.props.items = [{ ...fixture.props.items[0]!, status, response: fixture.props.privacyPreview(response).trim(), reviewId: 'review-' + (writes.length + 1) }];
    await nextTick();
    return true;
  };
  return writes;
}

test('carried and new questions with the same annotation number save to their own proposals', async t => {
  const { props, setup, item } = mount(t, { status: 'open', response: null, reviewId: null });
  props.items = [...props.items, { ...item, proposalId: 'proposal-2' }];
  await nextTick();
  const writes: string[] = [];
  props.save = async (id, status, response, _reviewId, proposalId) => {
    writes.push(`${proposalId}/${id}`);
    props.items = props.items.map(current => current.proposalId === proposalId
      ? { ...current, status, response, reviewId: `review-${writes.length}` } : current);
    await nextTick();
    return true;
  };
  await nextTick();
  setup.drafts[setup.key(item)]!.response = 'Answer to the carried question.';
  assert.equal(await setup.commitAnswer(item), true);
  const newer = props.items.find(current => current.proposalId === 'proposal-2')!;
  assert.equal(await setup.selectStatus(newer, 'ignored'), true);
  assert.deepEqual(writes, ['proposal-1/annotation-1', 'proposal-2/annotation-1']);
  assert.equal(props.items[0]!.status, 'resolved');
  assert.equal(props.items[1]!.status, 'ignored');
});

test('failed ignore retains the explicit ignored intent and its response for a direct retry', async t => {
  const { props, setup, item, draft } = mount(t);
  draft().response = 'Unsaved answer to retain.';
  assert.equal(await setup.selectStatus(item, 'ignored'), false);
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().savedStatus, 'resolved');
  assert.equal(draft().response, 'Unsaved answer to retain.');
  assert.equal(draft().reviewId, 'review-1');
  assert.equal(draft().failedStatus, 'ignored');
  assert.equal(draft().partialFailure, false);
  assert.equal(draft().saving, false);
  assert.match(setup.failureMessage(item), /retry|erneut/i);

  props.save = async (_id, status, response) => {
    props.items = [{ ...item, status, response, reviewId: 'review-2', included: false }];
    await nextTick();
    return true;
  };
  await nextTick();
  assert.equal(await setup.save(item), true);
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().savedStatus, 'ignored');
  assert.equal(draft().failed, false);
  assert.equal(draft().reviewId, 'review-2');
});

test('a failed feedback cancellation preserves the ignored review and retries cancellation directly', async t => {
  const { props, setup, item, draft } = mount(t);
  props.save = async (_id, status, response) => {
    props.items = [{ ...item, status, response, reviewId: 'review-2', included: false }];
    await nextTick();
    return false;
  };
  await nextTick();
  assert.equal(await setup.selectStatus(item, 'ignored'), false);
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().reviewId, 'review-2');
  assert.equal(draft().failed, true);
  assert.equal(draft().partialFailure, true);
  assert.match(setup.failureMessage(item), /previous feedback could not be cancelled/);
  let previousReview: string | null = null;
  props.save = async (_id, status, response, reviewId) => {
    assert.equal(status, 'ignored');
    assert.equal(response, 'Saved answer.');
    previousReview = reviewId;
    return true;
  };
  await nextTick();
  assert.equal(await setup.save(item), true);
  assert.equal(previousReview, 'review-2');
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().failed, false);
  assert.equal(draft().partialFailure, false);
});

test('a rejected save retains the response and exits the saving state with a recovery message', async t => {
  const { props, setup, item, draft } = mount(t);
  props.save = async () => { throw { message: 'Synthetic network failure' }; };
  await nextTick();
  draft().response = 'Keep this answer.';
  await setup.selectStatus(item, 'ignored');
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().savedStatus, 'resolved');
  assert.equal(draft().response, 'Keep this answer.');
  assert.equal(draft().failed, true);
  assert.equal(draft().saving, false);
  assert.doesNotMatch(setup.failureMessage(item), /\[object Object\]/);
});

test('typing keeps even open responses local until an explicit commit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { props, setup, item, draft } = mount(t);
  const writes: string[] = [];
  props.save = async (_id, status, response) => {
    writes.push(response);
    props.items = [{ ...item, status, response, reviewId: 'review-2' }];
    await nextTick();
    return true;
  };
  draft().status = 'open';
  draft().response = 'A draft answer without resolving the question.';
  await nextTick();
  t.mock.timers.tick(60_000);
  await nextTick();
  assert.deepEqual(writes, []);
  await setup.save(item);
  assert.deepEqual(writes, ['A draft answer without resolving the question.']);
  assert.equal(draft().status, 'open');
});

test('a completed request preserves newer typing and waits for its own commit', async t => {
  const { props, setup, item, draft } = mount(t);
  const writes: string[] = [];
  let finish!: () => void;
  props.save = async (_id, status, response) => {
    writes.push(response);
    await new Promise<void>(resolve => { finish = resolve; });
    props.items = [{ ...item, status, response, reviewId: 'review-' + (writes.length + 1) }];
    await nextTick();
    return true;
  };
  await nextTick();
  draft().response = 'First committed response.';
  const first = setup.save(item);
  draft().response = 'Newer typing remains local.';
  finish(); await first; await nextTick();
  assert.equal(draft().response, 'Newer typing remains local.');
  assert.equal(draft().reviewId, 'review-2');
  assert.deepEqual(writes, ['First committed response.']);
  const second = setup.flush();
  finish();
  assert.equal(await second, true);
  assert.deepEqual(writes, ['First committed response.', 'Newer typing remains local.']);
});

test('queued commits capture their exact snapshots and deduplicate repeated commits', async t => {
  const { props, setup, item, draft } = mount(t);
  const writes: { response: string; reviewId: string | null }[] = [];
  let finish!: () => void;
  props.save = async (_id, status, response, reviewId) => {
    writes.push({ response, reviewId });
    await new Promise<void>(resolve => { finish = resolve; });
    props.items = [{ ...item, status, response, reviewId: 'review-' + (writes.length + 1) }];
    await nextTick();
    return true;
  };
  await nextTick();
  draft().response = 'First snapshot.';
  const first = setup.save(item), duplicate = setup.save(item);
  assert.equal(first, duplicate);
  draft().response = 'Second snapshot.';
  const second = setup.save(item);
  draft().response = 'Uncommitted third draft.';
  finish(); await first; await nextTick();
  assert.deepEqual(writes, [{ response: 'First snapshot.', reviewId: 'review-1' }, { response: 'Second snapshot.', reviewId: 'review-2' }]);
  finish(); await second; await nextTick();
  assert.equal(draft().response, 'Uncommitted third draft.');
  assert.equal(draft().reviewId, 'review-3');
  assert.equal(writes.length, 2);
});

test('a raw commit made while busy retains its captured text until saving becomes available', async t => {
  const { props, setup, item, draft } = mount(t);
  const writes: string[] = [];
  props.busy = true;
  props.save = async (_id, status, response) => {
    writes.push(response);
    props.items = [{ ...item, status, response, reviewId: 'review-2' }];
    await nextTick(); return true;
  };
  await nextTick();
  draft().response = 'Commit before another operation finishes.';
  const saving = setup.save(item);
  draft().response = 'Typed while waiting.';
  await nextTick(); assert.deepEqual(writes, []);
  props.busy = false;
  await nextTick(); await saving;
  assert.deepEqual(writes, ['Commit before another operation finishes.']);
  assert.equal(draft().response, 'Typed while waiting.');
});

test('committing a newly written nonblank answer resolves an open question once', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  await nextTick();
  draft().response = 'I used controlled experiments.';
  assert.equal(draft().status, 'open', 'typing does not infer or save a status');

  assert.equal(await setup.commitAnswer(item), true);

  assert.deepEqual(writes, [{ status: 'resolved', response: 'I used controlled experiments.', reviewId: 'review-1' }]);
  assert.equal(draft().status, 'resolved');
  assert.equal(draft().savedStatus, 'resolved');
  assert.equal(draft().committedResponse, draft().response);
  assert.equal(await setup.commitAnswer(item), true);
  assert.equal(await setup.flush(), true);
  assert.equal(writes.length, 1, 'repeated blur and owner flush do not resave an acknowledged answer');
});

test('unchanged legacy open answers remain open on blur and raw owner flush', async t => {
  const fixture = mount(t, { status: 'open', response: 'An older answer deliberately left open.', included: false });
  const { setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  await nextTick();

  assert.equal(await setup.flush(), true);
  assert.equal(await setup.commitAnswer(item), true);

  assert.equal(draft().status, 'open');
  assert.equal(writes.length, 0);
  draft().response = 'An older answer with a deliberate new correction.';
  assert.equal(await setup.commitAnswer(item), true);
  assert.equal(draft().status, 'resolved');
  assert.equal(writes[0].status, 'resolved');
});

for (const status of ['resolved', 'ignored'] as const) for (const cleared of ['', '  \n\t  ']) test(`committing ${cleared ? 'whitespace-only' : 'empty'} replacement text reopens an ${status} answer`, async t => {
  const fixture = mount(t, { status });
  const { setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  await nextTick();
  draft().response = cleared;

  assert.equal(await setup.commitAnswer(item), true);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 'open');
  assert.equal(draft().status, 'open');
  assert.equal(draft().response, '');
  assert.equal(await setup.commitAnswer(item), true);
  assert.equal(writes.length, 1);
});

test('ignored remains sticky across nonempty answer edits until explicitly resolved', async t => {
  const fixture = mount(t, { status: 'ignored', included: false });
  const { setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  await nextTick();
  draft().response = 'A preserved answer on an ignored question.';
  await setup.commitAnswer(item);
  draft().response = 'Another nonempty answer on an ignored question.';
  await setup.commitAnswer(item);

  assert.deepEqual(writes.map(write => write.status), ['ignored', 'ignored']);
  assert.equal(draft().status, 'ignored');
  assert.equal(await setup.selectStatus(item, 'resolved'), true);
  assert.equal(draft().status, 'resolved');
  assert.equal(draft().response, 'Another nonempty answer on an ignored question.');
  assert.equal(await setup.commitAnswer(item), true);
  assert.equal(draft().status, 'resolved', 'an unchanged nonempty answer does not undo explicit resolution');
  assert.equal(writes.length, 3);
});

test('explicit resolution without an answer survives unchanged flush but saving the empty field reopens it', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  await nextTick();

  assert.equal(await setup.selectStatus(item, 'resolved'), true);
  assert.equal(await setup.flush(), true);
  assert.equal(draft().status, 'resolved');
  assert.equal(await setup.commitAnswer(item), true);
  assert.equal(await setup.flush(), true);

  assert.equal(draft().status, 'open');
  assert.deepEqual(writes.map(write => ({ status: write.status, response: write.response })), [{ status: 'resolved', response: '' }, { status: 'open', response: '' }]);
});

test('a slow answer save lets Ignore queue behind it with its exact response and acknowledged review', async t => {
  const { props, setup, item, draft } = mount(t, { status: 'open', response: null, included: false });
  const writes: { status: AnnotationStatus; response: string; reviewId: string | null }[] = [];
  let finish!: () => void;
  props.save = async (_id, status, response, reviewId) => {
    props.busy = true;
    writes.push({ status, response, reviewId });
    await new Promise<void>(resolve => { finish = resolve; });
    props.items = [{ ...item, status, response, reviewId: 'review-' + (writes.length + 1) }];
    props.busy = false;
    await nextTick();
    return true;
  };
  await nextTick();
  draft().response = 'The answer submitted before ignoring.';
  const answer = setup.commitAnswer(item);
  await nextTick();
  assert.equal(props.busy, true);
  assert.equal(setup.controlsDisabled, false, 'this component’s active save does not lock out an explicit status choice');
  const ignore = setup.selectStatus(item, 'ignored');
  draft().response = 'Newer uncommitted typing must not enter the queued ignore.';

  finish(); assert.equal(await answer, true); await nextTick();

  assert.deepEqual(writes, [
    { status: 'resolved', response: 'The answer submitted before ignoring.', reviewId: 'review-1' },
    { status: 'ignored', response: 'The answer submitted before ignoring.', reviewId: 'review-2' },
  ]);
  assert.equal(draft().status, 'ignored');
  finish(); assert.equal(await ignore, true); await nextTick();
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().response, 'Newer uncommitted typing must not enter the queued ignore.');
  assert.equal(draft().savedResponse, 'The answer submitted before ignoring.');
});

test('privacy-transformed acknowledgements are committed answers rather than new user edits', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { props, setup, item, draft } = fixture;
  props.privacyPreview = value => value.replaceAll('PRIVATE', '[masked]');
  const writes = acknowledgeSaves(fixture);
  await nextTick();
  draft().response = '  PRIVATE methods answer.  ';

  assert.equal(await setup.commitAnswer(item), true);

  assert.equal(draft().response, '[masked] methods answer.');
  assert.equal(draft().savedResponse, '[masked] methods answer.');
  assert.equal(draft().committedResponse, '[masked] methods answer.');
  assert.equal(await setup.commitAnswer(item), true);
  assert.equal(await setup.flush(), true);
  assert.equal(writes.length, 1);
});

test('a newer remote review blocks answer commits without replacing the retained local draft', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { props, setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  draft().response = 'My unsaved answer must remain here.';
  props.items = [{ ...item, status: 'ignored', response: 'A remote answer.', reviewId: 'remote-review' }];
  await nextTick();

  assert.equal(await setup.commitAnswer(item), false);

  assert.deepEqual(writes, []);
  assert.equal(draft().response, 'My unsaved answer must remain here.');
  assert.equal(draft().reviewId, 'review-1');
  assert.equal(draft().savedResponse, '');
  assert.equal(await setup.flush(), false);
});

test('failed automatic resolution retains its intended status and can retry with raw save', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { setup, item, draft } = fixture;
  draft().response = 'My answer should resolve this question.';

  assert.equal(await setup.commitAnswer(item), false);

  assert.equal(draft().status, 'resolved');
  assert.equal(draft().savedStatus, 'open');
  assert.equal(draft().failed, true);
  const writes = acknowledgeSaves(fixture);
  await nextTick();
  assert.equal(await setup.save(item), true);
  assert.deepEqual(writes, [{ status: 'resolved', response: 'My answer should resolve this question.', reviewId: 'review-1' }]);
  assert.equal(draft().failed, false);
  assert.equal(draft().savedStatus, 'resolved');
});

test('hard disabled rejects answer/status edits and raw dirty saves while clean flush is a no-op', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { props, setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  props.disabled = true; await nextTick();
  assert.equal(setup.controlsDisabled, true);
  assert.equal(await setup.flush(), true);
  draft().response = 'A retained draft in a read-only view.';

  assert.equal(await setup.commitAnswer(item), false);
  assert.equal(await setup.selectStatus(item, 'ignored'), false);
  assert.equal(await setup.save(item), false);

  assert.equal(draft().status, 'open');
  assert.equal(draft().committedResponse, '');
  assert.deepEqual(writes, []);
  props.disabled = false; await nextTick();
  assert.deepEqual(writes, [], 'hard-disabled calls cannot leave a hidden queued mutation');
});

test('an unrelated busy operation disables controls until it finishes', async t => {
  const { props, setup } = mount(t);
  props.busy = true; await nextTick();
  assert.equal(setup.controlsDisabled, true);
  props.busy = false; await nextTick();
  assert.equal(setup.controlsDisabled, false);
});

test('choosing Ignore publishes a pending textarea answer before capturing the explicit status', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  let pending = true;
  const unregister = registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    draft().response = 'The textarea draft at the time Ignore was clicked.';
    void setup.commitAnswer(item);
  });
  t.after(unregister);
  await nextTick();

  assert.equal(await setup.selectStatus(item, 'ignored'), true);

  assert.equal(pending, false);
  assert.equal(draft().status, 'ignored');
  assert.equal(writes.at(-1)!.status, 'ignored');
  assert.equal(writes.at(-1)!.response, 'The textarea draft at the time Ignore was clicked.');
});

test('owner flush publishes a pending textarea commit and waits for its inferred resolved status', async t => {
  const fixture = mount(t, { status: 'open', response: null, included: false });
  const { setup, item, draft } = fixture;
  const writes = acknowledgeSaves(fixture);
  let pending = true;
  const unregister = registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    draft().response = 'The last draft before navigating away.';
    void setup.commitAnswer(item);
  });
  t.after(unregister);
  await nextTick();

  assert.equal(await setup.flush(), true);

  assert.equal(pending, false);
  assert.equal(draft().savedStatus, 'resolved');
  assert.equal(draft().failed, false);
  assert.deepEqual(writes, [{ status: 'resolved', response: 'The last draft before navigating away.', reviewId: 'review-1' }]);
});
