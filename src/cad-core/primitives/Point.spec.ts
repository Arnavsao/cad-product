import { Point } from './Point';
import { Vector } from './Vector';
import { Transform } from '../math/Transform';

describe('Point', () => {
    it('should calculate distance correctly', () => {
        const p1 = new Point(0, 0, 0);
        const p2 = new Point(3, 4, 0);
        expect(p1.distanceTo(p2)).toBe(5);
    });

    it('should translate correctly without mutating original', () => {
        const p1 = new Point(1, 1, 1);
        const p2 = p1.translate(new Vector(10, 20, 30));
        
        expect(p2.x).toBe(11);
        expect(p2.y).toBe(21);
        expect(p2.z).toBe(31);
        
        // Original remains unchanged (immutability check)
        expect(p1.x).toBe(1);
    });

    it('should transform correctly via matrix', () => {
        const p1 = new Point(5, 5, 5);
        const t = Transform.translation(new Vector(10, 10, 10));
        const p2 = p1.transform(t);
        expect(p2.x).toBe(15);
    });

    it('should fail-fast and throw on invalid float input', () => {
        expect(() => new Point(NaN, 0, 0)).toThrowError('Point coordinates must be finite numbers');
    });
    
    it('should instantiate $O(1)$ bounding box correctly', () => {
        const p1 = new Point(5, 5, 0);
        expect(p1.boundingBox.minX).toBe(5);
        expect(p1.boundingBox.maxX).toBe(5);
    });
});
