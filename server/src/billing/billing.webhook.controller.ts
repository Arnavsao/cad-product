import { Controller, Headers, HttpCode, HttpStatus, Inject, Logger, Optional, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Prisma } from '../generated/prisma/client';
import { ApiException } from '../common/errors/api-error';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { DODO_CLIENT } from './billing.constants';
import type { DodoClient, DodoSubscription } from './dodo.client';

/** Standard Webhooks headers Dodo signs each delivery with. */
interface WebhookHeaders {
  'webhook-id'?: string;
  'webhook-signature'?: string;
  'webhook-timestamp'?: string;
}

/** Verified envelope Dodo wraps every event in. */
interface DodoWebhookEvent {
  type: string;
  timestamp?: string;
  business_id?: string;
  data?: { payload_type?: string } & Record<string, unknown>;
}

/**
 * `POST /api/v1/billing/webhook` — Dodo Payments event receiver.
 *
 * This is the only unauthenticated route in the API that can change what a user
 * has paid for, so it is the most security-sensitive file in this module. Four
 * properties matter, in order:
 *
 * 1. **It fails closed.** With no `DODO_WEBHOOK_KEY` configured, every delivery
 *    is rejected with 503 rather than trusted. A misconfigured deployment must
 *    never be one that accepts unsigned plan changes.
 *
 * 2. **The signature is verified against the RAW body.** Signature verification
 *    is over the exact bytes Dodo signed, so `express.json()` re-serialising
 *    them would break it for any payload where key order or whitespace differs.
 *    `app.setup.ts` mounts `express.raw()` for this path specifically.
 *
 * 3. **It is idempotent.** Dodo retries a failed delivery up to 8 times over
 *    ~18 hours. The `webhook-id` is the primary key of `webhook_events`, so the
 *    insert *is* the dedupe: a duplicate hits the unique constraint and is
 *    acknowledged without being applied twice.
 *
 * 4. **It acknowledges as fast as it safely can.** Dodo times out at 15
 *    seconds. Verification and one upsert are well inside that, so events are
 *    applied inline rather than queued — a queue would add a failure mode
 *    (lost job) worse than the latency it saves at this volume.
 *
 * A handler error returns 500 *on purpose*, so Dodo retries. Returning 200 on
 * failure would silently drop a plan change with no second chance.
 */
@Controller('billing')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    @Optional() @Inject(DODO_CLIENT) private readonly dodo: DodoClient | null,
  ) {}

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  // Deliberately looser than the global budget: a burst of retries plus a busy
  // sales day is legitimate traffic here, and throttling a webhook into failure
  // costs a plan change. Still bounded so the route cannot be used to hammer
  // the database from the open internet.
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  async receive(@Req() req: Request, @Headers() headers: WebhookHeaders): Promise<{ received: boolean }> {
    if (!this.dodo) {
      // Fail closed. See property 1 above.
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'BILLING_NOT_CONFIGURED',
        'Billing is not configured on this deployment',
      );
    }

    const webhookId = headers['webhook-id'];
    if (!webhookId) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'MISSING_WEBHOOK_ID', 'webhook-id header is required');
    }

    // `express.raw()` gives a Buffer. Anything else means the parser for this
    // path is misconfigured, and verifying a re-serialised body would produce
    // false rejections — so say so rather than limping on.
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null;
    if (raw === null) {
      this.logger.error('Webhook body is not raw — check the express.raw() mount for this path in app.setup.ts');
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, 'WEBHOOK_BODY_NOT_RAW', 'Webhook body was pre-parsed');
    }

    // Verify BEFORE anything is written. `unwrap` checks the HMAC over
    // `{id}.{timestamp}.{payload}` and the timestamp window, then parses.
    let event: DodoWebhookEvent;
    try {
      event = this.dodo.webhooks.unwrap(raw, {
        headers: {
          'webhook-id': webhookId,
          'webhook-signature': headers['webhook-signature'],
          'webhook-timestamp': headers['webhook-timestamp'],
        },
      }) as DodoWebhookEvent;
    } catch (error) {
      // Never echo the reason: a caller probing signatures should learn nothing
      // about why one failed.
      this.logger.warn(`Rejected webhook ${webhookId}: signature verification failed`);
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Invalid webhook signature');
    }

    // Claim the id. A duplicate delivery loses this race and stops here.
    try {
      await this.prisma.webhookEvent.create({
        data: { id: webhookId, type: event.type ?? 'unknown', payload: event as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`Webhook ${webhookId} (${event.type}) already seen — acknowledging without reapplying`);
        return { received: true };
      }
      throw error;
    }

    try {
      await this.apply(event);
      await this.prisma.webhookEvent.update({ where: { id: webhookId }, data: { processedAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Record why, then rethrow so Dodo retries. The row keeps `processedAt`
      // null, which is the query for "deliveries worth investigating".
      await this.prisma.webhookEvent
        .update({ where: { id: webhookId }, data: { error: message.slice(0, 1000) } })
        .catch(() => undefined);
      this.logger.error(`Webhook ${webhookId} (${event.type}) failed: ${message}`);
      throw error;
    }

    return { received: true };
  }

  /**
   * Route a verified event to its handler.
   *
   * Only subscription events are acted on, because plan is the only thing this
   * module tracks. Everything else — payments, refunds, disputes, licence keys
   * — is still *recorded* by the caller, so adding a handler later needs no
   * backfill; the history is already there.
   */
  private async apply(event: DodoWebhookEvent): Promise<void> {
    const type = event.type ?? '';
    if (!type.startsWith('subscription.')) {
      this.logger.debug(`Recorded ${type} with no handler`);
      return;
    }

    const payload = event.data as unknown as DodoSubscription | undefined;
    if (!payload?.subscription_id) {
      this.logger.warn(`${type} carried no subscription_id; nothing to apply`);
      return;
    }

    const outcome = await this.billing.applySubscriptionEvent(payload);
    this.logger.log(`${type} for subscription ${payload.subscription_id}: ${outcome}`);
  }
}
