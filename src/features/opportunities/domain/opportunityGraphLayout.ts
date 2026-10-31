import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force-3d';
import type { OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';
import type { OpportunityInsightJob, OpportunityInsightTopicNode } from './opportunityInsights';

export interface OpportunityGraphNode {
  id: string;
  label: string;
  kind: 'topic' | 'job';
  radius: number;
  highInterestCount: number;
  matchingJobCount?: number;
  lowInterestCount?: number;
  avoidedCount?: number;
  positiveReasonCount?: number;
  topicCount?: number;
  interestScore?: number;
  mismatch: boolean;
  avoided: boolean;
}
export interface OpportunityGraphLink { source: string; target: string; weight: number; kind: 'cooccurrence' | 'semantic' | 'job-overlap'; similarity?: number; sharedTopicCount?: number; inferredTopicCount?: number; sentimentSimilarity?: number; semanticSimilarity?: number }
export interface OpportunityGraphPosition { id: string; x: number; y: number; z: number; community: number }
export interface OpportunityGraphLayoutInput {
  nodes: OpportunityGraphNode[];
  links: OpportunityGraphLink[];
  dimensions: 2 | 3;
  entityKind?: 'topic' | 'job';
  previous?: OpportunityGraphPosition[];
  /** Exact count-based job groups; topic communities continue to use Louvain. */
  communityAssignments?: Record<string, number>;
}
export interface OpportunityGraphAdjacency { ids: string[]; wordsPerRow: number; bits: Uint32Array }
export interface OpportunityGraphRenderData {
  nodes: OpportunityGraphNode[];
  links: OpportunityGraphLink[];
  entityKind: 'job';
  relationshipCount: number;
  adjacency: OpportunityGraphAdjacency;
}
export interface OpportunityGraphLayoutRequest extends OpportunityGraphLayoutInput {
  generation: number;
  view?: 'network' | 'hierarchy';
  /** Safe cohort data; dense job relationships are built only in the worker. */
  jobs?: OpportunityInsightJob[];
  jobMinimumInterest?: number;
  jobClusterCount?: number;
  jobExcludedTopicIds?: string[];
  jobTopics?: OpportunityInsightTopicNode[];
}
export type OpportunityGraphLayoutResponse = { generation: number; positions: OpportunityGraphPosition[]; hierarchy?: OpportunityTopicHierarchyNode[]; graph?: OpportunityGraphRenderData } | { generation: number; error: true };

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}
function seededRandom(seed: number) {
  let value = seed;
  return () => { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 4294967296; };
}

/** Recorded feedback affinity is available only with two or more explicit signals. It is not a dislike inference. */
export function opportunityGraphPreference(node: OpportunityGraphNode): { value: number; source: 'reasons' | 'ratings' } | null {
  const positive = Math.max(0, node.positiveReasonCount ?? 0), negative = Math.max(0, node.avoidedCount ?? 0);
  if (positive + negative >= 2) return { value: (positive - negative) / (positive + negative), source: 'reasons' };
  const high = Math.max(0, node.highInterestCount), low = Math.max(0, node.lowInterestCount ?? 0);
  return high + low >= 2 ? { value: (high - low) / (high + low), source: 'ratings' } : null;
}

const genericTopicWords = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'research', 'study', 'studies', 'science', 'scientific', 'system', 'systems', 'method', 'methods', 'based']);
function topicFamilies(label: string): Set<string> {
  const words = label.normalize('NFKC').toLocaleLowerCase('en-US').replaceAll('_', ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter(word => word.length > 2 && !genericTopicWords.has(word)).map(word => {
    if (/^(?:bio|psycho|electro)?acousti(?:c|cs|cal|cally)$/.test(word)) return 'acoustic';
    if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('is')) return word.slice(0, -1);
    return word;
  }));
}

