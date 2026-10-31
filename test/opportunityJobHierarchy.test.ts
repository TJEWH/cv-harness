import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityJobHierarchy } from '../src/features/opportunities/domain/opportunityJobHierarchy';
import { clusterOpportunityJobs } from '../src/features/opportunities/domain/opportunityJobKMeans';
import { opportunityJobClusterCount } from '../src/features/opportunities/domain/opportunityJobInterest';
import type { OpportunityInsightJob } from '../src/features/opportunities/domain/opportunityInsights';
import type { OpportunityTopicHierarchyNode } from '../src/features/opportunities/domain/opportunityTopicHierarchy';
import { buildOpportunityJobGraph, opportunityJobGraphNodes } from '../src/features/opportunities/domain/opportunityJobGraph';
import { prepareOpportunityJobTopics, type PreparedOpportunityJobTopicEvidence } from '../src/features/opportunities/domain/opportunityJobTopicSimilarity';

const job = (id: string, topicIds: string[], interestScore = 9): OpportunityInsightJob => ({
  id, title: id, institution: null, country: null, addedAt: null, currentFit: 8, interestScore,
  explicitInterest: true, highInterest: interestScore >= 8, mismatch: false, topicIds, avoidedTopicIds: [], reasons: [],
});
function members(node: OpportunityTopicHierarchyNode): string[] {
  const result: string[] = [], pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.topicId) result.push(current.topicId);
    else if (current.children) pending.push(...current.children);
  }
  return result.sort();
}
function hierarchy(jobs: OpportunityInsightJob[], count = 1, prepared = prepareOpportunityJobTopics({ jobs })) {
  const graph = buildOpportunityJobGraph({ jobs }, 0, { prepared });
  const partition = clusterOpportunityJobs(jobs, prepared, count);
  return buildOpportunityJobHierarchy(jobs, graph.nodes, prepared, graph.links, partition.groups);
}
function firstMerge(forest: OpportunityTopicHierarchyNode[]): OpportunityTopicHierarchyNode {
  const pending = [...forest];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.count === 2) return current;
    if (current.children) pending.push(...current.children);
  }
  throw new Error('No two-job merge');
}
function assertCommonMetadata(forest: OpportunityTopicHierarchyNode[], prepared: PreparedOpportunityJobTopicEvidence) {
  const pending = [...forest];
  while (pending.length) {
    const node = pending.pop()!, rows = members(node).map(id => prepared.jobs.get(id.slice(4))!);
    const common = (field: 'topicIds' | 'featureIds') => rows[0]![field].filter(id => rows.every(row => row[field].includes(id))).sort();
    assert.deepEqual(node.sharedTopicIds, common('topicIds'));
    assert.deepEqual(node.sharedTopicGroupIds, common('featureIds'));
    assert.equal(node.sharedTopicCount, common('featureIds').length);
    if (node.children) {
      assert(node.children.every(child => child.affinity >= node.affinity));
      pending.push(...node.children);
    }
  }
}

test('each requested k-means group has one balanced hierarchy tree and retains every job', () => {
  const jobs = Array.from({ length: 12 }, (_, index) => job(String(index).padStart(2, '0'), index === 11 ? [] : [index < 8 ? 'acoustics' : 'robotics']));
  const prepared = prepareOpportunityJobTopics({ jobs }), allIds = jobs.map(row => `job:${row.id}`).sort();
  for (let count = 1; count <= 10; count++) {
    const partition = clusterOpportunityJobs(jobs, prepared, count), forest = hierarchy(jobs, count, prepared);
    assert.equal(forest.length, count);
    assert.deepEqual(forest.map(members), partition.groups, 'average-link presentation cannot move jobs between k-means groups');
    assert.deepEqual(forest.flatMap(members).sort(), allIds);
    assert(Math.max(...forest.map(root => root.count)) - Math.min(...forest.map(root => root.count)) <= 1);
    assertCommonMetadata(forest, prepared);
  }
  assert.equal(buildOpportunityJobHierarchy(jobs).length, 5, 'direct callers also default to five balanced groups');
  assert.deepEqual(buildOpportunityJobHierarchy([]), []);
  assert.equal(buildOpportunityJobHierarchy([job('only', [])]).length, 1);
});

