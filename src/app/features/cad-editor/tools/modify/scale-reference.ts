import type { Entity } from '../../core/models/entity.model';

/**
 * Cursor distance from the base point that a SCALE drag treats as factor 1.0.
 *
 * This used to be a hardcoded 100 drawing units, which made the drag behave
 * completely differently depending on how big the drawing was and how far the
 * view was zoomed out: on a site plan a few pixels of mouse travel could cross
 * thousands of units and blow the selection up by a factor of 50, while on a
 * zoomed-in detail nothing reachable on screen ever got near 100 units, so the
 * selection could only ever collapse.
 *
 * Measuring against the selection's own extent instead makes the drag
 * scale-invariant: the cursor sitting on the selection's outer corner is 1.0,
 * twice as far out is 2.0, halfway in is 0.5 — at any zoom, in any unit system.
 * Typing an exact factor is unaffected.
 *
 * @returns the distance from (bx, by) to the farthest bbox corner of `targets`,
 *          or 1 (AutoCAD's own implicit reference) for a degenerate selection.
 */
export function scaleReferenceDistance(targets: readonly Entity[], bx: number, by: number): number {
  let far = 0;
  for (const ent of targets) {
    const b = (ent as { bbox?: () => { x: number; y: number; w: number; h: number } | null }).bbox?.();
    if (!b) continue;
    for (const [cx, cy] of [
      [b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h],
    ] as const) {
      far = Math.max(far, Math.hypot(cx - bx, cy - by));
    }
  }
  return far > 1e-9 ? far : 1;
}

/** Scale factor for a cursor at `dist` from the base point. */
export function scaleFactorFor(dist: number, refDist: number): number {
  return Math.max(0.001, dist / refDist);
}
