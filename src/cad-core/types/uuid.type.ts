/**
 * Production UUID strategy.
 * Enforces a nominal typing approach (Branded Type) to prevent 
 * accidental raw string assignments to UUID fields, ensuring strict type safety.
 */
export type UUID = string & { readonly __brand: unique symbol };

/**
 * Generates a crypto-safe UUID for new entities.
 */
export function generateUUID(): UUID {
    return crypto.randomUUID() as UUID;
}
