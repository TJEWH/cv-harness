import type { OpportunityInsightGraph, OpportunityInsightJob } from './opportunityInsights';
import { opportunityJobsAtInterest } from './opportunityJobInterest';
import { opportunityTopicKey } from './opportunityTopics';
import { prepareOpportunityJobTopics, opportunityJobTopicPreferenceAgreement, type OpportunityJobClusteringOptions, type OpportunityJobTopicGraph } from './opportunityJobTopicSimilarity';
import type { OpportunityGraphAdjacency, OpportunityGraphLayoutInput, OpportunityGraphLink, OpportunityGraphNode, OpportunityGraphRenderData } from './opportunityGraphLayout';

function jobNode(job: OpportunityInsightJob, topicCount: number): OpportunityGraphNode {
  return { id: `job:${job.id}`, label: job.title ?? '', kind: 'job', radius: 5 + Math.min(9, Math.sqrt(topicCount) * 2),
    highInterestCount: Number(job.highInterest), topicCount, interestScore: job.interestScore ?? undefined, mismatch: false, avoided: false };
}

export function opportunityJobGraphNodes(graph: Pick<OpportunityInsightGraph, 'jobs'>, minimumInterest = 8, options: Pick<OpportunityJobClusteringOptions, 'excludedTopicIds'> = {}): OpportunityGraphNode[] {
  const excluded = new Set((options.excludedTopicIds ?? []).map(opportunityTopicKey));
  return opportunityJobsAtInterest(graph.jobs, minimumInterest).map(job => {
    const topicCount = new Set(job.topicIds.map(opportunityTopicKey).filter(id => id && !excluded.has(id))).size;
    return jobNode(job, topicCount);
  });
}

/** Exact overlap plus conservative related-topic support, moderated by recorded preferences. */
export function buildOpportunityJobGraph(graph: OpportunityJobTopicGraph, minimumInterest = 8, options: OpportunityJobClusteringOptions = {}): Pick<OpportunityGraphLayoutInput, 'nodes' | 'links' | 'entityKind'> {
  const jobs = opportunityJobsAtInterest(graph.jobs, minimumInterest);
  const prepared = options.prepared ?? prepareOpportunityJobTopics({ jobs, topics: graph.topics }, options);
  const nodes = jobs.map(job => jobNode(job, prepared.jobs.get(job.id)?.featureIds.length ?? 0));
  // Each semantic feature appears at most once per job, preventing alias double counts.
  const postings = new Map<string, string[]>();
  for (const job of jobs) for (const feature of prepared.jobs.get(job.id)?.featureIds ?? []) {
    const ids = postings.get(feature) ?? []; ids.push(job.id); postings.set(feature, ids);
  }
  interface Pair { source: string; target: string; support: number; weighted: number; inferred: number; agreement: number; agreementCount: number; features: number }
  const overlaps = new Map<string, Pair>();
  for (const [feature, ids] of postings) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const source = ids[a]!, target = ids[b]!, key = JSON.stringify([source, target]);
    const left = prepared.jobs.get(source)!, right = prepared.jobs.get(target)!;
    const leftTopics = new Set(left.topicsByFeature.get(feature));
    const exact = right.topicsByFeature.get(feature)!.some(id => leftTopics.has(id));
    const support = exact ? 1 : prepared.groups.get(feature)!.confidence;
    const agreement = opportunityJobTopicPreferenceAgreement(left.preferences.get(feature) ?? null, right.preferences.get(feature) ?? null);
    const confidence = Math.min(left.preferenceConfidence.get(feature) ?? 0, right.preferenceConfidence.get(feature) ?? 0);
    const moderation = agreement === null ? 1 : 1 - .4 * confidence * (1 - agreement);
    const pair = overlaps.get(key) ?? { source, target, support: 0, weighted: 0, inferred: 0, agreement: 0, agreementCount: 0, features: 0 };
    pair.support += support; pair.weighted += support * moderation; pair.inferred += Number(!exact); pair.features++;
    if (agreement !== null) { pair.agreement += agreement; pair.agreementCount++; }
    overlaps.set(key, pair);
  }
  const links: OpportunityGraphLink[] = [...overlaps.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)).map(pair => {
    const left = prepared.jobs.get(pair.source)!, right = prepared.jobs.get(pair.target)!;
    const combined = left.featureIds.length + right.featureIds.length;
    const similarity = pair.support / (combined - pair.support), weight = pair.weighted / (combined - pair.weighted);
    const leftExact = new Set(left.topicIds), sharedTopicCount = right.topicIds.filter(id => leftExact.has(id)).length;
    return { source: `job:${pair.source}`, target: `job:${pair.target}`, kind: 'job-overlap', weight, similarity, sharedTopicCount,
      inferredTopicCount: pair.inferred, semanticSimilarity: pair.support / pair.features,
      ...(pair.agreementCount ? { sentimentSimilarity: pair.agreement / pair.agreementCount } : {}) };
  });
  return { nodes, links, entityKind: 'job' };
}

/** Bounded drawing evidence; every relationship still participates in worker grouping. */
export function projectOpportunityJobGraph(graph: Pick<OpportunityGraphLayoutInput, 'nodes' | 'links'>, incidentLimit = 8): OpportunityGraphRenderData {
  const nodes = graph.nodes, ids = nodes.map(node => node.id), indexes = new Map(ids.map((id, index) => [id, index]));
  const wordsPerRow = Math.ceil(nodes.length / 32), bits = new Uint32Array(nodes.length * wordsPerRow);
  for (const link of graph.links) {
    const source = indexes.get(link.source), target = indexes.get(link.target);
    if (source === undefined || target === undefined) continue;
    bits[source * wordsPerRow + (target >>> 5)]! |= 1 << (target & 31);
    bits[target * wordsPerRow + (source >>> 5)]! |= 1 << (source & 31);
  }
  const counts = new Map<string, number>(), links: OpportunityGraphLink[] = [];
  for (const link of [...graph.links].sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))) {
    const sourceCount = counts.get(link.source) ?? 0, targetCount = counts.get(link.target) ?? 0;
    if (sourceCount < incidentLimit || targetCount < incidentLimit) links.push(link);
    counts.set(link.source, Math.min(incidentLimit, sourceCount + 1));
    counts.set(link.target, Math.min(incidentLimit, targetCount + 1));
  }
  return { nodes, links, entityKind: 'job', relationshipCount: graph.links.length, adjacency: { ids, wordsPerRow, bits } };
}

/** Focus uses complete observed overlap, including relationships omitted from dense drawing. */
export function opportunityJobGraphFocus(adjacency: OpportunityGraphAdjacency, selectedId: string | null): Set<string> | null {
  const selected = selectedId === null ? -1 : adjacency.ids.indexOf(selectedId);
  if (selected < 0) return null;
  const related = new Set([adjacency.ids[selected]!]);
  const offset = selected * adjacency.wordsPerRow;
  adjacency.ids.forEach((id, index) => {
    if ((adjacency.bits[offset + (index >>> 5)]! & (1 << (index & 31))) !== 0) related.add(id);
  });
  return related;
}
