/** 
 * Global tolerance for floating-point comparisons.
 * Eliminates micro-gaps and IEEE 754 precision issues during geometry calculations.
 */
export const GLOBAL_TOLERANCE = 1e-6;

/**
 * Checks if a value is effectively zero within the global tolerance.
 */
export function isZero(val: number): boolean {
    return Math.abs(val) < GLOBAL_TOLERANCE;
}

/**
 * Checks if two floats are effectively equal within the global tolerance.
 */
export function isEqual(a: number, b: number): boolean {
    return Math.abs(a - b) < GLOBAL_TOLERANCE;
}

/**
 * Validates that a float is a safe, finite number.
 */
export function isValidFloat(val: number): boolean {
    return Number.isFinite(val);
}
