import { BoundingBox } from './BoundingBox';
import { Point } from '../primitives/Point';

/**
 * Utility functions for generating and intersecting AABBs.
 */
export class BoundingBoxUtils {
    
    /**
     * Generates a Bounding Box encompassing an array of points.
     */
    public static fromPoints(points: Point[]): BoundingBox {
        if (points.length === 0) {
            throw new Error('Cannot create BoundingBox from an empty point array');
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }

        return { minX, minY, maxX, maxY };
    }

    /**
     * Fast $O(1)$ intersection check between two AABBs.
     * Used heavily by the Spatial Index Engine.
     */
    public static intersects(a: BoundingBox, b: BoundingBox): boolean {
        return !(
            a.maxX < b.minX ||
            a.minX > b.maxX ||
            a.maxY < b.minY ||
            a.minY > b.maxY
        );
    }
}
