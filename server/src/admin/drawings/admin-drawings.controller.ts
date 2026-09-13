import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import type { Page } from '../../common/utils/pagination';
import { PlatformRole, type User } from '../../generated/prisma/client';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';
import { AuditContext } from '../audit/audit.context';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/audited.decorator';
import {
  ListDrawingsQueryDto,
  PurgeDrawingDto,
  type AdminDrawingRowDto,
  type StorageOrphansDto,
} from '../dto/admin-drawing.dto';
import { AdminDrawingsService } from './admin-drawings.service';

/**
 * `/admin/drawings` and `/admin/storage`.
 *
 * Metadata only: there is no endpoint here that returns drawing content. The
 * storage scan is OWNER because it is expensive and because purging objects is
 * the least reversible thing in the portal.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@AdminOnly()
@Controller('admin')
export class AdminDrawingsController {
  constructor(private readonly drawings: AdminDrawingsService) {}

  @Get('drawings')
  list(@Query() query: ListDrawingsQueryDto): Promise<Page<AdminDrawingRowDto>> {
    return this.drawings.list(query);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'drawing.restore', targetType: 'drawing', reasonField: null })
  @Post('drawings/:id/restore')
  restore(@CurrentUser() actor: User, @Param('id', ParseCuidPipe) id: string): Promise<AdminDrawingRowDto> {
    return this.drawings.restore(actor, id);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'drawing.purge', targetType: 'drawing' })
  @Post('drawings/:id/purge')
  async purge(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: PurgeDrawingDto,
  ): Promise<{ id: string; bytesFreed: number }> {
    AuditContext.setBefore(req, await this.drawings.snapshot(id));
    return this.drawings.purge(actor, id, dto.reason);
  }

  /** Expensive: it walks the bucket. OWNER only, and capped — see the service. */
  @AdminOnly(PlatformRole.OWNER)
  @Get('storage/orphans')
  orphans(): Promise<StorageOrphansDto> {
    return this.drawings.orphans();
  }

  @AdminOnly(PlatformRole.OWNER)
  @Audited({ action: 'storage.purgeOrphans', targetType: 'storage', reasonField: null })
  @Post('storage/orphans/purge')
  purgeOrphans(@CurrentUser() actor: User): Promise<{ deleted: number; bytesFreed: number }> {
    return this.drawings.purgeOrphans(actor);
  }
}
