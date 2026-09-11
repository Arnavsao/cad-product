import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { environment } from '../../../../environments/environment';
import { CreateFeedbackRequest, FeedbackKind } from '../../../core/api/api.models';
import { FeedbackApiService } from '../../../core/api/feedback-api.service';
import { SupabaseAuthService } from '../../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import type { UiIconName } from '../../../shared/ui/icon.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { messageOf } from '../../dashboard/data/drawings-list.store';
import { FAQS } from '../../pricing/pricing.data';
import { SiteAccordionComponent, SiteAccordionItem } from '../components/accordion.component';
import { SiteClosingComponent } from '../components/closing.component';
import { SiteHeadingComponent } from '../components/heading.component';
import { SiteRevealDirective } from '../motion/reveal.directive';

/** Must match `MESSAGE_MAX_LENGTH` on the server, or the counter lies. */
const MESSAGE_MAX = 4000;
const MESSAGE_MIN = 4;

/** Good enough to catch a typo; the server validates properly and answers 400. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type TopicId = 'question' | 'team' | 'invoicing' | 'bug' | 'idea';

interface Topic {
  id: TopicId;
  labelKey: string;
  hintKey: string;
  icon: UiIconName;
  /** The feedback kind the API stores. */
  kind: FeedbackKind;
  /**
   * Prepended to the message so a topic the API has no kind for is still
   * sortable. A machine-readable tag read on the far side, so it stays English
   * whatever language the sender wrote in.
   */
  prefix: string;
  placeholderKey: string;
}

const TOPICS: readonly Topic[] = [
  {
    id: 'question',
    labelKey: 'site.contact.topic.question.label',
    hintKey: 'site.contact.topic.question.hint',
    icon: 'help',
    kind: 'question',
    prefix: '',
    placeholderKey: 'site.contact.topic.question.placeholder',
  },
  {
    id: 'team',
    labelKey: 'site.contact.topic.team.label',
    hintKey: 'site.contact.topic.team.hint',
    icon: 'users',
    kind: 'other',
    prefix: '[Team/edu plan] ',
    placeholderKey: 'site.contact.topic.team.placeholder',
  },
  {
    id: 'invoicing',
    labelKey: 'site.contact.topic.invoicing.label',
    hintKey: 'site.contact.topic.invoicing.hint',
    icon: 'file',
    kind: 'other',
    prefix: '[Invoicing] ',
    placeholderKey: 'site.contact.topic.invoicing.placeholder',
  },
  {
    id: 'bug',
    labelKey: 'site.contact.topic.bug.label',
    hintKey: 'site.contact.topic.bug.hint',
    icon: 'alert',
    kind: 'bug',
    prefix: '',
    placeholderKey: 'site.contact.topic.bug.placeholder',
  },
  {
    id: 'idea',
    labelKey: 'site.contact.topic.idea.label',
    hintKey: 'site.contact.topic.idea.hint',
    icon: 'sparkle',
    kind: 'idea',
    prefix: '',
    placeholderKey: 'site.contact.topic.idea.placeholder',
  },
];

/**
 * The pricing FAQs most likely to be the reason someone opened this page,
 * picked by their stable ids so the selection survives translation.
 */
const FAQ_PICKS: readonly string[] = ['invoicing', 'student', 'stopPaying', 'switch'];

/**
 * `/contact` — one form, posted to the same `/feedback` endpoint the dashboard
 * uses, so there is one inbox to read rather than two.
 *
 * Design decisions:
 *  - **Topics, not kinds.** The API knows bug / idea / question / other; a
 *    visitor thinks in "I want to buy seats" or "send me an invoice". The five
 *    topics map onto the four kinds, and the two that collapse into `other`
 *    prefix the message so they can still be sorted on the far side.
 *  - **Email is required only when signed out.** A signed-in submission is
 *    already attributed by the token; asking again would be noise. The server
 *    answers 400 for a malformed address, so the client check is a courtesy.
 *  - **Success replaces the form.** A message is one-shot; leaving the filled
 *    form on screen invites an accidental double-send, and the endpoint
 *    rate-limits at ten a minute per address.
 */
