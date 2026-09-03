import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  assertLevel,
  LEVEL_RANK,
  permissionLevel,
  resolveDrawingAccess,
  resolveFolderAccess,
  type Access,
  type AccessLevel,
  type Actor,
} from '../common/access';
import { ApiException } from '../common/errors/api-error';
import { isCuid } from '../common/pipes/parse-cuid.pipe';
import { drawingRelations, toDrawingSummaryDto, type DrawingRow } from '../drawings/drawings.mapper';
import type { Drawing, Folder, Share, ShareLink } from '../generated/prisma/client';
import { Prisma, SharePermission } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { shareLinkSent, shareReceived } from '../mail/templates/email.templates';
import { NotificationsService } from '../notifications/notifications.service';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import {
  type AcceptedShareDto,
  type CreateShareLinkDto,
  type EmailedShareLinkDto,
  type EmailShareLinkDto,
  type RemovedShareDto,
  type SharedLinkDto,
  type ShareDto,
  type ShareLinkDto,
  type SharePermissionWire,
  type SharesDto,
  type UpsertShareDto,
} from './dto/share.dto';

const DAY_MS = 86_400_000;

/** Extra entropy appended to a link token's uuid (hex characters). */
const TOKEN_SUFFIX_BYTES = 4;

/**
 * Most recipients one org-target share will email.
 *
 * Sharing into a 500-person organization must not turn one PUT into 500
 * outbound messages: the in-app notification still reaches everyone (it is a
 * cheap row), but mail is rate-limited by the provider and is the part that
 * looks like a burst of spam. Exceeding it logs a warning naming the org, so an
 * operator can see it happened rather than wonder why some members heard
 * nothing.
 */
const MAX_SHARE_FANOUT = 50;

/** A share row with the relations the dialog renders. */
type ShareRow = Share & { targetOrganization: { id: string; name: string } | null };

/** `include` for the above; the org name is the only extra column needed. */
const SHARE_RELATIONS = {
  targetOrganization: { select: { id: true, name: true } },
} as const;

/**
 * Sharing: durable grants to people and organizations, and revocable links.
 *
 * Design decisions:
 *
 * - **It owns no other service.** Access is resolved through the standalone
 *   functions in `common/access.ts`, which take a `PrismaService`, so this
 *   module needs neither `DrawingsService` nor `FoldersService` and no import
 *   cycle appears between the three. The row selects here are deliberately
 *   minimal — just the columns an access decision reads.
 *
 * - **Managing shares needs `manage`.** Someone given `edit` on a drawing can
 *   change its contents but not who else can see it: re-sharing other people's
 *   work is the workspace owner's call. Shares themselves never grant `manage`,
 *   so a recipient can never widen their own grant.
 *
 * - **A share is an upsert on (resource, target).** Four partial unique indexes
 *   (see the migration) make that a database guarantee rather than a
 *   convention, so "share with Priya" twice cannot leave two rows whose
 *   permissions disagree. P2002 is caught as the backstop for the race between
 *   the pre-read and the insert.
 *
 * - **Sharing to an org you are not in is 404, not 403.** Same rule as
 *   `OrganizationsService`: an org you do not belong to must be
 *   indistinguishable from one that does not exist, so the picker cannot be
 *   used to enumerate other people's organizations.
 *
 * - **Accepting a link converts it into a share.** The link stays revocable,
 *   but the recipient now has a durable grant in their own name, so the drawing
 *   appears under "Shared with me" and keeps working if the link is later
 *   revoked for everyone else. Accepting is idempotent and never *lowers* an
 *   existing grant.
 *
 * - **Notifications are best effort.** `NotificationsService.publish` and
 *   `MailService.send` both never throw (by design), so a full inbox, a
 *   database hiccup or a refused email cannot fail the share that triggered it.
 *
 * - **Mail is sent only when the grant actually changed.** Re-PUTting the same
 *   permission is how the dialog saves an unchanged row, and mailing on it
 *   would make a person's inbox reflect UI activity rather than access
 *   changes. `upsert` reports which branch it took (see `UpsertOutcome`) so
 *   only a new grant, or an upgrade from view to edit, mails.
 */
