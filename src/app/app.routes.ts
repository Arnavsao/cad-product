import { Routes, UrlMatchResult, UrlMatcher, UrlSegment } from '@angular/router';
import { authGuard, guestGuard, notOnboardedGuard, onboardingGuard } from './core/auth/auth.guards';
import { unsavedChangesGuard } from './features/cad-editor/unsaved-changes.guard';

/**
 * Matches `/<prefix>` and everything beneath it as ONE route, so the same
 * component stays mounted while a nested flow rewrites the URL. Clerk's path
 * routing does exactly that (`/sign-in` → `/sign-in/factor-one`, and
 * `/dashboard/settings/account/security` inside the user profile); a plain
 * `path: 'sign-in'` would 404 on the sub-step or remount the component.
 */
export function prefixMatcher(prefix: string): UrlMatcher {
  return (segments: UrlSegment[]): UrlMatchResult | null =>
    segments.length > 0 && segments[0].path === prefix ? { consumed: segments } : null;
}

/**
 * Consumes `/editor` and `/editor/:id` (exposed as the `id` param) as a single
 * route. Save-As can then `router.navigate(['/editor', id], { replaceUrl: true })`
 * to bind the URL to the new drawing without recreating `CadEditorComponent` —
 * which would tear down tools, autosave and every open tab.
 */
export const editorMatcher: UrlMatcher = (segments: UrlSegment[]): UrlMatchResult | null => {
  if (segments.length === 0 || segments[0].path !== 'editor') return null;
  if (segments.length === 1) return { consumed: segments };
  if (segments.length === 2) return { consumed: segments, posParams: { id: segments[1] } };
  return null;
};

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'CADOnline',
    loadComponent: () => import('./features/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    matcher: prefixMatcher('sign-in'),
    title: 'Sign in · CADOnline',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/sign-in.page').then((m) => m.SignInPage),
  },
  {
    matcher: prefixMatcher('sign-up'),
    title: 'Create account · CADOnline',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/sign-up.page').then((m) => m.SignUpPage),
  },

  {
    path: 'onboarding',
    title: 'Welcome · CADOnline',
    canActivate: [authGuard, notOnboardedGuard],
    loadComponent: () => import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () => import('./features/dashboard/dashboard-shell.component').then((m) => m.DashboardShellComponent),
    children: [
      { path: '', pathMatch: 'full', title: 'Recent · CADOnline',
        loadComponent: () => import('./features/dashboard/pages/recent.page').then((m) => m.RecentPage) },
      { path: 'drawings', title: 'My Drawings · CADOnline',
        loadComponent: () => import('./features/dashboard/pages/drawings.page').then((m) => m.DrawingsPage) },
      { path: 'folders/:folderId', title: 'My Drawings · CADOnline',
        loadComponent: () => import('./features/dashboard/pages/drawings.page').then((m) => m.DrawingsPage) },
      { path: 'trash', title: 'Trash · CADOnline',
        loadComponent: () => import('./features/dashboard/pages/trash.page').then((m) => m.TrashPage) },
      // prefixMatcher: Clerk's <UserProfile> (mounted at /dashboard/settings/account) path-routes beneath it.
      { matcher: prefixMatcher('settings'), title: 'Settings · CADOnline',
        loadComponent: () => import('./features/dashboard/pages/settings.page').then((m) => m.SettingsPage) },
    ],
  },

  {
    matcher: editorMatcher,
    title: 'CADOnline',
    canActivate: [authGuard],
    // Offers Save all / Discard / Cancel before navigating away with unsaved work.
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true },
    loadComponent: () => import('./features/cad-editor/cad-editor').then((m) => m.CadEditorComponent),
  },
  {
    path: 'terms',
    title: 'Terms of Service · CADOnline',
    data: { doc: 'terms' },
    loadComponent: () => import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent),
  },
  {
    path: 'privacy',
    title: 'Privacy Policy · CADOnline',
    data: { doc: 'privacy' },
    loadComponent: () => import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent),
  },
  // Legacy path used by the bridge application.
  { path: 'cad-editor', redirectTo: 'editor' },
  // Must stay last.
  { path: '**', redirectTo: '' },
];
