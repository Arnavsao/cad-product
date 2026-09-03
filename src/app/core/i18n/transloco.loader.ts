import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Loads `public/i18n/<lang>.json`.
 *
 * Angular's `public/` folder is copied to the web root by the build, so these
 * live at `/i18n/…` — not the `/assets/i18n/…` Transloco's stock loader assumes.
 * The leading slash matters: a translation file must resolve the same way from
 * `/dashboard` and from `/editor/123`, and a relative URL would not.
 *
 * A failed fetch resolves to `{}` rather than throwing. A missing or malformed
 * translation file should degrade to English via Transloco's fallback, not take
 * down the route with an unhandled error — a drafter mid-drawing must not lose
 * the canvas because a language file 404'd.
 */
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string): Observable<Translation> {
    return this.http.get<Translation>(`/i18n/${lang}.json`).pipe(
      catchError((err) => {
        console.warn(`[i18n] could not load "${lang}"; falling back to English`, err);
        return of({} as Translation);
      }),
    );
  }
}
