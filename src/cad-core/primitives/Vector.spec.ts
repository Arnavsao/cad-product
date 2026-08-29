import { Vector } from './Vector';

describe('Vector', () => {
    it('should calculate magnitude correctly', () => {
        const v = new Vector(3, 4, 0);
        expect(v.magnitude()).toBe(5);
    });

    it('should normalize correctly', () => {
        const v = new Vector(3, 4, 0).normalize();
        expect(v.dx).toBe(0.6);
        expect(v.dy).toBe(0.8);
    });

    it('should fail-fast and throw on normalizing zero vector', () => {
        expect(() => new Vector(0, 0, 0).normalize()).toThrow('Cannot normalize a zero vector');
    });

    it('should perform dot product correctly', () => {
        const v1 = new Vector(1, 0, 0);
        const v2 = new Vector(0, 1, 0);
        expect(v1.dot(v2)).toBe(0);
    });

    it('should fail-fast and throw on invalid float input', () => {
        expect(() => new Vector(NaN, 0, 0)).toThrow('Vector components must be finite numbers');
    });
});
