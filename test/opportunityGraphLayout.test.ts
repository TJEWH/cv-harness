import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutOpportunityGraph, opportunityGraphCommunities, opportunityGraphLinkWeight, opportunityGraphPreference, opportunityGraphSemanticLinks, type OpportunityGraphLayoutInput, type OpportunityGraphNode } from '../src/features/opportunities/domain/opportunityGraphLayout';

const node = (id: string, kind: 'topic' | 'job' = 'topic'): OpportunityGraphNode => ({ id, label: id, kind, radius: 6,
  highInterestCount: kind === 'topic' ? 3 : 0, mismatch: kind === 'job', avoided: false });
const example = (): OpportunityGraphLayoutInput => ({ dimensions: 2,
  nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'isolated'].map(id => node(id)),
  links: [['a', 'b'], ['a', 'c'], ['b', 'c'], ['d', 'e'], ['d', 'f'], ['e', 'f']]
    .map(([source, target]) => ({ source: source!, target: target!, weight: 12, kind: 'cooccurrence' as const }))
    .concat([{ source: 'c', target: 'd', weight: 1, kind: 'cooccurrence' }]),
});

test('communities retain strong observed clusters, weak bridges and isolated topics', () => {
  const groups = opportunityGraphCommunities(example());
  assert.equal(groups.get('a'), groups.get('b'));
  assert.equal(groups.get('b'), groups.get('c'));
  assert.equal(groups.get('d'), groups.get('e'));
  assert.equal(groups.get('e'), groups.get('f'));
  assert.notEqual(groups.get('c'), groups.get('d'));
  assert.notEqual(groups.get('isolated'), groups.get('a'));
  assert.equal(groups.size, 7);
});

test('layout and cluster identity are deterministic independent of incoming record ordering', () => {
  const input = example();
  const baseline = layoutOpportunityGraph(input);
  assert.deepEqual(layoutOpportunityGraph(input), baseline);
  assert.deepEqual(layoutOpportunityGraph({ ...input, nodes: [...input.nodes].reverse(), links: [...input.links].reverse() }), baseline);
  assert(baseline.every(position => Number.isFinite(position.x) && Number.isFinite(position.y) && position.z === 0));
  assert.equal(new Set(baseline.map(position => `${position.x}:${position.y}`)).size, input.nodes.length);
});

test('3D layout keeps the same communities and preserves the input evidence and cached positions', () => {
  const input = example(), original = structuredClone(input);
  const previous = layoutOpportunityGraph(input), snapshot = structuredClone(previous);
  const result = layoutOpportunityGraph({ ...input, dimensions: 3, previous });
  assert(result.every(position => Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)));
  assert(result.some(position => position.z !== 0));
  for (const position of result) assert.equal(position.community, previous.find(value => value.id === position.id)!.community);
  assert.deepEqual(input, original);
  assert.deepEqual(previous, snapshot);
});

test('empty and singleton graphs remain valid, and invalid links do not create phantom nodes', () => {
  assert.deepEqual(layoutOpportunityGraph({ dimensions: 2, nodes: [], links: [] }), []);
  const result = layoutOpportunityGraph({ dimensions: 3, nodes: [node('single')],
    links: [{ source: 'single', target: 'not-present', weight: 1, kind: 'cooccurrence' }] });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, 'single');
  assert(Number.isFinite(result[0]!.x) && Number.isFinite(result[0]!.y) && Number.isFinite(result[0]!.z));
});

test('disconnected topics stay bounded without making connected evidence geometrically negligible', () => {
  const input = example();
  input.nodes = [...input.nodes.filter(value => value.id !== 'isolated'), ...Array.from({ length: 11 }, (_, index) => node(`isolated-${index}`))];
  const result = layoutOpportunityGraph(input);
  assert.equal(result.length, input.nodes.length, 'every isolated topic remains in the complete map');
  const positions = new Map(result.map(position => [position.id, position]));
  const linkLengths = input.links.map(link => {
    const source = positions.get(link.source)!, target = positions.get(link.target)!;
    return Math.hypot(target.x - source.x, target.y - source.y);
  }).sort((a, b) => a - b);
  const typicalLink = linkLengths[Math.floor(linkLengths.length / 2)]!;
  const extent = Math.max(Math.max(...result.map(position => position.x)) - Math.min(...result.map(position => position.x)),
    Math.max(...result.map(position => position.y)) - Math.min(...result.map(position => position.y)));
  assert(typicalLink > 0);
  assert(extent / typicalLink < 10, 'disconnected topics must not set an extent many times larger than the connected relationships');
});

test('local acoustic word families connect distinct labels without merging evidence or unrelated topics', () => {
  const nodes = [
    { ...node('acoustics'), label: 'Acoustics' }, { ...node('sensing'), label: 'ACOUSTICAL_SENSING' },
    { ...node('psycho'), label: 'Psychoacoustics' }, { ...node('electro'), label: 'Electroacoustic sound' },
    { ...node('embedded'), label: 'Embedded systems' }, node('acoustics-job', 'job'),
  ];
  const original = structuredClone(nodes), links = opportunityGraphSemanticLinks(nodes);
  assert(links.length > 0);
  assert(links.every(link => link.kind === 'semantic' && link.similarity! > 0 && link.weight > 0 && link.weight <= 1));
  assert(links.every(link => ![link.source, link.target].includes('embedded') && ![link.source, link.target].includes('acoustics-job')));
  const groups = opportunityGraphCommunities({ nodes, links, dimensions: 2 });
  for (const id of ['sensing', 'psycho', 'electro']) assert.equal(groups.get(id), groups.get('acoustics'));
  assert.notEqual(groups.get('embedded'), groups.get('acoustics'));
  assert.deepEqual(opportunityGraphSemanticLinks([...nodes].reverse()), links);
  assert.deepEqual(nodes, original, 'word-family links must not merge or rewrite topic evidence');
});

