/**
 * Throttle override that puts a route in the `admin` bucket declared in
 * `AppModule`.
 *
 * `@Throttle` needs its options at decoration time, before the config service
 * exists, so the *limit* cannot be read from `ADMIN_RATE_LIMIT_LIMIT` here. The
 * numbers below are therefore a ceiling that the named bucket's configured
 * limit applies underneath: routing admin traffic into its own counter is the
 * point, so that a busy portal cannot exhaust the allowance real users share.
 */
export const ADMIN_THROTTLE = { admin: { limit: 120, ttl: 60_000 } } as const;
