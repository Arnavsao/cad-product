import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** One drawing as the admin list shows it. Metadata only — never content. */
export interface AdminDrawingRowDto {
  id: string;
  name: string;
  format: string;
  byteSize: number;
  currentVersion: number;
  ownerId: string;
  ownerEmail: string;
  organizationId: string | null;
  organizationName: string | null;
  deletedAt: string | null;
  lastOpenedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export class ListDrawingsQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  ownerId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  organizationId?: string;

  /** `true` for the trash, `false` for live rows, omitted for both. */
  @IsOptional()
  @IsBooleanString()
  deleted?: string;

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

export class PurgeDrawingDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** What `GET /admin/storage/orphans` found. */
export interface StorageOrphansDto {
  /** Objects in the bucket with no row pointing at them. */
  orphanedObjects: { key: string; bytes: number }[];
  /** Rows whose payload object is missing — a broken drawing, not sweepable garbage. */
  brokenDrawings: { id: string; name: string; ownerEmail: string; storageKey: string }[];
  /** True when the scan hit its cap and there may be more. */
  truncated: boolean;
  scannedObjects: number;
  reclaimableBytes: number;
}
