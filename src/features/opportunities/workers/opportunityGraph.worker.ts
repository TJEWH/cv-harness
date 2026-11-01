import type { OpportunityGraphLayoutRequest, OpportunityGraphLayoutResponse } from '../domain/opportunityGraphLayout';
import { runOpportunityGraphTask } from '../domain/opportunityGraphTask';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<OpportunityGraphLayoutRequest>) => void) | null;
  postMessage(value: OpportunityGraphLayoutResponse, transfer?: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
  try {
    const result = runOpportunityGraphTask(data);
    const transfer: Transferable[] = [];
    if ('graph' in result && result.graph) transfer.push(result.graph.adjacency.bits.buffer);
    if ('bundling' in result && result.bundling) transfer.push(result.bundling.adjacency.bits.buffer);
    scope.postMessage(result, transfer);
  }
  catch { scope.postMessage({ generation: data.generation, error: true }); }
};
