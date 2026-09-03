import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * The notification inbox. `NotificationsService` is exported because other
 * features publish into it (`UsersService` on onboarding, the import path when a
 * drawing finishes) — an inbox with no producer would stay empty forever.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
