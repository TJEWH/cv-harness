import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { reactive } from 'vue';
import { loadOpportunityJobHierarchy, type OpportunityJobHierarchyInput } from '../src/features/opportunities/domain/opportunityJobClusteringTask';
import { runOpportunityGraphTask } from '../src/features/opportunities/domain/opportunityGraphTask';
import type { OpportunityGraphLayoutRequest, OpportunityGraphLayoutResponse } from '../src/features/opportunities/domain/opportunityGraphLayout';
import type { OpportunityInsightJob, OpportunityInsightTopicNode } from '../src/features/opportunities/domain/opportunityInsights';
import type { OpportunityTopicHierarchyNode } from '../src/features/opportunities/domain/opportunityTopicHierarchy';

const job = (id: string, topicIds: string[], interestScore = 9): OpportunityInsightJob => ({
  id, title: `Job ${id}`, institution: null, country: null, addedAt: null, currentFit: 8, interestScore,
  explicitInterest: true, highInterest: interestScore >= 8, mismatch: false, topicIds, avoidedTopicIds: [],
  reasons: [{ category: 'topic', polarity: 'positive', target: topicIds[0] }],
});
const topic = (id: string): OpportunityInsightTopicNode => ({ id, label: id, highInterestCount: 1,
  reviewedCount: 1, jobCount: 1, lowInterestCount: 0, avoidedCount: 0, positiveReasonCount: 1 });
const leaf = (id: string): OpportunityTopicHierarchyNode => ({ id: `job:${id}`, topicId: `job:${id}`,
  label: `Job ${id}`, count: 1, affinity: 1, children: null });

function setGlobal(t: TestContext, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
}

function workerHarness(t: TestContext, failure?: 'constructor' | 'postMessage') {
  const channel = new MessageChannel();
  t.after(() => { channel.port1.close(); channel.port2.close(); });
  const clone = <T>(value: T): T => {
    channel.port1.postMessage(value);
    const received = receiveMessageOnPort(channel.port2);
    assert(received, 'the actual MessagePort accepted the complete structured-clone payload');
    return received.message as T;
  };
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpportunityGraphLayoutResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    requests: OpportunityGraphLayoutRequest[] = [];
    terminateCount = 0;
    constructor(readonly url: URL, readonly options: WorkerOptions) {
      if (failure === 'constructor') throw new Error('Worker construction failed');
      workers.push(this);
    }
    postMessage(request: OpportunityGraphLayoutRequest) {
      if (failure === 'postMessage') throw new Error('Worker postMessage failed');
      this.requests.push(clone(request));
    }
    respond(response: OpportunityGraphLayoutResponse) { this.onmessage?.(new MessageEvent('message', { data: clone(response) })); }
    terminate() { this.terminateCount++; }
  }
  setGlobal(t, 'Worker', FakeWorker);
  setGlobal(t, 'window', {});
  return workers;
}

function trackAbort(t: TestContext, controller = new AbortController()) {
  return { controller, signal: controller.signal,
    added: t.mock.method(controller.signal, 'addEventListener'), removed: t.mock.method(controller.signal, 'removeEventListener') };
}

function members(node: OpportunityTopicHierarchyNode): string[] {
  return node.children ? node.children.flatMap(members).sort() : [node.topicId!];
}

