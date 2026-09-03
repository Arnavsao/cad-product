/**
 * DI token for the chosen `MailTransport`.
 *
 * Its own file so `MailService` can inject it without importing
 * `mail.module.ts` (which imports the service) — the cycle Nest would
 * otherwise report at boot. It is also the handle an e2e spec uses to
 * `overrideProvider` a recording transport in place of the real one.
 */
export const MAIL_TRANSPORT = 'MAIL_TRANSPORT';
