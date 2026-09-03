import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Actor } from '../common/access';
import { ApiException } from '../common/errors/api-error';
import { isCuid } from '../common/pipes/parse-cuid.pipe';
import type { Workspace } from '../common/workspace';
import { Prisma, type Organization, type OrgInvite, type OrgMembership, type User } from '../generated/prisma/client';
import { OrgRole } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { orgAccessRemoved, orgInvite, orgRoleChanged } from '../mail/templates/email.templates';
import { NotificationsService, type PublishNotification } from '../notifications/notifications.service';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import {
  INVITE_TTL_DAYS,
  toRoleEnum,
  toRoleWire,
  type CreateInviteDto,
  type CreateOrganizationDto,
  type JoinOrganizationDto,
  type OrgDetailDto,
  type OrgInvitationDto,
  type OrgInviteDto,
  type OrgMemberDto,
  type OrgSummaryDto,
  type UpdateMemberDto,
  type UpdateOrganizationDto,
} from './dto/organization.dto';

/**
 * Privilege order. Higher wins; `requireMembership` compares by this rank.
 *
 * `VIEWER` is rank 0 — the read-only tier. It is what the enum's Postgres sort
 * order says too (see the `sharing_versions_viewer` migration), but rank is
 * decided here so a future role can be inserted without an enum rewrite.
 */
const RANK: Record<OrgRole, number> = {
  [OrgRole.VIEWER]: 0,
  [OrgRole.MEMBER]: 1,
  [OrgRole.ADMIN]: 2,
  [OrgRole.OWNER]: 3,
};

/** Join codes avoid vowels and look-alikes (0/O, 1/I/L) so they can be read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Attempts before we give up finding a free random join code / slug. */
const UNIQUE_ATTEMPTS = 8;

const DAY_MS = 86_400_000;

