---
name: verify
description: Run CADO's quality gates the way CI does — typecheck, i18n regeneration + en.json drift check, zero-warning production build, headless Karma specs, and the server's Jest unit/e2e suites — or run one spec in isolation. Use before committing, before opening a PR, when asked "does it pass", or when a test fails and you need to know if it is pre-existing.
---

# Verifying a change

CI (`.github/workflows/ci.yml`) is the contract. Reproduce it locally in this order; each step is cheap relative to the next.

## Web (repo root)

```bash
npm run typecheck                          # tsc -p tsconfig.app.json --noEmit
npm run i18n                               # extract registries → build en.json → validate 14 languages
git diff --exit-code -- public/i18n/en.json   # CI fails if the generated en.json is not committed
npm run build                              # production build; must be ZERO warnings
npm run test:ci                            # Karma + Jasmine, ChromeHeadless, single run
```

`npm run build` warnings are failures here. Common causes: a CommonJS import not in `allowedCommonJsDependencies` (angular.json), a component style over the 40 kB budget, an unused import that TypeScript allows but the bundler flags.

Do not run `npm test` (watch mode) in an automated flow; it never exits.

### One spec at a time

```bash
npx ng test --watch=false --browsers=ChromeHeadless \
  --include='src/app/features/cad-editor/core/utils/ocs.spec.ts'
```

`--include` takes globs or a directory. Use it while iterating; run the full `test:ci` before declaring done.

### Pre-existing failures

A block of specs (`AiPreviewService`, `CadContextService`, a few `cad-core` geometry expectations) has failed since the extraction, mostly because the TestBed lacks a zoneless change-detection provider (`NG0908`). They are listed under "Known issues" in `CHANGELOG.md`. Before attributing a red spec to your change:

1. Note the failing spec names from your run.
2. `git stash` your change, run the same `--include`, compare.
3. Report both numbers. Never say "tests pass" when only the count matches.

## Server (`server/`)

```bash
npm --prefix server run typecheck          # prisma generate + tsc --noEmit
npm --prefix server run build
npm --prefix server test                   # Jest unit specs; Prisma and storage are mocked
npm --prefix server test -- folders.service   # one spec by path fragment
```

e2e needs real Postgres + MinIO and applied migrations:

```bash
npm run db:up
npm --prefix server run prisma:deploy      # prisma migrate deploy
npm --prefix server run test:e2e           # --runInBand; sets a high RATE_LIMIT_LIMIT in test/support/e2e-env.ts
```

e2e auth uses HS256 tokens minted against a test `SUPABASE_JWT_SECRET` the specs set themselves. No Supabase project is needed.

## Reporting

State what ran and what it returned, with counts. If a step was skipped, say which and why. Paste failing output in a fenced block rather than paraphrasing it.
