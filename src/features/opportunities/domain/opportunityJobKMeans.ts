import type { OpportunityInsightJob } from './opportunityInsights';
import { opportunityJobClusterCount } from './opportunityJobInterest';
import type { PreparedOpportunityJobTopicEvidence } from './opportunityJobTopicSimilarity';

export interface OpportunityJobKMeansResult {
  groups: string[][];
  assignments: Record<string, number>;
}

interface JobVector {
  indices: number[];
  values: number[];
  squaredLength: number;
}

const EPSILON = 1e-10;
const ASSIGNMENT_COST_SCALE = 1e12;
const RESTARTS = 3;
const MAX_ITERATIONS = 20;

function jobVectors(jobs: readonly OpportunityInsightJob[], prepared: PreparedOpportunityJobTopicEvidence) {
  const features = [...new Set(jobs.flatMap(job => prepared.jobs.get(job.id)?.featureIds ?? []))].sort();
  const featureIndex = new Map(features.map((feature, index) => [feature, index]));
  const frequencies = new Uint32Array(features.length);
  for (const job of jobs) {
    for (const feature of new Set(prepared.jobs.get(job.id)?.featureIds ?? [])) frequencies[featureIndex.get(feature)!]!++;
  }
  // A bounded IDF reduces the effect of generic topics without letting a rare
  // label dominate a complete job. Prepared aliases occupy one feature only.
  const weights = Float64Array.from(frequencies, count => Math.sqrt(1 + Math.min(.75, Math.log((jobs.length + 1) / (count + 1)))));
  const vectors: JobVector[] = jobs.map(job => {
    const evidence = prepared.jobs.get(job.id), indices: number[] = [], values: number[] = [];
    for (const feature of [...new Set(evidence?.featureIds ?? [])].sort()) {
      const index = featureIndex.get(feature)!, weight = weights[index]!;
      indices.push(index * 2); values.push(weight);
      const preference = evidence?.preferences.get(feature), confidence = evidence?.preferenceConfidence.get(feature) ?? 0;
      if (preference !== null && preference !== undefined && Number.isFinite(preference) && confidence > 0) {
        // Explicit topic feedback has full confidence; a whole-job rating is a
        // weaker signal supplied by preparation, never an inferred topic dislike.
        const sentiment = weight * Math.sqrt(.4 * Math.min(1, confidence)) * Math.max(-1, Math.min(1, preference));
        if (sentiment) { indices.push(index * 2 + 1); values.push(sentiment); }
      }
    }
    const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    return { indices, values: length ? values.map(value => value / length) : [], squaredLength: length ? 1 : 0 };
  });
  return { vectors, dimensions: features.length * 2 };
}

function squaredDistance(vector: JobVector, centre: Float64Array, centreLength: number): number {
  let dot = 0;
  for (let i = 0; i < vector.indices.length; i++) dot += vector.values[i]! * centre[vector.indices[i]!]!;
  return Math.max(0, vector.squaredLength + centreLength - 2 * dot);
}

