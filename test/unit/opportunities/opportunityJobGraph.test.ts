import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareOpportunityJobTopics } from '../../../src/features/opportunities/domain/opportunityJobTopicSimilarity';
import { buildOpportunityJobGraph } from '../../../src/features/opportunities/domain/opportunityJobGraph';
import { layoutOpportunityGraph, opportunityGraphCommunities } from '../../../src/features/opportunities/domain/opportunityGraphLayout';
import { buildOpportunityJobHierarchy } from '../../../src/features/opportunities/domain/opportunityJobHierarchy';
import { clusterOpportunityJobs } from '../../../src/features/opportunities/domain/opportunityJobKMeans';
import type { OpportunityTopicHierarchyNode } from '../../../src/features/opportunities/domain/opportunityTopicHierarchy';
import type { OpportunityInsightGraph, OpportunityInsightJob } from '../../../src/features/opportunities/domain/opportunityInsights';

const job = (id: string, topicIds: string[], overrides: Partial<OpportunityInsightJob> = {}): OpportunityInsightJob => ({
  id, title: id, institution: null, country: null, addedAt: null, currentFit: 8, interestScore: 9,
  explicitInterest: true, highInterest: true, mismatch: false, topicIds, avoidedTopicIds: [], reasons: [], ...overrides,
});
const graph = (jobs: OpportunityInsightJob[]): OpportunityInsightGraph => ({ topics: [], edges: [], jobs });
const members = (root: OpportunityTopicHierarchyNode): string[] => root.topicId ? [root.topicId] : root.children!.flatMap(members).sort();

test('job clusters use explicit high interest and preserve isolated or topicless jobs', () => {
  const result = buildOpportunityJobGraph(graph([
    job('liked', ['a']), job('isolated', ['z']), job('topicless', []),
    job('low', ['a'], { highInterest: false, interestScore: 2 }),
    job('submission', ['a'], { explicitInterest: false }),
    job('unknown', ['a'], { highInterest: false, explicitInterest: false, interestScore: null }),
  ]));
  assert.equal(result.entityKind, 'job');
  assert.deepEqual(result.nodes.map(node => node.id), ['job:isolated', 'job:liked', 'job:topicless']);
  assert.equal(result.links.length, 0);
  const layout = layoutOpportunityGraph({ ...result, dimensions: 2 });
  assert.equal(layout.length, 3);
  assert(layout.every(position => position.community !== -1));
  assert.equal(new Set(layout.map(position => position.community)).size, 3);
});

test('job overlap deduplicates exact topic sets and separately identifies related-wording support', () => {
  const result = buildOpportunityJobGraph(graph([
    job('a', ['acoustics', 'sensing', 'sensing', 'simulation']),
    job('b', ['acoustics', 'sensing', 'control']),
    job('c', ['acoustic sensing']),
  ]));
  assert.equal(result.nodes.find(node => node.id === 'job:a')!.topicCount, 3);
  assert.deepEqual(result.links.find(link => link.source === 'job:a' && link.target === 'job:b'), { source: 'job:a', target: 'job:b', kind: 'job-overlap', weight: .5, similarity: .5, sharedTopicCount: 2, inferredTopicCount: 0, semanticSimilarity: 1, sentimentSimilarity: 1 });
  assert.equal(result.links.filter(link => link.inferredTopicCount === 1 && link.sharedTopicCount === 0).length, 2, 'related names contribute inferred support, never fabricated exact shared topics');
  assert.equal(result.nodes.find(node => node.id === 'job:b')!.interestScore, 9);
});

test('job graph evidence, communities and layout are deterministic and leave input untouched', () => {
  const input = graph([job('a', ['one', 'two']), job('b', ['two', 'one']), job('c', ['three']), job('d', ['three'])]);
  const snapshot = structuredClone(input), result = buildOpportunityJobGraph(input);
  const reversed = buildOpportunityJobGraph({ ...input, jobs: [...input.jobs].reverse().map(value => ({ ...value, topicIds: [...value.topicIds].reverse() })) });
  assert.deepEqual(reversed, result);
  assert.deepEqual(input, snapshot);
  const layoutInput = { ...result, dimensions: 2 as const };
  const communities = opportunityGraphCommunities(layoutInput);
  assert.equal(communities.get('job:a'), communities.get('job:b'));
  assert.equal(communities.get('job:c'), communities.get('job:d'));
  assert.notEqual(communities.get('job:a'), communities.get('job:c'));
  assert.deepEqual(layoutOpportunityGraph(layoutInput), layoutOpportunityGraph({ ...reversed, dimensions: 2 }));
});

