import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Page } from '../../common/utils/pagination';
import { PlatformRole } from '../../generated/prisma/client';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';
import {
  AdminBillingService,
  type AdminSubscriptionRowDto,
  type AdminWebhookRowDto,
  type BillingSummaryDto,
} from './admin-billing.service';

/**
 * `/admin/billing` — read-only.
 *
 * Replaying a stuck webhook is a JOB, not a button here: it is the same
 * operation the scheduler runs every half hour, and having two code paths that
 * re-apply billing events would be two places to get idempotency wrong.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@AdminOnly()
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  @Get()
  summary(): Promise<BillingSummaryDto> {
    return this.billing.summary();
  }

  @Get('subscriptions')
  subscriptions(
    @Query('plan') plan?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ): Promise<Page<AdminSubscriptionRowDto>> {
    return this.billing.subscriptions({ plan, status, page: Number(page) || 1 });
  }

  /** ADMIN and up: a delivery's error text can name a customer. */
  @AdminOnly(PlatformRole.ADMIN)
  @Get('webhooks')
  webhooks(@Query('status') status?: string, @Query('page') page?: string): Promise<Page<AdminWebhookRowDto>> {
    return this.billing.webhooks({ status, page: Number(page) || 1 });
  }
}
