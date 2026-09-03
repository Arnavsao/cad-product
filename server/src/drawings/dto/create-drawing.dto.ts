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

  /**
   * Workspace to create in; omit for personal. Ignored when `folderId` is
   * given — the folder's workspace wins, so a drawing can never sit in an org
   * folder while claiming to be personal.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string | null;

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

/**
 * Body of `POST /drawings/:id/move` — the explicit cross-workspace move.
 *
 * `PATCH /drawings/:id` still handles a move *within* one workspace (and still
 * answers 422 `CROSS_WORKSPACE_MOVE` when its `folderId` points elsewhere):
 * that request never named a workspace, so re-tagging the drawing and changing
 * who can see it is not what it asked for. This route names one.
 */
export class MoveDrawingDto {
  /** Target workspace: `null` (or omitted) for the caller's personal drawings. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string | null;

  /** Target folder inside that workspace; `null`/omitted for its root. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  folderId?: string | null;
}

/**
 * Body of `POST /drawings/:id/copy`. Same target fields as a move, plus an
 * optional name; the copy is auto-suffixed rather than refused when the name is
 * taken at the destination.
 */
export class CopyDrawingDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  folderId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  name?: string;
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
