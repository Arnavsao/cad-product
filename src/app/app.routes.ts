import { Routes, UrlMatchResult, UrlMatcher, UrlSegment } from '@angular/router';
import { authGuard, guestGuard, notOnboardedGuard, onboardingGuard } from './core/auth/auth.guards';
import { unsavedChangesGuard } from './features/cad-editor/unsaved-changes.guard';

/**
 * Matches `/<prefix>` and everything beneath it as ONE route, so the same
 * component stays mounted while a nested URL is used. Settings uses it so
 * `/dashboard/settings/account` resolves to the Settings page rather than 404ing,
 * without the page having to declare a child route per pane.
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
    title: 'CADO',
    loadComponent: () => import('./features/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: 'sign-in',
    title: 'Sign in · CADO',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: 'sign-up',
    title: 'Create account · CADO',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/sign-up.page').then((m) => m.SignUpPage),
  },
  // Deliberately NOT behind `guestGuard`: a recovery link signs the user in
  // before they reach this page, and a guest guard would bounce them away from
  // the very form they were sent here to use.
  {
    path: 'reset-password',
    title: 'Reset password · CADO',
    loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  // Every Supabase redirect (OAuth, email confirmation, recovery) lands here, so
  // this is the one URL that has to be allow-listed in the project dashboard.
  // No guard: it runs mid-flow, when the session may or may not exist yet.
  {
    path: 'auth/callback',
    title: 'Signing in · CADO',
    loadComponent: () => import('./features/auth/auth-callback.page').then((m) => m.AuthCallbackPage),
  },

  {
    path: 'onboarding',
    title: 'Welcome · CADO',
    canActivate: [authGuard, notOnboardedGuard],
    loadComponent: () => import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () => import('./features/dashboard/dashboard-shell.component').then((m) => m.DashboardShellComponent),
    children: [
      { path: '', pathMatch: 'full', title: 'Recent · CADO',
        loadComponent: () => import('./features/dashboard/pages/recent.page').then((m) => m.RecentPage) },
      { path: 'drawings', title: 'My Drawings · CADO',
        loadComponent: () => import('./features/dashboard/pages/drawings.page').then((m) => m.DrawingsPage) },
      { path: 'folders/:folderId', title: 'My Drawings · CADO',
        loadComponent: () => import('./features/dashboard/pages/drawings.page').then((m) => m.DrawingsPage) },
      // Same component as My Drawings: `data.scope` is bound to its `scope`
      // input by `withComponentInputBinding()`, which is all that differs.
      { path: 'shared', title: 'Shared with me · CADO', data: { scope: 'shared' },
        loadComponent: () => import('./features/dashboard/pages/drawings.page').then((m) => m.DrawingsPage) },
      { path: 'trash', title: 'Trash · CADO',
        loadComponent: () => import('./features/dashboard/pages/trash.page').then((m) => m.TrashPage) },
      { path: 'inbox', title: 'Notifications · CADO',
        loadComponent: () => import('./features/dashboard/pages/inbox.page').then((m) => m.InboxPage) },
      { path: 'feedback', title: 'Provide Feedback · CADO',
        loadComponent: () => import('./features/dashboard/pages/feedback.page').then((m) => m.FeedbackPage) },
      // `profile`, not `account`: /dashboard/settings/account is the Settings account pane.
      { path: 'profile', title: 'Personal info · CADO',
        loadComponent: () => import('./features/dashboard/pages/profile.page').then((m) => m.ProfilePage) },
      // No `:id`: the page manages whichever organization the workspace switcher
      // has active, so this URL and the rest of the shell can never disagree.
      { path: 'organization', title: 'Members · CADO',
        loadComponent: () => import('./features/dashboard/pages/organization.page').then((m) => m.OrganizationPage) },
      // prefixMatcher: the Account pane lives at /dashboard/settings/account, and
      // existing links point there, so the page owns everything under `settings`.
      { matcher: prefixMatcher('settings'), title: 'Settings · CADO',
        loadComponent: () => import('./features/dashboard/pages/settings.page').then((m) => m.SettingsPage) },
    ],
  },

  // Redeeming an invite link and opening a share link. Both are outside the
  // dashboard shell — they are one-shot landing pages, not places to browse —
  // and both are behind `authGuard`, which parks the URL in `?redirect_url=` so
  // a signed-out recipient comes back here after signing in.
  {
    path: 'join/:token',
    title: 'Join organization · CADO',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/pages/join.page').then((m) => m.JoinPage),
  },
  {
    path: 'shared/:token',
    title: 'Shared drawing · CADO',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/pages/shared-link.page').then((m) => m.SharedLinkPage),
  },

  {
    matcher: editorMatcher,
    title: 'CADO',
    canActivate: [authGuard],
    // Offers Save all / Discard / Cancel before navigating away with unsaved work.
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true },
    loadComponent: () => import('./features/cad-editor/cad-editor').then((m) => m.CadEditorComponent),
  },
  // Public on purpose: all of these are read while deciding whether to sign up.
  {
    path: 'features',
    title: 'Features · CADO',
    loadComponent: () => import('./features/features/features.page').then((m) => m.FeaturesPage),
  },
  {
    path: 'pricing',
    title: 'Plans & pricing · CADO',
    loadComponent: () => import('./features/pricing/pricing.page').then((m) => m.PricingPage),
  },
  {
    path: 'whats-new',
    title: "What's New · CADO",
    loadComponent: () => import('./features/about/whats-new.page').then((m) => m.WhatsNewPage),
  },
  {
    path: 'terms',
    title: 'Terms of Service · CADO',
    data: { doc: 'terms' },
    loadComponent: () => import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent),
  },
  {
    path: 'privacy',
    title: 'Privacy Policy · CADO',
    data: { doc: 'privacy' },
    loadComponent: () => import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent),
  },
  // Legacy path used by the bridge application.
  { path: 'cad-editor', redirectTo: 'editor' },
  // Must stay last.
  { path: '**', redirectTo: '' },
];
