import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import type { OpportunityInsightJob } from '../../../src/features/opportunities/domain/opportunityInsights';
import { assignOpportunityJobClusterCapacities, clusterOpportunityJobs } from '../../../src/features/opportunities/domain/opportunityJobKMeans';
import { prepareOpportunityJobTopics, type PreparedOpportunityJobTopicEvidence } from '../../../src/features/opportunities/domain/opportunityJobTopicSimilarity';

const job = (id: string, topicIds: string[], patch: Partial<OpportunityInsightJob> = {}): OpportunityInsightJob => ({
  id, title: id, institution: null, country: null, addedAt: null, currentFit: 8, interestScore: 9,
  explicitInterest: true, highInterest: true, mismatch: false, topicIds, avoidedTopicIds: [], reasons: [], ...patch,
});
const reason = (target: string, polarity: 'positive' | 'negative') => ({ category: 'topic' as const, target, polarity });
function cluster(jobs: OpportunityInsightJob[], count = 2, excludedTopicIds: string[] = []) {
  return clusterOpportunityJobs(jobs, prepareOpportunityJobTopics({ jobs }, { excludedTopicIds }), count);
}
function assertPartition(jobs: OpportunityInsightJob[], count: number, result: ReturnType<typeof cluster>) {
  assert.equal(result.groups.length, Math.min(10, count, jobs.length));
  assert.deepEqual(result.groups.flat().sort(), jobs.map(row => `job:${row.id}`).sort());
  const sizes = result.groups.map(group => group.length);
  assert(Math.max(...sizes) - Math.min(...sizes) <= 1, `unbalanced sizes: ${sizes}`);
  assert.deepEqual(result.groups, [...result.groups].sort((a, b) => a[0]!.localeCompare(b[0]!)));
  for (const [index, group] of result.groups.entries()) {
    assert.deepEqual(group, [...group].sort());
    for (const id of group) assert.equal(result.assignments[id], index);
  }
}

test('semantic aliases are one feature and preserve clear field families', () => {
  const jobs = [job('a', ['ACOUSTICS', 'Acoustic sensing']), job('b', ['Acoustic_sensing']),
    job('c', ['Quantum optics']), job('d', ['Quantum optics'])];
  const result = cluster(jobs);
  assert.deepEqual(result.groups, [['job:a', 'job:b'], ['job:c', 'job:d']]);
  assertPartition(jobs, 2, result);
});

test('topic-specific sentiment separates opposing preferences on the same field', () => {
  const jobs = [job('a', ['Acoustics'], { reasons: [reason('Acoustics', 'positive')] }),
    job('b', ['Acoustics'], { reasons: [reason('Acoustics', 'negative')] }),
    job('c', ['Acoustic sensing'], { reasons: [reason('Acoustic sensing', 'positive')] }),
    job('d', ['Acoustic sensing'], { reasons: [reason('Acoustic sensing', 'negative')] })];
  assert.deepEqual(cluster(jobs).groups, [['job:a', 'job:c'], ['job:b', 'job:d']]);
});

test('weak whole-job sentiment follows stronger explicit topic evidence', () => {
  const jobs = [job('a', ['Acoustics'], { reasons: [reason('Acoustics', 'positive')] }),
    job('b', ['Acoustics'], { reasons: [reason('Acoustics', 'positive')] }),
    job('c', ['Acoustics'], { reasons: [reason('Acoustics', 'negative')] }),
    job('d', ['Acoustics'], { reasons: [reason('Acoustics', 'negative')] }),
    job('e', ['Acoustics']), job('f', ['Acoustics'], { interestScore: 2, highInterest: false })];
  assert.deepEqual(cluster(jobs).groups, [['job:a', 'job:b', 'job:e'], ['job:c', 'job:d', 'job:f']]);
  assert.deepEqual(jobs[5]!.avoidedTopicIds, [], 'a whole-job rating does not mutate topics into avoid annotations');
});

