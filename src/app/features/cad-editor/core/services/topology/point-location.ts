import type { IPoint } from '../../models/entity.model';
import type { IFace } from './types';

/**
 * Find the smallest CCW interior face that contains the query point.
 *
 * Implementation: even-odd point-in-polygon over each face's tessellated
 * outline (the polygon list emitted by `face-extractor.ts`). Picks the
 * face with the minimum positive signed area whose polygon contains the
 * point — this is the "smallest enclosing face" semantic the hatch tool
 * relies on for pick-point fill.
 *
 * Phase 2.5 will swap this for ray-cast against an R-tree of half-edges
 * (O(log E) per query); Phase 2 keeps the linear pass for parity with the
 * old implementation, which uses the same algorithm.
 */
export function pickFaceContaining(
  faces: IFace[],
  clickX: number,
  clickY: number,
): IFace | null {
  let best: IFace | null = null;
  let bestArea = Infinity;
  for (const f of faces) {
    if (f.signedArea <= 0) continue;
    if (!pointInPolygon(f.polygon, clickX, clickY)) continue;
    if (f.signedArea < bestArea) {
      bestArea = f.signedArea;
      best = f;
    }
  }
  return best;
}

/**
 * Direct-island rule: from a candidate set, keep only the faces that are
 * inside the outer face AND that don't contain the click point AND that
 * aren't contained inside another candidate.
 *
 * "Don't contain the click" excludes the outer face itself.
 * "Not nested in another candidate" prevents even-odd fill from toggling
 * back on for deeply-nested rings.
 */
export function collectDirectIslands(
  faces: IFace[],
  outer: IFace,
  clickX: number,
  clickY: number,
): IFace[] {
  const candidates: IFace[] = [];
  for (const f of faces) {
    if (f === outer) continue;
    if (f.signedArea <= 0) continue;
    if (pointInPolygon(f.polygon, clickX, clickY)) continue;
    if (!f.polygon.length) continue;

    // A true island must be strictly inside the outer face. We cannot just test f.polygon[0]
    // because for adjacent faces, f.polygon[0] might be an intersection point shared with outer,
    // where pointInPolygon yields erratic results. We require at least one point STRICTLY inside.
    let isInside = false;
    for (const p of f.polygon) {
      if (!pointOnPolygonBoundary(outer.polygon, p.x, p.y) && pointInPolygon(outer.polygon, p.x, p.y)) {
        isInside = true;
        break;
      }
    }
    if (!isInside) continue;
    
    candidates.push(f);
  }

  // Filter out candidates that are nested inside another candidate.
  return candidates.filter(
    (c) =>
      !candidates.some((o) => {
        if (o === c) return false;
        let isInside = false;
        for (const p of c.polygon) {
          if (!pointOnPolygonBoundary(o.polygon, p.x, p.y) && pointInPolygon(o.polygon, p.x, p.y)) {
            isInside = true;
            break;
          }
        }
        return isInside;
      }),
  );
}

/**
 * Check if a point lies exactly on the boundary of a polygon, within a small tolerance.
 * Used to disambiguate shared boundary points from strict interior points.
 */
function pointOnPolygonBoundary(poly: IPoint[], x: number, y: number, tol = 1e-6): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) {
      if (Math.hypot(x - a.x, y - a.y) < tol) return true;
      continue;
    }
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    if (Math.hypot(x - px, y - py) < tol) return true;
  }
  return false;
}

/**
 * Standard even-odd point-in-polygon. Linear in vertex count, no edge
 * structure assumptions. Treats edge-incident points as "outside" with an
 * implicit bias from the `>` comparison — acceptable for face containment
 * because the planar-arrangement quantization shifts points away from edges.
 */
export function pointInPolygon(poly: IPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y, yj = poly[j].y;
    if ((yi > y) !== (yj > y)) {
      const xi = poly[i].x, xj = poly[j].x;
      const xCross = xi + ((xj - xi) * (y - yi)) / (yj - yi + 1e-30);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}
