import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { MAX_NAME_LENGTH } from './drawing.dto';

/**
 * Body of `POST /drawings`.
 *
 * `initialDxf` is optional: without it the server writes the blank template
 * from `templates/blank-dxf.ts` seeded with the user's `$INSUNITS` preference,
 * so "New drawing" needs no client-side round-trip. The 5 MB cap is enforced by
 * the service (`MAX_INLINE_CONTENT_BYTES`) as well as by the 6 MB JSON body
 * parser mounted for this route in `app.setup.ts`.
 */
export class CreateDrawingDto {
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  name: string;

  /** Target folder cuid; `null`/omitted creates at the root. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  folderId?: string | null;

  /** Full DXF text. Sniffed with `looksLikeDxf` before it is stored. */
  @IsOptional()
  @IsString()
  initialDxf?: string;
}

/** Body of `PATCH /drawings/:id`. Both fields optional; `folderId: null` moves to root. */
export class UpdateDrawingDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  folderId?: string | null;
}

/** Body of `POST /drawings/:id/duplicate`. */
export class DuplicateDrawingDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  name?: string;
}

/** Body of `POST /drawings/:id/content/presign`. */
export class PresignContentDto {
  @IsInt()
  @Min(1)
  byteSize: number;
}

/** Body of `POST /drawings/:id/content/complete`. */
export class CompleteContentDto {
  /** Staging key returned by `…/content/presign`; must belong to this drawing. */
  @IsString()
  @Length(1, 1024)
  key: string;

  @IsInt()
  @Min(1)
  byteSize: number;
}
