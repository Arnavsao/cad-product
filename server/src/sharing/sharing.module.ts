import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';

/**
 * Sharing — grants on drawings and folders, plus revocable links.
 *
 * Imports `NotificationsModule` and `MailModule` — a share is worth telling
 * its recipient about, in the app and in their inbox. It deliberately does NOT
 * import `DrawingsModule` or `FoldersModule`: access resolution lives in
 * `common/access.ts` as plain functions over `PrismaService`, so sharing can
 * authorize a drawing without depending on the service that owns drawings —
 * and `DrawingsModule` stays free to depend on nothing here, leaving the graph
 * acyclic.
 */
@Module({
  imports: [NotificationsModule, MailModule],
  controllers: [SharingController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
