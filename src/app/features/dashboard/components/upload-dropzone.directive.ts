import { Directive, input, output, signal } from '@angular/core';

/**
 * Turns any element into a file drop target.
 *
 * Design decision: the directive reports files and hover state; it does not
 * know about uploading. The shell owns the target folder and calls
 * `UploadService`, which keeps the directive reusable (the drawings page could
 * make a folder tile a drop target with the same code) and testable without HTTP.
 *
 * `dragenter`/`dragleave` fire for every child element the pointer crosses, so
 * hover state is tracked with a depth counter rather than a boolean.
 *
 * ```html
 * <section appUploadDropzone (filesDropped)="upload($event)" #zone="appUploadDropzone"
 *          [class.is-over]="zone.over()"> … </section>
 * ```
 */
@Directive({
  selector: '[appUploadDropzone]',
  standalone: true,
  exportAs: 'appUploadDropzone',
  host: {
    '(dragenter)': 'onDragEnter($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
})
export class UploadDropzoneDirective {
  /** Ignore drags entirely (e.g. on Trash, where an import makes no sense). */
  readonly disabled = input(false);
  /** Fires with the dropped files; never empty. */
  readonly filesDropped = output<File[]>();

  /** True while a file drag is over the element. Bind it to a highlight class. */
  readonly over = signal(false);

  private depth = 0;

  protected onDragEnter(event: DragEvent): void {
    if (this.disabled() || !hasFiles(event)) return;
    event.preventDefault();
    this.depth++;
    this.over.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (this.disabled() || !hasFiles(event)) return;
    // Without preventDefault the browser navigates to the file instead of dropping.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onDragLeave(event: DragEvent): void {
    if (this.disabled() || !this.depth) return;
    event.preventDefault();
    this.depth = Math.max(0, this.depth - 1);
    if (!this.depth) this.over.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (this.disabled() || !hasFiles(event)) return;
    event.preventDefault();
    this.depth = 0;
    this.over.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) this.filesDropped.emit(files);
  }
}

/** True when the drag carries files rather than, say, selected text. */
function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.prototype.includes.call(types, 'Files');
}
