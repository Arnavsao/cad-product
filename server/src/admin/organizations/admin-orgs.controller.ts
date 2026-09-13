import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
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
  ListOrgsQueryDto,
  RenameOrgDto,
  TransferOwnershipDto,
  type AdminOrgDetailDto,
  type AdminOrgRowDto,
} from '../dto/admin-org.dto';
import { AdminOrgsService } from './admin-orgs.service';

/** `/admin/organizations` — read at SUPPORT, change at ADMIN. */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@AdminOnly()
@Controller('admin/organizations')
export class AdminOrgsController {
  constructor(private readonly orgs: AdminOrgsService) {}

  @Get()
  list(@Query() query: ListOrgsQueryDto): Promise<Page<AdminOrgRowDto>> {
    return this.orgs.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseCuidPipe) id: string): Promise<AdminOrgDetailDto> {
    return this.orgs.get(id);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'org.rename', targetType: 'organization' })
  @Patch(':id')
  async rename(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: RenameOrgDto,
  ): Promise<AdminOrgDetailDto> {
    AuditContext.setBefore(req, await this.orgs.snapshot(id));
    return this.orgs.rename(actor, id, dto.name);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'org.transferOwnership', targetType: 'organization' })
  @Post(':id/transfer-ownership')
  async transfer(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: TransferOwnershipDto,
  ): Promise<AdminOrgDetailDto> {
    AuditContext.setBefore(req, await this.orgs.snapshot(id));
    return this.orgs.transferOwnership(actor, id, dto.userId);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'org.regenerateJoinCode', targetType: 'organization', reasonField: null })
  @Post(':id/regenerate-join-code')
  regenerate(@CurrentUser() actor: User, @Param('id', ParseCuidPipe) id: string): Promise<AdminOrgDetailDto> {
    return this.orgs.regenerateJoinCode(actor, id);
  }
}
