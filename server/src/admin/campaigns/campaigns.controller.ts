import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { PlatformRole, type User } from '../../generated/prisma/client';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/audited.decorator';
import {
  CreateCampaignDto,
  TestSendDto,
  type AdminCampaignDto,
  type AudiencePreviewDto,
} from '../dto/admin-campaign.dto';
import { CampaignsService } from './campaigns.service';

/**
 * `/admin/campaigns` — bulk email.
 *
 * OWNER for everything that sends. A campaign reaches every customer at once
 * and cannot be recalled, which puts it in a different category from the rest
 * of the portal: there is no undo, no per-recipient review, and a mistake is
 * visible to the whole user base within minutes.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@AdminOnly(PlatformRole.ADMIN)
@Controller('admin/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(): Promise<AdminCampaignDto[]> {
    return this.campaigns.list();
  }

  /** Suppressions are listed before `:id` so the literal path is not read as an id. */
  @Get('suppressions')
  suppressions(): Promise<{ email: string; reason: string; createdAt: string }[]> {
    return this.campaigns.listSuppressions();
  }

  @AdminOnly(PlatformRole.OWNER)
  @Audited({ action: 'campaign.unsuppress', targetType: 'system', reasonField: null })
  @Delete('suppressions/:email')
  unsuppress(@Param('email') email: string): Promise<{ email: string }> {
    return this.campaigns.unsuppress(email);
  }

  @Get(':id')
  get(@Param('id', ParseCuidPipe) id: string): Promise<AdminCampaignDto> {
    return this.campaigns.get(id);
  }

  /** How many people this reaches, before anything is sent. */
  @Get(':id/preview')
  preview(@Param('id', ParseCuidPipe) id: string): Promise<AudiencePreviewDto> {
    return this.campaigns.preview(id);
  }

  @Audited({ action: 'campaign.create', targetType: 'system', reasonField: null })
  @Post()
  create(@CurrentUser() actor: User, @Body() dto: CreateCampaignDto): Promise<AdminCampaignDto> {
    return this.campaigns.create(actor, dto);
  }

  /** Sends the real message to one address, so it can be read in a client. */
  @Audited({ action: 'campaign.testSend', targetType: 'system', reasonField: null })
  @Post(':id/test')
  test(@Param('id', ParseCuidPipe) id: string, @Body() dto: TestSendDto): Promise<{ sent: boolean }> {
    return this.campaigns.testSend(id, dto.to);
  }

  /** The irreversible one. OWNER only. */
  @AdminOnly(PlatformRole.OWNER)
  @Audited({ action: 'campaign.send', targetType: 'system', reasonField: null })
  @Post(':id/send')
  send(@Param('id', ParseCuidPipe) id: string): Promise<AdminCampaignDto> {
    return this.campaigns.send(id);
  }
}
