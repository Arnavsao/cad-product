import { A11yModule } from '@angular/cdk/a11y';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UI_DIALOG_DATA, UiDialogRef } from '../../../shared/ui/dialog/ui-dialog-ref';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';

export interface RenameDialogData {
  /** Dialog heading, e.g. "Rename drawing". */
  title: string;
  /** Label above the field, e.g. "Name". */
  label: string;
  /** Current value; pre-selected so typing replaces it. */
  value: string;
  /** Default "Rename". */
  confirmLabel?: string;
  /**
   * Optional commit hook. When given, the dialog calls it on submit and stays
   * open if it resolves with a message, which it then shows beside the field.
   *
   * This exists for one error in particular: renaming onto a sibling's name is
   * a 409 `NAME_TAKEN`, and the only place that is useful is next to the field
   * the user has to change. Closing first and toasting after would throw away
   * what they typed. Resolve `null` on success — the dialog closes with the name.
   */
  onSubmit?: (name: string) => Promise<string | null>;
}

/**
 * Single-field rename prompt. Resolves with the trimmed new name, or
 * `undefined` when cancelled / dismissed / unchanged.
 *
 * Design decision: the dialog validates and, by default, does not call the API —
 * the caller owns the optimistic list update and the failure toast, so reusing
 * this for folders as well as drawings costs nothing. A caller that needs an
 * error shown *inside* the dialog passes `onSubmit` (see `RenameDialogData`).
 */
@Component({
  selector: 'app-rename-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiInputDirective],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">{{ data.title }}</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body">
        <label class="rd__label" [attr.for]="fieldId">{{ data.label }}</label>
        <input
          #field
          uiInput
          type="text"
          [id]="fieldId"
          [value]="name()"
          [invalid]="!valid() || !!error()"
          [disabled]="saving()"
          (input)="onInput($event)"
          (keydown.enter)="submit()"
        />
        @if (!valid()) {
          <p class="rd__hint" role="alert">A name is required.</p>
        } @else if (error(); as message) {
          <p class="rd__hint" role="alert">{{ message }}</p>
        }
      </div>

      <footer class="ui-dialog__footer">
        <button type="button" uiButton variant="secondary" [disabled]="saving()" (click)="ref.close()">Cancel</button>
        <button
          type="button"
          uiButton
          variant="primary"
          [loading]="saving()"
          [disabled]="!valid() || saving()"
          (click)="submit()"
        >
          {{ data.confirmLabel ?? 'Rename' }}
        </button>
      </footer>
    </div>
  `,
  styles: [
    `
      .rd__label { display: block; margin-bottom: 6px; font-size: var(--ui-text-sm); font-weight: 600; color: var(--ui-text-dim); }
      .rd__hint { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-danger); }
    `,
  ],
})
export class RenameDialogComponent implements AfterViewInit {
  protected readonly data = inject(UI_DIALOG_DATA) as RenameDialogData;
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<string>;

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly titleId = nextId('rename-title');
  protected readonly fieldId = nextId('rename-field');
  protected readonly name = signal(this.data.value);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly valid = computed(() => this.name().trim().length > 0);

  ngAfterViewInit(): void {
    const el = this.field()?.nativeElement;
    el?.focus();
    el?.select();
  }

  protected onInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    // Typing is the fix for a name clash, so clear the error as they type.
    this.error.set(null);
  }

  protected async submit(): Promise<void> {
    const next = this.name().trim();
    if (!next || this.saving()) return;
    if (next === this.data.value) {
      this.ref.close(undefined);
      return;
    }
    if (!this.data.onSubmit) {
      this.ref.close(next);
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const message = await this.data.onSubmit(next);
      if (message === null) {
        this.ref.close(next);
      } else {
        this.error.set(message);
      }
    } finally {
      this.saving.set(false);
    }
  }
}

let seq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++seq}`;
}
