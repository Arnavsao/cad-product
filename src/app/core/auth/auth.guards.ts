import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { MeService } from '../api/me.service';
import { ClerkService } from './clerk.service';

/**
 * Functional route guards. Each one `await`s `ClerkService.load()` — the SDK
 * is loaded in the background from the App constructor, so by the time a
 * guard runs the wait is usually already over. In embedded mode (no
 * publishable key) every guard passes: there is nobody to authenticate.
 */

/** Signed-in users only; otherwise `/sign-in?redirect_url=<attempted url>`. */
export const authGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const clerk = inject(ClerkService);
  const router = inject(Router);
  if (!clerk.enabled()) return true;
  await clerk.load();
  if (clerk.isSignedIn()) return true;
  return router.createUrlTree(['/sign-in'], { queryParams: { redirect_url: state.url } });
};

/** Signed-out users only (sign-in / sign-up); signed-in users go to the dashboard. */
export const guestGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const clerk = inject(ClerkService);
  const router = inject(Router);
  if (!clerk.enabled()) return true;
  await clerk.load();
  if (!clerk.isSignedIn()) return true;
  return router.createUrlTree(['/dashboard']);
};

/**
 * Dashboard entry: users who have not finished onboarding are sent to
 * `/onboarding`. If `/me` fails we let the page render (and show its own
 * error state) rather than trapping the user in a redirect loop.
 */
export const onboardingGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const clerk = inject(ClerkService);
  const me = inject(MeService);
  const router = inject(Router);
  if (!clerk.enabled()) return true;
  await clerk.load();
  if (!clerk.isSignedIn()) return true; // authGuard handles the redirect; skip the doomed /me call
  try {
    const profile = await me.load();
    if (!profile.onboarded) return router.createUrlTree(['/onboarding']);
  } catch {
    /* API unreachable — fall through and let the dashboard show its error state. */
  }
  return true;
};

/** Onboarding entry: users who already onboarded go straight to the dashboard. */
export const notOnboardedGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const clerk = inject(ClerkService);
  const me = inject(MeService);
  const router = inject(Router);
  if (!clerk.enabled()) return true;
  await clerk.load();
  if (!clerk.isSignedIn()) return true;
  try {
    const profile = await me.load();
    if (profile.onboarded) return router.createUrlTree(['/dashboard']);
  } catch {
    /* Let onboarding render; it will surface the API error itself. */
  }
  return true;
};
