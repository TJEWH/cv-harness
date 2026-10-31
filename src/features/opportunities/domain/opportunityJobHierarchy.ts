import type { OpportunityInsightJob } from './opportunityInsights';
import type { OpportunityGraphLink, OpportunityGraphNode } from './opportunityGraphLayout';
import { buildOpportunityTopicHierarchy, type OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';
import { buildOpportunityJobGraph } from './opportunityJobGraph';
import { opportunityJobsAtInterest } from './opportunityJobInterest';
import { clusterOpportunityJobs } from './opportunityJobKMeans';
import { prepareOpportunityJobTopics, type PreparedOpportunityJobTopicEvidence } from './opportunityJobTopicSimilarity';

function intersection(a: readonly string[], b: readonly string[]): string[] {
  const right = new Set(b);
  return [...new Set(a)].filter(id => right.has(id)).sort((a, b) => a.localeCompare(b));
}
function firstLeaf(node: OpportunityTopicHierarchyNode): string {
  while (node.children) node = node.children[0];
  return node.topicId ?? node.id;
}
function commonMetadata(node: OpportunityTopicHierarchyNode, prepared: PreparedOpportunityJobTopicEvidence) {
  if (node.children) {
    const [a, b] = node.children;
    node.sharedTopicIds = intersection(a.sharedTopicIds ?? [], b.sharedTopicIds ?? []);
    node.sharedTopicGroupIds = intersection(a.sharedTopicGroupIds ?? [], b.sharedTopicGroupIds ?? []);
  } else {
    const evidence = prepared.jobs.get(node.topicId!.slice(4));
    node.sharedTopicIds = [...(evidence?.topicIds ?? [])];
    node.sharedTopicGroupIds = [...(evidence?.featureIds ?? [])];
  }
  node.sharedTopicCount = node.sharedTopicGroupIds.length;
  node.relatedTopicGroupIds = node.sharedTopicGroupIds.filter(feature =>
    !prepared.groups.get(feature)?.topicIds.some(id => node.sharedTopicIds!.includes(id)));
}

/**
 * K-means fixes membership before the dendrogram is built. Average-link joins
 * display relationships only within each balanced group, using the complete,
 * preference-adjusted graph. Zero-affinity joins retain disconnected/topicless
 * members without claiming shared evidence. Exact labels and inferred groups
 * remain separate common-member metadata.
 */
export function buildOpportunityJobHierarchy(
  jobs: readonly OpportunityInsightJob[], nodes?: readonly OpportunityGraphNode[],
  prepared?: PreparedOpportunityJobTopicEvidence, links?: readonly OpportunityGraphLink[],
  groups?: readonly (readonly string[])[],
): OpportunityTopicHierarchyNode[] {
  const records = nodes ? new Map(nodes.filter(node => node.kind === 'job').map(node => [node.id, node])) : null;
  const rows = records ? jobs.filter(job => records.has(`job:${job.id}`)) : opportunityJobsAtInterest([...jobs]);
  const evidence = prepared ?? prepareOpportunityJobTopics({ jobs: rows });
  const graph = !nodes || !links ? buildOpportunityJobGraph({ jobs: rows }, 0, { prepared: evidence }) : null;
  const eligibleNodes = records ? rows.map(job => records.get(`job:${job.id}`)!) : graph!.nodes;
  const byId = new Map(eligibleNodes.map(node => [node.id, node]));
  const suppliedIds = groups?.flat();
  // A stale/incomplete supplied partition must not drop eligible records.
  const validGroups = suppliedIds?.length === byId.size && new Set(suppliedIds).size === byId.size
    && suppliedIds.every(id => byId.has(id)) && groups!.every(group => group.length);
  const partition = validGroups ? groups! : clusterOpportunityJobs(rows, evidence).groups;
  const groupByJob = new Map(partition.flatMap((group, index) => group.map(id => [id, index] as const)));
  const groupLinks: OpportunityGraphLink[][] = partition.map(() => []);
  for (const link of links ?? graph!.links) {
    const group = groupByJob.get(link.source);
    // The generic hierarchy otherwise uses raw job similarity. Weight already
    // contains preference moderation and drives the within-group merge heights.
    if (group !== undefined && group === groupByJob.get(link.target)) groupLinks[group]!.push({ ...link, similarity: link.weight });
  }
  return partition.map((group, groupIndex) => {
    const forest = buildOpportunityTopicHierarchy({ nodes: group.map(id => byId.get(id)!), links: groupLinks[groupIndex]!, dimensions: 2, entityKind: 'job' });
    const pending = forest.map(node => ({ node, visited: false }));
    while (pending.length) {
      const { node, visited } = pending.pop()!;
      if (node.children && !visited) pending.push({ node, visited: true }, ...node.children.map(child => ({ node: child, visited: false })));
      else {
        if (node.children) node.id = `job-hierarchy:${groupIndex}:${node.id}`;
        commonMetadata(node, evidence);
      }
    }
    let sequence = 0;
    while (forest.length > 1) {
      // These zero joins are display-only and never alter k-means membership.
      forest.sort((a, b) => a.count - b.count || firstLeaf(a).localeCompare(firstLeaf(b)));
      const pair = forest.splice(0, 2).sort((a, b) => firstLeaf(a).localeCompare(firstLeaf(b)));
      const children: [OpportunityTopicHierarchyNode, OpportunityTopicHierarchyNode] = [pair[0]!, pair[1]!];
      const merged: OpportunityTopicHierarchyNode = { id: `job-hierarchy:${groupIndex}:zero:${sequence++}`, topicId: null,
        label: children[0].label, count: children[0].count + children[1].count, affinity: 0, children };
      commonMetadata(merged, evidence);
      forest.push(merged);
    }
    return forest[0]!;
  });
}
