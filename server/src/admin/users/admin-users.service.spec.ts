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

  describe('plan overrides', () => {
    it('writes the grant columns and never touches the bought plan', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.subscription.upsert.mockResolvedValue({} as never);
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.setPlanOverride(ACTOR, 'cuser000000000000000000001', {
        plan: 'pro',
        days: 30,
        reason: 'beta tester',
      });

      const call = prisma.subscription.upsert.mock.calls[0][0];
      const update = call.update as Record<string, unknown>;
      expect(update['overridePlan']).toBe('PRO');
      expect(update['overrideReason']).toBe('beta tester');
      // `plan` is Dodo's projection — writing it would let the next webhook
      // silently revoke what a human just granted.
      expect('plan' in update).toBe(false);
    });

    it('leaves the grant open-ended when no duration is given', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.subscription.upsert.mockResolvedValue({} as never);
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.setPlanOverride(ACTOR, 'cuser000000000000000000001', { plan: 'team', reason: 'partner' });
      const update = prisma.subscription.upsert.mock.calls[0][0].update as Record<string, unknown>;
      expect(update['overrideUntil']).toBeNull();
    });

    it('creates a row for an account that never went through checkout', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.subscription.upsert.mockResolvedValue({} as never);
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.setPlanOverride(ACTOR, 'cuser000000000000000000001', { plan: 'pro', reason: 'tester' });
      const create = prisma.subscription.upsert.mock.calls[0][0].create as Record<string, unknown>;
      expect(create['dodoCustomerId']).toBe('');
      expect(create['overridePlan']).toBe('PRO');
    });

    it('404s for an unknown account instead of creating an orphan subscription', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setPlanOverride(ACTOR, 'cmissing0000000000000000001', { plan: 'pro', reason: 'x' }),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('reports the GRANTED plan in the list, not the raw column', async () => {
      // The bug this pins: the list read `subscription.plan` (still "free" for
      // a granted account) while the account really had Pro.
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        {
          ...user(),
          subscription: {
            plan: 'FREE',
            status: 'INCOMPLETE',
            overridePlan: 'PRO',
            overrideUntil: new Date(Date.now() + 86_400_000),
          },
        },
      ] as never);
      (prisma.$transaction as unknown as jest.Mock).mockImplementation((ops: unknown[]) => Promise.all(ops));
      (prisma.drawing.groupBy as unknown as jest.Mock).mockResolvedValue([]);

      const page = await service.list({});
      expect(page.items[0].plan).toBe('pro');
    });

    it('reports free once the grant has expired', async () => {
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        {
          ...user(),
          subscription: {
            plan: 'FREE',
            status: 'INCOMPLETE',
            overridePlan: 'PRO',
            overrideUntil: new Date(Date.now() - 1000),
          },
        },
      ] as never);
      (prisma.$transaction as unknown as jest.Mock).mockImplementation((ops: unknown[]) => Promise.all(ops));
      (prisma.drawing.groupBy as unknown as jest.Mock).mockResolvedValue([]);

      const page = await service.list({});
      expect(page.items[0].plan).toBe('free');
    });

    it('clearing a grant that is not there is not an error', async () => {
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
      jest.spyOn(service, 'get').mockResolvedValue({} as never);
      await expect(service.clearPlanOverride(ACTOR, 'cuser000000000000000000001')).resolves.toBeDefined();
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
