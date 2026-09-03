import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type { Actor } from '../common/access';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
// A pure helper (no runtime coupling to DrawingsModule) — shared so `?force=true`
// here and `?download=1` there parse boolean query flags identically.
import { isTruthyFlag } from '../drawings/dto/list-drawings.dto';
import {
  CreateFolderDto,
  DeleteFolderDto,
  ListFoldersDto,
  MoveFolderDto,
  UpdateFolderDto,
  type DeleteFolderResultDto,
  type FolderDto,
  type FolderWithPathDto,
} from './dto/folder.dto';
import { FoldersService } from './folders.service';

/** `/api/v1/folders` — plan §1 folder routes. */
@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  /**
   * `GET /folders?parentId=&organizationId=&scope=` → `FolderDto[]`
   * (root level when `parentId` is absent; `scope=shared` for what others
   * shared with the caller).
   */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: ListFoldersDto): Promise<FolderDto[]> {
    return this.folders.list(actor, query);
  }

  /** `GET /folders/:id` → `FolderDto & { path }`; 404 when not reachable. */
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<FolderWithPathDto> {
    return this.folders.get(actor, id);
  }

  /** `POST /folders` → `FolderDto` (201); 409 `NAME_TAKEN`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateFolderDto): Promise<FolderDto> {
    return this.folders.create(actor, dto);
  }

  /** `PATCH /folders/:id` → `FolderDto`; 409 `NAME_TAKEN`, 422 `FOLDER_CYCLE`. */
  @Patch(':id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateFolderDto,
  ): Promise<FolderDto> {
    return this.folders.update(actor, id, dto);
  }

  /**
   * `POST /folders/:id/move` → `FolderDto`; re-tags the whole subtree.
   * 409 `NAME_TAKEN`, 422 `FOLDER_CYCLE`, 403 `FORBIDDEN`.
   */
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: MoveFolderDto,
  ): Promise<FolderDto> {
    return this.folders.move(actor, id, dto);
  }

  /** `DELETE /folders/:id?force=true` → `{ id, trashedDrawings }`; 409 `FOLDER_NOT_EMPTY`. */
  @Delete(':id')
  remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Query() query: DeleteFolderDto,
  ): Promise<DeleteFolderResultDto> {
    return this.folders.remove(actor, id, isTruthyFlag(query.force));
  }
}
