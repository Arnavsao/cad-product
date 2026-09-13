import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { MeService } from '../../core/api/me.service';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';

/**
 * Staff-only routes.
 *
 * This is a **UX** guard, not a security boundary: it decides whether to render
 * the portal, and the API decides whether to answer it. Every `/admin` endpoint
 * re-checks the tier against the database row (`AdminGuard` on the server), so
 * a user who forces this route sees an empty shell and a wall of 403s.
 *
 * A non-staff user is sent to the dashboard rather than to sign-in: they are
 * signed in perfectly well, they simply have no business here, and bouncing
 * them to a login form would look like a broken session.
 */
export const adminGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const auth = inject(SupabaseAuthService);
  const me = inject(MeService);
  const router = inject(Router);

  // Embedded mode has no accounts at all, so there is nobody to be staff.
  if (!auth.enabled()) return router.createUrlTree(['/dashboard']);

  await auth.load();
  if (!auth.isSignedIn()) return router.createUrlTree(['/sign-in'], { queryParams: { redirect_url: '/admin' } });

  try {
    const profile = await me.load();
    if (profile.user.platformRole !== 'user') return true;
  } catch {
    /* Unreachable API: fall through to the dashboard, which shows its own error. */
  }
  return router.createUrlTree(['/dashboard']);
};
