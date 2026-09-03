import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

/**
 * Organizations — shared workspaces. Beyond the global `PrismaModule` it needs
 * `NotificationsModule` and `MailModule`, because an invitation or a role
 * change has to reach the person it is about — and an invitation in particular
 * has to reach an address with no account, which only email can do. It owns no
 * objects, so nothing here touches storage.
 *
 * `OrganizationsService` is exported because `FoldersModule`, `DrawingsModule`
 * and `UsersModule` all resolve a request's workspace through it
 * (`resolveWorkspace` / `requireMembership`). It deliberately imports none of
 * them back, which keeps the dependency graph acyclic: membership is a fact
 * about users and orgs alone, decided without reference to any drawing.
 */
@Module({
  imports: [NotificationsModule, MailModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
