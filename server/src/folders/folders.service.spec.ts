import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { ApiException } from '../common/errors/api-error';
import type { Folder } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { FoldersService } from './folders.service';

/**
 * Unit spec for the invariants the database cannot express: root-level name
 * uniqueness (Postgres treats NULL `parent_id` values as distinct, so the
 * composite unique index does not cover the root) and cycle-free moves.
 */

const USER = 'cuser00000000000000000001';
const FOLDER = 'cfold00000000000000000001';
const PARENT = 'cfold00000000000000000002';
const CHILD = 'cfold00000000000000000003';

function folderRow(overrides: Partial<Folder> = {}): Folder {
  const now = new Date('2026-08-29T10:00:00.000Z');
  return {
    id: FOLDER,
    ownerId: USER,
    parentId: null,
    name: 'Site plans',
    createdAt: now,
    updatedAt: now,
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

describe('FoldersService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: FoldersService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
    );
    service = new FoldersService(prisma);
  });

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  it("answers 404 (not 403) for another user's folder", async () => {
    prisma.folder.findFirst.mockResolvedValue(null);
    const error = await rejection(service.get('cothr00000000000000000001', FOLDER));
    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe('FOLDER_NOT_FOUND');
  });

  it('answers 404 for a malformed id without querying the database', async () => {
    const error = await rejection(service.get(USER, 'nope'));
    expect(error.getStatus()).toBe(404);
    expect(prisma.folder.findFirst).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Root uniqueness
  // ---------------------------------------------------------------------------

  describe('root-level name uniqueness', () => {
    it('rejects a second root folder with the same name (the unique index cannot)', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'existing' } as unknown as Folder);

      const error = await rejection(service.create(USER, { name: 'Site plans' }));

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('NAME_TAKEN');
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({
        where: { ownerId: USER, parentId: null, name: 'Site plans' },
        select: { id: true },
      });
      expect(prisma.folder.create).not.toHaveBeenCalled();
    });

    it('creates the folder when the name is free', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      prisma.folder.create.mockResolvedValue(folderRow());

      await expect(service.create(USER, { name: '  Site plans  ' })).resolves.toMatchObject({
        id: FOLDER,
        name: 'Site plans',
        parentId: null,
      });
      expect(prisma.folder.create).toHaveBeenCalledWith({
        data: { ownerId: USER, parentId: null, name: 'Site plans' },
      });
    });

    it('maps a racing P2002 to the same 409 NAME_TAKEN', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      prisma.folder.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002', clientVersion: '7' }));

      const error = await rejection(service.create(USER, { name: 'Site plans' }));
      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('NAME_TAKEN');
    });
  });

  // ---------------------------------------------------------------------------
  // Cycles & paths
  // ---------------------------------------------------------------------------

  describe('cycle detection', () => {
    it('rejects moving a folder into its own descendant with 422 FOLDER_CYCLE', async () => {
      // CHILD's parent is FOLDER, so moving FOLDER under CHILD closes a loop.
      prisma.folder.findFirst.mockImplementation((async (args: { where: { id: string } }) => {
        if (args.where.id === FOLDER) return folderRow({ id: FOLDER, parentId: null });
        if (args.where.id === CHILD) return folderRow({ id: CHILD, parentId: FOLDER, name: 'Sub' });
        return null;
      }) as never);

      const error = await rejection(service.update(USER, FOLDER, { parentId: CHILD }));
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('FOLDER_CYCLE');
      expect(prisma.folder.update).not.toHaveBeenCalled();
    });

    it('rejects moving a folder into itself', async () => {
      prisma.folder.findFirst.mockResolvedValue(folderRow());
      const error = await rejection(service.update(USER, FOLDER, { parentId: FOLDER }));
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('FOLDER_CYCLE');
    });

    it('gives up with FOLDER_CYCLE rather than looping when the walk exceeds the depth cap', async () => {
      // A pre-existing cycle in the data: every lookup points at PARENT.
      prisma.folder.findFirst.mockImplementation((async (args: { where: { id: string } }) => {
        if (args.where.id === FOLDER) return folderRow({ id: FOLDER });
        return folderRow({ id: PARENT, parentId: PARENT });
      }) as never);

      const error = await rejection(service.update(USER, FOLDER, { parentId: PARENT }));
      expect(error.code).toBe('FOLDER_CYCLE');
    });
  });

  it('builds the breadcrumb path root-most first', async () => {
    prisma.folder.findFirst.mockImplementation((async (args: { where: { id: string } }) => {
      if (args.where.id === CHILD) return folderRow({ id: CHILD, parentId: PARENT, name: 'Level 2' });
      if (args.where.id === PARENT) return folderRow({ id: PARENT, parentId: null, name: 'Level 1' });
      return null;
    }) as never);

    const dto = await service.get(USER, CHILD);
    expect(dto.path).toEqual([
      { id: PARENT, name: 'Level 1' },
      { id: CHILD, name: 'Level 2' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  describe('remove', () => {
    it('answers 409 FOLDER_NOT_EMPTY without ?force=true', async () => {
      prisma.folder.findFirst.mockResolvedValue(folderRow());
      prisma.folder.findMany.mockResolvedValue([]);
      prisma.folder.count.mockResolvedValue(1);
      prisma.drawing.count.mockResolvedValue(2);

      const error = await rejection(service.remove(USER, FOLDER, false));
      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('FOLDER_NOT_EMPTY');
      expect(error.extra).toEqual({ folders: 1, drawings: 2 });
      expect(prisma.folder.delete).not.toHaveBeenCalled();
    });

    it('with force, trashes every drawing in the subtree and deletes the folder', async () => {
      prisma.folder.findFirst.mockResolvedValue(folderRow());
      prisma.folder.findMany
        .mockResolvedValueOnce([{ id: CHILD }] as never)
        .mockResolvedValueOnce([] as never);
      prisma.folder.count.mockResolvedValue(1);
      prisma.drawing.count.mockResolvedValue(2);
      prisma.drawing.updateMany.mockResolvedValue({ count: 2 });
      prisma.folder.delete.mockResolvedValue(folderRow());

      await expect(service.remove(USER, FOLDER, true)).resolves.toEqual({ id: FOLDER, trashedDrawings: 2 });

      expect(prisma.drawing.updateMany).toHaveBeenCalledWith({
        where: { ownerId: USER, folderId: { in: [FOLDER, CHILD] }, deletedAt: null },
        data: { deletedAt: expect.any(Date) as unknown as Date },
      });
      expect(prisma.folder.delete).toHaveBeenCalledWith({ where: { id: FOLDER } });
    });

    it('deletes an empty folder without force', async () => {
      prisma.folder.findFirst.mockResolvedValue(folderRow());
      prisma.folder.findMany.mockResolvedValue([]);
      prisma.folder.count.mockResolvedValue(0);
      prisma.drawing.count.mockResolvedValue(0);
      prisma.drawing.updateMany.mockResolvedValue({ count: 0 });
      prisma.folder.delete.mockResolvedValue(folderRow());

      await expect(service.remove(USER, FOLDER, false)).resolves.toEqual({ id: FOLDER, trashedDrawings: 0 });
    });
  });
});
