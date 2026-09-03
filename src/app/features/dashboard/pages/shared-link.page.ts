import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SharedLinkDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';

/**
 * `/shared/:token` — the landing page of a share link.
 *
 * Design decisions:
 *
 * - **It shows what is behind the link before accepting it.** Accepting creates
 *   a durable share (that is the whole point: the drawing then appears under
 *   "Shared with me" forever), so it is a decision, not a redirect. The name,
 *   the owner and the permission are exactly the three facts needed to make it.
 *
 * - **DWG goes to the list, not the editor.** The editor cannot parse DWG yet,
 *   so accepting a DWG link lands on "Shared with me" with a toast rather than
 *   on a blank canvas.
 *
 * - **Behind `authGuard`.** A share becomes a share *for somebody*, which needs
 *   an account; a signed-out visitor is sent to sign-in with `redirect_url` and
 *   comes straight back here.
 */
@Component({
  selector: 'app-shared-link-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiIconComponent, UiSkeletonComponent],
  template: `
    <main class="sl">
      <section class="sl__card">
        @if (loading()) {
          <ui-skeleton [lines]="3" height="18px" />
        } @else if (error(); as message) {
          <div class="sl__mark sl__mark--bad" aria-hidden="true"><ui-icon name="alert" [size]="22" /></div>
          <h1 class="sl__title">This link no longer works</h1>
          <p class="sl__text">{{ message }}</p>
          <a uiButton variant="primary" routerLink="/dashboard">Go to dashboard</a>
        } @else if (link(); as shared) {
          <div class="sl__mark" aria-hidden="true"><ui-icon name="share" [size]="22" /></div>
          <h1 class="sl__title">{{ shared.drawing.name }}</h1>
          <p class="sl__text">
            {{ ownerName() }} shared this drawing with you. You can
            {{ shared.permission === 'edit' ? 'view and edit it' : 'view and download it' }}.
          </p>
          <div class="sl__actions">
            <button type="button" uiButton variant="primary" [loading]="accepting()" [disabled]="accepting()" (click)="accept()">
              {{ shared.drawing.format === 'dwg' ? 'Add to Shared with me' : 'Open drawing' }}
            </button>
            <a uiButton variant="ghost" routerLink="/dashboard">Not now</a>
          </div>
        }
      </section>
    </main>
  `,
  styles: [
    `
      :host { display: block; }
      .sl { display: grid; place-items: center; min-height: 100vh; padding: var(--ui-space-6); background: var(--ui-bg); }
      .sl__card {
        width: 100%; max-width: 440px; text-align: center;
        padding: var(--ui-space-8) var(--ui-space-6);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl);
        background: var(--ui-surface);
      }
      .sl__mark {
        display: grid; place-items: center; width: 48px; height: 48px; margin: 0 auto var(--ui-space-4);
        border-radius: var(--ui-radius-full);
        background: var(--ui-accent-tint); color: var(--ui-accent);
      }
      .sl__mark--bad { background: var(--ui-danger-tint); color: var(--ui-danger); }
      .sl__title {
        margin: 0 0 var(--ui-space-2); font-size: var(--ui-text-xl); font-weight: 600; color: var(--ui-text-strong);
        overflow-wrap: anywhere;
      }
      .sl__text { margin: 0 0 var(--ui-space-5); font-size: var(--ui-text-md); line-height: var(--ui-leading); color: var(--ui-text-dim); }
      .sl__actions { display: flex; justify-content: center; gap: var(--ui-space-2); flex-wrap: wrap; }
    `,
  ],
})
export class SharedLinkPage {
  /** From `/shared/:token`, delivered by `withComponentInputBinding()`. */
  readonly token = input<string | undefined>();

  private readonly api = inject(DrawingsApiService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly link = signal<SharedLinkDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly accepting = signal(false);

  protected readonly ownerName = computed(() => {
    const owner = this.link()?.owner;
    const full = [owner?.firstName, owner?.lastName].filter(Boolean).join(' ').trim();
    return full || 'Someone';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const token = (this.token() ?? '').trim();
    if (!token) {
      this.loading.set(false);
      this.error.set('The link is missing its share code.');
      return;
    }
    try {
      const shared = await this.api.sharedLink(token);
      if (shared.expired) {
        this.error.set('The link has expired. Ask whoever sent it for a new one.');
      } else {
        this.link.set(shared);
      }
    } catch (e) {
      this.error.set(
        e instanceof ApiError && e.status === 404
          ? 'The link was revoked or has expired. Ask whoever sent it for a new one.'
          : e instanceof Error && e.message
            ? e.message
            : 'The link could not be opened.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected async accept(): Promise<void> {
    const shared = this.link();
    const token = (this.token() ?? '').trim();
    if (!shared || !token || this.accepting()) return;

    this.accepting.set(true);
    try {
      const { drawingId } = await this.api.acceptSharedLink(token);
      if (shared.drawing.format === 'dwg') {
        this.notify.success(`"${shared.drawing.name}" is now under Shared with me. DWG cannot be opened in the editor yet.`);
        await this.router.navigateByUrl('/dashboard/shared');
        return;
      }
      await this.router.navigate(['/editor', drawingId]);
    } catch (e) {
      this.notify.error(e instanceof Error && e.message ? e.message : 'The drawing could not be opened.');
    } finally {
      this.accepting.set(false);
    }
  }
}
