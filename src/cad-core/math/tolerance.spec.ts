import { isEqual, isZero, GLOBAL_TOLERANCE, isValidFloat } from './tolerance';

describe('Tolerance Math', () => {
    it('should correctly identify equality within tolerance', () => {
        expect(isEqual(1.0, 1.0 + GLOBAL_TOLERANCE / 2)).toBe(true);
        expect(isEqual(1.0, 1.0 + GLOBAL_TOLERANCE * 2)).toBe(false);
    });

    it('should identify zero correctly', () => {
        expect(isZero(0)).toBe(true);
        expect(isZero(GLOBAL_TOLERANCE / 10)).toBe(true);
        expect(isZero(0.1)).toBe(false);
    });

    it('should validate floats correctly', () => {
        expect(isValidFloat(5.5)).toBe(true);
        expect(isValidFloat(NaN)).toBe(false);
        expect(isValidFloat(Infinity)).toBe(false);
    });
});
