import { opportunityGraphLinkWeight, type OpportunityGraphLayoutInput, type OpportunityGraphNode } from './opportunityGraphLayout';

export interface OpportunityTopicHierarchyNode {
  id: string;
  topicId: string | null;
  label: string;
  count: number;
  affinity: number;
  sharedTopicIds?: string[];
  sharedTopicCount?: number;
  sharedTopicGroupIds?: string[];
  relatedTopicGroupIds?: string[];
  children: [OpportunityTopicHierarchyNode, OpportunityTopicHierarchyNode] | null;
}
interface Candidate { a: string; b: string; affinity: number }

/** A maximum heap keeps sparse average-link agglomeration off the UI thread. */
class AffinityHeap {
  private values: Candidate[] = [];
  private before(a: Candidate, b: Candidate) {
    return a.affinity > b.affinity || a.affinity === b.affinity && (a.a.localeCompare(b.a) < 0 || a.a === b.a && a.b.localeCompare(b.b) < 0);
  }
  push(value: Candidate) {
    const values = this.values; values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(value, values[parent]!)) break;
      values[index] = values[parent]!; index = parent;
    }
    values[index] = value;
  }
  pop(): Candidate | undefined {
    const first = this.values[0], last = this.values.pop();
    if (!first || !last || !this.values.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.values.length && this.before(this.values[child + 1]!, this.values[child]!)) child++;
      if (!this.before(this.values[child]!, last)) break;
      this.values[index] = this.values[child]!; index = child;
    }
    this.values[index] = last; return first;
  }
}
function matchingCount(node: OpportunityGraphNode): number {
  return Math.max(1, node.matchingJobCount ?? node.highInterestCount + (node.lowInterestCount ?? 0));
}

/**
 * A deterministic average-link forest. Missing relationships contribute zero to
 * cluster averages, and disconnected components are never joined artificially.
 * Affinity is a layout heuristic, not a probability or verified semantic score.
 */
export function buildOpportunityTopicHierarchy(input: OpportunityGraphLayoutInput): OpportunityTopicHierarchyNode[] {
  const nodes = new Map([...input.nodes].filter(node => node.kind === (input.entityKind ?? 'topic')).sort((a, b) => a.id.localeCompare(b.id)).map(node => [node.id, node]));
  const active = new Map<string, OpportunityTopicHierarchyNode>();
  const firstIds = new Map<string, string>();
  const neighbours = new Map<string, Map<string, number>>();
  for (const node of nodes.values()) {
    active.set(node.id, { id: node.id, topicId: node.id, label: node.label, count: 1, affinity: 1, children: null });
    firstIds.set(node.id, node.id); neighbours.set(node.id, new Map());
  }
  const pairs = new Map<string, { a: string; b: string; affinity: number }>();
  for (const link of input.links) {
    if (link.source === link.target || !Number.isFinite(link.weight) || link.weight <= 0) continue;
    const source = nodes.get(link.source), target = nodes.get(link.target);
    if (!source || !target) continue;
    const support = opportunityGraphLinkWeight(link, nodes) / link.weight;
    const shared = Math.min(link.weight, matchingCount(source), matchingCount(target));
    const base = link.kind === 'job-overlap' ? Math.min(1, link.similarity ?? link.weight)
      : link.kind === 'semantic' ? Math.min(1, link.similarity ?? link.weight) * .65
      : shared / Math.max(1, matchingCount(source) + matchingCount(target) - shared);
    const affinity = Math.max(0, Math.min(1, base * support));
    if (!affinity) continue;
    const [a, b] = [source.id, target.id].sort(), key = JSON.stringify([a, b]);
    const existing = pairs.get(key);
    // Wording and observed evidence stay distinct facts; use the strongest support,
    // rather than double-counting two explanations of the same relationship.
    if (!existing || affinity > existing.affinity) pairs.set(key, { a: a!, b: b!, affinity });
  }
  const heap = new AffinityHeap();
  for (const pair of [...pairs.values()].sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b))) {
    neighbours.get(pair.a)!.set(pair.b, pair.affinity); neighbours.get(pair.b)!.set(pair.a, pair.affinity);
    heap.push(pair);
  }
  let sequence = 0;
  for (let next = heap.pop(); next; next = heap.pop()) {
    const a = active.get(next.a), b = active.get(next.b);
    if (!a || !b) continue;
    const sum = neighbours.get(a.id)?.get(b.id) ?? 0;
    const affinity = sum / (a.count * b.count);
    if (!sum || Math.abs(affinity - next.affinity) > 1e-12) continue;
    const children: [OpportunityTopicHierarchyNode, OpportunityTopicHierarchyNode] = firstIds.get(a.id)! < firstIds.get(b.id)! ? [a, b] : [b, a];
    const id = `hierarchy:${sequence++}`;
    const merged: OpportunityTopicHierarchyNode = { id, topicId: null, label: children[0].label, count: a.count + b.count,
      affinity: Math.min(affinity, a.affinity, b.affinity), children };
    const connected = new Map<string, number>();
    for (const previous of [a, b]) for (const [other, weight] of neighbours.get(previous.id) ?? []) {
      if (other !== a.id && other !== b.id && active.has(other)) connected.set(other, (connected.get(other) ?? 0) + weight);
    }
    active.delete(a.id); active.delete(b.id); neighbours.delete(a.id); neighbours.delete(b.id);
    active.set(id, merged); neighbours.set(id, connected); firstIds.set(id, firstIds.get(children[0].id)!);
    for (const [other, weight] of connected) {
      const adjacent = neighbours.get(other)!;
      adjacent.delete(a.id); adjacent.delete(b.id); adjacent.set(id, weight);
      const [left, right] = [id, other].sort();
      heap.push({ a: left!, b: right!, affinity: weight / (merged.count * active.get(other)!.count) });
    }
  }
  return [...active.values()].sort((a, b) => firstIds.get(a.id)!.localeCompare(firstIds.get(b.id)!));
}
