import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { idle, mount, prepare, type Workspace } from '../../support/workflows/refinement';

type CopyWorkspace = Workspace & { shortInstructionError: string; shortInstructionNotice: string; shortInstruction: string };
class TestClipboardItem {
  constructor(readonly content: Record<string, Promise<Blob>>) {}
}
function gestureClipboard(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: TestClipboardItem });
  t.after(() => previous ? Object.defineProperty(globalThis, 'ClipboardItem', previous) : Reflect.deleteProperty(globalThis, 'ClipboardItem'));
  let inClick = false, calls = 0;
  const copied: string[] = [];
  Object.assign(navigator.clipboard, { write: async (items: TestClipboardItem[]) => {
    assert.equal(inClick, true, 'starting the clipboard write must not wait for save/publication');
    calls++;
    copied.push(await (await items[0].content['text/plain']).text());
  } });
  navigator.clipboard.writeText = async value => {
    assert.equal(inClick, true, 'a direct retry must stay in its fresh click gesture');
    copied.push(value);
  };
  return { copied, get calls() { return calls; }, click(action: () => Promise<void>) {
    inClick = true;
    try { return action(); } finally { inClick = false; }
  } };
}

for (const scope of ['cv', 'letter'] as const) {
  for (const phase of ['initial', 'after proposal', 'after answers'] as const) {
    test(`${scope} Copy task/feedback retains its click gesture ${phase}`, async t => {
      const fixture = mount(t);
      const setup = await prepare(fixture, 'base', { scope }) as CopyWorkspace;
      const first = setup.requests[0].id;
      if (phase !== 'initial') {
        fixture.cloud.seedProposal(first);
        await setup.syncRefinement(); await idle(setup);
        if (phase === 'after answers') {
          assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'I used calibrated sensing and repeatability tests.', null), true);
        }
        setup.iterationNotes[scope].content = 'Keep the measured results.';
      }
      const clipboard = gestureClipboard(t);

      const copying = clipboard.click(() => setup.copyIterationTask());
      assert.equal(clipboard.calls, 1);
      assert.equal(clipboard.copied.length, 0, 'no instruction is copied until publication succeeds');
      await copying;

      assert.equal(setup.error, '');
      assert.equal(setup.shortInstructionError, '');
      assert.ok(setup.shortInstructionNotice);
      assert.deepEqual(clipboard.copied, [setup.shortInstruction]);
      const request = setup.requests[0].request_json;
      assert.ok(clipboard.copied[0].includes(request.requestId));
      if (phase !== 'initial') assert.notEqual(request.requestId, first);
      if (phase === 'after answers') assert.ok(request.feedback.some(item => item.text.includes('calibrated sensing and repeatability tests')));
    });
  }
}

test('a failed feedback publication leaves the clipboard unchanged instead of copying the previous request', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' }) as CopyWorkspace;
  const previousRequest = setup.requests[0].id;
  setup.iterationNotes.cv.content = 'Emphasize repeatability.';
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => name === 'publish_refinement_request'
    ? { data: null, error: new Error('Publication unavailable') } : rpc(name, args)) as unknown as typeof fixture.cloud.client.rpc;
  const clipboard = gestureClipboard(t);

  await clipboard.click(() => setup.copyIterationTask());

  assert.match(setup.error, /Publication unavailable/);
  assert.deepEqual(clipboard.copied, []);
  assert.equal(setup.requests[0].id, previousRequest);
  assert.equal(setup.shortInstructionError, '', 'show the publication failure, not a misleading clipboard error');
});

test('direct copy retry uses a fresh gesture without saving notes or publishing another round', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' }) as CopyWorkspace;
  setup.iterationNotes.letter.content = 'Keep the measured results.';
  navigator.clipboard.writeText = async () => { throw new Error('User gesture expired'); };
  await setup.copyIterationTask();
  assert.match(setup.shortInstructionError, /Copy unavailable/);
  const saved = JSON.stringify(fixture.database);
  const clipboard = gestureClipboard(t);

  await clipboard.click(() => setup.copyTask());

  assert.equal(setup.error, '');
  assert.equal(setup.shortInstructionError, '');
  assert.deepEqual(clipboard.copied, [setup.shortInstruction]);
  assert.equal(JSON.stringify(fixture.database), saved);
});
