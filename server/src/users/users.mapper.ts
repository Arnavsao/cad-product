import type { SupabaseSessionClaims } from '../auth/auth.types';
import type { User, UserPreferences } from '../generated/prisma/client';
import { Units, UserRole } from '../generated/prisma/client';
import type { OrgSummaryDto } from '../organizations/dto/organization.dto';
import type { MeDto, UsageDto, UserDto } from './dto/me.dto';
import { UNITS, USER_ROLES, type PreferencesDto, type UnitsWire, type UserRoleWire } from './dto/preferences.dto';

// -----------------------------------------------------------------------------
// Enum <-> wire. Prisma enum members are upper-case (`Units.MM`), the API
// speaks lower-case (`'mm'`). Keeping the conversion here means neither the
// DB layer nor the DTOs know about the other's casing.
// -----------------------------------------------------------------------------

export function unitsToWire(units: Units): UnitsWire {
  return units.toLowerCase() as UnitsWire;
}

export function unitsFromWire(units: UnitsWire): Units {
  if (!UNITS.includes(units)) {
    throw new RangeError(`Unknown units '${units}'`);
  }
  return units.toUpperCase() as Units;
}

export function roleToWire(role: UserRole | null | undefined): UserRoleWire | null {
  return role ? (role.toLowerCase() as UserRoleWire) : null;
}

export function roleFromWire(role: UserRoleWire | null | undefined): UserRole | null {
  if (role === null || role === undefined) {
    return null;
  }
  if (!USER_ROLES.includes(role)) {
    throw new RangeError(`Unknown role '${role}'`);
  }
  return role.toUpperCase() as UserRole;
}

// -----------------------------------------------------------------------------
// Rows -> DTOs
// -----------------------------------------------------------------------------

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    authId: user.authId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    imageUrl: user.imageUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toPreferencesDto(prefs: UserPreferences): PreferencesDto {
  const ui = prefs.uiState;
  return {
    units: unitsToWire(prefs.units),
    theme: prefs.theme,
    role: roleToWire(prefs.role),
    defaultTemplate: prefs.defaultTemplate,
    autosaveIntervalSec: prefs.autosaveIntervalSec,
    uiState: ui !== null && typeof ui === 'object' && !Array.isArray(ui) ? (ui as Record<string, unknown>) : null,
    emailOnShare: prefs.emailOnShare,
    emailOnOrgActivity: prefs.emailOnOrgActivity,
  };
}

export function toMeDto(
  user: User,
  prefs: UserPreferences,
  usage: UsageDto,
  organizations: OrgSummaryDto[] = [],
): MeDto {
  return {
    user: toUserDto(user),
    preferences: toPreferencesDto(prefs),
    onboarded: user.onboardedAt !== null,
    usage,
    organizations,
  };
}

// -----------------------------------------------------------------------------
// Access-token claims -> local profile. One shape: there is no provider SDK and
// no webhook, so the verified token is the only source.
// -----------------------------------------------------------------------------

/** Fields we mirror from the access token into `users`. */
export interface AuthProfile {
  authId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

/** Domain of the synthetic address below — never routable, and never a real user's. */
export const PLACEHOLDER_EMAIL_SUFFIX = '@local.invalid';

/** Deterministic placeholder when the token carries no email (never a real address). */
export function placeholderEmail(authId: string): string {
  return `${authId}${PLACEHOLDER_EMAIL_SUFFIX}`;
}

/**
 * Splits a single display name into first/last on the FIRST space, so
 * "Ada Lovelace King" becomes ("Ada", "Lovelace King").
 *
 * Supabase has no first/last name fields — OAuth providers populate
 * `user_metadata.full_name` (or `name`) — so a split is the only way to fill the
 * two columns this schema already has. It is a heuristic and will get some names
 * wrong, which is exactly why `user_metadata.first_name`/`last_name`, written by
 * our own account form, take precedence over it.
 */
export function splitName(full: string): { firstName: string | null; lastName: string | null } {
  const trimmed = full.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }
  const space = trimmed.indexOf(' ');
  if (space === -1) {
    return { firstName: trimmed, lastName: null };
  }
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

/** Reads a string off `user_metadata`, treating blanks as absent. */
function metaString(claims: SupabaseSessionClaims, key: string): string | null {
  const value = claims.user_metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Builds the mirrored profile from verified token claims alone — no Backend API
 * call and no webhook, because Supabase puts `email` at the top level and the
 * profile under `user_metadata` on every access token.
 */
export function profileFromClaims(authId: string, claims: SupabaseSessionClaims): AuthProfile {
  const email = typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim() : placeholderEmail(authId);

  // Explicit fields win over a split display name; see `splitName`.
  const explicitFirst = metaString(claims, 'first_name');
  const explicitLast = metaString(claims, 'last_name');
  const display = metaString(claims, 'full_name') ?? metaString(claims, 'name');
  const split = display ? splitName(display) : { firstName: null, lastName: null };

  return {
    authId,
    email,
    firstName: explicitFirst ?? split.firstName,
    lastName: explicitLast ?? split.lastName,
    imageUrl: metaString(claims, 'avatar_url') ?? metaString(claims, 'picture'),
  };
}
