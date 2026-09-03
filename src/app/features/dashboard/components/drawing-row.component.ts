import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { MeService } from '../../../core/api/me.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../../shared/ui/menu/ui-menu-trigger.directive';
import { FileSizePipe } from '../../../shared/ui/pipes/file-size.pipe';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { drawingMenuFor } from './drawing-menu';

/** A checkbox click, with the modifier that turns it into a range selection. */
export interface RowSelectEvent {
  selected: boolean;
  shift: boolean;
}

/**
 * One row of the drawings table: ☐ · File Type · Name · Date Modified · Size ·
 * Owner · Shared.
 *
 * Design decisions:
 *
 * - **The column widths live in `--dw-cols` on the list container**, not here.
 *   The header (`app-drawings-table-header`) reads the same custom property, so
 *   the two cannot drift out of alignment — which is exactly what a row of
 *   independent flex items could not guarantee. The checkbox is a real column
 *   in that template rather than an overlay, so a checked row does not shift.
 *
 * - **The whole row opens the drawing, and so does a real button.** Clicking
 *   anywhere is what people expect from a file list, but a click handler on a
 *   `div` is invisible to a keyboard and a screen reader, so the name cell
 *   carries an actual `<button>` as the accessible control. The checkbox cell
 *   stops propagation — ticking a row must never also open it.
 *
 * - **The menu defaults to the access-aware one.** `menuItems` exists as an
 *   override for a page with different actions (Trash), but leaving it unset
 *   yields `drawingMenuFor(drawing)`, so a view-only row cannot offer Rename.
 *
 * - **"You" instead of your own name.** In a personal workspace every row would
 *   otherwise repeat the same name 25 times; in an org, what matters about a row
 *   is whether it is yours.
 *
 * Same inputs and events as `DrawingCardComponent`, so the page swaps one for
 * the other without touching its handlers.
 */
