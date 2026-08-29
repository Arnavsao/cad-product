import type { WebhookEvent } from '@clerk/backend';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import { profileFromClerkUserJson } from '../users/users.mapper';
import { UsersService } from '../users/users.service';

/** Response body of `POST /webhooks/clerk`. */
export interface WebhookAck {
  received: true;
  /** Present when the Svix message id was already processed. */
  duplicate?: true;
}

/**
 * Applies verified Clerk webhook events to the local `users` table.
 *
 * Design — one transaction per event: the Svix message id is inserted into
 * `webhook_events` FIRST, then the user change is applied. If the insert hits
 * the primary key (P2002) the event was already processed and we answer 200
 * `{ duplicate: true }` so Svix stops retrying. If the user change fails, the
 * whole transaction rolls back — the id is NOT recorded — so Svix's retry can
 * succeed later. Unknown event types are recorded and ignored.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async handle(event: WebhookEvent, svixId: string): Promise<WebhookAck> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.webhookEvent.create({ data: { id: svixId, type: event.type } });
        await this.apply(event, tx);
      });
      return { received: true };
    } catch (error) {
      if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION) && isWebhookEventConflict(error)) {
        this.logger.debug(`Duplicate webhook ${svixId} (${event.type}) ignored`);
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }

  private async apply(event: WebhookEvent, tx: Prisma.TransactionClient): Promise<void> {
    switch (event.type) {
      case 'user.created':
      case 'user.updated':
        await this.users.upsertFromClerk(profileFromClerkUserJson(event.data), tx);
        return;
      case 'user.deleted':
        if (event.data.id) {
          await this.users.softDeleteByClerkId(event.data.id, tx);
        }
        return;
      default:
        this.logger.debug(`Ignoring webhook type ${event.type}`);
    }
  }
}

/**
 * P2002 raised by the `webhook_events` insert (vs. some other unique index in
 * the same transaction). Prisma ≥5 reports `meta.modelName`; when absent we
 * fall back to the target column list.
 */
function isWebhookEventConflict(error: unknown): boolean {
  const meta = (error as { meta?: { modelName?: string; target?: unknown } }).meta;
  if (!meta) {
    return true;
  }
  if (typeof meta.modelName === 'string') {
    return meta.modelName === 'WebhookEvent';
  }
  if (Array.isArray(meta.target)) {
    return meta.target.includes('id');
  }
  return typeof meta.target === 'string' ? meta.target.includes('webhook_events') : true;
}
