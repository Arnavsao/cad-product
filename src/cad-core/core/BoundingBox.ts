/**
 * Axis-Aligned Bounding Box (AABB).
 * Used system-wide for $O(1)$ spatial queries, frustum culling, and R-Tree indexing.
 */
export interface BoundingBox {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}
