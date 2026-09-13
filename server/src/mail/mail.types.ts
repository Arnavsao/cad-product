/**
 * Wire shapes for outbound transactional email.
 *
 * These are internal to the server — no email shape is ever returned to a
 * client — so they are plain interfaces with no validation decorators.
 */

/**
 * Which preference gates a message, and what its unsubscribe footer names.
 *
 * Four categories rather than one per template: a person who turns off share
 * mail means "stop telling me about shares", not "stop telling me about the
 * drawing share but keep the folder share". `invite` is a category of its own
 * because it is deliberately NOT gated — see `MailService`.
 *
 * `support` is a reply to something the person themselves sent us. It is not
 * gated either, and for a stronger reason than `invite`: someone who wrote in
 * asking a question is waiting for the answer, and a notification preference
 * about shares and organizations is not consent to be ignored. It is also the
 * only category whose recipient may have no account at all — feedback can be
 * submitted signed out.
 */
export type EmailCategory = 'share' | 'invite' | 'org' | 'support';

/** One message to one recipient. Fan-out is the caller's job (see `MailService`). */
export interface OutboundEmail {
  /** A single address. Never a list: see the "one recipient" note in `MailService`. */
  to: string;
  subject: string;
  html: string;
  /**
   * Always provided alongside `html`. Text-only clients exist, and a message
   * with no text part scores worse with spam filters than one that has both.
   */
  text: string;
  replyTo?: string;
  category: EmailCategory;
}

/** What a template produces; the recipient and category are added by the caller. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
