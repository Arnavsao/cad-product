import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  defaultFlags,
  flagDefinition,
  isFlagKey,
  type FlagKey,
  type FlagMap,
  type FlagState,
} from './flag-registry';

/**
 * How long the effective map is served from memory. Short enough that a staff
 * member flipping a switch sees the effect on the site within a minute without
 * asking anyone to redeploy, long enough that the sign-up path and `GET /flags`
 * cost nothing per request.
 *
 * A write invalidates immediately in *this* process; the TTL is what bounds the
 * lag on the other replicas, which is why it is a minute and not an hour.
 */
export const FLAG_CACHE_TTL_MS = 60_000;

@Injectable()
export class FlagsService {
  private readonly logger = new Logger(FlagsService.name);
  private cache: { map: FlagMap; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The effective flags: registry defaults with database overrides applied.
   *
   * A read failure returns the defaults rather than throwing. Flags gate the
   * sign-up path and the editor's panels, so "the database hiccuped" must
   * degrade to the shipped behaviour, never to a 500 on every route.
   */
  async all(): Promise<FlagMap> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.map;
    }

    const map = defaultFlags();
    try {
      const rows = await this.prisma.featureFlag.findMany();
      for (const row of rows) {
        if (!isFlagKey(row.key)) {
          // A key retired from the registry. Left in place (it costs nothing and
          // makes a rollback trivial) but never served.
          continue;
        }
        map[row.key] = {
          key: row.key,
          enabled: row.enabled,
          payload: (row.payload as Record<string, unknown> | null) ?? map[row.key].payload,
        };
      }
      this.cache = { map, expiresAt: now + FLAG_CACHE_TTL_MS };
    } catch (error) {
      this.logger.warn(`Falling back to default flags: ${(error as Error).message}`);
    }
    return map;
  }

  /** One flag's effective state. */
  async get(key: FlagKey): Promise<FlagState> {
    return (await this.all())[key];
  }

  /** Convenience for the common "is this switched on" question. */
  async enabled(key: FlagKey): Promise<boolean> {
    return (await this.get(key)).enabled;
  }

  /**
   * Writes an override and drops the cache.
   *
   * The caller is `AdminFlagsController`, which has already checked the tier;
   * validating the key here as well is not redundant — it is what stops a typo
   * becoming a row nothing reads.
   */
  async set(
    key: FlagKey,
    actorId: string,
    patch: { enabled: boolean; payload?: Record<string, unknown> | null },
  ): Promise<FlagState> {
    const payload = patch.payload === undefined ? (flagDefinition(key).payload ?? null) : patch.payload;
    // `DbNull` writes a real SQL NULL; a bare `null` would be the JSON literal
    // `null`, which reads back as "there is a payload and it is null".
    const json: Prisma.InputJsonObject | typeof Prisma.DbNull = payload
      ? (payload as Prisma.InputJsonObject)
      : Prisma.DbNull;
    const row = await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled: patch.enabled, payload: json, updatedById: actorId },
      update: { enabled: patch.enabled, payload: json, updatedById: actorId },
    });
    this.invalidate();
    return {
      key,
      enabled: row.enabled,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
    };
  }

  /** Removes the override, returning the flag to its registry default. */
  async reset(key: FlagKey): Promise<FlagState> {
    await this.prisma.featureFlag.deleteMany({ where: { key } });
    this.invalidate();
    return defaultFlags()[key];
  }

  invalidate(): void {
    this.cache = null;
  }
}
