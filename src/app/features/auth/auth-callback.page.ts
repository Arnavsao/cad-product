import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MeService } from '../../core/api/me.service';
import {
  AFTER_SIGN_IN_URL,
  AFTER_SIGN_UP_URL,
  SIGN_IN_URL,
  SupabaseAuthService,
} from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';
import { AuthLayoutComponent } from './auth-layout.component';

/**
 * `/auth/callback` — the single landing point for every Supabase redirect: OAuth,
 * email confirmation and password recovery.
 *
 * Design decisions:
 *  - **One route for all three.** Each flow needs an allow-listed redirect URL in
 *    the Supabase dashboard; funnelling them through one path means one URL to
 *    configure instead of three to keep in sync.
 *  - **`detectSessionInUrl` does the work**, during `load()`. This page's job is
 *    to await that, then decide where to go — and to show a real error if it
 *    failed, instead of leaving the user on a spinner.
 *  - **Where to go next** is `?next=` (recovery sends the user to the reset form),
 *    then `?redirect_url=` (what the guard blocked), then onboarding for a user
 *    who has not finished it, then the dashboard.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthLayoutComponent, RouterLink, UiButtonDirective, UiIconComponent, UiSkeletonComponent],
  template: `
    <app-auth-layout>
      @if (error(); as message) {
        <div class="auth-notice auth-notice--error" role="alert">
          <ui-icon name="alert" [size]="18" />
          <div>
            <strong>Sign-in could not be completed</strong>
            <p>{{ message }}</p>
            <a uiButton variant="primary" [routerLink]="signInUrl">Back to sign in</a>
          </div>
        </div>
      } @else {
        <div class="auth-skeleton" aria-busy="true" aria-label="Completing sign-in">
          <ui-skeleton width="55%" height="24px" />
          <ui-skeleton width="80%" height="14px" />
          <ui-skeleton width="100%" height="40px" radius="var(--ui-radius-md)" />
        </div>
      }
    </app-auth-layout>
  `,
  styleUrl: './auth-page.scss',
})
export class AuthCallbackPage {
  private readonly auth = inject(SupabaseAuthService);
  private readonly me = inject(MeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly signInUrl = SIGN_IN_URL;
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.complete();
  }

  private async complete(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;

    // Supabase reports a failed link in the query (or the hash) rather than
    // throwing, so check for it before waiting on a session that will never come.
    const described = params.get('error_description') ?? params.get('error');
    if (described) {
      this.error.set(described);
      return;
    }

    if (!this.auth.enabled()) {
      await this.router.navigateByUrl('/editor');
      return;
    }

    const session = await this.auth.completeRedirect();
    if (!session) {
      this.error.set('That link has expired or was already used. Please try signing in again.');
      return;
    }

    // Recovery links pass `next` so the user lands on the set-password form.
    const next = params.get('next');
    if (next) {
      await this.router.navigateByUrl(next);
      return;
    }

    const redirect = params.get('redirect_url');
    if (redirect) {
      await this.router.navigateByUrl(redirect);
      return;
    }

    // A brand-new account has not onboarded; an existing one has. `onboardingGuard`
    // would bounce anyway, but routing correctly the first time avoids a visible
    // double navigation. A failure here is not fatal — the guard is the backstop.
    try {
      const profile = await this.me.load();
      await this.router.navigateByUrl(profile.onboarded ? AFTER_SIGN_IN_URL : AFTER_SIGN_UP_URL);
    } catch {
      await this.router.navigateByUrl(AFTER_SIGN_IN_URL);
    }
  }
}
