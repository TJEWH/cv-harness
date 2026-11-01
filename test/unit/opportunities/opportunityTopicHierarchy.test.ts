import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityTopicHierarchy, type OpportunityTopicHierarchyNode } from '../../../src/features/opportunities/domain/opportunityTopicHierarchy';
import { opportunityGraphLinkWeight, type OpportunityGraphLayoutInput, type OpportunityGraphNode } from '../../../src/features/opportunities/domain/opportunityGraphLayout';

const topic = (id: string, count = 12): OpportunityGraphNode => ({ id, label: id, kind: 'topic', radius: 8, highInterestCount: count,
  matchingJobCount: count, lowInterestCount: 0, avoidedCount: 0, positiveReasonCount: 0, mismatch: false, avoided: false });
const leaves = (forest: OpportunityTopicHierarchyNode[]) => {
  const result: string[] = [], pending = [...forest];
  while (pending.length) { const node = pending.pop()!; if (node.topicId) result.push(node.topicId); else if (node.children) pending.push(...node.children); }
  return result.sort();
};
const fixture = (): OpportunityGraphLayoutInput => ({ dimensions: 2,
  nodes: ['acoustics', 'acoustic sensing', 'robotics', 'robot control', 'unrelated'].map(id => topic(id)),
  links: [{ source: 'acoustics', target: 'acoustic sensing', kind: 'cooccurrence', weight: 10 },
    { source: 'robotics', target: 'robot control', kind: 'cooccurrence', weight: 9 },
    { source: 'acoustic sensing', target: 'robotics', kind: 'cooccurrence', weight: 1 }],
});

test('hierarchy nests stronger within-field relationships under their weaker bridge', () => {
  const input = fixture(), original = structuredClone(input), forest = buildOpportunityTopicHierarchy(input);
  assert.equal(forest.length, 2, 'unsupported topic stays outside the connected field');
  const connected = forest.find(node => node.children)!;
  assert.deepEqual(connected.children!.map(node => leaves([node])).sort(), [['acoustic sensing', 'acoustics'], ['robot control', 'robotics']]);
  assert(connected.children!.every(node => node.affinity > connected.affinity), 'the weaker bridge must not obscure the supported field relationships');
  assert.deepEqual(leaves(forest), input.nodes.map(node => node.id).sort());
  assert.deepEqual(input, original, 'hierarchy cannot alter evidence');
});

test('hierarchy is deterministic across repeated runs, record ordering, and 2D/3D layout state', () => {
  const input = fixture(), baseline = buildOpportunityTopicHierarchy(input);
  assert.deepEqual(buildOpportunityTopicHierarchy(input), baseline);
  assert.deepEqual(buildOpportunityTopicHierarchy({ ...input, dimensions: 3, nodes: [...input.nodes].reverse(), links: [...input.links].reverse() }), baseline);
});

test('isolated topics, missing edges and self links never fabricate a joined topic root', () => {
  const nodes = [topic('a'), topic('b')];
  const forest = buildOpportunityTopicHierarchy({ dimensions: 2, nodes,
    links: [{ source: 'a', target: 'missing', kind: 'semantic', weight: 1 }, { source: 'a', target: 'a', kind: 'cooccurrence', weight: 1 }] });
  assert.equal(forest.length, 2);
  assert(forest.every(node => node.children === null));
  assert.deepEqual(leaves(forest), ['a', 'b']);
  assert.deepEqual(buildOpportunityTopicHierarchy({ dimensions: 2, nodes: [], links: [] }), []);
});

test('small-support outliers influence grouping less without changing observed counts or dislike annotations', () => {
  const supported = topic('supported', 20), rare = topic('rare', 1), repeated = topic('repeated', 8);
  const nodes = new Map([supported, rare, repeated].map(node => [node.id, node]));
  const edge = { source: 'supported', target: 'rare', kind: 'cooccurrence' as const, weight: 1 };
  assert(opportunityGraphLinkWeight(edge, nodes) < opportunityGraphLinkWeight({ ...edge, target: 'repeated' }, nodes));
  assert.equal(edge.weight, 1);
  assert.equal(rare.matchingJobCount, 1);
  assert.equal(rare.avoided, false);
});

test('word-family hints stay separate evidence and form a hierarchy without inventing unrelated relationships', () => {
  const nodes = [topic('acoustics', 5), topic('acoustic sensing', 5), topic('unrelated', 5)];
  const input: OpportunityGraphLayoutInput = { dimensions: 2, nodes,
    links: [{ source: 'acoustics', target: 'acoustic sensing', kind: 'semantic', similarity: .5, weight: .7 }] };
  const forest = buildOpportunityTopicHierarchy(input);
  assert.equal(forest.length, 2);
  assert.equal(forest.filter(node => node.children).length, 1);
  assert(forest.find(node => node.children)!.affinity < .5);
  assert.equal(input.links[0]!.kind, 'semantic');
  assert.deepEqual(leaves(forest), nodes.map(node => node.id).sort());
});

test('a large sparse forest retains every topic without recursive all-pairs construction', () => {
  const nodes = Array.from({ length: 600 }, (_, index) => topic(`topic-${String(index).padStart(4, '0')}`, 4));
  const links: OpportunityGraphLayoutInput['links'] = [];
  for (let index = 0; index + 1 < nodes.length; index += 3) links.push({ source: nodes[index]!.id, target: nodes[index + 1]!.id, kind: 'cooccurrence', weight: 3 });
  const forest = buildOpportunityTopicHierarchy({ dimensions: 2, nodes, links });
  assert.equal(forest.length, 400);
  assert.equal(leaves(forest).length, nodes.length);
  assert.equal(new Set(leaves(forest)).size, nodes.length);
});
