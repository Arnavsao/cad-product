import { TranslocoService } from '@jsverse/transloco';

/**
 * Translate `key`, falling back to `english` when no translation exists.
 *
 * Transloco's own fallback resolves a missing key to the *default language's*
 * value for that key — which only helps if the key is in `en.json`. The two
 * editor registries deliberately keep their English text in the TypeScript
 * source instead (see `scripts/i18n/extract-registries.mjs` for why), so for
 * those keys English lives in code and this helper is what bridges the two.
 *
 * The consequence worth knowing: a key absent from every translation file
 * renders the registry's English, not the key name. That is the behaviour we
 * want in the editor — a drafter mid-command must never see
 * `editor.cmd.fillet.radius.message` where an instruction should be.
 *
 * `transloco` is nullable on purpose. The editor is embeddable in a host that
 * owns its own providers and may never call `provideI18n()`, and specs inject
 * these services without a Transloco provider. In both cases the correct
 * behaviour is English, not a failed injection.
 */
export function translateOr(
  transloco: TranslocoService | null | undefined,
  key: string,
  english: string,
): string {
  if (!english) return '';
  if (!transloco) return english;
  const translated = transloco.translate(key);
  // Transloco returns the key itself when it cannot resolve it.
  return !translated || translated === key ? english : translated;
}
