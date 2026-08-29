import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
// A pure helper (no runtime coupling to DrawingsModule) — shared so `?force=true`
// here and `?download=1` there parse boolean query flags identically.
import { isTruthyFlag } from '../drawings/dto/list-drawings.dto';
import {
  CreateFolderDto,
  DeleteFolderDto,
  ListFoldersDto,
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

  /** `GET /folders?parentId=` → `FolderDto[]` (root level when `parentId` is absent). */
  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: ListFoldersDto): Promise<FolderDto[]> {
    return this.folders.list(userId, query.parentId);
  }

  /** `GET /folders/:id` → `FolderDto & { path }`; 404 when not owned. */
  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<FolderWithPathDto> {
    return this.folders.get(userId, id);
  }

  /** `POST /folders` → `FolderDto` (201); 409 `NAME_TAKEN`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateFolderDto): Promise<FolderDto> {
    return this.folders.create(userId, dto);
  }

  /** `PATCH /folders/:id` → `FolderDto`; 409 `NAME_TAKEN`, 422 `FOLDER_CYCLE`. */
  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateFolderDto,
  ): Promise<FolderDto> {
    return this.folders.update(userId, id, dto);
  }

  /** `DELETE /folders/:id?force=true` → `{ id, trashedDrawings }`; 409 `FOLDER_NOT_EMPTY`. */
  @Delete(':id')
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Query() query: DeleteFolderDto,
  ): Promise<DeleteFolderResultDto> {
    return this.folders.remove(userId, id, isTruthyFlag(query.force));
  }
}
