import { PlatformRole } from '../generated/prisma/client';

/**
 * Platform staff tiers, on the wire.
 *
 * Lower case like every other enum the API speaks (`common/access.ts`,
 * `users.mapper.ts`): the database stores `platform_role` lowercase already, and
 * the client should never have to know that Prisma's members are upper case.
 */
export const PLATFORM_ROLES = ['user', 'support', 'admin', 'owner'] as const;
export type PlatformRoleWire = (typeof PLATFORM_ROLES)[number];

/**
 * Ordering of the tiers; higher wins. Mirrors `LEVEL_RANK` in
 * `common/access.ts` so both authorization tables read the same way.
 *
 * `USER` is rank 0 and is NOT staff: `isStaff` is the only place that decision
 * is made, so "does this person see the portal at all" cannot drift from "which
 * tier are they".
 */
export const PLATFORM_RANK: Record<PlatformRole, number> = {
  [PlatformRole.USER]: 0,
  [PlatformRole.SUPPORT]: 1,
  [PlatformRole.ADMIN]: 2,
  [PlatformRole.OWNER]: 3,
};

/** True when `role` is at least `required`. */
export function allowsPlatform(role: PlatformRole, required: PlatformRole): boolean {
  return PLATFORM_RANK[role] >= PLATFORM_RANK[required];
}

/** True for anything above `USER` — i.e. the admin portal is reachable at all. */
export function isStaff(role: PlatformRole): boolean {
  return PLATFORM_RANK[role] > PLATFORM_RANK[PlatformRole.USER];
}

export function platformRoleToWire(role: PlatformRole): PlatformRoleWire {
  return role.toLowerCase() as PlatformRoleWire;
}

export function platformRoleFromWire(role: PlatformRoleWire): PlatformRole {
  if (!PLATFORM_ROLES.includes(role)) {
    throw new RangeError(`Unknown platform role '${role}'`);
  }
  return role.toUpperCase() as PlatformRole;
}
