import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { copyPreparedText } from '../../../src/shared/lib/preparedClipboard';

class TestClipboardItem {
  constructor(readonly content: Record<string, Promise<Blob>>) {}
}
function clipboardFixture(t: TestContext, clipboard: object, modern = true) {
  for (const [key, value] of Object.entries({ navigator: { clipboard }, ClipboardItem: modern ? TestClipboardItem : undefined })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : Reflect.deleteProperty(globalThis, key));
  }
}

test('reserves the clipboard during the click, but copies only the successfully prepared instruction', async t => {
  let inClick = true, resolve!: (value: string) => void, writes = 0;
  const copied: string[] = [];
  clipboardFixture(t, { write: async (items: TestClipboardItem[]) => {
    assert.equal(inClick, true, 'clipboard permission is requested before yielding the user gesture');
    writes++;
    const blob = await items[0].content['text/plain'];
    assert.equal(blob.type, 'text/plain');
    copied.push(await blob.text());
  } });
  const result = copyPreparedText(() => new Promise<string>(done => { resolve = done; }));
  inClick = false;
  assert.equal(writes, 1);
  assert.deepEqual(copied, []);
  resolve('Published request 2, including the saved answer.');
  assert.deepEqual(await result, { value: 'Published request 2, including the saved answer.', copied: true });
  assert.deepEqual(copied, ['Published request 2, including the saved answer.']);
});

test('failed or cancelled preparation does not overwrite clipboard contents', async t => {
  const copied: string[] = [];
  clipboardFixture(t, { write: async (items: TestClipboardItem[]) => {
    copied.push(await (await items[0].content['text/plain']).text());
  } });
  assert.equal(await copyPreparedText(async () => null), null);
  await assert.rejects(copyPreparedText(async () => { throw new Error('Publication failed'); }), /Publication failed/);
  assert.deepEqual(copied, []);
});

test('immediate clipboard denial still completes preparation and reports a retryable copy failure', async t => {
  let resolve!: (value: string) => void;
  clipboardFixture(t, { write: async () => { throw new Error('Permission denied'); } });
  const result = copyPreparedText(() => new Promise<string>(done => { resolve = done; }));
  await new Promise<void>(done => setImmediate(done));
  resolve('Saved instruction');
  assert.deepEqual(await result, { value: 'Saved instruction', copied: false });
});

test('immediate clipboard denial and failed preparation do not cause an unhandled content rejection', async t => {
  let reject!: (error: Error) => void;
  clipboardFixture(t, { write: async () => { throw new Error('Permission denied'); } });
  const result = copyPreparedText(() => new Promise<string>((_, fail) => { reject = fail; }));
  const failure = assert.rejects(result, /Publication failed/);
  await new Promise<void>(done => setImmediate(done));
  reject(new Error('Publication failed'));
  await failure;
  await new Promise<void>(done => setImmediate(done));
});

test('text-only browsers copy after preparation and expose permission failure for a direct retry', async t => {
  const copied: string[] = [];
  const clipboard = { writeText: async (value: string) => { copied.push(value); } };
  clipboardFixture(t, clipboard, false);
  assert.deepEqual(await copyPreparedText(async () => 'Saved instruction'), { value: 'Saved instruction', copied: true });
  assert.equal(await copyPreparedText(async () => null), null);
  clipboard.writeText = async () => { throw new Error('User gesture expired'); };
  assert.deepEqual(await copyPreparedText(async () => 'Saved instruction'), { value: 'Saved instruction', copied: false });
  assert.deepEqual(copied, ['Saved instruction']);
});
