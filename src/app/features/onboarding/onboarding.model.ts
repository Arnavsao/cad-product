import { Units, UserRole } from '../../core/api/api.models';

/**
 * Local shape of the onboarding wizard.
 *
 * Design decision: the wizard keeps ONE draft object in a signal rather than a
 * form per step. Steps are pure presentational components that receive the
 * draft and emit a `Partial<OnboardingDraft>` patch, so going back and forth
 * never loses input and the final POST is assembled from a single source.
 */
export interface OnboardingDraft {
  firstName: string;
  lastName: string;
  /** Chip id — several chips map onto the same `UserRole` (see `ROLE_CHOICES`). */
  roleChoice: RoleChoiceId | null;
  units: Units;
  /** Theme registry id, applied live while the user picks it. */
  themeId: string;
}

export type RoleChoiceId = 'architect' | 'engineer' | 'student' | 'hobbyist' | 'other';

export interface RoleChoice {
  id: RoleChoiceId;
  /** Translation key of the chip label (`onboarding.roles.*`). */
  labelKey: string;
  /** The API only knows four roles; "Hobbyist" is stored as `other`. */
  role: UserRole;
}

export const ROLE_CHOICES: readonly RoleChoice[] = [
  { id: 'architect', labelKey: 'onboarding.roles.architect', role: 'architect' },
  { id: 'engineer', labelKey: 'onboarding.roles.engineer', role: 'engineer' },
  { id: 'student', labelKey: 'onboarding.roles.student', role: 'student' },
  { id: 'hobbyist', labelKey: 'onboarding.roles.hobbyist', role: 'other' },
  { id: 'other', labelKey: 'onboarding.roles.other', role: 'other' },
];

export interface UnitChoice {
  id: Units;
  /** The unit symbol — an identifier, never translated. */
  label: string;
  /** Translation key of the spelled-out name (`onboarding.units.*`). */
  nameKey: string;
}

export const UNIT_CHOICES: readonly UnitChoice[] = [
  { id: 'mm', label: 'mm', nameKey: 'onboarding.units.mm' },
  { id: 'cm', label: 'cm', nameKey: 'onboarding.units.cm' },
  { id: 'm', label: 'm', nameKey: 'onboarding.units.m' },
  { id: 'in', label: 'in', nameKey: 'onboarding.units.in' },
  { id: 'ft', label: 'ft', nameKey: 'onboarding.units.ft' },
];

/** Chip id → API role, defaulting to `other` for "skip" and unanswered. */
export function roleOf(choice: RoleChoiceId | null): UserRole {
  return ROLE_CHOICES.find((r) => r.id === choice)?.role ?? 'other';
}

/** Translation key of the role label for the summary step. */
export function roleLabelKey(choice: RoleChoiceId | null): string {
  return ROLE_CHOICES.find((r) => r.id === choice)?.labelKey ?? 'onboarding.finish.notSpecified';
}

/** The unit choice behind a `Units` value, if it is one the wizard offers. */
export function unitChoice(units: Units): UnitChoice | undefined {
  return UNIT_CHOICES.find((u) => u.id === units);
}
