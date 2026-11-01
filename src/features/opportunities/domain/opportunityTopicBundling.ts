import type { OpportunityInsightJob } from './opportunityInsights';
import type { OpportunityGraphNode } from './opportunityGraphLayout';
import type { OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';
import { buildOpportunityEdgeBundling, type OpportunityBundlingDiagram, type OpportunityEdgeBundlingOptions } from './opportunityEdgeBundling';

export type OpportunityTopicBundlingOptions = Omit<OpportunityEdgeBundlingOptions, 'entityKind'>;

/**
 * Invert the job/topic incidence matrix: visible topics are nodes and eligible
 * jobs are exact supporting evidence. The caller supplies the current date,
 * current-only and interest cohort; no extra high-interest filter is applied.
 * Hierarchy wording hints can route curves but cannot create observed links.
 */
export function buildOpportunityTopicBundling(
  nodes: readonly OpportunityGraphNode[], jobs: readonly OpportunityInsightJob[],
  forest: readonly OpportunityTopicHierarchyNode[], options: OpportunityTopicBundlingOptions = {},
): OpportunityBundlingDiagram {
  const visible = new Map(nodes.filter(node => node.kind === 'topic' && node.id.startsWith('topic:') && node.id.length > 6)
    .map(node => [node.id, node]));
  const postings = new Map([...visible.keys()].map(id => [id, new Set<string>()]));
  for (const job of jobs) for (const topicId of new Set(job.topicIds)) postings.get(`topic:${topicId}`)?.add(job.id);
  return buildOpportunityEdgeBundling([...visible.values()].map(node => ({
    id: node.id, recordId: node.id.slice(6), label: node.label, evidenceIds: [...postings.get(node.id)!],
  })), forest, { ...options, entityKind: 'topic' });
}
