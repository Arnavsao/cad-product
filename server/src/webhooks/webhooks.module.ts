import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { defaultWebhookVerifier, WEBHOOK_VERIFIER, WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/** Clerk webhook intake. */
@Module({
  imports: [UsersModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, { provide: WEBHOOK_VERIFIER, useValue: defaultWebhookVerifier }],
})
export class WebhooksModule {}
