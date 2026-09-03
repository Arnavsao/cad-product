import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

/**
 * Feedback. Imports nothing: `PrismaModule` is `@Global()`, and this feature
 * needs no auth import — the guard has already resolved the caller.
 */
@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
