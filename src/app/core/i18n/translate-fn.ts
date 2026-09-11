import { Signal, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { filter, merge, scan } from 'rxjs';

/** `translate(key, params)` — the shape code-side label builders take. */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * A counter that bumps whenever a translation result may have changed.
 *
 * Two events invalidate anything computed from the synchronous
 * `TranslocoService.translate()`: the person switching language, and the
 * current language's file finishing its download (on a cold load a label built
 * before `ja.json` lands would otherwise stay English all session). Reading
 * this signal inside a `computed()` or `effect()` re-runs it on both.
 *
 * `getActiveLang()` is a plain method, not a signal; code that read it inside
 * a `computed()` never re-ran, which is how "the previous language stays on
 * screen" reports arise. This is the one primitive every code-side translation
 * should depend on.
 *
 * Pass `null` where Transloco may be absent (embedded hosts, bare specs) and
 * you get a signal that never changes — the English fallback then stands.
 */
export function translationRevision(transloco: TranslocoService | null | undefined): Signal<number> {
  if (!transloco) return signal(0);
  return toSignal(
    merge(
      transloco.langChanges$,
      transloco.events$.pipe(filter((e) => e.type === 'translationLoadSuccess')),
    ).pipe(scan((n) => n + 1, 0)),
    { initialValue: 0 },
  );
}

/**
 * A `TranslateFn` as a signal: a `computed()` that builds labels in code (a
 * context menu, an owner's display name, a placeholder) re-evaluates whenever
 * the language or its file changes, because reading the signal is enough to
 * track {@link translationRevision}.
 *
 * Requires Transloco to be provided; app code (dashboard, auth, site) may
 * assume that. Editor code, which must also run without a provider, uses
 * `translateOr` together with `injectTranslationRevision()` instead.
 */
export function injectTranslateFn(): Signal<TranslateFn> {
  const transloco = inject(TranslocoService);
  const revision = translationRevision(transloco);
  return computed<TranslateFn>(() => {
    revision();
    return (key, params) => transloco.translate(key, params);
  });
}
