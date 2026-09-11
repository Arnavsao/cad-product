import { TranslocoService } from '@jsverse/transloco';
import { translateOr } from '../../../core/i18n/translate-or';

/**
 * `translateOr` with `{{param}}` interpolation, for the text the editor's
 * dialogs resolve in TypeScript (toasts, confirm() messages, canvas labels,
 * the plot preview popup).
 *
 * Transloco replaces a placeholder whose param is missing with an empty
 * string, so the params have to reach `translate()` itself — the plain
 * `translateOr(key, english)` cannot be followed by a second interpolation
 * pass. When Transloco is absent (embedded hosts, specs) or the key is
 * unknown, the English literal is interpolated instead.
 */
export function translateDialog(
  transloco: TranslocoService | null | undefined,
  key: string,
  english: string,
  params?: Record<string, unknown>,
): string {
  if (!params) return translateOr(transloco, key, english);
  const fallback = english.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(params[k] ?? ''));
  if (!transloco) return fallback;
  const translated = transloco.translate(key, params);
  return !translated || translated === key ? fallback : translated;
}
