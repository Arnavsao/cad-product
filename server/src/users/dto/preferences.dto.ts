import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** Wire values for `Units` (plan §1). Prisma enum is upper-case; mapped in `users.mapper.ts`. */
export const UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;
export type UnitsWire = (typeof UNITS)[number];

/** Wire values for `UserRole`. */
export const USER_ROLES = ['architect', 'engineer', 'student', 'other'] as const;
export type UserRoleWire = (typeof USER_ROLES)[number];

/** Bounds for `autosaveIntervalSec`. */
export const AUTOSAVE_MIN_SEC = 5;
export const AUTOSAVE_MAX_SEC = 600;

/** Max serialised size of `uiState` (defensive cap on a free-form JSON column). */
export const UI_STATE_MAX_BYTES = 64 * 1024;

/** `PreferencesDto` exactly as in plan §1. */
export interface PreferencesDto {
  units: UnitsWire;
  /** Theme-registry id (frontend `ThemeService`). */
  theme: string;
  role: UserRoleWire | null;
  defaultTemplate: string;
  autosaveIntervalSec: number;
  uiState: Record<string, unknown> | null;
}

/** Body of `PATCH /me/preferences` — every field optional; `role`/`uiState` accept `null` to clear. */
export class UpdatePreferencesDto {
  @IsOptional()
  @IsIn(UNITS)
  units?: UnitsWire;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  theme?: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRoleWire | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  defaultTemplate?: string;

  @IsOptional()
  @IsInt()
  @Min(AUTOSAVE_MIN_SEC)
  @Max(AUTOSAVE_MAX_SEC)
  autosaveIntervalSec?: number;

  @IsOptional()
  @IsObject()
  uiState?: Record<string, unknown> | null;
}
