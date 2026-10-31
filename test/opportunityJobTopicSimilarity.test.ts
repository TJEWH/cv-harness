import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpportunityInsightJob } from '../src/features/opportunities/domain/opportunityInsights';
import { buildOpportunityJobGraph, opportunityJobGraphNodes } from '../src/features/opportunities/domain/opportunityJobGraph';
import { prepareOpportunityJobTopics, opportunityJobTopicPreferenceAgreement } from '../src/features/opportunities/domain/opportunityJobTopicSimilarity';

const job = (id: string, topicIds: string[], patch: Partial<OpportunityInsightJob> = {}): OpportunityInsightJob => ({
  id, title: id, institution: null, country: null, addedAt: null, currentFit: 8, interestScore: 9,
  explicitInterest: true, highInterest: true, mismatch: false, topicIds, avoidedTopicIds: [], reasons: [], ...patch,
});
const reason = (target: string, polarity: 'positive' | 'negative') => ({ category: 'topic' as const, target, polarity });

test('related acoustic names and established acronym expansions create separately labelled inferred evidence', () => {
  for (const topics of [['Acoustics', 'Acoustic_sensing'], ['ML', 'Machine learning'], ['HRI', 'Human robot interaction']]) {
    const graph = buildOpportunityJobGraph({ jobs: [job('a', [topics[0]!]), job('b', [topics[1]!])] });
    assert.equal(graph.links.length, 1);
    const link = graph.links[0]!;
    assert.equal(link.sharedTopicCount, 0, 'a related name is not an observed exact shared topic');
    assert.equal(link.inferredTopicCount, 1);
    assert(link.weight > 0 && link.weight <= 1);
    assert(link.semanticSimilarity! > 0 && link.semanticSimilarity! <= 1);
  }
});

test('generic method words and equal job ratings cannot merge unrelated fields', () => {
  const graph = { jobs: [job('a', ['Simulation', 'Acoustic simulation']), job('b', ['Simulation', 'Materials simulation']),
    job('c', ['Biology sensing']), job('d', ['Acoustic sensing'])] };
  const result = buildOpportunityJobGraph(graph, 8, { excludedTopicIds: ['SIMULATION'] });
  assert.equal(result.nodes.length, 4);
  assert(!result.links.some(link => link.source === 'job:a' && link.target === 'job:b'));
  assert(!result.links.some(link => link.source === 'job:c' && link.target === 'job:d'));
  assert(result.links.some(link => link.source === 'job:a' && link.target === 'job:d'), 'a supported acoustic anchor may connect related methods');
});

test('excluded topics cannot return through inferred aliases and topicless jobs remain present', () => {
  const input = { jobs: [job('a', ['Acoustics']), job('b', ['Acoustic sensing'])] }, snapshot = structuredClone(input);
  const options = { excludedTopicIds: [' ACOUSTICS '] };
  const prepared = prepareOpportunityJobTopics(input, options), result = buildOpportunityJobGraph(input, 8, { ...options, prepared });
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0]!.topicCount, 0);
  assert.equal(result.links.length, 0);
  assert.deepEqual(prepared.jobs.get('a')!.featureIds, []);
  assert([...prepared.groups.values()].every(group => !group.topicIds.includes('acoustics')));
  assert.equal(opportunityJobGraphNodes(input, 8, options)[0]!.topicCount, 0);
  assert.deepEqual(input, snapshot, 'complete job evidence is retained unchanged');
});

test('one job cannot multiply its overlap by listing several related topic names', () => {
  const graph = { jobs: [job('a', ['Acoustics', 'Acoustic sensing', 'ACOUSTICS']), job('b', ['Acoustic sensing'])] };
  const prepared = prepareOpportunityJobTopics(graph), result = buildOpportunityJobGraph(graph, 8, { prepared });
  assert.equal(prepared.jobs.get('a')!.topicIds.length, 2);
  assert.equal(prepared.jobs.get('a')!.featureIds.length, 1);
  assert.equal(result.nodes[0]!.topicCount, 1);
  assert.equal(result.links[0]!.sharedTopicCount, 1);
  assert.equal(result.links[0]!.weight, 1);
});

test('a chain of related labels never becomes an inferred all-pairs meaning group', () => {
  const prepared = prepareOpportunityJobTopics({ jobs: [job('a', ['Acoustic robot']), job('b', ['Acoustic sensing']), job('c', ['Robot control'])] });
  assert([...prepared.groups.values()].every(group => group.topicIds.length < 3));
  assert.notEqual(prepared.jobs.get('b')!.featureIds[0], prepared.jobs.get('c')!.featureIds[0]);
});

test('explicit topic reasons override weak job-level sentiment and opposing preferences reduce supported similarity', () => {
  const a = job('a', ['Acoustics'], { reasons: [reason('Acoustics', 'positive')] });
  const positive = job('b', ['Acoustic sensing'], { reasons: [reason('Acoustic_sensing', 'positive')] });
  const negative = { ...positive, reasons: [reason('Acoustic sensing', 'negative')] };
  const aligned = buildOpportunityJobGraph({ jobs: [a, positive] }), opposed = buildOpportunityJobGraph({ jobs: [a, negative] });
  assert.equal(aligned.links[0]!.sentimentSimilarity, 1);
  assert.equal(opposed.links[0]!.sentimentSimilarity, 0);
  assert(opposed.links[0]!.weight < aligned.links[0]!.weight);
  assert.equal(opposed.links[0]!.similarity, aligned.links[0]!.similarity, 'meaning support remains distinct from preference weighting');
  const prepared = prepareOpportunityJobTopics({ jobs: [a, negative] });
  const feature = prepared.jobs.get('b')!.featureIds[0]!;
  assert.equal(prepared.jobs.get('b')!.preferences.get(feature), -1);
  assert.equal(prepared.jobs.get('b')!.preferenceConfidence.get(feature), 1);
  const unrelated = buildOpportunityJobGraph({ jobs: [a, job('z', ['Quantum theory'], { reasons: [reason('Quantum theory', 'positive')] })] });
  assert.equal(unrelated.links.length, 0, 'sentiment agreement alone never invents a meaning link');
});

test('unknown sentiment stays unknown and whole-job scores remain weak signals without topic dislikes', () => {
  const unknown = job('unknown', ['Acoustics'], { explicitInterest: false, interestScore: null });
  const rated = job('rated', ['Acoustic sensing'], { interestScore: 2, highInterest: false });
  const evidence = prepareOpportunityJobTopics({ jobs: [unknown, rated] });
  assert.equal(evidence.jobs.get('unknown')!.preferences.values().next().value, null);
  assert.equal(evidence.jobs.get('unknown')!.preferenceConfidence.values().next().value, 0);
  assert.equal(evidence.jobs.get('rated')!.preferenceConfidence.values().next().value, .25);
  assert.equal(opportunityJobTopicPreferenceAgreement(null, 1), null);
  assert.deepEqual(rated.avoidedTopicIds, []);
});

test('feature preparation and weighted job evidence are stable across job and topic order', () => {
  const input = { jobs: [job('a', ['Acoustics', 'Simulation']), job('b', ['Acoustic sensing']), job('c', ['Materials simulation'])] };
  const reversed = { jobs: [...input.jobs].reverse().map(row => ({ ...row, topicIds: [...row.topicIds].reverse() })) };
  assert.deepEqual(prepareOpportunityJobTopics(input), prepareOpportunityJobTopics(reversed));
  assert.deepEqual(buildOpportunityJobGraph(input), buildOpportunityJobGraph(reversed));
});