/** Sparse local word-family hints; these are inferred wording links, never shared-job evidence or learned embeddings. */
export function opportunityGraphSemanticLinks(nodes: OpportunityGraphNode[]): OpportunityGraphLink[] {
  const topics = nodes.filter(node => node.kind === 'topic').sort((a, b) => a.id.localeCompare(b.id));
  const families = new Map(topics.map(node => [node.id, topicFamilies(node.label)]));
  const postings = new Map<string, string[]>();
  for (const node of topics) for (const family of families.get(node.id)!) {
    const ids = postings.get(family) ?? []; ids.push(node.id); postings.set(family, ids);
  }
  const candidates = new Map<string, { source: string; target: string; similarity: number }>();
  for (const ids of postings.values()) for (let index = 0; index < ids.length; index++) {
    // Neighbour windows keep even very common word families bounded without a quadratic all-pairs graph.
    for (let next = index + 1; next < Math.min(ids.length, index + 9); next++) {
      const source = ids[index]!, target = ids[next]!, a = families.get(source)!, b = families.get(target)!;
      const shared = [...a].filter(family => b.has(family)).length;
      const similarity = shared / new Set([...a, ...b]).size;
      const key = JSON.stringify([source, target]);
      if (similarity >= .2) candidates.set(key, { source, target, similarity });
    }
  }
  const degree = new Map<string, number>();
  const links: OpportunityGraphLink[] = [];
  for (const pair of [...candidates.values()].sort((a, b) => b.similarity - a.similarity || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))) {
    if ((degree.get(pair.source) ?? 0) >= 4 || (degree.get(pair.target) ?? 0) >= 4) continue;
    degree.set(pair.source, (degree.get(pair.source) ?? 0) + 1); degree.set(pair.target, (degree.get(pair.target) ?? 0) + 1);
    links.push({ source: pair.source, target: pair.target, similarity: pair.similarity, weight: .4 + pair.similarity * .6, kind: 'semantic' });
  }
  return links;
}

/** Feedback agreement moderates supported relationships; it never invents links between unrelated topics. */
export function opportunityGraphLinkWeight(link: OpportunityGraphLink, nodes: Map<string, OpportunityGraphNode>): number {
  if (!Number.isFinite(link.weight) || link.weight <= 0) return 0;
  if (link.kind === 'job-overlap') return link.weight;
  const source = nodes.get(link.source), target = nodes.get(link.target);
  const a = source && opportunityGraphPreference(source), b = target && opportunityGraphPreference(target);
  const reliability = source?.matchingJobCount !== undefined && target?.matchingJobCount !== undefined
    ? Math.sqrt(Math.max(0, source.matchingJobCount) / (Math.max(0, source.matchingJobCount) + 2)
      * Math.max(0, target.matchingJobCount) / (Math.max(0, target.matchingJobCount) + 2)) : 1;
  return link.weight * reliability * (a && b ? 1 + .35 * (1 - Math.abs(a.value - b.value)) : 1);
}

/** Stable communities use the active entity kind and its supported weighted relationships. */
export function opportunityGraphCommunities(input: OpportunityGraphLayoutInput): Map<string, number> {
  const fixed = fixedJobCommunities(input);
  if (fixed) return fixed;
  const graph = new UndirectedGraph({ allowSelfLoops: false });
  for (const node of [...input.nodes].sort((a, b) => a.id.localeCompare(b.id))) if (node.kind === (input.entityKind ?? 'topic')) graph.addNode(node.id);
  const nodes = new Map(input.nodes.map(node => [node.id, node]));
  const edges = [...input.links].filter(link => link.source !== link.target
    && graph.hasNode(link.source) && graph.hasNode(link.target) && Number.isFinite(link.weight) && link.weight > 0)
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  for (const edge of edges) {
    const weight = opportunityGraphLinkWeight(edge, nodes);
    if (graph.hasEdge(edge.source, edge.target)) graph.setEdgeAttribute(edge.source, edge.target, 'weight', graph.getEdgeAttribute(edge.source, edge.target, 'weight') + weight);
    else graph.addEdge(edge.source, edge.target, { weight });
  }
  const communities: Record<string, number> = graph.size ? louvain(graph, { randomWalk: false, getEdgeWeight: 'weight', resolution: 1 })
    : Object.fromEntries(graph.nodes().map((id, index) => [id, index]));
  const names = new Map<number, string>();
  for (const id of graph.nodes()) {
    const key = communities[id]!;
    const existing = names.get(key);
    if (!existing || id.localeCompare(existing) < 0) names.set(key, id);
  }
  return new Map(graph.nodes().map(id => [id, hash(names.get(communities[id]!)!)]));
}

