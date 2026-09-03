import { Injectable, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable, from, switchMap } from 'rxjs';
import { SupabaseAuthService } from '../auth/supabase-auth.service';

/**
 * Preload only routes flagged `data: { preload: true }` — and only for users
 * who will actually reach them.
 *
 * `PreloadAllModules` would fetch the ~1 MB editor chunk behind the landing
 * page for every anonymous visitor. Instead: nothing is preloaded until Supabase
 * reports a signed-in session (the router re-asks this strategy after every
 * navigation, so a user who signs in gets the editor preloaded on their next
 * route change). In embedded mode the editor *is* the app, so flagged routes
 * preload immediately.
 */
@Injectable({ providedIn: 'root' })
export class SelectivePreloadStrategy implements PreloadingStrategy {
  private readonly auth = inject(SupabaseAuthService);

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data?.['preload']) return EMPTY;
    if (!this.auth.enabled()) return load();
    return from(this.auth.load()).pipe(switchMap(() => (this.auth.isSignedIn() ? load() : EMPTY)));
  }
}
