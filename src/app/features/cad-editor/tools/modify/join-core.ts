/**
 * JOIN analysis core — pure TypeScript, zero Angular, zero DOM.
 *
 * Extracted from JoinTool so the chain-walking logic can be unit-tested and
 * reused independently of the tool lifecycle.
 *
 * Key improvements over the original embedded functions:
 *   • Configurable tolerance (threaded through all helpers).
 *   • Midpoint gap-closing: when two endpoints are within `tol` but not
 *     identical, the junction vertex is replaced with their midpoint,
 *     producing gap-free, zero-duplicate-vertex output.
 *   • Structured rejection: every entity that cannot be joined is returned
 *     with a reason so the tool can give visual feedback.
 */

import type { Entity, IPoint } from '../../core/models/entity.model';
import { LineEntity, PolylineEntity } from '../../core/models/entity.model';

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Default world-unit gap tolerance.
 * Endpoints within this distance are considered coincident and will be
 * midpoint-merged. 0.01 is large enough to absorb typical CAD import/draw
 * rounding while being small enough to avoid false merges.
 */
export const JOIN_TOLERANCE = 0.01;

export interface IChainResult {
  /** Ordered world-coord vertices of the resulting polyline (gap-closed). */
  points: IPoint[];
  /** True when the chain closes back on itself within tolerance. */
  closed: boolean;
  /** Source entities consumed by this chain, in walk order. */
  sourceEntities: Entity[];
}

export type RejectionReason =
  | 'branching'       // 3+ entities share an endpoint → topology is ambiguous
  | 'unsupported-type' // not a LINE or open POLYLINE
  | 'closed-polyline'  // PolylineEntity with closed=true has no free endpoints
  | 'degenerate'       // LINE whose length ≤ tolerance (zero-length)
  | 'isolated';        // valid type but no neighbor within tolerance

export interface IRejectedEntity {
  entity: Entity;
  reason: RejectionReason;
}

