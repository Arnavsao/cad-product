import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { MAIL_TRANSPORT } from './mail.constants';
import { MailService } from './mail.service';
import { LogMailTransport, ResendMailTransport, type MailTransport } from './mail.transport';

/**
 * Transactional email.
 *
 * The transport is chosen once, at boot, from configuration: Resend when both
 * `RESEND_API_KEY` and `MAIL_FROM` are present, and the logging transport
 * otherwise. Deciding here rather than per send means the choice is announced
 * once in the startup log, and a spec can replace the whole seam with
 * `overrideProvider(MAIL_TRANSPORT)`.
 *
 * `PrismaService` arrives through the global `PrismaModule`, the same way
 * `NotificationsModule` gets it, so nothing has to be imported for the
 * preference lookup.
 */
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailTransport => {
        const apiKey = config.get('RESEND_API_KEY', { infer: true });
        const from = config.get('MAIL_FROM', { infer: true });
        const logger = new Logger('MailModule');
        if (apiKey && from) {
          logger.log(`Email will be sent through Resend as ${from}`);
          return new ResendMailTransport(apiKey);
        }
        logger.log('Email is not configured (no RESEND_API_KEY/MAIL_FROM) — messages will be logged, not sent');
        return new LogMailTransport();
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