test('hierarchy task sends cloneable reactive snapshots through the existing worker and cleans up success once', async t => {
  const workers = workerHarness(t), abort = trackAbort(t);
  const input = reactive<OpportunityJobHierarchyInput>({ jobs: [job('a', ['Acoustics', 'Research']), job('b', ['Acoustics'])],
    topics: [topic('Acoustics'), topic('Research')], minimumInterest: 7, clusterCount: 1, excludedTopicIds: ['Research'] });
  const before = JSON.parse(JSON.stringify(input));
  const pending = loadOpportunityJobHierarchy(input, abort.signal), worker = workers[0]!;
  assert.equal(workers.length, 1);
  assert(worker.url.pathname.endsWith('/workers/opportunityGraph.worker.ts'));
  assert.deepEqual(worker.options, { type: 'module' });
  assert.equal(worker.requests.length, 1);
  const request = worker.requests[0]!;
  assert.equal(request.view, 'hierarchy'); assert.equal(request.dimensions, 2); assert.equal(request.entityKind, 'job');
  assert.deepEqual(request.nodes, []); assert.deepEqual(request.links, []);
  assert.deepEqual(request.jobs, before.jobs); assert.deepEqual(request.jobTopics, before.topics);
  assert.deepEqual(request.jobExcludedTopicIds, ['Research']);
  assert.equal(request.jobMinimumInterest, 7); assert.equal(request.jobClusterCount, 1);
  assert(!('previous' in request), 'copying a hierarchy does not request a graph layout');
  assert.deepEqual(JSON.parse(JSON.stringify(input)), before, 'capturing the request leaves complete job context unchanged');
  const response = runOpportunityGraphTask(request);
  assert(!('error' in response)); assert.deepEqual(response.positions, []);
  const lateMessage = worker.onmessage;
  worker.respond(response);
  assert.deepEqual(await pending, response.hierarchy);
  assert.equal(worker.terminateCount, 1);
  assert.equal(worker.onmessage, null); assert.equal(worker.onerror, null); assert.equal(worker.onmessageerror, null);
  assert.equal(abort.added.mock.callCount(), 1); assert.equal(abort.removed.mock.callCount(), 1);
  assert.equal(abort.added.mock.calls[0]!.arguments[1], abort.removed.mock.calls[0]!.arguments[1]);
  lateMessage?.(new MessageEvent('message', { data: response }));
  abort.controller.abort();
  assert.equal(worker.terminateCount, 1); assert.equal(abort.removed.mock.callCount(), 1);
});

test('a pre-aborted hierarchy task creates no worker or abort listener', async t => {
  const workers = workerHarness(t), abort = trackAbort(t);
  abort.controller.abort();
  await assert.rejects(loadOpportunityJobHierarchy({ jobs: [], topics: [] }, abort.signal), { name: 'AbortError' });
  assert.equal(workers.length, 0);
  assert.equal(abort.added.mock.callCount(), 0); assert.equal(abort.removed.mock.callCount(), 0);
});

test('aborting a computing hierarchy terminates its worker and ignores late replies and errors', async t => {
  const workers = workerHarness(t), abort = trackAbort(t);
  const pending = loadOpportunityJobHierarchy({ jobs: [job('a', ['topic'])], topics: [] }, abort.signal);
  const worker = workers[0]!, lateMessage = worker.onmessage, lateError = worker.onerror;
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  abort.controller.abort(); await rejected;
  lateMessage?.(new MessageEvent('message', { data: { generation: worker.requests[0]!.generation, positions: [], hierarchy: [leaf('a')] } }));
  lateError?.(new Event('error') as ErrorEvent);
  assert.equal(worker.terminateCount, 1);
  assert.equal(worker.onmessage, null); assert.equal(worker.onerror, null); assert.equal(worker.onmessageerror, null);
  assert.equal(abort.removed.mock.callCount(), 1);
});

test('concurrent hierarchy requests accept only their own generation', async t => {
  const workers = workerHarness(t), firstAbort = trackAbort(t), secondAbort = trackAbort(t);
  let firstSettled = false, secondSettled = false;
  const first = loadOpportunityJobHierarchy({ jobs: [job('a', ['one'])], topics: [] }, firstAbort.signal);
  const second = loadOpportunityJobHierarchy({ jobs: [job('b', ['two'])], topics: [] }, secondAbort.signal);
  void first.then(() => { firstSettled = true; }); void second.then(() => { secondSettled = true; });
  const a = workers[0]!, b = workers[1]!, aGeneration = a.requests[0]!.generation, bGeneration = b.requests[0]!.generation;
  assert.notEqual(aGeneration, bGeneration);
  a.respond({ generation: bGeneration, positions: [], hierarchy: [leaf('b')] });
  b.respond({ generation: aGeneration, error: true });
  await Promise.resolve();
  assert.equal(firstSettled, false); assert.equal(secondSettled, false);
  assert.equal(a.terminateCount, 0); assert.equal(b.terminateCount, 0);
  a.respond({ generation: aGeneration, positions: [], hierarchy: [leaf('a')] });
  b.respond({ generation: bGeneration, positions: [], hierarchy: [leaf('b')] });
  assert.deepEqual(await first, [leaf('a')]); assert.deepEqual(await second, [leaf('b')]);
  assert.equal(a.terminateCount, 1); assert.equal(b.terminateCount, 1);
  assert.equal(firstAbort.removed.mock.callCount(), 1); assert.equal(secondAbort.removed.mock.callCount(), 1);
});

