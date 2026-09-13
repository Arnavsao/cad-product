import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { clampPage, type Page } from '../../common/utils/pagination';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformRole } from '../../generated/prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** One entry as the portal lists it. */
export interface AuditEntryDto {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

/**
 * `GET /admin/audit` — who did what.
 *
 * ADMIN, not SUPPORT: the trail contains the before/after of other people's
 * accounts, which is more than a triage tier needs, and an audit log that the
 * widest staff tier can read is a weaker control than one only account
 * administrators see.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@AdminOnly(PlatformRole.ADMIN)
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<AuditEntryDto>> {
    const where: Prisma.AuditLogWhereInput = {};
    if (actorId) {
      where.actorId = actorId;
    }
    if (targetType) {
      where.targetType = targetType;
    }
    if (targetId) {
      where.targetId = targetId;
    }
    if (action) {
      where.action = { startsWith: action };
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (isDate(from)) {
      createdAt.gte = new Date(from);
    }
    if (isDate(to)) {
      createdAt.lte = new Date(to);
    }
    if (createdAt.gte || createdAt.lte) {
      where.createdAt = createdAt;
    }

    const current = clampPage(Number.parseInt(page ?? '1', 10));
    const size = Math.min(Number.parseInt(pageSize ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * size,
        take: size,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        before: row.before,
        after: row.after,
        reason: row.reason,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: null,
      total,
      page: current,
      pageSize: size,
    };
  }
}

function isDate(value: string | undefined): value is string {
  return !!value && !Number.isNaN(Date.parse(value));
}
