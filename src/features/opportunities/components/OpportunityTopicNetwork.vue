<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { OpportunityInsightGraph } from '../domain/opportunityInsights';
import { opportunityGraphPreference, opportunityGraphSemanticLinks, type OpportunityGraphLayoutResponse, type OpportunityGraphRenderData, type OpportunityGraphLink, type OpportunityGraphNode, type OpportunityGraphPosition } from '../domain/opportunityGraphLayout';
import type { OpportunityTopicHierarchyNode } from '../domain/opportunityTopicHierarchy';
import type { OpportunityJobBundlingDiagram } from '../domain/opportunityJobBundling';
import OpportunityTopicHierarchy from './OpportunityTopicHierarchy.vue';
import OpportunityJobBundling from './OpportunityJobBundling.vue';
import { JOB_CLUSTER_COLORS, TOPIC_CLUSTER_COLORS } from './opportunityClusterColors';
import { createOpportunityNetworkSelection } from '../domain/opportunityNetworkSelection';
import { opportunityTopicFocus } from '../domain/opportunityTopicFocus';
import { opportunityJobGraphNodes, opportunityJobGraphFocus } from '../domain/opportunityJobGraph';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { useToasts, useToastWatch } from '../../../shared/ui/useToasts';

const props = withDefaults(defineProps<{
  graph: OpportunityInsightGraph;
  selectedTopicIds: string[];
  selectedJobId: string | null;
  lang: string;
  ownerId: string;
  layoutPaused?: boolean;
  visibleTopicIds?: string[];
  matchingJobCounts?: Record<string, number>;
  interestMode?: 'all' | 'high' | 'low';
  interestThreshold?: number;
  viewMode?: 'topics' | 'jobs';
  jobMinimumInterest?: number;
  jobClusterCount?: number;
  jobExcludedTopicIds?: string[];
  presentationControlsTarget?: string;
  cameraControlsTarget?: string;
}>(), { layoutPaused: false, interestMode: 'all', viewMode: 'topics', jobMinimumInterest: 8, jobClusterCount: 5, jobExcludedTopicIds: () => [] });
const emit = defineEmits<{ selectTopic: [id: string]; selectJob: [id: string]; availability: [value: boolean]; focusTopics: [ids: string[] | null] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const viewport = ref<HTMLDivElement | null>(null);
const dimensions = ref<2 | 3>(2);
const presentation = ref<'network' | 'hierarchy' | 'bundling'>('network');
const hierarchy = shallowRef<OpportunityTopicHierarchyNode[]>([]);
const bundling = shallowRef<OpportunityJobBundlingDiagram | null>(null);
const retryLabel = computed(() => presentation.value === 'bundling' ? text('Retry edge bundling', 'Kantenbündelung erneut laden')
  : presentation.value === 'hierarchy' ? text('Retry hierarchy', 'Hierarchie erneut laden') : text('Retry map', 'Karte erneut laden'));
const jobEvidence = shallowRef<{ source: OpportunityInsightGraph; minimumInterest: number; excludedKey: string; graph: OpportunityGraphRenderData } | null>(null);
const jobExcludedKey = computed(() => JSON.stringify([...new Set(props.jobExcludedTopicIds)].sort()));
const currentJobEvidence = computed(() => jobEvidence.value?.source === props.graph && jobEvidence.value.minimumInterest === props.jobMinimumInterest && jobEvidence.value.excludedKey === jobExcludedKey.value ? jobEvidence.value.graph : null);
const busy = ref(false);
const failed = ref(false);
const hoveredId = ref<string | null>(null);
const focusedId = ref<string | null>(null);
const hoveredEdge = shallowRef<OpportunityGraphLink | null>(null);
const zoomLevel = ref(1);
interface NetworkLabel { id: string; label: string; kind: 'topic' | 'job'; left: number; top: number; width: number; anchorX: number; anchorY: number; leaderX: number; leaderY: number; selected: boolean; avoided: boolean; muted: boolean }
const labels = shallowRef<NetworkLabel[]>([]);
const viewSize = shallowRef({ width: 1, height: 1 });
const { notify, dismiss } = useToasts();
let failureToast = 0;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let observer: ResizeObserver | null = null;
let worker: Worker | null = null;
let labelProbe: HTMLButtonElement | null = null;
const labelMeasurements = new Map<string, { width: number; height: number }>();
let generation = 0;
let presentationGeneration = 0;
let changingPresentation = false;
let mounted = false;
let disposed = false;
let frame = 0;
let meshes: THREE.Mesh[] = [];
let lineObjects: THREE.LineSegments[] = [];
let paintedFocus: Set<string> | null | undefined;
let frameFit = true;
let needsLayout = false;
const positions = new Map<string, OpportunityGraphPosition>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const topicId = (id: string) => `topic:${id}`;
const jobId = (id: string) => `job:${id}`;

const model = computed(() => {
  if (props.viewMode === 'jobs') {
    const result = currentJobEvidence.value ?? { nodes: opportunityJobGraphNodes(props.graph, props.jobMinimumInterest, { excludedTopicIds: props.jobExcludedTopicIds }), links: [], entityKind: 'job' as const };
    return { ...result, nodes: result.nodes.map(node => ({ ...node, label: node.label || text('Title withheld', 'Titel zurückgehalten') })) };
  }
  const visibleTopics = props.visibleTopicIds ? new Set(props.visibleTopicIds) : null;
  const topics = props.graph.topics.filter(topic => !visibleTopics || visibleTopics.has(topic.id));
  const nodes: OpportunityGraphNode[] = topics.map(topic => {
    const matchingJobCount = props.matchingJobCounts?.[topic.id] ?? topic.jobCount;
    return { id: topicId(topic.id), label: topic.label, kind: 'topic',
      radius: 4 + Math.min(12, Math.sqrt(matchingJobCount) * 3), highInterestCount: topic.highInterestCount, matchingJobCount,
      lowInterestCount: topic.lowInterestCount, avoidedCount: topic.avoidedCount, positiveReasonCount: topic.positiveReasonCount,
      mismatch: false, avoided: topic.avoidedCount > 0 };
  });
  const threshold = props.interestThreshold ?? (props.interestMode === 'low' ? 4 : 8);
  const jobs = props.interestMode === 'all' ? props.graph.jobs : props.graph.jobs.filter(job => job.explicitInterest && job.interestScore !== null
    && (props.interestMode === 'low' ? job.interestScore <= threshold : job.interestScore >= threshold));
  const sharedJobs = new Map<string, { source: string; target: string; count: number }>();
  for (const job of jobs) {
    const ids = [...new Set(job.topicIds)].filter(id => !visibleTopics || visibleTopics.has(id)).sort();
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const source = ids[a]!, target = ids[b]!, key = JSON.stringify([source, target]);
      const pair = sharedJobs.get(key) ?? { source, target, count: 0 };
      pair.count++; sharedJobs.set(key, pair);
    }
  }
  const links: OpportunityGraphLink[] = [...sharedJobs.values()].map(edge => ({ source: topicId(edge.source), target: topicId(edge.target), weight: edge.count, kind: 'cooccurrence' }));
  links.push(...opportunityGraphSemanticLinks(nodes));
  return { nodes, links, entityKind: 'topic' as const };
});
const nodeById = computed(() => new Map(model.value.nodes.map(node => [node.id, node])));
const nodeIndexes = computed(() => new Map(model.value.nodes.map((node, index) => [node.id, index])));
const prominentNodes = computed(() => new Set([...model.value.nodes].sort((a, b) => (b.matchingJobCount ?? b.highInterestCount) - (a.matchingJobCount ?? a.highInterestCount) || a.label.localeCompare(b.label)).slice(0, 10).map(node => node.id)));
const selectedIds = computed(() => new Set(props.viewMode === 'jobs'
  ? props.selectedJobId ? [jobId(props.selectedJobId)] : [] : props.selectedTopicIds.map(topicId)));
