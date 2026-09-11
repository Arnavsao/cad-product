import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { Router } from '@angular/router';
import { ACCOUNT_URL, SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from './button.directive';
import { UiMenuTriggerDirective } from './menu/ui-menu-trigger.directive';
import type { UiMenuItem } from './menu/ui-menu.component';
import { UiSkeletonComponent } from './skeleton.component';

/** Menu entries with `label` holding the translation key; resolved per language in `menu`. */
const MENU: UiMenuItem[] = [
  { id: 'profile', label: 'shared.account.personalInfo', icon: 'user' },
  { id: 'account', label: 'shared.account.accountSettings', icon: 'settings' },
  { id: 'sep', label: '', separator: true },
  { id: 'sign-out', label: 'shared.account.signOut', icon: 'log-out', danger: true },
];

/**
 * Avatar button with an account menu.
 *
 * Renders nothing in embedded mode, a circular skeleton while the session
 * resolves, and stays empty if auth failed to load — deliberately: the auth pages
 * surface that error, and a header widget should not.
 *
 * The avatar comes from `user_metadata.avatar_url` when a provider supplied one,
 * otherwise initials, so there is never a broken image.
 */
@Component({
  selector: 'app-account-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiMenuTriggerDirective, UiSkeletonComponent],
  template: `
    @if (auth.enabled()) {
      @if (!auth.isLoaded()) {
        <ui-skeleton width="32px" height="32px" circle />
      } @else if (auth.isSignedIn()) {
        <button
          type="button"
          uiButton
          variant="ghost"
          size="sm"
          iconOnly
          class="acct__trigger"
          [title]="label()"
          [attr.aria-label]="label()"
          [uiMenuTrigger]="menu()"
          menuAlign="end"
          (uiMenuSelect)="onSelect($event.id)"
        >
          @if (avatarUrl(); as url) {
            <img class="acct__avatar" [src]="url" alt="" width="28" height="28" />
          } @else {
            <span class="acct__avatar acct__avatar--fallback" aria-hidden="true">{{ initials() }}</span>
          }
        </button>
      }
    }
  `,
  styles: [
    `
      :host { display: inline-flex; align-items: center; min-width: 32px; min-height: 32px; }
      .acct__trigger { padding: 2px; border-radius: var(--ui-radius-full); }
      .acct__avatar {
        display: block;
        width: 28px;
        height: 28px;
        border-radius: var(--ui-radius-full);
        object-fit: cover;
      }
      .acct__avatar--fallback {
        display: grid;
        place-items: center;
        background: var(--ui-accent);
        color: var(--ui-on-accent);
        font-size: var(--ui-text-xs);
        font-weight: 600;
      }
    `,
  ],
})
export class AccountButtonComponent {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  /** Re-resolved when the language changes, so an open-then-reopened menu follows the UI language. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  protected readonly menu = computed<UiMenuItem[]>(() => {
    this.lang();
    return MENU.map((item) => (item.label ? { ...item, label: this.transloco.translate(item.label) } : item));
  });

  protected readonly avatarUrl = computed(() => this.auth.userAvatarUrl());

  protected readonly label = computed(() => {
    this.lang();
    const name = `${this.auth.userFirstName()} ${this.auth.userLastName()}`.trim();
    return this.transloco.translate('shared.account.label', {
      name: name || this.auth.userEmail() || this.transloco.translate('shared.account.signedIn'),
    });
  });

  protected readonly initials = computed(() => {
    const first = this.auth.userFirstName();
    const last = this.auth.userLastName();
    const letters = `${first.charAt(0)}${last.charAt(0)}`.trim();
    return (letters || this.auth.userEmail().charAt(0) || '?').toUpperCase();
  });

  protected onSelect(id: string): void {
    switch (id) {
      case 'profile':
        void this.router.navigateByUrl('/dashboard/profile');
        return;
      case 'account':
        void this.router.navigateByUrl(ACCOUNT_URL);
        return;
      case 'sign-out':
        void this.auth.signOut();
        return;
      default:
        return;
    }
  }
}
