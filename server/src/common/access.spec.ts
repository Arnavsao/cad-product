import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { OrgRole, SharePermission } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  mergeListedAccess,
  requireWorkspaceEdit,
  resolveDrawingAccess,
  resolveFolderAccess,
  type Access,
  type Actor,
} from './access';
import type { ApiException } from './errors/api-error';

/**
 * Unit spec for the single source of truth on "what may this person do with
 * this row" (`common/access.ts`).
 *
 * Prisma is a deep mock, because what is being asserted is the *decision* —
 * which branch wins when several apply, which questions are asked of the
 * database, and that an unreachable row yields `null` rather than a level —
 * not whether Postgres can filter rows.
 */

const ME = 'cuser00000000000000000001';
const OTHER = 'cothr00000000000000000001';
const ORG = 'corg000000000000000000001';
const OTHER_ORG = 'corg000000000000000000002';
const DRAWING = 'cdraw00000000000000000001';
const FOLDER = 'cfold00000000000000000001';
const PARENT = 'cfold00000000000000000002';

const actor: Actor = { userId: ME, email: 'me@example.com' };

/** A personal drawing owned by `ownerId`, at the root of its workspace. */
function drawing(overrides: Partial<{ ownerId: string; organizationId: string | null; folderId: string | null }> = {}) {
  return { id: DRAWING, ownerId: OTHER, organizationId: null, folderId: null, ...overrides };
}

function folder(overrides: Partial<{ ownerId: string; organizationId: string | null; parentId: string | null }> = {}) {
  return { id: FOLDER, ownerId: OTHER, organizationId: null, parentId: null, ...overrides };
}

async function rejection(promise: Promise<unknown>): Promise<ApiException> {
  try {
    await promise;
  } catch (error) {
    return error as ApiException;
  }
  throw new Error('expected the promise to reject');
}

