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
    UiInputDirective,
    UiBadgeComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="fd">
      <a class="fd__back" routerLink="/admin/feedback">← All feedback</a>

      @if (loading()) {
        <ui-skeleton height="28px" [lines]="8" />
      } @else if (report(); as r) {
        <header class="fd__header">
          <div class="fd__badges">
            <ui-badge [tone]="tone(r.status)">{{ label(r.status) }}</ui-badge>
            <ui-badge>{{ r.kind }}</ui-badge>
            @if (r.rating) {
              <ui-badge>{{ r.rating }}/5</ui-badge>
            }
            @if (r.repliedAt) {
              <ui-badge tone="success">replied {{ r.repliedAt | relativeTime }}</ui-badge>
            }
          </div>
          <span class="fd__when">{{ r.createdAt | relativeTime }}</span>
        </header>

        <blockquote class="fd__message">{{ r.message }}</blockquote>

        <div class="fd__columns">
          <section class="fd__panel">
            <h2 class="fd__heading">Triage</h2>

            <label class="fd__label" for="fd-status">Status</label>
            <select uiInput id="fd-status" [ngModel]="r.status" (ngModelChange)="setStatus($event)" [disabled]="busy()">
              @for (s of statuses; track s) {
                <option [value]="s">{{ label(s) }}</option>
              }
            </select>

            <label class="fd__label" for="fd-assignee">Assigned to</label>
            <div class="fd__row">
              <span class="fd__assignee">{{ r.assigneeEmail ?? 'nobody' }}</span>
              @if (r.assigneeId !== myId()) {
                <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="assignToMe()">Take it</button>
              }
              @if (r.assigneeId) {
                <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="unassign()">Clear</button>
              }
            </div>

            <label class="fd__label" for="fd-note">Internal note</label>
            <textarea
              uiInput
              id="fd-note"
              class="fd__textarea"
              rows="3"
              placeholder="Only staff see this."
              [(ngModel)]="note"
              [disabled]="busy()"
            ></textarea>
            <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="saveNote()">Save note</button>
          </section>

          <section class="fd__panel">
            <h2 class="fd__heading">Sender</h2>
            <dl class="fd__facts">
              <div>
                <dt>From</dt>
                <dd>
                  @if (r.fromUserId) {
                    <a [routerLink]="['/admin/users', r.fromUserId]">{{ r.fromName || r.fromEmail }}</a>
                  } @else {
                    {{ r.fromEmail ?? 'anonymous' }}
                  }
                </dd>
              </div>
              @if (r.context?.appVersion) {
                <div><dt>Build</dt><dd>{{ r.context?.appVersion }}</dd></div>
              }
              @if (r.context?.route) {
                <div><dt>Page</dt><dd>{{ r.context?.route }}</dd></div>
              }
              @if (r.context?.userAgent) {
                <div><dt>Browser</dt><dd class="fd__ua">{{ r.context?.userAgent }}</dd></div>
              }
            </dl>
          </section>
        </div>

        <section class="fd__panel">
          <h2 class="fd__heading">Reply by email</h2>
          @if (r.replyable) {
            <p class="fd__hint">
              Goes to {{ r.fromEmail }}. Replies come back to you, not to a no-reply address.
            </p>
            <textarea
              uiInput
              id="fd-reply"
              class="fd__textarea"
              rows="6"
              placeholder="Write back in your own words."
              [(ngModel)]="replyBody"
              [disabled]="busy()"
            ></textarea>
            <button uiButton variant="primary" [disabled]="busy() || !canSend()" (click)="sendReply()">
              Send reply
            </button>
          } @else {
            <p class="fd__hint">
              This was sent anonymously with no email address, so there is nobody to answer.
            </p>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .fd {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 900px;
      }
      .fd__back {
        color: var(--ui-text-dim);
        text-decoration: none;
        font-size: var(--ui-text-sm);
        width: fit-content;
      }
      .fd__back:hover {
        color: var(--ui-text);
      }
      .fd__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ui-space-3);
        flex-wrap: wrap;
      }
      .fd__badges {
        display: flex;
        gap: var(--ui-space-1);
        flex-wrap: wrap;
      }
      .fd__when,
      .fd__hint,
      .fd__assignee {
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .fd__message {
        margin: 0;
        padding: var(--ui-space-4);
        border-left: 3px solid var(--ui-accent);
        background: var(--ui-surface);
        white-space: pre-wrap;
        line-height: 1.6;
      }
      .fd__columns {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--ui-space-3);
      }
      .fd__panel {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-2);
        align-items: flex-start;
        padding: var(--ui-space-4);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
      }
      .fd__heading {
        margin: 0 0 var(--ui-space-1);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .fd__label {
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
        margin-top: var(--ui-space-2);
      }
      .fd__row {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
      }
      .fd__textarea {
        width: 100%;
        resize: vertical;
        font-family: inherit;
      }
      .fd__facts {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-2);
        width: 100%;
      }
      .fd__facts dt {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .fd__facts dd {
        margin: 2px 0 0;
        font-size: var(--ui-text-sm);
        word-break: break-word;
      }
      .fd__ua {
        font-size: 12px;
        color: var(--ui-text-dim);
      }
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
