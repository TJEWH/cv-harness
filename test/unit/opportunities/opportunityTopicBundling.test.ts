import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityTopicBundling } from '../../../src/features/opportunities/domain/opportunityTopicBundling';
import { opportunityJobGraphFocus } from '../../../src/features/opportunities/domain/opportunityJobGraph';
import type { OpportunityInsightJob } from '../../../src/features/opportunities/domain/opportunityInsights';
import type { OpportunityGraphNode } from '../../../src/features/opportunities/domain/opportunityGraphLayout';
import type { OpportunityTopicHierarchyNode } from '../../../src/features/opportunities/domain/opportunityTopicHierarchy';

const job = (id: string, topicIds: string[], interestScore: number | null = 9): OpportunityInsightJob => ({
  id, title: `Job ${id}`, institution: null, country: null, addedAt: null, currentFit: 8, interestScore,
  explicitInterest: interestScore !== null, highInterest: interestScore !== null && interestScore >= 8, mismatch: false,
  topicIds, avoidedTopicIds: [], reasons: [],
});
const topic = (id: string): OpportunityGraphNode => ({ id: `topic:${id}`, label: id, kind: 'topic', radius: 5,
  highInterestCount: 0, matchingJobCount: 0, mismatch: false, avoided: false });
const leaf = (id: string): OpportunityTopicHierarchyNode => ({ id: `topic:${id}`, topicId: `topic:${id}`, label: id, count: 1, affinity: 1, children: null });
const branch = (id: string, a: OpportunityTopicHierarchyNode, b: OpportunityTopicHierarchyNode): OpportunityTopicHierarchyNode => ({
  id, topicId: null, label: a.label, count: a.count + b.count, affinity: .5, children: [a, b],
});

test('topic bundling inverts incidence into topics linked by their actual shared jobs', () => {
  const nodes = ['a', 'b', 'c', 'isolated'].map(topic);
  const jobs = [job('ab-1', ['a', 'b']), job('ab-2', ['a', 'b']), job('bc', ['b', 'c'])];
  const diagram = buildOpportunityTopicBundling(nodes, jobs, [branch('ab', leaf('a'), leaf('b')), branch('ci', leaf('c'), leaf('isolated'))]);
  assert.equal(diagram.entityKind, 'topic');
  assert.equal(diagram.relationshipCount, 2);
  assert.deepEqual(diagram.edges.map(edge => [edge.source, edge.target, edge.sharedCount, edge.sharedIds]), [
    ['topic:a', 'topic:b', 2, ['ab-1', 'ab-2']], ['topic:b', 'topic:c', 1, ['bc']],
  ]);
  assert.deepEqual(diagram.leaves.map(row => [row.recordId, row.evidenceCount, row.relationshipCount]), [
    ['a', 2, 1], ['b', 3, 2], ['c', 1, 1], ['isolated', 0, 0],
  ]);
  assert.deepEqual(opportunityJobGraphFocus(diagram.adjacency, 'topic:a'), new Set(['topic:a', 'topic:b']));
  assert(diagram.edges[0]!.route.includes(diagram.groups[0]!.id));
  assert(diagram.edges[1]!.route.includes('topic-bundling:root'), 'cross-group observed connections route through a common ancestor');
});

test('all, high and low interest cohorts are supplied by the caller without another high-interest filter', () => {
  const nodes = ['a', 'b'].map(topic), forest = [branch('ab', leaf('a'), leaf('b'))];
  const jobs = [job('high', ['a', 'b'], 9), job('medium', ['a', 'b'], 6), job('low', ['a', 'b'], 2), job('unknown', ['a', 'b'], null)];
  const all = buildOpportunityTopicBundling(nodes, jobs, forest);
  const high = buildOpportunityTopicBundling(nodes, jobs.filter(row => row.explicitInterest && row.interestScore! >= 8), forest);
  const low = buildOpportunityTopicBundling(nodes, jobs.filter(row => row.explicitInterest && row.interestScore! <= 4), forest);
  assert.deepEqual(all.edges[0]!.sharedIds, ['high', 'low', 'medium', 'unknown']);
  assert.deepEqual(high.edges[0]!.sharedIds, ['high']);
  assert.deepEqual(low.edges[0]!.sharedIds, ['low']);
  assert.equal(all.leaves[0]!.evidenceCount, 4);
  assert.equal(low.leaves[0]!.evidenceCount, 1, 'the inverse adapter must not discard an already-filtered low-interest cohort');
});

test('duplicate jobs and repeated topic IDs count a supporting job once per topic and pair', () => {
  const original = job('once', ['a', 'a', 'b', 'b']);
  const diagram = buildOpportunityTopicBundling(['a', 'b'].map(topic), [original, structuredClone(original), job('another', ['a', 'b', 'a'])], []);
  assert.equal(diagram.relationshipCount, 1);
  assert.deepEqual(diagram.edges[0]!.sharedIds, ['another', 'once']);
  assert.equal(diagram.edges[0]!.sharedCount, 2);
  assert(diagram.leaves.every(row => row.evidenceCount === 2));
  assert.deepEqual(original.topicIds, ['a', 'a', 'b', 'b'], 'the source record is not rewritten');
});

