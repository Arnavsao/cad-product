import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { PlatformRole, type User } from '../../generated/prisma/client';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';
import { AuditContext } from '../audit/audit.context';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/audited.decorator';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
  type AdminAnnouncementDto,
} from '../dto/admin-announcement.dto';
import { AnnouncementsService } from './announcements.service';

/** `/admin/announcements` — read at SUPPORT, write and publish at ADMIN. */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@AdminOnly()
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(): Promise<AdminAnnouncementDto[]> {
    return this.announcements.list();
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'announcement.create', targetType: 'announcement', reasonField: null })
  @Post()
  create(@CurrentUser() actor: User, @Body() dto: CreateAnnouncementDto): Promise<AdminAnnouncementDto> {
    return this.announcements.create(actor, dto);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'announcement.update', targetType: 'announcement', reasonField: null })
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
  ): Promise<AdminAnnouncementDto> {
    AuditContext.setBefore(req, await this.announcements.get(id));
    return this.announcements.update(id, dto);
  }

  /**
   * Publishing is the irreversible half: with `pushToInbox` on it writes a row
   * into every active user's inbox, which cannot be recalled.
   */
  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'announcement.publish', targetType: 'announcement', reasonField: null })
  @Post(':id/publish')
  publish(
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
  ): Promise<AdminAnnouncementDto & { notified: number }> {
    return this.announcements.publish(actor, id);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'announcement.delete', targetType: 'announcement', reasonField: null })
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id', ParseCuidPipe) id: string): Promise<{ id: string }> {
    AuditContext.setBefore(req, await this.announcements.get(id));
    return this.announcements.remove(id);
  }
}
