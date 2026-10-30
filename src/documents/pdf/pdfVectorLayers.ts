import type { PageSlice, VectorLayer, VectorSnapshot } from './pdfTypes';

// Both outputs replay the same reserved footer area, including clickable links.
export function vectorPageLayers(snapshot: Pick<VectorSnapshot, 'recording' | 'canvas' | 'links' | 'footer'>, page: PageSlice): VectorLayer[] {
  return [{ recording: snapshot.recording, canvas: snapshot.canvas, links: snapshot.links, page }, ...(snapshot.footer ? [snapshot.footer] : [])];
}
