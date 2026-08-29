import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiException } from '../common/errors/api-error';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import type { Page } from '../common/utils/pagination';
import { CompleteContentDto, CreateDrawingDto, DuplicateDrawingDto, PresignContentDto, UpdateDrawingDto } from './dto/create-drawing.dto';
import type {
  DeletedDrawingDto,
  DrawingDto,
  DrawingSummaryDto,
  PresignDto,
  SaveResultDto,
  ThumbnailResultDto,
  TrashedDrawingDto,
} from './dto/drawing.dto';
import {
  GetDrawingDto,
  ListDrawingsDto,
  ListTrashDto,
  RecentDrawingsDto,
  isNotFalsyFlag,
  isTruthyFlag,
} from './dto/list-drawings.dto';
import { DrawingsService } from './drawings.service';

/** Rate limit for the presign endpoints (plan §2.6): 30 requests / minute. */
const PRESIGN_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * `/api/v1/drawings` — plan §1 drawing routes.
 *
 * Design notes:
 * - `recent` and `trash` are declared BEFORE `:id` so Express does not match
 *   them as drawing ids.
 * - The DXF and PNG bodies arrive from the per-route parsers mounted in
 *   `app.setup.ts`; we read them off `req.body` rather than through `@Body()`
 *   because the global `ValidationPipe` would try to `plainToInstance` a
 *   `Buffer`.
 * - Saves answer with `ETag: "<version>"` so the client can send the value back
 *   as `If-Match` without tracking it separately.
 */
@Controller('drawings')
export class DrawingsController {
  constructor(private readonly drawings: DrawingsService) {}

  /** `GET /drawings` → `Page<DrawingSummaryDto>`. */
  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: ListDrawingsDto): Promise<Page<DrawingSummaryDto>> {
    return this.drawings.list(userId, query);
  }

  /** `GET /drawings/recent` → `DrawingSummaryDto[]` ordered by `lastOpenedAt`. */
  @Get('recent')
  recent(@CurrentUser('id') userId: string, @Query() query: RecentDrawingsDto): Promise<DrawingSummaryDto[]> {
    return this.drawings.recent(userId, query.limit);
  }

  /** `GET /drawings/trash` → `Page<DrawingSummaryDto>` of soft-deleted rows. */
  @Get('trash')
  trash(@CurrentUser('id') userId: string, @Query() query: ListTrashDto): Promise<Page<DrawingSummaryDto>> {
    return this.drawings.trash(userId, query);
  }

  /** `POST /drawings` → `DrawingDto` (201). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateDrawingDto): Promise<DrawingDto> {
    return this.drawings.create(userId, dto);
  }

  /** `GET /drawings/:id` → `DrawingDto` with a presigned GET; touches `lastOpenedAt`. */
  @Get(':id')
  get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Query() query: GetDrawingDto,
  ): Promise<DrawingDto> {
    return this.drawings.get(userId, id, {
      touch: isNotFalsyFlag(query.touch),
      download: isTruthyFlag(query.download),
    });
  }

  /** `PUT /drawings/:id/content` — inline DXF save. `If-Match` omitted = force. */
  @Put(':id/content')
  async saveContent(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Req() req: Request,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaveResultDto> {
    const body = req.body;
    if (typeof body !== 'string') {
      throw ApiException.unsupportedMediaType('UNSUPPORTED_MEDIA_TYPE', 'Send the DXF as text/plain');
    }
    const result = await this.drawings.saveContent(userId, id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', `"${result.version}"`);
    return result;
  }

  /** `POST /drawings/:id/content/presign` → `PresignDto` for a staging key. */
  @Post(':id/content/presign')
  @HttpCode(HttpStatus.OK)
  @Throttle(PRESIGN_THROTTLE)
  presignContent(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: PresignContentDto,
  ): Promise<PresignDto> {
    return this.drawings.presignContent(userId, id, dto);
  }

  /** `POST /drawings/:id/content/complete` — promotes a staged object to a version. */
  @Post(':id/content/complete')
  @HttpCode(HttpStatus.OK)
  async completeContent(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: CompleteContentDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaveResultDto> {
    const result = await this.drawings.completeContent(userId, id, dto, parseIfMatch(ifMatch));
    res.setHeader('ETag', `"${result.version}"`);
    return result;
  }

  /** `PATCH /drawings/:id` → `DrawingSummaryDto`. */
  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateDrawingDto,
  ): Promise<DrawingSummaryDto> {
    return this.drawings.update(userId, id, dto);
  }

  /** `POST /drawings/:id/duplicate` → `DrawingSummaryDto` (201). */
  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  duplicate(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: DuplicateDrawingDto,
  ): Promise<DrawingSummaryDto> {
    return this.drawings.duplicate(userId, id, dto);
  }

  /** `DELETE /drawings/:id` → `{ id, deletedAt }` (trash). */
  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<TrashedDrawingDto> {
    return this.drawings.trashDrawing(userId, id);
  }

  /** `POST /drawings/:id/restore` → `DrawingSummaryDto`. */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<DrawingSummaryDto> {
    return this.drawings.restore(userId, id);
  }

  /** `DELETE /drawings/:id/permanent` → `{ id }`; removes the row and its objects. */
  @Delete(':id/permanent')
  permanent(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<DeletedDrawingDto> {
    return this.drawings.permanentDelete(userId, id);
  }

  /** `PUT /drawings/:id/thumbnail` → `{ thumbnailUrl }`; body is raw `image/png`. */
  @Put(':id/thumbnail')
  setThumbnail(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Req() req: Request,
  ): Promise<ThumbnailResultDto> {
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      throw ApiException.unsupportedMediaType('NOT_PNG', 'Send the thumbnail as image/png');
    }
    return this.drawings.setThumbnail(userId, id, body);
  }
}

/**
 * Parses `If-Match`. Absent (or `*`) means "force" — the client deliberately
 * chose to overwrite. A malformed value is a client bug, not a force: answering
 * 400 is safer than silently discarding someone else's work.
 */
export function parseIfMatch(header: string | undefined): number | null {
  if (header === undefined) {
    return null;
  }
  const raw = header.trim().replace(/^W\//i, '').replace(/^"(.*)"$/, '$1').trim();
  if (raw === '' || raw === '*') {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_IF_MATCH', 'If-Match must be a version number');
  }
  return Number(raw);
}