test('requested count validation defaults to five and clamps to the eligible cohort', () => {
  assert.equal(opportunityJobClusterCount(), 5);
  assert.equal(opportunityJobClusterCount(NaN), 5);
  assert.equal(opportunityJobClusterCount(-2), 1);
  assert.equal(opportunityJobClusterCount(20), 10);
  assert.equal(opportunityJobClusterCount(7, 3), 3);
  assert.equal(opportunityJobClusterCount(5, 0), 1, 'empty controls keep a valid minimum; the model returns no groups');
  assert.equal(hierarchy([job('a', []), job('b', [])], 5).length, 2);
});

test('complete job overlap drives average-link merge order and heights only within the fixed group', () => {
  const jobs = [job('a', ['one', 'two']), job('b', ['one', 'two', 'three']), job('c', ['two', 'three'])];
  const forest = hierarchy(jobs), initial = firstMerge(forest);
  assert.deepEqual(members(initial), ['job:a', 'job:b']);
  assert.equal(initial.affinity, 2 / 3);
  assert(Math.abs(forest[0]!.affinity - .5) < 1e-12, 'missing and weaker pair similarity enter the all-pair average');
  assert.deepEqual(forest[0]!.sharedTopicIds, ['two']);
});

test('pairwise overlap chains never invent a theme common to every job', () => {
  const jobs = [job('a', ['ab', 'ac']), job('b', ['ab', 'bc']), job('c', ['ac', 'bc'])];
  const forest = hierarchy(jobs);
  assert.equal(forest.length, 1);
  assert(forest[0]!.affinity > 0);
  assert.deepEqual(forest[0]!.sharedTopicIds, []);
  assert.equal(forest[0]!.sharedTopicCount, 0);
  assert.deepEqual(members(forest[0]!), ['job:a', 'job:b', 'job:c']);
});

test('hierarchy partitions and metadata are deterministic without mutating input or prepared evidence', () => {
  const jobs = [job('a', ['two', 'one', 'one']), job('b', ['one', 'two']), job('c', ['one']), job('d', ['unrelated']), job('empty', [])];
  const before = structuredClone(jobs), prepared = prepareOpportunityJobTopics({ jobs }), snapshot = structuredClone(prepared);
  for (let count = 1; count <= 5; count++) {
    const forest = hierarchy(jobs, count, prepared);
    assert.deepEqual(hierarchy([...jobs].reverse().map(row => ({ ...row, topicIds: [...row.topicIds].reverse() })), count), forest);
    assertCommonMetadata(forest, prepared);
    const ids: string[] = [], pending = [...forest];
    while (pending.length) { const node = pending.pop()!; ids.push(node.id); if (node.children) pending.push(...node.children); }
    assert.equal(new Set(ids).size, ids.length, 'each group namespaces its internal hierarchy nodes');
  }
  assert.deepEqual(jobs, before); assert.deepEqual(prepared, snapshot);
});

test('the supplied node cohort controls eligibility at lower minimum interest', () => {
  const jobs = [job('high', ['same'], 9), job('medium', ['same'], 6), job('low', ['same'], 1)];
  assert.deepEqual(buildOpportunityJobHierarchy(jobs).flatMap(members), ['job:high']);
  const nodes = opportunityJobGraphNodes({ jobs }, 6);
  assert.deepEqual(buildOpportunityJobHierarchy(jobs, nodes).flatMap(members), ['job:high', 'job:medium']);
  assert.deepEqual(buildOpportunityJobHierarchy(jobs, []), []);
});

