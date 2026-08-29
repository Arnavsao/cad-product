import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

/**
 * Holds the (optional) Clerk Backend API client.
 *
 * Design: `CLERK_SECRET_KEY` is optional so the API can run in dev/e2e with
 * only a JWT public key and self-minted tokens. Consumers check `enabled`
 * (or `client === null`) and fall back to token claims. Wrapping the SDK in an
 * injectable also makes it trivial to stub `users.getUser` in tests.
 */
@Injectable()
export class ClerkClientProvider {
  private readonly logger = new Logger(ClerkClientProvider.name);
  readonly client: ClerkClient | null;

  constructor(config: ConfigService<Env, true>) {
    const secretKey = config.get('CLERK_SECRET_KEY', { infer: true });
    if (secretKey) {
      this.client = createClerkClient({ secretKey, jwtKey: config.get('CLERK_JWT_KEY', { infer: true }) });
    } else {
      this.client = null;
      this.logger.warn('CLERK_SECRET_KEY not set — Clerk Backend API disabled; users are provisioned from JWT claims');
    }
  }

  /** True when Backend API calls (e.g. `users.getUser`) are possible. */
  get enabled(): boolean {
    return this.client !== null;
  }
}
