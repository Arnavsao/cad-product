/**
 * Jest `setupFiles` hook for the e2e suites.
 *
 * All e2e specs run in ONE process, `--runInBand`, and every request comes from
 * the same IP into a single in-memory throttle counter — so the suites share one
 * budget rather than each getting their own. At ~200 tests the combined traffic
 * was a large enough fraction of the production default (300/min) that a slow
 * run tripped the limiter and failed whichever test happened to be in flight,
 * which looked like a flake in an unrelated spec.
 *
 * Raising the budget here keeps the production default honest: the limiter is
 * still wired up and still enforced (the per-route `@Throttle` budgets, which
 * are what the rate-limit tests actually assert, are untouched and much smaller
 * than this), but the harness stops rationing itself.
 *
 * Set before any module is imported, because `ConfigModule.forRoot` validates
 * the environment at import time.
 */
process.env.RATE_LIMIT_LIMIT ??= '100000';

/**
 * A second shared-state hazard, recorded here because it bit once and the
 * symptom was thoroughly misleading.
 *
 * `feature_flags` is global, not per-user. `signups.enabled = false` makes
 * `UsersService.ensureLocalUser` refuse to provision ANY new account, so a row
 * left behind by a crashed suite (or by a manually-run API on the same
 * database) makes every later suite fail at `beforeAll` with 403 SIGNUPS_CLOSED
 * — which reads as "auth is broken", not "a flag is set".
 *
 * The rule for any suite that writes a flag: clear it in `afterAll`
 * unconditionally, not only on the happy path. `admin.e2e-spec.ts` deletes every
 * row rather than just its own.
 */
process.env.ADMIN_BOOTSTRAP_EMAILS ??= '';
