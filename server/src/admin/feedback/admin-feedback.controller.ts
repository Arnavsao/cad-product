import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import type { Page } from '../../common/utils/pagination';
import type { User } from '../../generated/prisma/client';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';
import { AuditContext } from '../audit/audit.context';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/audited.decorator';
import {
  ListFeedbackQueryDto,
  ReplyFeedbackDto,
  UpdateFeedbackDto,
  type AdminFeedbackDetailDto,
  type AdminFeedbackRowDto,
} from '../dto/admin-feedback.dto';
import { AdminFeedbackService } from './admin-feedback.service';

/**
 * `/admin/feedback` — the beta's inbox.
 *
 * Everything here is SUPPORT: triaging and answering reports is exactly what
 * that tier exists for, and putting a reply behind ADMIN would mean the people
 * doing the work cannot finish it.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@AdminOnly()
@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly feedback: AdminFeedbackService) {}

  @Get()
  list(@Query() query: ListFeedbackQueryDto, @CurrentUser('id') actorId: string): Promise<Page<AdminFeedbackRowDto>> {
    return this.feedback.list(query, actorId);
  }

  /**
   * `GET /admin/feedback/export.csv`.
   *
   * Declared before `:id` because Nest matches routes in declaration order and
   * `export.csv` would otherwise be swallowed as an id. `@RawResponse()` so the
   * body is the CSV itself rather than a JSON envelope around it.
   */
  @Get('export.csv')
  @RawResponse()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cado-feedback.csv"')
  exportCsv(@Query() query: ListFeedbackQueryDto, @CurrentUser('id') actorId: string): Promise<string> {
    return this.feedback.exportCsv(query, actorId);
  }

  @Get(':id')
  get(@Param('id', ParseCuidPipe) id: string): Promise<AdminFeedbackDetailDto> {
    return this.feedback.get(id);
  }

  @Audited({ action: 'feedback.update', targetType: 'feedback', reasonField: null })
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateFeedbackDto,
    @CurrentUser('id') actorId: string,
  ): Promise<AdminFeedbackDetailDto> {
    AuditContext.setBefore(req, await this.feedback.snapshot(id));
    return this.feedback.update(id, dto, actorId);
  }

  @Audited({ action: 'feedback.reply', targetType: 'feedback', reasonField: null })
  @Post(':id/reply')
  async reply(
    @Req() req: Request,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: ReplyFeedbackDto,
    @CurrentUser() actor: User,
  ): Promise<AdminFeedbackDetailDto> {
    AuditContext.setBefore(req, await this.feedback.snapshot(id));
    return this.feedback.reply(id, dto.body, actor);
  }
}
