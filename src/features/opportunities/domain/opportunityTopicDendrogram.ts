import type { OpportunityTopicHierarchyNode } from './opportunityTopicHierarchy';

export interface OpportunityDendrogramLeaf { id: string; label: string; x: number; y: number }
export interface OpportunityDendrogramBranch { id: string; affinity: number; path: string }
export interface OpportunityTopicDendrogram {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  labelWidth: number;
  leafHeight: number;
  leaves: OpportunityDendrogramLeaf[];
  branches: OpportunityDendrogramBranch[];
}

/** Projects each independent hierarchy root into a real dendrogram, without synthetic joins. */
export function projectOpportunityTopicDendrogram(forest: OpportunityTopicHierarchyNode[], availableWidth: number, options: { entityKind?: 'topic' | 'job' } = {}): OpportunityTopicDendrogram {
  const width = Math.max(300, Number.isFinite(availableWidth) ? availableWidth : 680);
  const isNarrow = width < 600, isJob = options.entityKind === 'job';
  const labelWidth = isJob
    ? isNarrow ? Math.min(width - 128, Math.max(180, width * .6)) : Math.min(640, width * .48)
    : isNarrow ? Math.max(150, width * .52) : Math.min(280, Math.max(200, width * .34));
  const plotLeft = 16, plotRight = width - labelWidth - 12;
  const rowHeight = isNarrow ? isJob ? 52 : 44 : 32, rootGap = 18;
  const leafHeight = isNarrow ? rowHeight : 30;
  const leaves: OpportunityDendrogramLeaf[] = [], branches: OpportunityDendrogramBranch[] = [];
  const points = new Map<string, { x: number; y: number }>();
  let nextY = 58;
  const affinityX = (affinity: number) => plotLeft + Math.max(0, Math.min(1, Number.isFinite(affinity) ? affinity : 0)) * (plotRight - plotLeft);
  for (const root of forest) {
    const pending = [{ node: root, visited: false }];
    while (pending.length) {
      const { node, visited } = pending.pop()!;
      if (node.topicId) {
        const point = { x: plotRight, y: nextY };
        points.set(node.id, point); leaves.push({ id: node.topicId, label: node.label, ...point });
        nextY += rowHeight;
      } else if (node.children && !visited) {
        pending.push({ node, visited: true }, { node: node.children[1], visited: false }, { node: node.children[0], visited: false });
      } else if (node.children) {
        const a = points.get(node.children[0].id)!, b = points.get(node.children[1].id)!;
        const point = { x: affinityX(node.affinity), y: (a.y + b.y) / 2 };
        points.set(node.id, point);
        branches.push({ id: node.id, affinity: node.affinity, path: `M${a.x} ${a.y}H${point.x}V${b.y}H${b.x}` });
      }
    }
    nextY += rootGap;
  }
  return { width, height: Math.max(88, nextY - rootGap + 12), plotLeft, plotRight, labelWidth, leafHeight, leaves, branches };
}