const relatedIds = computed(() => props.viewMode === 'jobs'
  ? currentJobEvidence.value ? opportunityJobGraphFocus(currentJobEvidence.value.adjacency, props.selectedJobId ? jobId(props.selectedJobId) : null) : null
  : opportunityTopicFocus(model.value.nodes.map(node => node.id), model.value.links, selectedIds.value));
watch(relatedIds, ids => emit('focusTopics', props.viewMode === 'topics' && ids ? [...ids].map(id => id.slice(6)) : null), { immediate: true });
const edgeDescription = computed(() => {
  const edge = hoveredEdge.value;
  if (!edge) return '';
  const source = nodeById.value.get(edge.source)?.label ?? '', target = nodeById.value.get(edge.target)?.label ?? '';
  return edge.kind === 'job-overlap'
    ? `${source} · ${target}: ${edge.sharedTopicCount ?? 0} ${text('exact shared labels', 'exakt gemeinsame Bezeichnungen')} · ${edge.inferredTopicCount ?? 0} ${text('inferred related groups', 'abgeleitete verwandte Gruppen')} · ${Math.round((edge.similarity ?? edge.weight) * 100)}% ${text('topic similarity', 'Themenähnlichkeit')}${edge.sentimentSimilarity === undefined ? '' : ` · ${Math.round(edge.sentimentSimilarity * 100)}% ${text('preference agreement', 'Präferenzübereinstimmung')}`}`
    : edge.kind === 'cooccurrence'
    ? `${source} · ${target}: ${edge.weight} ${observedJobLabel(edge.weight)}`
    : edge.kind === 'semantic' ? `${source} · ${target}: ${text('related wording', 'verwandte Begriffe')}`
    : `${source} · ${target}`;
});
function observedJobLabel(count: number) {
  if (props.interestMode === 'high') return text(count === 1 ? 'shared job above the interest threshold' : 'shared jobs above the interest threshold', count === 1 ? 'gemeinsame Stelle über der Interessenschwelle' : 'gemeinsame Stellen über der Interessenschwelle');
  if (props.interestMode === 'low') return text(count === 1 ? 'shared job below the interest threshold' : 'shared jobs below the interest threshold', count === 1 ? 'gemeinsame Stelle unter der Interessenschwelle' : 'gemeinsame Stellen unter der Interessenschwelle');
  return text(count === 1 ? 'shared job' : 'shared jobs', count === 1 ? 'gemeinsame Stelle' : 'gemeinsame Stellen');
}
function nodeDescription(id: string) {
  const node = nodeById.value.get(id);
  if (!node) return '';
  if (node.kind === 'job') return `${node.label}: ${node.topicCount ?? 0} ${node.topicCount === 1 ? text('topic group used for clustering', 'Themengruppe für die Gruppenbildung') : text('topic groups used for clustering', 'Themengruppen für die Gruppenbildung')}; ${text('interest', 'Interesse')} ${node.interestScore ?? '—'} / 10`;
  const preference = opportunityGraphPreference(node);
  const evidence = preference ? preference.source === 'reasons'
    ? text('preference weighting from targeted reasons', 'Präferenzgewicht aus zugeordneten Gründen')
    : text('preference weighting from rated jobs', 'Präferenzgewicht aus bewerteten Stellen')
    : text('too little feedback for preference weighting', 'zu wenig Feedback für Präferenzgewichtung');
  return `${node.label}: ${node.matchingJobCount ?? node.highInterestCount} ${text('matching jobs', 'passende Stellen')}; ${node.highInterestCount} ${text('high interest', 'hohes Interesse')}; ${node.lowInterestCount ?? 0} ${text('low interest', 'geringes Interesse')}; ${node.avoidedCount ?? 0} ${text('explicit avoid reasons', 'ausdrückliche Vermeidungsgründe')}; ${node.positiveReasonCount ?? 0} ${text('explicit positive reasons', 'ausdrücklich positive Gründe')}; ${evidence}`;
}
const canvasLabel = computed(() => text(`${props.viewMode === 'jobs' ? 'Job' : 'Topic'} network. Use arrow keys to pan, plus and minus to zoom, and Home to reset. Select topics and jobs using the visible lists.`, `${props.viewMode === 'jobs' ? 'Stellen' : 'Themen'}netzwerk. Pfeiltasten verschieben, Plus und Minus zoomen, Pos1 setzt die Ansicht zurück. Themen und Stellen über die sichtbaren Listen auswählen.`));
watch(canvasLabel, label => renderer?.domElement.setAttribute('aria-label', label));
const focusedDescription = computed(() => {
  const id = hoveredId.value ?? focusedId.value;
  return id ? nodeDescription(id) : '';
});
useToastWatch(() => busy.value ? props.viewMode === 'jobs' ? text('Arranging job clusters…', 'Stellengruppen werden angeordnet…') : text('Arranging topic relationships…', 'Themenbeziehungen werden angeordnet…') : '', { passive: true });

