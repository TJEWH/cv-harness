import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOpportunityTopicDendrogram } from '../src/features/opportunities/domain/opportunityTopicDendrogram';
import type { OpportunityTopicHierarchyNode } from '../src/features/opportunities/domain/opportunityTopicHierarchy';

const leaf = (id: string): OpportunityTopicHierarchyNode => ({ id, topicId: id, label: id, count: 1, affinity: 1, children: null });
const merge = (id: string, a: OpportunityTopicHierarchyNode, b: OpportunityTopicHierarchyNode, affinity: number): OpportunityTopicHierarchyNode => ({ id, topicId: null, label: a.label, count: a.count + b.count, affinity, children: [a, b] });

const fixture = () => [merge('field-a', merge('strong', leaf('acoustics'), leaf('acoustic sensing'), .8), leaf('acoustic history'), .1), merge('field-b', leaf('robotics'), leaf('control'), .6), leaf('unrelated')];

test('dendrogram positions stronger merges nearer leaf labels and preserves every topic exactly once', () => {
  const forest = fixture(), original = structuredClone(forest), diagram = projectOpportunityTopicDendrogram(forest, 800);
  assert.deepEqual(diagram.leaves.map(node => node.id), ['acoustics', 'acoustic sensing', 'acoustic history', 'robotics', 'control', 'unrelated']);
  assert(diagram.leaves.every(node => node.x === diagram.plotRight));
  assert.equal(diagram.branches.length, 3);
  const strong = diagram.branches.find(node => node.id === 'strong')!, weak = diagram.branches.find(node => node.id === 'field-a')!;
  assert(strong.path.includes(`H${diagram.plotLeft + .8 * (diagram.plotRight - diagram.plotLeft)}`));
  assert(weak.path.includes(`H${diagram.plotLeft + .1 * (diagram.plotRight - diagram.plotLeft)}`));
  assert.deepEqual(forest, original);
});

test('independent roots have vertical separation and never receive a synthetic connecting branch', () => {
  const diagram = projectOpportunityTopicDendrogram(fixture(), 800);
  const leaves = diagram.leaves;
  assert(leaves[3]!.y - leaves[2]!.y > leaves[1]!.y - leaves[0]!.y);
  assert(leaves[5]!.y - leaves[4]!.y > leaves[4]!.y - leaves[3]!.y);
  assert.deepEqual(diagram.branches.map(node => node.id).sort(), ['field-a', 'field-b', 'strong']);
});

test('a mobile panel keeps branches and selectable leaf labels in the initial viewport', () => {
  const diagram = projectOpportunityTopicDendrogram(fixture(), 342);
  assert.equal(diagram.width, 342);
  assert(diagram.plotRight - diagram.plotLeft >= 100);
  assert(diagram.labelWidth >= 170);
  assert(diagram.plotRight + 8 + diagram.labelWidth <= diagram.width);
  assert(diagram.leaves[1]!.y - diagram.leaves[0]!.y >= 44, 'touch-sized leaf rows remain distinct');
});

test('job titles share the expanded desktop width while topic labels keep their existing allocation', () => {
  const forest = fixture(), jobs = projectOpportunityTopicDendrogram(forest, 1088, { entityKind: 'job' });
  const topics = projectOpportunityTopicDendrogram(forest, 1088);
  assert(jobs.labelWidth >= 500, 'a full-width job hierarchy makes room for long job titles');
  assert(jobs.labelWidth / jobs.width >= .4 && jobs.labelWidth / jobs.width <= .5);
  assert(jobs.plotRight - jobs.plotLeft >= 500, 'the similarity axis retains useful resolution');
  assert.equal(jobs.leafHeight, 30);
  assert.equal(topics.labelWidth, 280);
  assert.deepEqual(projectOpportunityTopicDendrogram(forest, 1088, { entityKind: 'topic' }), topics);
  assert.equal(projectOpportunityTopicDendrogram(forest, 2000, { entityKind: 'job' }).labelWidth, 640, 'very wide plots retain branch space');
});

test('narrow job hierarchies reserve two-line title rows and keep branches, scores, and labels in view', () => {
  for (const width of [300, 342, 390, 599]) {
    const jobs = projectOpportunityTopicDendrogram(fixture(), width, { entityKind: 'job' });
    const topics = projectOpportunityTopicDendrogram(fixture(), width);
    assert.equal(jobs.width, width);
    assert(jobs.plotRight - jobs.plotLeft >= 100, `branches remain readable at ${width}px`);
    assert(jobs.labelWidth > topics.labelWidth, `jobs get more title space at ${width}px`);
    assert(jobs.plotRight + 8 + jobs.labelWidth <= width);
    assert.equal(jobs.leafHeight, 52);
    assert(jobs.leaves[1]!.y - jobs.leaves[0]!.y >= jobs.leafHeight);
    assert.equal(topics.leafHeight, 44);
    assert.equal(topics.labelWidth, Math.max(150, width * .52));
  }
});

test('deep hierarchy projection uses an iterative traversal and never loses isolated or deeply nested leaves', () => {
  let tree = leaf('0');
  for (let index = 1; index < 2500; index++) tree = merge(`branch-${index}`, tree, leaf(String(index)), 1 / (index + 1));
  const diagram = projectOpportunityTopicDendrogram([tree, leaf('isolated')], 800);
  assert.equal(diagram.leaves.length, 2501);
  assert.equal(diagram.branches.length, 2499);
  assert.equal(diagram.leaves.at(-1)!.id, 'isolated');
  assert(Number.isFinite(diagram.height));
});

test('empty and single-topic forests stay valid without fabricated branches', () => {
  assert.equal(projectOpportunityTopicDendrogram([], 342).branches.length, 0);
  const diagram = projectOpportunityTopicDendrogram([leaf('single')], 342);
  assert.equal(diagram.leaves.length, 1);
  assert.equal(diagram.branches.length, 0);
  assert(diagram.height > diagram.leaves[0]!.y);
});
