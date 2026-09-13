import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../../auth/auth.types';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** What is being acted on. Free-form by design; see `AuditLog.targetType`. */
export type AuditTargetType =
  | 'user'
  | 'staff'
  | 'organization'
  | 'drawing'
  | 'feedback'
  | 'flag'
  | 'announcement'
  | 'storage'
  | 'billing'
  | 'system';

/** One entry, as callers describe it. */
export interface AuditEntry {
  action: string;
  targetType: AuditTargetType;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Longest user-agent we store; anything longer is truncated, not rejected. */
const MAX_USER_AGENT = 512;

/**
 * Writes the staff audit trail.
 *
 * **Never throws.** An audit write that fails must not roll back the action it
 * describes — a suspension that half-happened because logging broke is worse
 * than a suspension with no log line, and the failure is logged at `error` so it
 * is still visible. This mirrors `MailService`'s policy for the same reason.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(actor: Pick<AuthUser, 'id' | 'email'>, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          before: toJson(entry.before),
          after: toJson(entry.after),
          reason: entry.reason ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ? entry.userAgent.slice(0, MAX_USER_AGENT) : null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not write audit entry ${entry.action} on ${entry.targetType}/${entry.targetId ?? '-'}: ${
          (error as Error).message
        }`,
      );
    }
  }

  /** Client IP, honouring the proxy chain Azure/nginx puts in front of us. */
  static ipOf(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (first) {
      return first.split(',')[0]?.trim() || null;
    }
    return req.ip ?? null;
  }

  static userAgentOf(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return (Array.isArray(ua) ? ua[0] : ua) ?? null;
  }
}

/**
 * Anything → a value Prisma will accept in a `Json?` column.
 *
 * `undefined` means "no snapshot" and must stay absent rather than become JSON
 * `null`, which would read as "the row was empty afterwards".
 */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
