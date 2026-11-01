import type { OpportunityInsightJob } from './opportunityInsights';
import type { OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';
import { opportunityJobsAtInterest } from './opportunityJobInterest';
import { opportunityTopicKey } from './opportunityTopics';
import { buildOpportunityEdgeBundling, type OpportunityBundlingDiagram, type OpportunityBundlingEdge, type OpportunityBundlingGroup,
  type OpportunityBundlingLeaf, type OpportunityEdgeBundlingOptions } from './opportunityEdgeBundling';

/** Job-specific aliases retain compatibility with the existing job view. */
export interface OpportunityJobBundlingLeaf extends OpportunityBundlingLeaf { jobId: string; topicCount: number }
export interface OpportunityJobBundlingEdge extends OpportunityBundlingEdge { sharedTopicIds: string[]; sharedTopicCount: number }
export type OpportunityJobBundlingGroup = OpportunityBundlingGroup;
export interface OpportunityJobBundlingDiagram extends OpportunityBundlingDiagram {
  entityKind: 'job';
  leaves: OpportunityJobBundlingLeaf[];
  edges: OpportunityJobBundlingEdge[];
}
export interface OpportunityJobBundlingOptions extends Omit<OpportunityEdgeBundlingOptions, 'entityKind'> {
  minimumInterest?: number;
  excludedTopicIds?: readonly string[];
}

/** Only shared, non-excluded canonical topics connect explicitly rated jobs. */
export function buildOpportunityJobBundling(
  jobs: readonly OpportunityInsightJob[], forest: readonly OpportunityTopicHierarchyNode[], options: OpportunityJobBundlingOptions = {},
): OpportunityJobBundlingDiagram {
  const rows = opportunityJobsAtInterest([...new Map(jobs.map(job => [job.id, job])).values()], options.minimumInterest ?? 8);
  const excluded = new Set((options.excludedTopicIds ?? []).map(opportunityTopicKey));
  const diagram = buildOpportunityEdgeBundling(rows.map(job => ({ id: `job:${job.id}`, recordId: job.id, label: job.title ?? '',
    evidenceIds: job.topicIds.map(opportunityTopicKey).filter(id => id && !excluded.has(id)),
  })), forest, { ...options, entityKind: 'job' });
  return { ...diagram, entityKind: 'job',
    leaves: diagram.leaves.map(leaf => ({ ...leaf, jobId: leaf.recordId, topicCount: leaf.evidenceCount })),
    edges: diagram.edges.map(edge => ({ ...edge, sharedTopicIds: edge.sharedIds, sharedTopicCount: edge.sharedCount })),
  };
}
