import type { IBBox } from '../../models/entity.model';

/**
 * Uniform-grid broad phase for pairwise segment tests.
 *
 * Visits every unordered pair (i < j) of items whose bounding boxes come
 * within `PAIR_TOL` of each other — exactly once each. Shared by the V2
 * planar-graph builder and the V1 region solver, which both used to test
 * every edge against every other.
 *
 * Why it exists: that all-pairs loop was the memory bomb behind the
 * "Aw, Snap" crash. A hover in open space with the hatch tool assembled the
 * whole drawing (arcs tessellated 32–64 ways) and tested every edge against
 * every other: 40 000 edges is 800 million pair tests and a proportional pile
 * of garbage. Real drawings are sparse — an edge overlaps a handful of
 * neighbours — so binning the boxes into a grid finds the candidate pairs in
 * roughly linear time.
 *
 * Dedup rule: a pair is visited in the cell at the maximum of the two items'
 * minimum cell indices. Both items cover that cell (each covers a contiguous
 * range that includes it) and no other cell satisfies the definition, so
 * every pair is seen exactly once without a hash set of visited pairs.
 *
 * The visit order differs from the nested loop; callers must not depend on
 * it (the splitters sort their split parameters per edge, so they do not).
 */
export function forEachOverlappingPair(
  n: number,
  bboxOf: (i: number) => IBBox,
  visit: (i: number, j: number) => void,
  mode: 'auto' | 'grid' | 'brute' = 'auto',
): void {
  if (mode === 'brute' || (mode === 'auto' && n < BRUTE_FORCE_BELOW)) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) visit(i, j);
    return;
  }
  if (n < 2) return;

  // Cell size ≈ twice the median box extent: a typical edge touches 1–4
  // cells; the sheet frame touches many, but it is one item.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extents = new Float64Array(n);
  const boxes: IBBox[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = bboxOf(i);
    boxes[i] = b;
    extents[i] = Math.max(b.w, b.h);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  const sorted = Float64Array.from(extents).sort();
  let cell = Math.max(sorted[n >> 1] * 2, PAIR_TOL * 10, 1e-6);
  // Never allocate an absurd grid for a huge sparse extent.
  const spanX = Math.max(maxX - minX, cell), spanY = Math.max(maxY - minY, cell);
  const cellsWanted = (spanX / cell) * (spanY / cell);
  if (cellsWanted > MAX_GRID_CELLS) cell *= Math.sqrt(cellsWanted / MAX_GRID_CELLS);
  const stride = Math.floor(spanX / cell) + 3;

  const cx0 = new Int32Array(n), cy0 = new Int32Array(n);
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    const x0 = Math.floor((b.x - PAIR_TOL - minX) / cell) + 1;
    const x1 = Math.floor((b.x + b.w + PAIR_TOL - minX) / cell) + 1;
    const y0 = Math.floor((b.y - PAIR_TOL - minY) / cell) + 1;
    const y1 = Math.floor((b.y + b.h + PAIR_TOL - minY) / cell) + 1;
    cx0[i] = x0; cy0[i] = y0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cy * stride + cx;
        const list = buckets.get(key);
        if (list) list.push(i); else buckets.set(key, [i]);
      }
    }
  }

  for (const [key, list] of buckets) {
    const m = list.length;
    if (m < 2) continue;
    const cellX = key % stride;
    const cellY = (key - cellX) / stride;
    for (let a = 0; a < m; a++) {
      const i = list[a];
      for (let b = a + 1; b < m; b++) {
        const j = list[b];
        if (Math.max(cx0[i], cx0[j]) !== cellX || Math.max(cy0[i], cy0[j]) !== cellY) continue;
        if (i < j) visit(i, j); else visit(j, i);
      }
    }
  }
}

/** Below this many items the all-pairs loop is cheaper than building a grid. */
export const BRUTE_FORCE_BELOW = 48;
/** Boxes closer than this are candidates: covers `EPS_GEOM` crossings and the
 *  endpoint-on-edge test (half a quantisation cell) with a wide margin. */
export const PAIR_TOL = 1e-3;
const MAX_GRID_CELLS = 1_000_000;
