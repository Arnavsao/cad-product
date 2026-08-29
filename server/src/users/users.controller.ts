import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { MeDto } from './dto/me.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdatePreferencesDto, type PreferencesDto } from './dto/preferences.dto';
import { UsersService } from './users.service';

/**
 * `/me` — the signed-in user's profile, preferences and usage. The guard has
 * already lazily created the local user by the time these handlers run.
 */
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** `GET /me` → `MeDto`. */
  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.getMe(user.id);
  }

  /** `PATCH /me/preferences` → `PreferencesDto`. */
  @Patch('preferences')
  updatePreferences(@CurrentUser('id') userId: string, @Body() dto: UpdatePreferencesDto): Promise<PreferencesDto> {
    return this.users.updatePreferences(userId, dto);
  }

  /** `POST /me/onboarding` → `MeDto`; sets `onboardedAt` once (idempotent). */
  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  completeOnboarding(@CurrentUser('id') userId: string, @Body() dto: OnboardingDto): Promise<MeDto> {
    return this.users.completeOnboarding(userId, dto);
  }
}
