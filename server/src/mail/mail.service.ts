import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_TRANSPORT } from './mail.constants';
import type { MailTransport } from './mail.transport';
import type { EmailCategory, OutboundEmail, RenderedEmail } from './mail.types';

/** Path of the page the unsubscribe footer links to. */
const PREFERENCES_PATH = '/dashboard/settings/notifications';

/**
 * Transactional email.
 *
 * Design decisions:
 *
 * - **It never throws.** Exactly the property `NotificationsService.publish`
 *   has, and for the same reason: every caller is a side effect at the end of a
 *   more important operation, and failing to send a notification email must not
 *   fail the share, invitation or role change that triggered it. A failure logs
 *   at `warn` with the category and recipient, and `send` returns `false`. This
 *   is what makes it safe to `await` a send inside a share handler.
 *
 * - **A missing API key is a no-op, not an error.** Local development has no
 *   Resend account, so `MailModule` picks `LogMailTransport` and every
 *   developer sees the exact message that would have gone out. The alternative
 *   — refusing to boot, or throwing per send — would make the six call sites
 *   undemonstrable without a provider.
 *
 * - **Preference is checked here, once.** `sendToUser` resolves the
 *   recipient's `UserPreferences` before handing the message to the transport,
 *   so a new email type cannot forget to honour the toggle: the only way to
 *   reach an account holder is through the method that checks. `send` (no
 *   preference lookup) exists for the one case that must not be gated.
 *
 * - **`invite` is never gated.** An invitation goes to an address that may have
 *   no account at all, so there are no preferences to consult, and the mail is
 *   the only way that person learns they were invited. Someone who does have an
 *   account and has turned off org mail still gets invitations: turning off
 *   "role changed" notifications is not consent to be silently excluded from an
 *   organization someone added you to.
 *
 * - **Missing preferences mean send.** A user who has never opened Settings has
 *   no row (it is created lazily on first `/me`), and defaulting that to
 *   silence would mean the newest accounts — the ones most likely to be
 *   receiving their first share — are the ones that hear nothing.
 *
 * - **One recipient per message.** No BCC fan-out: recipients must never see
 *   each other's addresses, and both the preference check and the unsubscribe
 *   link are per-person, so a shared body would be wrong for everyone but the
 *   first. Callers that fan out cap their recipient count (see
 *   `SharingService.MAX_SHARE_FANOUT`) rather than looping unbounded.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** Resolved once: `MAIL_FROM`, or null when mail is not configured to send. */
  private readonly from: string | null;

  /** Origin of the web app, no trailing slash. See `link`. */
  private readonly baseUrl: string;

  private readonly replyTo: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {
    this.from = this.config.get('MAIL_FROM', { infer: true }) ?? null;
    this.replyTo = this.config.get('MAIL_REPLY_TO', { infer: true }) ?? undefined;
    this.baseUrl = resolveBaseUrl(
      this.config.get('APP_BASE_URL', { infer: true }),
      this.config.get('CORS_ORIGIN', { infer: true }),
    );
  }

  /**
   * Sends without consulting anyone's preferences.
   *
   * For `invite` only — see the class JSDoc. Returns whether the transport
   * accepted the message; `false` never means the operation that triggered it
   * failed.
   */
  async send(email: OutboundEmail): Promise<boolean> {
    // `LogMailTransport` needs a From to print; a real one would be rejected
    // without it, and MailModule only picks Resend when MAIL_FROM is present.
    const from = this.from ?? 'CADOnline <no-reply@localhost>';
    try {
      await this.transport.send({ ...email, replyTo: email.replyTo ?? this.replyTo }, from);
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not send ${email.category} email to ${email.to} via ${this.transport.name}: ${(error as Error)?.message ?? error}`,
      );
      return false;
    }
  }

  /**
   * Sends to an account holder, honouring their email preferences.
   *
   * `userId` may be `null` for an address with no account yet, in which case
   * there is nothing to look up and the message is sent — the only category
   * that reaches such an address is `invite`.
   */
  async sendToUser(userId: string | null, email: OutboundEmail): Promise<boolean> {
    if (userId !== null && !(await this.wants(userId, email.category))) {
      return false;
    }
    return this.send(email);
  }

  /**
   * Builds an absolute URL into the web app: `link('/editor/abc')`.
   *
   * The API cannot infer the front-end origin — requests arrive from whatever
   * host the client is on and `CORS_ORIGIN` may list several — so it comes from
   * `APP_BASE_URL`, falling back to the first CORS origin, which is right in
   * development.
   */
  link(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /** Absolute URL of the page the unsubscribe footer links to. */
  get preferencesUrl(): string {
    return this.link(PREFERENCES_PATH);
  }

  /**
   * `RenderedEmail` + recipient + category → an `OutboundEmail`.
   *
   * A small convenience so the six call sites read as one expression rather
   * than a spread and three field assignments.
   */
  compose(to: string, category: EmailCategory, rendered: RenderedEmail): OutboundEmail {
    return { to, category, ...rendered };
  }

  /**
   * Whether this user wants mail of this category.
   *
   * A lookup failure resolves to `true`: the same "best effort" stance as the
   * rest of the class, and dropping a share notification because a preferences
   * read hiccuped would be the wrong way to fail.
   */
  private async wants(userId: string, category: EmailCategory): Promise<boolean> {
    if (category === 'invite') {
      return true;
    }
    try {
      const prefs = await this.prisma.userPreferences.findUnique({
        where: { userId },
        select: { emailOnShare: true, emailOnOrgActivity: true },
      });
      if (!prefs) {
        return true;
      }
      return category === 'share' ? prefs.emailOnShare : prefs.emailOnOrgActivity;
    } catch (error) {
      this.logger.warn(`Could not read email preferences for ${userId}: ${(error as Error)?.message ?? error}`);
      return true;
    }
  }
}

/**
 * `APP_BASE_URL`, else the first CORS origin, with any trailing slash trimmed
 * so `link()` never produces a double slash.
 */
export function resolveBaseUrl(appBaseUrl: string | undefined, corsOrigins: string[]): string {
  const chosen = appBaseUrl ?? corsOrigins[0] ?? 'http://localhost:4200';
  return chosen.replace(/\/+$/, '');
}
