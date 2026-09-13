import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiException } from '../../common/errors/api-error';
import { PlatformRole, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AdminOnly } from '../admin.decorators';
import { AuditContext } from '../audit/audit.context';
import { Audited } from '../audit/audited.decorator';
import type { AdminFlagDto } from './dto/flag.dto';
import { UpdateFlagDto } from './dto/flag.dto';
import { flagDefinition, FLAG_KEYS, isFlagKey, type FlagKey } from './flag-registry';
import { FlagsService } from './flags.service';

/**
 * `/admin/flags` — the staff view of the switches.
 *
 * Richer than the public `GET /flags`: it reports the registry's description
 * and group, whether the effective value is an override or the shipped default,
 * and who changed it last. Reading is SUPPORT (knowing what is switched off is
 * half of triage); writing is ADMIN.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@AdminOnly()
@Controller('admin/flags')
export class AdminFlagsController {
  constructor(
    private readonly flags: FlagsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(): Promise<AdminFlagDto[]> {
    const [effective, rows] = await Promise.all([
      this.flags.all(),
      this.prisma.featureFlag.findMany({ include: { updatedBy: { select: { email: true } } } }),
    ]);
    const overrides = new Map(rows.map((row) => [row.key, row]));

    return FLAG_KEYS.map((key) => {
      const def = flagDefinition(key);
      const override = overrides.get(key);
      return {
        key,
        enabled: effective[key].enabled,
        payload: effective[key].payload,
        description: def.description,
        group: def.group,
        overridden: override !== undefined,
        updatedAt: override?.updatedAt.toISOString() ?? null,
        updatedByEmail: override?.updatedBy.email ?? null,
      };
    });
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'flag.set', targetType: 'flag', idParam: 'key', reasonField: null })
  @Put(':key')
  async set(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('key') key: string,
    @Body() dto: UpdateFlagDto,
  ): Promise<AdminFlagDto> {
    const flagKey = this.requireKey(key);
    AuditContext.setBefore(req, await this.flags.get(flagKey));
    await this.flags.set(flagKey, actor.id, { enabled: dto.enabled, payload: dto.payload });
    return this.one(flagKey);
  }

  /** Removes the override, returning the flag to what the code ships with. */
  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'flag.reset', targetType: 'flag', idParam: 'key', reasonField: null })
  @Delete(':key')
  async reset(@Req() req: Request, @Param('key') key: string): Promise<AdminFlagDto> {
    const flagKey = this.requireKey(key);
    AuditContext.setBefore(req, await this.flags.get(flagKey));
    await this.flags.reset(flagKey);
    return this.one(flagKey);
  }

  /**
   * An unknown key is a 404, not a create.
   *
   * The registry in code decides which flags exist (see `flag-registry.ts`); if
   * a typo could create a row, the table would slowly fill with keys nothing
   * reads and the portal would list switches that do nothing.
   */
  private requireKey(key: string): FlagKey {
    if (!isFlagKey(key)) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'UNKNOWN_FLAG', `No such feature flag '${key}'`);
    }
    return key;
  }

  private async one(key: FlagKey): Promise<AdminFlagDto> {
    const all = await this.list();
    return all.find((flag) => flag.key === key)!;
  }
}
