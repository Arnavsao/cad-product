import { liveShare, shareTargets, type Actor } from './access';
import type { Prisma } from '../generated/prisma/client';

/**
 * Which workspace a request is acting in.
 *
 * `null` organization = the caller's personal workspace; a set organization =
 * that org's shared workspace, which every member sees the same way.
 *
 * `userId` is always the caller. On org rows it is stored as `ownerId` (the
 * creator) and keeps rooting the object-storage prefix, but it is never what
 * grants access there — membership is.
 */
export interface Workspace {
  userId: string;
  organizationId: string | null;
}

/**
 * The `WHERE` fragment that scopes a listing to one workspace.
 *
 * Personal rows are matched by owner **and** `organizationId: null` — without
 * the second clause a user's own drawings would keep showing up in their
 * personal list after being moved into an org.
 *
 * The org branch carries its own membership test as a relation filter instead
 * of relying on a prior permission check. That keeps the guarantee attached to
 * the query itself: a non-member listing an org they do not belong to gets an
 * empty page even if a caller forgets to authorize first. Write paths still
 * call `OrganizationsService.requireMembership` so they can answer with a
 * proper 404/403 instead of silently doing nothing.
 */
export function drawingScope(workspace: Workspace): Prisma.DrawingWhereInput {
  const { userId, organizationId } = workspace;
  return organizationId === null
    ? { ownerId: userId, organizationId: null }
    : { organizationId, organization: { memberships: { some: { userId } } } };
}

/** `drawingScope`, for the folder tree. */
export function folderScope(workspace: Workspace): Prisma.FolderWhereInput {
  const { userId, organizationId } = workspace;
  return organizationId === null
    ? { ownerId: userId, organizationId: null }
    : { organizationId, organization: { memberships: { some: { userId } } } };
}

/**
 * Matches a single row the caller may touch, in **any** of their workspaces:
 * their own personal rows, plus every row in every org they belong to.
 *
 * This is what `requireDrawing`/`requireFolder` use. Resolving reachability in
 * the query — rather than reading the row, then looking up its org, then
 * checking membership — keeps it a single round-trip and makes it impossible to
 * authorize against a different row than the one that gets returned.
 */
export function reachableDrawing(userId: string): Prisma.DrawingWhereInput {
  return {
    OR: [
      { ownerId: userId, organizationId: null },
      { organization: { memberships: { some: { userId } } } },
    ],
  };
}

/** `reachableDrawing`, for the folder tree. */
export function reachableFolder(userId: string): Prisma.FolderWhereInput {
  return {
    OR: [
      { ownerId: userId, organizationId: null },
      { organization: { memberships: { some: { userId } } } },
    ],
  };
}

/**
 * "Shared with me" — drawings someone else made visible to this caller, either
 * by address or through an organization they belong to.
 *
 * Rows the caller can already reach by workspace are excluded, so the section
 * lists what *others* shared and never echoes the caller's own files back at
 * them (sharing a drawing with a teammate who is already in the org would
 * otherwise make it appear twice).
 *
 * Only DIRECT drawing shares appear here. A drawing that is only reachable
 * through a share on one of its ancestor folders shows up by browsing into
 * that folder — the folder itself is listed by `sharedFolderScope`, and
 * `GET /drawings?folderId=` then scopes to it — which keeps this fragment a
 * plain relation filter instead of a recursive query.
 */
export function sharedDrawingScope(actor: Actor): Prisma.DrawingWhereInput {
  return {
    shares: { some: { AND: [liveShare(), shareTargets(actor)] } },
    NOT: reachableDrawing(actor.userId),
  };
}

/** `sharedDrawingScope`, for the folder tree. Folder shares cover the subtree. */
export function sharedFolderScope(actor: Actor): Prisma.FolderWhereInput {
  return {
    shares: { some: { AND: [liveShare(), shareTargets(actor)] } },
    NOT: reachableFolder(actor.userId),
  };
}
