# Translating CADO

CADO ships in the same fourteen languages AutoCAD does, so a drafter
arriving from AutoCAD finds their own language and, more importantly, their own
*terminology*. Everything below exists to protect that second part.

## The languages

`src/app/core/i18n/locales.ts` is the source of truth. Adding a language is two
steps: add a row there, add `public/i18n/<code>.json`. Nothing else knows the
list — not the picker, not the server, not the validator.

| Code | Language | Code | Language |
| --- | --- | --- | --- |
| `en` | English | `ja` | 日本語 |
| `cs` | Čeština | `ko` | 한국어 |
| `de` | Deutsch | `pl` | Polski |
| `es` | Español | `pt-BR` | Português (Brasil) |
| `fr` | Français | `ru` | Русский |
| `hu` | Magyar | `zh-Hans` | 简体中文 |
| `it` | Italiano | `zh-Hant` | 繁體中文 |

The picker shows each language's **endonym** — its name in itself. Those strings
live in `locales.ts` and must never be translated: someone looking for German
scans for "Deutsch", not for whatever the current UI calls German.

## How a string becomes translatable

Templates use Transloco's structural directive, one scope per template:

```html
<div *transloco="let t">
  <h1>{{ t('auth.signIn.title') }}</h1>
</div>
```

One `*transloco` on the outermost element, not a `| transloco` pipe per string.
It creates a single subscription for the whole template and re-renders it as a
unit when the language changes.

Then add the English text to `scripts/i18n/app-strings.en.json` and run
`npm run i18n`.

### Two rules that are easy to get wrong

**Never concatenate a sentence.** `{{ verb }} with {{ provider }}` cannot be
translated: the joining word and the word order are both language-specific, and
Japanese puts the provider first. Pass the variable as a parameter and let the
translator arrange the sentence:

```json
{ "auth.oauth.continueWith": "Continue with {{provider}}" }
```

**No backticks inside an inline template's HTML comments.** Most components here
declare `template:` as a JavaScript template literal, so a backtick in a comment
terminates it and the file stops parsing. Use plain words.

## Where the editor's text comes from

The editor's ~465 strings are not hand-written into `en.json`. They are
generated from the two registries that already own them:

- `command-prompts.registry.ts` — every command prompt, phase message and option
- `tool-catalog.service.ts` — every toolbar tool name and section header

`npm run i18n:extract` reads both and writes `scripts/i18n/registry-keys.en.json`;
`npm run i18n:build` merges that with the hand-written
`scripts/i18n/app-strings.en.json` into `public/i18n/en.json`.

**So: never hand-edit `public/i18n/en.json`.** It is generated. Edit
`app-strings.en.json` for app text, or the registry itself for editor text.
Adding a tool to the catalog automatically produces a key for it, which is the
point — a new tool cannot ship an untranslatable name by accident.

The other thirteen files *are* hand-maintained and are the translators' files.

## What must not be translated

| Thing | Why |
| --- | --- |
| Command names — `LINE`, `FILLET`, `MOVE` | The user types these and the parser matches them. AutoCAD tutorials use them. |
| Option key letters — the `<LETTER>` in `editor.cmd.*.opt.<LETTER>.*` | It is the key pressed, not prose. Always works regardless of language. |
| Keyboard aliases in tool titles — the `(L)` in "Line (L)" | A shortcut. Stripped before translation and re-appended verbatim by `ToolCatalogService.title()`. |
| `2P`, `3P`, `Ttr`, `MLD`, `XL-H`, `XL-V` | Abbreviations real AutoCAD leaves alone in every language. |
| Code identifiers, units, coordinates, numbers | Not words. |

### The option-label convention

Option chips render as `[U]ndo` — the key letter, then the label. The registry's
convention is that the key is the label's first letter. **Translation can break
that**, and where it does, correct terminology wins. Spanish "Deshacer" under
key `U` is right; inventing a U-word to preserve the bracket is not. Where a
natural term *does* start with the key letter, prefer it — Spanish "Radio" for
`[R]` reads correctly and costs nothing.

Option matching accepts the key letter **and** the translated label, so a French
user can type "Rayon" and someone following an English tutorial can type `R`.

## Adding or updating a translation

1. `npm run i18n` — regenerates `en.json` and validates every language.
2. Edit `public/i18n/<code>.json`. Keep the key set byte-identical to `en.json`.
   Build it in a script rather than hand-typing 465 keys.
3. `npm run i18n:validate` — must pass.

The validator checks four things per language:

| Check | Fatal | Meaning |
| --- | --- | --- |
| `missing` | yes | Key in `en.json`, absent here. **Renders English silently** — nothing errors, which is exactly why this check exists. |
| `extra` | yes | Key here, not in `en.json`. Dead weight, usually a typo'd key. |
| `params` | yes | `{{placeholders}}` differ from English. Renders the literal `{{email}}` to a user. |
| `untranslated` | no | Value identical to English. Often legitimate — German "Layer", "Spline", "Pan", "2P". |

## Fallback behaviour, and why partial languages are safe to ship

A key missing from a language resolves to its English text, via
`fallbackLang: 'en'` plus `useFallbackTranslation`. Nothing renders a raw key
name. That is deliberate and it is what lets a new language go live before every
string is done — an untranslated button reads "Save", never
`dashboard.actions.save`.

The cost is that a gap is invisible at runtime. `npm run i18n:validate` in CI is
the only thing that surfaces it. Do not remove it.

For the editor registries there is a second fallback layer: `translateOr()` falls
back to the registry's own English literal, so the editor stays usable even if a
translation file fails to load entirely. A drafter mid-command must never see
`editor.cmd.fillet.radius.message` where an instruction belongs.

## Review status

The non-English files were **drafted, not professionally reviewed**. They follow
established AutoCAD terminology per language, but every one should be read by a
native-speaking drafter before you call the language done. Command prompts are
the highest-risk area: they are read mid-task, under time pressure, by someone
who will not tolerate a wrong term.
