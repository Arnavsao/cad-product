import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-error';
import { clampPage, type Page } from '../../common/utils/pagination';
import { OrgRole, Prisma, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminOrgDetailDto, AdminOrgRowDto, ListOrgsQueryDto } from '../dto/admin-org.dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Organizations, from the outside.
 *
 * Deliberately a small set of operations. Staff can look at any organization and
 * fix the two things its own members cannot: a name that has to change, and an
 * ownership that has nowhere to go because the only owner has left. Everything
 * else — inviting, removing, roles below owner — is the organization's own
 * business and is already possible from inside it.
 *
 * Membership is never granted here. Adding staff to somebody's workspace to
 * "have a look" would put us inside their drawings, which is the line the
 * portal does not cross.
 */
@Injectable()
export class AdminOrgsService {
  private readonly logger = new Logger(AdminOrgsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListOrgsQueryDto): Promise<Page<AdminOrgRowDto>> {
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const where: Prisma.OrganizationWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q.trim(), mode: 'insensitive' } },
            { slug: { contains: query.q.trim(), mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { memberships: true } },
          memberships: {
            where: { role: OrgRole.OWNER },
            take: 1,
            include: { user: { select: { email: true } } },
          },
        },
      }),
    ]);

    // Drawing counts and sizes for the whole page in one grouped query, for the
    // same reason the user list does it: 25 round trips to render one page is
    // how a portal becomes unusable at a few hundred organizations.
    const usage = await this.usageFor(rows.map((row) => row.id));

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        imageUrl: row.imageUrl,
        memberCount: row._count.memberships,
        drawingCount: usage.get(row.id)?.drawingCount ?? 0,
        bytesUsed: usage.get(row.id)?.bytesUsed ?? 0,
        ownerEmail: row.memberships[0]?.user.email ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: null,
      total,
      page,
      pageSize,
    };
  }

  async get(organizationId: string): Promise<AdminOrgDetailDto> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        _count: { select: { memberships: true } },
        memberships: {
          orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
        },
        invites: { where: { acceptedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!org) {
      throw ApiException.notFound('ORG_NOT_FOUND', 'No such organization');
    }

    const usage = (await this.usageFor([org.id])).get(org.id);
    const owner = org.memberships.find((m) => m.role === OrgRole.OWNER);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      imageUrl: org.imageUrl,
      memberCount: org._count.memberships,
      drawingCount: usage?.drawingCount ?? 0,
      bytesUsed: usage?.bytesUsed ?? 0,
      ownerEmail: owner?.user.email ?? null,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
      joinCode: org.joinCode,
      members: org.memberships.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || null,
        role: m.role.toLowerCase(),
        joinedAt: m.joinedAt.toISOString(),
      })),
      invites: org.invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role.toLowerCase(),
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
      })),
    };
  }

  /** The fields the audit trail should remember, before a change. */
  async snapshot(organizationId: string): Promise<Record<string, unknown> | undefined> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        memberships: { where: { role: OrgRole.OWNER }, select: { userId: true } },
      },
    });
    return org ? { ...org, owners: org.memberships.map((m) => m.userId) } : undefined;
  }

  /**
   * Renames an organization. The slug is left alone on purpose: it is in the
   * join links members already have, and silently re-pointing those to fix a
   * typo in the display name would break more than it fixes.
   */
  async rename(actor: User, organizationId: string, name: string): Promise<AdminOrgDetailDto> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    if (!org) {
      throw ApiException.notFound('ORG_NOT_FOUND', 'No such organization');
    }
    await this.prisma.organization.update({ where: { id: organizationId }, data: { name: name.trim() } });
    this.logger.log(`${actor.email} renamed organization ${organizationId} from "${org.name}" to "${name.trim()}"`);
    return this.get(organizationId);
  }

  /**
   * Makes one member the owner, demoting the previous owners to admin.
   *
   * Demote rather than remove: the departing owner is usually still a working
   * member of the team, and an operation whose side effect is silently ejecting
   * somebody is the wrong shape for a support tool. Both writes go in one
   * transaction so the organization is never momentarily ownerless.
   */
  async transferOwnership(actor: User, organizationId: string, userId: string): Promise<AdminOrgDetailDto> {
    const membership = await this.prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { user: { select: { email: true } } },
    });
    if (!membership) {
      throw ApiException.unprocessable(
        'NOT_A_MEMBER',
        'That person is not in this organization. Have them join first, then transfer.',
      );
    }
    if (membership.role === OrgRole.OWNER) {
      throw ApiException.conflict('ALREADY_OWNER', 'They already own this organization');
    }

    await this.prisma.$transaction([
      this.prisma.orgMembership.updateMany({
        where: { organizationId, role: OrgRole.OWNER },
        data: { role: OrgRole.ADMIN },
      }),
      this.prisma.orgMembership.update({
        where: { organizationId_userId: { organizationId, userId } },
        data: { role: OrgRole.OWNER },
      }),
    ]);

    this.logger.log(`${actor.email} made ${membership.user.email} owner of organization ${organizationId}`);
    return this.get(organizationId);
  }

  /** Rotates the join code, for when one has leaked. */
  async regenerateJoinCode(actor: User, organizationId: string): Promise<AdminOrgDetailDto> {
    const exists = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!exists) {
      throw ApiException.notFound('ORG_NOT_FOUND', 'No such organization');
    }
    // Retried on collision: the code is short enough that a clash is possible,
    // and the unique index is what actually settles it.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await this.prisma.organization.update({
          where: { id: organizationId },
          data: { joinCode: randomJoinCode() },
        });
        this.logger.log(`${actor.email} rotated the join code for organization ${organizationId}`);
        return this.get(organizationId);
      } catch (error) {
        if (attempt === 7) throw error;
      }
    }
    throw ApiException.conflict('JOIN_CODE_UNAVAILABLE', 'Could not find a free join code');
  }

  /** Drawing count and total size per organization, in one query. */
  private async usageFor(orgIds: string[]): Promise<Map<string, { bytesUsed: number; drawingCount: number }>> {
    const out = new Map<string, { bytesUsed: number; drawingCount: number }>();
    if (orgIds.length === 0) {
      return out;
    }
    const grouped = await this.prisma.drawing.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: orgIds }, deletedAt: null },
      _sum: { byteSize: true },
      _count: { _all: true },
      orderBy: { organizationId: 'asc' },
    });
    for (const row of grouped) {
      if (row.organizationId) {
        out.set(row.organizationId, { bytesUsed: row._sum.byteSize ?? 0, drawingCount: row._count._all });
      }
    }
    return out;
  }
}

/**
 * Join codes avoid vowels and look-alikes so they survive being read aloud —
 * the same alphabet `OrganizationsService` uses, duplicated rather than
 * exported because it is a property of the code format, not a shared utility.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomJoinCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}
