import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective, UiGridBackdropComponent, UiLogoComponent } from '../../shared/ui';

/**
 * Where a suspended account, or someone who signed up while registration was
 * closed, ends up.
 *
 * A dedicated page rather than a toast: both states are permanent until a human
 * does something, and every other route would answer 403 anyway — without this,
 * the app would either loop through sign-in or show an empty dashboard with a
 * red banner, neither of which tells the person what happened or what to do.
 */
@Component({
  selector: 'app-account-blocked',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiGridBackdropComponent, UiLogoComponent],
  template: `
    <ui-grid-backdrop />
    <main class="blocked">
      <ui-logo [size]="40" />
      <h1 class="blocked__title">{{ title() }}</h1>
      <p class="blocked__body">{{ body() }}</p>
      @if (reason(); as r) {
        <p class="blocked__reason">{{ r }}</p>
      }
      <div class="blocked__actions">
        <a uiButton variant="secondary" href="mailto:support@cado.website">Contact support</a>
        <button uiButton variant="ghost" (click)="signOut()">Sign out</button>
      </div>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: var(--ui-bg);
        color: var(--ui-text);
      }
      .blocked {
        position: relative;
        z-index: 1;
        max-width: 32rem;
        margin: 0 auto;
        padding-block: 18vh var(--ui-space-6);
        padding-inline: var(--ui-space-5);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--ui-space-3);
        text-align: left;
      }
      .blocked__title {
        margin: var(--ui-space-2) 0 0;
        font-size: 26px;
        text-wrap: balance;
      }
      .blocked__body,
      .blocked__reason {
        margin: 0;
        color: var(--ui-text-dim);
        line-height: 1.6;
      }
      .blocked__reason {
        padding: var(--ui-space-3);
        border-left: 3px solid var(--ui-warning, #d29922);
        background: var(--ui-surface);
        color: var(--ui-text);
      }
      .blocked__actions {
        display: flex;
        gap: var(--ui-space-2);
        margin-top: var(--ui-space-2);
        flex-wrap: wrap;
      }
    `,
  ],
})
export class AccountBlockedPage {
  private readonly auth = inject(SupabaseAuthService);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: null });

  /** `suspended` (the default) or `closed`. */
  private readonly kind = computed(() => this.params()?.get('kind') ?? 'suspended');

  protected readonly reason = computed(() => this.params()?.get('reason'));

  protected readonly title = computed(() =>
    this.kind() === 'closed' ? 'CADO is not taking new accounts' : 'This account is suspended',
  );

  protected readonly body = computed(() =>
    this.kind() === 'closed'
      ? 'Sign-ups are paused while we work through the current beta group. Your email is not on a list, so check back or write to us and we will let you know when they reopen.'
      : 'You cannot sign in or open drawings while the suspension is in place. If you think this is a mistake, reply to the email we sent or contact support and we will look again.',
  );

  protected signOut(): void {
    void this.auth.signOut();
  }
}
