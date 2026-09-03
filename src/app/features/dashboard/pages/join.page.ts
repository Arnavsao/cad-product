import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OrganizationsApiService } from '../../../core/api/organizations-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { DashboardEventsService } from '../data/dashboard-events.service';

/**
 * `/join/:token` — redeems a copied invite link.
 *
 * Design decisions:
 *
 * - **It acts immediately rather than asking.** The user already opted in by
 *   following a link they were sent; a second "Join?" button would only add a
 *   click. What it does need is a visible outcome, hence the three states.
 *
 * - **Already a member is a success, not an error.** A link forwarded twice, or
 *   opened after joining by code, lands here with 409 `ALREADY_MEMBER`; the
 *   only sensible response is to carry on to the dashboard. Which organization
 *   the token named is not in that response, so the workspace list is refreshed
 *   and the user keeps whichever workspace they were last in.
 *
 * - **Behind `authGuard`.** A signed-out recipient is sent to
 *   `/sign-in?redirect_url=/join/<token>` and lands back here afterwards, which
 *   is why the guard's existing `redirect_url` handling matters for this route.
 */
@Component({
  selector: 'app-join-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiIconComponent, UiSkeletonComponent],
  template: `
    <main class="jn">
      <section class="jn__card">
        @if (state() === 'joining') {
          <h1 class="jn__title">Joining…</h1>
          <ui-skeleton [lines]="2" height="16px" />
        } @else if (state() === 'error') {
          <div class="jn__mark jn__mark--bad" aria-hidden="true"><ui-icon name="alert" [size]="22" /></div>
          <h1 class="jn__title">This invitation cannot be used</h1>
          <p class="jn__text">{{ error() }}</p>
          <a uiButton variant="primary" routerLink="/dashboard">Go to dashboard</a>
        } @else {
          <div class="jn__mark" aria-hidden="true"><ui-icon name="check" [size]="22" /></div>
          <h1 class="jn__title">You're in</h1>
          <p class="jn__text">Taking you to the dashboard…</p>
          <a uiButton variant="primary" routerLink="/dashboard/drawings">Go to My Drawings</a>
        }
      </section>
    </main>
  `,
  styles: [
    `
      :host { display: block; }
      .jn { display: grid; place-items: center; min-height: 100vh; padding: var(--ui-space-6); background: var(--ui-bg); }
      .jn__card {
        width: 100%; max-width: 420px; text-align: center;
        padding: var(--ui-space-8) var(--ui-space-6);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl);
        background: var(--ui-surface);
      }
      .jn__mark {
        display: grid; place-items: center; width: 48px; height: 48px; margin: 0 auto var(--ui-space-4);
        border-radius: var(--ui-radius-full);
        background: var(--ui-accent-tint); color: var(--ui-accent);
      }
      .jn__mark--bad { background: var(--ui-danger-tint); color: var(--ui-danger); }
      .jn__title { margin: 0 0 var(--ui-space-2); font-size: var(--ui-text-xl); font-weight: 600; color: var(--ui-text-strong); }
      .jn__text { margin: 0 0 var(--ui-space-5); font-size: var(--ui-text-md); line-height: var(--ui-leading); color: var(--ui-text-dim); }
    `,
  ],
})
export class JoinPage {
  /** From `/join/:token`, delivered by `withComponentInputBinding()`. */
  readonly token = input<string | undefined>();

  private readonly api = inject(OrganizationsApiService);
  private readonly workspace = inject(WorkspaceService);
  private readonly notify = inject(NotificationService);
  private readonly events = inject(DashboardEventsService);
  private readonly router = inject(Router);

  protected readonly state = signal<'joining' | 'joined' | 'error'>('joining');
  protected readonly error = signal('');

  constructor() {
    void this.join();
  }

  private async join(): Promise<void> {
    const token = (this.token() ?? '').trim();
    if (!token) {
      this.state.set('error');
      this.error.set('The link is missing its invitation code.');
      return;
    }

    try {
      const org = await this.api.join({ token });
      this.workspace.adopt(org);
      this.state.set('joined');
      this.notify.success(`You joined "${org.name}".`);
      this.events.bump();
      await this.router.navigateByUrl('/dashboard/drawings');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_MEMBER') {
        await this.workspace.refresh().catch(() => undefined);
        this.state.set('joined');
        this.notify.info('You are already a member of that organization.');
        await this.router.navigateByUrl('/dashboard/drawings');
        return;
      }
      this.state.set('error');
      this.error.set(
        e instanceof ApiError && e.status === 404
          ? 'The invitation has expired, was revoked, or was addressed to a different email address.'
          : e instanceof Error && e.message
            ? e.message
            : 'The invitation could not be redeemed.',
      );
    }
  }
}