test('common generic features do not overwhelm distinct domain topics', () => {
  const jobs = [job('a', ['Simulation', 'Acoustics']), job('b', ['Simulation', 'Quantum optics']),
    job('c', ['Simulation', 'Acoustic sensing']), job('d', ['Simulation', 'Quantum optics'])];
  assert.deepEqual(cluster(jobs).groups, [['job:a', 'job:c'], ['job:b', 'job:d']]);
});

test('strict floor/ceil quotas retain outliers when natural groups are uneven', () => {
  const jobs = Array.from({ length: 10 }, (_, index) => job(`j${index}`, [index < 8 ? 'Acoustics' : index === 8 ? 'Biology' : 'Quantum optics']));
  assertPartition(jobs, 3, cluster(jobs, 3));
  for (let count = 1; count <= 10; count++) assertPartition(jobs, count, cluster(jobs, count));
});

test('prepared exclusions change the partition without reintroducing omitted features', () => {
  const jobs = [job('a', ['Simulation', 'Acoustics']), job('b', ['Simulation', 'Quantum optics']),
    job('c', ['Simulation', 'Acoustics']), job('d', ['Simulation', 'Quantum optics'])];
  assert.deepEqual(cluster(jobs).groups, [['job:a', 'job:c'], ['job:b', 'job:d']]);
  const prepared = prepareOpportunityJobTopics({ jobs }, { excludedTopicIds: ['Acoustics', 'Quantum optics'] });
  assert.deepEqual(clusterOpportunityJobs(jobs, prepared, 2).groups, [['job:a', 'job:b'], ['job:c', 'job:d']]);
  assert([...prepared.jobs.values()].every(row => row.featureIds.length === 1 && row.featureIds[0] === 'simulation'));
});

test('results are deterministic across reordered evidence and never mutate inputs', () => {
  const jobs = [job('a', ['Simulation', 'Acoustics']), job('b', ['Quantum optics']), job('c', ['Acoustic sensing']),
    job('d', ['Biology']), job('e', ['Molecular biology']), job('f', ['Quantum optics'])];
  const prepared = prepareOpportunityJobTopics({ jobs }), snapshot = structuredClone({ jobs, prepared });
  const expected = clusterOpportunityJobs(jobs, prepared, 3);
  const reversed = [...jobs].reverse().map(row => ({ ...row, topicIds: [...row.topicIds].reverse() }));
  assert.deepEqual(clusterOpportunityJobs(reversed, prepareOpportunityJobTopics({ jobs: reversed }), 3), expected);
  assert.deepEqual(clusterOpportunityJobs(jobs, prepared, 3), expected);
  assert.deepEqual({ jobs, prepared }, snapshot);
});

test('empty, topicless, identical, and missing-preparation jobs retain deterministic capacities', () => {
  assert.deepEqual(cluster([], 4), { groups: [], assignments: {} });
  for (const topicIds of [[], ['Acoustics']]) {
    const jobs = ['e', 'b', 'a', 'd', 'c'].map(id => job(id, topicIds));
    assert.deepEqual(cluster(jobs, 3).groups, [['job:a', 'job:b'], ['job:c', 'job:d'], ['job:e']]);
  }
  const jobs = ['a', 'b', 'c', 'd'].map(id => job(id, ['Acoustics']));
  assert.deepEqual(clusterOpportunityJobs(jobs, { jobs: new Map(), groups: new Map() }, 2).groups,
    [['job:a', 'job:b'], ['job:c', 'job:d']]);
});

test('requested cluster count is bounded without losing or duplicating jobs', () => {
  const jobs = Array.from({ length: 12 }, (_, i) => job(`j${String(i).padStart(2, '0')}`, [`Topic ${i % 3}`]));
  for (const [requested, expected] of [[-2, 1], [0, 1], [2.6, 3], [100, 10], [NaN, 5], [Infinity, 5]]) {
    assertPartition(jobs, expected!, cluster(jobs, requested!));
  }
  assertPartition(jobs.slice(0, 2), 2, cluster(jobs.slice(0, 2), 10));
});

