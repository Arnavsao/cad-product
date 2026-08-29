/**
 * Canonical location for "this thing points at another entity" types.
 *
 * Aagento has (or will have) several entity kinds that anchor themselves to
 * other geometry — dimensions snap their endpoints to a referenced entity,
 * leaders pin their tip, associative hatches bind their loops, and (later)
 * field text reads measured values off a host. They all need a stable,
 * serializable reference into the document model.
 *
 * Two reference shapes are needed:
 *
 *   1. `IDimAnchor`     — POINT anchor. "Snap point N on entity E."
 *                         Used by dimensions and leaders, which only care about
 *                         a discrete point (endpoint, midpoint, center, etc).
 *
 *   2. `IEntityAnchor`  — CURVE-RANGE anchor. "Sub-range [t0, t1] of curve
 *                         number `subIndex` on entity E, possibly inside a
 *                         nested BLOCK INSERT."
 *                         Used by associative hatch boundaries, which trace
 *                         continuous arcs of the host's geometry.
 *
 * The two share `entityId` but are otherwise distinct — keeping them as
 * sibling interfaces (rather than collapsing into one fat type with every
 * field optional) makes it obvious at the call site which mode is in play.
 *
 * Files that need both can import them together from here; tools that only
 * need one keep their existing import (dimensions still import IDimAnchor
 * from dimension-style.model, which re-exports from this file).
 */

/**
 * Anchor for an associative dimension or leader endpoint.
 *
 * Resolution at render time:
 *   1. Look up the entity by `entityId` in the current file's `entities` array.
 *   2. Read its `snapPoints()` array and pick element `snapIndex`.
 *   3. Use that world coord as the dimension's p1/p2 or the leader's tip.
 *
 * If the source entity is deleted, missing, or no longer has a point at that
 * index, the consuming entity keeps its last cached point (graceful orphan).
 *
 * Owned historically by `dimension-style.model.ts`; moved here so leaders /
 * fields / room-detection markers can share it without crossing into the
 * dimension-style namespace.
 */
export interface IDimAnchor {
  entityId: number;
  snapIndex: number;
}

/**
 * Anchor for a continuous sub-range of a host entity's curve.
 *
 * Used by associative hatch boundary loops: each loop edge points at a
 * specific traversal of a specific host entity's geometry.
 *
 *   - `subIndex` disambiguates which sub-curve of a compound host we mean:
 *       POLYLINE       → segment index (start vertex)
 *       composite SPLINE → which span
 *       all others     → 0
 *
 *   - `t0`, `t1` are the natural-parameter range over that sub-curve, in
 *     [0, 1]. For a full edge, t0=0 and t1=1.
 *
 *   - `reversed` flips traversal direction relative to the host's natural
 *     parameterization. Required because a loop traverses an edge in a
 *     specific direction, and the host doesn't know which way the consumer
 *     wants it.
 *
 *   - `blockPath` is the chain of nested INSERT entity ids leading down into
 *     a block definition's geometry, outer-most first. Empty / omitted when
 *     the host lives directly in the file's entity list.
 *
 * Resolution at regen time: walk the blockPath, transform into the block's
 * local frame, look up `entityId.subIndex`, evaluate the host curve at
 * `t ∈ [t0, t1]`, and use that arc to rebuild the loop edge.
 *
 * Used by HATCH; future consumers (boolean ops, offset curves, fillets)
 * will share the same shape.
 */
export interface IEntityAnchor {
  entityId: number;
  subIndex: number;
  t0: number;
  t1: number;
  reversed: boolean;
  blockPath?: number[];
}
