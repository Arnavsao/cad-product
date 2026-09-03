import type { BillingStateDto } from '../../billing/dto/billing.dto';
import type { OrgSummaryDto } from '../../organizations/dto/organization.dto';
import type { PreferencesDto } from './preferences.dto';

/** `MeDto.user` (plan §1). */
export interface UserDto {
  id: string;
  authId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  createdAt: string;
}

/** Storage usage summary over non-deleted drawings. */
export interface UsageDto {
  bytesUsed: number;
  drawingCount: number;
}

/** Response of `GET /me` and `POST /me/onboarding`. */
export interface MeDto {
  user: UserDto;
  preferences: PreferencesDto;
  onboarded: boolean;
  usage: UsageDto;
  /**
   * Organizations the user belongs to. Included here so the dashboard's
   * workspace switcher renders on first paint instead of after a second
   * request — the shell needs it before it can load any list.
   */
  organizations: OrgSummaryDto[];
  /**
   * Current plan and subscription period.
   *
   * Included in `/me` rather than left to a second request because the shell
   * reads it on first paint (plan badge, upgrade prompt), and a separate
   * round-trip would make those flicker in on every navigation. Always present:
   * an account that has never bought anything reports the Free state.
   */
  billing: BillingStateDto;
}
