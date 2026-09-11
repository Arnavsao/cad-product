import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader, provideTransloco } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import en from '../../public/i18n/en.json';

/**
 * Serves the real English strings synchronously, so a spec can assert on the
 * text a user sees ("Save", "Move to trash…") rather than on translation keys.
 *
 * Any other language resolves to `{}`, which Transloco falls back to English.
 * `TestBed.tick()` / `await fixture.whenStable()` after the first
 * `detectChanges()` is still needed: the `*transloco` directive renders its
 * view once the (synchronous, but observable-driven) load has settled.
 */
@Injectable()
class EnglishOnlyLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(lang === 'en' ? (en as Translation) : {});
  }
}

export function provideI18nTesting() {
  return provideTransloco({
    config: {
      availableLangs: ['en'],
      defaultLang: 'en',
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: true,
      missingHandler: { useFallbackTranslation: true, logMissingKey: false },
    },
    loader: EnglishOnlyLoader,
  });
}
