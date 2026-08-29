import { Pipe, PipeTransform } from '@angular/core';

/** Bytes → "512 B" / "48 KB" / "1.2 MB" / "2.00 GB". Ported from the editor's drawing browser. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** `{{ drawing.byteSize | fileSize }}` */
@Pipe({ name: 'fileSize', standalone: true })
export class FileSizePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value == null ? '' : formatFileSize(value);
  }
}
