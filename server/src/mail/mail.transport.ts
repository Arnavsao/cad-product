import { Logger } from '@nestjs/common';
import type { OutboundEmail } from './mail.types';

/** Resend's send endpoint. One POST per message. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * How long to wait on the provider before giving up.
 *
 * A share or an invite `await`s its email, so a hung provider would otherwise
 * pin the request that triggered it for as long as the socket stayed open.
 */
const SEND_TIMEOUT_MS = 10_000;

/** How much of a provider error body to keep in the thrown message. */
const ERROR_BODY_CHARS = 500;

/**
 * Where a rendered message goes.
 *
 * Design decisions:
 *
 * - **This is the only provider-shaped seam in the feature.** Everything above
 *   it (templates, preference checks, the six call sites) is provider-agnostic,
 *   so swapping Resend for SES or SMTP is one new class and one line in
 *   `mail.module.ts` — no template and no caller changes.
 *
 * - **A transport MAY throw.** `MailService` is the layer that guarantees
 *   never-throwing; a transport that swallowed its own failures would leave
 *   nothing to log and no way to tell a misconfigured key from a delivered
 *   message.
 */
export interface MailTransport {
  /** Identifies the implementation in logs (`log`, `resend`). */
  readonly name: string;
  send(email: OutboundEmail, from: string): Promise<void>;
}

/**
 * Writes the message to the log instead of sending it.
 *
 * Chosen whenever `RESEND_API_KEY` or `MAIL_FROM` is missing, which is the
 * local-development default. It is what makes the whole feature demonstrable
 * and testable with no provider account: a developer sharing a drawing sees the
 * exact text that would have been delivered, links included.
 *
 * The **text** body is logged rather than the HTML — it carries the same
 * sentences and the same URLs, and a wall of inline-styled markup in a terminal
 * hides the thing you actually wanted to read.
 */
export class LogMailTransport implements MailTransport {
  readonly name = 'log';

  private readonly logger = new Logger('MailTransport:log');

  send(email: OutboundEmail, from: string): Promise<void> {
    this.logger.log(
      [
        '',
        '─── email (not sent: no RESEND_API_KEY/MAIL_FROM) ──────────────────',
        `From:     ${from}`,
        `To:       ${email.to}`,
        `Subject:  ${email.subject}`,
        `Category: ${email.category}`,
        ...(email.replyTo ? [`Reply-To: ${email.replyTo}`] : []),
        '',
        email.text,
        '───────────────────────────────────────────────────────────────────',
      ].join('\n'),
    );
    return Promise.resolve();
  }
}

/**
 * Sends through Resend's HTTP API.
 *
 * Design decisions:
 *
 * - **`fetch`, not the SDK.** Sending is a single JSON POST with a bearer
 *   token; the `resend` package would add a dependency (and its own transitive
 *   tree) to save about ten lines. Node 18+ has `fetch` built in.
 *
 * - **Any non-2xx is a failure, and the body goes into the error.** Resend
 *   reports a domain that is not verified, a malformed `from` and a rejected
 *   address all as 4xx with an explanatory JSON body; without that body in the
 *   log the operator sees "422" and has nothing to act on. Truncated, because a
 *   provider error is not a place to spill an unbounded string into logs.
 *
 * - **It times out.** See `SEND_TIMEOUT_MS`.
 */
export class ResendMailTransport implements MailTransport {
  readonly name = 'resend';

  constructor(private readonly apiKey: string) {}

  async send(email: OutboundEmail, from: string): Promise<void> {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Resend refused the message (${response.status}): ${body.slice(0, ERROR_BODY_CHARS)}`);
    }
  }
}
