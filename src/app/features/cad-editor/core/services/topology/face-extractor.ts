import type { IPoint, IBBox } from '../../models/entity.model';
import type { IHalfEdge, IFace, IPlanarGraph } from './types';

/**
 * Walk the planar graph's half-edges and collect every closed face.
 *
 * The graph builder already set `next` pointers per the planar-arrangement
 * rule (face on the LEFT of traversal direction). All we do here is start
 * from each unvisited half-edge, walk `next` until we cycle back, and
 * record the resulting cycle as a face.
 *
 *   - `signedArea > 0` → CCW interior face (a hatch candidate).
 *   - `signedArea < 0` → CW outer / unbounded face.
 *   - `signedArea ≈ 0` → degenerate; dropped.
 *
 * Each face accumulates the set of source entity ids that contributed any
 * of its boundary edges. That set is what the hatch tool uses to decide
 * between single-source associative, multi-source associative, and
 * frozen-loop modes.
 */
export function extractFaces(graph: IPlanarGraph): IFace[] {
  const out: IFace[] = [];
  const visited = new Set<number>();
  let nextFaceId = 0;

  for (const start of graph.halfEdges.values()) {
    if (visited.has(start.id)) continue;
    if (start.next === null) {
      visited.add(start.id);
      continue;
    }

    // Walk the cycle.
    const cycle: IHalfEdge[] = [];
    const polygon: IPoint[] = [];
    const contributingEntityIds = new Set<number>();
    let cur: IHalfEdge | null = start;
    let guard = 0;
    const guardMax = graph.halfEdges.size + 4;

    while (cur && !visited.has(cur.id) && guard++ < guardMax) {
      visited.add(cur.id);
      cycle.push(cur);
      polygon.push({ x: cur.origin.x, y: cur.origin.y });
      contributingEntityIds.add(cur.edge.source.entityId);
      if (cur.edge.coincidentEntityIds) {
        for (const id of cur.edge.coincidentEntityIds) contributingEntityIds.add(id);
      }
      cur = cur.next;
      if (cur === start) break;
    }

    if (cycle.length < 3) continue;

    const sArea = signedArea(polygon);
    if (Math.abs(sArea) < 1e-10) continue;

    const face: IFace = {
      id: nextFaceId++,
      halfEdges: cycle,
      polygon,
      signedArea: sArea,
      bbox: polygonBBox(polygon),
      contributingEntityIds,
    };
    for (const h of cycle) h.face = face;
    graph.faces.set(face.id, face);
    out.push(face);
  }
  return out;
}

/**
 * Signed area via the shoelace formula. Sign encodes orientation:
 *   + → CCW (interior)
 *   − → CW (exterior / unbounded)
 */
export function signedArea(poly: IPoint[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a / 2;
}

export function polygonBBox(poly: IPoint[]): IBBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
