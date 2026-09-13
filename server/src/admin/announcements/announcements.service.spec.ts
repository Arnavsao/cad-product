import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { NotificationKind, PlatformRole, type Announcement, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnnouncementsService } from './announcements.service';

const ACTOR = { id: 'cadmin00000000000000000001', email: 'admin@example.com', platformRole: PlatformRole.ADMIN } as User;

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'cann0000000000000000000001',
    title: 'Scheduled maintenance',
    body: 'CADO will be read-only for ten minutes at 22:00 UTC.',
    kind: NotificationKind.SYSTEM,
    linkUrl: null,
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: null,
    audience: null,
    pushToInbox: false,
    publishedAt: null,
    createdById: ACTOR.id,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  } as Announcement;
}

describe('AnnouncementsService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: AnnouncementsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new AnnouncementsService(prisma);
  });

  describe('publish', () => {
    it('refuses to publish twice', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement({ publishedAt: new Date() }));
      // With pushToInbox on, a second publish would put the same message in
      // everybody's inbox again — and it cannot be recalled.
      await expect(service.publish(ACTOR, 'cann0000000000000000000001')).rejects.toMatchObject({
        code: 'ALREADY_PUBLISHED',
      });
    });

    it('does not touch the inbox when pushToInbox is off', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement({ pushToInbox: false }));
      prisma.announcement.update.mockResolvedValue(announcement({ publishedAt: new Date() }) as never);

      const result = await service.publish(ACTOR, 'cann0000000000000000000001');

      expect(result.notified).toBe(0);
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('fans out in batches and skips suspended and deleted accounts', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement({ pushToInbox: true }));
      prisma.announcement.update.mockResolvedValue(announcement({ publishedAt: new Date() }) as never);
      prisma.user.findMany.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }] as never);
      prisma.notification.createMany.mockResolvedValue({ count: 2 });

      const result = await service.publish(ACTOR, 'cann0000000000000000000001');

      expect(result.notified).toBe(2);
      const where = prisma.user.findMany.mock.calls[0][0]?.where as Record<string, unknown>;
      // A suspended user reading product news while locked out reads as a
      // system that does not know what it is doing.
      expect(where).toEqual({ deletedAt: null, suspendedAt: null });
    });

    it('pages until a short batch ends it', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement({ pushToInbox: true }));
      prisma.announcement.update.mockResolvedValue(announcement({ publishedAt: new Date() }) as never);

      const full = Array.from({ length: 500 }, (_, i) => ({ id: `u${i}` }));
      prisma.user.findMany
        .mockResolvedValueOnce(full as never)
        .mockResolvedValueOnce([{ id: 'last' }] as never);
      prisma.notification.createMany.mockResolvedValueOnce({ count: 500 }).mockResolvedValueOnce({ count: 1 });

      const result = await service.publish(ACTOR, 'cann0000000000000000000001');

      expect(result.notified).toBe(501);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
      // The second page continues after the last id of the first.
      expect(prisma.user.findMany.mock.calls[1][0]?.cursor).toEqual({ id: 'u499' });
    });
  });

  describe('active', () => {
    it('asks only for published announcements inside their window', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);
      await service.active();

      const where = prisma.announcement.findMany.mock.calls[0][0]?.where as Record<string, unknown>;
      expect(where['publishedAt']).toEqual({ not: null });
      expect(where['OR']).toEqual([{ endsAt: null }, { endsAt: { gt: jasmineAny() } }]);
    });
  });

  describe('update', () => {
    it('changes only the fields it was given', async () => {
      jest.spyOn(service, 'get').mockResolvedValue({} as never);
      prisma.announcement.update.mockResolvedValue(announcement() as never);

      await service.update('cann0000000000000000000001', { title: 'New title' });

      const data = prisma.announcement.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(Object.keys(data)).toEqual(['title']);
    });
  });
});

/** Jest has no `jasmine.any`; a Date is all this assertion needs to know. */
function jasmineAny(): unknown {
  return expect.any(Date);
}
