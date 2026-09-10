import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.schema';
import { Prisma, PrismaClient } from '../generated/prisma/client';

/** Prisma error codes we translate into HTTP semantics. */
export const PRISMA_ERROR = {
  /** Unique constraint violated. */
  UNIQUE_VIOLATION: 'P2002',
  /** Foreign key constraint failed. */
  FK_VIOLATION: 'P2003',
  /** Record required by the operation was not found. */
  NOT_FOUND: 'P2025',
} as const;

/**
 * Duck-typed check for `PrismaClientKnownRequestError`. We do not rely on
 * `instanceof` because Jest module registries and the generated-client
 * runtime can yield different class identities for the same error.
 */
export function isPrismaKnownError(error: unknown, code?: string): error is Prisma.PrismaClientKnownRequestError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown; clientVersion?: unknown };
  if (typeof candidate.code !== 'string' || !/^P\d{4}$/.test(candidate.code)) {
    return false;
  }
  return code === undefined || candidate.code === code;
}

/**
 * Application-wide Prisma client.
 *
 * Design (Prisma 7): the client no longer reads a URL from `schema.prisma`; it
 * needs a driver adapter. We use `@prisma/adapter-pg` on `DATABASE_URL` (the
 * pooled Neon host in prod) with a small pool, while migrations run through
 * `prisma.config.ts` on `DIRECT_DATABASE_URL`. Connecting in `onModuleInit`
 * surfaces a bad DB config at boot; `enableShutdownHooks()` in `main.ts` lets
 * `onModuleDestroy` drain the pool on SIGTERM so container restarts are clean.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** Interval between keep-alive pings, in ms; 0 disables. See `DB_KEEPALIVE_SECONDS`. */
  private readonly keepaliveMs: number;
  private keepalive: NodeJS.Timeout | null = null;

  constructor(config: ConfigService<Env, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: 10,
    });
    const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
    super({
      adapter,
      log: isProd ? ['warn', 'error'] : ['warn', 'error'],
    });
    this.keepaliveMs = config.get('DB_KEEPALIVE_SECONDS', { infer: true }) * 1000;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Postgres');
    if (this.keepaliveMs > 0) {
      // Neon parks an idle compute after ~5 minutes and the next connection then
      // waits out a cold start of a second or more. A cheap periodic ping keeps
      // the compute (and this pool's connections) warm so the first request
      // after a quiet spell is as fast as the tenth. `unref` so a pending timer
      // never holds the process open during shutdown.
      this.keepalive = setInterval(() => void this.ping(), this.keepaliveMs);
      this.keepalive.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
    await this.$disconnect();
  }

  /** Cheap liveness probe used by `GET /healthz`. Never throws. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(`Database ping failed: ${(error as Error).message}`);
      return false;
    }
  }
}