test('shared job IDs remain opaque, including case, underscores, spaces and Unicode', () => {
  const ids = ['Job_A', 'job a', 'Ｊｏｂ Ａ'];
  const diagram = buildOpportunityTopicBundling(['a', 'b'].map(topic), ids.map(id => job(id, ['a', 'b'])), []);
  assert.equal(diagram.edges[0]!.sharedCount, 3);
  assert.deepEqual(diagram.edges[0]!.sharedIds, [...ids].sort());
  const distinct = buildOpportunityTopicBundling(['a', 'b'].map(topic), [job('Same_ID', ['a']), job('same id', ['b'])], []);
  assert.equal(distinct.relationshipCount, 0, 'formatting-equivalent job identifiers cannot be joined as if they were one record');
});

test('only visible topic nodes contribute even when hidden topics and stale leaves remain in the supplied data', () => {
  const stale = [branch('all', branch('ab', leaf('a'), leaf('b')), leaf('hidden'))];
  const accidentalJob: OpportunityGraphNode = { ...topic('wrong-kind'), id: 'job:wrong-kind', kind: 'job' };
  const nodes = [topic('a'), topic('b'), topic('isolated'), accidentalJob];
  const jobs = [job('one', ['a', 'b', 'hidden', 'wrong-kind']), job('two', ['a', 'hidden'])];
  const diagram = buildOpportunityTopicBundling(nodes, jobs, stale);
  assert.deepEqual(diagram.leaves.map(row => row.id), ['topic:a', 'topic:b', 'topic:isolated']);
  assert.equal(diagram.relationshipCount, 1);
  assert.deepEqual(diagram.edges[0]!.sharedIds, ['one']);
  assert.deepEqual(diagram.adjacency.ids, ['topic:a', 'topic:b', 'topic:isolated']);
  assert.equal(diagram.leaves.find(row => row.recordId === 'isolated')!.relationshipCount, 0);
});

test('semantic-only hierarchy joins never invent observed topic connections', () => {
  const nodes = ['acoustics', 'acoustic sensing'].map(topic);
  const forest = [branch('related-wording', leaf('acoustics'), leaf('acoustic sensing'))];
  const diagram = buildOpportunityTopicBundling(nodes, [job('one', ['acoustics']), job('two', ['acoustic sensing'])], forest);
  assert.equal(diagram.groups.length, 1, 'a wording-based hierarchy can still organize topics');
  assert.equal(diagram.relationshipCount, 0);
  assert.deepEqual(diagram.edges, []);
  assert.deepEqual(opportunityJobGraphFocus(diagram.adjacency, 'topic:acoustics'), new Set(['topic:acoustics']));
});

test('dense inverse graphs retain complete counts and the global maximum while bounding paths deterministically', () => {
  const nodes = Array.from({ length: 80 }, (_, index) => topic(String(index).padStart(2, '0')));
  const ids = nodes.map(node => node.id.slice(6));
  const jobs = [job('common-1', ids), job('common-2', ids), job('common-3', ids),
    ...Array.from({ length: 10 }, (_, index) => job(`extra-${index}`, ['00', '01']))];
  const before = structuredClone({ nodes, jobs });
  const diagram = buildOpportunityTopicBundling(nodes, jobs, [], { radius: 280, incidentLimit: 4 });
  assert.equal(diagram.radius, 280);
  assert.equal(diagram.relationshipCount, 3160);
  assert(diagram.edges.length <= nodes.length * 4);
  assert(diagram.edges.length < diagram.relationshipCount);
  assert.equal(Math.max(...diagram.edges.map(edge => edge.sharedCount)), 13, 'the color scale keeps its complete-cohort maximum after sparsification');
  assert(diagram.leaves.every(row => row.relationshipCount === 79));
  assert.equal(opportunityJobGraphFocus(diagram.adjacency, 'topic:79')!.size, 80);
  const shuffled = buildOpportunityTopicBundling([...nodes].reverse(), [...jobs].reverse().map(row => ({ ...row, topicIds: [...row.topicIds].reverse() })), [], { radius: 280, incidentLimit: 4 });
  assert.deepEqual(shuffled, diagram);
  assert.deepEqual(structuredClone(diagram), diagram);
  assert.deepEqual({ nodes, jobs }, before);
  assert(diagram.edges.every(edge => !/NaN|Infinity/u.test(edge.path)));
});

test('empty and singleton inverse diagrams retain valid geometry without relationships', () => {
  const empty = buildOpportunityTopicBundling([], [job('unused', ['hidden'])], []);
  assert.deepEqual(empty.leaves, []); assert.deepEqual(empty.edges, []); assert.deepEqual(empty.groups, []);
  assert.equal(empty.adjacency.bits.length, 0);
  const singleton = buildOpportunityTopicBundling([topic('alone')], [job('one', ['alone'], 0)], []);
  assert.equal(singleton.leaves[0]!.evidenceCount, 1);
  assert.equal(singleton.leaves[0]!.recordId, 'alone');
  assert.equal(singleton.relationshipCount, 0);
  assert(Math.abs(Math.hypot(singleton.leaves[0]!.x, singleton.leaves[0]!.y) - singleton.radius) < 1e-9);
});