test('job dendrogram records similarity and zero joins without claiming a shared theme', () => {
  const jobs = [job('a', ['one', 'two']), job('b', ['two', 'three']), job('c', ['unrelated'])];
  const result = buildOpportunityJobGraph(graph(jobs));
  const prepared = prepareOpportunityJobTopics({ jobs });
  const forest = buildOpportunityJobHierarchy(jobs, result.nodes, prepared, result.links, [jobs.map(row => `job:${row.id}`)]);
  assert.equal(forest.length, 1);
  assert.equal(forest[0]!.affinity, 0);
  assert.deepEqual(forest[0]!.sharedTopicIds, []);
  const groups = buildOpportunityJobHierarchy(jobs, result.nodes, prepared, result.links, clusterOpportunityJobs(jobs, prepared, 2).groups);
  const connected = groups.find(root => root.children)!;
  assert.equal(connected.affinity, 1 / 3);
  assert.deepEqual(connected.sharedTopicIds, ['two']);
  assert.deepEqual(connected.children!.map(child => child.topicId), ['job:a', 'job:b']);
  assert.equal(groups.find(root => !root.children)!.topicId, 'job:c');
});

test('worker task returns complete-cohort positions and hierarchy for the same small evidence', async () => {
  const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
  const jobs = [job('a', ['one', 'two']), job('b', ['two', 'three']), job('isolated', ['different'])];
  const complete = buildOpportunityJobGraph(graph(jobs));
  const request = { generation: 7, nodes: [], links: [], jobs, jobClusterCount: 2, dimensions: 2 as const, entityKind: 'job' as const };
  const network = runOpportunityGraphTask(request);
  assert(!('error' in network));
  assert.equal(network.generation, 7);
  assert.equal(new Set(network.positions.map(point => point.community)).size, 2);
  assert.equal(network.positions.find(point => point.id === 'job:a')!.community, network.positions.find(point => point.id === 'job:b')!.community);
  assert.notEqual(network.positions.find(point => point.id === 'job:a')!.community, network.positions.find(point => point.id === 'job:isolated')!.community);
  const repeated = runOpportunityGraphTask(request);
  assert(!('error' in repeated));
  assert.deepEqual(network.positions, repeated.positions);
  assert(network.hierarchy, 'network and hierarchy share the same partition and within-group trees');
  assert.equal(network.graph!.relationshipCount, 1);
  assert.deepEqual(network.graph!.links, complete.links);
  const hierarchy = runOpportunityGraphTask({ ...request, view: 'hierarchy' });
  assert(!('error' in hierarchy));
  const prepared = prepareOpportunityJobTopics({ jobs });
  assert.deepEqual(hierarchy.hierarchy, buildOpportunityJobHierarchy(jobs, complete.nodes, prepared, complete.links, clusterOpportunityJobs(jobs, prepared, 2).groups));
  assert.deepEqual(hierarchy.hierarchy!.map(members), network.hierarchy.map(members));
});

test('dense 500-job worker pipeline retains all evidence while bounding drawing and exact focus', async () => {
  const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
  const { opportunityJobGraphFocus } = await import('../../../src/features/opportunities/domain/opportunityJobGraph');
  const jobs = Array.from({ length: 500 }, (_, index) => job(`dense-${String(index).padStart(3, '0')}`, ['a', 'b', 'c', 'd', 'e']));
  const request = { generation: 9, nodes: [], links: [], jobs, dimensions: 2 as const, entityKind: 'job' as const };
  const result = runOpportunityGraphTask(request);
  assert(!('error' in result));
  assert.equal(result.positions.length, 500);
  assert(result.positions.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.z === 0));
  assert.equal(new Set(result.positions.map(point => point.community)).size, 5, 'requested count defaults to five even for tied complete evidence');
  assert.deepEqual(result.hierarchy!.map(root => root.count), [100, 100, 100, 100, 100]);
  assert.equal(result.graph!.nodes.length, 500);
  assert.equal(result.graph!.relationshipCount, 124_750, 'all full-set relationships participate in worker layout/clustering');
  assert(result.graph!.links.length <= 4_000, 'drawing uses the union of eight strongest incident links per job');
  assert(result.graph!.links.length < result.graph!.relationshipCount);
  assert.equal(result.graph!.links.reduce((maximum, link) => Math.max(maximum, link.weight), 1), 1, 'bounded drawing maximum needs no spread argument list');
  assert.equal(opportunityJobGraphFocus(result.graph!.adjacency, 'job:dense-499')!.size, 500, 'focus includes complete observed neighbors even when drawing is sampled');
  assert.equal(result.graph!.adjacency.bits.byteLength, 32_000, 'complete adjacency remains compact for transfer');
  assert.deepEqual(request.nodes, []);
  assert.deepEqual(request.links, [], 'main-thread request never constructs dense links');
});

