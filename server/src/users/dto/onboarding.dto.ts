import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { UNITS, USER_ROLES, type UnitsWire, type UserRoleWire } from './preferences.dto';

/** Body of `POST /me/onboarding`. */
export class OnboardingDto {
  @IsIn(USER_ROLES)
  role: UserRoleWire;

  @IsIn(UNITS)
  units: UnitsWire;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  defaultTemplate?: string;
}
