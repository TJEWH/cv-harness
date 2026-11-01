import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityJobBundling } from '../../../src/features/opportunities/domain/opportunityJobBundling';
import { opportunityJobGraphFocus } from '../../../src/features/opportunities/domain/opportunityJobGraph';
import type { OpportunityInsightJob } from '../../../src/features/opportunities/domain/opportunityInsights';
import type { OpportunityTopicHierarchyNode } from '../../../src/features/opportunities/domain/opportunityTopicHierarchy';

const job = (id: string, topicIds: string[], interestScore = 9): OpportunityInsightJob => ({
  id, title: `Job ${id}`, institution: null, country: null, addedAt: null, currentFit: 8, interestScore,
  explicitInterest: true, highInterest: interestScore >= 8, mismatch: false, topicIds, avoidedTopicIds: [], reasons: [],
});
const leaf = (id: string): OpportunityTopicHierarchyNode => ({ id: `job:${id}`, topicId: `job:${id}`, label: id, count: 1, affinity: 1, children: null });
const branch = (id: string, a: OpportunityTopicHierarchyNode, b: OpportunityTopicHierarchyNode): OpportunityTopicHierarchyNode => ({
  id, topicId: null, label: a.label, count: a.count + b.count, affinity: .5, children: [a, b],
});

test('only exact canonical shared topics connect jobs; related wording and sentiment never invent edges', () => {
  const rows = [job('a', ['Acoustics', 'robotics', 'robotics']), job('b', ['acoustics', 'robotics']), job('c', ['Acoustic sensing']), job('isolated', [])];
  const diagram = buildOpportunityJobBundling(rows, [branch('ab', leaf('a'), leaf('b')), branch('ci', leaf('c'), leaf('isolated'))]);
  assert.equal(diagram.relationshipCount, 1);
  assert.equal(diagram.edges.length, 1);
  assert.deepEqual(diagram.edges[0]!.sharedTopicIds, ['acoustics', 'robotics']);
  assert.equal(diagram.edges[0]!.sharedTopicCount, 2, 'duplicate aliases cannot add support');
  assert.deepEqual(diagram.leaves.map(row => row.jobId), ['a', 'b', 'c', 'isolated']);
  assert.equal(diagram.leaves.find(row => row.jobId === 'isolated')!.relationshipCount, 0);
  assert.deepEqual(opportunityJobGraphFocus(diagram.adjacency, 'job:a'), new Set(['job:a', 'job:b']));
});

test('exclusions and explicit interest apply before exact overlap without dropping topicless jobs', () => {
  const rows = [job('a', ['generic', 'one']), job('b', ['generic', 'two']), job('medium', ['one'], 6),
    { ...job('unknown', ['one']), explicitInterest: false, interestScore: null }];
  const forest = [branch('ab', leaf('a'), leaf('b')), branch('mu', leaf('medium'), leaf('unknown'))];
  const diagram = buildOpportunityJobBundling(rows, forest, { excludedTopicIds: ['GENERIC', 'one'] });
  assert.deepEqual(diagram.leaves.map(row => row.jobId), ['a', 'b']);
  assert.deepEqual(diagram.leaves.map(row => row.topicCount), [0, 1]);
  assert.equal(diagram.relationshipCount, 0);
  const lower = buildOpportunityJobBundling(rows, forest, { minimumInterest: 6, excludedTopicIds: ['generic'] });
  assert.deepEqual(lower.leaves.map(row => row.jobId), ['a', 'b', 'medium']);
  assert.deepEqual(lower.edges.map(edge => [edge.source, edge.target]), [['job:a', 'job:medium']]);
  assert.deepEqual(rows[0]!.topicIds, ['generic', 'one'], 'full record topics remain unchanged');
});