test('recorded preference moderates supported links and requires enough explicit feedback', () => {
  const positive = { ...node('positive'), highInterestCount: 5, lowInterestCount: 0 };
  const agreeing = { ...node('agreeing'), highInterestCount: 2, lowInterestCount: 0 };
  const opposing = { ...node('opposing'), highInterestCount: 0, lowInterestCount: 4 };
  const sparse = { ...node('sparse'), highInterestCount: 1, avoidedCount: 1 };
  const reasonLed = { ...node('reasons'), highInterestCount: 20, positiveReasonCount: 0, avoidedCount: 2 };
  assert.deepEqual(opportunityGraphPreference(positive), { value: 1, source: 'ratings' });
  assert.equal(opportunityGraphPreference(sparse), null, 'do not count a job and its reason as independent feedback');
  assert.deepEqual(opportunityGraphPreference(reasonLed), { value: -1, source: 'reasons' });
  const nodes = new Map([positive, agreeing, opposing, sparse, reasonLed].map(value => [value.id, value]));
  const link = { source: positive.id, target: agreeing.id, weight: 3, kind: 'cooccurrence' as const };
  assert(opportunityGraphLinkWeight(link, nodes) > link.weight);
  assert(opportunityGraphLinkWeight({ ...link, target: opposing.id }, nodes) < link.weight);
  assert.equal(opportunityGraphLinkWeight({ ...link, target: sparse.id }, nodes), link.weight);
  assert.equal(opportunityGraphLinkWeight({ ...link, kind: 'job-overlap' }, nodes), link.weight, 'job overlap already includes preference weighting');
  assert.equal(opposing.avoided, false, 'low-interest job evidence does not annotate topics as avoided');
  assert.equal(opportunityGraphSemanticLinks([positive, opposing]).length, 0, 'matching preferences alone must not invent topic relationships');
});

test('similar wording can form separate preference clusters without fabricating topic dislike', () => {
  const nodes = [
    { ...node('a'), label: 'Acoustics', highInterestCount: 4, lowInterestCount: 0 },
    { ...node('b'), label: 'Acoustic sensing', highInterestCount: 3, lowInterestCount: 0 },
    { ...node('c'), label: 'Psychoacoustics', highInterestCount: 0, lowInterestCount: 4 },
    { ...node('d'), label: 'Electroacoustics', highInterestCount: 0, lowInterestCount: 3 },
  ];
  const links = opportunityGraphSemanticLinks(nodes), input = { nodes, links, dimensions: 2 as const };
  const groups = opportunityGraphCommunities(input);
  assert.equal(groups.get('a'), groups.get('b'));
  assert.equal(groups.get('c'), groups.get('d'));
  assert.notEqual(groups.get('a'), groups.get('c'));
  assert(nodes.every(value => !value.avoided));
  assert.deepEqual(layoutOpportunityGraph(input), layoutOpportunityGraph({ ...input, nodes: [...nodes].reverse(), links: [...links].reverse() }));
});

test('large word families produce a sparse deterministic relationship graph', () => {
  const nodes = Array.from({ length: 80 }, (_, index) => ({ ...node(`topic-${String(index).padStart(2, '0')}`), label: `Acoustic sensor ${index}` }));
  const links = opportunityGraphSemanticLinks(nodes), degree = new Map<string, number>();
  for (const link of links) for (const id of [link.source, link.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  assert(links.length <= nodes.length * 2);
  assert([...degree.values()].every(value => value <= 4));
  assert.deepEqual(opportunityGraphSemanticLinks([...nodes].reverse()), links);
});

test('fixed job groups control colors and spatial targets in 2D and 3D without altering topic communities', () => {
  const jobs: OpportunityGraphLayoutInput = { dimensions: 2, entityKind: 'job',
    nodes: ['a', 'b', 'c', 'd'].map(id => node(id, 'job')), links: [],
    communityAssignments: { a: 0, b: 0, c: 1, d: 1 } };
  assert.deepEqual([...opportunityGraphCommunities(jobs)], [['a', 0], ['b', 0], ['c', 1], ['d', 1]]);
  const before = structuredClone(jobs), result = layoutOpportunityGraph(jobs);
  const byId = new Map(result.map(point => [point.id, point]));
  const separation = Math.hypot((byId.get('a')!.x + byId.get('b')!.x) / 2 - (byId.get('c')!.x + byId.get('d')!.x) / 2,
    (byId.get('a')!.y + byId.get('b')!.y) / 2 - (byId.get('c')!.y + byId.get('d')!.y) / 2);
  const within = Math.hypot(byId.get('a')!.x - byId.get('b')!.x, byId.get('a')!.y - byId.get('b')!.y);
  assert(separation > within, 'requested groups get separate deterministic spatial centers');
  assert.deepEqual(layoutOpportunityGraph({ ...jobs, nodes: [...jobs.nodes].reverse() }), result);
  const three = layoutOpportunityGraph({ ...jobs, dimensions: 3, previous: result });
  assert.deepEqual(three.map(point => [point.id, point.community]), result.map(point => [point.id, point.community]));
  assert.deepEqual(jobs, before);
  const topics = example();
  assert.deepEqual(opportunityGraphCommunities({ ...topics, communityAssignments: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, isolated: 0 } }), opportunityGraphCommunities(topics), 'topic Louvain remains independent of job-count controls');
  assert.deepEqual(opportunityGraphCommunities({ ...jobs, communityAssignments: { a: 0 } }), opportunityGraphCommunities({ ...jobs, communityAssignments: undefined }), 'partial assignments cannot silently drop jobs');
});
