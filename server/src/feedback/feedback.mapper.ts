import type { Feedback } from '../generated/prisma/client';
import { FeedbackKind } from '../generated/prisma/client';
import { FEEDBACK_KINDS, type FeedbackDto, type FeedbackKindWire } from './dto/feedback.dto';

// Prisma enum members are upper-case (`FeedbackKind.BUG`), the API speaks
// lower-case (`'bug'`). Same split as `users.mapper.ts`.

export function feedbackKindToWire(kind: FeedbackKind): FeedbackKindWire {
  return kind.toLowerCase() as FeedbackKindWire;
}

export function feedbackKindFromWire(kind: FeedbackKindWire | undefined): FeedbackKind {
  if (kind === undefined) {
    return FeedbackKind.OTHER;
  }
  if (!FEEDBACK_KINDS.includes(kind)) {
    throw new RangeError(`Unknown feedback kind '${kind}'`);
  }
  return kind.toUpperCase() as FeedbackKind;
}

/**
 * `context` is deliberately NOT returned: it is diagnostics for whoever triages
 * the report, not something the sender needs echoed back.
 */
export function toFeedbackDto(row: Feedback): FeedbackDto {
  return {
    id: row.id,
    kind: feedbackKindToWire(row.kind),
    rating: row.rating,
    message: row.message,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}
