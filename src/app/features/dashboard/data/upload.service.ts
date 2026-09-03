import { HttpEventType } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { NotificationService } from '../../../core/services/notification.service';

/** Extensions the API accepts for `POST /uploads/presign`. */
export const ACCEPTED_UPLOAD_EXTENSIONS = ['.dxf', '.dwg'] as const;
/** `accept` attribute for the shell's file input. */
export const UPLOAD_ACCEPT = ACCEPTED_UPLOAD_EXTENSIONS.join(',');
/** Server limit (`MAX_UPLOAD_BYTES`), checked here so we fail before the round trip. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * IANA media types for the two formats. The same string is sent to
 * `/uploads/presign` and used as the `Content-Type` of the PUT — a presigned
 * S3/R2 URL signs that header, so the two must match exactly.
 */
const CONTENT_TYPES: Record<string, string> = {
  dxf: 'image/vnd.dxf',
  dwg: 'image/vnd.dwg',
};

export type UploadState = 'uploading' | 'importing' | 'done' | 'error';

export interface UploadTask {
  id: string;
  fileName: string;
  /** 0..100 — determinate while the bytes are in flight, 100 during import. */
  progress: number;
  state: UploadState;
  /** Failure reason, shown next to the file name. */
  message?: string;
  drawingId?: string;
}

/**
 * Presign → PUT → import, with a visible progress task per file.
 *
 * Design decisions:
 *  - **The bytes never touch the API.** `presignUpload` hands back a storage URL
 *    the browser PUTs to directly, so a 40 MB DXF does not stream through Nest.
 *    `uploadToStorage` is the one Observable in the API layer precisely because
 *    that step reports progress.
 *  - **Tasks live in a root signal, not in the dropzone.** The user may navigate
 *    between dashboard pages mid-upload; the shell renders `tasks()` so the
 *    progress panel survives those navigations.
 *  - **DWG imports but does not open.** The editor cannot parse DWG yet, so a
 *    successful DWG import toasts that fact and stays on the dashboard instead
 *    of navigating into an editor that would fail to load it.
 */
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly drawings = inject(DrawingsApiService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  private seq = 0;

  readonly tasks = signal<UploadTask[]>([]);
  readonly busy = computed(() => this.tasks().some((t) => t.state === 'uploading' || t.state === 'importing'));

  /**
   * Upload and import every accepted file. Resolves with the drawings that were
   * created. A single successfully imported DXF also opens in the editor.
   */
  async upload(
    files: readonly File[],
    folderId: string | null,
    organizationId: string | null = null,
  ): Promise<DrawingSummaryDto[]> {
    const accepted: File[] = [];
    for (const file of files) {
      if (!isAccepted(file)) {
        this.notify.error(`${file.name} is not a DXF or DWG file.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        this.notify.error(`${file.name} is larger than the 50 MB upload limit.`);
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return [];

    const created: DrawingSummaryDto[] = [];
    for (const file of accepted) {
      const drawing = await this.uploadOne(file, folderId, organizationId);
      if (drawing) created.push(drawing);
    }

    if (created.length === 1 && created[0].format === 'dxf') {
      await this.router.navigate(['/editor', created[0].id]);
    }
    return created;
  }

  /** Drop a finished (or failed) task from the progress panel. */
  dismiss(id: string): void {
    this.tasks.update((list) => list.filter((t) => t.id !== id));
  }

  /** Drop every task that is no longer running. */
  clearFinished(): void {
    this.tasks.update((list) => list.filter((t) => t.state === 'uploading' || t.state === 'importing'));
  }

  private async uploadOne(
    file: File,
    folderId: string | null,
    organizationId: string | null,
  ): Promise<DrawingSummaryDto | null> {
    const id = `upload-${++this.seq}`;
    const contentType = contentTypeOf(file);
    this.tasks.update((list) => [...list, { id, fileName: file.name, progress: 0, state: 'uploading' }]);

    try {
      const presign = await this.drawings.presignUpload({ fileName: file.name, contentType, byteSize: file.size });
      await this.putBytes(id, presign.uploadUrl, file, contentType);

      this.patch(id, { state: 'importing', progress: 100 });
      const drawing = await this.drawings.importDrawing({ key: presign.key, name: file.name, folderId, organizationId });

      this.patch(id, { state: 'done', drawingId: drawing.id });
      if (drawing.format === 'dwg') {
        this.notify.warning(`${drawing.name} was imported. DWG drawings can be stored and downloaded, but not opened in the editor yet.`, 7000);
      } else {
        this.notify.success(`${drawing.name} was imported.`);
      }
      return drawing;
    } catch (e) {
      const message = uploadMessage(e, file.name);
      this.patch(id, { state: 'error', message });
      this.notify.error(message);
      return null;
    }
  }

  /** PUT the file to storage, mirroring `UploadProgress` events into the task. */
  private putBytes(id: string, url: string, file: File, contentType: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.drawings.uploadToStorage(url, file, contentType).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.patch(id, { progress: Math.min(99, Math.round((event.loaded / event.total) * 100)) });
          }
        },
        error: (err: unknown) => reject(err),
        complete: () => resolve(),
      });
    });
  }

  private patch(id: string, patch: Partial<UploadTask>): void {
    this.tasks.update((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function isAccepted(file: File): boolean {
  return (ACCEPTED_UPLOAD_EXTENSIONS as readonly string[]).includes(`.${extensionOf(file.name)}`);
}

function contentTypeOf(file: File): string {
  return CONTENT_TYPES[extensionOf(file.name)] ?? 'application/octet-stream';
}

/** Turn the documented `ApiError` statuses into something a person can act on. */
function uploadMessage(e: unknown, fileName: string): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 413:
        return `${fileName} is larger than the 50 MB upload limit.`;
      case 415:
        return `${fileName} is not a supported file type — upload a .dxf or .dwg file.`;
      case 422:
        return `${fileName} could not be read as a CAD drawing. It may be corrupt or saved in an unsupported version.`;
      case 404:
        return `The upload of ${fileName} expired before it finished. Please try again.`;
      case 0:
        return `${fileName} could not be uploaded — check your network connection.`;
      default:
        return e.message || `${fileName} could not be uploaded.`;
    }
  }
  return `${fileName} could not be uploaded.`;
}
