import { Global, Module } from '@nestjs/common';
import { FlagsController } from './flags.controller';
import { FlagsService } from './flags.service';

/**
 * Feature flags.
 *
 * `@Global()` because flags are read from places that have no business
 * importing an admin module — `UsersService` gates provisioning on
 * `signups.enabled`, and drawings/uploads will gate on theirs. Making every
 * such feature import an admin-owned module would invert the dependency the
 * layering is trying to keep: features must not know the portal exists, they
 * only know there is a switch.
 *
 * The controller here is the PUBLIC `GET /flags`. The staff-facing write
 * endpoints live in `AdminModule`, behind its guard.
 */
@Global()
@Module({
  controllers: [FlagsController],
  providers: [FlagsService],
  exports: [FlagsService],
})
export class FlagsModule {}
