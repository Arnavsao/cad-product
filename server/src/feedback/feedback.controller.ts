import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';
import { CreateFeedbackDto, type FeedbackDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

/**
 * Submitting is far cheaper than the default 300/min and is reachable without a
 * session, so it gets its own tighter budget.
 */
const SUBMIT_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** `/feedback` — bug reports, ideas and questions from users. */
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /**
   * `POST /feedback` → `FeedbackDto`. Reachable without a session — a user who
   * cannot sign in is exactly the user most likely to need this — but attributed
   * when a valid token is present, hence `@OptionalAuth()` rather than
   * `@Public()`: the latter returns before the guard reads the token, so every
   * submission (signed in or not) would have been recorded as anonymous.
   *
   * `@CurrentUser()` is unusable here for the same reason it is on public routes:
   * it throws when `req.user` is absent, which here is a legitimate outcome.
   */
  @OptionalAuth()
  @Throttle(SUBMIT_THROTTLE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: Request, @Body() dto: CreateFeedbackDto): Promise<FeedbackDto> {
    const user = (req as Request & { user?: AuthUser }).user;
    return this.feedback.create(user?.id ?? null, dto);
  }

  /** `GET /feedback/mine` → the caller's own submissions, newest first. */
  @Get('mine')
  listMine(@CurrentUser('id') userId: string): Promise<FeedbackDto[]> {
    return this.feedback.listMine(userId);
  }
}