function fixedJobCommunities(input: OpportunityGraphLayoutInput): Map<string, number> | null {
  if (input.entityKind !== 'job' || !input.communityAssignments) return null;
  const jobs = input.nodes.filter(node => node.kind === 'job');
  if (!jobs.every(node => Number.isInteger(input.communityAssignments![node.id]) && input.communityAssignments![node.id]! >= 0)) return null;
  return new Map(jobs.map(node => [node.id, input.communityAssignments![node.id]!]));
}

interface SimulationNode extends SimulationNodeDatum { id: string; radius: number }
interface SimulationLink extends SimulationLinkDatum<SimulationNode> { weight: number }

/** Computes a finite, deterministic layout off the UI thread. It never starts a persistent simulation. */
export function layoutOpportunityGraph(input: OpportunityGraphLayoutInput): OpportunityGraphPosition[] {
  if (!input.nodes.length) return [];
  const previous = new Map((input.previous ?? []).map(position => [position.id, position]));
  const nodes: SimulationNode[] = [...input.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(node => {
    const initial = previous.get(node.id);
    const angle = hash(node.id) / 4294967296 * Math.PI * 2;
    const distance = 50 + hash(`${node.id}:radius`) % 150;
    return { id: node.id, radius: node.radius, x: initial?.x ?? Math.cos(angle) * distance, y: initial?.y ?? Math.sin(angle) * distance,
      z: input.dimensions === 2 ? 0 : initial?.z || (hash(`${node.id}:z`) % 161 - 80) };
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  const evidenceNodes = new Map(input.nodes.map(node => [node.id, node]));
  const fixed = fixedJobCommunities(input), communities = fixed ?? opportunityGraphCommunities(input);
  const groupIds = [...new Set(fixed?.values() ?? [])].sort((a, b) => a - b);
  const groupRadius = groupIds.length > 1 ? 120 + Math.sqrt(nodes.length / groupIds.length) * 60 : 0;
  const groupCenters = new Map(groupIds.map((group, index) => {
    const angle = index / groupIds.length * Math.PI * 2;
    return [group, { x: Math.cos(angle) * groupRadius, y: Math.sin(angle) * groupRadius }];
  }));
  const links: SimulationLink[] = input.links.filter(link => nodeIds.has(link.source) && nodeIds.has(link.target) && link.source !== link.target)
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
    .map(link => ({ source: link.source, target: link.target, weight: Math.max(.1, opportunityGraphLinkWeight(link, evidenceNodes)) }));
  const seed = hash(nodes.map(node => node.id).join('\u0000'));
  const simulation = forceSimulation<SimulationNode>(nodes, input.dimensions).stop().randomSource(seededRandom(seed))
    .force('center', forceCenter(0, 0, 0))
    .force('charge', forceManyBody<SimulationNode>().strength(-160))
    // Disconnected topics remain in the map without stretching its bounds far beyond connected evidence.
    .force('x', forceX<SimulationNode>(node => groupCenters.get(communities.get(node.id)!)?.x ?? 0).strength(fixed ? .16 : .05))
    .force('y', forceY<SimulationNode>(node => groupCenters.get(communities.get(node.id)!)?.y ?? 0).strength(fixed ? .16 : .05))
    .force('z', forceZ<SimulationNode>(0).strength(input.dimensions === 3 ? .05 : 0))
    .force('collision', forceCollide<SimulationNode>().radius(node => Math.max(42, node.radius + 8)).iterations(2))
    .force('links', forceLink<SimulationNode, SimulationLink>(links).id(node => node.id)
      .distance(link => 95 / Math.sqrt(Math.log2(link.weight + 1)))
      .strength(link => Math.min(.8, .12 + Math.log2(link.weight + 1) * .1)));
  simulation.tick(180);
  simulation.stop();
  return nodes.map(node => ({ id: node.id, x: Number.isFinite(node.x) ? node.x! : 0, y: Number.isFinite(node.y) ? node.y! : 0,
    z: input.dimensions === 2 ? 0 : Number.isFinite(node.z) ? node.z! : 0, community: communities.get(node.id) ?? -1 }));
}
