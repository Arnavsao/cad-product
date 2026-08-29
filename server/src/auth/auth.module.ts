import { verifyToken } from '@clerk/backend';
import { Module } from '@nestjs/common';
import { CLERK_TOKEN_VERIFIER, type TokenVerifier } from './clerk-auth.guard';
import { ClerkClientProvider } from './clerk-client.provider';

/**
 * Clerk plumbing: the Backend API client and the token verifier function.
 * The guard itself is registered as `APP_GUARD` in `AppModule` (it needs
 * `UsersService`, which lives in a module that imports this one).
 */
@Module({
  providers: [ClerkClientProvider, { provide: CLERK_TOKEN_VERIFIER, useValue: verifyToken as TokenVerifier }],
  exports: [ClerkClientProvider, CLERK_TOKEN_VERIFIER],
})
export class AuthModule {}
