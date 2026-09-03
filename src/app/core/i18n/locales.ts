/**
 * The languages CADOnline ships in.
 *
 * This is deliberately AutoCAD's language set, so a drafter arriving from
 * AutoCAD finds their own language here. Codes are BCP 47 and double as both
 * the Transloco language id and the filename under `public/i18n/`, so adding a
 * language is: add a row here, drop in `<code>.json`. Nothing else knows the list.
 *
 * `label` is written in the language itself, never translated. A picker showing
 * "German" to someone who only reads German is useless — they are looking for
 * "Deutsch". For that reason these strings must NOT be moved into the
 * translation files.
 */
export interface ILocale {
  /** BCP 47 tag. Also the translation filename and the persisted value. */
  readonly code: string;
  /** Endonym — the language's name in itself. Shown in the picker. */
  readonly label: string;
  /** English name, for `aria-label` and for support tickets. */
  readonly english: string;
  /** Writing direction. All 14 are LTR today; the field keeps RTL additive. */
  readonly dir: 'ltr' | 'rtl';
}

export const LOCALES: readonly ILocale[] = [
  { code: 'en', label: 'English', english: 'English', dir: 'ltr' },
  { code: 'cs', label: 'Čeština', english: 'Czech', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', english: 'German', dir: 'ltr' },
  { code: 'es', label: 'Español', english: 'Spanish', dir: 'ltr' },
  { code: 'fr', label: 'Français', english: 'French', dir: 'ltr' },
  { code: 'hu', label: 'Magyar', english: 'Hungarian', dir: 'ltr' },
  { code: 'it', label: 'Italiano', english: 'Italian', dir: 'ltr' },
  { code: 'ja', label: '日本語', english: 'Japanese', dir: 'ltr' },
  { code: 'ko', label: '한국어', english: 'Korean', dir: 'ltr' },
  { code: 'pl', label: 'Polski', english: 'Polish', dir: 'ltr' },
  { code: 'pt-BR', label: 'Português (Brasil)', english: 'Portuguese (Brazil)', dir: 'ltr' },
  { code: 'ru', label: 'Русский', english: 'Russian', dir: 'ltr' },
  { code: 'zh-Hans', label: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr' },
  { code: 'zh-Hant', label: '繁體中文', english: 'Chinese (Traditional)', dir: 'ltr' },
] as const;

/** The language every other one falls back to, key by key. */
export const DEFAULT_LOCALE = 'en';

export const LOCALE_CODES: readonly string[] = LOCALES.map((l) => l.code);

export function findLocale(code: string | null | undefined): ILocale | undefined {
  if (!code) return undefined;
  return LOCALES.find((l) => l.code === code);
}

/**
 * Best supported locale for a browser tag, widening as it goes:
 * `pt-BR` → exact, `pt-PT` → `pt-BR` (only Portuguese we have), `de-AT` → `de`.
 * Returns undefined rather than the default so callers can tell "no match" from
 * "matched English" — onboarding needs that distinction to decide whether to ask.
 */
export function resolveLocale(tag: string | null | undefined): ILocale | undefined {
  if (!tag) return undefined;
  const exact = findLocale(tag);
  if (exact) return exact;

  const lower = tag.toLowerCase();
  // Script-aware Chinese: zh-TW / zh-HK / zh-MO are Traditional, everything else Simplified.
  if (lower.startsWith('zh')) {
    const traditional = /\b(hant|tw|hk|mo)\b/.test(lower);
    return findLocale(traditional ? 'zh-Hant' : 'zh-Hans');
  }
  const base = lower.split('-')[0];
  return LOCALES.find((l) => l.code.toLowerCase().split('-')[0] === base);
}
