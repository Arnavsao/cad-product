import { EnvironmentProviders, Provider, inject, provideAppInitializer } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { LanguageService } from './language.service';
import { DEFAULT_LOCALE, LOCALE_CODES } from './locales';
import { TranslocoHttpLoader } from './transloco.loader';
import { environment } from '../../../environments/environment';

/**
 * Everything the app needs to be multilingual.
 *
 * `fallbackLang` + `missingHandler.useFallbackTranslation` together are what
 * make a partially-translated language safe to ship: any key missing from, say,
 * `cs.json` renders its English text instead of the raw key. That is the
 * difference between an untranslated button reading "Save" and reading
 * "dashboard.actions.save", and it is why new languages can go live before
 * every string is done.
 *
 * `LanguageService` is instantiated eagerly by the initializer below. It has to
 * run before the first component renders, because it is what sets the active
 * language — without it Transloco would briefly serve `defaultLang` and the UI
 * would flash English for a Japanese user on every cold load.
 */
export function provideI18n(): (Provider | EnvironmentProviders)[] {
  return [
    provideTransloco({
      config: {
        availableLangs: [...LOCALE_CODES],
        defaultLang: DEFAULT_LOCALE,
        fallbackLang: DEFAULT_LOCALE,
        // Keep the active language in the URL-free, reload-safe place: the
        // service owns persistence, so Transloco must not also try to.
        reRenderOnLangChange: true,
        prodMode: environment.production,
        missingHandler: {
          // Render the English string for a key this language has not translated
          // yet, rather than the key itself.
          useFallbackTranslation: true,
          // In dev, log once per missing key so `npm start` surfaces gaps; in
          // prod stay silent — a missing key is a cosmetic issue, not worth
          // noise in Sentry.
          logMissingKey: !environment.production,
        },
      },
      loader: TranslocoHttpLoader,
    }),
    provideAppInitializer(() => {
      // Constructing the service applies the resolved language. Also warm the
      // active language's file so the first paint is already translated.
      const language = inject(LanguageService);
      language.preload(language.localeCode());
    }),
  ];
}
