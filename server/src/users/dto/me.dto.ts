import type { PreferencesDto } from './preferences.dto';

/** `MeDto.user` (plan §1). */
export interface UserDto {
  id: string;
  clerkId: string;
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
}
