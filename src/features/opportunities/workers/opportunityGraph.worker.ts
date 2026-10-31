import type { OpportunityGraphLayoutRequest, OpportunityGraphLayoutResponse } from '../domain/opportunityGraphLayout';
import { runOpportunityGraphTask } from '../domain/opportunityGraphTask';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<OpportunityGraphLayoutRequest>) => void) | null;
  postMessage(value: OpportunityGraphLayoutResponse, transfer?: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
  try {
    const result = runOpportunityGraphTask(data);
    scope.postMessage(result, 'graph' in result && result.graph ? [result.graph.adjacency.bits.buffer] : []);
  }
  catch { scope.postMessage({ generation: data.generation, error: true }); }
};
