import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** One organization as the admin list shows it. */
export interface AdminOrgRowDto {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  memberCount: number;
  drawingCount: number;
  bytesUsed: number;
  ownerEmail: string | null;
  createdAt: string;
}

/** Everything the org detail page renders. */
export interface AdminOrgDetailDto extends AdminOrgRowDto {
  joinCode: string;
  members: { userId: string; email: string; name: string | null; role: string; joinedAt: string }[];
  invites: { id: string; email: string; role: string; expiresAt: string; createdAt: string }[];
  updatedAt: string;
}

export class ListOrgsQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

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

/** Renaming is the only field staff may change; the slug follows the name. */
export class RenameOrgDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

/**
 * `POST /admin/organizations/:id/transfer-ownership`.
 *
 * The support case this exists for: the only owner has left the company and
 * nobody inside the organization can promote anyone, because promoting to owner
 * is itself an owner-only action.
 */
export class TransferOwnershipDto {
  @IsString()
  @Length(1, 40)
  userId!: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}