test('balanced centroid fitting reaches the exhaustive optimum for a small unequal-family fixture', () => {
  // For one-hot normalized topic vectors, the centroid SSE of a group is
  // |group| - sum(topicCount²)/|group|. Exhaust all balanced three-way partitions
  // independently: this catches a merely greedy quota fill that misses exchanges.
  const families = [0, 0, 0, 1, 1, 2, 2, 3], sizes = [3, 3, 2];
  const jobs = families.map((family, i) => job(`j${i}`, [`field${family}`], { explicitInterest: false, interestScore: null }));
  const objective = (groups: number[][]) => groups.reduce((sum, group) => {
    const counts = new Map<number, number>();
    group.forEach(i => counts.set(families[i]!, (counts.get(families[i]!) ?? 0) + 1));
    return sum + group.length - [...counts.values()].reduce((total, count) => total + count * count, 0) / group.length;
  }, 0);
  let optimum = Infinity;
  const groups: number[][] = [[], [], []];
  function enumerate(row: number) {
    if (row === jobs.length) { optimum = Math.min(optimum, objective(groups)); return; }
    for (let i = 0; i < sizes.length; i++) {
      if (groups[i]!.length === sizes[i]) continue;
      groups[i]!.push(row); enumerate(row + 1); groups[i]!.pop();
    }
  }
  enumerate(0);
  const result = cluster(jobs, 3);
  assertPartition(jobs, 3, result);
  const actual = objective(result.groups.map(group => group.map(id => Number(id.slice('job:j'.length)))));
  assert(Math.abs(actual - optimum) < 1e-9, `SSE ${actual} differs from exhaustive ${optimum}`);
});

test('near-tie residual assignments match independent exhaustive quantized minima', () => {
  let state = 93847561;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let trial = 0; trial < 600; trial++) {
    const size = 2 + Math.floor(random() * 7), count = 1 + Math.floor(random() * Math.min(4, size));
    const capacities = Array.from({ length: count }, (_, i) => Math.floor(size / count) + (i < size % count ? 1 : 0));
    // Every improvement is below the former 1e-10 comparison tolerance, with
    // fractional quantization units and exact ties mixed in deliberately.
    const costs = Float64Array.from({ length: size * count }, () => .5 + (Math.floor(random() * 31) - 15) * 1e-12 + random() * 4e-13);
    const snapshot = costs.slice(), quantized = Array.from(costs, value => Math.round(value * 1e12));
    const used = Array<number>(count).fill(0);
    let optimum = Infinity;
    function enumerate(row: number, sum: number) {
      if (row === size) { optimum = Math.min(optimum, sum); return; }
      for (let cluster = 0; cluster < count; cluster++) {
        if (used[cluster]! >= capacities[cluster]!) continue;
        used[cluster]!++; enumerate(row + 1, sum + quantized[row * count + cluster]!); used[cluster]!--;
      }
    }
    enumerate(0, 0);
    const assigned = assignOpportunityJobClusterCapacities(costs, size, capacities);
    const actual = assigned.reduce((sum, cluster, row) => sum + quantized[row * count + cluster]!, 0);
    assert.equal(actual, optimum, `trial ${trial}: residual assignment must attain its quantized optimum`);
    assert.deepEqual(capacities.map((_, cluster) => assigned.filter(value => value === cluster).length), capacities);
    assert.deepEqual(assignOpportunityJobClusterCapacities(costs, size, capacities), assigned);
    assert.deepEqual(costs, snapshot);
  }
  assert.deepEqual([...assignOpportunityJobClusterCapacities(new Float64Array(24).fill(.5), 8, [3, 3, 2])],
    [0, 0, 0, 1, 1, 1, 2, 2], 'exact ties preserve stable capacity order');
});

