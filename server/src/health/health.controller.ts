import { Controller, Get, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ApiException } from '../common/errors/api-error';
import { PrismaService } from '../prisma/prisma.service';

/** Body of a healthy `GET /healthz`. */
export interface HealthDto {
  status: 'ok';
  db: true;
}

/**
 * Liveness/readiness probe. Lives outside the `/api/v1` prefix (see
 * `setGlobalPrefix` exclude in `app.setup.ts`) so load balancers and the
 * Dockerfile `HEALTHCHECK` can hit a stable path. Unauthenticated and
 * unthrottled: probes run every few seconds from fixed IPs.
 */
@Controller('healthz')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check(): Promise<HealthDto> {
    const db = await this.prisma.ping();
    if (!db) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'DB_UNAVAILABLE', 'Database unreachable', {
        status: 'degraded',
        db: false,
      });
    }
    return { status: 'ok', db: true };
  }
}
