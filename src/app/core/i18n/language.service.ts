import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { DEFAULT_LOCALE, ILocale, LOCALES, findLocale, resolveLocale } from './locales';
import { TranslateFn, translationRevision } from './translate-fn';

/** Where the choice is remembered. Mirrors ThemeService's `cad.theme`. */
const STORAGE_KEY = 'cad.locale';
/** Which account the remembered choice belongs to. @see LanguageService.applyRemote */
const OWNER_KEY = 'cad.locale.owner';

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

  /**
   * Bumps on every language switch and every finished translation load. Read
   * it inside a `computed()`/`effect()` that translates in code, so the result
   * follows the language instead of freezing at first evaluation.
   */
  readonly revision: Signal<number> = translationRevision(this.transloco);

  /**
   * `translate(key, params)` as a signal: a `computed()` that reads `t()` and
   * builds a label re-evaluates when the language or its file changes.
   */
  readonly t: Signal<TranslateFn> = computed(() => {
    this.revision();
    return (key, params) => this.transloco.translate(key, params);
  });

  constructor() {
    // Push the active language onto Transloco and the document. `lang` on <html>
    // is what lets the browser pick the right font and hyphenation for CJK, and
    // what screen readers switch voice on; `dir` keeps a future RTL addition to
    // a one-line change here.
    effect(() => {
      const locale = this.locale();
      // Until this language's file has arrived, code-side translations return
      // English (or the key) and the *transloco views keep the previous
      // language. `loading` lets a picker show that the switch is in flight.
      this.loading.set(!this.transloco.getTranslation(locale.code)?.['common.retry']);
      this.transloco.setActiveLang(locale.code);
      try {
        document.documentElement.lang = locale.code;
        document.documentElement.dir = locale.dir;
        localStorage.setItem(STORAGE_KEY, locale.code);
      } catch {
        /* storage-disabled environments — the language still applies for this session */
      }
    });

    this.transloco.events$.subscribe((e) => {
      if (e.type !== 'translationLoadSuccess' && e.type !== 'translationLoadFailure') return;
      if (e.payload.langName === this.localeCode()) this.loading.set(false);
    });

    // Follow a language change made in another tab, the way ThemeService does.
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue && findLocale(e.newValue)) {
        this.localeCode.set(e.newValue);
      }
    });
  }

  /**
   * Whether the active language reflects a deliberate choice rather than a
   * guess, in which case the account's stored value must not override it.
   *
   * Seeded from `localStorage`: a value there was put there by this person
   * picking a language in this browser, so it outranks the account exactly as a
   * pick made a moment ago does. Without that seeding a reload would restore
   * the right language and then let a stale `/me` answer undo it — which is
   * what made the picker look like it "saves English".
   *
   * @see applyRemote for the rest of what this guards against.
   */
  private chosen = !!findLocale(readStorage(STORAGE_KEY));

  /**
   * Select a language by code. Unknown codes are ignored, so a stale value from
   * an account that once had a language we no longer ship cannot blank the UI.
   *
   * This is the *user's own* choice — the picker, or a host application acting
   * for them. A value arriving from `/me` must go through {@link applyRemote}.
   */
  setLocale(code: string): void {
    this.chosen = true;
    if (!findLocale(code) || code === this.localeCode()) return;
    this.localeCode.set(code);
  }

  /**
   * Apply the language the account is stored with, without overruling a choice
   * the person has made in this browser.
   *
   * `/me` and `PATCH /me/preferences` both echo the full preferences object,
   * and both can land *after* the picker has moved on: the settings page asks
   * for `/me` as it opens, so a slow answer would arrive seconds later carrying
   * the old language and silently snap the UI back to it. That is exactly the
   * "I pick German and it jumps back to English" report. A response can only
   * ever describe the past, so a local choice always wins over one.
   *
   * There is no time window here on purpose. A response in flight is stale
   * whether it takes 50 ms or 20 s, and picking a threshold would only move
   * the bug to slower connections — where it already hurts most.
   *
   * `owner` is the account the preferences belong to. The remembered choice is
   * tagged with the account that was signed in when it was made; when a
   * *different* account signs in on this browser, its stored language wins,
   * because the local choice was someone else's. Someone who has never chosen
   * still gets their account's language, so a new browser or a first sign-in
   * behaves as before.
   */
  applyRemote(code: string | null | undefined, owner?: string | null): void {
    if (owner) {
      const previous = readStorage(OWNER_KEY);
      if (previous !== owner) {
        // A new account on this browser: forget the previous person's pick.
        if (previous) this.chosen = false;
        try {
          localStorage.setItem(OWNER_KEY, owner);
        } catch {
          /* storage-disabled */
        }
      }
    }
    if (!code || this.chosen) return;
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
