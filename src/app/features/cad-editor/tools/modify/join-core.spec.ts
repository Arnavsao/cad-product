/**
 * Unit tests for the JOIN analysis core (join-core.ts).
 *
 * These tests are pure TypeScript — no Angular TestBed, no DOM.
 * LineEntity / PolylineEntity are plain classes with no runtime dependencies,
 * so they can be constructed directly.
 */

import { LineEntity, PolylineEntity } from '../../core/models/entity.model';
import { analyzeJoin, JOIN_TOLERANCE } from './join-core';

// ─── helpers ─────────────────────────────────────────────────────────────────

const tol = JOIN_TOLERANCE;

function line(x1: number, y1: number, x2: number, y2: number): LineEntity {
  return new LineEntity(x1, y1, x2, y2);
}

function pline(...coords: number[]): PolylineEntity {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < coords.length; i += 2) {
    pts.push({ x: coords[i], y: coords[i + 1] });
  }
  return new PolylineEntity(pts, false);
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('analyzeJoin', () => {
  // ── line + line ─────────────────────────────────────────────────────────
  describe('line + line (basic)', () => {
    it('produces one valid chain for two connected lines', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 2, 0);
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(1);
      expect(rejected.length).toBe(0);
    });

    it('includes both source entities', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 2, 0);
      const { validChains } = analyzeJoin([a, b], tol);
      const srcs = validChains[0].sourceEntities;
      expect(srcs.includes(a)).toBe(true);
      expect(srcs.includes(b)).toBe(true);
    });

    it('produces three vertices for two lines', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 2, 0);
      const { validChains } = analyzeJoin([a, b], tol);
      expect(validChains[0].points.length).toBe(3);
    });

    it('puts the correct outer endpoints at positions 0 and N-1', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 2, 0);
      const pts = analyzeJoin([a, b], tol).validChains[0].points;
      const xs = pts.map((p: any) => p.x).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(0, 5);
      expect(xs[xs.length - 1]).toBeCloseTo(2, 5);
    });

    it('is not marked as closed', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 2, 0);
      expect(analyzeJoin([a, b], tol).validChains[0].closed).toBe(false);
    });
  });

  // ── reversed direction ───────────────────────────────────────────────────
  describe('reversed direction', () => {
    it('corrects direction when the first line is reversed', () => {
      const a = line(1, 0, 0, 0); // stored B→A
      const b = line(1, 0, 2, 0);
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(1);
      expect(rejected.length).toBe(0);
      expect(validChains[0].points.length).toBe(3);
    });

    it('corrects direction when the second line is reversed', () => {
      const a = line(0, 0, 1, 0);
      const b = line(2, 0, 1, 0); // stored B→A
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(1);
      expect(rejected.length).toBe(0);
      expect(validChains[0].points.length).toBe(3);
    });
  });

  // ── line + polyline ──────────────────────────────────────────────────────
  describe('line + polyline', () => {
    it('joins a line to an open polyline', () => {
      const a = line(0, 0, 1, 0);
      const b = pline(1, 0, 2, 0, 3, 1);
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(1);
      expect(rejected.length).toBe(0);
      // 2 from line + 2 more from polyline interior/end = 4 total vertices
      expect(validChains[0].points.length).toBe(4);
    });
  });

  // ── polyline + polyline ──────────────────────────────────────────────────
  describe('polyline + polyline', () => {
    it('joins two open polylines', () => {
      const a = pline(0, 0, 1, 0, 2, 0);
      const b = pline(2, 0, 3, 0, 4, 0);
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(1);
      expect(rejected.length).toBe(0);
      expect(validChains[0].points.length).toBe(5);
    });
  });

  // ── closed loop ──────────────────────────────────────────────────────────
  describe('closed loop', () => {
    it('detects a triangle as a closed chain', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 0.5, 1);
      const c = line(0.5, 1, 0, 0);
      const { validChains } = analyzeJoin([a, b, c], tol);
      expect(validChains.length).toBe(1);
      expect(validChains[0].closed).toBe(true);
      expect(validChains[0].sourceEntities.length).toBe(3);
    });
  });

  // ── branching rejection ──────────────────────────────────────────────────
  describe('branching rejection', () => {
    it('rejects entities when 3+ segments share an endpoint', () => {
      // Three lines all meeting at (1, 0)
      const a = line(0, 0, 1, 0);
      const b = line(2, 0, 1, 0);
      const c = line(1, 0, 1, 1);
      const { validChains, rejected } = analyzeJoin([a, b, c], tol);
      expect(validChains.length).toBe(0);
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected.some((r) => r.reason === 'branching')).toBe(true);
    });
  });

  // ── gap within tolerance ─────────────────────────────────────────────────
  describe('gap within tolerance', () => {
    it('joins entities whose gap is ≤ tolerance', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1 + tol * 0.4, 0, 2, 0); // gap < tol
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(1);
      expect(rejected.length).toBe(0);
    });

    it('closes the gap with the midpoint of the two junction endpoints', () => {
      const a = line(0, 0, 1, 0);
      const gap = tol * 0.4;
      const b = line(1 + gap, 0, 2, 0);
      const result = analyzeJoin([a, b], tol);
      expect(result.validChains.length).toBe(1);
      const pts = result.validChains[0].points;
      // Junction is at index 1: midpoint of (1, 0) and (1 + gap, 0)
      expect(pts[1].x).toBeCloseTo(1 + gap / 2, 6);
      expect(pts[1].y).toBeCloseTo(0, 6);
    });
  });

  // ── gap over tolerance ───────────────────────────────────────────────────
  describe('gap over tolerance', () => {
    it('does not join entities whose gap exceeds tolerance', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1 + tol * 2, 0, 2, 0); // gap > tol
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(0);
      expect(rejected.every((r) => r.reason === 'isolated')).toBe(true);
    });
  });

  // ── isolated entity ──────────────────────────────────────────────────────
  describe('isolated entity', () => {
    it('marks a valid entity with no neighbor as isolated', () => {
      const a = line(0, 0, 1, 0);
      const b = line(5, 5, 6, 5); // far away, no connection
      const { validChains, rejected } = analyzeJoin([a, b], tol);
      expect(validChains.length).toBe(0);
      expect(rejected.length).toBe(2);
      expect(rejected.every((r) => r.reason === 'isolated')).toBe(true);
    });

    it('returns the specific isolated entity object', () => {
      const a = line(0, 0, 1, 0);
      const b = line(5, 5, 6, 5);
      const { rejected } = analyzeJoin([a, b], tol);
      const ents = rejected.map((r) => r.entity);
      expect(ents.includes(a)).toBe(true);
      expect(ents.includes(b)).toBe(true);
    });
  });

  // ── unsupported type ─────────────────────────────────────────────────────
  describe('unsupported types', () => {
    it('rejects non-LINE / non-POLYLINE entities', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 2, 0);
      const circle = { type: 'CIRCLE' } as any;
      const { validChains, rejected } = analyzeJoin([a, circle, b], tol);
      expect(validChains.length).toBe(1); // a+b still join
      expect(rejected.some((r) => r.reason === 'unsupported-type')).toBe(true);
      expect(rejected.find((r) => r.reason === 'unsupported-type')?.entity).toBe(circle);
    });

    it('rejects a closed polyline', () => {
      const a = line(0, 0, 1, 0);
      const closed = new PolylineEntity([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], true);
      const { rejected } = analyzeJoin([a, closed], tol);
      expect(rejected.some((r) => r.entity === closed && r.reason === 'closed-polyline')).toBe(true);
    });
  });

  // ── degenerate line ──────────────────────────────────────────────────────
  describe('degenerate line', () => {
    it('rejects a zero-length line', () => {
      const a = new LineEntity(0, 0, 0, 0);
      const { rejected } = analyzeJoin([a], tol);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason).toBe('degenerate');
    });
  });

  // ── multiple disjoint chains ─────────────────────────────────────────────
  describe('multiple disjoint chains', () => {
    it('returns two independent chains in one call', () => {
      const a = line(0, 0, 1, 0);
      const b = line(1, 0, 2, 0);
      const c = line(10, 0, 11, 0);
      const d = line(11, 0, 12, 0);
      const { validChains, rejected } = analyzeJoin([a, b, c, d], tol);
      expect(validChains.length).toBe(2);
      expect(rejected.length).toBe(0);
    });
  });

  // ── empty / single entity ────────────────────────────────────────────────
  describe('edge cases', () => {
    it('returns empty result for an empty candidates list', () => {
      const { validChains, rejected } = analyzeJoin([], tol);
      expect(validChains.length).toBe(0);
      expect(rejected.length).toBe(0);
    });

    it('marks a single valid entity as isolated (no pair)', () => {
      const a = line(0, 0, 1, 0);
      const { validChains, rejected } = analyzeJoin([a], tol);
      expect(validChains.length).toBe(0);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason).toBe('isolated');
    });
  });
});