@Component({
  selector: 'app-contact-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButtonDirective,
    UiIconComponent,
    UiInputDirective,
    SiteHeadingComponent,
    SiteAccordionComponent,
    SiteClosingComponent,
    SiteRevealDirective,
  ],
  templateUrl: './contact.page.html',
  styleUrl: './contact.page.scss',
})
export class ContactPage {
  private readonly api = inject(FeedbackApiService);
  private readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);

  protected readonly topics = TOPICS;
  protected readonly faqs: readonly SiteAccordionItem[] = FAQS.filter((f) => FAQ_PICKS.includes(f.id)).map((f, i) => ({
    id: `faq-${i}`,
    titleKey: f.qKey,
    bodyKey: f.aKey,
  }));

  protected readonly topicId = signal<TopicId>('question');
  protected readonly email = signal('');
  protected readonly message = signal('');
  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Only nag about a field once the visitor has touched it. */
  private readonly messageTouched = signal(false);
  private readonly emailTouched = signal(false);
  /** Address the last message was sent with, for the confirmation copy. */
  protected readonly sentTo = signal<string | null>(null);

  protected readonly topic = computed(() => TOPICS.find((t) => t.id === this.topicId()) ?? TOPICS[0]);
  protected readonly signedIn = computed(() => this.auth.enabled() && this.auth.isSignedIn());
  protected readonly emailRequired = computed(() => !this.signedIn());

  /** The prefix counts against the server's limit, so the visible budget shrinks with it. */
  protected readonly messageMax = computed(() => MESSAGE_MAX - this.topic().prefix.length);
  protected readonly remaining = computed(() => this.messageMax() - this.message().length);
  protected readonly trimmed = computed(() => this.message().trim());
  protected readonly messageTooShort = computed(() => this.trimmed().length < MESSAGE_MIN);
  protected readonly showMessageError = computed(() => this.messageTouched() && this.trimmed().length > 0 && this.messageTooShort());

  protected readonly emailTrimmed = computed(() => this.email().trim());
  protected readonly emailOk = computed(() => {
    const value = this.emailTrimmed();
    if (!value) return !this.emailRequired();
    return EMAIL_RE.test(value);
  });
  protected readonly showEmailError = computed(() => this.emailTouched() && !this.emailOk());

  protected readonly canSubmit = computed(() => !this.sending() && !this.messageTooShort() && this.emailOk());

  protected onEmail(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
  }

  protected onEmailBlur(): void {
    this.emailTouched.set(true);
  }

  protected onMessage(event: Event): void {
    this.messageTouched.set(true);
    this.message.set((event.target as HTMLTextAreaElement).value);
  }

  protected pickTopic(id: TopicId): void {
    this.topicId.set(id);
    // A longer prefix can push an already-full message over the budget.
    const max = this.messageMax();
    if (this.message().length > max) this.message.set(this.message().slice(0, max));
  }

  protected onTopicKey(event: KeyboardEvent): void {
    const ids = TOPICS.map((t) => t.id);
    const i = ids.indexOf(this.topicId());
    let to = -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') to = (i + 1) % ids.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') to = (i - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = ids.length - 1;
    if (to < 0) return;
    event.preventDefault();
    this.pickTopic(ids[to]);
    (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-topic="${ids[to]}"]`)?.focus();
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.messageTouched.set(true);
    this.emailTouched.set(true);
    if (!this.canSubmit()) return;

    this.sending.set(true);
    this.error.set(null);

    const topic = this.topic();
    const email = this.emailTrimmed();
    const request: CreateFeedbackRequest = {
      kind: topic.kind,
      message: topic.prefix + this.trimmed(),
      ...(email ? { email } : {}),
      context: {
        route: this.router.url,
        appVersion: environment.appName,
        userAgent: navigator.userAgent,
      },
    };

    try {
      await this.api.submit(request);
      this.sentTo.set(email || null);
      this.sent.set(true);
    } catch (e) {
      this.error.set(messageOf(e));
    } finally {
      this.sending.set(false);
    }
  }

  protected again(): void {
    this.message.set('');
    this.messageTouched.set(false);
    this.error.set(null);
    this.sent.set(false);
  }
}
