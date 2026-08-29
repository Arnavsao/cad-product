import type { IPoint } from '../../models/entity.model';

/**
 * Single source of truth for numerical tolerances and quantization in the
 * topology pipeline.
 *
 * Tolerance budget (world units):
 *   - EPS_GEOM: parameter / determinant noise floor for closed-form solvers.
 *     Below this, two near-parallel lines are treated as parallel.
 *   - EPS_NUM:  reserved for Phase 2.5 numerical curve intersections.
 *   - GAP_TOLERANCE: max endpoint-to-endpoint gap that gets virtually bridged
 *     when building the planar graph. Larger values close more drawings at
 *     the risk of merging features that should stay distinct. Tuned to match
 *     the historic region-topology behavior so Phase 2 is behavior-preserving.
 *
 * Vertex quantization:
 *   - QUANT_DECIMALS=4 means two world-points within 5e-5 collapse to the
 *     same graph vertex. This is the magic number that prevents the
 *     order-dependent vertex fusion bug the old code paper-trailed on.
 */
export const EPS_GEOM = 1e-7;
export const EPS_NUM = 1e-5;
export const GAP_TOLERANCE = 1e-3;
export const QUANT_DECIMALS = 4;

/**
 * Snap a coordinate component to the quantization grid. Symmetric around 0,
 * so positive and negative coordinates round identically.
 */
export function quantize(v: number): number {
  return Number(v.toFixed(QUANT_DECIMALS));
}

/**
 * Stable string key for a point post-quantization. Order-independent: two
 * near-identical points produced via different intersection paths get the
 * same key, which is what makes vertex coalescing deterministic across
 * different entity iteration orders.
 */
export function quantKey(p: IPoint): string {
  return `${p.x.toFixed(QUANT_DECIMALS)},${p.y.toFixed(QUANT_DECIMALS)}`;
}

/** Are two world points close enough to be considered the same vertex? */
export function pointsCoincide(a: IPoint, b: IPoint): boolean {
  return Math.abs(a.x - b.x) < GAP_TOLERANCE && Math.abs(a.y - b.y) < GAP_TOLERANCE;
}