describe('access', () => {
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    // Default world: the caller belongs to nothing and nothing is shared.
    prisma.orgMembership.findUnique.mockResolvedValue(null);
    prisma.share.findMany.mockResolvedValue([]);
    prisma.folder.findUnique.mockResolvedValue(null);
  });

  // ---------------------------------------------------------------------------
  // Workspace branch
  // ---------------------------------------------------------------------------

  it('gives the owner of a personal drawing manage, without asking about membership', async () => {
    const access = await resolveDrawingAccess(prisma, actor, drawing({ ownerId: ME }));

    expect(access).toEqual<Access>({ level: 'manage', viaShare: false });
    expect(prisma.orgMembership.findUnique).not.toHaveBeenCalled();
  });

  it("answers null (→ 404) for a stranger's personal drawing", async () => {
    await expect(resolveDrawingAccess(prisma, actor, drawing())).resolves.toBeNull();
  });

  it.each([
    [OrgRole.VIEWER, 'view'],
    [OrgRole.MEMBER, 'edit'],
    [OrgRole.ADMIN, 'manage'],
    [OrgRole.OWNER, 'manage'],
  ])('maps the %s role to %s on an org drawing', async (role, level) => {
    prisma.orgMembership.findUnique.mockResolvedValue({ role } as never);

    const access = await resolveDrawingAccess(prisma, actor, drawing({ organizationId: ORG }));

    expect(access).toEqual<Access>({ level: level as Access['level'], viaShare: false });
    expect(prisma.orgMembership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: ORG, userId: ME } },
      select: { role: true },
    });
  });

  it('answers null for an org drawing the caller has no membership of', async () => {
    await expect(resolveDrawingAccess(prisma, actor, drawing({ organizationId: ORG }))).resolves.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Share branch
  // ---------------------------------------------------------------------------

  it('reaches a stranger’s drawing through a direct share, flagged viaShare', async () => {
    prisma.share.findMany.mockResolvedValue([{ permission: SharePermission.VIEW }] as never);

    const access = await resolveDrawingAccess(prisma, actor, drawing());

    expect(access).toEqual<Access>({ level: 'view', viaShare: true });
  });

  it('honours an edit share', async () => {
    prisma.share.findMany.mockResolvedValue([{ permission: SharePermission.EDIT }] as never);
    await expect(resolveDrawingAccess(prisma, actor, drawing())).resolves.toEqual<Access>({
      level: 'edit',
      viaShare: true,
    });
  });

  it('finds a share on an ANCESTOR folder, walking parentId', async () => {
    // The drawing sits in FOLDER, whose parent is PARENT; only PARENT is shared.
    prisma.folder.findUnique.mockImplementation((async (args: { where: { id: string } }) =>
      args.where.id === FOLDER ? { parentId: PARENT } : { parentId: null }) as never);
    prisma.share.findMany.mockResolvedValue([{ permission: SharePermission.EDIT }] as never);

    const access = await resolveDrawingAccess(prisma, actor, drawing({ folderId: FOLDER }));

    expect(access).toEqual<Access>({ level: 'edit', viaShare: true });
    // Both containers are offered to the query — a share on either reaches it.
    expect(prisma.share.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { OR: [{ drawingId: { in: [DRAWING] } }, { folderId: { in: [FOLDER, PARENT] } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) as unknown as Date } }] },
          {
            OR: [
              { targetEmail: 'me@example.com' },
              { targetOrganization: { memberships: { some: { userId: ME } } } },
            ],
          },
        ],
      },
      select: { permission: true },
    });
  });

  it('accepts a share aimed at an organization the caller is in — the query says so', async () => {
    // The org branch is a relation filter, so this asserts the *shape* of the
    // question: a row coming back at all means the database matched one of the
    // two target branches.
    prisma.share.findMany.mockResolvedValue([{ permission: SharePermission.VIEW }] as never);

    await expect(resolveDrawingAccess(prisma, actor, drawing({ organizationId: OTHER_ORG }))).resolves.toEqual<
      Access
    >({ level: 'view', viaShare: true });

    const where = (prisma.share.findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[2]).toEqual({
      OR: [
        { targetEmail: 'me@example.com' },
        { targetOrganization: { memberships: { some: { userId: ME } } } },
      ],
    });
  });

  it('never sees an expired share, because the filter excludes it', async () => {
    // The live-share predicate is part of the query, so an expired row simply
    // does not come back and the caller falls through to 404.
    await expect(resolveDrawingAccess(prisma, actor, drawing())).resolves.toBeNull();

    const where = (prisma.share.findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[1]).toEqual({
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) as unknown as Date } }],
    });
  });

  it('lets the higher grant win: a viewer with an edit share can edit that drawing', async () => {
    prisma.orgMembership.findUnique.mockResolvedValue({ role: OrgRole.VIEWER } as never);
    prisma.share.findMany.mockResolvedValue([{ permission: SharePermission.EDIT }] as never);

    // `viaShare` stays false: the row is still in a workspace they belong to.
    await expect(resolveDrawingAccess(prisma, actor, drawing({ organizationId: ORG }))).resolves.toEqual<Access>({
      level: 'edit',
      viaShare: false,
    });
  });

  it('does not let a share LOWER what the workspace already granted', async () => {
    prisma.orgMembership.findUnique.mockResolvedValue({ role: OrgRole.ADMIN } as never);
    prisma.share.findMany.mockResolvedValue([{ permission: SharePermission.VIEW }] as never);

    await expect(resolveDrawingAccess(prisma, actor, drawing({ organizationId: ORG }))).resolves.toEqual<Access>({
      level: 'manage',
      viaShare: false,
    });
  });

  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------

  it('resolves a folder against itself and its ancestors', async () => {
    prisma.folder.findUnique.mockResolvedValue({ parentId: null } as never);
    prisma.share.findMany.mockResolvedValue([{ permission: SharePermission.VIEW }] as never);

    const access = await resolveFolderAccess(prisma, actor, folder({ parentId: PARENT }));

    expect(access).toEqual<Access>({ level: 'view', viaShare: true });
    const where = (prisma.share.findMany.mock.calls[0][0] as { where: { AND: [{ OR: unknown[] }] } }).where;
    expect(where.AND[0]).toEqual({ OR: [{ folderId: { in: [FOLDER, PARENT] } }] });
  });

  it('stops the ancestor walk on a pre-existing cycle instead of looping', async () => {
    // Bad data: the parent points back at the child. A depth cap is the only
    // defence, and stopping early can only narrow what the caller reaches.
    prisma.folder.findUnique.mockResolvedValue({ parentId: FOLDER } as never);

    await expect(resolveFolderAccess(prisma, actor, folder({ parentId: PARENT }))).resolves.toBeNull();
    expect(prisma.folder.findUnique.mock.calls.length).toBeLessThanOrEqual(21);
  });

  // ---------------------------------------------------------------------------
  // Destination side of a move / copy
  // ---------------------------------------------------------------------------

  describe('requireWorkspaceEdit', () => {
    it('passes for the caller’s own personal workspace', async () => {
      await expect(requireWorkspaceEdit(prisma, actor, null)).resolves.toEqual<Access>({
        level: 'manage',
        viaShare: false,
      });
    });

    it('answers 404 ORG_NOT_FOUND for an org the caller does not belong to', async () => {
      const error = await rejection(requireWorkspaceEdit(prisma, actor, ORG));
      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('ORG_NOT_FOUND');
    });

    it('answers 403 FORBIDDEN for a viewer, carrying the required and actual levels', async () => {
      prisma.orgMembership.findUnique.mockResolvedValue({ role: OrgRole.VIEWER } as never);

      const error = await rejection(requireWorkspaceEdit(prisma, actor, ORG));
      expect(error.getStatus()).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
      expect(error.extra).toEqual({ required: 'edit', actual: 'view' });
    });

    it('passes for a plain member', async () => {
      prisma.orgMembership.findUnique.mockResolvedValue({ role: OrgRole.MEMBER } as never);
      await expect(requireWorkspaceEdit(prisma, actor, ORG)).resolves.toMatchObject({ level: 'edit' });
    });
  });

  // ---------------------------------------------------------------------------
  // Listings
  // ---------------------------------------------------------------------------

  describe('mergeListedAccess', () => {
    it('treats a page with no base as reached purely by share', () => {
      expect(mergeListedAccess(null, 'edit')).toEqual<Access>({ level: 'edit', viaShare: true });
      expect(mergeListedAccess(null, null)).toEqual<Access>({ level: 'view', viaShare: true });
    });

    it('raises the base when a row carries a better share', () => {
      expect(mergeListedAccess({ level: 'view', viaShare: false }, 'edit')).toEqual<Access>({
        level: 'edit',
        viaShare: false,
      });
    });

    it('keeps the base when the share is no better, and keeps its viaShare', () => {
      expect(mergeListedAccess({ level: 'manage', viaShare: false }, 'edit')).toEqual<Access>({
        level: 'manage',
        viaShare: false,
      });
      expect(mergeListedAccess({ level: 'view', viaShare: true }, 'edit')).toEqual<Access>({
        level: 'edit',
        viaShare: true,
      });
    });
  });
});
