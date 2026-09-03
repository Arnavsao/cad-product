import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** Wire values for `Units` (plan §1). Prisma enum is upper-case; mapped in `users.mapper.ts`. */
export const UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;
export type UnitsWire = (typeof UNITS)[number];

/**
 * Shipped UI languages (BCP 47). Must stay in step with the frontend's
 * `src/app/core/i18n/locales.ts` — that file is the source of truth for what
 * the picker offers; this list is the server-side guard so a hand-rolled PATCH
 * cannot store a language the app cannot load.
 */
export const LOCALES = [
  'en',
  'cs',
  'de',
  'es',
  'fr',
  'hu',
  'it',
  'ja',
  'ko',
  'pl',
  'pt-BR',
  'ru',
  'zh-Hans',
  'zh-Hant',
] as const;
export type LocaleWire = (typeof LOCALES)[number];

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
  /** BCP 47 UI language tag (frontend `LanguageService`). */
  locale: LocaleWire;
  role: UserRoleWire | null;
  defaultTemplate: string;
  autosaveIntervalSec: number;
  uiState: Record<string, unknown> | null;
  /** Email me when a drawing or folder is shared with me. */
  emailOnShare: boolean;
  /** Email me when my role or access in an organization changes. */
  emailOnOrgActivity: boolean;
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
  @IsIn(LOCALES)
  locale?: LocaleWire;

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

  /**
   * Email opt-outs. Organization *invitations* are not covered by either and
   * are always delivered — see `MailService` for why.
   *
   * Note that `@IsBoolean` does not actually reject a non-boolean here: the
   * app-wide pipe runs with `enableImplicitConversion`, and class-transformer
   * converts by JS truthiness, so the string `'false'` arrives as `true`.
   * Clients must send a real boolean (the settings page sends `input.checked`).
   */
  @IsOptional()
  @IsBoolean()
  emailOnShare?: boolean;

  @IsOptional()
  @IsBoolean()
  emailOnOrgActivity?: boolean;
}
