import { HttpStatus } from '@nestjs/common';
import { MAX_FOLDER_DEPTH } from '../folders/dto/folder.dto';
import type { Prisma } from '../generated/prisma/client';
import { OrgRole, SharePermission } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiException } from './errors/api-error';

/**
 * What a caller may do with one drawing or folder.
 *
 * - `view` — open, download, list versions, copy elsewhere.
 * - `edit` — everything in `view`, plus save, rename, move within the
 *   workspace, trash/restore, duplicate, restore a version.
 * - `manage` — everything in `edit`, plus share management, moving out of the
 *   workspace and permanent deletion.
 */
export type AccessLevel = 'view' | 'edit' | 'manage';

/** Ordering of `AccessLevel`; higher wins when two grants overlap. */
export const LEVEL_RANK: Record<AccessLevel, number> = { view: 0, edit: 1, manage: 2 };

/**
 * The caller, as every access decision needs them: their local `users.id` and
 * their **lowercased** email, because a `Share` names its person by address
 * (see the `Share` model) rather than by id.
 */
export interface Actor {
  userId: string;
  email: string;
}

/** How a caller reached a row, alongside what they may do with it. */
export interface Access {
  level: AccessLevel;
  /**
   * True when the *only* thing granting access is a share — the row is in
   * somebody else's workspace. The dashboard uses it for the "Shared with me"
   * column, and the editor to avoid offering workspace-only actions.
   */
  viaShare: boolean;
}

/** The columns of a drawing an access decision reads. */
export interface DrawingAccessRow {
  id: string;
  ownerId: string;
  organizationId: string | null;
  folderId: string | null;
}

/** The columns of a folder an access decision reads. */
export interface FolderAccessRow {
  id: string;
  ownerId: string;
  organizationId: string | null;
  parentId: string | null;
}

/** Org role → the level plain membership grants. */
const ROLE_LEVEL: Record<OrgRole, AccessLevel> = {
  [OrgRole.VIEWER]: 'view',
  [OrgRole.MEMBER]: 'edit',
  [OrgRole.ADMIN]: 'manage',
  [OrgRole.OWNER]: 'manage',
};

/**
 * Resolves what `actor` may do with a drawing, or `null` when they cannot see
 * it at all.
 *
 * Design decisions:
 *
 * - **Highest grant wins.** A viewer in an org who was *also* sent an `edit`
 *   share on one drawing can edit that drawing. Taking the first match instead
 *   would make the answer depend on the order the branches happen to run in.
 *
 * - **Resolution is in code, not in the query.** `reachableDrawing` (see
 *   `workspace.ts`) can decide *whether* a row is reachable but not *how far*
 *   the caller may go with it, and folder-share reach needs an ancestor walk
 *   that no single `WHERE` fragment expresses. So the row is fetched by id and
 *   the level computed here: one membership read, one depth-bounded walk of
 *   `parentId`, one shares query.
 *
 * - **A miss is `null`, and callers turn that into 404.** Only once a caller is
 *   known to see the row at all does an insufficient level become an honest
 *   403, which is the same rule `OrganizationsService` follows for orgs.
 */
export async function resolveDrawingAccess(
  prisma: PrismaService,
  actor: Actor,
  row: DrawingAccessRow,
): Promise<Access | null> {
  const workspace = await workspaceLevel(prisma, actor, row);
  const containers = await ancestorFolderIds(prisma, row.folderId);
  const share = await shareLevel(prisma, actor, { drawingIds: [row.id], folderIds: containers });
  return combineAccess(workspace, share);
}

/** `resolveDrawingAccess`, for the folder tree: the folder and its ancestors. */
export async function resolveFolderAccess(
  prisma: PrismaService,
  actor: Actor,
  row: FolderAccessRow,
): Promise<Access | null> {
  const workspace = await workspaceLevel(prisma, actor, row);
  const containers = [row.id, ...(await ancestorFolderIds(prisma, row.parentId))];
  const share = await shareLevel(prisma, actor, { drawingIds: [], folderIds: containers });
  return combineAccess(workspace, share);
}

/**
 * The level `actor` holds by virtue of the workspace the row sits in: `manage`
 * on their own personal rows, their org role's level on an org's rows, and
 * `null` when the row belongs to neither.
 */
async function workspaceLevel(
  prisma: PrismaService,
  actor: Actor,
  row: { ownerId: string; organizationId: string | null },
): Promise<AccessLevel | null> {
  if (row.organizationId === null) {
    return row.ownerId === actor.userId ? 'manage' : null;
  }
  const membership = await prisma.orgMembership.findUnique({
    where: { organizationId_userId: { organizationId: row.organizationId, userId: actor.userId } },
    select: { role: true },
  });
  return membership ? ROLE_LEVEL[membership.role] : null;
}

/**
 * The highest live share reaching `actor`, over a set of drawing ids and
 * container-folder ids. One query: a share targets either their address or an
 * org they belong to, in any role — being handed a drawing is not the same as
 * being a member of the workspace it lives in, so no minimum role applies.
 */
async function shareLevel(
  prisma: PrismaService,
  actor: Actor,
  subjects: { drawingIds: string[]; folderIds: string[] },
): Promise<AccessLevel | null> {
  const subjectFilters: Prisma.ShareWhereInput[] = [];
  if (subjects.drawingIds.length > 0) {
    subjectFilters.push({ drawingId: { in: subjects.drawingIds } });
  }
  if (subjects.folderIds.length > 0) {
    subjectFilters.push({ folderId: { in: subjects.folderIds } });
  }
  if (subjectFilters.length === 0) {
    return null;
  }

  const rows = await prisma.share.findMany({
    where: { AND: [{ OR: subjectFilters }, liveShare(), shareTargets(actor)] },
    select: { permission: true },
  });
  return highestPermission(rows);
}

