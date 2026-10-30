import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfRenderTask, createPreviewRenderSlot } from '../src/documents/pdf/pdfRenderTask.ts';

test('render batches yield to input only after their time budget', async () => {
  let time = 0;
  let yields = 0;
  const task = createPdfRenderTask(undefined, {
    now: () => time,
    yieldTurn: async () => { yields++; },
  });
  assert.equal(task.checkpoint(), undefined);
  time = 7;
  await task.checkpoint();
  assert.equal(yields, 1);
  assert.equal(task.checkpoint(), undefined);
  await task.checkpoint(true);
  assert.equal(yields, 2);
  task.dispose();
});

test('a newer preview aborts the previous render at its next checkpoint', async () => {
  const slot = createPreviewRenderSlot();
  const oldSignal = slot.start();
  let resume!: () => void;
  const task = createPdfRenderTask(oldSignal, { yieldTurn: () => new Promise<void>(resolve => { resume = resolve; }) });
  const paused = task.checkpoint(true);
  const latestSignal = slot.start();
  resume();
  await assert.rejects(paused!, { name: 'AbortError' });
  assert.equal(latestSignal.aborted, false);
  assert.throws(() => task.checkpoint(), { name: 'AbortError' });
  slot.cancel();
  assert.equal(latestSignal.aborted, true);
});

test('canceling releases private DOM immediately, including resources created late', async () => {
  const controller = new AbortController();
  const task = createPdfRenderTask(controller.signal);
  let removed = 0;
  task.own({ remove() { removed++; } });
  const waiting = task.wait(new Promise(() => {}));
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(removed, 1);
  task.own({ remove() { removed++; } });
  task.dispose();
  assert.equal(removed, 2);
});

test('successful and failed async stages retain their results', async () => {
  const controller = new AbortController();
  const task = createPdfRenderTask(controller.signal);
  assert.equal(await task.wait(Promise.resolve(42)), 42);
  await assert.rejects(task.wait(Promise.reject(new Error('encoding failed'))), /encoding failed/);
  task.dispose();
});
