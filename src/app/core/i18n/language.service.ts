import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { DEFAULT_LOCALE, ILocale, LOCALES, findLocale, resolveLocale } from './locales';

/** Where the choice is remembered. Mirrors ThemeService's `cad.theme`. */
const STORAGE_KEY = 'cad.locale';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage-disabled or SSR
  }
}

/**
 * The active UI language.
 *
 * Deliberately shaped like {@link ThemeService}, because it is the same kind of
 * thing — a runtime preference that must survive a reload, follow the account,
 * and stay in step across tabs. Matching that shape means the settings page and
 * onboarding treat language and theme the same way.
 *
 * Resolution order on first load, most to least specific:
 *   1. `localStorage['cad.locale']` — what this browser last chose.
 *   2. The browser's own languages (`navigator.languages`), widened: `de-AT` → `de`.
 *   3. English.
 *
 * The account's stored `locale` is *not* in that list, because `/me` has not
 * answered yet when this service is constructed. `MeService.applyPreferences`
 * pushes it in when it arrives, exactly as it does for the theme. The local
 * value going first is what stops the UI flashing English before `/me` lands.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);

  /** Every selectable language, in picker order. */
  readonly locales = LOCALES;

  /** BCP 47 code of the active language. */
  readonly localeCode = signal<string>(this.loadInitial().code);

  /** The active language. */
  readonly locale = computed<ILocale>(() => findLocale(this.localeCode()) ?? LOCALES[0]);

  /** Writing direction of the active language. All 14 shipped today are `ltr`. */
  readonly dir = computed<'ltr' | 'rtl'>(() => this.locale().dir);

  /** True while the active language's file has not been fetched yet. */
  readonly loading = signal<boolean>(false);

  constructor() {
    // Push the active language onto Transloco and the document. `lang` on <html>
    // is what lets the browser pick the right font and hyphenation for CJK, and
    // what screen readers switch voice on; `dir` keeps a future RTL addition to
    // a one-line change here.
    effect(() => {
      const locale = this.locale();
      this.transloco.setActiveLang(locale.code);
      try {
        document.documentElement.lang = locale.code;
        document.documentElement.dir = locale.dir;
        localStorage.setItem(STORAGE_KEY, locale.code);
      } catch {
        /* storage-disabled environments — the language still applies for this session */
      }
    });

    // Follow a language change made in another tab, the way ThemeService does.
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue && findLocale(e.newValue)) {
        this.localeCode.set(e.newValue);
      }
    });
  }

  /**
   * Select a language by code. Unknown codes are ignored, so a stale value from
   * an account that once had a language we no longer ship cannot blank the UI.
   */
  setLocale(code: string): void {
    if (!findLocale(code) || code === this.localeCode()) return;
    this.localeCode.set(code);
  }

  /**
   * Fetch a language's file without switching to it, so a picker can preload on
   * hover and the switch itself is instant. Failures are swallowed — this is a
   * pure optimisation and must never surface an error.
   */
  preload(code: string): void {
    if (!findLocale(code)) return;
    this.transloco.load(code).subscribe({ error: () => undefined });
  }

  private loadInitial(): ILocale {
    const saved = findLocale(readStorage(STORAGE_KEY));
    if (saved) return saved;

    // navigator.languages is ordered by the user's own preference; take the
    // first one we actually ship rather than only looking at `navigator.language`.
    const tags = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
    for (const tag of tags) {
      const match = resolveLocale(tag);
      if (match) return match;
    }
    return findLocale(DEFAULT_LOCALE) ?? LOCALES[0];
  }
}
