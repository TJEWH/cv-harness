import type { OpportunityInsightJob } from './opportunityInsights';
import type { OpportunityGraphAdjacency } from './opportunityGraphLayout';
import type { OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';
import { opportunityJobsAtInterest } from './opportunityJobInterest';
import { opportunityTopicKey } from './opportunityTopics';

export interface OpportunityJobBundlingLeaf {
  id: string;
  jobId: string;
  label: string;
  x: number;
  y: number;
  /** Radians, clockwise from the top. Coordinates are relative to the centre. */
  angle: number;
  groupIndex: number;
  topicCount: number;
  /** All exact-topic neighbours, including relationships omitted from drawing. */
  relationshipCount: number;
}
export interface OpportunityJobBundlingEdge {
  id: string;
  source: string;
  target: string;
  sharedTopicIds: string[];
  sharedTopicCount: number;
  groupIndex: number;
  path: string;
  /** Source-to-target hierarchy route, including the common ancestor. */
  route: string[];
}
export interface OpportunityJobBundlingGroup {
  id: string;
  index: number;
  startAngle: number;
  endAngle: number;
  count: number;
}
export interface OpportunityJobBundlingDiagram {
  radius: number;
  leaves: OpportunityJobBundlingLeaf[];
  edges: OpportunityJobBundlingEdge[];
  groups: OpportunityJobBundlingGroup[];
  relationshipCount: number;
  adjacency: OpportunityGraphAdjacency;
}
export interface OpportunityJobBundlingOptions {
  minimumInterest?: number;
  excludedTopicIds?: readonly string[];
  radius?: number;
  bundleStrength?: number;
  /** Draw the union of each job's strongest relationships, keeping full adjacency. */
  incidentLimit?: number;
}
interface RoutingNode {
  id: string;
  leafId: string | null;
  parent: RoutingNode | null;
  children: RoutingNode[];
  depth: number;
  count: number;
  angle: number;
  x: number;
  y: number;
  groupIndex: number;
}
interface Pair { source: string; target: string; sharedTopicIds: string[] }

function polar(angle: number, radius: number) { return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius }; }
function point(x: number, y: number) { return `${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`; }
function bundledPath(route: RoutingNode[], strength: number): string {
  const first = route[0]!, last = route[route.length - 1]!;
  const points = route.map((node, index) => {
    const t = index / (route.length - 1);
    return { x: strength * node.x + (1 - strength) * (first.x + (last.x - first.x) * t),
      y: strength * node.y + (1 - strength) * (first.y + (last.y - first.y) * t) };
  });
  // Quadratic segments share their midpoint tangents, rounding the hierarchy
  // polyline without the overshoot that can put spline loops outside the circle.
  let path = `M${point(first.x, first.y)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]!, current = points[index]!, next = points[index + 1]!;
    if (index === 1) path += `L${point((before.x + current.x) / 2, (before.y + current.y) / 2)}`;
    path += `Q${point(current.x, current.y)} ${point((current.x + next.x) / 2, (current.y + next.y) / 2)}`;
  }
  return `${path}L${point(last.x, last.y)}`;
}
function hierarchyRoute(source: RoutingNode, target: RoutingNode): RoutingNode[] {
  const left: RoutingNode[] = [], right: RoutingNode[] = [];
  for (let node: RoutingNode | null = source; node; node = node.parent) left.push(node);
  for (let node: RoutingNode | null = target; node; node = node.parent) right.push(node);
  let a = left.length - 1, b = right.length - 1;
  while (a >= 0 && b >= 0 && left[a] === right[b]) { a--; b--; }
  return [...left.slice(0, a + 2), ...right.slice(0, b + 1).reverse()];
}

/**
 * The existing balanced hierarchy determines radial order and curve routing.
 * Only shared, non-excluded topic IDs create edges: inferred names, hierarchy
 * joins and equal sentiment never become observed relationships. All eligible
 * jobs remain visible, even when none of their topics produce a connection.
 */
export function buildOpportunityJobBundling(
  jobs: readonly OpportunityInsightJob[], forest: readonly OpportunityTopicHierarchyNode[], options: OpportunityJobBundlingOptions = {},
): OpportunityJobBundlingDiagram {
  const radius = Number.isFinite(options.radius) ? Math.max(1, options.radius!) : 240;
  const strength = Number.isFinite(options.bundleStrength) ? Math.max(0, Math.min(1, options.bundleStrength!)) : .85;
  const incidentLimit = Number.isFinite(options.incidentLimit) ? Math.max(1, Math.floor(options.incidentLimit!)) : 8;
  const rows = opportunityJobsAtInterest([...new Map(jobs.map(job => [job.id, job])).values()], options.minimumInterest ?? 8);
  const byId = new Map(rows.map(job => [`job:${job.id}`, job]));
  const excluded = new Set((options.excludedTopicIds ?? []).map(opportunityTopicKey));
  const topics = new Map(rows.map(job => [`job:${job.id}`, [...new Set(job.topicIds.map(opportunityTopicKey).filter(id => id && !excluded.has(id)))].sort()]));
  const root: RoutingNode = { id: 'job-bundling:root', leafId: null, parent: null, children: [], depth: 0, count: 0, angle: 0, x: 0, y: 0, groupIndex: -1 };
  const routedLeaves = new Map<string, RoutingNode>();
  const allNodes: RoutingNode[] = [];
  // Prune stale leaves defensively, then append any missing jobs as independent
  // roots. A stale supplied hierarchy can never hide or duplicate an eligible job.
  for (const [groupIndex, supplied] of forest.entries()) {
    let groupRoot: RoutingNode | null = null;
    const pending: { supplied: OpportunityTopicHierarchyNode; parent: RoutingNode | null; visited?: RoutingNode }[] = [{ supplied, parent: null }];
    while (pending.length) {
      const entry = pending.pop()!;
      if (entry.visited) {
        const node = entry.visited;
        node.count = node.children.reduce((count, child) => count + child.count, 0);
        if (!node.count) {
          if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
          else groupRoot = null;
        }
        continue;
      }
      const leafId = entry.supplied.topicId;
      if (leafId && (!byId.has(leafId) || routedLeaves.has(leafId))) continue;
      const node: RoutingNode = { id: leafId ?? `job-bundling:${groupIndex}:${entry.supplied.id}`, leafId,
        parent: entry.parent, children: [], depth: entry.parent ? entry.parent.depth + 1 : 1,
        count: leafId ? 1 : 0, angle: 0, x: 0, y: 0, groupIndex };
      if (entry.parent) entry.parent.children.push(node); else groupRoot = node;
      if (leafId) routedLeaves.set(leafId, node);
      else if (entry.supplied.children) {
        pending.push({ ...entry, visited: node });
        for (const child of [...entry.supplied.children].reverse()) pending.push({ supplied: child, parent: node });
      }
    }
    if (groupRoot?.count) { groupRoot.parent = root; root.children.push(groupRoot); }
  }
  for (const job of rows) if (!routedLeaves.has(`job:${job.id}`)) {
    const node: RoutingNode = { id: `job:${job.id}`, leafId: `job:${job.id}`, parent: root, children: [], depth: 1, count: 1,
      angle: 0, x: 0, y: 0, groupIndex: root.children.length };
    root.children.push(node); routedLeaves.set(node.id, node);
  }
  // Densely packed cohorts still have a readable gap between their fixed groups.
  const gap = 1.4, totalSlots = rows.length + root.children.length * gap;
  const step = totalSlots ? Math.PI * 2 / totalSlots : 0;
  const leaves: OpportunityJobBundlingLeaf[] = [], groups: OpportunityJobBundlingGroup[] = [];
  let slot = gap / 2;
  root.children.forEach((group, index) => {
    const firstSlot = slot;
    const pending = [group];
    while (pending.length) {
      const node = pending.pop()!;
      node.groupIndex = index; allNodes.push(node);
      if (node.leafId) {
        node.angle = (slot + .5) * step; slot++;
        const job = byId.get(node.leafId)!;
        leaves.push({ id: node.leafId, jobId: job.id, label: job.title ?? '', angle: node.angle,
          ...polar(node.angle, radius), groupIndex: index, topicCount: topics.get(node.leafId)!.length, relationshipCount: 0 });
      } else pending.push(...[...node.children].reverse());
    }
    groups.push({ id: group.id, index, startAngle: firstSlot * step, endAngle: slot * step, count: group.count });
    slot += gap;
  });
  const maxDepth = Math.max(1, ...allNodes.map(node => node.depth));
  for (const node of [...allNodes].reverse()) {
    if (node.children.length) node.angle = node.children.reduce((sum, child) => sum + child.angle * child.count, 0) / node.count;
    Object.assign(node, polar(node.angle, node.leafId ? radius : radius * node.depth / maxDepth));
  }
  const ids = rows.map(job => `job:${job.id}`), indexes = new Map(ids.map((id, index) => [id, index]));
  const wordsPerRow = Math.ceil(ids.length / 32), bits = new Uint32Array(ids.length * wordsPerRow);
  const postings = new Map<string, string[]>();
  for (const [id, labels] of topics) for (const label of labels) {
    const members = postings.get(label) ?? []; members.push(id); postings.set(label, members);
  }
  const pairs = new Map<string, Pair>();
  for (const [topicId, members] of postings) for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) {
    const source = members[a]!, target = members[b]!, key = JSON.stringify([source, target]);
    const pair = pairs.get(key) ?? { source, target, sharedTopicIds: [] };
    pair.sharedTopicIds.push(topicId); pairs.set(key, pair);
  }
  const degrees = new Map<string, number>();
  for (const pair of pairs.values()) {
    const a = indexes.get(pair.source)!, b = indexes.get(pair.target)!;
    bits[a * wordsPerRow + (b >>> 5)]! |= 1 << (b & 31);
    bits[b * wordsPerRow + (a >>> 5)]! |= 1 << (a & 31);
    degrees.set(pair.source, (degrees.get(pair.source) ?? 0) + 1); degrees.set(pair.target, (degrees.get(pair.target) ?? 0) + 1);
  }
  for (const leaf of leaves) leaf.relationshipCount = degrees.get(leaf.id) ?? 0;
  const seen = new Map<string, number>(), edges: OpportunityJobBundlingEdge[] = [];
  const ordered = [...pairs.values()].sort((a, b) => b.sharedTopicIds.length - a.sharedTopicIds.length || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  for (const pair of ordered) {
    const sourceCount = seen.get(pair.source) ?? 0, targetCount = seen.get(pair.target) ?? 0;
    seen.set(pair.source, sourceCount + 1); seen.set(pair.target, targetCount + 1);
    if (sourceCount >= incidentLimit && targetCount >= incidentLimit) continue;
    const source = routedLeaves.get(pair.source)!, target = routedLeaves.get(pair.target)!, route = hierarchyRoute(source, target);
    edges.push({ id: JSON.stringify([pair.source, pair.target]), source: pair.source, target: pair.target,
      sharedTopicIds: pair.sharedTopicIds.sort(), sharedTopicCount: pair.sharedTopicIds.length, groupIndex: source.groupIndex,
      route: route.map(node => node.id), path: bundledPath(route, strength) });
  }
  return { radius, leaves, edges, groups, relationshipCount: pairs.size, adjacency: { ids, wordsPerRow, bits } };
}
