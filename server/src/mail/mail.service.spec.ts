import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Env } from '../config/env.schema';
import type { PrismaService } from '../prisma/prisma.service';
import { MailService, resolveBaseUrl } from './mail.service';
import { LogMailTransport, type MailTransport } from './mail.transport';
import type { OutboundEmail } from './mail.types';

/**
 * Unit spec for the two properties the type system cannot state: a send can
 * never break the operation that triggered it, and no email type can bypass
 * the recipient's preference — plus the URL building every template depends on.
 */

const USER = 'cuser00000000000000000001';

/** A minimal `ConfigService` over a plain record of validated env values. */
function configOf(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => (values as Record<string, unknown>)[key],
  } as unknown as ConfigService<Env, true>;
}

function email(overrides: Partial<OutboundEmail> = {}): OutboundEmail {
  return {
    to: 'bob@example.com',
    subject: 'Alice shared "Site Plan" with you',
    html: '<p>hi</p>',
    text: 'hi',
    category: 'share',
    ...overrides,
  };
}

describe('MailService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let transport: { name: string; send: jest.Mock };

  const build = (env: Partial<Env> = {}): MailService => {
    const config = configOf({
      CORS_ORIGIN: ['http://localhost:4200'],
      MAIL_FROM: 'CADOnline <no-reply@cadonline.app>',
      ...env,
    });
    return new MailService(prisma, config, transport as unknown as MailTransport);
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    prisma.userPreferences.findUnique.mockResolvedValue(null);
    transport = { name: 'fake', send: jest.fn().mockResolvedValue(undefined) };
  });

  // ── never throws ───────────────────────────────────────────────────────────

  it('swallows a transport failure so it cannot break the share that triggered it', async () => {
    transport.send.mockRejectedValue(new Error('provider down'));
    await expect(build().send(email())).resolves.toBe(false);
  });

  it('reports success as true when the transport accepted the message', async () => {
    await expect(build().send(email())).resolves.toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('swallows a preferences lookup failure and still sends', async () => {
    // Dropping a share notification because a preferences read hiccuped would
    // be the wrong way to fail.
    prisma.userPreferences.findUnique.mockRejectedValue(new Error('db down'));
    await expect(build().sendToUser(USER, email())).resolves.toBe(true);
  });

  // ── no API key ─────────────────────────────────────────────────────────────

  it('logs instead of sending when the log transport is the one configured', async () => {
    const logger = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new MailService(prisma, configOf({ CORS_ORIGIN: ['http://localhost:4200'] }), new LogMailTransport());

    await expect(service.send(email())).resolves.toBe(true);
    expect(logger).toHaveBeenCalledTimes(1);
    // The TEXT body, not the HTML: it carries the same URLs and is readable.
    const printed = String(logger.mock.calls[0][0]);
    expect(printed).toContain('hi');
    expect(printed).toContain('bob@example.com');
    expect(printed).toContain('Alice shared "Site Plan" with you');
    logger.mockRestore();
  });

  it('still has a From to print when MAIL_FROM is unset', async () => {
    await build({ MAIL_FROM: undefined }).send(email());
    expect(transport.send.mock.calls[0][1]).toBeTruthy();
  });

  // ── preferences ────────────────────────────────────────────────────────────

  it('honours emailOnShare: false', async () => {
    prisma.userPreferences.findUnique.mockResolvedValue({
      emailOnShare: false,
      emailOnOrgActivity: true,
    } as never);
    await expect(build().sendToUser(USER, email({ category: 'share' }))).resolves.toBe(false);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('honours emailOnOrgActivity: false', async () => {
    prisma.userPreferences.findUnique.mockResolvedValue({
      emailOnShare: true,
      emailOnOrgActivity: false,
    } as never);
    await expect(build().sendToUser(USER, email({ category: 'org' }))).resolves.toBe(false);
  });

  it('does not let a share opt-out silence org mail, or the other way round', async () => {
    prisma.userPreferences.findUnique.mockResolvedValue({
      emailOnShare: false,
      emailOnOrgActivity: true,
    } as never);
    await expect(build().sendToUser(USER, email({ category: 'org' }))).resolves.toBe(true);
  });

  it('sends an invite even when BOTH toggles are off', async () => {
    // An invitation is the only way someone learns they were added to an
    // organization, so it is deliberately not gated. See MailService's JSDoc.
    prisma.userPreferences.findUnique.mockResolvedValue({
      emailOnShare: false,
      emailOnOrgActivity: false,
    } as never);
    await expect(build().sendToUser(USER, email({ category: 'invite' }))).resolves.toBe(true);
    // Not even looked up — the check short-circuits on the category.
    expect(prisma.userPreferences.findUnique).not.toHaveBeenCalled();
  });

  it('sends when the user has no preferences row yet', async () => {
    prisma.userPreferences.findUnique.mockResolvedValue(null);
    await expect(build().sendToUser(USER, email())).resolves.toBe(true);
  });

  it('skips the lookup entirely for an address with no account', async () => {
    await expect(build().sendToUser(null, email({ category: 'invite' }))).resolves.toBe(true);
    expect(prisma.userPreferences.findUnique).not.toHaveBeenCalled();
  });

  it('selects only the two preference columns it reads', async () => {
    await build().sendToUser(USER, email());
    const { select } = (prisma.userPreferences.findUnique as unknown as jest.Mock).mock.calls[0][0];
    expect(select).toEqual({ emailOnShare: true, emailOnOrgActivity: true });
  });

  // ── one recipient per message ──────────────────────────────────────────────

  it('passes exactly one recipient to the transport', async () => {
    await build().send(email({ to: 'solo@example.com' }));
    expect(transport.send.mock.calls[0][0].to).toBe('solo@example.com');
  });

  it('applies MAIL_REPLY_TO when the message does not carry its own', async () => {
    await build({ MAIL_REPLY_TO: 'support@cadonline.app' }).send(email());
    expect(transport.send.mock.calls[0][0].replyTo).toBe('support@cadonline.app');

    await build({ MAIL_REPLY_TO: 'support@cadonline.app' }).send(email({ replyTo: 'alice@example.com' }));
    expect(transport.send.mock.calls[1][0].replyTo).toBe('alice@example.com');
  });

  // ── link() ─────────────────────────────────────────────────────────────────

  it('builds an absolute URL from APP_BASE_URL', () => {
    const service = build({ APP_BASE_URL: 'https://cadonline.app' });
    expect(service.link('/editor/abc')).toBe('https://cadonline.app/editor/abc');
  });

  it('trims a trailing slash rather than producing a double one', () => {
    const service = build({ APP_BASE_URL: 'https://cadonline.app/' });
    expect(service.link('/editor/abc')).toBe('https://cadonline.app/editor/abc');
  });

  it('accepts a path with no leading slash', () => {
    const service = build({ APP_BASE_URL: 'https://cadonline.app' });
    expect(service.link('editor/abc')).toBe('https://cadonline.app/editor/abc');
  });

  it('falls back to the first CORS origin when APP_BASE_URL is unset', () => {
    const service = build({ CORS_ORIGIN: ['http://localhost:4200', 'https://staging.cadonline.app'] });
    expect(service.link('/join/tok')).toBe('http://localhost:4200/join/tok');
  });

  it('points the unsubscribe footer at the settings page that exists', () => {
    const service = build({ APP_BASE_URL: 'https://cadonline.app' });
    expect(service.preferencesUrl).toBe('https://cadonline.app/dashboard/settings/notifications');
  });

  it('composes a rendered template into an addressed message', () => {
    const composed = build().compose('bob@example.com', 'org', {
      subject: 'S',
      html: '<p>H</p>',
      text: 'T',
    });
    expect(composed).toEqual({ to: 'bob@example.com', category: 'org', subject: 'S', html: '<p>H</p>', text: 'T' });
  });

  describe('resolveBaseUrl', () => {
    it('prefers APP_BASE_URL, then the first CORS origin, then localhost', () => {
      expect(resolveBaseUrl('https://a.app', ['http://b'])).toBe('https://a.app');
      expect(resolveBaseUrl(undefined, ['http://b', 'http://c'])).toBe('http://b');
      expect(resolveBaseUrl(undefined, [])).toBe('http://localhost:4200');
    });

    it('trims any number of trailing slashes', () => {
      expect(resolveBaseUrl('https://a.app///', [])).toBe('https://a.app');
    });
  });
});
