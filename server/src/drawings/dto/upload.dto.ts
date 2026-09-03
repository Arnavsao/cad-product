import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { MAX_NAME_LENGTH } from './drawing.dto';

/**
 * Extensions accepted by `POST /uploads/presign`. The presign is what caps the
 * upload (size and content type are part of the SigV4 signature), so this list
 * is the only gate between a browser and the bucket — keep it tight.
 */
export const ALLOWED_UPLOAD_EXTENSIONS = ['dxf', 'dwg'] as const;

/**
 * Content types a browser plausibly reports for a DXF/DWG file.
 *
 * `image/vnd.dxf` and `image/vnd.dwg` are the IANA-registered types and are
 * what the dashboard sends; the rest are what browsers and older tools report
 * in practice. This list must stay a superset of what the client uses — the
 * content type is part of the SigV4 signature, so a value the server rejects
 * fails at presign, and a value it accepts but the client then changes fails
 * later with an opaque `SignatureDoesNotMatch` from the bucket.
 */
export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  'application/octet-stream',
  'application/dxf',
  'application/dwg',
  'application/x-dwg',
  'application/x-autocad',
  'application/acad',
  'image/vnd.dxf',
  'image/vnd.dwg',
  'image/x-dxf',
  'image/x-dwg',
  'drawing/x-dwf',
  'text/plain',
  '',
] as const;

/** Body of `POST /uploads/presign`. */
export class PresignUploadDto {
  @IsString()
  @Length(1, 255)
  fileName: string;

  /** May be blank — some browsers report no type for `.dxf`. */
  @IsString()
  @Length(0, 128)
  contentType: string;

  @IsInt()
  @Min(1)
  byteSize: number;
}

/** Body of `POST /drawings/import`. */
export class ImportDrawingDto {
  /** Storage key produced by `POST /uploads/presign`. */
  @IsString()
  @Length(1, 1024)
  key: string;

  /** Display name; defaults to the uploaded file's stem. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  folderId?: string | null;

  /** Workspace to import into; ignored when `folderId` is given. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string | null;

  /**
   * Optional client-side size assertion. When present it must match what the
   * bucket actually holds, otherwise the upload was truncated or replaced
   * between presign and import (422 `SIZE_MISMATCH`).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  byteSize?: number;
}
