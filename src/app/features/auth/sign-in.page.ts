import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AFTER_SIGN_IN_URL, SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiInputDirective } from '../../shared/ui/input.directive';
import { AuthLayoutComponent } from './auth-layout.component';
import { OAuthButtonsComponent } from './oauth-buttons.component';

/**
 * `/sign-in` — email + password, magic link, or an OAuth provider.
 *
 * Design decisions:
 *  - **Password and magic link share one email field.** Toggling between them
 *    keeps whatever was typed, because being asked to retype your address is the
 *    fastest way to make someone give up.
 *  - **`?redirect_url=` is honoured**, so the `authGuard` bounce returns the user
 *    to the page they actually wanted. It is also handed to the OAuth buttons,
 *    since nothing of ours survives a provider round trip otherwise.
 *  - **Navigation is explicit, not reactive.** Waiting for `isSignedIn()` to flip
 *    and redirecting from an effect would also fire on a session restored in
 *    another tab; routing straight after a successful call keeps cause and effect
 *    together.
 */
@Component({
  selector: 'app-sign-in',
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
  templateUrl: './sign-in.page.html',
  styleUrl: './auth-page.scss',
})
export class SignInPage {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Passwordless mode: hides the password field and emails a link instead. */
  protected readonly magicMode = signal(false);
  protected readonly linkSent = signal(false);

  /** Where to go after signing in — the guard puts the blocked URL here. */
  protected readonly redirectUrl = computed(
    () => this.route.snapshot.queryParamMap.get('redirect_url') ?? AFTER_SIGN_IN_URL,
  );

  protected readonly canSubmit = computed(() => {
    if (this.busy() || !this.email().trim()) {
      return false;
    }
    return this.magicMode() || this.password().length > 0;
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected toggleMagic(): void {
    this.error.set(null);
    this.magicMode.update((on) => !on);
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    const result = this.magicMode()
      ? await this.auth.signInWithMagicLink(this.email())
      : await this.auth.signInWithPassword(this.email(), this.password());

    this.busy.set(false);

    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
    if (result.emailSent) {
      this.linkSent.set(true);
      return;
    }
    await this.router.navigateByUrl(this.redirectUrl());
  }

  /** A failed SDK load is only recoverable by a fresh page load. */
  protected retry(): void {
    location.reload();
  }
}
