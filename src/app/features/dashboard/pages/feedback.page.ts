import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { CreateFeedbackRequest, FeedbackKind } from '../../../core/api/api.models';
import { FeedbackApiService } from '../../../core/api/feedback-api.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { messageOf } from '../data/drawings-list.store';

/** Must match `MESSAGE_MAX_LENGTH` on the server, or the counter lies. */
const MESSAGE_MAX = 4000;
const MESSAGE_MIN = 4;

interface KindOption {
  id: FeedbackKind;
  label: string;
  hint: string;
  icon: 'alert' | 'sparkle' | 'help' | 'message';
}

const KINDS: readonly KindOption[] = [
  { id: 'bug', label: 'Bug', hint: 'Something is broken or behaves wrongly', icon: 'alert' },
  { id: 'idea', label: 'Idea', hint: 'A feature or improvement you would like', icon: 'sparkle' },
  { id: 'question', label: 'Question', hint: 'You could not work out how to do something', icon: 'help' },
  { id: 'other', label: 'Other', hint: 'Anything that does not fit the rest', icon: 'message' },
];

/**
 * `/dashboard/feedback` — send a bug report, idea or question.
 *
 * Design decisions:
 *  - **The rating is optional and unset by default.** A pre-selected star count
 *    would manufacture data the user never gave; the server stores null when the
 *    field is absent.
 *  - **Diagnostics are collected, not asked for.** Route, app version and user
 *    agent go along automatically — the things that make a report reproducible
 *    are exactly the things a user should not have to type.
 *  - **Success replaces the form rather than toasting.** Feedback is one-shot;
 *    leaving the filled-in form on screen invites an accidental double-send.
 */
@Component({
  selector: 'app-feedback-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiIconComponent, UiInputDirective],
  template: `
    <header class="pg__head">
      <h1 class="pg__title">Provide feedback</h1>
    </header>

    @if (sent()) {
      <section class="fb__done" role="status">
        <span class="fb__done-mark" aria-hidden="true"><ui-icon name="check" [size]="22" /></span>
        <h2 class="fb__done-title">Thanks — that came through.</h2>
        <p class="fb__done-msg">
          We read every report. If you left an email we may follow up; otherwise this goes straight onto the pile we
          work from.
        </p>
        <div class="fb__done-actions">
          <button type="button" uiButton variant="secondary" (click)="again()">Send another</button>
          <button type="button" uiButton (click)="goToDashboard()">Back to Recent</button>
        </div>
      </section>
    } @else {
      <p class="pg__subtitle">
        Tell us what is not working, or what you wish existed. Your current page and app version are attached
        automatically so we can reproduce it.
      </p>

      <section class="fb__section">
        <h2 class="fb__label" id="fb-kind">What kind of feedback is this?</h2>
        <div class="fb__kinds" role="radiogroup" aria-labelledby="fb-kind">
          @for (option of kinds; track option.id) {
            <button
              type="button"
              class="fb__kind"
              role="radio"
              [class.fb__kind--on]="kind() === option.id"
              [attr.aria-checked]="kind() === option.id"
              [title]="option.hint"
              (click)="kind.set(option.id)"
            >
              <ui-icon [name]="option.icon" [size]="16" />
              <span class="fb__kind-label">{{ option.label }}</span>
              <span class="fb__kind-hint">{{ option.hint }}</span>
            </button>
          }
        </div>
      </section>

      <section class="fb__section">
        <label class="fb__label" for="fb-message">Your feedback</label>
        <textarea
          uiInput
          id="fb-message"
          class="fb__message"
          rows="7"
          [attr.maxlength]="messageMax"
          [attr.aria-invalid]="showTooShort() ? 'true' : null"
          [placeholder]="placeholder()"
          [value]="message()"
          (input)="onMessage($event)"
        ></textarea>
        <div class="fb__meta">
          @if (showTooShort()) {
            <span class="fb__hint fb__hint--bad">Please add a little more detail.</span>
          } @else {
            <span class="fb__hint">Steps to reproduce are worth more than anything else you can write.</span>
          }
          <span class="fb__count" [class.fb__count--near]="remaining() < 200">{{ remaining() }}</span>
        </div>
      </section>

      <section class="fb__section">
        <span class="fb__label" id="fb-rating">How is CADO working out so far? <em>(optional)</em></span>
        <div class="fb__rating" role="radiogroup" aria-labelledby="fb-rating">
          @for (value of stars; track value) {
            <button
              type="button"
              class="fb__star"
              role="radio"
              [class.fb__star--on]="rating() !== null && value <= rating()!"
              [attr.aria-checked]="rating() === value"
              [attr.aria-label]="value + ' out of 5'"
              (click)="setRating(value)"
            >
              <ui-icon name="star" [size]="20" />
            </button>
          }
          @if (rating() !== null) {
            <button type="button" uiButton variant="ghost" size="sm" (click)="rating.set(null)">Clear</button>
          }
        </div>
      </section>

      @if (error(); as message) {
        <div class="pg__error" role="alert">
          <ui-icon name="alert" [size]="18" />
          <div>
            <p class="pg__error-title">That did not send.</p>
            <p class="pg__error-msg">{{ message }}</p>
          </div>
        </div>
      }

      <div class="fb__actions">
        <button type="button" uiButton [disabled]="!canSubmit()" [loading]="sending()" (click)="submit()">
          Send feedback
        </button>
        <span class="fb__hint">Goes to the product team, not a public forum.</span>
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pg__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ui-space-4); margin-bottom: var(--ui-space-2); flex-wrap: wrap; }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .pg__subtitle { margin: 0 0 var(--ui-space-6); font-size: var(--ui-text-md); color: var(--ui-text-dim); line-height: var(--ui-leading); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint); margin-bottom: var(--ui-space-4);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .fb__section { margin-bottom: var(--ui-space-6); }
      .fb__label {
        display: block; margin: 0 0 var(--ui-space-3);
        font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong);
      }
      .fb__label em { font-style: normal; font-weight: 400; color: var(--ui-text-dim); }

      .fb__kinds { display: grid; gap: var(--ui-space-3); grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      .fb__kind {
        display: grid; gap: 2px; justify-items: start; text-align: left;
        padding: 10px 12px;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg);
        background: var(--ui-surface); color: var(--ui-text); cursor: pointer;
        transition: border-color var(--ui-dur-fast), background var(--ui-dur-fast);
      }
      .fb__kind:hover { border-color: var(--ui-border-strong); background: var(--ui-hover); }
      .fb__kind:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .fb__kind--on { border-color: var(--ui-accent); background: var(--ui-accent-tint); }
      .fb__kind--on ui-icon { color: var(--ui-accent); }
      .fb__kind-label { font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .fb__kind-hint { font-size: var(--ui-text-xs); color: var(--ui-text-dim); line-height: 1.35; }

      .fb__message { width: 100%; resize: vertical; min-height: 140px; font-family: inherit; line-height: var(--ui-leading); }
      .fb__meta { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ui-space-3); margin-top: 6px; }
      .fb__hint { font-size: var(--ui-text-xs); color: var(--ui-text-dim); }
      .fb__hint--bad { color: var(--ui-danger); }
      .fb__count { font-size: var(--ui-text-xs); font-family: var(--ui-font-mono); color: var(--ui-text-dim); }
      .fb__count--near { color: var(--ui-warning); }

      .fb__rating { display: flex; align-items: center; gap: 2px; }
      .fb__star {
        display: inline-flex; padding: 4px; border: 0; background: none; cursor: pointer;
        color: var(--ui-text-placeholder); border-radius: var(--ui-radius-sm);
        transition: color var(--ui-dur-fast);
      }
      .fb__star:hover { color: var(--ui-warning); }
      .fb__star:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
      .fb__star--on { color: var(--ui-warning); }

      .fb__actions { display: flex; align-items: center; gap: var(--ui-space-4); flex-wrap: wrap; }

      .fb__done {
        display: grid; justify-items: center; text-align: center; gap: var(--ui-space-3);
        padding: var(--ui-space-10) var(--ui-space-6);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl); background: var(--ui-surface);
      }
      .fb__done-mark {
        display: grid; place-items: center; width: 44px; height: 44px;
        border-radius: var(--ui-radius-full); background: var(--ui-success-tint); color: var(--ui-success);
      }
      .fb__done-title { margin: 0; font-size: var(--ui-text-lg); font-weight: 600; color: var(--ui-text-strong); }
      .fb__done-msg { margin: 0; max-width: 46ch; font-size: var(--ui-text-md); color: var(--ui-text-dim); line-height: var(--ui-leading); }
      .fb__done-actions { display: flex; gap: var(--ui-space-3); margin-top: var(--ui-space-2); flex-wrap: wrap; justify-content: center; }
    `,
  ],
})
export class FeedbackPage {
  private readonly api = inject(FeedbackApiService);
  private readonly router = inject(Router);