@Component({
  selector: 'app-drawing-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiIconComponent, UiMenuTriggerDirective, RelativeTimePipe, FileSizePipe],
  template: `
    <div
      class="dr"
      role="row"
      [class.dr--selected]="selected()"
      [attr.draggable]="draggable() ? 'true' : null"
      [uiMenuTrigger]="menu()"
      [openOnClick]="false"
      #ctx="uiMenuTrigger"
      (uiMenuSelect)="action.emit($event.id)"
      (contextmenu)="onContextMenu($event, ctx)"
      (dragstart)="dragStart.emit($event)"
      (dragend)="dragEnd.emit()"
      (click)="open.emit()"
    >
      <!-- Selection -->
      <span class="dr__cell dr__cell--pick" role="gridcell" (click)="$event.stopPropagation()">
        @if (selectable()) {
          <input
            type="checkbox"
            class="dr__check"
            [checked]="selected()"
            [attr.aria-label]="'Select ' + drawing().name"
            (click)="onPick($event)"
          />
        }
      </span>

      <!-- File type -->
      <span class="dr__cell dr__cell--type" role="gridcell">
        <span class="dr__format" [class.dr__format--dwg]="drawing().format === 'dwg'">
          {{ drawing().format.toUpperCase() }}
        </span>
      </span>

      <!-- Name (with the thumbnail preview) -->
      <span class="dr__cell dr__cell--name" role="gridcell">
        <span class="dr__thumb" aria-hidden="true">
          @if (drawing().thumbnailUrl && !thumbFailed()) {
            <img [src]="drawing().thumbnailUrl" alt="" loading="lazy" decoding="async" (error)="thumbFailed.set(true)" />
          } @else {
            <ui-icon name="file" [size]="14" />
          }
        </span>
        <button
          type="button"
          class="dr__name"
          [title]="drawing().name"
          [attr.aria-label]="'Open ' + drawing().name"
          (click)="onNameClick($event)"
        >
          {{ drawing().name }}
        </button>
        @if (readOnly()) {
          <span class="dr__ro" title="You can open and download this drawing, but not change it">View only</span>
        }
      </span>

      <!-- Date modified -->
      <span class="dr__cell dr__cell--modified" role="gridcell" [title]="drawing().updatedAt">
        {{ drawing().updatedAt | relativeTime }}
      </span>

      <!-- Size -->
      <span class="dr__cell dr__cell--size" role="gridcell">{{ drawing().byteSize | fileSize }}</span>

      <!-- Owner -->
      <span class="dr__cell dr__cell--owner" role="gridcell" [title]="ownerName()">
        @if (drawing().owner) {
          <span class="dr__avatar" aria-hidden="true">
            @if (drawing().owner?.imageUrl) {
              <img [src]="drawing().owner?.imageUrl" alt="" loading="lazy" decoding="async" />
            } @else {
              {{ ownerInitials() }}
            }
          </span>
          <span class="dr__owner-name">{{ ownerName() }}</span>
        } @else {
          <span class="dr__muted">—</span>
        }
      </span>

      <!-- Shared -->
      <span class="dr__cell dr__cell--shared" role="gridcell">
        @if (sharedLabel(); as label) {
          <span class="dr__chip" [title]="label.title">
            <ui-icon [name]="label.icon" [size]="12" />
            <span class="dr__chip-text">{{ label.text }}</span>
          </span>
        } @else {
          <span class="dr__muted">—</span>
        }
      </span>

      <!-- Row menu -->
      <span class="dr__cell dr__cell--menu" role="gridcell">
        <button
          type="button"
          uiButton
          size="sm"
          iconOnly
          variant="ghost"
          class="dr__kebab"
          aria-label="Drawing actions"
          [uiMenuTrigger]="menu()"
          menuAlign="end"
          (uiMenuSelect)="action.emit($event.id)"
          (click)="$event.stopPropagation()"
        >
          <ui-icon name="more" [size]="16" />
        </button>
      </span>
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      .dr {
        display: grid;
        /* Falls back only if a container forgot to set it; the table always does. */
        grid-template-columns: var(--dw-cols, 36px 78px minmax(180px, 1fr) 150px 96px 160px 170px 44px);
        align-items: center;
        gap: var(--ui-space-2);
        padding: 0 var(--ui-space-2);
        border-bottom: 1px solid var(--ui-border);
        cursor: pointer;
      }
      /* Last row in a bordered list container should not double the frame. */
      :host(:last-child) .dr { border-bottom: 0; }
      .dr:hover { background: var(--ui-hover); }
      .dr:hover .dr__kebab, .dr__kebab[aria-expanded='true'] { opacity: 1; }
      .dr--selected { background: var(--ui-active); }
      .dr:hover .dr__check, .dr--selected .dr__check, .dr__check:focus-visible { opacity: 1; }

      .dr__cell {
        min-width: 0;
        padding: 9px 6px;
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      /* ── selection ── */
      .dr__cell--pick { display: flex; justify-content: center; padding-left: 0; padding-right: 0; }
      .dr__check {
        width: 15px; height: 15px; margin: 0; accent-color: var(--ui-accent); cursor: pointer;
        opacity: 0; transition: opacity var(--ui-dur-fast);
      }
      @media (hover: none) { .dr__check { opacity: 1; } }

      /* ── file type ── */
      .dr__cell--type { display: flex; justify-content: flex-start; }
      .dr__format {
        display: inline-block; padding: 2px 6px;
        font-size: var(--ui-text-xs); font-weight: 600; letter-spacing: .04em;
        font-family: var(--ui-font-mono);
        color: var(--ui-accent);
        background: var(--ui-accent-tint);
        border-radius: var(--ui-radius-sm);
      }
      /* DWG is opaque to the editor (conversion is phase 2) — worth a distinct colour. */
      .dr__format--dwg { color: var(--ui-warning, #d99a2b); background: var(--ui-warning-tint, rgba(217, 154, 43, .15)); }

      /* ── name ── */
      .dr__cell--name { display: flex; align-items: center; gap: var(--ui-space-3); }
      .dr__thumb {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 34px; height: 26px; overflow: hidden;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
        background: var(--ui-bg); color: var(--ui-text-dim);
      }
      .dr__thumb img { width: 100%; height: 100%; object-fit: contain; }

      .dr__name {
        flex: 1; min-width: 0;
        padding: 0; text-align: left;
        font: inherit; font-size: var(--ui-text-md); font-weight: 500;
        color: var(--ui-text-strong);
        background: transparent; border: 0; cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .dr__name:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: var(--ui-radius-sm); }
      .dr__ro {
        flex: 0 0 auto; padding: 1px 6px;
        font-size: var(--ui-text-xs); font-weight: 600;
        color: var(--ui-text-dim); background: var(--ui-hover);
        border-radius: var(--ui-radius-full);
      }

      /* ── size ── */
      .dr__cell--size { text-align: right; font-family: var(--ui-font-mono); font-variant-numeric: tabular-nums; }

      /* ── owner ── */
      .dr__cell--owner { display: flex; align-items: center; gap: var(--ui-space-2); }
      .dr__avatar {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 22px; height: 22px; overflow: hidden;
        border-radius: var(--ui-radius-full);
        background: var(--ui-accent-tint); color: var(--ui-accent);
        font-size: 9px; font-weight: 700; letter-spacing: .02em;
      }
      .dr__avatar img { width: 100%; height: 100%; object-fit: cover; }
      .dr__owner-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }

      /* ── shared ── */
      .dr__chip {
        display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
        padding: 2px 8px;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-full);
        color: var(--ui-text); background: var(--ui-surface);
        font-size: var(--ui-text-xs);
      }
      .dr__chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .dr__muted { color: var(--ui-text-placeholder); }

      /* ── menu ── */
      .dr__cell--menu { display: flex; justify-content: flex-end; padding-right: 0; }
      .dr__kebab { opacity: 0; transition: opacity var(--ui-dur-fast); }
      .dr__kebab:focus-visible { opacity: 1; }
      @media (hover: none) { .dr__kebab { opacity: 1; } }

      /*
       * Columns drop in order of how much they matter on a narrow window. The
       * container's --dw-cols is overridden in lockstep by the table header's
       * stylesheet, so the two never disagree at any width.
       */
      @media (max-width: 1100px) {
        .dr__cell--shared { display: none; }
      }
      @media (max-width: 900px) {
        .dr__cell--owner { display: none; }
      }
      @media (max-width: 720px) {
        .dr__cell--size { display: none; }
      }
      @media (max-width: 560px) {
        .dr__cell--modified { display: none; }
      }
    `,
  ],
})
export class DrawingRowComponent {
  readonly drawing = input.required<DrawingSummaryDto>();
  /** Override the menu; leave unset for the access-aware default. */
  readonly menuItems = input<UiMenuItem[] | null>(null);
  /** Show the selection checkbox. */
  readonly selectable = input(true);
  readonly selected = input(false);
  /** Let the row start an HTML5 drag (the page fills the `dataTransfer`). */
  readonly draggable = input(false);

