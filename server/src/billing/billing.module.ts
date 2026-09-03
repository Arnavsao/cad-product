import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { BillingCatalog } from './billing.catalog';
import { DODO_CLIENT } from './billing.constants';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingWebhookController } from './billing.webhook.controller';
import { createDodoClient, modeOf, type DodoClient } from './dodo.client';

/**
 * Billing via Dodo Payments.
 *
 * The client is built once at boot from configuration and provided as
 * `DODO_CLIENT`, or provided as `null` when `DODO_API_KEY` is absent — the same
 * seam `MailModule` uses for its transport, and for the same three reasons:
 * the choice is announced once in the startup log, the request path never
 * re-checks configuration, and a spec can replace the whole upstream with
 * `overrideProvider(DODO_CLIENT)`.
 *
 * `PrismaService` arrives through the global `PrismaModule`.
 */
@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [
    {
      provide: DODO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DodoClient | null => {
        const apiKey = config.get('DODO_API_KEY', { infer: true });
        const webhookKey = config.get('DODO_WEBHOOK_KEY', { infer: true });
        const logger = new Logger('BillingModule');

        if (!apiKey) {
          logger.log('Billing is not configured (no DODO_API_KEY) — checkout and webhooks answer 503');
          return null;
        }

        // Worth a warning rather than a silent partial setup: checkout would
        // work and every webhook would be rejected, so the customer pays and
        // never gets their plan. That is the worst failure mode in the module.
        if (!webhookKey) {
          logger.warn(
            'DODO_API_KEY is set but DODO_WEBHOOK_KEY is not — webhooks will be REJECTED, ' +
              'so completed payments will not grant a plan. Set the signing secret from the Dodo dashboard.',
          );
        }

        logger.log(`Billing enabled against Dodo Payments (${modeOf(apiKey)} mode)`);
        return createDodoClient(apiKey, webhookKey);
      },
    },
    BillingCatalog,
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
