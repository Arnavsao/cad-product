import { A11yModule } from '@angular/cdk/a11y';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FolderDto } from '../../../core/api/api.models';
import { FoldersApiService } from '../../../core/api/folders-api.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UI_DIALOG_DATA, UiDialogRef } from '../../../shared/ui/dialog/ui-dialog-ref';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';

export interface NewFolderDialogData {
  /** Where the folder is created; null for the top level. */
  parentId: string | null;
  /**
   * Workspace to create in; null for personal. Ignored by the server when
   * `parentId` is set, since the parent's workspace wins.
   */
  organizationId?: string | null;
  /** Name of the parent, shown as context. */
  parentName?: string;
}

/**
 * Create-folder prompt. Resolves with the created `FolderDto`, or `undefined`
 * when cancelled.
 *
 * Design decision: this dialog *does* call the API, unlike `RenameDialog`. The
 * server answers 409 `NAME_TAKEN`, and the only place that error is useful is
 * next to the field the user must change — closing first and toasting later
 * would lose what they typed.
 */
@Component({
  selector: 'app-new-folder-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiInputDirective],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">New folder</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body">
        <label class="nf__label" [attr.for]="fieldId">Folder name</label>
        <input
          #field
          uiInput
          type="text"
          [id]="fieldId"
          [value]="name()"
          [invalid]="!!error()"
          [disabled]="saving()"
          (input)="onInput($event)"
          (keydown.enter)="submit()"
        />
        @if (error(); as message) {
          <p class="nf__error" role="alert">{{ message }}</p>
        } @else if (data.parentName) {
          <p class="nf__hint">Created inside {{ data.parentName }}.</p>
        }
      </div>

      <footer class="ui-dialog__footer">
        <button type="button" uiButton variant="secondary" [disabled]="saving()" (click)="ref.close()">Cancel</button>
        <button type="button" uiButton variant="primary" [loading]="saving()" [disabled]="!valid() || saving()" (click)="submit()">
          Create folder
        </button>
      </footer>
    </div>
  `,
  styles: [
    `
      .nf__label { display: block; margin-bottom: 6px; font-size: var(--ui-text-sm); font-weight: 600; color: var(--ui-text-dim); }
      .nf__hint { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .nf__error { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-danger); }
    `,
  ],
})
export class NewFolderDialogComponent implements AfterViewInit {
  protected readonly data = inject(UI_DIALOG_DATA) as NewFolderDialogData;
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<FolderDto>;
  private readonly folders = inject(FoldersApiService);

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly titleId = nextId('new-folder-title');
  protected readonly fieldId = nextId('new-folder-field');
  protected readonly name = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly valid = computed(() => this.name().trim().length > 0);

  ngAfterViewInit(): void {
    this.field()?.nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected async submit(): Promise<void> {
    const name = this.name().trim();
    if (!name || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const folder = await this.folders.create({
        name,
        parentId: this.data.parentId,
        organizationId: this.data.organizationId ?? null,
      });
      this.ref.close(folder);
    } catch (e) {
      this.error.set(
        e instanceof ApiError && e.code === 'NAME_TAKEN'
          ? 'A folder with that name already exists here.'
          : e instanceof Error && e.message
            ? e.message
            : 'The folder could not be created.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}

let seq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++seq}`;
}
