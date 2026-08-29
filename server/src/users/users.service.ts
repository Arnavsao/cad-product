import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ClerkSessionClaims } from '../auth/auth.types';
import { ClerkClientProvider } from '../auth/clerk-client.provider';
import { ApiException } from '../common/errors/api-error';
import type { Units, User, UserPreferences, UserRole } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import type { MeDto, UsageDto } from './dto/me.dto';
import type { OnboardingDto } from './dto/onboarding.dto';
import { UI_STATE_MAX_BYTES, type PreferencesDto, type UpdatePreferencesDto } from './dto/preferences.dto';
import {
  ClerkProfile,
  placeholderEmail,
  profileFromClerkUser,
  roleFromWire,
  toMeDto,
  toPreferencesDto,
  unitsFromWire,
} from './users.mapper';

/** Either the root client or an interactive-transaction client. */
export type DbClient = PrismaService | Prisma.TransactionClient;

/**
 * Plain-value patch for `user_preferences`. Assignable to BOTH the unchecked
 * create and update inputs, so one object serves `upsert`'s two branches.
 */
interface PreferencesPatch {
  units?: Units;
  theme?: string;
  role?: UserRole | null;
  defaultTemplate?: string;
  autosaveIntervalSec?: number;
  uiState?: Prisma.InputJsonObject | typeof Prisma.DbNull;
}

/**
 * Local user lifecycle + `/me` read model.
 *
 * Design — lazy-create: the local `users` row is created on the FIRST
 * authenticated request (`ensureLocalUser`) rather than only by the Clerk
 * webhook. Webhooks are asynchronous and can be delayed, misconfigured or
 * unreachable in local dev, and a user who has just signed up must be able to
 * hit `/me` immediately. The webhook then keeps the profile in sync
 * (`upsertFromClerk`) and handles deletion (`softDeleteByClerkId`).
 *
 * Preferences are upserted with defaults on first read so `MeDto.preferences`
 * is never null and the onboarding flow only ever PATCHes.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkClientProvider,
  ) {}

  // ---------------------------------------------------------------------------
  // Provisioning
  // ---------------------------------------------------------------------------

  /**
   * Returns the local user for a verified Clerk `sub`, creating it on a miss.
   * Profile data comes from the Clerk Backend API when a secret key is
   * configured, otherwise from the token claims (dev / e2e).
   */
  async ensureLocalUser(clerkId: string, claims: ClerkSessionClaims = { sub: clerkId }): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { clerkId } });
    if (existing) {
      return existing;
    }

    const profile = await this.resolveProfile(clerkId, claims);
    try {
      return await this.prisma.user.create({ data: profile });
    } catch (error) {
      // Two first-requests raced; the other one won — read it back.
      if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        const winner = await this.prisma.user.findUnique({ where: { clerkId } });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /** Upsert from a Clerk profile (webhook `user.created`/`user.updated`, or lazy path). */
  async upsertFromClerk(profile: ClerkProfile, db: DbClient = this.prisma): Promise<User> {
    const { clerkId, ...rest } = profile;
    return db.user.upsert({
      where: { clerkId },
      create: { clerkId, ...rest },
      update: rest,
    });
  }

  /** Soft-deletes (webhook `user.deleted`). Idempotent. */
  async softDeleteByClerkId(clerkId: string, db: DbClient = this.prisma): Promise<boolean> {
    const res = await db.user.updateMany({
      where: { clerkId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return res.count > 0;
  }

  private async resolveProfile(clerkId: string, claims: ClerkSessionClaims): Promise<ClerkProfile> {
    const fromClaims: ClerkProfile = {
      clerkId,
      email: typeof claims.email === 'string' && claims.email ? claims.email : placeholderEmail(clerkId),
      firstName: typeof claims.first_name === 'string' ? claims.first_name : null,
      lastName: typeof claims.last_name === 'string' ? claims.last_name : null,
      imageUrl: typeof claims.image_url === 'string' ? claims.image_url : null,
    };

    if (!this.clerk.client) {
      return fromClaims;
    }
    try {
      const clerkUser = await this.clerk.client.users.getUser(clerkId);
      return profileFromClerkUser(clerkUser);
    } catch (error) {
      // Keep the request alive; the webhook will correct the profile later.
      this.logger.warn(`Clerk users.getUser(${clerkId}) failed, using token claims: ${(error as Error).message}`);
      return fromClaims;
    }
  }

  // ---------------------------------------------------------------------------
  // /me
  // ---------------------------------------------------------------------------

  async getMe(userId: string): Promise<MeDto> {
    const [user, prefs, usage] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.ensurePreferences(userId),
      this.getUsage(userId),
    ]);
    return toMeDto(user, prefs, usage);
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<PreferencesDto> {
    const patch = this.toPreferencesPatch(dto);
    const prefs = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
    });
    return toPreferencesDto(prefs);
  }

  /**
   * Marks onboarding complete exactly once (`onboardedAt` is only written when
   * null) and stores the chosen role/units/template. Re-posting is a no-op
   * for the timestamp but still updates preferences, so the flow is idempotent.
   */
  async completeOnboarding(userId: string, dto: OnboardingDto): Promise<MeDto> {
    const patch: PreferencesPatch = {
      role: roleFromWire(dto.role),
      units: unitsFromWire(dto.units),
      ...(dto.defaultTemplate ? { defaultTemplate: dto.defaultTemplate } : {}),
    };

    await this.prisma.$transaction([
      this.prisma.userPreferences.upsert({ where: { userId }, create: { userId, ...patch }, update: patch }),
      this.prisma.user.updateMany({ where: { id: userId, onboardedAt: null }, data: { onboardedAt: new Date() } }),
    ]);
    return this.getMe(userId);
  }

  /** Preferences row, created with defaults on first access. */
  async ensurePreferences(userId: string): Promise<UserPreferences> {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /** `SUM(byteSize)` / `COUNT(*)` over the user's non-deleted drawings. */
  async getUsage(userId: string): Promise<UsageDto> {
    const agg = await this.prisma.drawing.aggregate({
      where: { ownerId: userId, deletedAt: null },
      _sum: { byteSize: true },
      _count: { _all: true },
    });
    return { bytesUsed: agg._sum.byteSize ?? 0, drawingCount: agg._count._all };
  }

  private toPreferencesPatch(dto: UpdatePreferencesDto): PreferencesPatch {
    const data: PreferencesPatch = {};
    if (dto.units !== undefined) {
      data.units = unitsFromWire(dto.units);
    }
    if (dto.theme !== undefined) {
      data.theme = dto.theme;
    }
    if (dto.role !== undefined) {
      data.role = roleFromWire(dto.role);
    }
    if (dto.defaultTemplate !== undefined) {
      data.defaultTemplate = dto.defaultTemplate;
    }
    if (dto.autosaveIntervalSec !== undefined) {
      data.autosaveIntervalSec = dto.autosaveIntervalSec;
    }
    if (dto.uiState !== undefined) {
      if (dto.uiState === null) {
        data.uiState = Prisma.DbNull;
      } else {
        const serialised = JSON.stringify(dto.uiState);
        if (Buffer.byteLength(serialised, 'utf8') > UI_STATE_MAX_BYTES) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UI_STATE_TOO_LARGE', 'uiState exceeds 64 KB', {
            limitBytes: UI_STATE_MAX_BYTES,
          });
        }
        data.uiState = dto.uiState as Prisma.InputJsonObject;
      }
    }
    return data;
  }
}