test('within-group curves follow their common ancestor and cross-group curves pass through the virtual root', () => {
  const rows = [job('a', ['shared']), job('b', ['shared']), job('c', ['shared']), job('d', [])];
  const diagram = buildOpportunityJobBundling(rows, [branch('left', leaf('a'), leaf('b')), branch('right', leaf('c'), leaf('d'))]);
  const inside = diagram.edges.find(edge => edge.source === 'job:a' && edge.target === 'job:b')!;
  assert.deepEqual(inside.route, ['job:a', diagram.groups[0]!.id, 'job:b']);
  const across = diagram.edges.find(edge => edge.source === 'job:a' && edge.target === 'job:c')!;
  assert.deepEqual(across.route, ['job:a', diagram.groups[0]!.id, 'job-bundling:root', diagram.groups[1]!.id, 'job:c']);
  assert(inside.path.includes('Q'), 'ancestor route is drawn as a smooth curve');
  assert(across.path.includes('Q'));
  assert.deepEqual(diagram.groups.map(group => group.count), [2, 2]);
  for (const row of diagram.leaves) {
    assert(Math.abs(Math.hypot(row.x, row.y) - diagram.radius) < 1e-9);
    assert(Math.abs(row.x - Math.sin(row.angle) * diagram.radius) < 1e-9);
    assert(Math.abs(row.y + Math.cos(row.angle) * diagram.radius) < 1e-9);
  }
});

test('radial geometry is deterministic, finite and serializable without mutating the hierarchy', () => {
  const rows = [job('a', ['one', 'two']), job('b', ['one']), job('c', ['two'])];
  const forest = [branch('all', branch('ab', leaf('a'), leaf('b')), leaf('c'))];
  const before = structuredClone({ rows, forest });
  const diagram = buildOpportunityJobBundling(rows, forest, { radius: 280 });
  assert.deepEqual(buildOpportunityJobBundling([...rows].reverse().map(row => ({ ...row, topicIds: [...row.topicIds].reverse() })), forest, { radius: 280 }), diagram);
  assert.deepEqual(structuredClone(diagram), diagram);
  assert.deepEqual({ rows, forest }, before);
  for (const edge of diagram.edges) assert(!/NaN|Infinity/u.test(edge.path));
  assert(diagram.groups[0]!.startAngle >= 0);
  assert(diagram.groups[0]!.endAngle < Math.PI * 2);
});

test('empty, singleton and stale hierarchies preserve the complete eligible cohort', () => {
  const empty = buildOpportunityJobBundling([], []);
  assert.deepEqual(empty.leaves, []); assert.deepEqual(empty.edges, []); assert.deepEqual(empty.groups, []);
  assert.equal(empty.adjacency.bits.length, 0);
  const only = buildOpportunityJobBundling([job('only', [])], []);
  assert.equal(only.leaves.length, 1); assert.equal(only.groups.length, 1); assert.equal(only.edges.length, 0);
  assert.equal(only.leaves[0]!.label, 'Job only');
  const stale = [branch('stale', leaf('a'), leaf('gone')), leaf('a')];
  const diagram = buildOpportunityJobBundling([job('a', ['one']), job('b', ['one'])], stale);
  assert.deepEqual(diagram.leaves.map(row => row.jobId), ['a', 'b']);
  assert.equal(new Set(diagram.leaves.map(row => row.id)).size, 2);
  assert.equal(diagram.relationshipCount, 1);
  assert(diagram.edges.every(edge => !/NaN|Infinity/u.test(edge.path)));
});

test('dense drawings are bounded while complete exact adjacency preserves omitted neighbours', () => {
  const rows = Array.from({ length: 100 }, (_, index) => job(String(index).padStart(3, '0'), ['all']));
  const diagram = buildOpportunityJobBundling(rows, [], { incidentLimit: 4 });
  assert.equal(diagram.relationshipCount, 4950);
  assert(diagram.edges.length <= 400);
  assert(diagram.edges.length < diagram.relationshipCount);
  assert(diagram.leaves.every(row => row.relationshipCount === 99));
  assert.equal(opportunityJobGraphFocus(diagram.adjacency, 'job:099')!.size, 100);
  assert.equal(new Set(diagram.edges.map(edge => edge.id)).size, diagram.edges.length);
  assert(diagram.leaves.every(row => diagram.edges.some(edge => edge.source === row.id || edge.target === row.id)), 'every connected job retains visible evidence');
});