  protected readonly kinds = KINDS;
  protected readonly stars = [1, 2, 3, 4, 5] as const;
  protected readonly messageMax = MESSAGE_MAX;

  protected readonly kind = signal<FeedbackKind>('bug');
  protected readonly message = signal('');
  protected readonly rating = signal<number | null>(null);
  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Only nag about length once they have actually typed something. */
  private readonly touched = signal(false);

  protected readonly remaining = computed(() => MESSAGE_MAX - this.message().length);
  protected readonly trimmed = computed(() => this.message().trim());
  protected readonly showTooShort = computed(() => this.touched() && this.trimmed().length > 0 && this.trimmed().length < MESSAGE_MIN);
  protected readonly canSubmit = computed(() => !this.sending() && this.trimmed().length >= MESSAGE_MIN);

  protected readonly placeholder = computed(() => {
    switch (this.kind()) {
      case 'bug':
        return 'What did you do, what did you expect, and what happened instead?';
      case 'idea':
        return 'What would you like to be able to do, and what are you doing today instead?';
      case 'question':
        return 'What were you trying to do when you got stuck?';
      default:
        return 'Anything you want us to know.';
    }
  });

  protected onMessage(event: Event): void {
    this.touched.set(true);
    this.message.set((event.target as HTMLTextAreaElement).value);
  }

  /** Clicking the selected star clears it, so a rating is never a one-way door. */
  protected setRating(value: number): void {
    this.rating.set(this.rating() === value ? null : value);
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.sending.set(true);
    this.error.set(null);

    const request: CreateFeedbackRequest = {
      kind: this.kind(),
      message: this.trimmed(),
      ...(this.rating() !== null ? { rating: this.rating()! } : {}),
      context: {
        route: this.router.url,
        appVersion: environment.appName,
        userAgent: navigator.userAgent,
      },
    };

    try {
      await this.api.submit(request);
      this.sent.set(true);
    } catch (e) {
      this.error.set(messageOf(e));
    } finally {
      this.sending.set(false);
    }
  }

  protected again(): void {
    this.message.set('');
    this.rating.set(null);
    this.touched.set(false);
    this.error.set(null);
    this.sent.set(false);
  }

  protected goToDashboard(): void {
    void this.router.navigateByUrl('/dashboard');
  }
}
