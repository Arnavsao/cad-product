import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { AuthUser } from '../../auth/auth.types';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { ApiException } from '../../common/errors/api-error';
import type { Env } from '../../config/env.schema';
import { PlatformRole, type JobRun } from '../../generated/prisma/client';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/audited.decorator';
import { JOB_REGISTRY, isJobName, jobDefinition, type JobName } from './job-registry';
import { JobsService } from './jobs.service';

/** One recorded run, on the wire. */
interface JobRunDto {
  id: string;
  name: string;
  status: string;
  summary: unknown;
  error: string | null;
  triggeredById: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Prisma enums are upper-case, the API speaks lower-case — the same split
 * `users.mapper.ts` makes. Returning the raw row here would make this the one
 * endpoint in the portal that shouts its enums.
 */
function toRunDto(run: JobRun): JobRunDto {
  return {
    id: run.id,
    name: run.name,
    status: run.status.toLowerCase(),
    summary: run.summary,
    error: run.error,
    triggeredById: run.triggeredById,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

/** One job as the portal lists it. */
interface JobStatusDto {
  name: string;
  description: string;
  suggestedCron: string;
  destructive: boolean;
  lastRun: {
    id: string;
    status: string;
    summary: unknown;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
    stuck: boolean;
  } | null;
}

/**
 * `/admin/system/jobs`.
 *
 * The run endpoint is the one place in the portal reachable WITHOUT a staff
 * account: the scheduler is a cron job with no user, so it presents
 * `JOB_RUNNER_TOKEN` instead. `@OptionalAuth()` rather than `@Public()` so a
 * signed-in owner pressing Run is still identified and attributed on the run
 * row — the same reason the feedback endpoint uses it.
 */
@Throttle(ADMIN_THROTTLE)
@Controller('admin/system/jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @UseGuards(AdminGuard)
  @AdminOnly()
  @Get()
  async list(): Promise<JobStatusDto[]> {
    const latest = await this.jobs.latest();
    return (Object.keys(JOB_REGISTRY) as JobName[]).map((name) => {
      const def = jobDefinition(name);
      const run = latest[name];
      return {
        name,
        description: def.description,
        suggestedCron: def.suggestedCron,
        destructive: def.destructive,
        lastRun: run
          ? {
              id: run.id,
              status: run.status.toLowerCase(),
              summary: run.summary,
              error: run.error,
              startedAt: run.startedAt.toISOString(),
              finishedAt: run.finishedAt?.toISOString() ?? null,
              // A run still marked RUNNING past its timeout is how a job that
              // died without finishing becomes visible.
              stuck:
                run.status === 'RUNNING' &&
                Date.now() - run.startedAt.getTime() > def.timeoutMinutes * 60_000,
            }
          : null,
      };
    });
  }

  @UseGuards(AdminGuard)
  @AdminOnly()
  @Get('history')
  async history(@Query('name') name?: string): Promise<JobRunDto[]> {
    const runs = await this.jobs.history(name && isJobName(name) ? name : undefined);
    return runs.map(toRunDto);
  }

  /**
   * `POST /admin/system/jobs/:name/run`.
   *
   * Two ways in, and both are checked here rather than by a guard, because the
   * guard cannot express "either a staff tier or a shared secret":
   * - a signed-in OWNER pressing Run in the portal;
   * - the scheduler presenting `X-Job-Token`.
   *
   * Anything else is refused. A request with neither gets 401 rather than 403,
   * because the honest answer is that it did not identify itself at all.
   */
  @OptionalAuth()
  @UseInterceptors(AuditInterceptor)
  @Audited({ action: 'job.run', targetType: 'system', idParam: 'name', reasonField: null })
  @Post(':name/run')
  async run(
    @Req() req: Request,
    @Param('name') name: string,
    @Headers('x-job-token') token?: string,
  ): Promise<JobRunDto> {
    if (!isJobName(name)) {
      throw ApiException.notFound('UNKNOWN_JOB', `No such job '${name}'`);
    }

    const actor = (req as Request & { user?: AuthUser }).user;
    const isOwner = actor?.record?.platformRole === PlatformRole.OWNER;

    if (!isOwner && !this.tokenMatches(token)) {
      throw new ApiException(
        actor ? 403 : 401,
        actor ? 'FORBIDDEN' : 'UNAUTHENTICATED',
        'Running a job needs an owner session or a valid job token',
      );
    }

    // Attributed only when a person did it; a scheduled run has no actor, and
    // recording one would misrepresent who decided.
    return toRunDto(await this.jobs.run(name, isOwner ? (actor?.id ?? null) : null));
  }

  /** Constant-time, and false when no token is configured at all. */
  private tokenMatches(provided: string | undefined): boolean {
    const expected = this.config.get('JOB_RUNNER_TOKEN', { infer: true });
    if (!expected || !provided) {
      return false;
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