test('the reported 28-job near-identical sentiment fixture terminates with balanced groups', () => {
  let state = 1203487956;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const size = 10 + Math.floor(random() * 20), count = 2 + Math.floor(random() * 6), features = ['f0', 'f1', 'f2', 'f3'];
  const preferences = Array.from({ length: size }, () => features.map(() => .5 + Math.floor(random() * 10) * .00001));
  const jobs = preferences.map((_, i) => job(`j${String(i).padStart(2, '0')}`, features));
  assert.equal(size, 28); assert.equal(count, 3);
  // Run in a bounded child: the regression previously hung synchronously in a
  // predecessor cycle, which a test-runner timeout cannot interrupt in-process.
  const moduleUrl = new URL('../../../src/features/opportunities/domain/opportunityJobKMeans.ts', import.meta.url).href;
  const script = `
    import { clusterOpportunityJobs } from ${JSON.stringify(moduleUrl)};
    const jobs = ${JSON.stringify(jobs)}, preferences = ${JSON.stringify(preferences)}, features = ['f0', 'f1', 'f2', 'f3'];
    const prepared = {
      groups: new Map(features.map(id => [id, { id, topicIds: [id], confidence: 1 }])),
      jobs: new Map(jobs.map((job, i) => [job.id, {
        topicIds: features, featureIds: features,
        topicsByFeature: new Map(features.map(id => [id, [id]])),
        preferences: new Map(features.map((id, j) => [id, preferences[i][j]])),
        preferenceConfidence: new Map(features.map(id => [id, 1]))
      }]))
    };
    const result = clusterOpportunityJobs(jobs, prepared, ${count});
    if (JSON.stringify(result) !== JSON.stringify(clusterOpportunityJobs([...jobs].reverse(), prepared, ${count}))) throw new Error('Unstable near-tie partition');
    console.log(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assertPartition(jobs, count, JSON.parse(child.stdout));
});

test('invalid assignment inputs fail recoverably before residual reconstruction', () => {
  assert.throws(() => assignOpportunityJobClusterCapacities(new Float64Array([0]), 1, [0]), /capacities/);
  for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => assignOpportunityJobClusterCapacities(new Float64Array([value]), 1, [1]), /distance/);
  }
});

test('500 dense jobs cluster within an interactive worker budget', t => {
  const jobs = Array.from({ length: 500 }, (_, index) => job(`j${String(index).padStart(3, '0')}`, []));
  const prepared: PreparedOpportunityJobTopicEvidence = { jobs: new Map(), groups: new Map() };
  // Isolate clustering cost from wording inference: 80 shared effective features
  // per job, plus ten family features and explicit sentiment on every feature.
  for (let feature = 0; feature < 180; feature++) prepared.groups.set(`f${feature}`, { id: `f${feature}`, topicIds: [`f${feature}`], confidence: 1 });
  for (const [index, row] of jobs.entries()) {
    const family = index % 10;
    const featureIds = Array.from({ length: 80 }, (_, i) => `f${i}`)
      .concat(Array.from({ length: 10 }, (_, i) => `f${80 + family * 10 + i}`));
    prepared.jobs.set(row.id, { topicIds: featureIds, featureIds, topicsByFeature: new Map(featureIds.map(id => [id, [id]])),
      preferences: new Map(featureIds.map(id => [id, index % 3 ? 1 : -1])),
      preferenceConfidence: new Map(featureIds.map(id => [id, 1])) });
  }
  const started = performance.now(), result = clusterOpportunityJobs(jobs, prepared, 10), elapsed = performance.now() - started;
  t.diagnostic(`500 jobs / 90 features each / 10 clusters: ${elapsed.toFixed(1)} ms`);
  assertPartition(jobs, 10, result);
  assert(elapsed < 4000, `clustering took ${elapsed.toFixed(0)} ms`);
});
