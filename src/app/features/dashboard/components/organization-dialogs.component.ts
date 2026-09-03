import { A11yModule } from '@angular/cdk/a11y';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { OrgSummaryDto } from '../../../core/api/api.models';
import { OrganizationsApiService } from '../../../core/api/organizations-api.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UI_DIALOG_DATA, UiDialogRef } from '../../../shared/ui/dialog/ui-dialog-ref';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';

/**
 * Create-, join- and delete-organization prompts. Create and join resolve with
 * the resulting `OrgSummaryDto`; delete resolves `true` once the organization
 * is gone. All three resolve `undefined` when cancelled.
 *
 * Design decision: like `NewFolderDialogComponent`, these call the API
 * themselves rather than handing a value back for the caller to submit. Both
 * have errors that only make sense beside the field — a taken name, an
 * unrecognised code — and closing first would throw away what was typed.
 */

let seq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++seq}`;
}

/** Longest name the server accepts (`MAX_ORG_NAME_LENGTH`). */
const MAX_NAME = 80;

@Component({
  selector: 'app-create-organization-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiInputDirective],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">Create organization</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body">
        <label class="og__label" [attr.for]="fieldId">Organization name</label>
        <input
          #field
          uiInput
          type="text"
          [id]="fieldId"
          [attr.maxlength]="maxName"
          placeholder="Acme Design Studio"
          [value]="name()"
          [invalid]="!!error()"
          [disabled]="saving()"
          (input)="onInput($event)"
          (keydown.enter)="submit()"
        />
        @if (error(); as message) {
          <p class="og__error" role="alert">{{ message }}</p>
        } @else {
          <p class="og__hint">
            You will be its owner. Drawings you create inside an organization are visible to every member.
          </p>
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
          Create organization
        </button>
      </footer>
    </div>
  `,
  styles: [
    `
      .og__label { display: block; margin-bottom: 6px; font-size: var(--ui-text-sm); font-weight: 600; color: var(--ui-text-dim); }
      .og__hint { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); line-height: var(--ui-leading); }
      .og__error { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-danger); }
    `,
  ],
})
export class CreateOrganizationDialogComponent implements AfterViewInit {
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<OrgSummaryDto>;
  private readonly orgs = inject(OrganizationsApiService);

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly titleId = nextId('create-org-title');
  protected readonly fieldId = nextId('create-org-field');
  protected readonly maxName = MAX_NAME;
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
      this.ref.close(await this.orgs.create(name));
    } catch (e) {
      this.error.set(e instanceof Error && e.message ? e.message : 'The organization could not be created.');
    } finally {
      this.saving.set(false);
    }
  }
}

