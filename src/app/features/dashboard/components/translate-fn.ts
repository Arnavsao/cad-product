import { Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { filter, merge, scan } from 'rxjs';

/** `translate(key, params)` — the shape the menu builders and computed labels take. */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * A `TranslateFn` as a signal, so a `computed()` that builds labels in code
 * (a context menu, a "Shared with you" chip) is re-evaluated when its text may
 * have changed.
 *
 * `TranslocoService.translate()` is synchronous and only as fresh as the moment
 * it ran. Two things invalidate it afterwards: the user switching language, and
 * the current language's file arriving from the network (on a cold load a menu
 * built before `ja.json` lands would otherwise stay English all session). The
 * returned signal yields a new function in both cases; reading it inside a
 * `computed` is enough to track them. Mirrors `ToolCatalogService.translationRevision`.
 */
export function injectTranslateFn(): Signal<TranslateFn> {
  const transloco = inject(TranslocoService);
  const revision = toSignal(
    merge(
      transloco.langChanges$,
      transloco.events$.pipe(filter((e) => e.type === 'translationLoadSuccess')),
    ).pipe(scan((n) => n + 1, 0)),
    { initialValue: 0 },
  );
  return computed<TranslateFn>(() => {
    revision();
    return (key, params) => transloco.translate(key, params);
  });
}
