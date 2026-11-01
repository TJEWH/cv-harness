import assert from 'node:assert/strict';
import test from 'node:test';
import { runOpportunityGraphTask } from '../../../src/features/opportunities/domain/opportunityGraphTask';
import { buildOpportunityTopicHierarchy } from '../../../src/features/opportunities/domain/opportunityTopicHierarchy';
import type { OpportunityGraphLayoutRequest, OpportunityGraphNode } from '../../../src/features/opportunities/domain/opportunityGraphLayout';
import type { OpportunityInsightJob } from '../../../src/features/opportunities/domain/opportunityInsights';

const topic = (id: string): OpportunityGraphNode => ({ id: `topic:${id}`, label: id, kind: 'topic', radius: 8,
  highInterestCount: 2, matchingJobCount: 3, mismatch: false, avoided: false });
const job = (id: string, topicIds: string[], interestScore: number | null): OpportunityInsightJob => ({
  id, title: id, institution: null, country: null, addedAt: null, currentFit: 8, interestScore,
  explicitInterest: interestScore !== null, highInterest: interestScore !== null && interestScore >= 8,
  mismatch: false, topicIds, avoidedTopicIds: [], reasons: [],
});

test('topic bundling worker uses the supplied topic cohort without entering job clustering or filtering interest again', () => {
  const request: OpportunityGraphLayoutRequest = { generation: 15, view: 'bundling', entityKind: 'topic', dimensions: 3,
    nodes: ['a', 'b', 'c', 'isolated'].map(topic), links: [
      { source: 'topic:a', target: 'topic:b', kind: 'cooccurrence', weight: 2 },
      { source: 'topic:a', target: 'topic:c', kind: 'semantic', weight: .5 },
    ], topicJobs: [job('low', ['a', 'b'], 2), job('unknown', ['a', 'b'], null), job('separate', ['c'], 9)],
    jobMinimumInterest: 10, jobClusterCount: 1, jobExcludedTopicIds: ['a'],
  };
  const original = structuredClone(request), result = runOpportunityGraphTask(request);
  assert(!('error' in result));
  assert.equal(result.generation, 15);
  assert.deepEqual(result.positions, [], 'SVG bundling skips force simulation even when the last network used 3D');
  assert.equal(result.graph, undefined, 'topicJobs cannot start the balanced job cluster path');
  assert.deepEqual(result.hierarchy, buildOpportunityTopicHierarchy(request), 'routing keeps the incumbent topic hierarchy');
  assert.equal(result.bundling!.entityKind, 'topic');
  assert.deepEqual(result.bundling!.leaves.map(leaf => leaf.id).sort(), request.nodes.map(node => node.id).sort());
  assert.deepEqual(result.bundling!.edges.map(edge => [edge.source, edge.target, edge.sharedIds]),
    [['topic:a', 'topic:b', ['low', 'unknown']]], 'job-only sliders and exclusions cannot change the supplied topic cohort');
  assert.deepEqual(request, original, 'worker construction does not mutate parent evidence');
});

test('topic bundling worker keeps isolated visible topics and derives no bundles from routing hints alone', () => {
  const request: OpportunityGraphLayoutRequest = { generation: 16, view: 'bundling', entityKind: 'topic', dimensions: 2,
    nodes: ['a', 'b', 'isolated'].map(topic),
    links: [{ source: 'topic:a', target: 'topic:b', kind: 'semantic', weight: .8 }], topicJobs: [],
  };
  const result = runOpportunityGraphTask(request); assert(!('error' in result));
  assert.equal(result.hierarchy!.filter(root => root.children).length, 1, 'wording support may guide hierarchy routing');
  assert.equal(result.bundling!.leaves.length, 3);
  assert.equal(result.bundling!.relationshipCount, 0);
  assert.deepEqual(result.bundling!.edges, [], 'routing never becomes invented shared-job evidence');
  const filtered = runOpportunityGraphTask({ ...request, nodes: [topic('a'), topic('isolated')],
    topicJobs: [job('outside-visible-topic', ['a', 'b'], 9)] });
  assert(!('error' in filtered));
  assert.equal(filtered.bundling!.leaves.length, 2);
  assert.equal(filtered.bundling!.relationshipCount, 0, 'hidden topic nodes cannot create residual shared-job counts');
  assert.equal(filtered.graph, undefined);
});