  readonly open = output<void>();
  readonly action = output<string>();
  readonly selectChange = output<RowSelectEvent>();
  readonly dragStart = output<DragEvent>();
  readonly dragEnd = output<void>();

  private readonly me = inject(MeService);

  protected readonly thumbFailed = signal(false);

  protected readonly menu = computed<UiMenuItem[]>(() => this.menuItems() ?? drawingMenuFor(this.drawing()));

  /** A row reached through a view-only share is worth saying out loud. */
  protected readonly readOnly = computed(() => this.drawing().access === 'view');

  protected readonly ownerName = computed(() => {
    const owner = this.drawing().owner;
    if (!owner) return '—';
    if (owner.id === this.me.me()?.user.id) return 'You';
    const full = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim();
    return full || 'Unknown';
  });

  protected readonly ownerInitials = computed(() => {
    const owner = this.drawing().owner;
    if (!owner) return '?';
    const initials = [owner.firstName, owner.lastName]
      .filter((part): part is string => !!part)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
    return initials || '?';
  });

  /**
   * The "Shared" cell.
   *
   * A summary says *that* the row arrived through a share, not which target the
   * share named, so an org-owned drawing shared onward is labelled with the org
   * it lives in and a personal one with "Shared with you" — both true, and both
   * more use than repeating the word "shared".
   */
  protected readonly sharedLabel = computed<{ icon: 'users' | 'user'; text: string; title: string } | null>(() => {
    const drawing = this.drawing();
    const org = drawing.organizationName;
    if (drawing.viaShare) {
      return org
        ? { icon: 'users', text: org, title: `Shared with you from ${org}` }
        : { icon: 'user', text: 'Shared with you', title: 'Shared with you directly' };
    }
    return org ? { icon: 'users', text: org, title: `Shared with ${org}` } : null;
  });

  protected onContextMenu(event: MouseEvent, trigger: UiMenuTriggerDirective): void {
    event.preventDefault();
    trigger.openAt(event.clientX, event.clientY);
  }

  /** The row already opens on click; stop the button from firing it twice. */
  protected onNameClick(event: MouseEvent): void {
    event.stopPropagation();
    this.open.emit();
  }

  protected onPick(event: MouseEvent): void {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.selectChange.emit({ selected: input.checked, shift: event.shiftKey });
  }
}
