import type { OpportunityInsightGraph } from './opportunityInsights';
import type { OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';
import type { SafeOpportunityFeedbackExample } from './opportunityFeedbackPrivacy';
import { opportunityFeedbackTextIsSafe } from './opportunityFeedbackPrivacy';
import { opportunityTopicKey } from './opportunityTopics';

export const OPPORTUNITY_JOB_CLUSTER_COPY_MAX_NODES = 128;
export const OPPORTUNITY_JOB_CLUSTER_COPY_MAX_DETAILS = 16;
export const OPPORTUNITY_JOB_CLUSTER_COPY_MAX_TOPICS = 8;

function safeLabel(value: unknown, maximum: number): string | null {
  return opportunityFeedbackTextIsSafe(value, maximum)
    && opportunityFeedbackTextIsSafe(value.normalize('NFKC'), maximum)
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
}

/**
 * Closed copy projection of an already computed, complete hierarchy. Bounds
 * collapse original subtrees; they never recompute membership or merge heights.
 * Only the existing selected qualitative examples can supply leaf details.
 */
export function projectOpportunityJobClusteringCopy(
  forest: readonly OpportunityTopicHierarchyNode[], graph: OpportunityInsightGraph,
  examples: readonly SafeOpportunityFeedbackExample[], excludedTopicIds: readonly string[] = [],
) {
  const excluded = new Set(excludedTopicIds.map(opportunityTopicKey));
  const topicLabels = new Map(graph.topics.flatMap(topic => {
    const label = safeLabel(topic.label, 120);
    return label && !excluded.has(topic.id) ? [[topic.id, label] as const] : [];
  }));
  const jobRefs = new Map<string, string>(), clusterByJob = new Map<string, string>();
  let totalNodeCount = 0;
  forest.forEach((root, index) => {
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!;
      totalNodeCount++;
      if (node.children) pending.push(...node.children);
      else if (node.topicId?.startsWith('job:')) clusterByJob.set(node.topicId.slice(4), `cluster-${index + 1}`);
    }
  });
  [...clusterByJob.keys()].sort((a, b) => a.localeCompare(b)).forEach((id, index) => jobRefs.set(id, `job-${index + 1}`));
  const jobs = examples.filter(example => jobRefs.has(example.opportunity_id)).slice(0, OPPORTUNITY_JOB_CLUSTER_COPY_MAX_DETAILS)
    .map(example => {
      const topics = [...new Set(example.topics.map(opportunityTopicKey))].filter(id => topicLabels.has(id)).sort((a, b) => a.localeCompare(b));
      return { ref: jobRefs.get(example.opportunity_id)!, cluster: clusterByJob.get(example.opportunity_id)!,
        title: safeLabel(example.title, 240), interestScore: example.interest_score,
        topics: topics.slice(0, OPPORTUNITY_JOB_CLUSTER_COPY_MAX_TOPICS).map(id => topicLabels.get(id)!),
        availableExampleTopicCount: topics.length, omittedExampleTopics: Math.max(0, topics.length - OPPORTUNITY_JOB_CLUSTER_COPY_MAX_TOPICS) };
    });
  const pending = forest.map((node, index) => ({ node, ref: `node-${index + 1}` }));
  const roots = pending.map(row => row.ref);
  type CopiedNode = { ref: string; kind: 'job'; job: string } | {
    ref: string; kind: 'branch'; memberCount: number; relativeSimilarity: number;
    sharedExactTopicCount: number; sharedExactTopics: string[]; omittedSharedExactTopics: number;
    sharedMeaningGroupCount: number; relatedMeaningGroupCount: number;
    children: string[]; omittedDescendantNodes: number;
  };
  const nodes: CopiedNode[] = [];
  let includedLeafCount = 0;
  for (let index = 0; index < pending.length; index++) {
    const { node, ref } = pending[index]!;
    if (!node.children) {
      const job = node.topicId?.startsWith('job:') ? jobRefs.get(node.topicId.slice(4)) : undefined;
      if (job) { nodes.push({ ref, kind: 'job', job }); includedLeafCount++; }
      continue;
    }
    const shared = [...new Set(node.sharedTopicIds ?? [])].filter(id => topicLabels.has(id)).sort((a, b) => a.localeCompare(b));
    const children: string[] = [];
    if (pending.length + 2 <= OPPORTUNITY_JOB_CLUSTER_COPY_MAX_NODES) {
      for (const child of node.children) {
        const childRef = `node-${pending.length + 1}`;
        pending.push({ node: child, ref: childRef }); children.push(childRef);
      }
    }
    nodes.push({ ref, kind: 'branch', memberCount: node.count, relativeSimilarity: node.affinity,
      sharedExactTopicCount: shared.length,
      sharedExactTopics: shared.slice(0, OPPORTUNITY_JOB_CLUSTER_COPY_MAX_TOPICS).map(id => topicLabels.get(id)!),
      omittedSharedExactTopics: Math.max(0, shared.length - OPPORTUNITY_JOB_CLUSTER_COPY_MAX_TOPICS),
      sharedMeaningGroupCount: node.sharedTopicGroupIds?.length ?? 0, relatedMeaningGroupCount: node.relatedTopicGroupIds?.length ?? 0,
      children, omittedDescendantNodes: children.length ? 0 : Math.max(0, 2 * node.count - 2) });
  }
  return {
    available: true,
    computation: 'The complete eligible selected-time cohort is clustered before this bounded copy projection. Membership uses the same deterministic size-balanced k-means and within-group average-link hierarchy as the interactive job explorer. No input jobs or topic features are truncated before clustering.',
    projection: 'Packet-local references preserve original cluster membership and branch structure. Empty branch children mark an original collapsed subtree; member counts and relative similarity are retained without inventing replacement joins. The breadth-first projection can omit leaf nodes and job details; totals and omissions describe the complete computation.',
    relativeSimilarity: 'Branch values are the original preference-moderated average-link display affinities within each fixed k-means group, in [0,1]. They are local wording/topic heuristics, not probabilities or verified semantic similarity. Zero joins retain disconnected jobs without positive relationship evidence. Balance constraints do not establish a common topic.',
    topicContext: 'Shared exact topic labels occur in every descendant job after topic exclusions. Meaning-group counts may also include conservative inferred related-name/acronym groups; these remain distinct from exact shared labels. A branch can have positive pairwise affinity without any topic common to all members.',
    detailScope: 'Job titles, explicit interest and bounded topic details are included only for jobs already present in the existing at-most-16 selected safe qualitative examples. Leaf topic counts and omissions describe safe, non-excluded topics available in those already bounded examples, not complete original job topic lists. Other leaf references are anonymous. This appendix adds no evaluation excerpts, URLs, institutions, reasons, or raw job/review/application records.',
    limits: { nodes: OPPORTUNITY_JOB_CLUSTER_COPY_MAX_NODES, jobDetails: OPPORTUNITY_JOB_CLUSTER_COPY_MAX_DETAILS, topicsPerRecord: OPPORTUNITY_JOB_CLUSTER_COPY_MAX_TOPICS },
    totalJobCount: jobRefs.size, clusterCount: forest.length, totalNodeCount,
    includedNodeCount: nodes.length, omittedNodeCount: Math.max(0, totalNodeCount - nodes.length),
    includedLeafCount, omittedLeafCount: Math.max(0, jobRefs.size - includedLeafCount),
    includedJobDetailCount: jobs.length, omittedJobDetailCount: Math.max(0, jobRefs.size - jobs.length),
    clusters: forest.map((root, index) => ({ ref: `cluster-${index + 1}`, memberCount: root.count, root: roots[index]! })),
    nodes, jobs,
  };
}