test('job graph minimum interest defaults to 8 and filters explicit scores inclusively at custom thresholds', () => {
  const input = graph([job('low', ['a'], { interestScore: 2, highInterest: false }), job('middle', ['a'], { interestScore: 6.4, highInterest: false }),
    job('high', ['a'], { interestScore: 8 }), job('top', ['b'], { interestScore: 9.2 }),
    job('unknown', ['a'], { interestScore: null, explicitInterest: false }), job('submission', ['a'], { interestScore: 9, explicitInterest: false })]);
  assert.deepEqual(buildOpportunityJobGraph(input).nodes.map(node => node.id), ['job:high', 'job:top']);
  assert.deepEqual(buildOpportunityJobGraph(input, 6.4).nodes.map(node => node.id), ['job:high', 'job:middle', 'job:top']);
  assert.equal(buildOpportunityJobGraph(input, 6.4).links.length, 1);
  assert.equal(buildOpportunityJobGraph(input, 0).nodes.length, 4, 'unknown and submission-only remain outside even at zero');
  assert.equal(buildOpportunityJobGraph(input, 10).nodes.length, 0);
  assert.deepEqual(buildOpportunityJobGraph(input, NaN), buildOpportunityJobGraph(input), 'invalid thresholds use the default');
});

test('worker job cohort and hierarchy honor the same minimum-interest request', async () => {
  const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
  const jobs = [job('middle', ['one', 'two'], { interestScore: 6, highInterest: false }), job('high', ['one', 'two'], { interestScore: 8.4 })];
  const request = { generation: 3, nodes: [], links: [], jobs, jobMinimumInterest: 6, dimensions: 2 as const, entityKind: 'job' as const };
  const network = runOpportunityGraphTask(request), hierarchy = runOpportunityGraphTask({ ...request, view: 'hierarchy' });
  assert(!('error' in network) && !('error' in hierarchy));
  assert.equal(network.positions.length, 2); assert.equal(network.graph!.relationshipCount, 1);
  assert.equal(hierarchy.hierarchy!.length, 2); assert.equal(hierarchy.hierarchy!.reduce((sum, root) => sum + root.count, 0), 2);
  assert.deepEqual(hierarchy.graph!.nodes, network.graph!.nodes);
});

test('worker k-means partitions agree across network dimensions and hierarchy, bounded by cohort size', async () => {
  const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
  const jobs = [job('a', ['acoustics']), job('b', ['acoustic sensing']), job('c', ['robotics']), job('empty', [])];
  const request = { generation: 10, nodes: [], links: [], jobs, jobClusterCount: 2, dimensions: 2 as const, entityKind: 'job' as const };
  const network = runOpportunityGraphTask(request), three = runOpportunityGraphTask({ ...request, dimensions: 3 }), hierarchy = runOpportunityGraphTask({ ...request, view: 'hierarchy' });
  assert(!('error' in network) && !('error' in three) && !('error' in hierarchy));
  assert.deepEqual(network.hierarchy, hierarchy.hierarchy);
  assert.deepEqual(three.positions.map(point => [point.id, point.community]), network.positions.map(point => [point.id, point.community]));
  const groups = hierarchy.hierarchy!;
  const community = new Map(network.positions.map(point => [point.id, point.community]));
  assert.equal(new Set(community.values()).size, 2);
  for (const group of groups) {
    const pending = [group], indices = new Set<number>();
    while (pending.length) { const node = pending.pop()!; if (node.topicId) indices.add(community.get(node.topicId)!); else if (node.children) pending.push(...node.children); }
    assert.equal(indices.size, 1);
  }
  for (const [requested, expected] of [[1, 1], [10, 4], [0, 1], [NaN, 4]]) {
    const result = runOpportunityGraphTask({ ...request, jobClusterCount: requested });
    assert(!('error' in result));
    assert.equal(new Set(result.positions.map(point => point.community)).size, expected);
    assert.equal(result.hierarchy!.length, expected);
    assert(Math.max(...result.hierarchy!.map(root => root.count)) - Math.min(...result.hierarchy!.map(root => root.count)) <= 1);
    assert.equal(result.graph!.nodes.length, 4);
    assert.equal(result.graph!.relationshipCount, network.graph!.relationshipCount, 'cluster counts never invent or remove relationship evidence');
  }
});

