import { BoundingBoxUtils } from './BoundingBoxUtils';
import { Point } from '../primitives/Point';

describe('BoundingBoxUtils', () => {
    it('should create correct bounding box from points', () => {
        const p1 = new Point(0, 0);
        const p2 = new Point(10, 10);
        const p3 = new Point(5, 15);
        const bbox = BoundingBoxUtils.fromPoints([p1, p2, p3]);
        
        expect(bbox.minX).toBe(0);
        expect(bbox.maxX).toBe(10);
        expect(bbox.minY).toBe(0);
        expect(bbox.maxY).toBe(15);
    });

    it('should correctly detect AABB intersections', () => {
        const b1 = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
        const b2 = { minX: 5, minY: 5, maxX: 15, maxY: 15 }; // Intersects
        const b3 = { minX: 20, minY: 20, maxX: 30, maxY: 30 }; // Does not intersect

        expect(BoundingBoxUtils.intersects(b1, b2)).toBe(true);
        expect(BoundingBoxUtils.intersects(b1, b3)).toBe(false);
    });
});
