import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import {
  CreateFolderRequest,
  DeleteFolderResultDto,
  FolderDetailDto,
  FolderDto,
  ListScope,
  MoveFolderRequest,
  ShareDto,
  SharesDto,
  UpdateFolderRequest,
  UpsertShareRequest,
} from './api.models';

/**
 * Promise-returning client for `/folders`. Errors are `ApiError`s; the codes
 * worth branching on are 409 `NAME_TAKEN`, 409 `FOLDER_NOT_EMPTY` (delete
 * without `force`) and 422 `FOLDER_CYCLE` (moving a folder into itself).
 */
@Injectable({ providedIn: 'root' })
export class FoldersApiService {
  private readonly api = inject(HttpManagerService);

  /**
   * `GET /folders?parentId=` — children of a folder, or root folders when
   * omitted. `scope: 'shared'` instead lists the folders other people shared
   * with the caller, and then `parentId`/`organizationId` are irrelevant.
   */
  list(parentId?: string | null, organizationId?: string | null, scope?: ListScope): Promise<FolderDto[]> {
    return firstValueFrom(
      this.api.get<FolderDto[]>('folders', {
        params: {
          parentId: parentId ?? undefined,
          organizationId: organizationId ?? undefined,
          // Omitted rather than sent as 'workspace' — see DrawingsApiService.list.
          scope: scope === 'shared' ? 'shared' : undefined,
        },
      }),
    );
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

  /**
   * `POST /folders/:id/move` — move including across workspaces, re-tagging
   * every descendant folder and drawing in one transaction. 422 `FOLDER_CYCLE`
   * when the destination is inside the subtree, 409 `NAME_TAKEN` on a clash.
   */
  move(id: string, req: MoveFolderRequest): Promise<FolderDto> {
    return firstValueFrom(this.api.post<FolderDto>(`folders/${encodeURIComponent(id)}/move`, req));
  }

  /** `DELETE /folders/:id` — `force` trashes the drawings it contains instead of failing with 409. */
  remove(id: string, force = false): Promise<DeleteFolderResultDto> {
    return firstValueFrom(
      this.api.delete<DeleteFolderResultDto>(`folders/${encodeURIComponent(id)}`, { params: { force: force ? true : undefined } }),
    );
  }

  // ── sharing ─────────────────────────────────────────────────────────────
  //
  // A folder share covers its whole subtree, which is why there is no link
  // variant here: a link is a URL to *one* drawing, and there is no folder page
  // for a stranger to land on.

  /** `GET /folders/:id/shares` (`manage`). `links` always comes back empty. */
  shares(id: string): Promise<SharesDto> {
    return firstValueFrom(this.api.get<SharesDto>(`folders/${encodeURIComponent(id)}/shares`));
  }

  /** `PUT /folders/:id/shares` — same codes as the drawing route. */
  upsertShare(id: string, req: UpsertShareRequest): Promise<ShareDto> {
    return firstValueFrom(this.api.put<ShareDto>(`folders/${encodeURIComponent(id)}/shares`, req));
  }

  /** `DELETE /folders/:id/shares/:shareId`. */
  removeShare(id: string, shareId: string): Promise<{ id: string }> {
    return firstValueFrom(
      this.api.delete<{ id: string }>(`folders/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`),
    );
  }
}
