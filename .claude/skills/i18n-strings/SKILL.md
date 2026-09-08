---
name: i18n-strings
description: Add, change, or translate user-visible text in CADO across its 14 AutoCAD languages — Transloco *transloco directive, scripts/i18n/app-strings.en.json vs the generated public/i18n/en.json, the registry-driven editor keys, the validator, and the terms that must never be translated. Use when adding UI copy, a new language, fixing a string that shows in English for other locales, or when CI fails on "en.json is up to date".
---

# UI text and translations

Fourteen languages, deliberately AutoCAD's set, so a drafter finds their own *terminology*. `src/app/core/i18n/locales.ts` is the only list; the picker, server and validator all read it.

## Where a string lives

| Kind of text | Edit | Never edit |
| --- | --- | --- |
| App copy (dashboard, auth, settings, dialogs) | `scripts/i18n/app-strings.en.json` | `public/i18n/en.json` |
| Command prompts, phases, options | `core/services/command-prompts.registry.ts` | `public/i18n/en.json` |
| Tool titles, toolbar sections | `core/services/tool-catalog.service.ts` | `public/i18n/en.json` |
| Other 13 languages | `public/i18n/<code>.json` (hand-maintained) | — |

`en.json` is **generated** by `npm run i18n` (extract registries → build → validate). CI fails if the committed `en.json` differs from the regenerated one, so run it and stage the result whenever a registry or `app-strings.en.json` changes.

## In templates

One structural directive per template, on the outermost element:

```html
<div *transloco="let t">
  <h1>{{ t('auth.signIn.title') }}</h1>
</div>
```

Not a `| transloco` pipe per string. In TypeScript use `TranslocoService` or, for editor text that must survive a failed translation load, `translateOr(key, englishLiteral)`.

## Two rules that break translation

- **Never concatenate a sentence.** `{{ verb }} with {{ provider }}` cannot be reordered for Japanese. Pass parameters: `"auth.oauth.continueWith": "Continue with {{provider}}"`.
- **No backticks inside an inline template's HTML comments.** Components declare `template:` as a template literal; a backtick in a comment ends it and the file stops parsing.

## Do not translate

Command names (`LINE`, `FILLET`), option key letters (the `U` in `[U]ndo`), keyboard aliases in titles (`(L)`), `2P`/`3P`/`Ttr`/`MLD`/`XL-H`, identifiers, units, numbers, and the endonyms in `locales.ts`. Where a translated option label no longer starts with its key letter, correct terminology wins (Spanish "Deshacer" under `U` is right).

## Validate

```bash
npm run i18n:validate
```

Fatal: `missing` (renders English silently, the whole reason the check exists), `extra`, `params` (placeholders differ). Non-fatal: `untranslated` (often legitimate: German "Layer", "Spline"). Keep each language's key set byte-identical to `en.json`; build it with a script rather than typing 465 keys.

## Adding a language

1. Add a row to `locales.ts` (code, endonym).
2. Add `public/i18n/<code>.json` with every key.
3. `npm run i18n:validate`.
4. Note in CHANGELOG that the file is drafted, not reviewed by a native drafter. Command prompts are the highest-risk strings.

## Fallback behaviour

A missing key resolves to English (`fallbackLang: 'en'` + `useFallbackTranslation`), never to a raw key name. That is what makes a partial language shippable and also what hides gaps; do not remove the validator from CI.
