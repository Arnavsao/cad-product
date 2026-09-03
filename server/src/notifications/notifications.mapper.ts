import type { Notification } from '../generated/prisma/client';
import { NotificationKind } from '../generated/prisma/client';
import { NOTIFICATION_KINDS, type NotificationDto, type NotificationKindWire } from './dto/notification.dto';

// Prisma enum members are upper-case, the API speaks lower-case — see `users.mapper.ts`.

export function notificationKindToWire(kind: NotificationKind): NotificationKindWire {
  return kind.toLowerCase() as NotificationKindWire;
}

export function notificationKindFromWire(kind: NotificationKindWire | undefined): NotificationKind {
  if (kind === undefined) {
    return NotificationKind.SYSTEM;
  }
  if (!NOTIFICATION_KINDS.includes(kind)) {
    throw new RangeError(`Unknown notification kind '${kind}'`);
  }
  return kind.toUpperCase() as NotificationKind;
}

export function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    kind: notificationKindToWire(row.kind),
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
