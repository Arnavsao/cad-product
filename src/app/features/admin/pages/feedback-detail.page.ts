import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminFeedbackDetailDto, FeedbackStatus } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  RelativeTimePipe,
  UiBadgeComponent,
  UiButtonDirective,
  UiIconComponent,
  UiInputDirective,
  UiSkeletonComponent,
} from '../../../shared/ui';
import { statusLabel, statusTone } from './feedback.page';

const STATUSES: FeedbackStatus[] = ['new', 'triaged', 'in_progress', 'resolved', 'wont_fix'];

/**
 * One report, and everything needed to close it.
 *
 * The layout puts the message first and the diagnostics beside it, because
 * triage is reading what somebody wrote and then deciding — not filling in a
 * form. Status, assignment and the internal note each save on their own, so two
 * people working the queue cannot overwrite each other's field.
 */
@Component({
  selector: 'app-admin-feedback-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    UiButtonDirective,
    UiIconComponent,
    UiInputDirective,
    UiBadgeComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
  ],
  template: `
    <a class="adm-back" routerLink="/admin/feedback"><ui-icon name="back" [size]="14" /> All feedback</a>

    @if (loading()) {
      <ui-skeleton height="28px" [lines]="8" />
    } @else if (report(); as r) {
      <div class="adm-head">
        <div class="adm-row">
          <ui-badge [tone]="tone(r.status)">{{ label(r.status) }}</ui-badge>
          <ui-badge>{{ r.kind }}</ui-badge>
          @if (r.rating) { <ui-badge>{{ r.rating }}/5</ui-badge> }
          @if (r.repliedAt) { <ui-badge tone="success">replied {{ r.repliedAt | relativeTime }}</ui-badge> }
        </div>
        <span class="adm-muted">received {{ r.createdAt | relativeTime }}</span>
      </div>

      <blockquote class="fd__message">{{ r.message }}</blockquote>

      <div class="adm-grid-2">
        <div class="adm-stack adm-stack--lg">
          <section class="adm-card">
            <p class="adm-kicker">Reply by email</p>
            @if (r.replyable) {
              <p class="adm-muted">Goes to {{ r.fromEmail }}. Replies come back to you, not to a no-reply address.</p>
              <textarea uiInput id="fd-reply" class="adm-textarea" rows="7" placeholder="Write back in your own words." [(ngModel)]="replyBody" [disabled]="busy()"></textarea>
              <div class="adm-actions">
                <button uiButton variant="primary" [disabled]="busy() || !canSend()" (click)="sendReply()">Send reply</button>
                @if (!canSend() && replyBody.trim().length > 0) { <span class="adm-muted">At least 10 characters.</span> }
              </div>
            } @else {
              <div class="adm-note">
                <ui-icon name="mail" [size]="18" />
                <div><p class="adm-note__title">No address to answer.</p><p class="adm-note__msg">This was sent anonymously with no email address.</p></div>
              </div>
            }
          </section>

          <section class="adm-card">
            <p class="adm-kicker">Internal note</p>
            <textarea uiInput id="fd-note" class="adm-textarea" rows="3" placeholder="Only staff see this." [(ngModel)]="note" [disabled]="busy()"></textarea>
            <div><button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="saveNote()">Save note</button></div>
          </section>
        </div>

        <div class="adm-stack adm-stack--lg">
          <section class="adm-card">
            <p class="adm-kicker">Triage</p>
            <div class="adm-field">
              <label class="adm-label" for="fd-status">Status</label>
              <select uiInput id="fd-status" [ngModel]="r.status" (ngModelChange)="setStatus($event)" [disabled]="busy()">
                @for (s of statuses; track s) { <option [value]="s">{{ label(s) }}</option> }
              </select>
            </div>
            <div class="adm-field">
              <span class="adm-label">Assigned to</span>
              <div class="adm-row">
                <span>{{ r.assigneeEmail ?? 'nobody' }}</span>
                @if (r.assigneeId !== myId()) { <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="assignToMe()">Take it</button> }
                @if (r.assigneeId) { <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="unassign()">Clear</button> }
              </div>
            </div>
          </section>

          <section class="adm-card">
            <p class="adm-kicker">Sender</p>
            <dl class="adm-facts fd__facts">
              <div>
                <dt>From</dt>
                <dd>
                  @if (r.fromUserId) { <a class="adm-link" [routerLink]="['/admin/users', r.fromUserId]">{{ r.fromName || r.fromEmail }}</a> }
                  @else { {{ r.fromEmail ?? 'anonymous' }} }
                </dd>
              </div>
              @if (r.context?.appVersion) { <div><dt>Build</dt><dd class="adm-mono">{{ r.context?.appVersion }}</dd></div> }
              @if (r.context?.route) { <div><dt>Page</dt><dd class="adm-mono">{{ r.context?.route }}</dd></div> }
              @if (r.context?.userAgent) { <div><dt>Browser</dt><dd class="adm-muted">{{ r.context?.userAgent }}</dd></div> }
            </dl>
          </section>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .fd__message {
        margin: 0; padding: var(--ui-space-5);
        border: 1px solid var(--ui-border); border-left: 3px solid var(--ui-accent); border-radius: var(--ui-radius-lg);
        background: var(--ui-surface); color: var(--ui-text-strong);
        white-space: pre-wrap; line-height: var(--ui-leading); font-size: var(--ui-text-base);
      }
      .fd__facts { grid-template-columns: 1fr; gap: var(--ui-space-3); }
    `,
  ],
})
export class AdminFeedbackDetailPage {
  readonly id = input.required<string>();

  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly me = inject(MeService);

