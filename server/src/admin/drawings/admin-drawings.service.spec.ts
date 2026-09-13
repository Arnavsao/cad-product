import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { PlatformRole, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AdminDrawingsService } from './admin-drawings.service';

const ACTOR = { id: 'cadmin00000000000000000001', email: 'admin@example.com', platformRole: PlatformRole.ADMIN } as User;

/** Turns an array into the async iterable `listKeys` returns. */
async function* keys(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

describe('AdminDrawingsService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let storage: DeepMockProxy<StorageService>;
  let service: AdminDrawingsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    storage = mockDeep<StorageService>();
    service = new AdminDrawingsService(prisma, storage);
  });

  describe('purge', () => {
    it('deletes objects under the OWNER prefix, not the acting staff member', async () => {
      prisma.drawing.findUnique.mockResolvedValue({
        id: 'cdraw1',
        ownerId: 'cowner1',
        byteSize: 2048,
        name: 'Bridge GA',
      } as never);
      prisma.drawing.delete.mockResolvedValue({} as never);

      await service.purge(ACTOR, 'cdraw1', 'duplicate upload');

      // The objects live under the creator's prefix. Using the caller's id
      // would silently leave the real files behind forever.
      expect(storage.deletePrefix).toHaveBeenCalledWith('users/cowner1/drawings/cdraw1/');
    });

    it('deletes the row before the objects', async () => {
      const order: string[] = [];
      prisma.drawing.findUnique.mockResolvedValue({
        id: 'cdraw1',
        ownerId: 'cowner1',
        byteSize: 1,
        name: 'x',
      } as never);
      prisma.drawing.delete.mockImplementation((() => {
        order.push('row');
        return Promise.resolve({});
      }) as never);
      storage.deletePrefix.mockImplementation(() => {
        order.push('objects');
        return Promise.resolve(1);
      });

      await service.purge(ACTOR, 'cdraw1', 'reason');
      // An orphaned object is sweepable garbage; an orphaned row is a broken
      // drawing in somebody's list.
      expect(order).toEqual(['row', 'objects']);
    });

    it('still reports success when object cleanup fails', async () => {
      prisma.drawing.findUnique.mockResolvedValue({
        id: 'cdraw1',
        ownerId: 'cowner1',
        byteSize: 10,
        name: 'x',
      } as never);
      prisma.drawing.delete.mockResolvedValue({} as never);
      storage.deletePrefix.mockRejectedValue(new Error('bucket unreachable'));

      await expect(service.purge(ACTOR, 'cdraw1', 'reason')).resolves.toEqual({ id: 'cdraw1', bytesFreed: 10 });
    });

    it('404s rather than deleting nothing quietly', async () => {
      prisma.drawing.findUnique.mockResolvedValue(null);
      await expect(service.purge(ACTOR, 'cmissing', 'reason')).rejects.toMatchObject({
        code: 'DRAWING_NOT_FOUND',
      });
    });
  });

  describe('restore', () => {
    it('refuses a drawing that is not in the trash', async () => {
      prisma.drawing.findUnique.mockResolvedValue({ id: 'cdraw1', deletedAt: null } as never);
      await expect(service.restore(ACTOR, 'cdraw1')).rejects.toMatchObject({ code: 'NOT_DELETED' });
    });
  });

  describe('orphans', () => {
    it('reports objects whose drawing row is gone', async () => {
      storage.listKeys.mockReturnValue(keys('users/u1/drawings/gone/v1.dxf', 'users/u1/drawings/kept/v1.dxf'));
      prisma.drawing.findMany.mockResolvedValueOnce([{ id: 'kept' }] as never);
      storage.headObject.mockResolvedValue({ size: 4096 } as never);
      prisma.drawing.findMany.mockResolvedValueOnce([] as never);

      const report = await service.orphans();

      expect(report.orphanedObjects).toEqual([{ key: 'users/u1/drawings/gone/v1.dxf', bytes: 4096 }]);
      expect(report.reclaimableBytes).toBe(4096);
    });

    it('ignores keys that are not drawing payloads', async () => {
      storage.listKeys.mockReturnValue(keys('users/u1/uploads/abc/file.dxf'));
      prisma.drawing.findMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);

      const report = await service.orphans();
      // An upload awaiting import is not an orphan; it has no drawing row yet
      // by design.
      expect(report.orphanedObjects).toEqual([]);
    });

    it('reports a row whose payload object is missing', async () => {
      storage.listKeys.mockReturnValue(keys());
      prisma.drawing.findMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([
        { id: 'd1', name: 'Broken', storageKey: 'users/u1/drawings/d1/v1.dxf', owner: { email: 'a@b.c' } },
      ] as never);
      storage.headObject.mockResolvedValue(null);

      const report = await service.orphans();
      expect(report.brokenDrawings).toEqual([
        { id: 'd1', name: 'Broken', ownerEmail: 'a@b.c', storageKey: 'users/u1/drawings/d1/v1.dxf' },
      ]);
    });
  });

  describe('purgeOrphans', () => {
    it('re-scans rather than trusting a list from the client', async () => {
      const scan = jest.spyOn(service, 'orphans').mockResolvedValue({
        orphanedObjects: [{ key: 'users/u1/drawings/gone/v1.dxf', bytes: 10 }],
        brokenDrawings: [],
        truncated: false,
        scannedObjects: 1,
        reclaimableBytes: 10,
      });
      storage.deleteObjects.mockResolvedValue(1);

      const result = await service.purgeOrphans(ACTOR);

      expect(scan).toHaveBeenCalled();
      expect(storage.deleteObjects).toHaveBeenCalledWith(['users/u1/drawings/gone/v1.dxf']);
      expect(result).toEqual({ deleted: 1, bytesFreed: 10 });
    });

    it('does nothing when there is nothing to sweep', async () => {
      jest.spyOn(service, 'orphans').mockResolvedValue({
        orphanedObjects: [],
        brokenDrawings: [],
        truncated: false,
        scannedObjects: 0,
        reclaimableBytes: 0,
      });
      await service.purgeOrphans(ACTOR);
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });
  });
});
