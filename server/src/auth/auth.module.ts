import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_TOKEN_VERIFIER, supabaseVerifierFactory } from './supabase-auth.guard';

/**
 * Auth. Provides only the token verifier — there is no provider SDK client
 * anymore: Supabase access tokens carry `email` and `user_metadata`, so the
 * local user row is provisioned from the token alone.
 *
 * The guard itself is registered in `AppModule` because it depends on
 * `UsersService`, so the dependency points that way and never back.
 */
@Module({
  providers: [
    {
      provide: AUTH_TOKEN_VERIFIER,
      useFactory: supabaseVerifierFactory,
      inject: [ConfigService],
    },
  ],
  exports: [AUTH_TOKEN_VERIFIER],
})
export class AuthModule {}
