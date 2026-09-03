import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Actor } from '../common/access';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { DrawingsService } from './drawings.service';
import type { DrawingSummaryDto, PresignDto } from './dto/drawing.dto';
import { ImportDrawingDto, PresignUploadDto } from './dto/upload.dto';

/** Presign/import are cheap for us and expensive for the bucket: 30/min. */
const UPLOAD_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * Browser-direct file upload: `POST /uploads/presign` hands out a signed PUT,
 * the browser uploads to storage without touching this process, then
 * `POST /drawings/import` adopts the object as a drawing.
 *
 * Design: these two live together (rather than one per resource controller)
 * because they are two halves of one flow and share the same ownership rule —
 * the upload key is rooted at `users/{id}/uploads/`, so import can verify
 * ownership by string prefix with no database round-trip. Both paths are
 * absolute here, so route ordering against `DrawingsController` is irrelevant.
 */
@Controller()
export class UploadsController {
  constructor(private readonly drawings: DrawingsService) {}

  /** `POST /uploads/presign` → `PresignDto`; 415 for anything but .dxf/.dwg. */
  @Post('uploads/presign')
  @HttpCode(HttpStatus.OK)
  @Throttle(UPLOAD_THROTTLE)
  presign(@CurrentActor() actor: Actor, @Body() dto: PresignUploadDto): Promise<PresignDto> {
    return this.drawings.presignUpload(actor, dto);
  }

  /** `POST /drawings/import` → `DrawingSummaryDto` (201). */
  @Post('drawings/import')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(UPLOAD_THROTTLE)
  import(@CurrentActor() actor: Actor, @Body() dto: ImportDrawingDto): Promise<DrawingSummaryDto> {
    return this.drawings.importUpload(actor, dto);
  }
}
