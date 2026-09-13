import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { ApiException } from '../../common/errors/api-error';
import { PlatformRole, type User } from '../../generated/prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'cuser000000000000000000001',
    authId: '00000000-0000-4000-8000-000000000001',
    email: 'person@example.com',
    firstName: null,
    lastName: null,
    imageUrl: null,
    onboardedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    platformRole: PlatformRole.USER,
    suspendedAt: null,
    suspendedReason: null,
    lastSeenAt: null,
    ...overrides,
  };
}

const ACTOR = user({ id: 'cadmin00000000000000000001', email: 'admin@example.com', platformRole: PlatformRole.ADMIN });

describe('AdminUsersService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: AdminUsersService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new AdminUsersService(prisma, mockDeep<NotificationsService>());
  });

  describe('suspend', () => {
    it('refuses to suspend the actor themselves', async () => {
      await expect(service.suspend(ACTOR, ACTOR.id, 'oops')).rejects.toMatchObject({
        code: 'CANNOT_TARGET_SELF',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a target that is itself staff', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ platformRole: PlatformRole.OWNER }));
      await expect(service.suspend(ACTOR, 'cuser000000000000000000001', 'why')).rejects.toMatchObject({
        code: 'TARGET_IS_STAFF',
      });
    });

    it('404s on an unknown target rather than reporting success', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.suspend(ACTOR, 'cmissing0000000000000000001', 'why')).rejects.toBeInstanceOf(ApiException);
    });

    it('refuses to suspend an account that already is', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ suspendedAt: new Date() }));
      await expect(service.suspend(ACTOR, 'cuser000000000000000000001', 'why')).rejects.toMatchObject({
        code: 'ALREADY_SUSPENDED',
      });
    });

    it('stores the reason alongside the timestamp', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.suspend(ACTOR, 'cuser000000000000000000001', 'spamming uploads');

      const data = prisma.user.update.mock.calls[0][0].data as { suspendedReason: string; suspendedAt: Date };
      expect(data.suspendedReason).toBe('spamming uploads');
      expect(data.suspendedAt).toBeInstanceOf(Date);
    });
  });

  describe('setStaffRole', () => {
    it('refuses to change the actor’s own role', async () => {
      await expect(service.setStaffRole(ACTOR, ACTOR.id, 'owner')).rejects.toMatchObject({
        code: 'CANNOT_CHANGE_OWN_ROLE',
      });
    });

    it('refuses to demote the last owner', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ platformRole: PlatformRole.OWNER }));
      prisma.user.count.mockResolvedValue(1);
      await expect(service.setStaffRole(ACTOR, 'cuser000000000000000000001', 'admin')).rejects.toMatchObject({
        code: 'LAST_OWNER',
      });
    });

    it('allows demoting an owner when another remains', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ platformRole: PlatformRole.OWNER }));
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue(user({ platformRole: PlatformRole.ADMIN }) as never);
      // `groupBy` is generic enough that the mock helper cannot infer it.
      (prisma.drawing.groupBy as unknown as jest.Mock).mockResolvedValue([]);

      const row = await service.setStaffRole(ACTOR, 'cuser000000000000000000001', 'admin');
      expect(row.platformRole).toBe('admin');
    });

    it('rejects a role outside the enum', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      await expect(
        service.setStaffRole(ACTOR, 'cuser000000000000000000001', 'superuser' as never),
      ).rejects.toThrow(RangeError);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt without touching the drawings', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.softDelete(ACTOR, 'cuser000000000000000000001', 'requested by owner');

      const data = prisma.user.update.mock.calls[0][0].data as { deletedAt: Date };
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(prisma.drawing.deleteMany).not.toHaveBeenCalled();
    });
  });
});
