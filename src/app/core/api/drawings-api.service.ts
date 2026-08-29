import { HttpClient, HttpEvent, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import {
  CreateDrawingRequest,
  DeletedDto,
  DrawingDto,
  DrawingSummaryDto,
  ImportDrawingRequest,
  ListDrawingsQuery,
  Page,
  PresignDto,
  PresignUploadRequest,
  SaveResultDto,
  ThumbnailDto,
  TrashedDto,
  UpdateDrawingRequest,
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

  /** `GET /drawings` — paginated, filtered by folder / search / sort. */
  list(q: ListDrawingsQuery = {}): Promise<Page<DrawingSummaryDto>> {
    return firstValueFrom(
      this.api.get<Page<DrawingSummaryDto>>('drawings', {
        params: { folderId: q.folderId, q: q.q, sort: q.sort, cursor: q.cursor, limit: q.limit },
      }),
    );
  }

  /** `GET /drawings/recent` — most recently opened first. */
  recent(limit?: number): Promise<DrawingSummaryDto[]> {
    return firstValueFrom(this.api.get<DrawingSummaryDto[]>('drawings/recent', { params: { limit } }));
  }

  /** `GET /drawings/trash`. */
  trash(cursor?: string, limit?: number): Promise<Page<DrawingSummaryDto>> {
    return firstValueFrom(this.api.get<Page<DrawingSummaryDto>>('drawings/trash', { params: { cursor, limit } }));
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

  /** `PATCH /drawings/:id` — rename and/or move. */
  patch(id: string, req: UpdateDrawingRequest): Promise<DrawingSummaryDto> {
    return firstValueFrom(this.api.patch<DrawingSummaryDto>(`drawings/${enc(id)}`, req));
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
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

function ifMatch(version: number | null): Record<string, string> | undefined {
  return version != null ? { 'If-Match': String(version) } : undefined;
}
