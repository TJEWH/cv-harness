declare module 'd3-force-3d' {
  import type { Simulation as BaseSimulation, SimulationNodeDatum as BaseNode, SimulationLinkDatum as BaseLink, ForceCenter as BaseCenter, Force as BaseForce } from 'd3-force';

  export interface SimulationNodeDatum extends BaseNode {
    z?: number;
    vz?: number;
    fz?: number | null;
  }
  export interface SimulationLinkDatum<NodeDatum extends SimulationNodeDatum> extends BaseLink<NodeDatum> {}
  export interface Simulation<NodeDatum extends SimulationNodeDatum> extends BaseSimulation<NodeDatum, SimulationLinkDatum<NodeDatum>> {
    numDimensions(): 1 | 2 | 3;
    numDimensions(dimensions: 1 | 2 | 3): this;
  }
  export interface ForceCenter<NodeDatum extends SimulationNodeDatum> extends BaseCenter<NodeDatum> {
    z(): number;
    z(value: number): this;
  }
  export interface ForceZ<NodeDatum extends SimulationNodeDatum> extends BaseForce<NodeDatum, SimulationLinkDatum<NodeDatum>> {
    z(): (node: NodeDatum, index: number, nodes: NodeDatum[]) => number;
    z(value: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): this;
    strength(): (node: NodeDatum, index: number, nodes: NodeDatum[]) => number;
    strength(value: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): this;
  }
  export function forceSimulation<NodeDatum extends SimulationNodeDatum>(nodes?: NodeDatum[], dimensions?: 1 | 2 | 3): Simulation<NodeDatum>;
  export function forceCenter<NodeDatum extends SimulationNodeDatum>(x?: number, y?: number, z?: number): ForceCenter<NodeDatum>;
  export function forceZ<NodeDatum extends SimulationNodeDatum>(z?: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): ForceZ<NodeDatum>;
  // The APIs below use the same generic node/link contracts as d3-force; dimensionality is supplied by the simulation.
  export { forceCollide, forceLink, forceManyBody, forceX, forceY } from 'd3-force';
}
