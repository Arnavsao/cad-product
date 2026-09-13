import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlagsService } from '../admin/flags/flags.service';
import type { SupabaseSessionClaims } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import { ApiException } from '../common/errors/api-error';
import type { Env } from '../config/env.schema';
import type { Units, User, UserPreferences, UserRole } from '../generated/prisma/client';
import { PlatformRole, Prisma } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import type { MeDto, UsageDto } from './dto/me.dto';
import type { OnboardingDto } from './dto/onboarding.dto';
import { UI_STATE_MAX_BYTES, type PreferencesDto, type UpdatePreferencesDto } from './dto/preferences.dto';
import {
  AuthProfile,
  PLACEHOLDER_EMAIL_SUFFIX,
  profileFromClaims,
  roleFromWire,
  toMeDto,
  toPreferencesDto,
  unitsFromWire,
} from './users.mapper';

/**
 * How stale `lastSeenAt` may get before the guard writes it again. One hour: it
 * feeds day-granularity active-user counts, so a finer value would buy nothing
 * and cost a write per request.
 */
const LAST_SEEN_THRESHOLD_MS = 60 * 60 * 1000;

/** Either the root client or an interactive-transaction client. */
export type DbClient = PrismaService | Prisma.TransactionClient;

/**
 * Plain-value patch for `user_preferences`. Assignable to BOTH the unchecked
 * create and update inputs, so one object serves `upsert`'s two branches.
 */
interface PreferencesPatch {
  units?: Units;
  theme?: string;
  locale?: string;
  role?: UserRole | null;
  defaultTemplate?: string;
  autosaveIntervalSec?: number;
  uiState?: Prisma.InputJsonObject | typeof Prisma.DbNull;
  emailOnShare?: boolean;
  emailOnOrgActivity?: boolean;
}

