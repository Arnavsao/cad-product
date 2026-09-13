import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AdminGuard } from './admin.guard';
import { AuditController } from './audit/audit.controller';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditService } from './audit/audit.service';
import { AdminFeedbackController } from './feedback/admin-feedback.controller';
import { AdminFeedbackService } from './feedback/admin-feedback.service';
import { AdminFlagsController } from './flags/admin-flags.controller';
import { OverviewController } from './overview/overview.controller';
import { OverviewService } from './overview/overview.service';
import { SystemController } from './system/system.controller';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';

/**
 * The staff admin portal.
 *
 * `AdminGuard` is applied **per controller** via `@UseGuards` rather than being
 * registered globally, because a global guard would have to decide what to do
 * about every non-admin route in the application; scoping it here means a route
 * outside this module cannot accidentally fall under it, and a route inside it
 * that forgets `@AdminOnly()` fails closed with a 500 (see the guard).
 *
 * The audit interceptor is likewise module-scoped: it only looks for
 * `@Audited()` metadata, so registering it globally would be a no-op everywhere
 * else, but keeping it here makes the rule visible — actions in this module are
 * recorded, actions elsewhere are not.
 *
 * `FlagsModule` is not imported: it is `@Global()`, because features far from
 * here read flags too.
 */
@Module({
  imports: [NotificationsModule, StorageModule, MailModule],
  controllers: [
    OverviewController,
    AdminUsersController,
    AdminFlagsController,
    AdminFeedbackController,
    AuditController,
    SystemController,
  ],
  providers: [
    AdminUsersService,
    AdminFeedbackService,
    OverviewService,
    AuditService,
    AuditInterceptor,
    AdminGuard,
  ],
})
export class AdminModule {}