test('changing worker count reclusters the complete cohort rather than cutting an old tree', async () => {
  const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
  const jobs = Array.from({ length: 13 }, (_, index) => job(String(index).padStart(2, '0'), index < 10 ? ['acoustics'] : index === 12 ? [] : ['biology']));
  const request = { generation: 12, nodes: [], links: [], jobs, dimensions: 2 as const, entityKind: 'job' as const };
  for (const count of [2, 5, 3]) {
    const prepared = prepareOpportunityJobTopics({ jobs }), expected = clusterOpportunityJobs(jobs, prepared, count);
    const network = runOpportunityGraphTask({ ...request, jobClusterCount: count });
    const hierarchy = runOpportunityGraphTask({ ...request, jobClusterCount: count, view: 'hierarchy' });
    assert(!('error' in network) && !('error' in hierarchy));
    assert.deepEqual(network.hierarchy!.map(members), expected.groups);
    assert.deepEqual(hierarchy.hierarchy, network.hierarchy);
    assert.deepEqual(Object.fromEntries(network.positions.map(point => [point.id, point.community])), expected.assignments);
    assert.equal(new Set(network.hierarchy!.flatMap(members)).size, 13);
    assert(Math.max(...network.hierarchy!.map(root => root.count)) - Math.min(...network.hierarchy!.map(root => root.count)) <= 1);
  }
});

test('worker partitions keep excluded topics and previous accounts out of current evidence', async () => {
  const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
  const request = { generation: 1, nodes: [], links: [], dimensions: 2 as const, entityKind: 'job' as const, jobClusterCount: 1 };
  const first = runOpportunityGraphTask({ ...request, jobs: [job('old-account', ['private'])] });
  const jobs = [job('a', ['generic', 'one']), job('b', ['generic', 'two']), job('topicless', ['generic'])];
  const next = runOpportunityGraphTask({ ...request, generation: 2, jobs, jobExcludedTopicIds: ['generic'] });
  assert(!('error' in first) && !('error' in next));
  assert.deepEqual(next.hierarchy!.flatMap(members), ['job:a', 'job:b', 'job:topicless']);
  assert.equal(next.graph!.relationshipCount, 0);
  assert.deepEqual(next.hierarchy![0]!.sharedTopicIds, []);
  assert.equal(next.hierarchy![0]!.affinity, 0);
  assert(!next.positions.some(point => point.id === 'job:old-account'));
});

test('bundling worker shares the balanced hierarchy and connects only retained exact topics', async () => {
  const { runOpportunityGraphTask } = await import('../../../src/features/opportunities/domain/opportunityGraphTask');
  const jobs = [job('a', ['common', 'acoustics']), job('b', ['common', 'acoustic sensing']),
    job('c', ['common', 'acoustics']), job('isolated', []), job('below', ['acoustics'], { interestScore: 7 })];
  const request = { generation: 21, nodes: [], links: [], jobs, jobClusterCount: 2, jobMinimumInterest: 8,
    jobExcludedTopicIds: ['common'], dimensions: 2 as const, entityKind: 'job' as const };
  const hierarchy = runOpportunityGraphTask({ ...request, view: 'hierarchy' });
  const result = runOpportunityGraphTask({ ...request, view: 'bundling' });
  assert(!('error' in hierarchy) && !('error' in result));
  assert.deepEqual(result.positions, [], 'bundling avoids the force-directed layout');
  assert.deepEqual(result.hierarchy, hierarchy.hierarchy, 'the radial routing uses the same balanced job groups');
  assert.deepEqual(result.bundling!.leaves.map(leaf => leaf.id).sort(), ['job:a', 'job:b', 'job:c', 'job:isolated']);
  assert.equal(result.bundling!.groups.length, 2);
  assert.equal(result.bundling!.relationshipCount, 1);
  assert.deepEqual(result.bundling!.edges.map(edge => [edge.source, edge.target, edge.sharedIds]),
    [['job:a', 'job:c', ['acoustics']]], 'inferred related wording never becomes a shared-topic bundle');
  const excluded = runOpportunityGraphTask({ ...request, view: 'bundling', jobExcludedTopicIds: ['common', 'acoustics'] });
  assert(!('error' in excluded));
  assert.equal(excluded.bundling!.relationshipCount, 0);
  assert.equal(excluded.bundling!.leaves.length, 4, 'excluding all shared topics preserves eligible isolated jobs');
  const lowerInterest = runOpportunityGraphTask({ ...request, view: 'bundling', jobMinimumInterest: 7 });
  assert(!('error' in lowerInterest));
  assert.equal(lowerInterest.bundling!.leaves.length, 5);
  assert.equal(lowerInterest.bundling!.relationshipCount, 3, 'the committed interest threshold determines the shared-topic cohort');
});
