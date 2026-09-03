import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors/api-error';
import { clampLimit, decodeCursor, encodeCursor } from '../common/utils/pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListNotificationsDto,
  MarkAllReadDto,
  NotificationKindWire,
  NotificationPageDto,
} from './dto/notification.dto';
import { notificationKindFromWire, toNotificationDto } from './notifications.mapper';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/** What `publish()` needs to know. `kind` defaults to `system`. */
export interface PublishNotification {
  kind?: NotificationKindWire;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
}

/**
 * The in-app notification inbox.
 *
 * Reads are always scoped by `userId` in the `where` clause rather than checked
 * after the fetch, so there is no path on which one user's row can be returned
 * to another. A row that is not the caller's is reported as 404, matching the
 * house rule that ownership misses never reveal existence with a 403.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** `GET /notifications` — newest first, plus the unread count for the badge. */
  async list(userId: string, query: ListNotificationsDto): Promise<NotificationPageDto> {
    const limit = clampLimit(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const cursor = decodeCursor(query.cursor);

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      }),
      this.unreadCount(userId),
    ]);

    const hasMore = rows.length > limit;
    const kept = hasMore ? rows.slice(0, limit) : rows;
    const last = kept[kept.length - 1];
    return {
      items: kept.map(toNotificationDto),
      nextCursor: hasMore && last ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id }) : null,
      unreadCount,
    };
  }

  /** Unread total for the header badge. */
  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /**
   * `PATCH /notifications/:id/read` — idempotent: re-reading an already-read
   * notification keeps the original `readAt` rather than moving it.
   */
  async markRead(userId: string, id: string): Promise<NotificationPageDto['items'][number]> {
    const existing = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!existing) {
      throw ApiException.notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
    }
    if (existing.readAt) {
      return toNotificationDto(existing);
    }
    const updated = await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return toNotificationDto(updated);
  }

  /** `POST /notifications/read-all` — returns how many rows actually changed. */
  async markAllRead(userId: string): Promise<MarkAllReadDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /**
   * Creates a notification for a user.
   *
   * Deliberately **never throws**: every caller is a side-effect at the end of
   * some more important operation (finishing onboarding, completing an import),
   * and failing to record a notification must not fail that operation. Errors
   * are logged and swallowed.
   */
  async publish(userId: string, notification: PublishNotification): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          kind: notificationKindFromWire(notification.kind),
          title: notification.title,
          body: notification.body ?? null,
          linkUrl: notification.linkUrl ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Could not publish notification for ${userId}: ${(error as Error)?.message ?? error}`);
    }
  }
}
