import type { User as ClerkUser, UserJSON } from '@clerk/backend';
import type { User, UserPreferences } from '../generated/prisma/client';
import { Units, UserRole } from '../generated/prisma/client';
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
    clerkId: user.clerkId,
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
  };
}

export function toMeDto(user: User, prefs: UserPreferences, usage: UsageDto): MeDto {
  return {
    user: toUserDto(user),
    preferences: toPreferencesDto(prefs),
    onboarded: user.onboardedAt !== null,
    usage,
  };
}

// -----------------------------------------------------------------------------
// Clerk -> local profile. Two shapes: the Backend SDK resource (camelCase, used
// by the lazy-create path) and the webhook JSON (snake_case).
// -----------------------------------------------------------------------------

/** Fields we copy from Clerk into `users`. */
export interface ClerkProfile {
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

/** Deterministic placeholder when Clerk gives us no email (never a real address). */
export function placeholderEmail(clerkId: string): string {
  return `${clerkId}@local.invalid`;
}

export function profileFromClerkUser(user: ClerkUser): ClerkProfile {
  const primary =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    placeholderEmail(user.id);
  return {
    clerkId: user.id,
    email: primary,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    imageUrl: user.imageUrl ?? null,
  };
}

export function profileFromClerkUserJson(data: UserJSON): ClerkProfile {
  const emails = data.email_addresses ?? [];
  const primary =
    emails.find((e) => e.id === data.primary_email_address_id)?.email_address ??
    emails[0]?.email_address ??
    placeholderEmail(data.id);
  return {
    clerkId: data.id,
    email: primary,
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null,
    imageUrl: data.image_url ?? null,
  };
}
