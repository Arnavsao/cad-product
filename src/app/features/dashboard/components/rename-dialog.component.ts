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
}

/**
 * Single-field rename prompt. Resolves with the trimmed new name, or
 * `undefined` when cancelled / dismissed / unchanged.
 *
 * Design decision: the dialog validates but does not call the API — the caller
 * owns the optimistic list update and the failure toast, and reusing this for
 * folders as well as drawings then costs nothing.
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
          [invalid]="!valid()"
          (input)="name.set(value($event))"
          (keydown.enter)="submit()"
        />
        @if (!valid()) {
          <p class="rd__hint" role="alert">A name is required.</p>
        }
      </div>

      <footer class="ui-dialog__footer">
        <button type="button" uiButton variant="secondary" (click)="ref.close()">Cancel</button>
        <button type="button" uiButton variant="primary" [disabled]="!valid()" (click)="submit()">
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
  protected readonly valid = computed(() => this.name().trim().length > 0);

  ngAfterViewInit(): void {
    const el = this.field()?.nativeElement;
    el?.focus();
    el?.select();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected submit(): void {
    const next = this.name().trim();
    if (!next) return;
    this.ref.close(next === this.data.value ? undefined : next);
  }
}

let seq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++seq}`;
}
