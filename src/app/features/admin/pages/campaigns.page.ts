import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminCampaignDto, AudiencePreviewDto, SuppressionDto } from '../../../core/api/admin.models';
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
  type UiBadgeTone,
} from '../../../shared/ui';

/**
 * Bulk email.
 *
 * The flow is deliberately slow: write, preview the audience, send yourself a
 * test, and only then send. A campaign reaches every customer at once and
 * cannot be recalled, so each step exists to make the irreversible one the
 * fourth thing you do rather than the first.
 */
@Component({
  selector: 'app-admin-campaigns',
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
    <div class="cmp">
      <section class="cmp__compose">
        <h2 class="cmp__heading">New campaign</h2>
        <input uiInput id="cmp-subject" placeholder="Subject" [(ngModel)]="subject" [disabled]="busy()" />
        <textarea
          uiInput
          id="cmp-body"
          class="cmp__textarea"
          rows="5"
          placeholder="Write it as you would an email. Blank lines become paragraphs."
          [(ngModel)]="body"
          [disabled]="busy()"
        ></textarea>
        <label class="cmp__check">
          <input type="checkbox" id="cmp-active" [(ngModel)]="onlyActive" [disabled]="busy()" />
          Only people seen in the last 30 days
        </label>
        <p class="cmp__hint">
          Everyone who has not unsubscribed. An unsubscribe footer is added automatically.
        </p>
        <button uiButton variant="primary" [disabled]="busy() || !canCreate()" (click)="create()">
          Save draft
        </button>
      </section>

      @if (loading()) {
        <ui-skeleton height="60px" [lines]="3" />
      } @else if (rows().length === 0) {
        <ui-empty-state heading="No campaigns" description="Drafts and sent campaigns appear here." />
      } @else {
        <div class="cmp__list">
          @for (row of rows(); track row.id) {
            <article class="cmp__item">
              <header class="cmp__itemHead">
                <span class="cmp__subject">{{ row.subject }}</span>
                <ui-badge [tone]="statusTone(row.status)">{{ row.status }}</ui-badge>
                @if (row.status !== 'draft') {
                  <span class="cmp__meta">{{ row.sent }} sent, {{ row.failed }} failed of {{ row.total }}</span>
                }
                <span class="cmp__when">{{ row.createdAt | relativeTime }}</span>
              </header>
              <p class="cmp__body">{{ row.bodyText }}</p>

              @if (row.status === 'draft') {
                @if (preview()[row.id]; as p) {
                  <p class="cmp__meta">
                    Reaches {{ p.recipients }}
                    {{ p.recipients === 1 ? 'person' : 'people' }}{{ p.suppressed ? ', skipping ' + p.suppressed + ' unsubscribed' : '' }}.
                    @if (p.sample.length) {
                      For example: {{ p.sample.join(', ') }}.
                    }
                  </p>
                }
                <div class="cmp__actions">
                  <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="doPreview(row)">
                    Preview audience
                  </button>
                  <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="test(row)">
                    Send me a test
                  </button>
                  @if (isOwner()) {
                    <button uiButton variant="danger" size="sm" [disabled]="busy()" (click)="send(row)">
                      Send to everyone
                    </button>
                  } @else {
                    <span class="cmp__meta">Sending needs the owner tier.</span>
                  }
                </div>
              }
            </article>
          }
        </div>
      }

      <section class="cmp__section">
        <h2 class="cmp__heading">Unsubscribed</h2>
        @if (suppressions().length === 0) {
          <p class="cmp__hint">Nobody has unsubscribed.</p>
        } @else {
          <ul class="cmp__suppressions">
            @for (row of suppressions(); track row.email) {
              <li>
                {{ row.email }}
                <ui-badge>{{ row.reason }}</ui-badge>
                <span class="cmp__meta">{{ row.createdAt | relativeTime }}</span>
                @if (isOwner()) {
                  <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="restore(row)">
                    Remove
                  </button>
                }
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .cmp {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 860px;
      }
      .cmp__compose,
      .cmp__item {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--ui-space-2);
        padding: var(--ui-space-4);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
      }
      .cmp__compose input[uiInput],
      .cmp__textarea {
        width: 100%;
      }
      .cmp__textarea {
        resize: vertical;
        font-family: inherit;
      }
      .cmp__heading {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .cmp__check {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        font-size: var(--ui-text-sm);
      }
      .cmp__check input {
        width: auto;
      }
      .cmp__hint,
      .cmp__meta,
      .cmp__when {
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
        margin: 0;
      }
      .cmp__list,
      .cmp__section {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-3);
      }
      .cmp__itemHead {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
        width: 100%;
      }
      .cmp__subject {
        font-weight: 600;
      }
      .cmp__when {
        margin-left: auto;
      }
      .cmp__body {
        margin: 0;
        white-space: pre-wrap;
        font-size: var(--ui-text-sm);
        line-height: 1.6;
      }
      .cmp__actions {
        display: flex;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
        align-items: center;
      }
      .cmp__suppressions {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-1);
        font-size: var(--ui-text-sm);
      }
      .cmp__suppressions li {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
      }
    `,
  ],
})
export class AdminCampaignsPage {
  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(UiDialogService);
  private readonly me = inject(MeService);

  protected readonly rows = signal<AdminCampaignDto[]>([]);
  protected readonly suppressions = signal<SuppressionDto[]>([]);
  protected readonly preview = signal<Record<string, AudiencePreviewDto>>({});
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  protected subject = '';
  protected body = '';
  protected onlyActive = false;

  protected readonly isOwner = computed(() => this.me.me()?.user.platformRole === 'owner');

  constructor() {
    void this.load();
  }

  /** Mirrors the server's minimums so the button explains itself. */
  protected canCreate(): boolean {
    return this.subject.trim().length >= 3 && this.body.trim().length >= 20;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [campaigns, suppressions] = await Promise.all([this.api.listCampaigns(), this.api.suppressions()]);
      this.rows.set(campaigns);
      this.suppressions.set(suppressions);
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.createCampaign({
        subject: this.subject.trim(),
        bodyText: this.body.trim(),
        onlyActive: this.onlyActive || undefined,
      });
      this.subject = '';
      this.body = '';
      this.onlyActive = false;
      this.notify.success('Draft saved');
      await this.load();
    } catch {
      this.notify.error('Could not save that draft.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async doPreview(row: AdminCampaignDto): Promise<void> {
    this.busy.set(true);
    try {
      const result = await this.api.previewCampaign(row.id);
      this.preview.update((map) => ({ ...map, [row.id]: result }));
    } catch {
      this.notify.error('Could not work out the audience.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async test(row: AdminCampaignDto): Promise<void> {
    const to = this.me.me()?.user.email;
    if (!to) return;
    this.busy.set(true);
    try {
      await this.api.testSendCampaign(row.id, to);
      this.notify.success(`Test sent to ${to}`);
    } catch {
      this.notify.error('The test message did not send.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async send(row: AdminCampaignDto): Promise<void> {
    const audience = this.preview()[row.id];
    const ok = await this.dialog.confirm({
      title: `Send "${row.subject}"?`,
      message: audience
        ? `It goes to ${audience.recipients} people and cannot be recalled.`
        : 'It goes to every subscribed user and cannot be recalled. Preview the audience first.',
      confirmLabel: 'Send it',
      danger: true,
    });
    if (!ok) return;

    this.busy.set(true);
    try {
      await this.api.sendCampaign(row.id);
      // The send runs in the background, so the list shows it as `sending`
      // and the counts climb on refresh.
      this.notify.success('Sending started');
      await this.load();
    } catch (error) {
      this.notify.error(
        (error as { code?: string })?.code === 'CAMPAIGN_NOT_DRAFT'
          ? 'That campaign has already been sent.'
          : 'Could not start the send.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async restore(row: SuppressionDto): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Resubscribe ${row.email}?`,
      message: 'Only do this if they have asked to start receiving product email again.',
      confirmLabel: 'Remove from the list',
    });
    if (!ok) return;

    this.busy.set(true);
    try {
      await this.api.unsuppress(row.email);
      await this.load();
    } catch {
      this.notify.error('Could not update the list.');
    } finally {
      this.busy.set(false);
    }
  }

  protected statusTone(status: string): UiBadgeTone {
    if (status === 'sent') return 'success';
    if (status === 'sending') return 'info';
    return status === 'failed' ? 'danger' : 'neutral';
  }
}
