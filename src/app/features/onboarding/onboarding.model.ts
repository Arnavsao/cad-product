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
  label: string;
  /** The API only knows four roles; "Hobbyist" is stored as `other`. */
  role: UserRole;
}

export const ROLE_CHOICES: readonly RoleChoice[] = [
  { id: 'architect', label: 'Architect', role: 'architect' },
  { id: 'engineer', label: 'Engineer', role: 'engineer' },
  { id: 'student', label: 'Student', role: 'student' },
  { id: 'hobbyist', label: 'Hobbyist', role: 'other' },
  { id: 'other', label: 'Other', role: 'other' },
];

export interface UnitChoice {
  id: Units;
  label: string;
  name: string;
}

export const UNIT_CHOICES: readonly UnitChoice[] = [
  { id: 'mm', label: 'mm', name: 'Millimetres' },
  { id: 'cm', label: 'cm', name: 'Centimetres' },
  { id: 'm', label: 'm', name: 'Metres' },
  { id: 'in', label: 'in', name: 'Inches' },
  { id: 'ft', label: 'ft', name: 'Feet' },
];

/** Chip id → API role, defaulting to `other` for "skip" and unanswered. */
export function roleOf(choice: RoleChoiceId | null): UserRole {
  return ROLE_CHOICES.find((r) => r.id === choice)?.role ?? 'other';
}

/** Human label for the summary step. */
export function roleLabel(choice: RoleChoiceId | null): string {
  return ROLE_CHOICES.find((r) => r.id === choice)?.label ?? 'Not specified';
}

/** Human label for the summary step. */
export function unitLabel(units: Units): string {
  const choice = UNIT_CHOICES.find((u) => u.id === units);
  return choice ? `${choice.name} (${choice.label})` : units;
}