/** `edit` beats `view`; an empty list is `null`. */
export function highestPermission(rows: { permission: SharePermission }[]): AccessLevel | null {
  let best: AccessLevel | null = null;
  for (const row of rows) {
    const level = permissionLevel(row.permission);
    if (best === null || LEVEL_RANK[level] > LEVEL_RANK[best]) {
      best = level;
    }
  }
  return best;
}

/** `SharePermission` → the level it grants. A share never grants `manage`. */
export function permissionLevel(permission: SharePermission): AccessLevel {
  return permission === SharePermission.EDIT ? 'edit' : 'view';
}

/**
 * Shares that have not expired. Stored as a fragment rather than compared in
 * code so an expired grant disappears from *listings* too, not just from the
 * single-row check.
 */
export function liveShare(now: Date = new Date()): Prisma.ShareWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/** Shares aimed at this caller: their own address, or any org they are in. */
export function shareTargets(actor: Actor): Prisma.ShareWhereInput {
  return {
    OR: [
      { targetEmail: actor.email },
      { targetOrganization: { memberships: { some: { userId: actor.userId } } } },
    ],
  };
}

/**
 * Walks up from `folderId`, collecting it and every ancestor, so a share on any
 * container is found. Depth-bounded like every other `parentId` walk in the
 * codebase (`MAX_FOLDER_DEPTH`): a cycle introduced by bad data must not turn
 * an access check into an infinite loop, and stopping early can only *narrow*
 * what a caller reaches.
 *
 * Deliberately unscoped — the ids are only used to look up shares, never
 * returned, so reading a folder row the caller cannot see leaks nothing.
 */
async function ancestorFolderIds(prisma: PrismaService, folderId: string | null): Promise<string[]> {
  const ids: string[] = [];
  let cursor = folderId;
  for (let depth = 0; cursor !== null && depth < MAX_FOLDER_DEPTH; depth++) {
    ids.push(cursor);
    const parent: { parentId: string | null } | null = await prisma.folder.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
    if (cursor !== null && ids.includes(cursor)) {
      break;
    }
  }
  return ids;
}

/**
 * What the caller may do in a whole workspace, before any single row is
 * considered: `manage` in their own personal space, their role's level in an
 * org, `null` when they do not belong to it.
 *
 * Listings use it as the base level for every row on the page, so a page of
 * thirty drawings costs one membership read rather than thirty resolutions.
 */
export async function workspaceAccess(
  prisma: PrismaService,
  actor: Actor,
  organizationId: string | null,
): Promise<Access | null> {
  const level = await workspaceLevel(prisma, actor, { ownerId: actor.userId, organizationId });
  return level === null ? null : { level, viaShare: false };
}

/**
 * Gate for the DESTINATION half of a move or copy: you must be able to write
 * where you are putting something, which is not the same question as whether
 * you may take it from where it is.
 *
 * A workspace you do not belong to is 404 `ORG_NOT_FOUND` (it must not be
 * distinguishable from one that does not exist); belonging as a viewer is an
 * honest 403, since the org's existence is no longer a secret.
 */
export async function requireWorkspaceEdit(
  prisma: PrismaService,
  actor: Actor,
  organizationId: string | null,
): Promise<Access> {
  const access = await workspaceAccess(prisma, actor, organizationId);
  if (access === null) {
    throw ApiException.notFound('ORG_NOT_FOUND', 'Organization not found');
  }
  return assertLevel(access, 'edit');
}

/**
 * Per-row access for a LISTING: the level the page's context established,
 * raised by a direct share on that row if there is a better one.
 *
 * Listings do not resolve each row from scratch — that would be a membership
 * read and an ancestor walk per row — so the page carries a `base`: the
 * workspace's level, or the level of the folder being browsed, or `null` on a
 * "shared with me" page, where the shares are the only access there is. A row
 * reached through a shared container inherits its `viaShare`, since raising the
 * permission does not change *whose* workspace it lives in.
 */
export function mergeListedAccess(base: Access | null, share: AccessLevel | null): Access {
  if (base === null) {
    return { level: share ?? 'view', viaShare: true };
  }
  if (share !== null && LEVEL_RANK[share] > LEVEL_RANK[base.level]) {
    return { level: share, viaShare: base.viaShare };
  }
  return base;
}

/**
 * Highest of the two branches, and whether a share is the only thing left.
 * Exported because listings compute the two halves in bulk (one workspace
 * level for the page, one shares query for its rows) and then combine per row.
 */
export function combineAccess(workspace: AccessLevel | null, share: AccessLevel | null): Access | null {
  if (workspace === null) {
    return share === null ? null : { level: share, viaShare: true };
  }
  if (share !== null && LEVEL_RANK[share] > LEVEL_RANK[workspace]) {
    return { level: share, viaShare: false };
  }
  return { level: workspace, viaShare: false };
}

/** True when `level` is at least `required`. */
export function allows(level: AccessLevel, required: AccessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[required];
}

/**
 * Turns a resolved level into the answer for an operation that needs
 * `required`: nothing at all is the caller's problem to interpret (`null`, so
 * the caller can raise its own domain 404), and too little is 403 `FORBIDDEN`
 * carrying what was needed and what they have.
 */
export function assertLevel(access: Access, required: AccessLevel): Access {
  if (!allows(access.level, required)) {
    throw forbidden(required, access.level);
  }
  return access;
}

/** 403 with the levels in the body, so a client can explain itself to a user. */
export function forbidden(required: AccessLevel, actual: AccessLevel): ApiException {
  return new ApiException(
    HttpStatus.FORBIDDEN,
    'FORBIDDEN',
    `You have ${actual} access to this item; ${required} access is required`,
    { required, actual },
  );
}
