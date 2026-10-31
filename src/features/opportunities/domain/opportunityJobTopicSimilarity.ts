import type { OpportunityInsightGraph, OpportunityInsightJob } from './opportunityInsights';
import { opportunityGraphSemanticLinks, type OpportunityGraphNode } from './opportunityGraphLayout';
import { opportunityTopicKey } from './opportunityTopics';

export interface OpportunityJobTopicGroup {
  id: string;
  topicIds: string[];
  /** Minimum direct local wording support between all group members. */
  confidence: number;
}
export interface PreparedOpportunityJobTopics {
  topicIds: string[];
  featureIds: string[];
  topicsByFeature: Map<string, string[]>;
  /** Targeted topic reasons first; otherwise a weak whole-job rating signal, in [-1,1]. */
  preferences: Map<string, number | null>;
  preferenceConfidence: Map<string, number>;
}
export interface PreparedOpportunityJobTopicEvidence {
  jobs: Map<string, PreparedOpportunityJobTopics>;
  groups: Map<string, OpportunityJobTopicGroup>;
}
export interface OpportunityJobClusteringOptions {
  excludedTopicIds?: readonly string[];
  prepared?: PreparedOpportunityJobTopicEvidence;
}
export type OpportunityJobTopicGraph = Pick<OpportunityInsightGraph, 'jobs'> & Partial<Pick<OpportunityInsightGraph, 'topics'>>;

const expansions: Record<string, string> = {
  ai: 'artificial intelligence', ml: 'machine learning', hri: 'human robot interaction',
  hci: 'human computer interaction', dsp: 'digital signal processing', nlp: 'natural language processing',
};
function wording(label: string): string {
  return label.replace(/\b(?:ai|ml|hri|hci|dsp|nlp)\b/giu, value => expansions[value.toLocaleLowerCase('en-US')]!);
}
const genericAnchors = new Set(['and', 'for', 'with', 'research', 'study', 'studie', 'science', 'scientific', 'system', 'method', 'based',
  'simulation', 'sensing', 'sensor', 'measurement', 'monitoring', 'processing', 'experiment', 'experimental', 'prototyping',
  'learning', 'network', 'artificial', 'intelligence', 'technology', 'application', 'analysis']);
function anchors(label: string): Set<string> {
  return new Set((wording(label).normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? []).flatMap(word => {
    const family = /^(?:bio|psycho|electro)?acousti(?:c|cs|cal|cally)$/.test(word) ? 'acoustic'
      : word.length > 5 && word.endsWith('ies') ? `${word.slice(0, -3)}y`
        : word.length > 4 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('is') ? word.slice(0, -1) : word;
    return family.length > 2 && !genericAnchors.has(family) ? [family] : [];
  }));
}
function hasDomainSupport(a: string, b: string): boolean {
  // Known acronym expansion may be identical; otherwise require a domain anchor,
  // not merely a shared broad method such as simulation or sensing.
  if (opportunityTopicKey(wording(a)) === opportunityTopicKey(wording(b))) return true;
  const left = anchors(a), right = anchors(b);
  return [...left].some(anchor => right.has(anchor));
}
const pairKey = (a: string, b: string) => JSON.stringify(a.localeCompare(b) <= 0 ? [a, b] : [b, a]);

export function opportunityJobTopicPreferenceAgreement(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.max(0, 1 - Math.abs(a - b) / 2);
}

function preference(job: OpportunityInsightJob, topics: readonly string[]): { value: number | null; confidence: number } {
  const ids = new Set(topics), targeted = new Map<string, number>();
  for (const reason of job.reasons) {
    if (reason.category !== 'topic' || !reason.target) continue;
    const target = opportunityTopicKey(reason.target);
    if (ids.has(target)) targeted.set(`${target}:${reason.polarity}`, reason.polarity === 'negative' ? -1 : 1);
  }
  if (targeted.size) return { value: [...targeted.values()].reduce((sum, value) => sum + value, 0) / targeted.size, confidence: 1 };
  return job.explicitInterest && job.interestScore !== null && Number.isFinite(job.interestScore)
    ? { value: Math.max(-1, Math.min(1, job.interestScore / 5 - 1)), confidence: .25 }
    : { value: null, confidence: 0 };
}