export interface IAnalysisResult {
  /** Valid joinable chains (each has ≥ 2 source entities). */
  validChains: IChainResult[];
  /** Entities that could not participate in any chain, with reasons. */
  rejected: IRejectedEntity[];
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Analyse a set of candidate entities and return joinable chains plus
 * per-entity rejection reasons.
 *
 * Algorithm (O(N)):
 *  1. Filter candidates into valid endpoints (LINE / open POLYLINE) and
 *     immediately-rejected ones.
 *  2. Build an adjacency map keyed by quantized endpoint coordinates.
 *  3. Walk chains: depth-first from each unvisited entity, collecting
 *     ordered vertex sequences with direction correction.
 *  4. Classify unjoined entities as branching or isolated.
 */
export function analyzeJoin(candidates: Entity[], tol: number): IAnalysisResult {
  const rejected: IRejectedEntity[] = [];
  const eps: IEndpointPair[] = [];

  // Phase 1 — type-level filter
  for (const e of candidates) {
    if (!(e instanceof LineEntity) && !(e instanceof PolylineEntity)) {
      rejected.push({ entity: e, reason: 'unsupported-type' });
      continue;
    }
    if (e instanceof PolylineEntity && e.closed) {
      rejected.push({ entity: e, reason: 'closed-polyline' });
      continue;
    }
    if (e instanceof LineEntity && Math.hypot(e.x2 - e.x1, e.y2 - e.y1) <= tol) {
      rejected.push({ entity: e, reason: 'degenerate' });
      continue;
    }
    const ep = endpointsOf(e, tol);
    if (ep) eps.push(ep);
  }

  if (eps.length === 0) return { validChains: [], rejected };

  // Phase 2 — build adjacency (key → [indices])
  const adj = new Map<string, number[]>();
  for (let i = 0; i < eps.length; i++) {
    adjPush(adj, eps[i].aKey, i);
    adjPush(adj, eps[i].bKey, i);
  }

  // Phase 3 — walk chains
  const visited = new Set<number>();
  const validChains: IChainResult[] = [];
  const branchingIdx = new Set<number>();

  for (let i = 0; i < eps.length; i++) {
    if (visited.has(i)) continue;
    const chain = walkChain(i, eps, adj, visited, branchingIdx);
    if (chain && chain.sourceEntities.length >= 2) validChains.push(chain);
    // single-entity results → isolated (classified below)
  }

  // Phase 4 — classify remainders
  for (const idx of branchingIdx) {
    const ent = eps[idx].entity;
    if (!rejected.find((r) => r.entity === ent)) {
      rejected.push({ entity: ent, reason: 'branching' });
    }
  }

  const inChain = new Set<Entity>(validChains.flatMap((c) => c.sourceEntities));
  const alreadyRejected = new Set<Entity>(rejected.map((r) => r.entity));
  for (const ep of eps) {
    if (!inChain.has(ep.entity) && !alreadyRejected.has(ep.entity)) {
      rejected.push({ entity: ep.entity, reason: 'isolated' });
    }
  }

  return { validChains, rejected };
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface IEndpointPair {
  entity: Entity;
  /** Quantized key for endpoint A (start). */
  aKey: string;
  /** Quantized key for endpoint B (end). */
  bKey: string;
  aPt: IPoint;
  bPt: IPoint;
  /** Vertex sequence from A to B (inclusive, un-reversed). */
  pts: IPoint[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Quantize (x, y) to a grid aligned with `tol`. Two points within `tol` of
 * each other will map to the same key (same grid cell), making them appear
 * coincident in the adjacency map.
 */
function keyOf(x: number, y: number, tol: number): string {
  const decimals = Math.max(0, Math.min(10, Math.round(-Math.log10(tol))));
  return `${x.toFixed(decimals)},${y.toFixed(decimals)}`;
}

function adjPush(adj: Map<string, number[]>, k: string, i: number): void {
  const list = adj.get(k);
  if (list) list.push(i);
  else adj.set(k, [i]);
}

function endpointsOf(e: Entity, tol: number): IEndpointPair | null {
  if (e instanceof LineEntity) {
    const aPt = { x: e.x1, y: e.y1 };
    const bPt = { x: e.x2, y: e.y2 };
    return {
      entity: e,
      aKey: keyOf(aPt.x, aPt.y, tol),
      bKey: keyOf(bPt.x, bPt.y, tol),
      aPt, bPt,
      pts: [aPt, bPt],
    };
  }
  if (e instanceof PolylineEntity && !e.closed && e.pts.length >= 2) {
    const aPt = e.pts[0];
    const bPt = e.pts[e.pts.length - 1];
    return {
      entity: e,
      aKey: keyOf(aPt.x, aPt.y, tol),
      bKey: keyOf(bPt.x, bPt.y, tol),
      aPt, bPt,
      pts: e.pts.map((p: any) => ({ x: p.x, y: p.y })),
    };
  }
  return null;
}

// ─── Chain walk ───────────────────────────────────────────────────────────────

/**
 * Walk a connected chain starting from `startIdx`.
 *
 * Strategy:
 *  - Walk forward from startIdx's B endpoint, hopping to the unique neighbor
 *    at each node, marking visited.
 *  - Walk backward from startIdx's A endpoint similarly.
 *  - Combine: backward-reverse + start + forward.
 *  - If the forward walk hits an already-visited entity the chain is closed.
 *  - If any node has > 1 unvisited neighbor, branching is detected: mark all
 *    involved entities in `branchingIdx` and return null.
 */
function walkChain(
  startIdx: number,
  eps: IEndpointPair[],
  adj: Map<string, number[]>,
  visited: Set<number>,
  branchingIdx: Set<number>,
): IChainResult | null {
  visited.add(startIdx);

  // ── Forward walk (from B endpoint) ──
  const forward: number[] = [];
  let curKey = eps[startIdx].bKey;
  let curIdx = startIdx;

  for (;;) {
    const incident = (adj.get(curKey) ?? []).filter((j) => j !== curIdx);
    if (incident.length === 0) break;
    if (incident.length > 1) {
      // Branching — mark everything touched in this walk
      branchingIdx.add(startIdx).add(curIdx);
      for (const j of forward) branchingIdx.add(j);
      for (const j of incident) { branchingIdx.add(j); visited.add(j); }
      return null;
    }
    const next = incident[0];
    if (visited.has(next)) {
      // Closed loop — finalize without walking backward
      return finalizeChain([startIdx, ...forward], eps, /*closed*/ true);
    }
    visited.add(next);
    forward.push(next);
    const np = eps[next];
    curKey = np.aKey === curKey ? np.bKey : np.aKey;
    curIdx = next;
  }

  // ── Backward walk (from A endpoint) ──
  const backward: number[] = [];
  curKey = eps[startIdx].aKey;
  curIdx = startIdx;

  for (;;) {
    const incident = (adj.get(curKey) ?? []).filter((j) => j !== curIdx);
    if (incident.length === 0) break;
    if (incident.length > 1) {
      branchingIdx.add(startIdx).add(curIdx);
      for (const j of backward) branchingIdx.add(j);
      for (const j of incident) { branchingIdx.add(j); visited.add(j); }
      return null;
    }
    const prev = incident[0];
    if (visited.has(prev)) break; // already claimed by an earlier walk
    visited.add(prev);
    backward.unshift(prev);
    const pp = eps[prev];
    curKey = pp.aKey === curKey ? pp.bKey : pp.aKey;
    curIdx = prev;
  }

  return finalizeChain([...backward, startIdx, ...forward], eps, /*closed*/ false);
}

// ─── Chain finalization ───────────────────────────────────────────────────────

/**
 * Given an ordered list of entity indices, build a single merged vertex
 * sequence with correct direction per entity.
 *
 * Midpoint gap-closing: at each junction, the previous entity's exit point
 * and the next entity's entry point are replaced by their midpoint. This
 * eliminates any small gap ≤ tolerance without biasing toward either entity.
 */
function finalizeChain(
  order: number[],
  eps: IEndpointPair[],
  closed: boolean,
): IChainResult | null {
  if (!order.length) return null;

  const pts: IPoint[] = [];
  const sourceEntities: Entity[] = [];

  if (order.length === 1) {
    const ep = eps[order[0]];
    return {
      points: ep.pts.map((p: any) => ({ x: p.x, y: p.y })),
      closed,
      sourceEntities: [ep.entity],
    };
  }

  // Determine direction for the first entity
  const first = eps[order[0]];
  const second = eps[order[1]];
  let firstForward: boolean;
  if (first.bKey === second.aKey || first.bKey === second.bKey) {
    firstForward = true;
  } else if (first.aKey === second.aKey || first.aKey === second.bKey) {
    firstForward = false;
  } else {
    return null; // no shared endpoint — shouldn't happen given adjacency
  }

  const firstPts = firstForward ? first.pts : [...first.pts].reverse();
  for (const p of firstPts) pts.push({ x: p.x, y: p.y });
  sourceEntities.push(first.entity);
  let lastExitKey = firstForward ? first.bKey : first.aKey;

  for (let i = 1; i < order.length; i++) {
    const ep = eps[order[i]];
    let forward: boolean;
    if (ep.aKey === lastExitKey) forward = true;
    else if (ep.bKey === lastExitKey) forward = false;
    else return null;

    const local = forward ? ep.pts : [...ep.pts].reverse();

    // Midpoint gap-closing: blend the junction vertex between the two endpoints
    const prevExit = pts[pts.length - 1];
    const nextEntry = local[0];
    pts[pts.length - 1] = {
      x: (prevExit.x + nextEntry.x) / 2,
      y: (prevExit.y + nextEntry.y) / 2,
    };

    // Append remaining vertices of this entity (skip first — it's the junction)
    for (let k = 1; k < local.length; k++) {
      pts.push({ x: local[k].x, y: local[k].y });
    }
    sourceEntities.push(ep.entity);
    lastExitKey = forward ? ep.bKey : ep.aKey;
  }

  return { points: pts, closed, sourceEntities };
}
