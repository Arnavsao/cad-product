import type { WebhookEvent } from '@clerk/backend';
import { verifyWebhook, type VerifyWebhookOptions } from '@clerk/backend/webhooks';
import { Controller, HttpCode, HttpStatus, Inject, Logger, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ApiException } from '../common/errors/api-error';
import type { Env } from '../config/env.schema';
import { WebhookAck, WebhooksService } from './webhooks.service';

/** DI token for the Svix verifier (swappable in tests). */
export const WEBHOOK_VERIFIER = Symbol('WEBHOOK_VERIFIER');
export type WebhookVerifier = (request: Request | globalThis.Request, options?: VerifyWebhookOptions) => Promise<WebhookEvent>;
/** Default verifier — `@clerk/backend/webhooks` (Standard Webhooks / Svix). */
export const defaultWebhookVerifier: WebhookVerifier = (request, options) =>
  verifyWebhook(request as globalThis.Request, options);

/** Headers Svix signs; everything else is irrelevant to verification. */
const SVIX_HEADERS = ['svix-id', 'svix-timestamp', 'svix-signature', 'content-type'] as const;

/**
 * `POST /webhooks/clerk` — Clerk → Svix → here.
 *
 * Design — raw body first: Svix signs the exact bytes it sent, so the JSON
 * body parser must never touch this route. `app.setup.ts` mounts
 * `express.raw()` (any content type) on this path BEFORE any JSON parser, and
 * this handler rebuilds a Fetch `Request` from the Buffer + `svix-*` headers
 * for `verifyWebhook`. Public (no Clerk session) but throttled at 120/min.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly signingSecret: string | undefined;

  constructor(
    config: ConfigService<Env, true>,
    private readonly webhooks: WebhooksService,
    @Inject(WEBHOOK_VERIFIER) private readonly verify: WebhookVerifier,
  ) {
    this.signingSecret = config.get('CLERK_WEBHOOK_SECRET', { infer: true });
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('clerk')
  @HttpCode(HttpStatus.OK)
  async clerk(@Req() req: Request): Promise<WebhookAck> {
    if (!this.signingSecret) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'WEBHOOKS_DISABLED', 'CLERK_WEBHOOK_SECRET is not configured');
    }

    const raw = req.body as unknown;
    if (!Buffer.isBuffer(raw)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_WEBHOOK_BODY', 'Expected a raw request body');
    }

    const headers = new Headers();
    for (const name of SVIX_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') {
        headers.set(name, value);
      }
    }
    const svixId = headers.get('svix-id');
    if (!svixId) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_WEBHOOK_SIGNATURE', 'Missing svix-id header');
    }

    const url = `${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`;
    const request = new globalThis.Request(url, { method: 'POST', headers, body: new Uint8Array(raw) });

    let event: WebhookEvent;
    try {
      event = await this.verify(request, { signingSecret: this.signingSecret });
    } catch (error) {
      this.logger.warn(`Webhook signature rejected: ${(error as Error)?.message ?? error}`);
      throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook signature verification failed');
    }

    return this.webhooks.handle(event, svixId);
  }
}
