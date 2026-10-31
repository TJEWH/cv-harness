import type { OpportunityGraphLayoutRequest, OpportunityGraphLayoutResponse } from './opportunityGraphLayout';
import type { OpportunityInsightJob, OpportunityInsightTopicNode } from './opportunityInsights';
import type { OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';

export interface OpportunityJobHierarchyInput {
  jobs: readonly OpportunityInsightJob[];
  topics: readonly OpportunityInsightTopicNode[];
  minimumInterest?: number;
  clusterCount?: number;
  excludedTopicIds?: readonly string[];
}

let generation = 0;
const failedHierarchy = () => new Error('Could not prepare the job hierarchy. Try again.');
const abortedHierarchy = () => new DOMException('The operation was aborted.', 'AbortError');

function hierarchyFrom(response: OpportunityGraphLayoutResponse): OpportunityTopicHierarchyNode[] {
  if ('error' in response || !Array.isArray(response.hierarchy)) throw failedHierarchy();
  return response.hierarchy;
}

/** Computes the same balanced groups and within-group trees as the explorer. */
export async function loadOpportunityJobHierarchy(
  input: OpportunityJobHierarchyInput, signal?: AbortSignal,
): Promise<OpportunityTopicHierarchyNode[]> {
  if (signal?.aborted) throw abortedHierarchy();
  const request: OpportunityGraphLayoutRequest = {
    generation: ++generation, view: 'hierarchy', dimensions: 2, entityKind: 'job', nodes: [], links: [],
    // Vue-held arrays/records must become plain, independent structured-clone data.
    jobs: input.jobs.map(job => ({ ...job, topicIds: [...job.topicIds], avoidedTopicIds: [...job.avoidedTopicIds],
      reasons: job.reasons.map(reason => ({ ...reason })) })),
    jobTopics: input.topics.map(topic => ({ ...topic })),
    jobMinimumInterest: input.minimumInterest, jobClusterCount: input.clusterCount,
    jobExcludedTopicIds: [...(input.excludedTopicIds ?? [])],
  };

  if (typeof Worker === 'undefined') {
    const nodeRuntime = typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node;
    if (!nodeRuntime) throw failedHierarchy();
    // Domain tests/SSR have no Web Worker. Never run this expensive fallback in a browser.
    const { runOpportunityGraphTask } = await import('./opportunityGraphTask');
    if (signal?.aborted) throw abortedHierarchy();
    const result = runOpportunityGraphTask(request);
    if (signal?.aborted) throw abortedHierarchy();
    return hierarchyFrom(result);
  }

  return new Promise((resolve, reject) => {
    let worker: Worker | null = null, settled = false, listening = !!signal;
    const cleanup = () => {
      if (listening) { signal!.removeEventListener('abort', abort); listening = false; }
      if (!worker) return;
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate(); worker = null;
    };
    const finish = (result: OpportunityTopicHierarchyNode[] | Error) => {
      if (settled) return;
      settled = true; cleanup();
      if (result instanceof Error) reject(result); else resolve(result);
    };
    const abort = () => finish(abortedHierarchy());
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) { abort(); return; }
      worker = new Worker(new URL('../workers/opportunityGraph.worker.ts', import.meta.url), { type: 'module' });
      // Also cover a signal aborted synchronously while a Worker implementation starts.
      if (settled) { cleanup(); return; }
      worker.onmessage = ({ data }: MessageEvent<OpportunityGraphLayoutResponse>) => {
        if (settled || !data || data.generation !== request.generation) return;
        try { finish(hierarchyFrom(data)); } catch { finish(failedHierarchy()); }
      };
      worker.onerror = event => { event.preventDefault(); finish(failedHierarchy()); };
      worker.onmessageerror = () => finish(failedHierarchy());
      worker.postMessage(request);
    } catch { finish(failedHierarchy()); }
  });
}