@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Drawings
  // ---------------------------------------------------------------------------

  /** `GET /drawings/:id/shares` — the people, orgs and links on one drawing. */
  async listDrawingShares(actor: Actor, drawingId: string): Promise<SharesDto> {
    const { row, access } = await this.requireDrawing(actor, drawingId, 'manage');
    const [shares, links] = await Promise.all([
      this.prisma.share.findMany({
        where: { drawingId: row.id },
        orderBy: { createdAt: 'asc' },
        include: SHARE_RELATIONS,
      }),
      this.prisma.shareLink.findMany({
        where: { drawingId: row.id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      access: access.level,
      shares: await this.toShareDtos(shares),
      links: links.map(toShareLinkDto),
    };
  }

  /** `PUT /drawings/:id/shares` — create or update one grant. */
  async upsertDrawingShare(actor: Actor, drawingId: string, dto: UpsertShareDto): Promise<ShareDto> {
    const { row } = await this.requireDrawing(actor, drawingId, 'manage');
    const target = await this.resolveTarget(actor, dto, row.organizationId);
    const { share, escalated } = await this.upsert(actor, { drawingId: row.id }, target, dto);

    await this.announce(actor, target, {
      title: (name) => `${name} shared a drawing with you`,
      body: `"${row.name}" was shared with you`,
      linkUrl: `/editor/${row.id}`,
      email: escalated ? { kind: 'drawing', name: row.name, permission: permissionWire(share.permission) } : null,
    });
    return (await this.toShareDtos([share]))[0];
  }

  /** `DELETE /drawings/:id/shares/:shareId`. */
  async removeDrawingShare(actor: Actor, drawingId: string, shareId: string): Promise<RemovedShareDto> {
    const { row } = await this.requireDrawing(actor, drawingId, 'manage');
    const removed = await this.prisma.share.deleteMany({ where: { id: shareId, drawingId: row.id } });
    if (removed.count === 0) {
      throw shareNotFound();
    }
    return { id: shareId };
  }

  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------

  /** `GET /folders/:id/shares`. Folders have no links, so `links` is empty. */
  async listFolderShares(actor: Actor, folderId: string): Promise<SharesDto> {
    const { row, access } = await this.requireFolder(actor, folderId, 'manage');
    const shares = await this.prisma.share.findMany({
      where: { folderId: row.id },
      orderBy: { createdAt: 'asc' },
      include: SHARE_RELATIONS,
    });
    return { access: access.level, shares: await this.toShareDtos(shares), links: [] };
  }

  /**
   * `PUT /folders/:id/shares` — one grant over the whole subtree.
   *
   * The share names the folder only; `common/access.ts` walks a drawing's
   * ancestors when it resolves access, so everything added to the folder later
   * is covered too, with no fan-out write.
   */
  async upsertFolderShare(actor: Actor, folderId: string, dto: UpsertShareDto): Promise<ShareDto> {
    const { row } = await this.requireFolder(actor, folderId, 'manage');
    const target = await this.resolveTarget(actor, dto, row.organizationId);
    const { share, escalated } = await this.upsert(actor, { folderId: row.id }, target, dto);

    await this.announce(actor, target, {
      title: (name) => `${name} shared a folder with you`,
      body: `"${row.name}" was shared with you`,
      linkUrl: `/dashboard/folders/${row.id}`,
      email: escalated ? { kind: 'folder', name: row.name, permission: permissionWire(share.permission) } : null,
    });
    return (await this.toShareDtos([share]))[0];
  }

  /** `DELETE /folders/:id/shares/:shareId`. */
  async removeFolderShare(actor: Actor, folderId: string, shareId: string): Promise<RemovedShareDto> {
    const { row } = await this.requireFolder(actor, folderId, 'manage');
    const removed = await this.prisma.share.deleteMany({ where: { id: shareId, folderId: row.id } });
    if (removed.count === 0) {
      throw shareNotFound();
    }
    return { id: shareId };
  }

  // ---------------------------------------------------------------------------
  // Links
  // ---------------------------------------------------------------------------

  /**
   * `POST /drawings/:id/links` → a fresh token.
   *
   * The token is a uuid plus eight random hex characters: a uuid alone is
   * already unguessable, but the suffix keeps the string from *looking* like a
   * database id in a URL bar, and makes it obvious that it is a secret.
   */
  async createLink(actor: Actor, drawingId: string, dto: CreateShareLinkDto): Promise<ShareLinkDto> {
    const { row } = await this.requireDrawing(actor, drawingId, 'manage');
    const link = await this.prisma.shareLink.create({
      data: {
        drawingId: row.id,
        createdById: actor.userId,
        token: `${randomUUID()}${randomBytes(TOKEN_SUFFIX_BYTES).toString('hex')}`,
        permission: permissionEnum(dto.permission),
        expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * DAY_MS) : null,
      },
    });
    return toShareLinkDto(link);
  }

  /**
   * `DELETE /drawings/:id/links/:linkId` — revoke.
   *
   * `revokedAt` is set rather than the row deleted: "this link was turned off
   * on Tuesday" is worth keeping, and shares already created by accepting it
   * are unaffected, which is the whole point of converting a link into a share.
   */
  async revokeLink(actor: Actor, drawingId: string, linkId: string): Promise<RemovedShareDto> {
    const { row } = await this.requireDrawing(actor, drawingId, 'manage');
    const revoked = await this.prisma.shareLink.updateMany({
      where: { id: linkId, drawingId: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw ApiException.notFound('LINK_NOT_FOUND', 'Share link not found');
    }
    return { id: linkId };
  }

  /**
   * `POST /drawings/:id/links/:linkId/email` — mail an existing link to people.
   *
   * Design decisions:
   *
   * - **It needs `manage`, like every other link operation.** Whoever may
   *   create and revoke a link may also send it; someone with `edit` may not,
   *   for the same reason they may not re-share the drawing.
   *
   * - **It is not an open relay.** This is the only endpoint in the API that
   *   sends mail to arbitrary addresses on request, so it is fenced on three
   *   sides: at most ten addresses per call, ten calls per minute per IP
   *   (`@Throttle` on the controller), and the sender's own display name is in
   *   the body so a recipient can always see who caused it. The optional note
   *   is capped at 500 characters and HTML-escaped by the template.
   *
   * - **A revoked or expired link is refused.** Mailing a link that already
   *   does not work would produce a support question, not a share, so the same
   *   `LINK_INVALID` the recipient-side routes use is raised here.
   *
   * - **Duplicate addresses collapse.** Two spellings of the same address in
   *   one call are one message; `sent` counts messages accepted for delivery,
   *   which is the number the dialog reports.
   */
  async emailLink(
    actor: Actor,
    drawingId: string,
    linkId: string,
    dto: EmailShareLinkDto,
  ): Promise<EmailedShareLinkDto> {
    const { row } = await this.requireDrawing(actor, drawingId, 'manage');
    const link = await this.prisma.shareLink.findFirst({
      where: { id: linkId, drawingId: row.id, revokedAt: null },
      select: { token: true, permission: true, expiresAt: true },
    });
    if (!link || isExpired(link.expiresAt)) {
      throw linkInvalid();
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const rendered = shareLinkSent({
      actorName: displayName(sender) ?? 'Someone',
      resourceName: row.name,
      permission: permissionWire(link.permission),
      url: this.mail.link(`/shared/${link.token}`),
      message: dto.message ?? null,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      preferencesUrl: this.mail.preferencesUrl,
    });

    const addresses = [...new Set(dto.emails.map((email) => email.trim().toLowerCase()))];
    // `send`, not `sendToUser`: the addresses here were typed by the sender and
    // most will have no account, so there is nothing to look a preference up
    // against. The share-mail toggle is about shares made TO you; a link
    // someone deliberately addressed to you is closer to a person writing.
    const results = await Promise.allSettled(
      addresses.map((to) => this.mail.send(this.mail.compose(to, 'share', rendered))),
    );
    return { sent: results.filter((r) => r.status === 'fulfilled' && r.value).length };
  }

  /**
   * `GET /shared/:token` — what the recipient sees before accepting.
   *
   * Unknown or revoked is 404 `LINK_INVALID`; an EXPIRED link still resolves,
   * with `expired: true`, so the page can say "this link has expired — ask for
   * a new one" instead of the flat "not found" that would leave the recipient
   * wondering whether they mistyped it. Accepting one is still refused.
   */
  async getSharedLink(actor: Actor, token: string): Promise<SharedLinkDto> {
    const link = await this.requireLink(token);
    const drawing = await this.prisma.drawing.findFirst({
      where: { id: link.drawingId, deletedAt: null },
      include: drawingRelations(),
    });
    if (!drawing) {
      throw linkInvalid();
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: link.createdById },
      select: { id: true, firstName: true, lastName: true, imageUrl: true },
    });
    // Reported at the link's own permission: it is what accepting would grant,
    // which is the number the page is about. Thumbnails are skipped — this
    // module signs no URLs, and the page shows a name, not a preview.
    const access: Access = { level: permissionLevel(link.permission), viaShare: true };
    return {
      drawing: toDrawingSummaryDto(drawing as DrawingRow, null, access),
      permission: permissionWire(link.permission),
      owner: owner ?? null,
      expired: isExpired(link.expiresAt),
    };
  }

  /**
   * `POST /shared/:token/accept` — turn a link into a durable share.
   *
   * Skipped entirely when the caller already reaches the drawing through a
   * workspace at that level or better: writing a share row for someone who is
   * already in the org would make their own drawing show up under "Shared with
   * me". An existing share is only ever raised, never lowered — opening a view
   * link must not cost someone the edit access they were given directly.
   */
  async acceptSharedLink(actor: Actor, token: string): Promise<AcceptedShareDto> {
    const link = await this.requireLink(token);
    if (isExpired(link.expiresAt)) {
      throw linkInvalid();
    }
    const drawing = await this.prisma.drawing.findFirst({
      where: { id: link.drawingId, deletedAt: null },
      select: { id: true, ownerId: true, organizationId: true, folderId: true },
    });
    if (!drawing) {
      throw linkInvalid();
    }

    const granted = permissionLevel(link.permission);
    const current = await resolveDrawingAccess(this.prisma, actor, drawing);
    if (current && !current.viaShare && LEVEL_RANK[current.level] >= LEVEL_RANK[granted]) {
      return { drawingId: drawing.id, access: current.level };
    }

    const existing = await this.prisma.share.findFirst({
      where: { drawingId: drawing.id, targetEmail: actor.email },
      select: { id: true, permission: true },
    });
    const permission =
      existing && permissionLevel(existing.permission) === 'edit' ? SharePermission.EDIT : link.permission;

    if (existing) {
      await this.prisma.share.update({ where: { id: existing.id }, data: { permission, expiresAt: null } });
    } else {
      await this.prisma.share
        .create({
          data: {
            drawingId: drawing.id,
            targetEmail: actor.email,
            permission,
            createdById: link.createdById,
          },
        })
        .catch(async (error: unknown) => {
          // Two tabs accepted the same link at once; the other one won.
          if (!isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
            throw error;
          }
        });
    }

    const resolved = await resolveDrawingAccess(this.prisma, actor, drawing);
    return { drawingId: drawing.id, access: resolved?.level ?? permissionLevel(permission) };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * The drawing, and what the caller may do with it. Fetched by id and judged
   * afterwards — see `common/access.ts` for why reachability cannot be a `WHERE`
   * fragment once folder shares exist.
   */
  private async requireDrawing(
    actor: Actor,
    id: string,
    minLevel: AccessLevel,
  ): Promise<{ row: Pick<Drawing, 'id' | 'name' | 'ownerId' | 'organizationId' | 'folderId'>; access: Access }> {
    const row = isCuid(id)
      ? await this.prisma.drawing.findFirst({
          where: { id, deletedAt: null },
          select: { id: true, name: true, ownerId: true, organizationId: true, folderId: true },
        })
      : null;
    const access = row ? await resolveDrawingAccess(this.prisma, actor, row) : null;
    if (!row || !access) {
      throw ApiException.notFound('DRAWING_NOT_FOUND', 'Drawing not found');
    }
    assertLevel(access, minLevel);
    return { row, access };
  }

  /** `requireDrawing`, for the folder tree. */
  private async requireFolder(
    actor: Actor,
    id: string,
    minLevel: AccessLevel,
  ): Promise<{ row: Pick<Folder, 'id' | 'name' | 'ownerId' | 'organizationId' | 'parentId'>; access: Access }> {
    const row = isCuid(id)
      ? await this.prisma.folder.findUnique({
          where: { id },
          select: { id: true, name: true, ownerId: true, organizationId: true, parentId: true },
        })
      : null;
    const access = row ? await resolveFolderAccess(this.prisma, actor, row) : null;
    if (!row || !access) {
      throw ApiException.notFound('FOLDER_NOT_FOUND', 'Folder not found');
    }
    assertLevel(access, minLevel);
    return { row, access };
  }

  /** A live (non-revoked) link, or 404 `LINK_INVALID`. */
  private async requireLink(token: string): Promise<ShareLink> {
    const link =
      typeof token === 'string' && token.length >= 8 && token.length <= 128
        ? await this.prisma.shareLink.findUnique({ where: { token } })
        : null;
    if (!link || link.revokedAt !== null) {
      throw linkInvalid();
    }
    return link;
  }

  /**
   * Validates the requested target and returns it in the shape the row needs.
   *
   * Every refusal here is about intent rather than permission, so they are all
   * 422 except the org miss, which is 404 for the reason in the class JSDoc.
   */
  private async resolveTarget(
    actor: Actor,
    dto: UpsertShareDto,
    resourceOrganizationId: string | null,
  ): Promise<ShareTarget> {
    const email = dto.email?.trim().toLowerCase();
    if (!!email === !!dto.organizationId) {
      throw ApiException.unprocessable(
        'SHARE_TARGET_REQUIRED',
        'Provide either an email address or an organization to share with',
      );
    }

    if (email) {
      if (email === actor.email) {
        throw ApiException.unprocessable('SHARE_SELF', 'You already have access to this item');
      }
      return { targetEmail: email, targetOrganizationId: null };
    }

    const organizationId = dto.organizationId!;
    if (organizationId === resourceOrganizationId) {
      throw ApiException.unprocessable(
        'SHARE_SAME_ORG',
        'Everyone in that organization can already see this item',
      );
    }
    // Only orgs the CALLER belongs to — otherwise the picker would double as a
    // way to push files at strangers, and to probe for org ids.
    const membership = isCuid(organizationId)
      ? await this.prisma.orgMembership.findUnique({
          where: { organizationId_userId: { organizationId, userId: actor.userId } },
          select: { id: true },
        })
      : null;
    if (!membership) {
      throw ApiException.notFound('ORG_NOT_FOUND', 'Organization not found');
    }
    return { targetEmail: null, targetOrganizationId: organizationId };
  }

  /**
   * The upsert itself. Read-then-write with a P2002 fallback rather than
   * Prisma's `upsert`, because the uniqueness that makes this an upsert lives
   * in partial indexes Prisma cannot address (see the migration).
   *
   * `escalated` is what the email decision hangs on: true when the row was
   * created, or when an existing `view` became `edit`. It is decided here
   * because this is the only place that has both the old and the new
   * permission — the caller would have to re-read the row to guess it.
   */
  private async upsert(
    actor: Actor,
    subject: { drawingId?: string; folderId?: string },
    target: ShareTarget,
    dto: UpsertShareDto,
  ): Promise<UpsertOutcome> {
    const where: Prisma.ShareWhereInput = {
      drawingId: subject.drawingId ?? null,
      folderId: subject.folderId ?? null,
      targetEmail: target.targetEmail,
      targetOrganizationId: target.targetOrganizationId,
    };
    const permission = permissionEnum(dto.permission);
    const data = {
      permission,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    };

    const existing = await this.prisma.share.findFirst({ where, select: { id: true, permission: true } });
    if (existing) {
      const share = await this.prisma.share.update({
        where: { id: existing.id },
        data,
        include: SHARE_RELATIONS,
      });
      return { share, escalated: isUpgrade(existing.permission, permission) };
    }
    try {
      const share = await this.prisma.share.create({
        data: { ...subject, ...target, ...data, createdById: actor.userId },
        include: SHARE_RELATIONS,
      });
      return { share, escalated: true };
    } catch (error) {
      if (!isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        throw error;
      }
      const raced = await this.prisma.share.findFirstOrThrow({ where, select: { id: true, permission: true } });
      const share = await this.prisma.share.update({ where: { id: raced.id }, data, include: SHARE_RELATIONS });
      return { share, escalated: isUpgrade(raced.permission, permission) };
    }
  }

  /**
   * Notifies whoever just gained access: the person behind the address if they
   * have an account, or every member of the target organization but the sharer.
   *
   * A share created for an address with no account yet publishes nothing —
   * there is no inbox to publish into — and the grant simply starts working
   * when they sign up. It is also not *mailed*: unlike an organization invite,
   * a share is not an invitation to sign up, and mailing a stranger a link they
   * cannot open until they create an account is worse than silence. (The
   * sharer can send them the link explicitly; that is what `emailLink` is for.)
   *
   * Email goes out **after** the in-app publish, inside the same best-effort
   * block, and only when `message.email` is set — i.e. when the grant was new
   * or upgraded (see `upsert`). `MailService.sendToUser` checks each
   * recipient's preference and never throws, so nothing here can fail the PUT.
   */
  private async announce(
    actor: Actor,
    target: ShareTarget,
    message: {
      title: (sharerName: string) => string;
      body: string;
      linkUrl: string;
      /** Absent when the grant did not actually change, so no mail is due. */
      email: { kind: 'drawing' | 'folder'; name: string; permission: SharePermissionWire } | null;
    },
  ): Promise<void> {
    const recipients = target.targetEmail
      ? await this.prisma.user.findMany({
          where: { email: { equals: target.targetEmail, mode: Prisma.QueryMode.insensitive }, deletedAt: null },
          select: { id: true, email: true },
        })
      : (
          await this.prisma.orgMembership.findMany({
            where: { organizationId: target.targetOrganizationId!, userId: { not: actor.userId } },
            select: { user: { select: { id: true, email: true } } },
          })
        ).map((membership) => membership.user);

    if (recipients.length === 0) {
      return;
    }
    const sharer = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const name = displayName(sharer) ?? 'Someone';
    await Promise.all(
      recipients.map((user) =>
        this.notifications.publish(user.id, {
          kind: 'drawing',
          title: message.title(name),
          body: message.body,
          linkUrl: message.linkUrl,
        }),
      ),
    );

    if (!message.email) {
      return;
    }
    const mailed = recipients.slice(0, MAX_SHARE_FANOUT);
    if (recipients.length > mailed.length) {
      this.logger.warn(
        `Share notification email capped at ${MAX_SHARE_FANOUT} of ${recipients.length} recipients` +
          `${target.targetOrganizationId ? ` for organization ${target.targetOrganizationId}` : ''}`,
      );
    }
    const rendered = shareReceived({
      actorName: name,
      resourceKind: message.email.kind,
      resourceName: message.email.name,
      permission: message.email.permission,
      url: this.mail.link(message.linkUrl),
      preferencesUrl: this.mail.preferencesUrl,
    });
    // `allSettled`, not `all`: one address the provider refuses must not stop
    // the rest, and `sendToUser` already swallows its own failures anyway.
    await Promise.allSettled(
      mailed.map((user) => this.mail.sendToUser(user.id, this.mail.compose(user.email, 'share', rendered))),
    );
  }

  /**
   * Rows → DTOs, resolving `targetEmail` to an account when one exists so the
   * dialog can show a name and avatar instead of a raw address.
   *
   * One query for the whole list; matched case-insensitively because
   * `users.email` mirrors whatever the identity provider sent, while a share's
   * target is always stored lowercased.
   */
  private async toShareDtos(rows: ShareRow[]): Promise<ShareDto[]> {
    const emails = [...new Set(rows.map((row) => row.targetEmail).filter((email): email is string => !!email))];
    const users = emails.length
      ? await this.prisma.user.findMany({
          where: { OR: emails.map((email) => ({ email: { equals: email, mode: Prisma.QueryMode.insensitive } })) },
          select: { id: true, email: true, firstName: true, lastName: true, imageUrl: true },
        })
      : [];
    const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

    return rows.map((row) => {
      const user = row.targetEmail ? byEmail.get(row.targetEmail) : undefined;
      return {
        id: row.id,
        targetEmail: row.targetEmail,
        targetOrganization: row.targetOrganization,
        targetUser: user
          ? { id: user.id, firstName: user.firstName, lastName: user.lastName, imageUrl: user.imageUrl }
          : null,
        permission: permissionWire(row.permission),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Exactly one of the two is set — the `shares_one_target` CHECK enforces it. */
interface ShareTarget {
  targetEmail: string | null;
  targetOrganizationId: string | null;
}

/** What `upsert` returns: the row, and whether access actually widened. */
interface UpsertOutcome {
  share: ShareRow;
  /** New row, or `view` → `edit`. False when the permission did not change. */
  escalated: boolean;
}

/** `view` → `edit` is an upgrade; anything else is not (see `upsert`). */
function isUpgrade(before: SharePermission, after: SharePermission): boolean {
  return before !== SharePermission.EDIT && after === SharePermission.EDIT;
}

function linkInvalid(): ApiException {
  return ApiException.notFound('LINK_INVALID', 'That share link is no longer valid');
}

function shareNotFound(): ApiException {
  return ApiException.notFound('SHARE_NOT_FOUND', 'Share not found');
}

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= Date.now();
}

function permissionEnum(permission: SharePermissionWire): SharePermission {
  return permission === 'edit' ? SharePermission.EDIT : SharePermission.VIEW;
}

function permissionWire(permission: SharePermission): SharePermissionWire {
  return permission === SharePermission.EDIT ? 'edit' : 'view';
}

function toShareLinkDto(link: ShareLink): ShareLinkDto {
  return {
    id: link.id,
    token: link.token,
    permission: permissionWire(link.permission),
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    createdAt: link.createdAt.toISOString(),
  };
}

/** "Priya Haldar", or the address when no name was mirrored from the token. */
function displayName(
  user: { firstName: string | null; lastName: string | null; email: string } | null,
): string | null {
  if (!user) {
    return null;
  }
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email;
}
