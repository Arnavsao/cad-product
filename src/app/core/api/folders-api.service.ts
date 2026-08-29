import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import { CreateFolderRequest, DeleteFolderResultDto, FolderDetailDto, FolderDto, UpdateFolderRequest } from './api.models';

/**
 * Promise-returning client for `/folders`. Errors are `ApiError`s; the codes
 * worth branching on are 409 `NAME_TAKEN`, 409 `FOLDER_NOT_EMPTY` (delete
 * without `force`) and 422 `FOLDER_CYCLE` (moving a folder into itself).
 */
@Injectable({ providedIn: 'root' })
export class FoldersApiService {
  private readonly api = inject(HttpManagerService);

  /** `GET /folders?parentId=` — children of a folder, or root folders when omitted. */
  list(parentId?: string | null): Promise<FolderDto[]> {
    return firstValueFrom(this.api.get<FolderDto[]>('folders', { params: { parentId: parentId ?? undefined } }));
  }

  /** `GET /folders/:id` — the folder plus its breadcrumb `path`. */
  get(id: string): Promise<FolderDetailDto> {
    return firstValueFrom(this.api.get<FolderDetailDto>(`folders/${encodeURIComponent(id)}`));
  }

  /** `POST /folders`. */
  create(req: CreateFolderRequest): Promise<FolderDto> {
    return firstValueFrom(this.api.post<FolderDto>('folders', req));
  }

  /** `PATCH /folders/:id` — rename and/or move. */
  update(id: string, req: UpdateFolderRequest): Promise<FolderDto> {
    return firstValueFrom(this.api.patch<FolderDto>(`folders/${encodeURIComponent(id)}`, req));
  }

  /** `DELETE /folders/:id` — `force` trashes the drawings it contains instead of failing with 409. */
  remove(id: string, force = false): Promise<DeleteFolderResultDto> {
    return firstValueFrom(
      this.api.delete<DeleteFolderResultDto>(`folders/${encodeURIComponent(id)}`, { params: { force: force ? true : undefined } }),
    );
  }
}
