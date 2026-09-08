---
name: changelog-and-commit
description: Write a CHANGELOG.md entry and a commit message in CADO's house style — type(scope) subjects, the Unreleased section's Added/Changed/Fixed/Removed/Known gaps/Notes on design headings, and entries that explain symptom → cause → fix with AutoCAD parity notes. Use when asked to commit, to update the changelog, to prepare a release section, or when finishing a change that users would notice.
---

# Changelog and commits

## Commit subject

`type(scope): imperative subject`, lowercase after the colon, no trailing period, under ~72 chars.

Types in use: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`. Scopes in use: `web`, `server`, `cad-editor`, `dashboard`, `deploy`, `nginx`, `i18n`, `billing`, `brand`, `settings`, `shared`, `landing`, `auth`, `notifications`, `org`. Omit the scope only for repo-wide changes (`ci: deploy automatically after CI passes on main`).

Body: what a reader of `git log` needs that the diff does not say. The *why* and the symptom, not a file list. Several recent commits are good models:

```
fix(web): production UI was missing styles and theme init under CSP
fix(nginx): security headers were silently dropped on every response
test(server): expect `locale` in default preferences
```

Commit or push only when asked. Do not commit `server/.env`, `.env`, or anything under `dist/`.

## CHANGELOG.md

Top section is `## Unreleased`. Releases are `## <semver> — YYYY-MM-DD` (em dash, ISO date). Within a section, headings in this order as needed:

`### Added` · `### Changed` · `### Fixed` · `### Removed` · `### Known gaps` (or `### Known issues`) · `### Known divergence from AutoCAD Web` · `### Notes on design`

Each `Unreleased` section may open with one or two plain sentences framing the theme ("DXF import fidelity. An imported drawing now renders as AutoCAD renders it…").

## Entry style

Bullets start with a **bold symptom in the user's words**, then the cause, then the fix, then what it now does. One entry can run several lines; nested bullets are fine when several faults stacked up. Name the file or function only where a maintainer must go there.

```
* **Dimensions showed four decimals.** `dxf-parser`'s DIMENSION handler has no `case 3`, so the
  style name never arrived and every dimension resolved to `Standard`. `DIMDEC` was not read
  either. Both fixed; `DEFAULT_DIM_STYLE` and the `Standard` map entry no longer disagree.
```

Rules that keep the file honest:

- Fixed entries say what was *visibly* wrong before. "Improved dimension handling" is not an entry.
- When behaviour intentionally differs from AutoCAD, record it under **Known divergence from AutoCAD Web** with the reason.
- Known-failing tests, drafted-not-reviewed translations, and deferred work go under **Known gaps**, not silently.
- **Notes on design** holds decisions a future maintainer might reverse without knowing why they were made (paper mm are world units; migrations stay in `start:prod`).
- A release section moves everything from Unreleased verbatim and bumps `package.json` (web) and `server/package.json` (API) as appropriate. The API has its own version line.

## Before you write the entry

Ask: would the person who reported this recognise their bug in the first bold phrase? Would a maintainer two months from now know why the fix took the shape it did? If either is no, rewrite.
