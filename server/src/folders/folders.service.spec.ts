import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Actor } from '../common/access';
import type { ApiException } from '../common/errors/api-error';
import type { Folder } from '../generated/prisma/client';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FoldersService } from './folders.service';

/**
 * Unit spec for the invariants the service owns rather than the database:
 * sibling-name uniqueness at the root (Postgres treats NULL `parent_id` values
 * as distinct, so the pre-check is what produces a usable 409), cycle-free
 * moves, and the workspace boundary between personal and organization trees.
 */

const USER = 'cuser00000000000000000001';
const FOLDER = 'cfold00000000000000000001';
const PARENT = 'cfold00000000000000000002';
const CHILD = 'cfold00000000000000000003';
const ORG = 'corg000000000000000000001';

/** The `WHERE` fragment `folderScope` produces for a personal workspace. */
const PERSONAL_SCOPE = { ownerId: USER, organizationId: null };

/** The caller as `common/access.ts` wants them: an id plus a lowercased email. */
function actorOf(userId: string): Actor {
  return { userId, email: `${userId}@example.com` };
}

const ME = actorOf(USER);

function folderRow(overrides: Partial<Folder> = {}): Folder {
  const now = new Date('2026-08-29T10:00:00.000Z');
  return {
    id: FOLDER,
    ownerId: USER,
    organizationId: null,
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
  let organizations: DeepMockProxy<OrganizationsService>;
  let service: FoldersService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    organizations = mockDeep<OrganizationsService>();
    // Default: every request resolves to the caller's personal workspace.
    organizations.resolveWorkspace.mockImplementation(async (userId, organizationId) => ({
      userId,
      organizationId: organizationId ?? null,
    }));
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
    );
    // Access resolution (`common/access.ts`) asks two more questions on every
    // single-row path: the caller's membership of the row's org, and the live
    // shares reaching them. Default: neither exists, so a personal folder
    // resolves purely from `ownerId`.
    prisma.orgMembership.findUnique.mockResolvedValue(null);
    prisma.share.findMany.mockResolvedValue([]);
    service = new FoldersService(prisma, organizations);
  });

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  it("answers 404 (not 403) for another user's folder", async () => {
    prisma.folder.findFirst.mockResolvedValue(null);
    const error = await rejection(service.get(actorOf('cothr00000000000000000001'), FOLDER));
    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe('FOLDER_NOT_FOUND');
  });

  it('answers 404 for a malformed id without querying the database', async () => {
    const error = await rejection(service.get(ME, 'nope'));
    expect(error.getStatus()).toBe(404);
    expect(prisma.folder.findFirst).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Root uniqueness
  // ---------------------------------------------------------------------------

  describe('root-level name uniqueness', () => {
    it('rejects a second root folder with the same name (the unique index cannot)', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'existing' } as unknown as Folder);

      const error = await rejection(service.create(ME, { name: 'Site plans' }));

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('NAME_TAKEN');
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({
        where: { ...PERSONAL_SCOPE, parentId: null, name: 'Site plans' },
        select: { id: true },
      });
      expect(prisma.folder.create).not.toHaveBeenCalled();
    });

    it('creates the folder when the name is free', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      prisma.folder.create.mockResolvedValue(folderRow());

      await expect(service.create(ME, { name: '  Site plans  ' })).resolves.toMatchObject({
        id: FOLDER,
        name: 'Site plans',
        parentId: null,
        organizationId: null,
      });
      expect(prisma.folder.create).toHaveBeenCalledWith({
        data: { ownerId: USER, organizationId: null, parentId: null, name: 'Site plans' },
        include: expect.anything() as never,
      });
    });

    it('maps a racing P2002 to the same 409 NAME_TAKEN', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      prisma.folder.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002', clientVersion: '7' }));

      const error = await rejection(service.create(ME, { name: 'Site plans' }));
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

      const error = await rejection(service.update(ME, FOLDER, { parentId: CHILD }));
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('FOLDER_CYCLE');
      expect(prisma.folder.update).not.toHaveBeenCalled();
    });

    it('rejects moving a folder into itself', async () => {
      prisma.folder.findFirst.mockResolvedValue(folderRow());
      const error = await rejection(service.update(ME, FOLDER, { parentId: FOLDER }));
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('FOLDER_CYCLE');
    });

    it('gives up with FOLDER_CYCLE rather than looping when the walk exceeds the depth cap', async () => {
      // A pre-existing cycle in the data: every lookup points at PARENT.
      prisma.folder.findFirst.mockImplementation((async (args: { where: { id: string } }) => {
        if (args.where.id === FOLDER) return folderRow({ id: FOLDER });
        return folderRow({ id: PARENT, parentId: PARENT });
      }) as never);

      const error = await rejection(service.update(ME, FOLDER, { parentId: PARENT }));
      expect(error.code).toBe('FOLDER_CYCLE');
    });
  });

  it('builds the breadcrumb path root-most first', async () => {
    prisma.folder.findFirst.mockImplementation((async (args: { where: { id: string } }) => {
      if (args.where.id === CHILD) return folderRow({ id: CHILD, parentId: PARENT, name: 'Level 2' });
      if (args.where.id === PARENT) return folderRow({ id: PARENT, parentId: null, name: 'Level 1' });
      return null;
    }) as never);

    const dto = await service.get(ME, CHILD);
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

      const error = await rejection(service.remove(ME, FOLDER, false));
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

      await expect(service.remove(ME, FOLDER, true)).resolves.toEqual({ id: FOLDER, trashedDrawings: 2 });

      expect(prisma.drawing.updateMany).toHaveBeenCalledWith({
        where: { ...PERSONAL_SCOPE, folderId: { in: [FOLDER, CHILD] }, deletedAt: null },
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

      await expect(service.remove(ME, FOLDER, false)).resolves.toEqual({ id: FOLDER, trashedDrawings: 0 });
    });

    it("scopes the trash sweep to the org, so a teammate's drawings are counted", async () => {
      // Regression guard: scoping by `ownerId` here would report the folder as
      // empty and then bin drawings the caller did not create.
      prisma.folder.findFirst.mockResolvedValue(folderRow({ organizationId: ORG }));
      prisma.orgMembership.findUnique.mockResolvedValue({ role: 'MEMBER' } as never);
      prisma.folder.findMany.mockResolvedValue([]);
      prisma.folder.count.mockResolvedValue(0);
      prisma.drawing.count.mockResolvedValue(3);

      const error = await rejection(service.remove(ME, FOLDER, false));
      expect(error.code).toBe('FOLDER_NOT_EMPTY');
      expect(error.extra).toEqual({ folders: 0, drawings: 3 });
      expect(prisma.drawing.count).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          organization: { memberships: { some: { userId: USER } } },
          folderId: { in: [FOLDER] },
          deletedAt: null,
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  describe('workspaces', () => {
    it('inherits the parent folder’s organization instead of the requested one', async () => {
      // The body asks for a personal folder, but the parent is an org folder;
      // honouring the body would leave the subtree straddling two workspaces.
      prisma.folder.findFirst
        .mockResolvedValueOnce(folderRow({ id: PARENT, organizationId: ORG }))
        .mockResolvedValueOnce(null);
      prisma.orgMembership.findUnique.mockResolvedValue({ role: 'MEMBER' } as never);
      prisma.folder.create.mockResolvedValue(folderRow({ organizationId: ORG }));

      await service.create(ME, { name: 'Sub', parentId: PARENT, organizationId: null });

      expect(prisma.folder.create).toHaveBeenCalledWith({
        data: { ownerId: USER, organizationId: ORG, parentId: PARENT, name: 'Sub' },
        include: expect.anything() as never,
      });
    });

    it('refuses to move a personal folder under an org folder', async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce(folderRow({ id: FOLDER, organizationId: null }))
        .mockResolvedValueOnce(folderRow({ id: PARENT, organizationId: ORG }));
      prisma.orgMembership.findUnique.mockResolvedValue({ role: 'MEMBER' } as never);

      const error = await rejection(service.update(ME, FOLDER, { parentId: PARENT }));
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('CROSS_WORKSPACE_MOVE');
      expect(prisma.folder.update).not.toHaveBeenCalled();
    });

    it('checks membership before listing an org tree', async () => {
      organizations.resolveWorkspace.mockRejectedValue(
        Object.assign(new Error('nope'), { code: 'ORG_NOT_FOUND' }),
      );
      await expect(service.list(ME, { organizationId: ORG })).rejects.toBeDefined();
      expect(prisma.folder.findMany).not.toHaveBeenCalled();
    });
  });
});