/**
 * Organizations: a shared workspace whose members all see the same drawings.
 *
 * Design decisions:
 *
 * - **Membership is the only permission.** A drawing in an org is readable and
 *   writable by every member regardless of who created it. `ownerId` survives
 *   as "who made this" (and as the storage prefix), never as an access check —
 *   see `common/workspace.ts` for the query fragments that encode this.
 *
 * - **Non-membership is 404, insufficient role is 403.** Same reasoning as
 *   `FoldersService`: an org you do not belong to must be indistinguishable
 *   from one that does not exist, so probing an id leaks nothing. Once you are
 *   known to be a member the org's existence is not a secret any more, so being
 *   too junior for an action is an honest 403 `ORG_FORBIDDEN`.
 *
 * - **Two ways in, one join path.** A typed `joinCode` and an emailed invite
 *   `token` both land in `join`. The code is rotatable, so leaking it is
 *   recoverable without disturbing members; the token is single-use and
 *   email-bound, so it can grant `admin` where a code only ever grants
 *   `member`.
 *
 * - **The last owner cannot leave or be demoted.** An org with no owner has
 *   nobody who can invite, rename, or delete it — it would be unadministrable
 *   and could only be fixed with raw SQL.
 *
 * - **Membership changes are announced in-app AND by email, best effort.** The
 *   in-app notification reaches an existing account; the email is the only
 *   thing that reaches an invited address with no account behind it yet. Both
 *   `NotificationsService.publish` and `MailService.send` never throw, so
 *   neither can fail the operation that triggered it, which is why they can be
 *   awaited inline at the end of one.
 *
 * - **"Someone joined" is in-app only.** The admin fan-out in `join` publishes
 *   a notification and deliberately sends no mail: an org with a shared join
 *   code would otherwise fill its admins' inboxes with arrivals they did not
 *   individually approve. Role changes and removals *are* mailed, because they
 *   are things done TO a person who needs to know.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Workspace resolution — used by DrawingsService / FoldersService
  // ---------------------------------------------------------------------------

  /**
   * Turns a request's optional `organizationId` into a verified `Workspace`.
   *
   * Absent/empty means the personal workspace, which needs no check. A present
   * id is verified here so that write paths fail fast with 404 rather than
   * quietly writing a row nobody can see.
   */
  async resolveWorkspace(userId: string, organizationId: string | null | undefined): Promise<Workspace> {
    if (organizationId === null || organizationId === undefined || organizationId === '') {
      return { userId, organizationId: null };
    }
    await this.requireMembership(userId, organizationId);
    return { userId, organizationId };
  }

  /**
   * The caller's membership row, or 404/403.
   *
   * @param minRole Lowest role allowed to proceed. Defaults to `VIEWER`, i.e.
   * "any membership at all": a viewer must be able to read the org and list its
   * drawings, so *write* paths name the role they need rather than relying on
   * the default. `common/access.ts` is what decides per-row write access.
   */
  async requireMembership(userId: string, organizationId: string, minRole: OrgRole = OrgRole.VIEWER): Promise<OrgMembership> {
    const membership = isCuid(organizationId)
      ? await this.prisma.orgMembership.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
        })
      : null;
    if (!membership) {
      throw ApiException.notFound('ORG_NOT_FOUND', 'Organization not found');
    }
    if (RANK[membership.role] < RANK[minRole]) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ORG_FORBIDDEN',
        `This action requires the ${minRole.toLowerCase()} role`,
      );
    }
    return membership;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** `GET /organizations` — every org the caller belongs to, newest first. */
  async listForUser(userId: string): Promise<OrgSummaryDto[]> {
    const memberships = await this.prisma.orgMembership.findMany({
      where: { userId },
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
      include: {
        organization: {
          include: { _count: { select: { memberships: true } } },
        },
      },
    });
    return memberships.map((m) =>
      toSummary(m.organization, m.role, m.organization._count.memberships),
    );
  }

  /** `GET /organizations/:id` — members only. */
  async get(userId: string, organizationId: string): Promise<OrgDetailDto> {
    const membership = await this.requireMembership(userId, organizationId);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        _count: {
          select: {
            memberships: true,
            // Trashed drawings would make the count disagree with the list.
            drawings: { where: { deletedAt: null } },
            // Drawings and folders elsewhere that were shared WITH this org.
            sharesReceived: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
          },
        },
      },
    });
    return {
      ...toSummary(org, membership.role, org._count.memberships),
      // The join code is a credential: anyone holding it can walk in.
      joinCode: RANK[membership.role] >= RANK[OrgRole.ADMIN] ? org.joinCode : null,
      drawingCount: org._count.drawings,
      sharedInCount: org._count.sharesReceived,
    };
  }

  /** `GET /organizations/:id/members` — owners first, then by join date. */
  async listMembers(userId: string, organizationId: string): Promise<OrgMemberDto[]> {
    await this.requireMembership(userId, organizationId);
    const rows = await this.prisma.orgMembership.findMany({
      where: { organizationId },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
      include: { user: true },
    });
    return rows.map((row) => toMemberDto(row, row.user));
  }

  /** `GET /organizations/:id/invites` — pending only; admin and up. */
  async listInvites(userId: string, organizationId: string): Promise<OrgInviteDto[]> {
    await this.requireMembership(userId, organizationId, OrgRole.ADMIN);
    const rows = await this.prisma.orgInvite.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: { organization: { select: { name: true } } },
    });
    return rows.map(toInviteDto);
  }

  /**
   * `GET /organizations/invitations` — invitations addressed to the CALLER.
   *
   * The in-app substitute for the email nobody sends: an invitee cannot list an
   * org they have not joined, so without this endpoint the only way in is for
   * someone to paste them a link. Matched on the token's own address
   * (lowercased on both sides), so it can only ever return the caller's own.
   */
  async listInvitations(actor: Actor): Promise<OrgInvitationDto[]> {
    const rows = await this.prisma.orgInvite.findMany({
      where: { email: actor.email, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      role: toRoleWire(row.role),
      invitedBy: row.createdBy
        ? { firstName: row.createdBy.firstName, lastName: row.createdBy.lastName, email: row.createdBy.email }
        : null,
      expiresAt: row.expiresAt.toISOString(),
      token: row.token,
    }));
  }

  /**
   * `POST /organizations/invitations/:id/accept` — the banner's Accept.
   *
   * Delegates to `join` by token so there is exactly one path that creates a
   * membership: the addressee check, the expiry check and the "already a
   * member" answer all stay in one place.
   */
  async acceptInvitation(actor: Actor, inviteId: string): Promise<OrgSummaryDto> {
    const invite = await this.requireOwnInvitation(actor, inviteId);
    return this.join(actor.userId, { token: invite.token });
  }

  /**
   * `DELETE /organizations/invitations/:id` — the banner's Decline.
   *
   * The row is deleted rather than flagged: `@@unique([organizationId, email])`
   * means keeping a declined row would block the org from ever inviting that
   * person again, and "they said no" is not a fact worth that cost.
   */
  async declineInvitation(actor: Actor, inviteId: string): Promise<{ id: string }> {
    const invite = await this.requireOwnInvitation(actor, inviteId);
    await this.prisma.orgInvite.delete({ where: { id: invite.id } });
    return { id: invite.id };
  }

  /**
   * A pending invitation addressed to the caller, or 404 `INVITE_INVALID`.
   * Only the addressee may accept or decline — an invitation someone else holds
   * must be indistinguishable from one that does not exist.
   */
  private async requireOwnInvitation(actor: Actor, inviteId: string): Promise<OrgInvite> {
    const invite = isCuid(inviteId)
      ? await this.prisma.orgInvite.findFirst({
          where: { id: inviteId, email: actor.email, acceptedAt: null, expiresAt: { gt: new Date() } },
        })
      : null;
    if (!invite) {
      throw ApiException.notFound('INVITE_INVALID', 'That invitation is no longer valid');
    }
    return invite;
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * `POST /organizations` → 201. The creator becomes `OWNER` in the same
   * transaction as the org row, so an org can never exist unadministrable.
   */
  async create(userId: string, dto: CreateOrganizationDto): Promise<OrgSummaryDto> {
    const name = dto.name.trim();
    const org = await this.insertWithUniqueFields(async (slug, joinCode) =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: { name, slug, joinCode, createdById: userId },
        });
        await tx.orgMembership.create({
          data: { organizationId: created.id, userId, role: OrgRole.OWNER },
        });
        return created;
      }),
      slugify(name),
    );
    return toSummary(org, OrgRole.OWNER, 1);
  }

  /** `PATCH /organizations/:id` — admin and up. */
  async update(userId: string, organizationId: string, dto: UpdateOrganizationDto): Promise<OrgSummaryDto> {
    const membership = await this.requireMembership(userId, organizationId, OrgRole.ADMIN);
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.imageUrl === undefined ? {} : { imageUrl: dto.imageUrl }),
      },
      include: { _count: { select: { memberships: true } } },
    });
    return toSummary(org, membership.role, org._count.memberships);
  }

  /**
   * `POST /organizations/:id/regenerate-join-code` — admin and up. Invalidates
   * the old code immediately; existing members are unaffected.
   */
  async regenerateJoinCode(userId: string, organizationId: string): Promise<{ joinCode: string }> {
    await this.requireMembership(userId, organizationId, OrgRole.ADMIN);
    const org = await this.insertWithUniqueFields((_slug, joinCode) =>
      this.prisma.organization.update({ where: { id: organizationId }, data: { joinCode } }),
    );
    return { joinCode: org.joinCode };
  }

  /**
   * `POST /organizations/:id/invites` — admin and up.
   *
   * One live invite per email per org (`@@unique([organizationId, email])`), so
   * re-inviting refreshes the existing row's role and expiry rather than
   * stacking up rows that all still work.
   */
  async invite(userId: string, organizationId: string, dto: CreateInviteDto): Promise<OrgInviteDto> {
    await this.requireMembership(userId, organizationId, OrgRole.ADMIN);
    const email = dto.email.trim().toLowerCase();
    const role = toRoleEnum(dto.role ?? 'member');

    const existing = await this.prisma.orgMembership.findFirst({
      where: { organizationId, user: { email } },
      select: { id: true },
    });
    if (existing) {
      throw ApiException.conflict('ALREADY_MEMBER', 'That person is already in this organization');
    }

    const row = await this.prisma.orgInvite.upsert({
      where: { organizationId_email: { organizationId, email } },
      create: {
        organizationId,
        email,
        role,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS),
        createdById: userId,
      },
      update: {
        role,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS),
        acceptedAt: null,
        createdById: userId,
      },
      include: { organization: { select: { name: true } } },
    });

    // The in-app notification is for an address that already has an account:
    // it puts the invitation in the banner they will see on their next visit.
    // An address with no account gets nothing here — there is no inbox yet.
    await this.notifyByEmail(email, {
      kind: 'account',
      title: `You've been invited to ${row.organization.name}`,
      body: `You were invited to join as ${toRoleWire(role)}.`,
      linkUrl: '/dashboard',
    });

    // The email goes out UNCONDITIONALLY, and with `send` rather than
    // `sendToUser`, because reaching someone who has no account is the entire
    // point of invitation mail: they cannot see a banner, they have no
    // preferences to consult, and this message is the only way they learn they
    // were invited at all. (`MailService` also refuses to gate the `invite`
    // category for an address that *does* have an account — see its JSDoc.)
    const inviter = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    await this.mail.send(
      this.mail.compose(
        email,
        'invite',
        orgInvite({
          actorName: inviter ? displayName(inviter) : 'Someone',
          orgName: row.organization.name,
          role: toRoleWire(role),
          url: this.mail.link(`/join/${row.token}`),
          recipientEmail: email,
          expiresInDays: INVITE_TTL_DAYS,
          preferencesUrl: this.mail.preferencesUrl,
        }),
      ),
    );
    return toInviteDto(row);
  }

  /** `DELETE /organizations/:id/invites/:inviteId` — admin and up. */
  async revokeInvite(userId: string, organizationId: string, inviteId: string): Promise<{ id: string }> {
    await this.requireMembership(userId, organizationId, OrgRole.ADMIN);
    const res = await this.prisma.orgInvite.deleteMany({ where: { id: inviteId, organizationId } });
    if (res.count === 0) {
      throw ApiException.notFound('INVITE_NOT_FOUND', 'Invite not found');
    }
    return { id: inviteId };
  }

  /**
   * `POST /organizations/join` — by join code or invite token.
   *
   * An invite is matched on the token **and** the caller's own email, so a
   * forwarded link cannot be redeemed by whoever received it. A code grants
   * `member` only; the role on an invite is honoured because an admin chose it.
   */
  async join(userId: string, dto: JoinOrganizationDto): Promise<OrgSummaryDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();

    let organizationId: string;
    let role: OrgRole = OrgRole.MEMBER;
    let inviteId: string | null = null;

    if (dto.token) {
      const invite = await this.prisma.orgInvite.findUnique({ where: { token: dto.token } });
      if (
        !invite ||
        invite.acceptedAt !== null ||
        invite.expiresAt <= now ||
        invite.email !== user.email.toLowerCase()
      ) {
        throw ApiException.notFound('INVITE_INVALID', 'That invitation is no longer valid');
      }
      organizationId = invite.organizationId;
      role = invite.role;
      inviteId = invite.id;
    } else if (dto.code) {
      const org = await this.prisma.organization.findUnique({
        where: { joinCode: dto.code.trim().toUpperCase() },
        select: { id: true },
      });
      if (!org) {
        throw ApiException.notFound('ORG_NOT_FOUND', 'No organization matches that code');
      }
      organizationId = org.id;
    } else {
      throw ApiException.unprocessable('JOIN_INPUT_REQUIRED', 'Provide a join code or an invitation token');
    }

    const already = await this.prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (already) {
      // The id rides along so the client can just switch to the org instead of
      // showing an error for something that is, from the user's point of view,
      // already done.
      throw ApiException.conflict('ALREADY_MEMBER', 'You are already in this organization', { organizationId });
    }

    const org = await this.prisma.$transaction(async (tx) => {
      await tx.orgMembership.create({ data: { organizationId, userId, role } });
      if (inviteId) {
        await tx.orgInvite.update({ where: { id: inviteId }, data: { acceptedAt: now } });
      }
      return tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { _count: { select: { memberships: true } } },
      });
    });

    // The people who can act on it: whoever invited them wants to know it
    // worked, and an admin watching a shared join code wants to see who walked
    // in. Plain members get nothing — it is not their decision to review.
    //
    // In-app only, on purpose. "Someone joined" is not one of the four events
    // the product mails (share received, invitation, emailed link, role
    // changed or removed): a shared join code can produce a stream of
    // arrivals, and filling every admin's inbox with them would be the fastest
    // way to get all of this feature's mail marked as spam.
    await this.notifyAdmins(organizationId, userId, {
      kind: 'account',
      title: `${displayName(user)} joined ${org.name}`,
      body: `They joined as ${toRoleWire(role)}.`,
      linkUrl: `/dashboard/organization`,
    });
    return toSummary(org, role, org._count.memberships);
  }

  /**
   * `PATCH /organizations/:id/members/:userId` — owner only.
   *
   * Owner-only for every role, `owner` included: promoting someone to owner is
   * how ownership is transferred (the org can then have two owners, or the
   * previous one can demote themselves), and demoting the last owner still
   * trips `LAST_OWNER`, so the org can never be left unadministrable.
   */
  async setMemberRole(
    userId: string,
    organizationId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ): Promise<OrgMemberDto> {
    await this.requireMembership(userId, organizationId, OrgRole.OWNER);
    const target = await this.prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      include: { user: true, organization: { select: { name: true } } },
    });
    if (!target) {
      throw ApiException.notFound('MEMBER_NOT_FOUND', 'That person is not in this organization');
    }
    const role = toRoleEnum(dto.role);
    if (target.role === OrgRole.OWNER && role !== OrgRole.OWNER) {
      await this.assertNotLastOwner(organizationId, targetUserId, 'demote');
    }
    const updated = await this.prisma.orgMembership.update({
      where: { id: target.id },
      data: { role },
      include: { user: true },
    });

    // Only when it actually changed: re-saving the same role from the members
    // table must not notify or mail. In-app first, then the email in the same
    // best-effort block — neither can fail the PATCH.
    if (target.role !== role) {
      await this.notifications.publish(targetUserId, {
        kind: 'account',
        title: `Your role in ${target.organization.name} is now ${toRoleWire(role)}`,
        body:
          role === OrgRole.VIEWER
            ? 'You can open and download the organization’s drawings, but not change them.'
            : undefined,
        linkUrl: '/dashboard/organization',
      });
      await this.mail.sendToUser(
        targetUserId,
        this.mail.compose(
          target.user.email,
          'org',
          orgRoleChanged({
            orgName: target.organization.name,
            role: toRoleWire(role),
            actorName: await this.actorName(userId),
            url: this.mail.link('/dashboard/organization'),
            preferencesUrl: this.mail.preferencesUrl,
          }),
        ),
      );
    }
    return toMemberDto(updated, updated.user);
  }

  /**
   * `DELETE /organizations/:id/members/:userId` — removing someone else needs
   * admin; removing yourself is "leave" and needs nothing but membership.
   *
   * Drawings the leaver created stay with the org: they were shared work, and
   * yanking them out from under the remaining members would be worse than a
   * stale `ownerId`. The row keeps rooting the storage prefix, which is why the
   * user record itself is never hard-deleted here.
   */
  async removeMember(userId: string, organizationId: string, targetUserId: string): Promise<{ userId: string }> {
    const leaving = targetUserId === userId;
    // Leaving needs only a membership — a viewer must be able to walk out too.
    await this.requireMembership(userId, organizationId, leaving ? OrgRole.VIEWER : OrgRole.ADMIN);

    const target = await this.prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      include: { organization: { select: { name: true } }, user: { select: { email: true } } },
    });
    if (!target) {
      throw ApiException.notFound('MEMBER_NOT_FOUND', 'That person is not in this organization');
    }
    if (target.role === OrgRole.OWNER) {
      await this.assertNotLastOwner(organizationId, targetUserId, leaving ? 'leave' : 'remove');
    }
    await this.prisma.orgMembership.delete({ where: { id: target.id } });

    // Only when someone else did it: telling people they left an org they just
    // left themselves is noise, in the app and doubly so in their inbox. Their
    // drawings stay with the org, so these two are the only signal that they
    // lost access to them.
    if (!leaving) {
      await this.notifications.publish(targetUserId, {
        kind: 'account',
        title: `You were removed from ${target.organization.name}`,
        linkUrl: '/dashboard',
      });
      await this.mail.sendToUser(
        targetUserId,
        this.mail.compose(
          target.user.email,
          'org',
          orgAccessRemoved({
            orgName: target.organization.name,
            actorName: await this.actorName(userId),
            preferencesUrl: this.mail.preferencesUrl,
          }),
        ),
      );
    }
    return { userId: targetUserId };
  }

  /**
   * `DELETE /organizations/:id` — owner only. Cascades memberships, invites,
   * folders and drawings.
   *
   * Storage objects are deliberately left alone: they live under
   * `users/{creator}/…`, so they are still reachable if the drawings are ever
   * restored from a backup, and a per-user sweep can reclaim them.
   */
  async remove(userId: string, organizationId: string): Promise<{ id: string }> {
    await this.requireMembership(userId, organizationId, OrgRole.OWNER);
    await this.prisma.organization.delete({ where: { id: organizationId } });
    return { id: organizationId };
  }

  // ---------------------------------------------------------------------------
  // Invariants
  // ---------------------------------------------------------------------------

  /**
   * Publishes to whoever holds `email`, if anyone does.
   *
   * Case-insensitive: invitations and shares store a lowercased address, while
   * `users.email` mirrors whatever the identity provider sent.
   */
  private async notifyByEmail(email: string, notification: PublishNotification): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { email: { equals: email, mode: Prisma.QueryMode.insensitive }, deletedAt: null },
      select: { id: true },
    });
    await Promise.all(users.map((user) => this.notifications.publish(user.id, notification)));
  }

  /**
   * "Priya Haldar" for whoever performed the action, for a mail body.
   *
   * Emails about a role change or a removal say who did it: "your role
   * changed" with no agent reads as something the system decided, and the
   * recipient's next question is always who.
   */
  private async actorName(userId: string): Promise<string> {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    return actor ? displayName(actor) : 'An administrator';
  }

  /** Publishes to an org's admins and owners, skipping `exceptUserId`. */
  private async notifyAdmins(
    organizationId: string,
    exceptUserId: string,
    notification: PublishNotification,
  ): Promise<void> {
    const admins = await this.prisma.orgMembership.findMany({
      where: {
        organizationId,
        role: { in: [OrgRole.ADMIN, OrgRole.OWNER] },
        userId: { not: exceptUserId },
      },
      select: { userId: true },
    });
    await Promise.all(admins.map((admin) => this.notifications.publish(admin.userId, notification)));
  }

  /** An org must always keep at least one owner (see the class JSDoc). */
  private async assertNotLastOwner(organizationId: string, targetUserId: string, action: string): Promise<void> {
    const owners = await this.prisma.orgMembership.count({
      where: { organizationId, role: OrgRole.OWNER, userId: { not: targetUserId } },
    });
    if (owners === 0) {
      throw ApiException.conflict(
        'LAST_OWNER',
        `You cannot ${action} the last owner — promote someone else to owner first`,
      );
    }
  }

  /**
   * Retries `write` with freshly generated slug/join code while Postgres reports
   * a unique violation.
   *
   * Generate-and-retry rather than check-then-insert: the check would be racy
   * anyway, and the unique indexes are the real authority. Collisions are
   * vanishingly rare (31^8 codes), so this loop effectively never spins.
   */
  private async insertWithUniqueFields(
    write: (slug: string, joinCode: string) => Promise<Organization>,
    slugBase = '',
  ): Promise<Organization> {
    let lastError: unknown;
    for (let attempt = 0; attempt < UNIQUE_ATTEMPTS; attempt++) {
      // First try the clean slug, then start disambiguating.
      const slug = attempt === 0 ? slugBase : `${slugBase}-${randomSuffix()}`;
      try {
        return await write(slug, randomJoinCode());
      } catch (error) {
        if (!isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function toSummary(org: Organization, role: OrgRole, memberCount: number): OrgSummaryDto {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    imageUrl: org.imageUrl,
    role: toRoleWire(role),
    memberCount,
    createdAt: org.createdAt.toISOString(),
  };
}

function toMemberDto(membership: OrgMembership, user: User): OrgMemberDto {
  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    imageUrl: user.imageUrl,
    role: toRoleWire(membership.role),
    joinedAt: membership.joinedAt.toISOString(),
  };
}

function toInviteDto(row: {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  organizationId: string;
  organization: { name: string };
  expiresAt: Date;
  createdAt: Date;
}): OrgInviteDto {
  return {
    id: row.id,
    email: row.email,
    role: toRoleWire(row.role),
    token: row.token,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** "Priya Haldar", or the address when no name was mirrored from the token. */
function displayName(user: { firstName: string | null; lastName: string | null; email: string }): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email;
}

/** `"Acme Design Studio"` → `"acme-design-studio"`; never empty. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'org';
}

function randomJoinCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function randomSuffix(): string {
  return randomBytes(3).toString('hex');
}
