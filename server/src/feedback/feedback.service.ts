import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api-error';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CONTEXT_MAX_BYTES, type CreateFeedbackDto, type FeedbackDto } from './dto/feedback.dto';
import { feedbackKindFromWire, toFeedbackDto } from './feedback.mapper';

/** How many past submissions `GET /feedback/mine` returns. Plenty for a history list. */
const MINE_LIMIT = 50;

/**
 * User feedback. Submission is public so a signed-out visitor can still report a
 * bug; `userId` is attached only when the request carried a valid session.
 *
 * There is no update or delete: feedback is an append-only record. Editing your
 * own past report would make the log untrustworthy for whoever triages it.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one submission. `userId` is null for anonymous senders — the guard
   * never ran for them, so there is nothing to attach.
   */
  async create(userId: string | null, dto: CreateFeedbackDto): Promise<FeedbackDto> {
    // `@MinLength` already rejects a short message, but not one that is only
    // whitespace — trim first so " " cannot become a stored empty report.
    const message = dto.message.trim();
    if (!message) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'message must not be blank');
    }

    const row = await this.prisma.feedback.create({
      data: {
        userId,
        kind: feedbackKindFromWire(dto.kind),
        rating: dto.rating ?? null,
        message,
        email: dto.email?.trim() || null,
        context: this.contextFor(dto.context),
      },
    });
    return toFeedbackDto(row);
  }

  /** The caller's own submissions, newest first. */
  async listMine(userId: string): Promise<FeedbackDto[]> {
    const rows = await this.prisma.feedback.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MINE_LIMIT,
    });
    return rows.map(toFeedbackDto);
  }

  /**
   * Client diagnostics, size-capped. Oversized context is dropped rather than
   * failing the whole submission: losing the user's actual report because their
   * user-agent string was long would be the wrong trade.
   */
  private contextFor(context: CreateFeedbackDto['context']): Prisma.InputJsonObject | typeof Prisma.DbNull {
    if (!context) {
      return Prisma.DbNull;
    }
    const serialised = JSON.stringify(context);
    if (Buffer.byteLength(serialised, 'utf8') > CONTEXT_MAX_BYTES) {
      return Prisma.DbNull;
    }
    return context as Prisma.InputJsonObject;
  }
}
