import { TranslocoService } from '@jsverse/transloco';
import { translateOr } from '../../../../core/i18n/translate-or';

/**
 * `translateOr` for strings that carry `{{param}}` placeholders.
 *
 * The editor's panels build a few sentences in TypeScript (window.confirm
 * text, chat status lines) that must keep working without a Transloco
 * provider. `translateOr` gives us the translated or English template; this
 * substitutes the parameters into whichever one came back, so the fallback
 * path never shows a raw `{{name}}` to the user.
 */
export function translateOrParams(
  transloco: TranslocoService | null | undefined,
  key: string,
  english: string,
  params: Record<string, string | number>,
): string {
  const text = translateOr(transloco, key, english);
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
