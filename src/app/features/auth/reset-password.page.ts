import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
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
  imports: [
    AuthLayoutComponent,
    FormsModule,
    RouterLink,
    TranslocoDirective,
    UiButtonDirective,
    UiIconComponent,
    UiInputDirective,
  ],
  template: `
    <app-auth-layout *transloco="let t">
      @if (!auth.enabled()) {
        <div class="auth-notice" role="status">
          <ui-icon name="alert" [size]="18" />
          <div>
            <strong>{{ t('auth.notConfigured.title') }}</strong>
            <p>{{ t('auth.reset.notConfiguredBody') }}</p>
            <a uiButton variant="primary" routerLink="/editor">{{ t('auth.notConfigured.openEditor') }}</a>
          </div>
        </div>
      } @else if (done()) {
        <div class="auth-card">
          <div class="auth-sent" role="status">
            <span class="auth-sent__mark" aria-hidden="true"><ui-icon name="check" [size]="20" /></span>
            <h2>{{ t('auth.reset.updatedTitle') }}</h2>
            <p>{{ t('auth.reset.updatedBody') }}</p>
            <a uiButton routerLink="/dashboard">{{ t('auth.reset.goToDashboard') }}</a>
          </div>
        </div>
      } @else if (linkSent()) {
        <div class="auth-card">
          <div class="auth-sent" role="status">
            <span class="auth-sent__mark" aria-hidden="true"><ui-icon name="check" [size]="20" /></span>
            <h2>{{ t('auth.magicSent.title') }}</h2>
            <p [innerHTML]="t('auth.reset.sentBody', { email: email() })"></p>
            <a uiButton variant="ghost" routerLink="/sign-in">{{ t('auth.signUp.backToSignIn') }}</a>
          </div>
        </div>
      } @else if (auth.isSignedIn()) {
        <!-- Recovery session: the user followed the emailed link. -->
        <div class="auth-card">
          <h1 class="auth-card__title">{{ t('auth.reset.newTitle') }}</h1>
          <p class="auth-card__sub">{{ t('auth.reset.newSubtitle') }}</p>

          <form class="auth-form" (ngSubmit)="savePassword()">
            <div class="auth-field">
              <label class="auth-field__label" for="rp-password">{{ t('auth.reset.newPassword') }}</label>
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
                {{ t('auth.signUp.passwordHint', { min: minPasswordLength }) }}
              </p>
            </div>

            @if (error(); as message) {
              <p class="auth-error" role="alert"><ui-icon name="alert" [size]="15" />{{ message }}</p>
            }

            <button type="submit" uiButton class="auth-submit" [disabled]="!canSave()" [loading]="busy()">
              {{ t('auth.reset.submitNew') }}
            </button>
          </form>
        </div>
      } @else {
        <div class="auth-card">
          <h1 class="auth-card__title">{{ t('auth.reset.title') }}</h1>
          <p class="auth-card__sub">{{ t('auth.reset.subtitle') }}</p>

          <form class="auth-form" (ngSubmit)="sendLink()">
            <div class="auth-field">
              <label class="auth-field__label" for="rp-email">{{ t('common.email') }}</label>
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
              {{ t('auth.reset.submitLink') }}
            </button>
          </form>

          <p class="auth-alt">{{ t('auth.reset.remembered') }} <a routerLink="/sign-in">{{ t('auth.signIn.title') }}</a></p>
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
