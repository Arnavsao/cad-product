import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { FEEDBACK_KINDS, type FeedbackKindWire } from '../../feedback/dto/feedback.dto';

/** Wire values for `FeedbackStatus`, lowercase like every other enum on the wire. */
export const FEEDBACK_STATUSES = ['new', 'triaged', 'in_progress', 'resolved', 'wont_fix'] as const;
export type FeedbackStatusWire = (typeof FEEDBACK_STATUSES)[number];

/** Statuses that still want somebody's attention; drives the overview's "open" count. */
export const OPEN_STATUSES: readonly FeedbackStatusWire[] = ['new', 'triaged', 'in_progress'];

/** One submission as the triage list shows it. */
export interface AdminFeedbackRowDto {
  id: string;
  kind: FeedbackKindWire;
  status: FeedbackStatusWire;
  rating: number | null;
  /** Trimmed to a single line for the list; the detail view has the whole thing. */
  excerpt: string;
  /** Who sent it: the account, or the address they typed while signed out. */
  fromEmail: string | null;
  fromUserId: string | null;
  fromName: string | null;
  assigneeId: string | null;
  assigneeEmail: string | null;
  appVersion: string | null;
  repliedAt: string | null;
  createdAt: string;
}

/** Everything the detail view needs, including the diagnostics staff triage on. */
export interface AdminFeedbackDetailDto extends AdminFeedbackRowDto {
  message: string;
  internalNote: string | null;
  resolvedAt: string | null;
  context: { route?: string; appVersion?: string; userAgent?: string } | null;
  /** Whether we have any address to answer on. */
  replyable: boolean;
}

export class ListFeedbackQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @IsIn(FEEDBACK_STATUSES)
  status?: FeedbackStatusWire;

  @IsOptional()
  @IsIn(FEEDBACK_KINDS)
  kind?: FeedbackKindWire;

  /** Exact match on `context.appVersion`, for "everything broken in build X". */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  appVersion?: string;

  /** `me` resolves to the caller; anything else is a user id. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  assignee?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/**
 * Every field is optional: the three things staff change about a report —
 * status, who owns it, and the internal note — are changed independently, and a
 * PATCH that required all three would make "assign this to me" clobber the
 * status somebody else just set.
 */
export class UpdateFeedbackDto {
  @IsOptional()
  @IsIn(FEEDBACK_STATUSES)
  status?: FeedbackStatusWire;

  /** A user id, `me`, or `null` to unassign. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  assigneeId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  internalNote?: string;
}

export class ReplyFeedbackDto {
  @IsString()
  @Length(10, 4000)
  body!: string;
}