test('related names contribute without becoming exact shared labels', () => {
  const jobs = [job('a', ['Acoustics']), job('b', ['Acoustic sensing']), job('c', ['Biology'])];
  const paired = hierarchy(jobs, 2).find(node => node.count === 2)!;
  assert.deepEqual(members(paired), ['job:a', 'job:b']);
  assert.deepEqual(paired.sharedTopicIds, []);
  assert.equal(paired.sharedTopicCount, 1);
  assert.equal(paired.relatedTopicGroupIds!.length, 1);
  assert.equal(hierarchy(jobs)[0]!.affinity, 0, 'grouping unrelated records does not claim topic evidence');
});

test('exclusions remove generic influence and retain topicless jobs with zero similarity', () => {
  const jobs = [job('a', ['generic', 'acoustics']), job('b', ['generic', 'biology']), job('empty', ['generic'])];
  const prepared = prepareOpportunityJobTopics({ jobs }, { excludedTopicIds: ['generic'] });
  const forest = hierarchy(jobs, 1, prepared);
  assert.equal(forest[0]!.affinity, 0);
  assert.deepEqual(forest[0]!.sharedTopicIds, []);
  const separated = hierarchy(jobs, 3, prepared);
  assert.deepEqual(separated.map(members), [['job:a'], ['job:b'], ['job:empty']]);
  assert.deepEqual(separated.find(node => node.topicId === 'job:empty')!.sharedTopicGroupIds, []);
  assert.deepEqual(jobs[2]!.topicIds, ['generic'], 'clustering never mutates full job context');
});

test('feedback sentiment can outweigh raw overlap in the within-group dendrogram', () => {
  const positive = (target: string) => ({ category: 'topic' as const, polarity: 'positive' as const, target });
  const negative = (target: string) => ({ category: 'topic' as const, polarity: 'negative' as const, target });
  const a = { ...job('a', ['one', 'two', 'three']), reasons: [positive('one'), positive('two')] };
  const b = { ...job('b', ['one', 'two']), reasons: [negative('one'), negative('two')] };
  const c = { ...job('c', ['one']), reasons: [positive('one')] };
  const jobs = [a, b, c, job('unrelated', ['other'])];
  assert.deepEqual(members(firstMerge(hierarchy(jobs))), ['job:a', 'job:c']);
  assert.deepEqual(members(firstMerge(hierarchy(jobs.map(row => ({ ...row, reasons: [] }))))), ['job:a', 'job:b']);
  assert.equal(hierarchy(jobs)[0]!.affinity, 0, 'equal whole-job sentiment cannot connect unrelated topics');
});

test('supplied groups determine membership even when a stronger relationship crosses groups', () => {
  const jobs = [job('a', ['same']), job('b', ['same']), job('c', ['other']), job('empty', [])];
  const graph = buildOpportunityJobGraph({ jobs }), prepared = prepareOpportunityJobTopics({ jobs });
  const groups = [['job:a', 'job:empty'], ['job:b', 'job:c']];
  const forest = buildOpportunityJobHierarchy(jobs, graph.nodes, prepared, graph.links, groups);
  assert.deepEqual(forest.map(members), groups);
  assert(forest.every(root => root.affinity === 0));
  assertCommonMetadata(forest, prepared);
  assert.deepEqual(buildOpportunityJobHierarchy(jobs, graph.nodes, prepared, graph.links, [['job:a']]).flatMap(members).sort(), jobs.map(row => `job:${row.id}`).sort(), 'incomplete partitions cannot lose records');
});

test('a dense 500-job hierarchy preserves all evidence in five balanced groups', () => {
  const jobs = Array.from({ length: 500 }, (_, index) => job(`dense-${String(index).padStart(3, '0')}`, ['a', 'b', 'c', 'd', 'e']));
  const forest = buildOpportunityJobHierarchy(jobs);
  assert.equal(forest.length, 5);
  assert(forest.every(root => root.count === 100));
  assert(forest.every(root => root.affinity === 1));
  for (const root of forest) assert.deepEqual(root.sharedTopicIds, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(new Set(forest.flatMap(members)).size, 500);
});
