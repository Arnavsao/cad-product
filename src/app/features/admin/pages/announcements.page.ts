import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminAnnouncementDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  RelativeTimePipe,
  UiBadgeComponent,
  UiButtonDirective,
  UiDialogService,
  UiEmptyStateComponent,
  UiInputDirective,
  UiSkeletonComponent,
} from '../../../shared/ui';

/**
 * Product messages: a banner for signed-in users, optionally a row in their
 * inbox.
 *
 * Writing and publishing are two steps on purpose. A draft can be composed,
 * read back and scheduled without going live, and publishing is the single
 * deliberate act that makes it visible — which matters most when the inbox
 * fan-out is on, because those rows cannot be recalled.
 */
@Component({
  selector: 'app-admin-announcements',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    UiInputDirective,
    UiButtonDirective,
    UiBadgeComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Announcements</h1>
        <p class="adm-lede">A banner for signed-in users, and optionally a row in their inbox. Nothing is shown until you publish it.</p>
      </div>
    </div>

    <div class="adm-grid-2">
      <div class="adm-stack adm-stack--lg">
        @if (loading()) {
          <ui-skeleton height="120px" radius="var(--ui-radius-lg)" [lines]="2" />
        } @else if (rows().length === 0) {
          <div class="adm-card adm-card--flush">
            <ui-empty-state icon="bell" heading="Nothing announced" description="Drafts and published notices appear here." />
          </div>
        } @else {
          @for (row of rows(); track row.id) {
            <article class="adm-card" [class.an__live]="row.live">
              <div class="adm-card__head">
                <span class="adm-row">
                  <span class="an__title">{{ row.title }}</span>
                  @if (row.live) { <ui-badge tone="success">live</ui-badge> }
                  @else if (row.publishedAt) { <ui-badge>ended</ui-badge> }
                  @else { <ui-badge tone="warning">draft</ui-badge> }
                  @if (row.pushToInbox) { <ui-badge tone="info">inbox</ui-badge> }
                </span>
                <span class="adm-muted">{{ row.createdAt | relativeTime }}</span>
              </div>
              <p class="an__body">{{ row.body }}</p>
              @if (canWrite()) {
                <div class="adm-actions">
                  @if (!row.publishedAt) {
                    <button uiButton variant="primary" size="sm" [disabled]="busy()" (click)="publish(row)">Publish</button>
                  }
                  <button uiButton variant="ghost" size="sm" class="adm-danger-text" [disabled]="busy()" (click)="remove(row)">Delete</button>
                </div>
              }
            </article>
          }
        }
      </div>

      @if (canWrite()) {
        <section class="adm-card an__compose">
          <p class="adm-kicker">New announcement</p>
          <div class="adm-field">
            <label class="adm-label" for="ann-title">Title</label>
            <input uiInput id="ann-title" placeholder="Short and specific" [(ngModel)]="title" [disabled]="busy()" />
          </div>
          <div class="adm-field">
            <label class="adm-label" for="ann-body">Message</label>
            <textarea uiInput id="ann-body" class="adm-textarea" rows="4" placeholder="What you want people to know." [(ngModel)]="body" [disabled]="busy()"></textarea>
          </div>
          <div class="adm-field">
            <label class="adm-label" for="ann-link">Link <span class="adm-muted">(optional)</span></label>
            <input uiInput id="ann-link" placeholder="https://" [(ngModel)]="linkUrl" [disabled]="busy()" />
          </div>
          <label class="adm-check">
            <input type="checkbox" id="ann-inbox" [(ngModel)]="pushToInbox" [disabled]="busy()" />
            Also put it in everyone's inbox when published
          </label>
          <p class="adm-muted">
            Saved as a draft.
            @if (pushToInbox) { Inbox messages cannot be recalled once published. }
          </p>
          <button uiButton variant="secondary" [disabled]="busy() || !canCreate()" (click)="create()">Save draft</button>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host { display: contents; }
      .an__title { font-weight: 600; color: var(--ui-text-strong); }
      .an__body { margin: 0; white-space: pre-wrap; line-height: var(--ui-leading); font-size: var(--ui-text-md); }
      .an__live { border-color: var(--ui-success); }
      .an__compose { align-content: start; justify-items: start; position: sticky; top: 0; }
      .an__compose .adm-field { width: 100%; }
      @media (max-width: 900px) { .an__compose { position: static; } }
    `,
  ],
})
export class AdminAnnouncementsPage {
  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(UiDialogService);
  private readonly me = inject(MeService);

  protected readonly rows = signal<AdminAnnouncementDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  protected title = '';
  protected body = '';
  protected linkUrl = '';
  protected pushToInbox = false;

  protected readonly canWrite = computed(() => {
    const role = this.me.me()?.user.platformRole;
    return role === 'admin' || role === 'owner';
  });

  constructor() {
    void this.load();
  }

  /** The server's own minimums, mirrored so the button explains itself. */
  protected canCreate(): boolean {
    return this.title.trim().length >= 3 && this.body.trim().length >= 3;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.api.listAnnouncements());
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.createAnnouncement({
        title: this.title.trim(),
        body: this.body.trim(),
        linkUrl: this.linkUrl.trim() || undefined,
        pushToInbox: this.pushToInbox,
      });
      this.title = '';
      this.body = '';
      this.linkUrl = '';
      this.pushToInbox = false;
      this.notify.success('Draft saved');
      await this.load();
    } catch {
      this.notify.error('Could not save that draft.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async publish(row: AdminAnnouncementDto): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Publish "${row.title}"?`,
      message: row.pushToInbox
        ? 'It goes live and lands in every active user’s inbox. Inbox messages cannot be recalled.'
        : 'It goes live for every signed-in user.',
      confirmLabel: 'Publish',
      danger: row.pushToInbox,
    });
    if (!ok) return;

    this.busy.set(true);
    try {
      const result = await this.api.publishAnnouncement(row.id);
      this.notify.success(result.notified ? `Published and notified ${result.notified} users` : 'Published');
      await this.load();
    } catch (error) {
      this.notify.error(
        (error as { code?: string })?.code === 'ALREADY_PUBLISHED'
          ? 'That one is already published.'
          : 'Could not publish it.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(row: AdminAnnouncementDto): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Delete "${row.title}"?`,
      message: row.publishedAt
        ? 'The banner disappears. Inbox messages already delivered stay where they are.'
        : 'This draft has never been shown to anyone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    this.busy.set(true);
    try {
      await this.api.deleteAnnouncement(row.id);
      this.notify.success('Deleted');
      await this.load();
    } catch {
      this.notify.error('Could not delete it.');
    } finally {
      this.busy.set(false);
    }
  }
}