/**
 * Local user lifecycle + `/me` read model.
 *
 * Design — lazy-create: the local `users` row is created on the FIRST
 * authenticated request (`ensureLocalUser`), from the verified access token. A
 * user who has just signed up must be able to hit `/me` immediately, and there is
 * no webhook to wait for — the same call also refreshes the mirrored profile when
 * the token shows it has changed.
 *
 * Preferences are upserted with defaults on first read so `MeDto.preferences`
 * is never null and the onboarding flow only ever PATCHes.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly organizations: OrganizationsService,
    private readonly billing: BillingService,
    private readonly flags: FlagsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---------------------------------------------------------------------------
  // Provisioning
  // ---------------------------------------------------------------------------

  /**
   * Returns the local user for a verified Supabase `sub`, creating it on a miss
   * and refreshing the mirrored profile when the token says it changed.
   *
   * The refresh matters: there is no user webhook anymore, so the access token is
   * the ONLY thing that carries a new name or avatar into this database. Without
   * the diff below, a profile edit would update Supabase and never appear here.
   * It writes only when a field actually differs, so the common path stays a
   * single indexed read.
   */
  async ensureLocalUser(authId: string, claims: SupabaseSessionClaims = { sub: authId }): Promise<User> {
    const profile = profileFromClaims(authId, claims);

    const existing = await this.prisma.user.findUnique({ where: { authId } });
    if (existing) {
      return this.refreshProfileIfStale(await this.applyBootstrapRole(existing), profile);
    }

    // Closing sign-ups can only be enforced here. Supabase owns registration and
    // we do not drive its admin API, so the account may already exist upstream;
    // what we control is whether it gets a local row — and without one, nothing
    // in this product works. Existing users are untouched by design: the switch
    // is "no new accounts", not "nobody may sign in".
    await this.assertSignupsOpen(authId);

    try {
      const created = await this.prisma.user.create({ data: profile });
      return await this.applyBootstrapRole(created);
    } catch (error) {
      // Two first-requests raced; the other one won — read it back.
      if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        const winner = await this.prisma.user.findUnique({ where: { authId } });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /**
   * Refuses to provision a new local user while `signups.enabled` is off.
   *
   * A flag read failure resolves to the registry default (open), so a database
   * blip cannot accidentally close registration — see `FlagsService.all`.
   */
  private async assertSignupsOpen(authId: string): Promise<void> {
    if (await this.flags.enabled('signups.enabled')) {
      return;
    }
    this.logger.warn(`Refused to provision ${authId}: sign-ups are closed`);
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'SIGNUPS_CLOSED',
      'CADO is not accepting new accounts right now',
    );
  }

  /**
   * Promotes an account listed in `ADMIN_BOOTSTRAP_EMAILS` to `OWNER`.
   *
   * Only ever raises the tier: the env list is how the first staff account
   * exists at all, but once the portal is usable, roles are managed there, and
   * a stale entry in the environment must not silently re-grant or claw back
   * what an owner has since decided.
   */
  private async applyBootstrapRole(user: User): Promise<User> {
    if (user.platformRole === PlatformRole.OWNER) {
      return user;
    }
    const bootstrap = this.config.get('ADMIN_BOOTSTRAP_EMAILS', { infer: true });
    if (!bootstrap.length || !bootstrap.includes(user.email.toLowerCase())) {
      return user;
    }
    try {
      const promoted = await this.prisma.user.update({
        where: { id: user.id },
        data: { platformRole: PlatformRole.OWNER },
      });
      this.logger.log(`Bootstrapped ${user.email} to platform OWNER from ADMIN_BOOTSTRAP_EMAILS`);
      return promoted;
    } catch (error) {
      this.logger.warn(`Could not bootstrap ${user.email}: ${(error as Error).message}`);
      return user;
    }
  }

  /**
   * Records that this account was seen, at most once per hour.
   *
   * The threshold is the whole point: the admin overview needs daily/weekly/
   * monthly active counts, and an exact `lastSeenAt` would mean an UPDATE on
   * every authenticated request — a write amplification the product gains
   * nothing from, since no question anyone asks of this column is finer-grained
   * than a day.
   *
   * Never throws: presence tracking is not worth failing a request over.
   */
  async touchLastSeen(user: User): Promise<void> {
    const now = Date.now();
    if (user.lastSeenAt && now - user.lastSeenAt.getTime() < LAST_SEEN_THRESHOLD_MS) {
      return;
    }
    try {
      await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date(now) } });
    } catch (error) {
      this.logger.debug(`Could not update lastSeenAt for ${user.id}: ${(error as Error).message}`);
    }
  }

  /**
   * Writes the claim-derived profile onto an existing row, but only for fields
   * that actually changed.
   *
   * `email` is only overwritten by a real address: a token without an email claim
   * yields the `placeholderEmail`, and letting that clobber a known address would
   * be a regression rather than a refresh.
   */
  private async refreshProfileIfStale(existing: User, profile: AuthProfile): Promise<User> {
    const patch: Prisma.UserUpdateInput = {};
    if (!profile.email.endsWith(PLACEHOLDER_EMAIL_SUFFIX) && profile.email !== existing.email) {
      patch.email = profile.email;
    }
    if (profile.firstName !== existing.firstName) {
      patch.firstName = profile.firstName;
    }
    if (profile.lastName !== existing.lastName) {
      patch.lastName = profile.lastName;
    }
    if (profile.imageUrl !== existing.imageUrl) {
      patch.imageUrl = profile.imageUrl;
    }

    if (Object.keys(patch).length === 0) {
      return existing;
    }
    try {
      return await this.prisma.user.update({ where: { id: existing.id }, data: patch });
    } catch (error) {
      // A stale mirror must never fail the request that noticed it.
      this.logger.warn(`Could not refresh profile for ${existing.id}: ${(error as Error).message}`);
      return existing;
    }
  }

  // ---------------------------------------------------------------------------
  // /me
  // ---------------------------------------------------------------------------

  /**
   * `known` is the row the auth guard already loaded for this request. Passing it
   * saves the second read of the same user; callers that just changed the row
   * (onboarding) leave it out so the fresh values are returned.
   */
  async getMe(userId: string, known?: User): Promise<MeDto> {
    // Billing joins the existing fan-out rather than adding a round trip: it is
    // one indexed primary-key read, so `/me` costs the same as before.
    const [user, prefs, usage, organizations, billing] = await Promise.all([
      known && known.id === userId ? known : this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.ensurePreferences(userId),
      this.getUsage(userId),
      this.organizations.listForUser(userId),
      this.billing.stateFor(userId),
    ]);
    return toMeDto(user, prefs, usage, organizations, billing);
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

    const [, onboarded] = await this.prisma.$transaction([
      this.prisma.userPreferences.upsert({ where: { userId }, create: { userId, ...patch }, update: patch }),
      this.prisma.user.updateMany({ where: { id: userId, onboardedAt: null }, data: { onboardedAt: new Date() } }),
    ]);

    // Only on the FIRST completion — the `onboardedAt: null` predicate above means
    // a re-post updates preferences but changes no rows, and re-posting must not
    // re-send the welcome. `publish` never throws, so this cannot fail onboarding.
    if (onboarded.count > 0) {
      await this.notifications.publish(userId, {
        kind: 'account',
        title: 'Welcome to CADO',
        body: 'Your workspace is ready. Create a drawing, or upload an existing DXF to get started.',
        linkUrl: '/dashboard',
      });
    }
    return this.getMe(userId);
  }

  /**
   * Preferences row, created with defaults on first access.
   *
   * A plain read first: `/me` is fetched on every dashboard visit, and an
   * `upsert` with an empty update still takes a row lock and writes WAL on each
   * of them. The create only runs on the very first request of an account; two
   * such requests racing is settled by the unique index and a re-read.
   */
  async ensurePreferences(userId: string): Promise<UserPreferences> {
    const existing = await this.prisma.userPreferences.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.userPreferences.create({ data: { userId } });
    } catch (error) {
      if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        const winner = await this.prisma.userPreferences.findUnique({ where: { userId } });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
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
    // Validated against LOCALES by the DTO, so what arrives here is a shipped
    // language. Stored as the BCP 47 tag the client sent; `localeToWire`
    // narrows it again on the way out in case the set ever shrinks.
    if (dto.locale !== undefined) {
      data.locale = dto.locale;
    }
    // Validated against LOCALES by the DTO, so what arrives here is a shipped
    // language. Stored as the BCP 47 tag the client sent; `localeToWire`
    // narrows it again on the way out in case the set ever shrinks.
    if (dto.role !== undefined) {
      data.role = roleFromWire(dto.role);
    }
    if (dto.defaultTemplate !== undefined) {
      data.defaultTemplate = dto.defaultTemplate;
    }
    if (dto.autosaveIntervalSec !== undefined) {
      data.autosaveIntervalSec = dto.autosaveIntervalSec;
    }
    if (dto.emailOnShare !== undefined) {
      data.emailOnShare = dto.emailOnShare;
    }
    if (dto.emailOnOrgActivity !== undefined) {
      data.emailOnOrgActivity = dto.emailOnOrgActivity;
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
