import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Actor } from '../common/access';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { ApiException } from '../common/errors/api-error';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import type { Page } from '../common/utils/pagination';
import {
  CompleteContentDto,
  CopyDrawingDto,
  CreateDrawingDto,
  DuplicateDrawingDto,
  MoveDrawingDto,
  PresignContentDto,
  UpdateDrawingDto,
} from './dto/create-drawing.dto';
import type {
  DeletedDrawingDto,
  DrawingDto,
  DrawingSummaryDto,
  EmptyTrashResultDto,
  PresignDto,
  SaveResultDto,
  ThumbnailResultDto,
  TrashedDrawingDto,
  VersionDownloadDto,
  VersionDto,
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
 * - `recent` and `trash` (both verbs) are declared BEFORE `:id` so Express does
 *   not match them as drawing ids.
 * - The DXF and PNG bodies arrive from the per-route parsers mounted in
 *   `app.setup.ts`; we read them off `req.body` rather than through `@Body()`
 *   because the global `ValidationPipe` would try to `plainToInstance` a
 *   `Buffer`.
 * - Saves answer with `ETag: "<version>"` so the client can send the value back
 *   as `If-Match` without tracking it separately.
 * - The caller arrives as an `Actor` (`{ userId, email }`) rather than a bare
 *   id: an email is half of every access decision, because a share names its
 *   recipient by address.
 */
@Controller('drawings')
export class DrawingsController {
  constructor(private readonly drawings: DrawingsService) {}

  /** `GET /drawings` → `Page<DrawingSummaryDto>`. `?scope=shared` for others' files. */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: ListDrawingsDto): Promise<Page<DrawingSummaryDto>> {
    return this.drawings.list(actor, query);
  }

  /** `GET /drawings/recent` → `DrawingSummaryDto[]` ordered by `lastOpenedAt`. */
  @Get('recent')
  recent(@CurrentActor() actor: Actor, @Query() query: RecentDrawingsDto): Promise<DrawingSummaryDto[]> {
    return this.drawings.recent(actor, query.limit, query.organizationId);
  }

  /** `GET /drawings/trash` → `Page<DrawingSummaryDto>` of soft-deleted rows. */
  @Get('trash')
  trash(@CurrentActor() actor: Actor, @Query() query: ListTrashDto): Promise<Page<DrawingSummaryDto>> {
    return this.drawings.trash(actor, query);
  }

  /**
   * `DELETE /drawings/trash?organizationId=` → `{ deleted }`. Declared before
   * `DELETE /drawings/:id`, or "trash" would be parsed as an id.
   */
  @Delete('trash')
  emptyTrash(@CurrentActor() actor: Actor, @Query() query: ListTrashDto): Promise<EmptyTrashResultDto> {
    return this.drawings.emptyTrash(actor, query.organizationId);
  }

  /** `POST /drawings` → `DrawingDto` (201). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateDrawingDto): Promise<DrawingDto> {
    return this.drawings.create(actor, dto);
  }

  /** `GET /drawings/:id` → `DrawingDto` with a presigned GET; touches `lastOpenedAt`. */
  @Get(':id')
  get(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Query() query: GetDrawingDto,
  ): Promise<DrawingDto> {
    return this.drawings.get(actor, id, {
      touch: isNotFalsyFlag(query.touch),
      download: isTruthyFlag(query.download),
    });
  }

  /** `PUT /drawings/:id/content` — inline DXF save. `If-Match` omitted = force. */
  @Put(':id/content')
  async saveContent(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Req() req: Request,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaveResultDto> {
    const body = req.body;
    if (typeof body !== 'string') {
      throw ApiException.unsupportedMediaType('UNSUPPORTED_MEDIA_TYPE', 'Send the DXF as text/plain');
    }
    const result = await this.drawings.saveContent(actor, id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', `"${result.version}"`);
    return result;
  }

  /** `POST /drawings/:id/content/presign` → `PresignDto` for a staging key. */
  @Post(':id/content/presign')
  @HttpCode(HttpStatus.OK)
  @Throttle(PRESIGN_THROTTLE)
  presignContent(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: PresignContentDto,
  ): Promise<PresignDto> {
    return this.drawings.presignContent(actor, id, dto);
  }

  /** `POST /drawings/:id/content/complete` — promotes a staged object to a version. */
  @Post(':id/content/complete')
  @HttpCode(HttpStatus.OK)
  async completeContent(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: CompleteContentDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaveResultDto> {
    const result = await this.drawings.completeContent(actor, id, dto, parseIfMatch(ifMatch));
    res.setHeader('ETag', `"${result.version}"`);
    return result;
  }

  /** `GET /drawings/:id/versions` → `VersionDto[]`, newest first. */
  @Get(':id/versions')
  listVersions(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<VersionDto[]> {
    return this.drawings.listVersions(actor, id);
  }

  /** `GET /drawings/:id/versions/:version` → `{ downloadUrl, expiresAt }`. */
  @Get(':id/versions/:version')
  versionDownload(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<VersionDownloadDto> {
    return this.drawings.versionDownload(actor, id, version);
  }

  /** `POST /drawings/:id/versions/:version/restore` → a NEW version with the old bytes. */
  @Post(':id/versions/:version/restore')
  @HttpCode(HttpStatus.OK)
  async restoreVersion(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaveResultDto> {
    const result = await this.drawings.restoreVersion(actor, id, version, parseIfMatch(ifMatch));
    res.setHeader('ETag', `"${result.version}"`);
    return result;
  }

  /** `PATCH /drawings/:id` → `DrawingSummaryDto` (rename / same-workspace move). */
  @Patch(':id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateDrawingDto,
  ): Promise<DrawingSummaryDto> {
    return this.drawings.update(actor, id, dto);
  }

  /** `POST /drawings/:id/move` → `DrawingSummaryDto`; the cross-workspace move. */
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: MoveDrawingDto,
  ): Promise<DrawingSummaryDto> {
    return this.drawings.move(actor, id, dto);
  }

  /** `POST /drawings/:id/copy` → `DrawingSummaryDto` (201), owned by the caller. */
  @Post(':id/copy')
  @HttpCode(HttpStatus.CREATED)
  copy(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: CopyDrawingDto,
  ): Promise<DrawingSummaryDto> {
    return this.drawings.copy(actor, id, dto);
  }

  /** `POST /drawings/:id/duplicate` → `DrawingSummaryDto` (201). */
  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  duplicate(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: DuplicateDrawingDto,
  ): Promise<DrawingSummaryDto> {
    return this.drawings.duplicate(actor, id, dto);
  }

  /** `DELETE /drawings/:id` → `{ id, deletedAt }` (trash). */
  @Delete(':id')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<TrashedDrawingDto> {
    return this.drawings.trashDrawing(actor, id);
  }

  /** `POST /drawings/:id/restore` → `DrawingSummaryDto`. */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<DrawingSummaryDto> {
    return this.drawings.restore(actor, id);
  }

  /** `DELETE /drawings/:id/permanent` → `{ id }`; removes the row and its objects. */
  @Delete(':id/permanent')
  permanent(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<DeletedDrawingDto> {
    return this.drawings.permanentDelete(actor, id);
  }

  /** `PUT /drawings/:id/thumbnail` → `{ thumbnailUrl }`; body is raw `image/png`. */
  @Put(':id/thumbnail')
  setThumbnail(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Req() req: Request,
  ): Promise<ThumbnailResultDto> {
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      throw ApiException.unsupportedMediaType('NOT_PNG', 'Send the thumbnail as image/png');
    }
    return this.drawings.setThumbnail(actor, id, body);
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
