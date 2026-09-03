import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users + `/me`. Needs no auth import: the guard (in `AppModule`) depends on
 * `UsersService`, so the dependency points that way and never back, and the
 * profile is mirrored from token claims rather than a provider SDK.
 *
 * `NotificationsModule` is imported so completing onboarding can publish a
 * welcome notification, and `OrganizationsModule` so `/me` can carry the
 * workspace list the dashboard switcher needs on first paint. Neither imports
 * this module back, so there is no cycle.
 */
@Module({
  imports: [NotificationsModule, OrganizationsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
