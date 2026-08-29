import { Transform } from './Transform';
import { Vector } from '../primitives/Vector';

describe('Transform', () => {
    it('should default to identity matrix', () => {
        const t = new Transform();
        expect(t.get(0, 0)).toBe(1);
        expect(t.get(0, 1)).toBe(0);
    });

    it('should create valid translation matrix', () => {
        const t = Transform.translation(new Vector(10, 20, 30));
        expect(t.get(0, 3)).toBe(10);
        expect(t.get(1, 3)).toBe(20);
        expect(t.get(2, 3)).toBe(30);
    });

    it('should multiply correctly', () => {
        const t1 = Transform.translation(new Vector(10, 0, 0));
        const t2 = Transform.translation(new Vector(0, 20, 0));
        const res = t1.multiply(t2);
        expect(res.get(0, 3)).toBe(10);
        expect(res.get(1, 3)).toBe(20);
    });

    it('should fail fast on invalid matrix data', () => {
        expect(() => new Transform([1,2,3])).toThrow('Matrix must have exactly 16 elements');
        expect(() => new Transform(new Array(16).fill(NaN))).toThrow('Matrix contains invalid floats');
    });
});