  protected readonly statuses = STATUSES;
  protected readonly tone = statusTone;
  protected readonly label = statusLabel;

  protected readonly report = signal<AdminFeedbackDetailDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  protected note = '';
  protected replyBody = '';

  protected readonly myId = computed(() => this.me.me()?.user.id ?? null);
  /** The server rejects anything under 10 characters; say so by disabling. */
  protected readonly canSend = computed(() => this.replyBody.trim().length >= 10);

  constructor() {
    // An effect, NOT a direct call: `id` is a required route input bound by
    // `withComponentInputBinding()`, which happens AFTER the constructor runs.
    // Reading it here directly throws NG0950 before the page ever paints.
    effect(() => {
      const id = this.id();
      void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const report = await this.api.getFeedback(id);
      this.report.set(report);
      this.note = report.internalNote ?? '';
    } catch (error) {
      this.notify.error((error as { message?: string })?.message ?? 'Could not load this report.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async setStatus(status: FeedbackStatus): Promise<void> {
    await this.patch({ status }, `Marked ${statusLabel(status)}`);
  }

  protected async assignToMe(): Promise<void> {
    await this.patch({ assigneeId: 'me' }, 'Assigned to you');
  }

  protected async unassign(): Promise<void> {
    await this.patch({ assigneeId: null }, 'Unassigned');
  }

  protected async saveNote(): Promise<void> {
    await this.patch({ internalNote: this.note }, 'Note saved');
  }

  private async patch(
    body: { status?: FeedbackStatus; assigneeId?: string | null; internalNote?: string },
    success: string,
  ): Promise<void> {
    this.busy.set(true);
    try {
      this.report.set(await this.api.updateFeedback(this.id(), body));
      this.notify.success(success);
    } catch (error) {
      this.notify.error((error as { message?: string })?.message ?? 'That did not save.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendReply(): Promise<void> {
    this.busy.set(true);
    try {
      this.report.set(await this.api.replyToFeedback(this.id(), this.replyBody.trim()));
      this.replyBody = '';
      this.notify.success('Reply sent');
    } catch (error) {
      const code = (error as { code?: string })?.code;
      this.notify.error(
        code === 'NO_REPLY_ADDRESS'
          ? 'That report has no email address to answer.'
          : code === 'REPLY_NOT_SENT'
            ? 'The email could not be sent. Nothing was recorded, so you can try again.'
            : 'The reply did not send.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