function centreLengths(centres: Float64Array[]): number[] {
  return centres.map(centre => centre.reduce((sum, value) => sum + value * value, 0));
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function seedCentres(vectors: JobVector[], dimensions: number, count: number, restart: number): Float64Array[] {
  const random = randomGenerator((0x9e3779b9 + restart * 0x6d2b79f5) >>> 0);
  const selected = new Set<number>(), centres: Float64Array[] = [], nearest = new Float64Array(vectors.length).fill(Infinity);
  let next = Math.floor(random() * vectors.length);
  for (let cluster = 0; cluster < count; cluster++) {
    selected.add(next);
    const vector = vectors[next]!, centre = new Float64Array(dimensions);
    for (let i = 0; i < vector.indices.length; i++) centre[vector.indices[i]!] = vector.values[i]!;
    centres.push(centre);
    let total = 0;
    for (let i = 0; i < vectors.length; i++) {
      nearest[i] = Math.min(nearest[i]!, squaredDistance(vectors[i]!, centre, vector.squaredLength));
      total += nearest[i]!;
    }
    if (cluster === count - 1) break;
    if (total <= EPSILON) next = vectors.findIndex((_, index) => !selected.has(index));
    else {
      let draw = random() * total;
      next = vectors.length - 1;
      for (let i = 0; i < nearest.length; i++) if ((draw -= nearest[i]!) < 0) { next = i; break; }
      if (selected.has(next)) next = vectors.findIndex((_, index) => !selected.has(index));
    }
  }
  return centres;
}

/**
 * @internal Exact minimum-cost assignment for distances quantized to 1e-12 and
 * fixed capacities. Integer costs keep residual subtraction and path comparison
 * consistent even for almost identical vectors. Insert one job at a time using
 * a shortest augmenting path through the cluster residual graph.
 * An edge c -> d moves the cheapest previously assigned member of c into d.
 * There are at most ten cluster vertices, avoiding an N-by-N slot matrix.
 */
export function assignOpportunityJobClusterCapacities(costs: Float64Array, size: number, capacities: readonly number[]): Int32Array {
  const count = capacities.length;
  if (!Number.isInteger(size) || size < 0 || !count || costs.length !== size * count
    || capacities.some(capacity => !Number.isInteger(capacity) || capacity < 0)
    || capacities.reduce((sum, capacity) => sum + capacity, 0) !== size) throw new Error('Invalid job cluster capacities.');
  const integerCosts = Float64Array.from(costs, value => {
    const quantized = Math.round(value * ASSIGNMENT_COST_SCALE);
    // All residual paths have at most count edges. Keep their additions and
    // subtractions in the exact-integer range of JavaScript numbers.
    if (!Number.isSafeInteger(quantized) || quantized < 0 || quantized > Number.MAX_SAFE_INTEGER / (count + 1)) {
      throw new Error('Invalid job cluster distance.');
    }
    return quantized;
  });
  const assigned = new Int32Array(size).fill(-1), occupied = new Uint32Array(count);
  const edgeCosts = new Float64Array(count * count), movers = new Int32Array(count * count);
  const distances = new Float64Array(count), previous = new Int32Array(count);
  for (let row = 0; row < size; row++) {
    edgeCosts.fill(Infinity); movers.fill(-1); previous.fill(-1);
    for (let member = 0; member < row; member++) {
      const source = assigned[member]!, offset = member * count, baseline = integerCosts[offset + source]!;
      for (let target = 0; target < count; target++) {
        if (target === source) continue;
        const edge = source * count + target, delta = integerCosts[offset + target]! - baseline;
        if (delta < edgeCosts[edge]!) { edgeCosts[edge] = delta; movers[edge] = member; }
      }
    }
    for (let cluster = 0; cluster < count; cluster++) distances[cluster] = integerCosts[row * count + cluster]!;
    // Negative reassignment edges require Bellman-Ford. Optimality for the
    // already inserted jobs ensures that no negative residual cycle exists.
    for (let pass = 0; pass < count - 1; pass++) {
      let changed = false;
      for (let source = 0; source < count; source++) {
        for (let target = 0; target < count; target++) {
          const candidate = distances[source]! + edgeCosts[source * count + target]!;
          if (candidate < distances[target]!) {
            distances[target] = candidate; previous[target] = source; changed = true;
          }
        }
      }
      if (!changed) break;
    }
    let target = -1;
    for (let cluster = 0; cluster < count; cluster++) {
      if (occupied[cluster]! < capacities[cluster]! && (target < 0 || distances[cluster]! < distances[target]!)) target = cluster;
    }
    if (target < 0) throw new Error('Job cluster capacities are exhausted.');
    // Validate the complete path before changing assignments. Unexpected
    // residual corruption must reach worker recovery, never an unbounded loop.
    const destination = target, seen = new Uint8Array(count), moves: { member: number; target: number }[] = [];
    for (let length = 0; ; length++) {
      if (length >= count || seen[target]) throw new Error('Job cluster assignment contains a residual cycle.');
      seen[target] = 1;
      const source = previous[target]!;
      if (source < 0) break;
      const member = movers[source * count + target]!;
      if (member < 0 || assigned[member] !== source) throw new Error('Job cluster assignment contains an invalid path.');
      moves.push({ member, target }); target = source;
    }
    for (const move of moves) assigned[move.member] = move.target;
    occupied[destination]!++;
    assigned[row] = target;
  }
  return assigned;
}

function updateCentres(vectors: JobVector[], assigned: Int32Array, dimensions: number, count: number): Float64Array[] {
  const centres = Array.from({ length: count }, () => new Float64Array(dimensions)), sizes = new Uint32Array(count);
  for (let row = 0; row < vectors.length; row++) {
    const cluster = assigned[row]!, vector = vectors[row]!, centre = centres[cluster]!;
    sizes[cluster]!++;
    for (let i = 0; i < vector.indices.length; i++) centre[vector.indices[i]!]! += vector.values[i]!;
  }
  for (let cluster = 0; cluster < count; cluster++) {
    const centre = centres[cluster]!;
    for (let i = 0; i < centre.length; i++) centre[i]! /= sizes[cluster]!;
  }
  return centres;
}

function canonicalGroups(jobs: readonly OpportunityInsightJob[], assigned: Int32Array, count: number): string[][] {
  const groups = Array.from({ length: count }, () => [] as string[]);
  jobs.forEach((job, index) => groups[assigned[index]!]!.push(`job:${job.id}`));
  return groups.map(group => group.sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/**
 * Deterministic, size-balanced centroid k-means over prepared topic evidence.
 * Each Lloyd step minimizes quantized distances at fixed capacities before
 * recomputing means. Only the best unquantized centroid SSE is retained, so
 * rounding cannot replace it with a worse fit. Multiple starts improve local fit;
 * neither the constrained partition nor its graph links imply semantic proof.
 */
export function clusterOpportunityJobs(jobs: readonly OpportunityInsightJob[], prepared: PreparedOpportunityJobTopicEvidence,
  requestedCount = 5): OpportunityJobKMeansResult {
  if (!jobs.length) return { groups: [], assignments: {} };
  const ordered = [...jobs].sort((a, b) => a.id.localeCompare(b.id)), count = opportunityJobClusterCount(requestedCount, ordered.length);
  const capacities = Array.from({ length: count }, (_, index) => Math.floor(ordered.length / count) + (index < ordered.length % count ? 1 : 0));
  const { vectors, dimensions } = jobVectors(ordered, prepared);
  let bestGroups: string[][] = [], bestObjective = Infinity, bestKey = '';
  for (let restart = 0; restart < RESTARTS; restart++) {
    let centres = seedCentres(vectors, dimensions, count, restart), prior: Int32Array | undefined, priorObjective = Infinity;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const lengths = centreLengths(centres), costs = new Float64Array(ordered.length * count);
      for (let row = 0; row < ordered.length; row++) {
        for (let cluster = 0; cluster < count; cluster++) costs[row * count + cluster] = squaredDistance(vectors[row]!, centres[cluster]!, lengths[cluster]!);
      }
      const assigned = assignOpportunityJobClusterCapacities(costs, ordered.length, capacities);
      centres = updateCentres(vectors, assigned, dimensions, count);
      const updatedLengths = centreLengths(centres);
      const objective = vectors.reduce((sum, vector, row) => sum + squaredDistance(vector, centres[assigned[row]!]!, updatedLengths[assigned[row]!]!), 0);
      const groups = canonicalGroups(ordered, assigned, count), key = JSON.stringify(groups);
      if (objective < bestObjective || (objective === bestObjective && (!bestKey || key < bestKey))) {
        bestObjective = objective; bestGroups = groups; bestKey = key;
      }
      if (prior && (assigned.every((cluster, row) => cluster === prior![row]) || priorObjective - objective <= EPSILON * Math.max(1, priorObjective))) break;
      prior = assigned; priorObjective = objective;
    }
  }
  const assignments: Record<string, number> = {};
  bestGroups.forEach((group, index) => group.forEach(id => { assignments[id] = index; }));
  return { groups: bestGroups, assignments };
}
