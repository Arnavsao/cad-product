import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { OrgRole, PlatformRole, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOrgsService } from './admin-orgs.service';

const ACTOR = { id: 'cadmin00000000000000000001', email: 'admin@example.com', platformRole: PlatformRole.ADMIN } as User;
const ORG_ID = 'corg0000000000000000000001';

describe('AdminOrgsService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: AdminOrgsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new AdminOrgsService(prisma);
  });

  describe('transferOwnership', () => {
    it('refuses somebody who is not a member', async () => {
      prisma.orgMembership.findUnique.mockResolvedValue(null);
      await expect(service.transferOwnership(ACTOR, ORG_ID, 'cuser1')).rejects.toMatchObject({
        code: 'NOT_A_MEMBER',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when they already own it', async () => {
      prisma.orgMembership.findUnique.mockResolvedValue({
        role: OrgRole.OWNER,
        user: { email: 'owner@example.com' },
      } as never);
      await expect(service.transferOwnership(ACTOR, ORG_ID, 'cuser1')).rejects.toMatchObject({
        code: 'ALREADY_OWNER',
      });
    });

    it('demotes the old owners and promotes in ONE transaction', async () => {
      prisma.orgMembership.findUnique.mockResolvedValue({
        role: OrgRole.MEMBER,
        user: { email: 'next@example.com' },
      } as never);
      (prisma.$transaction as unknown as jest.Mock).mockResolvedValue([]);
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.transferOwnership(ACTOR, ORG_ID, 'cuser1');

      // Both writes in one call: an organization must never be momentarily
      // ownerless between the demote and the promote.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = (prisma.$transaction as unknown as jest.Mock).mock.calls[0][0];
      expect(ops).toHaveLength(2);
    });

    it('demotes the previous owner to admin rather than removing them', async () => {
      prisma.orgMembership.findUnique.mockResolvedValue({
        role: OrgRole.MEMBER,
        user: { email: 'next@example.com' },
      } as never);
      (prisma.$transaction as unknown as jest.Mock).mockResolvedValue([]);
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.transferOwnership(ACTOR, ORG_ID, 'cuser1');

      const demote = prisma.orgMembership.updateMany.mock.calls[0][0];
      expect((demote.data as { role: OrgRole }).role).toBe(OrgRole.ADMIN);
      expect(prisma.orgMembership.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('404s for an unknown organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.rename(ACTOR, ORG_ID, 'New name')).rejects.toMatchObject({ code: 'ORG_NOT_FOUND' });
    });

    it('changes the name but NOT the slug', async () => {
      prisma.organization.findUnique.mockResolvedValue({ name: 'Old' } as never);
      prisma.organization.update.mockResolvedValue({} as never);
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.rename(ACTOR, ORG_ID, '  Acme Design  ');

      const data = prisma.organization.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data['name']).toBe('Acme Design');
      // The slug is in join links members already hold.
      expect('slug' in data).toBe(false);
    });
  });
});
