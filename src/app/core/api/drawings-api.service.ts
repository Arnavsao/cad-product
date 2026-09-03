import { HttpClient, HttpEvent, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import {
  AcceptSharedLinkDto,
  CopyDrawingRequest,
  CreateDrawingRequest,
  CreateShareLinkRequest,
  DeletedDto,
  DrawingDto,
  DrawingSummaryDto,
  EmailedShareLinkDto,
  EmailShareLinkRequest,
  EmptyTrashDto,
  ImportDrawingRequest,
  ListDrawingsQuery,
  MoveDrawingRequest,
  Page,
  PresignDto,
  PresignUploadRequest,
  SaveResultDto,
  ShareDto,
  ShareLinkDto,
  SharedLinkDto,
  SharesDto,
  ThumbnailDto,
  TrashedDto,
  UpdateDrawingRequest,
  UpsertShareRequest,
  VersionDownloadDto,
  VersionDto,
} from './api.models';

/**
 * One promise-returning method per `/drawings` and `/uploads` endpoint.
 *
 * Promises rather than Observables because every caller is imperative
 * (a click handler, a save routine, a guard) and awaits exactly one value;
 * failures surface as `ApiError` with the HTTP status and backend code intact.
 * The single Observable API, `uploadToStorage`, exists because upload progress
 * is a stream. Storage traffic (presigned URLs) goes through the raw HttpClient
 * so no bearer token is attached and the envelope is not expected.
 */
@Injectable({ providedIn: 'root' })
export class DrawingsApiService {
  private readonly api = inject(HttpManagerService);
  private readonly http = inject(HttpClient);

  // ── listing ─────────────────────────────────────────────────────────────

  /**
   * `GET /drawings` — filtered by workspace / folder / search / sort.
   *
   * Pass `page` for a numbered page (the response then carries `total`), or
   * `cursor` to walk forward. Sending neither returns the first page.
   */
  list(q: ListDrawingsQuery = {}): Promise<Page<DrawingSummaryDto>> {
    return firstValueFrom(
      this.api.get<Page<DrawingSummaryDto>>('drawings', {
        params: {
          folderId: q.folderId,
          organizationId: q.organizationId ?? undefined,
          q: q.q,
          sort: q.sort,
          cursor: q.cursor,
          page: q.page,
          limit: q.limit,
          // Omitted rather than sent as 'workspace', so an older API that does
          // not know the parameter behaves exactly as it does today.
          scope: q.scope === 'shared' ? 'shared' : undefined,
        },
      }),
    );
  }

  /** `GET /drawings/recent` — most recently opened first. */
  recent(limit?: number, organizationId?: string | null): Promise<DrawingSummaryDto[]> {
    return firstValueFrom(
      this.api.get<DrawingSummaryDto[]>('drawings/recent', {
        params: { limit, organizationId: organizationId ?? undefined },
      }),
    );
  }

  /** `GET /drawings/trash` — same two paging modes as `list`. */
  trash(
    opts: { cursor?: string; page?: number; limit?: number; organizationId?: string | null } = {},
  ): Promise<Page<DrawingSummaryDto>> {
    return firstValueFrom(
      this.api.get<Page<DrawingSummaryDto>>('drawings/trash', {
        params: {
          cursor: opts.cursor,
          page: opts.page,
          limit: opts.limit,
          organizationId: opts.organizationId ?? undefined,
        },
      }),
    );
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** `POST /drawings` — 201 with a presigned download URL. */
  create(req: CreateDrawingRequest): Promise<DrawingDto> {
    return firstValueFrom(this.api.post<DrawingDto>('drawings', req));
  }

  /**
   * `GET /drawings/:id`. Opening a drawing bumps `lastOpenedAt` unless
   * `touch:false` (use it for prefetches). `download:true` asks for an
   * attachment disposition on the presigned URL.
   */
  get(id: string, opts: { touch?: boolean; download?: boolean } = {}): Promise<DrawingDto> {
    return firstValueFrom(
      this.api.get<DrawingDto>(`drawings/${enc(id)}`, {
        params: { touch: opts.touch === false ? 0 : undefined, download: opts.download ? 1 : undefined },
      }),
    );
  }

  /** Download the DXF text behind `DrawingDto.downloadUrl` (no bearer token — different host). */
  fetchContent(downloadUrl: string): Promise<string> {
    return firstValueFrom(this.api.getText(downloadUrl));
  }

  /**
   * `PUT /drawings/:id/content` — inline save (≤ 5 MB). Pass the version you
   * loaded as `ifMatchVersion` to get a 409 `VERSION_CONFLICT` instead of
   * clobbering a newer save; pass `null` to force-overwrite.
   */
  putContent(id: string, dxf: string, ifMatchVersion: number | null): Promise<SaveResultDto> {
    return firstValueFrom(
      this.api.putRaw<SaveResultDto>(`drawings/${enc(id)}/content`, dxf, 'text/plain; charset=utf-8', ifMatch(ifMatchVersion)),
    );
  }

  /** `POST /drawings/:id/content/presign` — staging URL for a large save. */
  presignContent(id: string, byteSize: number): Promise<PresignDto> {
    return firstValueFrom(this.api.post<PresignDto>(`drawings/${enc(id)}/content/presign`, { byteSize }));
  }

  /** `POST /drawings/:id/content/complete` — commit a staged upload as the next version. */
  completeContent(id: string, key: string, byteSize: number, ifMatchVersion: number | null): Promise<SaveResultDto> {
    return firstValueFrom(
      this.api.post<SaveResultDto>(`drawings/${enc(id)}/content/complete`, { key, byteSize }, { headers: ifMatch(ifMatchVersion) }),
    );
  }

  /** `PATCH /drawings/:id` — rename and/or move *within* the workspace. */
  patch(id: string, req: UpdateDrawingRequest): Promise<DrawingSummaryDto> {
    return firstValueFrom(this.api.patch<DrawingSummaryDto>(`drawings/${enc(id)}`, req));
  }

  /**
   * `POST /drawings/:id/move` — move including across workspaces.
   *
   * Separate from `patch` because it is a different permission (`manage` on the
   * source once the workspace changes) and a different failure surface: 409
   * `NAME_TAKEN` at the destination, 403 `FORBIDDEN` when the caller is only a
   * viewer there. The storage key is unchanged by a move — the row is re-tagged.
   */
  move(id: string, req: MoveDrawingRequest): Promise<DrawingSummaryDto> {
    return firstValueFrom(this.api.post<DrawingSummaryDto>(`drawings/${enc(id)}/move`, req));
  }

  /** `POST /drawings/:id/copy` — 201 with the copy; the caller becomes its owner. */
  copy(id: string, req: CopyDrawingRequest): Promise<DrawingSummaryDto> {
    return firstValueFrom(this.api.post<DrawingSummaryDto>(`drawings/${enc(id)}/copy`, req));
  }

  /** `POST /drawings/:id/duplicate`. */
  duplicate(id: string, name?: string): Promise<DrawingSummaryDto> {
    return firstValueFrom(this.api.post<DrawingSummaryDto>(`drawings/${enc(id)}/duplicate`, name ? { name } : {}));
  }

  /** `DELETE /drawings/:id` — soft delete (trash). */
  trashDrawing(id: string): Promise<TrashedDto> {
    return firstValueFrom(this.api.delete<TrashedDto>(`drawings/${enc(id)}`));
  }

  /** `POST /drawings/:id/restore`. */
  restore(id: string): Promise<DrawingSummaryDto> {
    return firstValueFrom(this.api.post<DrawingSummaryDto>(`drawings/${enc(id)}/restore`, {}));
  }

  /** `DELETE /drawings/:id/permanent` — irreversible. */
  deletePermanently(id: string): Promise<DeletedDto> {
    return firstValueFrom(this.api.delete<DeletedDto>(`drawings/${enc(id)}/permanent`));
  }

  /**
   * `DELETE /drawings/trash` — permanently deletes every trashed row of one
   * workspace. In an organization this needs ADMIN and up (403 otherwise).
   */
  emptyTrash(organizationId?: string | null): Promise<EmptyTrashDto> {
    return firstValueFrom(
      this.api.delete<EmptyTrashDto>('drawings/trash', { params: { organizationId: organizationId ?? undefined } }),
    );
  }

  /** `PUT /drawings/:id/thumbnail` — PNG ≤ 512 KB. */
  putThumbnail(id: string, png: Blob): Promise<ThumbnailDto> {
    return firstValueFrom(this.api.putRaw<ThumbnailDto>(`drawings/${enc(id)}/thumbnail`, png, 'image/png'));
  }

  // ── upload / import ─────────────────────────────────────────────────────

  /** `POST /uploads/presign` — staging URL for a `.dxf`/`.dwg` file (≤ 50 MB). */
  presignUpload(req: PresignUploadRequest): Promise<PresignDto> {
    return firstValueFrom(this.api.post<PresignDto>('uploads/presign', req));
  }

  /**
   * Raw `PUT` of the file bytes to the presigned storage URL, emitting
   * `HttpEvent`s (`HttpEventType.UploadProgress` …) so a progress bar can
   * follow along. Absolute URL on another host → no Authorization header.
   */
  uploadToStorage(uploadUrl: string, file: File | Blob, contentType: string): Observable<HttpEvent<unknown>> {
    return this.http.put(uploadUrl, file, {
      headers: new HttpHeaders({ 'Content-Type': contentType }),
      reportProgress: true,
      observe: 'events',
      responseType: 'text',
    });
  }

  /** `POST /drawings/import` — turn a staged upload into a drawing. */
  importDrawing(req: ImportDrawingRequest): Promise<DrawingSummaryDto> {
    return firstValueFrom(this.api.post<DrawingSummaryDto>('drawings/import', req));
  }

  // ── version history ─────────────────────────────────────────────────────

  /** `GET /drawings/:id/versions` — newest first; pruned versions are absent. */
  versions(id: string): Promise<VersionDto[]> {
    return firstValueFrom(this.api.get<VersionDto[]>(`drawings/${enc(id)}/versions`));
  }

  /** `GET /drawings/:id/versions/:version` — a presigned URL for those bytes. */
  versionDownload(id: string, version: number): Promise<VersionDownloadDto> {
    return firstValueFrom(this.api.get<VersionDownloadDto>(`drawings/${enc(id)}/versions/${version}`));
  }

  /**
   * `POST /drawings/:id/versions/:version/restore` — append-only: restoring v3
   * of a drawing at v7 produces v8 carrying v3's bytes, so nothing is lost.
   */
  restoreVersion(id: string, version: number, ifMatchVersion: number | null = null): Promise<SaveResultDto> {
    return firstValueFrom(
      this.api.post<SaveResultDto>(`drawings/${enc(id)}/versions/${version}/restore`, {}, { headers: ifMatch(ifMatchVersion) }),
    );
  }

  // ── sharing ─────────────────────────────────────────────────────────────

  /** `GET /drawings/:id/shares` — people, organizations and links (`manage`). */
  shares(id: string): Promise<SharesDto> {
    return firstValueFrom(this.api.get<SharesDto>(`drawings/${enc(id)}/shares`));
  }

  /**
   * `PUT /drawings/:id/shares` — add or re-permission one target.
   *
   * Codes worth branching on: 422 `SHARE_SELF`, 422 `SHARE_SAME_ORG` (the
   * drawing already lives in that org), 422 `SHARE_TARGET_REQUIRED` and 404
   * `ORG_NOT_FOUND` (an org the caller does not belong to).
   */
  upsertShare(id: string, req: UpsertShareRequest): Promise<ShareDto> {
    return firstValueFrom(this.api.put<ShareDto>(`drawings/${enc(id)}/shares`, req));
  }

  /** `DELETE /drawings/:id/shares/:shareId`. */
  removeShare(id: string, shareId: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`drawings/${enc(id)}/shares/${enc(shareId)}`));
  }

  /** `POST /drawings/:id/links` — a fresh view/edit link. */
  createLink(id: string, req: CreateShareLinkRequest): Promise<ShareLinkDto> {
    return firstValueFrom(this.api.post<ShareLinkDto>(`drawings/${enc(id)}/links`, req));
  }

  /** `DELETE /drawings/:id/links/:linkId` — revokes it for everyone. */
  revokeLink(id: string, linkId: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`drawings/${enc(id)}/links/${enc(linkId)}`));
  }

  /**
   * `POST /drawings/:id/links/:linkId/email` — mail an existing link out.
   *
   * Needs `manage`, like the rest of the link routes. Codes worth branching
   * on: 404 `LINK_INVALID` (revoked or expired since the dialog loaded), 400
   * `VALIDATION_ERROR` (a malformed address, or more than ten of them) and 429
   * — the route is rate-limited to ten calls a minute so it cannot be used as
   * a relay.
   */
  emailLink(id: string, linkId: string, req: EmailShareLinkRequest): Promise<EmailedShareLinkDto> {
    return firstValueFrom(
      this.api.post<EmailedShareLinkDto>(`drawings/${enc(id)}/links/${enc(linkId)}/email`, req),
    );
  }

  /** `GET /shared/:token` — what the link points at. 404 `LINK_INVALID` when dead. */
  sharedLink(token: string): Promise<SharedLinkDto> {
    return firstValueFrom(this.api.get<SharedLinkDto>(`shared/${enc(token)}`));
  }

  /** `POST /shared/:token/accept` — turns the link into a durable share for the caller. */
  acceptSharedLink(token: string): Promise<AcceptSharedLinkDto> {
    return firstValueFrom(this.api.post<AcceptSharedLinkDto>(`shared/${enc(token)}/accept`, {}));
  }
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

function ifMatch(version: number | null): Record<string, string> | undefined {
  return version != null ? { 'If-Match': String(version) } : undefined;
}