@Component({
  selector: 'app-join-organization-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiInputDirective],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">Join an organization</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body">
        <label class="og__label" [attr.for]="fieldId">Join code</label>
        <input
          #field
          uiInput
          type="text"
          class="og__code"
          [id]="fieldId"
          maxlength="12"
          placeholder="ABCD2345"
          autocomplete="off"
          spellcheck="false"
          [value]="code()"
          [invalid]="!!error()"
          [disabled]="saving()"
          (input)="onInput($event)"
          (keydown.enter)="submit()"
        />
        @if (error(); as message) {
          <p class="og__error" role="alert">{{ message }}</p>
        } @else {
          <p class="og__hint">Ask an owner or admin for the organization's join code.</p>
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
          Join
        </button>
      </footer>
    </div>
  `,
  styles: [
    `
      .og__label { display: block; margin-bottom: 6px; font-size: var(--ui-text-sm); font-weight: 600; color: var(--ui-text-dim); }
      .og__hint { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); line-height: var(--ui-leading); }
      .og__error { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-danger); }
      /* Codes are read off a screen and typed by hand — monospace, generously spaced. */
      .og__code { font-family: var(--ui-font-mono); letter-spacing: .16em; text-transform: uppercase; }
    `,
  ],
})
export class JoinOrganizationDialogComponent implements AfterViewInit {
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<OrgSummaryDto>;
  private readonly orgs = inject(OrganizationsApiService);

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly titleId = nextId('join-org-title');
  protected readonly fieldId = nextId('join-org-field');
  protected readonly code = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly valid = computed(() => this.code().trim().length >= 4);

  ngAfterViewInit(): void {
    this.field()?.nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.code.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected async submit(): Promise<void> {
    const code = this.code().trim().toUpperCase();
    if (code.length < 4 || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      this.ref.close(await this.orgs.join({ code }));
    } catch (e) {
      this.error.set(messageForJoin(e));
    } finally {
      this.saving.set(false);
    }
  }
}

export interface DeleteOrganizationDialogData {
  id: string;
  name: string;
  drawingCount: number;
}

/**
 * Owner-only deletion, gated on typing the organization's name.
 *
 * Design decision: a typed confirmation rather than a danger button. This
 * cascades every drawing and folder the organization owns — for everybody, not
 * just the person clicking — and that is the one action in the product where
 * "are you sure?" is genuinely not enough. The comparison is trimmed and
 * case-insensitive: the point is deliberation, not dictation.
 */
@Component({
  selector: 'app-delete-organization-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiInputDirective],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">Delete {{ data.name }}?</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body">
        <p class="og__warn">
          This deletes the organization for every member, along with
          {{ data.drawingCount }} {{ data.drawingCount === 1 ? 'drawing' : 'drawings' }} and every folder inside it.
          It cannot be undone.
        </p>
        <label class="og__label" [attr.for]="fieldId">Type <strong>{{ data.name }}</strong> to confirm</label>
        <input
          #field
          uiInput
          type="text"
          [id]="fieldId"
          autocomplete="off"
          spellcheck="false"
          [value]="typed()"
          [invalid]="!!error()"
          [disabled]="saving()"
          (input)="onInput($event)"
          (keydown.enter)="submit()"
        />
        @if (error(); as message) {
          <p class="og__error" role="alert">{{ message }}</p>
        }
      </div>

      <footer class="ui-dialog__footer">
        <button type="button" uiButton variant="secondary" [disabled]="saving()" (click)="ref.close()">Cancel</button>
        <button
          type="button"
          uiButton
          variant="danger"
          [loading]="saving()"
          [disabled]="!matches() || saving()"
          (click)="submit()"
        >
          Delete organization
        </button>
      </footer>
    </div>
  `,
  styles: [
    `
      .og__label { display: block; margin-bottom: 6px; font-size: var(--ui-text-sm); font-weight: 600; color: var(--ui-text-dim); }
      .og__label strong { color: var(--ui-text-strong); }
      .og__warn {
        margin: 0 0 var(--ui-space-4); padding: 10px 12px;
        font-size: var(--ui-text-sm); line-height: var(--ui-leading); color: var(--ui-text);
        background: var(--ui-danger-tint); border-radius: var(--ui-radius-md);
      }
      .og__error { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-danger); }
    `,
  ],
})
export class DeleteOrganizationDialogComponent implements AfterViewInit {
  protected readonly data = inject(UI_DIALOG_DATA) as DeleteOrganizationDialogData;
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<boolean>;
  private readonly orgs = inject(OrganizationsApiService);

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly titleId = nextId('delete-org-title');
  protected readonly fieldId = nextId('delete-org-field');
  protected readonly typed = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly matches = computed(
    () => this.typed().trim().toLowerCase() === this.data.name.trim().toLowerCase(),
  );

  ngAfterViewInit(): void {
    this.field()?.nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected async submit(): Promise<void> {
    if (!this.matches() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.orgs.remove(this.data.id);
      this.ref.close(true);
    } catch (e) {
      this.error.set(e instanceof Error && e.message ? e.message : 'The organization could not be deleted.');
    } finally {
      this.saving.set(false);
    }
  }
}

/** The two join failures a user can actually act on get their own wording. */
function messageForJoin(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'ORG_NOT_FOUND') return 'No organization matches that code. Check it and try again.';
    if (e.code === 'ALREADY_MEMBER') return 'You are already a member of that organization.';
  }
  return e instanceof Error && e.message ? e.message : 'Could not join that organization.';
}
