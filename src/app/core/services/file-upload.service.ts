import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { HttpManagerService } from './http-manager.service';

export interface PresignedUrlResponse {
  /** Pre-signed PUT URL for the object store. */
  uploadUrl: string;
  /** Public/readable URL of the object once uploaded. */
  fileUrl: string;
  key?: string;
}

export const UPLOAD_ENDPOINTS = {
  PRESIGNED_URL: '/upload/presigned-url',
} as const;

/**
 * Two-step object-store upload: ask the backend for a pre-signed URL, then PUT
 * the file straight to storage. The PUT deliberately bypasses `HttpManagerService`
 * so no Authorization header leaks to the storage provider.
 */
@Injectable({ providedIn: 'root' })
export class FileUploadService {
  private api = inject(HttpManagerService);
  private http = inject(HttpClient);

  getPresignedUrl(fileName: string, contentType: string, projectId?: string): Observable<PresignedUrlResponse> {
    const params = new URLSearchParams({ fileName, contentType });
    if (projectId) params.set('projectId', projectId);
    return this.api.get<PresignedUrlResponse>(`${UPLOAD_ENDPOINTS.PRESIGNED_URL}?${params.toString()}`);
  }

  uploadToS3(uploadUrl: string, file: File): Observable<unknown> {
    return this.http.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  }
}