function requestDraw() {
  if (frame || disposed || document.hidden || !renderer) return;
  frame = requestAnimationFrame(() => { frame = 0; draw(); });
}
function colour(node: OpportunityGraphNode): string {
  if (node.avoided || node.mismatch) return '#e8a6b0';
  if (node.kind === 'topic' && !(node.matchingJobCount ?? node.highInterestCount)) return '#87999e';
  const palette = node.kind === 'job' ? JOB_CLUSTER_COLORS : TOPIC_CLUSTER_COLORS;
  return palette[(positions.get(node.id)?.community ?? 0) % palette.length]!;
}
function clearScene() {
  if (!scene) return;
  for (const child of [...scene.children]) {
    scene.remove(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
    }
  }
  meshes = []; lineObjects = [];
}
function initialPosition(id: string, index: number): OpportunityGraphPosition {
  return { id, x: Math.cos(index * 2.399963) * (40 + Math.sqrt(index) * 22), y: Math.sin(index * 2.399963) * (40 + Math.sqrt(index) * 22), z: 0, community: 0 };
}
function buildScene() {
  if (!scene || !renderer) return;
  clearScene();
  paintedFocus = undefined;
  model.value.nodes.forEach((node, index) => {
    const point = positions.get(node.id) ?? initialPosition(node.id, index);
    const geometry = node.kind === 'job' ? new THREE.OctahedronGeometry(node.radius)
      : dimensions.value === 3 ? new THREE.SphereGeometry(node.radius, 16, 12) : new THREE.CircleGeometry(node.radius, 24);
    const material = new THREE.MeshBasicMaterial({ color: colour(node), transparent: true, opacity: 1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(point.x, point.y, dimensions.value === 3 ? point.z : 0);
    mesh.userData.networkId = node.id;
    scene!.add(mesh); meshes.push(mesh);
    if (node.avoided || selectedIds.value.has(node.id)) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(node.radius + 3, node.radius + 4.5, 32), new THREE.MeshBasicMaterial({ color: node.avoided ? '#e8a6b0' : '#eff7f2', side: THREE.DoubleSide, transparent: true }));
      ring.position.copy(mesh.position); ring.position.z += .3;
      ring.userData.billboard = true;
      ring.userData.networkRingFor = node.id;
      if (dimensions.value === 3 && camera) ring.quaternion.copy(camera.quaternion);
      scene!.add(ring);
    }
  });
  for (const kind of ['cooccurrence', 'semantic', 'job-overlap'] as const) {
    const links = model.value.links.filter(link => link.kind === kind);
    if (!links.length) continue;
    const vertices: number[] = [];
    const colours: number[] = [];
    const validLinks: OpportunityGraphLink[] = [];
    const maximumWeight = links.reduce((maximum, link) => Math.max(maximum, link.weight), 1);
    for (const link of links) {
      const sourceIndex = nodeIndexes.value.get(link.source), targetIndex = nodeIndexes.value.get(link.target);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      const source = positions.get(link.source) ?? initialPosition(link.source, sourceIndex), target = positions.get(link.target) ?? initialPosition(link.target, targetIndex);
      vertices.push(source.x, source.y, dimensions.value === 3 ? source.z : -.4, target.x, target.y, dimensions.value === 3 ? target.z : -.4);
      const edgeColour = new THREE.Color(kind === 'semantic' ? '#9abdcf' : '#9fc0b1');
      edgeColour.multiplyScalar(.65 + .35 * Math.log2(link.weight + 1) / Math.log2(maximumWeight + 1));
      colours.push(edgeColour.r, edgeColour.g, edgeColour.b, edgeColour.r, edgeColour.g, edgeColour.b);
      validLinks.push(link);
    }
    const material = kind === 'semantic' ? new THREE.LineDashedMaterial({ vertexColors: true, transparent: true, opacity: .55, dashSize: 5, gapSize: 4 })
      : new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .75 });
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)).setAttribute('color', new THREE.Float32BufferAttribute(colours, 3)), material);
    if (kind === 'semantic') lines.computeLineDistances();
    lines.userData.links = validLinks;
    lines.userData.baseColours = new Float32Array(colours);
    scene.add(lines); lineObjects.push(lines);
  }
  if (frameFit && positions.size) fitNodes();
  requestDraw();
}
function bounds() {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByPoint(mesh.position);
  if (box.isEmpty()) box.expandByPoint(new THREE.Vector3());
  return box;
}
function fitNodes() {
  if (!camera || !controls || !viewport.value) return;
  const box = bounds(), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const width = viewport.value.clientWidth || 600, height = viewport.value.clientHeight || 380;
  if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = Math.min(3, width / Math.max(180, size.x + 140), height / Math.max(180, size.y + 140));
    camera.position.set(center.x, center.y, 1000); camera.updateProjectionMatrix();
  } else {
    const distance = Math.max(size.x / Math.max(.7, width / height), size.y, size.z, 180) * 1.7;
    camera.position.set(center.x + distance * .4, center.y + distance * .35, center.z + distance);
  }
  controls.target.copy(center); controls.update(); frameFit = false; requestDraw();
}
function configureCamera() {
  if (!renderer || !viewport.value) return;
  controls?.dispose();
  const width = viewport.value.clientWidth || 600, height = viewport.value.clientHeight || 380;
  camera = dimensions.value === 2 ? new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 5000)
    : new THREE.PerspectiveCamera(40, width / height, .1, 10000);
  camera.position.set(0, 0, 1000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = dimensions.value === 3;
  controls.mouseButtons.LEFT = dimensions.value === 2 ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = dimensions.value === 2 ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.screenSpacePanning = true;
  controls.minZoom = .1; controls.maxZoom = 12;
  controls.minDistance = 40; controls.maxDistance = 5000;
  controls.addEventListener('change', requestDraw);
  // OrbitControls defaults to touch-action:none. Vertical scrolling stays native in this dashboard.
  renderer.domElement.style.touchAction = 'pan-y';
  frameFit = true;
}
function resize() {
  if (!renderer || !camera || !viewport.value) return;
  const width = Math.max(1, viewport.value.clientWidth), height = Math.max(1, viewport.value.clientHeight);
  renderer.setSize(width, height, false);
  if (camera instanceof THREE.OrthographicCamera) { camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2; }
  else camera.aspect = width / height;
  camera.updateProjectionMatrix(); requestDraw();
}
function measureLabel(label: string, weight: number, maximumWidth: number) {
  const fontFamily = viewport.value ? getComputedStyle(viewport.value).getPropertyValue('--font-ui').trim() : '';
  const font = `${weight} 11px/1.4 ${fontFamily || 'system-ui, sans-serif'}`;
  const key = `${font}\u0000${maximumWidth}\u0000${label}`;
  const cached = labelMeasurements.get(key);
  if (cached) return cached;
  if (!labelProbe && viewport.value) {
    labelProbe = document.createElement('button');
    labelProbe.type = 'button';
    labelProbe.tabIndex = -1;
    labelProbe.setAttribute('aria-hidden', 'true');
    labelProbe.style.cssText = 'all:initial;display:block;position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;box-sizing:border-box;padding:1px 5px;border:0;white-space:normal;overflow-wrap:anywhere;text-align:center;';
    viewport.value.appendChild(labelProbe);
  }
  if (!labelProbe) return { width: maximumWidth, height: 36 };
  labelProbe.style.font = font;
  labelProbe.style.maxWidth = `${maximumWidth}px`;
  labelProbe.style.width = 'max-content';
  labelProbe.textContent = label;
  const width = Math.min(maximumWidth, Math.ceil(labelProbe.getBoundingClientRect().width));
  labelProbe.style.width = `${width}px`;
  // Measure browser wrapping and the actual selected/job font weight, then reserve a conservative line-box margin.
  const measurement = { width, height: Math.ceil(labelProbe.getBoundingClientRect().height) + 2 };
  labelMeasurements.set(key, measurement);
  return measurement;
}
function onFontsLoaded() { labelMeasurements.clear(); requestDraw(); }
function draw() {
  if (!renderer || !scene || !camera || failed.value || document.hidden) return;
  const selected = selectedIds.value;
  const related = relatedIds.value;
  const muted = (id: string) => related !== null && !related.has(id) && !selected.has(id);
  const nodeOpacity = (id: string) => muted(id) && hoveredId.value !== id && focusedId.value !== id ? .22
    : hoveredId.value && hoveredId.value !== id && !selected.has(id) ? .6 : 1;
  const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
  if (width < 24 || height < 24) { labels.value = []; return; }
  const screenRadius = new Map<string, number>();
  for (const mesh of meshes) {
    const id = mesh.userData.networkId as string, material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = nodeOpacity(id);
    const node = nodeById.value.get(id)!;
    const pixelScale = camera instanceof THREE.OrthographicCamera ? camera.zoom
      : height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, camera.position.distanceTo(mesh.position)));
    // A readable lower bound does not remove low-count or isolated topics from the complete map.
    const scale = Math.max(1, 4 / Math.max(.01, node.radius * pixelScale));
    mesh.scale.setScalar(scale);
    screenRadius.set(id, node.radius * pixelScale * scale);
  }
  for (const child of scene.children) if (child.userData.billboard) {
    if (dimensions.value === 3) child.quaternion.copy(camera.quaternion);
    const anchor = meshes.find(mesh => mesh.userData.networkId === child.userData.networkRingFor);
    if (anchor) child.scale.copy(anchor.scale);
    (child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = nodeOpacity(child.userData.networkRingFor as string);
  }
  if (paintedFocus !== related) {
    for (const lines of lineObjects) {
      const colours = lines.geometry.getAttribute('color') as THREE.BufferAttribute;
      const original = lines.userData.baseColours as Float32Array;
      (lines.userData.links as OpportunityGraphLink[]).forEach((link, index) => {
        const strength = related === null || related.has(link.source) && related.has(link.target) ? 1 : .14;
        for (let endpoint = 0; endpoint < 2; endpoint++) {
          const vertex = index * 2 + endpoint, offset = vertex * 3;
          colours.setXYZ(vertex, original[offset]! * strength, original[offset + 1]! * strength, original[offset + 2]! * strength);
        }
      });
      colours.needsUpdate = true;
    }
    paintedFocus = related;
  }
  renderer.render(scene, camera);
  viewSize.value = { width, height };
  const zoom = camera instanceof THREE.OrthographicCamera ? camera.zoom : 650 / Math.max(1, camera.position.distanceTo(controls!.target));
  zoomLevel.value = zoom;
  type Rectangle = { left: number; right: number; top: number; bottom: number };
  const occupied: Rectangle[] = [];
  const overlaps = (a: Rectangle, b: Rectangle) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const projected = new Map(meshes.map(mesh => {
    const point = mesh.position.clone().project(camera!);
    return [mesh.userData.networkId as string, { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, z: point.z }];
  }));
  const nodeObstacles: Rectangle[] = [...projected].map(([id, point]) => {
    const radius = screenRadius.get(id)! + 3;
    return { left: point.x - radius, right: point.x + radius, top: point.y - radius, bottom: point.y + radius };
  });
  const priority = (id: string) => focusedId.value === id || hoveredId.value === id ? 4 : selected.has(id) ? 3 : related?.has(id) || nodeById.value.get(id)?.kind === 'job' ? 2 : 1;
  labels.value = [...meshes].sort((a, b) => priority(b.userData.networkId as string) - priority(a.userData.networkId as string)).flatMap(mesh => {
    const id = mesh.userData.networkId as string, node = nodeById.value.get(id)!;
    if (!(node.kind === 'job' || selected.has(id) || related?.has(id) || hoveredId.value === id || focusedId.value === id || zoom > 1.5 || prominentNodes.value.has(id))) return [];
    const point = projected.get(id)!;
    if (point.z < -1 || point.z > 1 || point.x < 0 || point.x > width || point.y < 0 || point.y > height) return [];
    const x = point.x, y = point.y, radius = screenRadius.get(id)!;
    const measured = measureLabel(node.label, node.kind === 'job' ? 600 : selected.has(id) ? 700 : 500, Math.min(width < 500 ? 125 : 180, width - 12));
    const labelWidth = measured.width, labelHeight = measured.height;
    const gap = radius + 8;
    const candidates = [
      [x - labelWidth / 2, y + gap], [x - labelWidth / 2, y - gap - labelHeight],
      [x + gap, y - labelHeight / 2], [x - gap - labelWidth, y - labelHeight / 2],
      [x + gap, y + gap], [x - gap - labelWidth, y + gap],
      [x + gap, y - gap - labelHeight], [x - gap - labelWidth, y - gap - labelHeight],
      [x - labelWidth / 2, y + gap + labelHeight + 14], [x - labelWidth / 2, y - gap - labelHeight * 2 - 14],
    ].map(([left, top]) => {
      const safeLeft = THREE.MathUtils.clamp(left!, 6, Math.max(6, width - labelWidth - 6));
      const safeTop = THREE.MathUtils.clamp(top!, 6, Math.max(6, height - labelHeight - 6));
      return { left: safeLeft, right: safeLeft + labelWidth, top: safeTop, bottom: safeTop + labelHeight };
    });
    const placement = candidates.find(rect => !occupied.some(other => overlaps(rect, other)) && !nodeObstacles.some(other => overlaps(rect, other)))
      ?? (priority(id) >= 3 ? candidates.find(rect => !occupied.some(other => overlaps(rect, other))) : undefined);
    if (!placement) return [];
    occupied.push({ left: placement.left - 4, right: placement.right + 4, top: placement.top - 3, bottom: placement.bottom + 3 });
    return [{ id, label: node.label, kind: node.kind, left: placement.left, top: placement.top, width: labelWidth, anchorX: x, anchorY: y,
      leaderX: THREE.MathUtils.clamp(x, placement.left, placement.right), leaderY: THREE.MathUtils.clamp(y, placement.top, placement.bottom),
      selected: selected.has(id), avoided: node.avoided, muted: muted(id) }];
  });
}
function hit(event: PointerEvent | MouseEvent) {
  if (!renderer || !camera) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  raycaster.params.Line = { threshold: 4 / Math.max(.2, zoomLevel.value) };
  return raycaster.intersectObjects(meshes, false)[0] ?? null;
}
function onPointerMove(event: PointerEvent) {
  nodePress.move(event);
  if (event.buttons || !camera || !renderer) return;
  const result = hit(event);
  hoveredId.value = result?.object.userData.networkId as string ?? null;
  hoveredEdge.value = null;
  if (!result) {
    const edge = raycaster.intersectObjects(lineObjects, false)[0];
    if (edge?.index !== undefined) hoveredEdge.value = (edge.object.userData.links as OpportunityGraphLink[])[Math.floor(edge.index / 2)] ?? null;
  }
  renderer.domElement.style.cursor = result ? 'pointer' : 'grab'; requestDraw();
}
function select(id: string) {
  if (id.startsWith('topic:')) emit('selectTopic', id.slice(6)); else emit('selectJob', id.slice(4));
}
const nodePress = createOpportunityNetworkSelection();
function onPointerDown(event: PointerEvent) { nodePress.begin(event); }
function onPointerUp(event: PointerEvent) {
  if (nodePress.end(event)) {
    const result = hit(event);
    if (result) select(result.object.userData.networkId as string);
  }
}
function onPointerLeave() { nodePress.cancel(); hoveredId.value = null; hoveredEdge.value = null; requestDraw(); }
function zoom(direction: number) {
  if (!camera || !controls) return;
  if (camera instanceof THREE.OrthographicCamera) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * (direction > 0 ? 1.3 : 1 / 1.3), .1, 12); camera.updateProjectionMatrix(); }
  else camera.position.copy(controls.target.clone().add(camera.position.clone().sub(controls.target).multiplyScalar(direction > 0 ? .8 : 1.25)));
  controls.update(); requestDraw();
}
function onKey(event: KeyboardEvent) {
  if (event.target !== renderer?.domElement || !camera || !controls) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1); }
  else if (event.key === '-') { event.preventDefault(); zoom(-1); }
  else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); fitNodes(); }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const distance = 25 / Math.max(.2, zoomLevel.value);
    const offset = new THREE.Vector3(event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0,
      event.key === 'ArrowUp' ? distance : event.key === 'ArrowDown' ? -distance : 0, 0);
    camera.position.add(offset); controls.target.add(offset); controls.update(); requestDraw();
  }
}
function stopWorker() {
  worker?.terminate();
  worker = null;
}
function announceFailure() {
  if (disposed) return;
  failed.value = true; busy.value = false; stopWorker();
  emit('availability', false);
  stopRenderer();
  const owner = props.ownerId, token = generation;
  failureToast = notify({ tone: 'error', message: presentation.value === 'bundling'
    ? text('The shared-topic connections could not be computed. The job list remains available.', 'Die Verbindungen gemeinsamer Themen konnten nicht berechnet werden. Die Stellenliste bleibt verfügbar.')
    : presentation.value === 'hierarchy'
    ? text('The relationship hierarchy could not be computed. The topic and job lists remain available.', 'Die Beziehungshierarchie konnte nicht berechnet werden. Themen- und Stellenlisten bleiben verfügbar.')
    : text('The relationship map could not be displayed. The topic and job lists remain available.', 'Die Beziehungskarte konnte nicht angezeigt werden. Themen- und Stellenlisten bleiben verfügbar.'),
    action: { label: retryLabel.value, run: () => !disposed && props.ownerId === owner && generation === token ? retry() : undefined } });
}
function onContextLost(event: Event) { event.preventDefault(); announceFailure(); }
function stopRenderer() {
  nodePress.cancel();
  if (frame) cancelAnimationFrame(frame); frame = 0;
  observer?.disconnect(); observer = null;
  controls?.dispose(); controls = null;
  labelProbe?.remove(); labelProbe = null; labelMeasurements.clear();
  if (renderer) {
    const canvas = renderer.domElement;
    canvas.removeEventListener('pointermove', onPointerMove); canvas.removeEventListener('pointerdown', onPointerDown); canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerLeave); canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('webglcontextlost', onContextLost);
    clearScene(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  }
  renderer = null; scene = null; camera = null; labels.value = [];
}
function initialize() {
  if (!viewport.value || disposed) return;
  stopRenderer(); failed.value = false;
  if (!model.value.nodes.length) { busy.value = false; emit('availability', false); return; }
  if (presentation.value !== 'network') { emit('availability', true); arrange(); return; }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', canvasLabel.value);
    viewport.value.appendChild(renderer.domElement);
    scene = new THREE.Scene(); configureCamera();
    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', onPointerMove); canvas.addEventListener('pointerdown', onPointerDown); canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerLeave); canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('keydown', onKey); canvas.addEventListener('webglcontextlost', onContextLost);
    observer = new ResizeObserver(resize); observer.observe(viewport.value);
    emit('availability', true);
    resize(); buildScene(); arrange();
  } catch { stopRenderer(); announceFailure(); }
}
function arrange() {
  if (failed.value || disposed || presentation.value === 'network' && !renderer) return;
  stopWorker();
  const token = ++generation, owner = props.ownerId, source = props.graph, minimumInterest = props.jobMinimumInterest, excludedKey = jobExcludedKey.value;
  if (props.layoutPaused || document.hidden) { busy.value = false; needsLayout = true; return; }
  if (presentation.value === 'network') buildScene();
  needsLayout = false;
  if (!model.value.nodes.length) { busy.value = false; return; }
  busy.value = true;
  try {
    worker = new Worker(new URL('../workers/opportunityGraph.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<OpportunityGraphLayoutResponse>) => {
      if (disposed || token !== generation || owner !== props.ownerId || data.generation !== token) return;
      stopWorker(); busy.value = false;
      if ('error' in data) { announceFailure(); return; }
      if (data.graph) jobEvidence.value = { source, minimumInterest, excludedKey, graph: data.graph };
      if (data.hierarchy) hierarchy.value = data.hierarchy;
      if (data.bundling) bundling.value = data.bundling;
      if (presentation.value === 'network') {
        for (const point of data.positions) positions.set(point.id, point);
        buildScene();
      }
    };
    worker.onerror = event => { event.preventDefault(); if (!disposed && token === generation && owner === props.ownerId) announceFailure(); };
    worker.postMessage({ generation: token, view: presentation.value, nodes: model.value.nodes, links: props.viewMode === 'jobs' ? [] : model.value.links, jobs: props.viewMode === 'jobs' ? props.graph.jobs : undefined, jobMinimumInterest: minimumInterest, jobClusterCount: props.jobClusterCount, jobExcludedTopicIds: props.viewMode === 'jobs' ? [...props.jobExcludedTopicIds] : undefined, jobTopics: props.viewMode === 'jobs' ? props.graph.topics : undefined, dimensions: dimensions.value, entityKind: model.value.entityKind, previous: [...positions.values()] });
  } catch { announceFailure(); }
}
async function retry() { if (failureToast) dismiss(failureToast); failureToast = 0; await nextTick(); initialize(); }
function visibility() {
  if (document.hidden) {
    if (frame) cancelAnimationFrame(frame); frame = 0;
    if (worker) { generation++; stopWorker(); busy.value = false; needsLayout = true; }
  } else if (needsLayout) arrange(); else requestDraw();
}

const evidenceSources = [() => props.graph, () => props.viewMode, () => props.jobMinimumInterest, jobExcludedKey,
  () => props.viewMode === 'jobs' ? props.jobClusterCount : null,
  () => props.visibleTopicIds, () => props.matchingJobCounts, () => props.interestMode, () => props.interestThreshold];
watch([...evidenceSources, () => props.layoutPaused], () => {
  if (!mounted || changingPresentation) return;
  if (!model.value.nodes.length) { generation++; stopWorker(); busy.value = false; hierarchy.value = []; bundling.value = null; stopRenderer(); emit('availability', false); return; }
  if (presentation.value !== 'network') { arrange(); return; }
  if (!renderer && !failed.value) initialize(); else arrange();
});
watch(evidenceSources, () => { hierarchy.value = []; bundling.value = null; hoveredEdge.value = null; }, { flush: 'sync' });
watch([() => props.selectedTopicIds, () => props.selectedJobId], () => { buildScene(); }, { deep: true });
watch(() => props.viewMode, mode => {
  frameFit = true; hoveredId.value = null; focusedId.value = null; hoveredEdge.value = null;
  if (mode !== 'jobs' && presentation.value === 'bundling') presentation.value = 'network';
}, { flush: 'sync' });
watch(dimensions, () => { if (presentation.value === 'network') { configureCamera(); arrange(); } });
watch(presentation, async () => {
  const transition = ++presentationGeneration;
  changingPresentation = true;
  generation++; stopWorker(); busy.value = false;
  bundling.value = null;
  if (failureToast) dismiss(failureToast); failureToast = 0;
  stopRenderer(); failed.value = false;
  await nextTick();
  if (disposed || transition !== presentationGeneration) return;
  changingPresentation = false;
  initialize();
}, { flush: 'sync' });
watch(() => props.ownerId, () => {
  generation++; stopWorker(); positions.clear(); hierarchy.value = []; bundling.value = null; jobEvidence.value = null;
  dimensions.value = 2; hoveredId.value = null; focusedId.value = null; hoveredEdge.value = null;
  if (failureToast) dismiss(failureToast); failureToast = 0;
  if (mounted) { frameFit = true; if (!changingPresentation) initialize(); }
}, { flush: 'sync' });
onMounted(() => { mounted = true; initialize(); document.addEventListener('visibilitychange', visibility); document.fonts?.addEventListener('loadingdone', onFontsLoaded); });
onBeforeUnmount(() => { disposed = true; generation++; stopWorker(); busy.value = false; stopRenderer(); document.removeEventListener('visibilitychange', visibility); document.fonts?.removeEventListener('loadingdone', onFontsLoaded); if (failureToast) dismiss(failureToast); });
</script>

<template>
  <section class="topic-network" :aria-busy="busy">
    <div class="network-toolbar">
      <Teleport defer :to="presentationControlsTarget || 'body'" :disabled="!presentationControlsTarget">
        <div class="network-view-controls network-presentation" role="group" :aria-label="viewMode === 'jobs' ? text('Job cluster view', 'Ansicht der Stellengruppen') : text('Topic relationship view', 'Ansicht der Themenbeziehungen')"><button type="button" :aria-pressed="presentation === 'network'" @click="presentation = 'network'">{{ text('Network', 'Netzwerk') }}</button><button type="button" :aria-pressed="presentation === 'hierarchy'" @click="presentation = 'hierarchy'">{{ text('Hierarchy', 'Hierarchie') }}</button><button v-if="viewMode === 'jobs'" type="button" :aria-pressed="presentation === 'bundling'" @click="presentation = 'bundling'">{{ text('Hierarchical edge bundling', 'Hierarchische Kantenbündelung') }}</button></div>
      </Teleport>
      <Teleport defer :to="cameraControlsTarget || 'body'" :disabled="!cameraControlsTarget">
        <div v-if="presentation === 'network'" class="network-view-controls" role="group" :aria-label="text('Network view', 'Netzwerkansicht')">
        <button type="button" :aria-pressed="dimensions === 2" @click="dimensions = 2">2D</button><button type="button" :aria-pressed="dimensions === 3" @click="dimensions = 3">3D</button>
        <button type="button" :disabled="failed || !model.nodes.length" @click="fitNodes()">{{ text('Reset view', 'Ansicht zurücksetzen') }}</button>
        <InfoHint :lang="lang" :label="viewMode === 'jobs' ? text('Job network controls', 'Steuerung des Stellennetzwerks') : text('Topic network controls', 'Steuerung des Themennetzwerks')" :text="viewMode === 'jobs' ? text('Drag to pan in 2D or rotate in 3D; scroll to zoom. Read size as topic groups per job, links as shared or related topics, and colors as clusters.', 'Ziehe zum Verschieben in 2D oder Drehen in 3D; scrolle zum Zoomen. Lies die Größe als Themengruppen pro Stelle, Linien als gemeinsame oder verwandte Themen und Farben als Gruppen.') : text('Drag to pan in 2D or rotate in 3D; scroll to zoom. Size counts matching jobs. Solid links show shared jobs, dashed links suggest related names, and colors show groups. Pink outlines mark your topic-specific avoid reasons.', 'Ziehe zum Verschieben in 2D oder Drehen in 3D; scrolle zum Zoomen. Die Größe zählt passende Stellen. Durchgezogene Linien zeigen gemeinsame Stellen, gestrichelte ähnliche Bezeichnungen und Farben die Gruppen. Rosa Umrisse markieren deine themenbezogenen Vermeidungsgründe.')" />
        </div>
      </Teleport>
      <button v-if="failed" class="network-retry" type="button" @click="retry">{{ retryLabel }}</button>
    </div>
    <OpportunityTopicHierarchy v-if="presentation === 'hierarchy' && !failed && model.nodes.length" :forest="hierarchy" :nodes="model.nodes" :selected-ids="selectedIds" :related-ids="relatedIds" :entity-kind="viewMode === 'jobs' ? 'job' : 'topic'" :lang="lang" :busy="busy" @select="select" />
    <OpportunityJobBundling v-if="presentation === 'bundling' && viewMode === 'jobs' && !failed && model.nodes.length" :diagram="bundling" :nodes="model.nodes" :topics="graph.topics" :selected-id="selectedJobId ? jobId(selectedJobId) : null" :lang="lang" :busy="busy" @select="select" />
    <div v-show="presentation === 'network' && !failed && model.nodes.length" ref="viewport" class="network-canvas">
      <svg class="network-leaders" :viewBox="`0 0 ${viewSize.width} ${viewSize.height}`" aria-hidden="true"><line v-for="label in labels" :key="label.id" :class="{ 'is-muted': label.muted }" :x1="label.anchorX" :y1="label.anchorY" :x2="label.leaderX" :y2="label.leaderY" /></svg>
      <div class="network-labels">
        <button v-for="label in labels" :key="label.id" type="button" :class="{ 'is-selected': label.selected, 'is-job': label.kind === 'job', 'is-avoided': label.avoided, 'is-muted': label.muted }" :style="{ left: `${label.left}px`, top: `${label.top}px`, width: `${label.width}px` }" :aria-label="nodeDescription(label.id)" :aria-pressed="label.selected" @click="select(label.id)" @focus="focusedId = label.id; requestDraw()" @blur="focusedId = null; requestDraw()">{{ label.label }}</button>
      </div>
    </div>
    <p v-if="!model.nodes.length" class="network-empty">{{ viewMode === 'jobs' ? text('No jobs meet the minimum interest in this range.', 'Keine Stellen erreichen das Mindestinteresse in diesem Zeitraum.') : text('No topics match these filters.', 'Keine Themen entsprechen diesen Filtern.') }}</p>
    <p v-if="presentation === 'network' && focusedDescription" class="network-edge-record">{{ focusedDescription }}</p>
    <p v-if="presentation === 'network' && edgeDescription" class="network-edge-record">{{ edgeDescription }}</p>
  </section>
</template>

<style scoped>
.topic-network { min-width: 0; color: var(--ui-text); }
.network-view-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.network-view-controls > button, .network-retry { min-height: 36px; padding: 5px 10px; border: 1px solid var(--ui-border); border-radius: 5px; color: var(--ui-muted); background: var(--ui-control); font: 600 12px/1.5 var(--font-ui); cursor: pointer; }
.network-view-controls > button:hover:not(:disabled), .network-retry:hover { color: var(--ui-text); background: var(--ui-surface-hover); }
.network-view-controls > button[aria-pressed=true], .network-view-controls > button[aria-pressed=true]:hover { color: var(--ui-accent); border-color: var(--ui-accent-border); background: var(--ui-active); }
.network-view-controls > button:disabled { opacity: .45; cursor: default; }
.network-canvas { position: relative; height: clamp(460px, 62vh, 740px); overflow: hidden; border-block: 1px solid var(--ui-divider); }
.network-canvas :deep(canvas) { display: block; width: 100%; height: 100%; outline-offset: -3px; cursor: grab; }
.network-leaders { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
.network-leaders line.is-muted { opacity: .12; }
.network-leaders line { stroke: var(--ui-muted); stroke-width: 1; opacity: .5; }
.network-labels { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.network-labels > button { box-sizing: border-box; position: absolute; max-width: 180px; padding: 1px 5px; border: 0; border-radius: 3px; color: var(--ui-text); background: var(--ui-surface); font: 500 11px/1.4 var(--font-ui); overflow-wrap: anywhere; text-align: center; cursor: pointer; pointer-events: auto; }
.network-labels > button.is-muted { color: var(--ui-muted); background: transparent; }
.network-labels > button.is-muted:hover, .network-labels > button.is-muted:focus-visible { color: var(--ui-text); background: var(--ui-surface); }
.network-labels > button.is-selected { color: var(--ui-accent); font-weight: 700; }
.network-labels > button.is-job { max-width: 210px; font-weight: 600; }
.network-labels > button.is-avoided { text-decoration: underline; text-decoration-color: var(--ui-score-red); text-underline-offset: 3px; }
.network-empty, .network-edge-record { margin: 12px 0 0; color: var(--ui-muted); font-size: 12px; }
.topic-network :is(button, summary):focus-visible, .network-view-controls > button:focus-visible, .network-canvas :deep(canvas:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.network-canvas :deep(canvas:focus-visible) { outline-offset: -3px; }
@media (max-width: 760px) {
  .network-canvas { height: clamp(400px, 56vh, 560px); }
  .network-view-controls > button, .network-retry { min-height: 44px; }
  .network-labels > button { max-width: 125px; font-size: 11px; }
}
</style>
