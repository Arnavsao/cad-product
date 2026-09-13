import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';
import {
  OverviewService,
  TIMESERIES_METRICS,
  type OverviewDto,
  type TimeseriesMetric,
  type TimeseriesPointDto,
} from './overview.service';

/** `/admin/overview` — the portal's front page. Read-only, so SUPPORT suffices. */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@AdminOnly()
@Controller('admin')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('overview')
  get(): Promise<OverviewDto> {
    return this.overview.overview();
  }

  /**
   * `GET /admin/timeseries?metric=signups&days=30`.
   *
   * Validated by hand rather than with a DTO class: two scalar params, one of
   * which is a fixed enum, and the clamp for `days` belongs next to the query
   * that uses it.
   */
  @Get('timeseries')
  series(@Query('metric') metric?: string, @Query('days') days?: string): Promise<TimeseriesPointDto[]> {
    const chosen = (TIMESERIES_METRICS as readonly string[]).includes(metric ?? '')
      ? (metric as TimeseriesMetric)
      : 'signups';
    const span = Number.parseInt(days ?? '30', 10);
    return this.overview.timeseries(chosen, Number.isFinite(span) ? span : 30);
  }
}
