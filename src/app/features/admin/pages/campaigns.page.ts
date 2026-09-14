import { DecimalPipe } from '@angular/common';
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
  UiIconComponent,
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
    DecimalPipe,
    FormsModule,
    UiIconComponent,
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
        <h1 class="adm-title">Campaigns</h1>
        <p class="adm-lede">Bulk email. Write it, preview who it reaches, send yourself a test, and only then send — the irreversible step is deliberately fourth.</p>
      </div>
    </div>

    <div class="adm-grid-2">
      <div class="adm-stack adm-stack--lg">
        @if (loading()) {
          <ui-skeleton height="120px" radius="var(--ui-radius-lg)" [lines]="2" />
        } @else if (rows().length === 0) {
          <div class="adm-card adm-card--flush">
            <ui-empty-state icon="mail" heading="No campaigns" description="Drafts and sent campaigns appear here." />
          </div>
        } @else {
          @for (row of rows(); track row.id) {
            <article class="adm-card">
              <div class="adm-card__head">
                <span class="adm-row">
                  <span class="cp__subject">{{ row.subject }}</span>
                  <ui-badge [tone]="statusTone(row.status)">{{ row.status }}</ui-badge>
                </span>
                <span class="adm-muted">{{ row.createdAt | relativeTime }}</span>
              </div>
              <p class="cp__body">{{ row.bodyText }}</p>

              @if (row.status !== 'draft') {
                <dl class="adm-facts cp__facts">
                  <div><dt>Audience</dt><dd>{{ row.total | number }}</dd></div>
                  <div><dt>Sent</dt><dd class="adm-success-text">{{ row.sent | number }}</dd></div>
                  <div><dt>Failed</dt><dd [class.adm-danger-text]="row.failed > 0">{{ row.failed | number }}</dd></div>
                  @if (row.finishedAt) { <div><dt>Finished</dt><dd>{{ row.finishedAt | relativeTime }}</dd></div> }
                </dl>
              } @else {
                @if (preview()[row.id]; as p) {
                  <div class="adm-note adm-note--accent">
                    <ui-icon name="users" [size]="18" />
                    <div>
                      <p class="adm-note__title">Reaches {{ p.recipients | number }} {{ p.recipients === 1 ? 'person' : 'people' }}{{ p.suppressed ? ', skipping ' + p.suppressed + ' unsubscribed' : '' }}.</p>
                      @if (p.sample.length) { <p class="adm-note__msg">For example: {{ p.sample.join(', ') }}</p> }
                    </div>
                  </div>
                }
                <div class="adm-actions">
                  <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="doPreview(row)">Preview audience</button>
                  <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="test(row)">Send me a test</button>
                  @if (isOwner()) {
                    <button uiButton variant="danger" size="sm" [disabled]="busy()" (click)="send(row)">Send to everyone</button>
                  } @else {
                    <span class="adm-muted">Sending needs the owner tier.</span>
                  }
                </div>
              }
            </article>
          }
        }

        <section class="adm-table adm-card--flush">
          <div class="adm-card__bar">
            <p class="adm-kicker">Unsubscribed</p>
            <span class="adm-muted">{{ suppressions().length }}</span>
          </div>
          @if (suppressions().length === 0) {
            <p class="adm-muted" style="padding: var(--ui-space-4)">Nobody has unsubscribed.</p>
          } @else {
            @for (row of suppressions(); track row.email) {
              <div class="adm-list__row">
                <span class="adm-grow adm-truncate">{{ row.email }}</span>
                <ui-badge>{{ row.reason }}</ui-badge>
                <span class="adm-muted">{{ row.createdAt | relativeTime }}</span>
                @if (isOwner()) {
                  <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="restore(row)">Remove</button>
                }
              </div>
            }
          }
        </section>
      </div>

      <section class="adm-card cp__compose">
        <p class="adm-kicker">New campaign</p>
        <div class="adm-field">
          <label class="adm-label" for="cmp-subject">Subject</label>
          <input uiInput id="cmp-subject" [(ngModel)]="subject" [disabled]="busy()" />
        </div>
        <div class="adm-field">
          <label class="adm-label" for="cmp-body">Message</label>
          <textarea uiInput id="cmp-body" class="adm-textarea" rows="7" placeholder="Write it as you would an email. Blank lines become paragraphs." [(ngModel)]="body" [disabled]="busy()"></textarea>
        </div>
        <label class="adm-check">
          <input type="checkbox" id="cmp-active" [(ngModel)]="onlyActive" [disabled]="busy()" />
          Only people seen in the last 30 days
        </label>
        <p class="adm-muted">Goes to everyone who has not unsubscribed. An unsubscribe footer is added automatically.</p>
        <button uiButton variant="secondary" [disabled]="busy() || !canCreate()" (click)="create()">Save draft</button>
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: contents; }
      .cp__subject { font-weight: 600; color: var(--ui-text-strong); }
      .cp__body { margin: 0; white-space: pre-wrap; line-height: var(--ui-leading); font-size: var(--ui-text-md); }
      .cp__facts { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
      .cp__compose { align-content: start; justify-items: start; position: sticky; top: 0; }
      .cp__compose .adm-field { width: 100%; }
      @media (max-width: 900px) { .cp__compose { position: static; } }
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
