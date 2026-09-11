import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { MeService } from '../../core/api/me.service';
import { SignInHandoffService } from '../../core/auth/sign-in-handoff.service';
import {
  AFTER_SIGN_IN_URL,
  AFTER_SIGN_UP_URL,
  SIGN_IN_URL,
  SupabaseAuthService,
} from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
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
  imports: [
    AuthLayoutComponent,
    RouterLink,
    TranslocoDirective,
    UiButtonDirective,
    UiIconComponent,
  ],
  template: `
    <app-auth-layout *transloco="let t">
      @if (error(); as message) {
        <div class="auth-notice auth-notice--error" role="alert">
          <ui-icon name="alert" [size]="18" />
          <div>
            <strong>{{ t('auth.callback.failedTitle') }}</strong>
            <p>{{ message }}</p>
            <a uiButton variant="primary" [routerLink]="signInUrl">{{ t('auth.signUp.backToSignIn') }}</a>
          </div>
        </div>
      }
      <!-- No success branch: while the exchange is in flight, SignInHandoffService's
           full-page loader covers this page and stays up through the navigation
           that follows. -->
    </app-auth-layout>
  `,
  styleUrl: './auth-page.scss',
})
export class AuthCallbackPage {
  private readonly auth = inject(SupabaseAuthService);
  private readonly me = inject(MeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly handoff = inject(SignInHandoffService);

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
      this.fail(described);
      return;
    }

    if (!this.auth.enabled()) {
      await this.router.navigateByUrl('/editor');
      return;
    }

    // Raised only now: everything above either fails outright or leaves for a
    // destination that does not clear the overlay.
    this.handoff.begin();

    const session = await this.auth.completeRedirect();
    if (!session) {
      this.fail(this.transloco.translate('auth.callback.expired'));
      return;
    }

    // Recovery links pass `next` so the user lands on the set-password form.
    // `next` and `redirect_url` both point at arbitrary routes (the reset form, a
    // share link) that know nothing about the handoff, so the overlay comes down
    // here rather than waiting for a page that would never call `end()`.
    const next = params.get('next');
    if (next) {
      this.handoff.end();
      await this.router.navigateByUrl(next);
      return;
    }

    const redirect = params.get('redirect_url');
    if (redirect) {
      this.handoff.end();
      await this.router.navigateByUrl(redirect);
      return;
    }

    // A brand-new account has not onboarded; an existing one has. `onboardingGuard`
    // would bounce anyway, but routing correctly the first time avoids a visible
    // double navigation. A failure here is not fatal — the guard is the backstop.
    //
    // The overlay deliberately stays up across this navigation: RecentPage clears
    // it once `GET /drawings/recent` settles, OnboardingPage once it renders.
    try {
      const profile = await this.me.load();
      await this.router.navigateByUrl(profile.onboarded ? AFTER_SIGN_IN_URL : AFTER_SIGN_UP_URL);
    } catch {
      await this.router.navigateByUrl(AFTER_SIGN_IN_URL);
    }
  }

  /** Show the error notice, making sure the overlay is not covering it. */
  private fail(message: string): void {
    this.handoff.end();
    this.error.set(message);
  }
}