/**
 * Deterministic local wording groups, not embeddings or merged catalogue identities.
 * Exclusions are applied before inference. Every inferred group is a direct-link
 * clique, preventing a chain of loosely related names from bridging fields.
 */
export function prepareOpportunityJobTopics(graph: OpportunityJobTopicGraph, options: Pick<OpportunityJobClusteringOptions, 'excludedTopicIds'> = {}): PreparedOpportunityJobTopicEvidence {
  const excluded = new Set((options.excludedTopicIds ?? []).map(opportunityTopicKey));
  const remaining = new Map(graph.jobs.map(job => [job.id,
    [...new Set(job.topicIds.map(opportunityTopicKey).filter(id => id && !excluded.has(id)))].sort((a, b) => a.localeCompare(b))]));
  const ids = [...new Set([...remaining.values()].flat())].sort((a, b) => a.localeCompare(b));
  const labels = new Map(graph.topics?.map(topic => [opportunityTopicKey(topic.id), topic.label]));
  const nodes: OpportunityGraphNode[] = ids.map(id => ({ id, label: wording(labels.get(id) ?? id), kind: 'topic', radius: 1,
    highInterestCount: 0, mismatch: false, avoided: false }));
  const nodeLabels = new Map(nodes.map(node => [node.id, node.label]));
  const similarities = new Map(opportunityGraphSemanticLinks(nodes).filter(link => (link.similarity ?? 0) >= .3
    && hasDomainSupport(nodeLabels.get(link.source)!, nodeLabels.get(link.target)!))
    .map(link => [pairKey(link.source, link.target), link.weight]));
  const neighbours = new Map<string, Set<string>>();
  for (const key of similarities.keys()) {
    const [a, b] = JSON.parse(key) as [string, string];
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b); neighbours.get(b)!.add(a);
  }
  const grouped: OpportunityJobTopicGroup[] = [];
  const assigned = new Map<string, OpportunityJobTopicGroup>();
  for (const id of ids) {
    // Prefer the most strongly supported complete group, with a stable identity tie-break.
    const adjacent = new Set([...(neighbours.get(id) ?? [])].flatMap(topic => assigned.get(topic) ?? []));
    const candidates = [...adjacent].flatMap(group => {
      const weights = group.topicIds.map(member => similarities.get(pairKey(id, member)));
      return weights.every(weight => weight !== undefined)
        ? [{ group, confidence: Math.min(group.confidence, ...weights as number[]) }] : [];
    }).sort((a, b) => b.confidence - a.confidence || a.group.id.localeCompare(b.group.id));
    const candidate = candidates[0];
    if (candidate) { candidate.group.topicIds.push(id); candidate.group.confidence = candidate.confidence; assigned.set(id, candidate.group); }
    else {
      const group = { id, topicIds: [id], confidence: 1 };
      grouped.push(group); assigned.set(id, group);
    }
  }
  const groupByTopic = new Map(grouped.flatMap(group => group.topicIds.map(id => [id, group.id] as const)));
  const jobs = new Map<string, PreparedOpportunityJobTopics>();
  for (const job of [...graph.jobs].sort((a, b) => a.id.localeCompare(b.id))) {
    const topicIds = remaining.get(job.id) ?? [], topicsByFeature = new Map<string, string[]>();
    for (const id of topicIds) {
      const feature = groupByTopic.get(id)!;
      const members = topicsByFeature.get(feature) ?? []; members.push(id); topicsByFeature.set(feature, members);
    }
    const featureIds = [...topicsByFeature.keys()].sort((a, b) => a.localeCompare(b));
    const preferences = new Map<string, number | null>(), preferenceConfidence = new Map<string, number>();
    for (const feature of featureIds) {
      const signal = preference(job, topicsByFeature.get(feature)!);
      preferences.set(feature, signal.value); preferenceConfidence.set(feature, signal.confidence);
    }
    jobs.set(job.id, { topicIds, featureIds, topicsByFeature, preferences, preferenceConfidence });
  }
  return { jobs, groups: new Map(grouped.map(group => [group.id, group])) };
}
