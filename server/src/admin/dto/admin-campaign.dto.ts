import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

export const CAMPAIGN_STATUSES = ['draft', 'sending', 'sent', 'failed'] as const;
export type CampaignStatusWire = (typeof CAMPAIGN_STATUSES)[number];

export interface AdminCampaignDto {
  id: string;
  subject: string;
  bodyText: string;
  audience: { plans?: string[]; onlyActive?: boolean } | null;
  status: CampaignStatusWire;
  total: number;
  sent: number;
  failed: number;
  createdByEmail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** What a recipient count looks like before anything is sent. */
export interface AudiencePreviewDto {
  recipients: number;
  suppressed: number;
  sample: string[];
}

export class CreateCampaignDto {
  @IsString()
  @Length(3, 200)
  subject!: string;

  @IsString()
  @Length(20, 10_000)
  bodyText!: string;

  /** Empty or omitted means every account. */
  @IsOptional()
  @IsArray()
  @IsIn(['free', 'pro', 'team'], { each: true })
  plans?: string[];

  /** Restrict to accounts seen in the last 30 days. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyActive?: boolean;
}

export class TestSendDto {
  @IsEmail()
  @Length(3, 254)
  to!: string;
}

/** `POST /unsubscribe` — public, so the only field is the token. */
export class UnsubscribeDto {
  @IsString()
  @Length(10, 500)
  token!: string;
}
