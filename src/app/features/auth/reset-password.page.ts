import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiInputDirective } from '../../shared/ui/input.directive';
import { AuthLayoutComponent } from './auth-layout.component';

const MIN_PASSWORD_LENGTH = 6;

/**
 * `/reset-password` — both halves of the recovery flow, chosen by whether there
 * is a session.
 *
 * Arriving signed out (from the sign-in link) it asks for an email and sends a
 * recovery link. Arriving *with* a recovery session — Supabase signs the user in
 * when they follow that link — it asks for the new password instead. One route
 * for both halves means the emailed link has a single stable destination.
 */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthLayoutComponent, FormsModule, RouterLink, UiButtonDirective, UiIconComponent, UiInputDirective],
  template: `
    <app-auth-layout>
      @if (!auth.enabled()) {
        <div class="auth-notice" role="status">
          <ui-icon name="alert" [size]="18" />
          <div>
            <strong>Authentication is not configured</strong>
            <p>There is no account system in this deployment.</p>
            <a uiButton variant="primary" routerLink="/editor">Open editor</a>
          </div>
        </div>
      } @else if (done()) {
        <div class="auth-card">
          <div class="auth-sent" role="status">
            <span class="auth-sent__mark" aria-hidden="true"><ui-icon name="check" [size]="20" /></span>
            <h2>Password updated</h2>
            <p>You are signed in with your new password.</p>
            <a uiButton routerLink="/dashboard">Go to dashboard</a>
          </div>
        </div>
      } @else if (linkSent()) {
        <div class="auth-card">
          <div class="auth-sent" role="status">
            <span class="auth-sent__mark" aria-hidden="true"><ui-icon name="check" [size]="20" /></span>
            <h2>Check your email</h2>
            <p>We sent a recovery link to <strong>{{ email() }}</strong>. Open it to set a new password.</p>
            <a uiButton variant="ghost" routerLink="/sign-in">Back to sign in</a>
          </div>
        </div>
      } @else if (auth.isSignedIn()) {
        <!-- Recovery session: the user followed the emailed link. -->
        <div class="auth-card">
          <h1 class="auth-card__title">Set a new password</h1>
          <p class="auth-card__sub">Choose something you have not used here before.</p>

          <form class="auth-form" (ngSubmit)="savePassword()">
            <div class="auth-field">
              <label class="auth-field__label" for="rp-password">New password</label>
              <input
                uiInput
                id="rp-password"
                type="password"
                autocomplete="new-password"
                required
                [attr.minlength]="minPasswordLength"
                [value]="password()"
                [disabled]="busy()"
                (input)="password.set(value($event))"
              />
              <p class="auth-hint" [class.auth-hint--bad]="tooShort()">
                At least {{ minPasswordLength }} characters.
              </p>
            </div>

            @if (error(); as message) {
              <p class="auth-error" role="alert"><ui-icon name="alert" [size]="15" />{{ message }}</p>
            }

            <button type="submit" uiButton class="auth-submit" [disabled]="!canSave()" [loading]="busy()">
              Update password
            </button>
          </form>
        </div>
      } @else {
        <div class="auth-card">
          <h1 class="auth-card__title">Reset your password</h1>
          <p class="auth-card__sub">We will email you a link to set a new one.</p>

          <form class="auth-form" (ngSubmit)="sendLink()">
            <div class="auth-field">
              <label class="auth-field__label" for="rp-email">Email</label>
              <input
                uiInput
                id="rp-email"
                type="email"
                autocomplete="email"
                required
                [value]="email()"
                [disabled]="busy()"
                (input)="email.set(value($event))"
              />
            </div>

            @if (error(); as message) {
              <p class="auth-error" role="alert"><ui-icon name="alert" [size]="15" />{{ message }}</p>
            }

            <button type="submit" uiButton class="auth-submit" [disabled]="!canSend()" [loading]="busy()">
              Email me a link
            </button>
          </form>

          <p class="auth-alt">Remembered it? <a routerLink="/sign-in">Sign in</a></p>
        </div>
      }
    </app-auth-layout>
  `,
  styleUrl: './auth-page.scss',
})
export class ResetPasswordPage {
  protected readonly auth = inject(SupabaseAuthService);

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly linkSent = signal(false);
  protected readonly done = signal(false);

  protected readonly tooShort = computed(
    () => this.password().length > 0 && this.password().length < MIN_PASSWORD_LENGTH,
  );
  protected readonly canSend = computed(() => !this.busy() && !!this.email().trim());
  protected readonly canSave = computed(() => !this.busy() && this.password().length >= MIN_PASSWORD_LENGTH);

  constructor() {
    // A recovery link lands here already signed in, so the session has to be
    // resolved before the template can pick which half of the flow to show.
    void this.auth.load();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async sendLink(): Promise<void> {
    if (!this.canSend()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const result = await this.auth.sendPasswordReset(this.email());
    this.busy.set(false);
    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
    this.linkSent.set(true);
  }

  protected async savePassword(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const result = await this.auth.updatePassword(this.password());
    this.busy.set(false);
    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
    this.password.set('');
    this.done.set(true);
  }
}
