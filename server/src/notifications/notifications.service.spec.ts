import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { ApiException } from '../common/errors/api-error';
import type { Notification } from '../generated/prisma/client';
import { NotificationKind } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Unit spec for the invariants the schema cannot express: every read is scoped
 * to the caller, marking read is idempotent (so `readAt` records when they first
 * saw it, not the last time they clicked), and `publish` can never break the
 * operation that triggered it.
 */

const USER = 'cuser00000000000000000001';
const OTHER = 'cothr00000000000000000001';
const NOTE = 'cnote0000000000000000001';
const NOW = new Date('2026-09-01T10:00:00.000Z');

function noteRow(overrides: Partial<Notification> = {}): Notification {
  return {
    id: NOTE,
    userId: USER,
    kind: NotificationKind.SYSTEM,
    title: 'Import finished',
    body: null,
    linkUrl: null,
    readAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<ApiException> {
  try {
    await promise;
  } catch (error) {
    return error as ApiException;
  }
  throw new Error('expected the promise to reject');
}

describe('NotificationsService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    prisma.notification.count.mockResolvedValue(0);
    service = new NotificationsService(prisma);
  });

  // ── scoping ────────────────────────────────────────────────────────────────

  it('scopes the listing to the caller', async () => {
    prisma.notification.findMany.mockResolvedValue([noteRow()]);
    await service.list(USER, {});
    const { where } = (prisma.notification.findMany as unknown as jest.Mock).mock.calls[0][0];
    expect(where).toEqual({ userId: USER });
  });

  it('filters to unread when asked', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    await service.list(USER, { unreadOnly: true });
    const { where } = (prisma.notification.findMany as unknown as jest.Mock).mock.calls[0][0];
    expect(where).toEqual({ userId: USER, readAt: null });
  });

  it("answers 404 (not 403) when marking another user's notification read", async () => {
    prisma.notification.findFirst.mockResolvedValue(null);
    const error = await rejection(service.markRead(OTHER, NOTE));
    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe('NOTIFICATION_NOT_FOUND');
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  // ── read state ─────────────────────────────────────────────────────────────

  it('marks an unread notification read', async () => {
    prisma.notification.findFirst.mockResolvedValue(noteRow());
    prisma.notification.update.mockResolvedValue(noteRow({ readAt: NOW }));
    const dto = await service.markRead(USER, NOTE);
    expect(prisma.notification.update).toHaveBeenCalled();
    expect(dto.readAt).toBe(NOW.toISOString());
  });

  it('is idempotent: re-reading does not move the original readAt', async () => {
    const first = new Date('2026-09-01T09:00:00.000Z');
    prisma.notification.findFirst.mockResolvedValue(noteRow({ readAt: first }));
    const dto = await service.markRead(USER, NOTE);
    expect(prisma.notification.update).not.toHaveBeenCalled();
    expect(dto.readAt).toBe(first.toISOString());
  });

  it('reports how many rows read-all actually changed', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead(USER)).resolves.toEqual({ updated: 3 });
    const { where } = (prisma.notification.updateMany as unknown as jest.Mock).mock.calls[0][0];
    expect(where).toEqual({ userId: USER, readAt: null });
  });

  it('read-all on an already-clear inbox reports zero rather than failing', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markAllRead(USER)).resolves.toEqual({ updated: 0 });
  });

  // ── paging / badge ─────────────────────────────────────────────────────────

  it('carries the unread count alongside the page so the badge is right on any page', async () => {
    prisma.notification.findMany.mockResolvedValue([noteRow()]);
    prisma.notification.count.mockResolvedValue(7);
    const page = await service.list(USER, {});
    expect(page.unreadCount).toBe(7);
  });

  it('returns a cursor only when more rows exist', async () => {
    prisma.notification.findMany.mockResolvedValue([noteRow({ id: 'cnote0000000000000000001' })]);
    const single = await service.list(USER, { limit: 1 });
    expect(single.nextCursor).toBeNull();

    // limit + 1 rows come back => there is a next page.
    prisma.notification.findMany.mockResolvedValue([
      noteRow({ id: 'cnote0000000000000000001' }),
      noteRow({ id: 'cnote0000000000000000002' }),
    ]);
    const paged = await service.list(USER, { limit: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).not.toBeNull();
  });

  it('rejects a malformed cursor as 400, not 500', async () => {
    const error = await rejection(service.list(USER, { cursor: 'not-a-cursor' }));
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('INVALID_CURSOR');
  });

  // ── publish ────────────────────────────────────────────────────────────────

  it('publishes with the wire kind mapped onto the Prisma enum', async () => {
    prisma.notification.create.mockResolvedValue(noteRow());
    await service.publish(USER, { kind: 'account', title: 'Welcome' });
    const { data } = (prisma.notification.create as unknown as jest.Mock).mock.calls[0][0];
    expect(data).toEqual({
      userId: USER,
      kind: NotificationKind.ACCOUNT,
      title: 'Welcome',
      body: null,
      linkUrl: null,
    });
  });

  it('swallows a publish failure so it cannot break the operation that triggered it', async () => {
    prisma.notification.create.mockRejectedValue(new Error('db down'));
    await expect(service.publish(USER, { title: 'Import finished' })).resolves.toBeUndefined();
  });
});
