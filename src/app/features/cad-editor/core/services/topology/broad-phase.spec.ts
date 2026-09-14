import type { IBBox } from '../../models/entity.model';
import { forEachOverlappingPair, PAIR_TOL } from './broad-phase';
import { extractEdges, resetEdgeIds } from './edge-extractor';
import { buildPlanarGraph } from './planar-graph';
import { extractFaces } from './face-extractor';

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlapWithin(a: IBBox, b: IBBox, tol: number): boolean {
  return a.x - tol <= b.x + b.w && a.x + a.w + tol >= b.x && a.y - tol <= b.y + b.h && a.y + a.h + tol >= b.y;
}

function collect(n: number, bboxOf: (i: number) => IBBox, mode: 'grid' | 'brute'): Map<string, number> {
  const seen = new Map<string, number>();
  forEachOverlappingPair(n, bboxOf, (i, j) => {
    expect(i).toBeLessThan(j);
    const k = `${i}-${j}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }, mode);
  return seen;
}

describe('forEachOverlappingPair', () => {
  it('visits every overlapping pair exactly once, including pairs with a box that spans the whole grid', () => {
    const rand = rng(7);
    for (const n of [60, 400, 1500]) {
      const boxes: IBBox[] = [];
      for (let i = 0; i < n; i++) {
        const long = rand() < 0.02; // a few "sheet frame" boxes spanning everything
        // Dense enough that even n = 60 has overlapping pairs to check.
        boxes.push(long
          ? { x: rand() * 50, y: rand() * 400, w: 900, h: rand() * 2 }
          : { x: rand() * 800, y: rand() * 400, w: rand() * 40, h: rand() * 40 });
      }
      const visited = collect(n, (i) => boxes[i], 'grid');
      // Exactly once.
      for (const count of visited.values()) expect(count).toBe(1);
      // Every truly overlapping pair (within tolerance) was visited …
      let overlapping = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (overlapWithin(boxes[i], boxes[j], PAIR_TOL)) {
            overlapping++;
            expect(visited.has(`${i}-${j}`)).withContext(`pair ${i}-${j} n=${n}`).toBeTrue();
          }
        }
      }
      // … and the grid pruned most of the rest.
      expect(overlapping).toBeGreaterThan(0);
      expect(visited.size).toBeLessThan((n * (n - 1)) / 2 / 4);
    }
  });

  it('degenerates gracefully: coincident zero-size boxes are all pairwise visited once', () => {
    const n = 100;
    const visited = collect(n, () => ({ x: 5, y: 5, w: 0, h: 0 }), 'grid');
    expect(visited.size).toBe((n * (n - 1)) / 2);
    for (const count of visited.values()) expect(count).toBe(1);
  });

  it('uses the plain double loop below the threshold and for mode="brute"', () => {
    const boxes = [{ x: 0, y: 0, w: 1, h: 1 }, { x: 10, y: 10, w: 1, h: 1 }, { x: 20, y: 20, w: 1, h: 1 }];
    expect(collect(3, (i) => boxes[i], 'brute').size).toBe(3);
    const auto = new Set<string>();
    forEachOverlappingPair(3, (i) => boxes[i], (i, j) => auto.add(`${i}-${j}`));
    expect(auto.size).toBe(3);
  });
});

describe('buildPlanarGraph with the grid broad phase', () => {
  it('produces the same arrangement as the all-pairs pass: a 30×30 line grid has 841 unit faces', () => {
    resetEdgeIds();
    const edges = [];
    let id = 1;
    for (let k = 0; k <= 29; k++) {
      edges.push(...extractEdges({ id: id++, type: 'LINE', x1: 0, y1: k, x2: 29, y2: k } as any));
      edges.push(...extractEdges({ id: id++, type: 'LINE', x1: k, y1: 0, x2: k, y2: 29 } as any));
    }
    expect(edges.length).toBe(60); // ≥ BRUTE_FORCE_BELOW, so the grid path runs
    const faces = extractFaces(buildPlanarGraph(edges));
    const unit = faces.filter((f) => Math.abs(Math.abs(f.signedArea) - 1) < 1e-6);
    expect(unit.length).toBe(841);
  });
});
