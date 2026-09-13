import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import type { FlagKey } from '../flag-registry';

/** One flag as the public `GET /flags` and the portal both report it. */
export interface FlagDto {
  key: FlagKey;
  enabled: boolean;
  payload: Record<string, unknown> | null;
}

/** A flag plus the staff-facing metadata only the portal needs. */
export interface AdminFlagDto extends FlagDto {
  description: string;
  group: string;
  /** False when the effective value is the registry default (no row). */
  overridden: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export class UpdateFlagDto {
  @IsBoolean()
  enabled!: boolean;

  /**
   * Structured value for flags that carry one. Omitted leaves the stored
   * payload alone; `null` clears it back to the registry default.
   */
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown> | null;
}
