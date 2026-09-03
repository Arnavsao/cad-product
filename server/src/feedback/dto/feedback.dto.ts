import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Wire values for `FeedbackKind`. Kept as an `as const` array (rather than the
 * Prisma enum) so `@IsIn` validates the lowercase wire form and the mapper owns
 * the UPPER↔lower translation — same split as `preferences.dto.ts`.
 */
export const FEEDBACK_KINDS = ['bug', 'idea', 'question', 'other'] as const;
export type FeedbackKindWire = (typeof FEEDBACK_KINDS)[number];

/** Long enough for a real bug report, short enough that the 1 MB body cap is never the thing that rejects it. */
export const MESSAGE_MIN_LENGTH = 4;
export const MESSAGE_MAX_LENGTH = 4000;
export const EMAIL_MAX_LENGTH = 254;
/** `context` is free-form client diagnostics; cap it so it cannot become a data channel. */
export const CONTEXT_MAX_BYTES = 4 * 1024;

/** Diagnostics the client attaches so a report can be reproduced. */
export interface FeedbackContextDto {
  route?: string;
  appVersion?: string;
  userAgent?: string;
}

/** One submission, as returned by `GET /feedback/mine`. */
export interface FeedbackDto {
  id: string;
  kind: FeedbackKindWire;
  rating: number | null;
  message: string;
  email: string | null;
  createdAt: string;
}

/** `POST /feedback` — public, so every field that identifies the sender is optional. */
export class CreateFeedbackDto {
  @IsOptional()
  @IsIn(FEEDBACK_KINDS)
  kind?: FeedbackKindWire;

  /** 1–5 stars. Optional: most reports are not a rating. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsString()
  @MinLength(MESSAGE_MIN_LENGTH)
  @MaxLength(MESSAGE_MAX_LENGTH)
  message!: string;

  /** Only meaningful for signed-out submissions; signed-in senders are already identified. */
  @IsOptional()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  @IsOptional()
  @IsObject()
  context?: FeedbackContextDto;
}
