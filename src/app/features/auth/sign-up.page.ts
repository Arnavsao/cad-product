import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AFTER_SIGN_UP_URL, SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiInputDirective } from '../../shared/ui/input.directive';
import { AuthLayoutComponent } from './auth-layout.component';
import { OAuthButtonsComponent } from './oauth-buttons.component';

/** Supabase's own default minimum. Kept here so the hint and the check agree. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * `/sign-up` — create an account with email + password, or an OAuth provider.
 *
 * Design decisions:
 *  - **Two outcomes, both handled.** With email confirmation enabled Supabase
 *    returns no session, so the page shows "check your inbox"; with it disabled a
 *    session arrives immediately and the user goes straight to onboarding.
 *    Assuming either one would break the other project setting.
 *  - **Full name is optional and stored as `user_metadata.full_name`**, which is
 *    the same field the OAuth providers populate — so the server's name-splitting
 *    works identically however the account was created.
 */
@Component({
  selector: 'app-sign-up',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthLayoutComponent,
    FormsModule,
    OAuthButtonsComponent,
    RouterLink,
    UiButtonDirective,
    UiIconComponent,
    UiInputDirective,
  ],
  templateUrl: './sign-up.page.html',
  styleUrl: './auth-page.scss',
})
export class SignUpPage {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  protected readonly fullName = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmSent = signal(false);

  protected readonly passwordTooShort = computed(
    () => this.password().length > 0 && this.password().length < MIN_PASSWORD_LENGTH,
  );

  protected readonly canSubmit = computed(
    () => !this.busy() && !!this.email().trim() && this.password().length >= MIN_PASSWORD_LENGTH,
  );

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    const result = await this.auth.signUpWithPassword(this.email(), this.password(), this.fullName());
    this.busy.set(false);

    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
    if (result.emailSent) {
      this.confirmSent.set(true);
      return;
    }
    await this.router.navigateByUrl(AFTER_SIGN_UP_URL);
  }

  /** A failed SDK load is only recoverable by a fresh page load. */
  protected retry(): void {
    location.reload();
  }
}