test('worker computation, transport, construction, and posting failures reject recoverably and clean up once', async t => {
  for (const failure of ['response', 'runtime', 'message', 'missing hierarchy', 'constructor', 'postMessage'] as const) {
    await t.test(failure, async t => {
      const workers = workerHarness(t, failure === 'constructor' || failure === 'postMessage' ? failure : undefined), abort = trackAbort(t);
      const pending = loadOpportunityJobHierarchy({ jobs: [], topics: [] }, abort.signal);
      const rejected = assert.rejects(pending, /Could not prepare the job hierarchy\. Try again\./);
      const worker = workers[0];
      if (worker && failure !== 'postMessage') {
        if (failure === 'response') worker.respond({ generation: worker.requests[0]!.generation, error: true });
        if (failure === 'missing hierarchy') worker.respond({ generation: worker.requests[0]!.generation, positions: [] });
        if (failure === 'runtime') {
          const event = new Event('error', { cancelable: true });
          worker.onerror?.(event as ErrorEvent); assert.equal(event.defaultPrevented, true);
        }
        if (failure === 'message') worker.onmessageerror?.(new MessageEvent('messageerror'));
      }
      await rejected;
      assert.equal(abort.added.mock.callCount(), 1); assert.equal(abort.removed.mock.callCount(), 1);
      if (worker) {
        assert.equal(worker.terminateCount, 1);
        assert.equal(worker.onmessage, null); assert.equal(worker.onerror, null); assert.equal(worker.onmessageerror, null);
      }
      abort.controller.abort();
      assert.equal(abort.removed.mock.callCount(), 1);
    });
  }
});

test('a browser without Worker rejects instead of running clustering on its main thread', async t => {
  setGlobal(t, 'Worker', undefined); setGlobal(t, 'window', {});
  await assert.rejects(loadOpportunityJobHierarchy({ jobs: [job('a', ['topic'])], topics: [] }), /Could not prepare the job hierarchy/);
});

test('the no-Worker Node fallback matches the actual balanced hierarchy algorithm and all controls', async t => {
  setGlobal(t, 'Worker', undefined); setGlobal(t, 'window', undefined);
  const jobs = Array.from({ length: 10 }, (_, index) => job(String(index), ['generic', index < 4 ? 'Acoustics' : 'Biology'], index < 7 ? 9 : 6));
  const topics = ['generic', 'Acoustics', 'Biology'].map(topic), before = structuredClone(jobs);
  const input = { jobs, topics, minimumInterest: 8, clusterCount: 3, excludedTopicIds: ['generic'] };
  const expected = runOpportunityGraphTask({ generation: 0, view: 'hierarchy', dimensions: 2, nodes: [], links: [], jobs,
    jobTopics: topics, jobMinimumInterest: input.minimumInterest, jobClusterCount: input.clusterCount, jobExcludedTopicIds: input.excludedTopicIds });
  assert(!('error' in expected)); assert.deepEqual(expected.positions, []);
  const actual = await loadOpportunityJobHierarchy(input);
  assert.deepEqual(actual, expected.hierarchy);
  assert.deepEqual(actual.map(node => node.count).sort(), [2, 2, 3]);
  assert.deepEqual(actual.flatMap(members).sort(), jobs.slice(0, 7).map(row => `job:${row.id}`).sort());
  assert(actual.every(node => !node.sharedTopicIds?.includes('generic')));
  assert.deepEqual(jobs, before);
  assert.deepEqual(await loadOpportunityJobHierarchy({ jobs: [], topics: [] }), []);
});

test('the Node fallback honors cancellation before its lazy import completes', async t => {
  setGlobal(t, 'Worker', undefined); setGlobal(t, 'window', undefined);
  const controller = new AbortController();
  const pending = loadOpportunityJobHierarchy({ jobs: [job('a', ['topic'])], topics: [] }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
