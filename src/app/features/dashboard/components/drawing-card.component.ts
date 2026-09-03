import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../../shared/ui/menu/ui-menu-trigger.directive';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { drawingMenuFor } from './drawing-menu';
import type { RowSelectEvent } from './drawing-row.component';

/**
 * Grid tile for one drawing: thumbnail, name, "Edited 2h ago".
 *
 * Design decisions: the tile is a `<button>` so Enter/Space open it and focus is
 * visible for free, with the kebab and the selection checkbox lifted out of it
 * (a nested control would be invalid HTML). The same menu is reachable by
 * right-click anywhere on the tile, and it defaults to `drawingMenuFor` so grid
 * view offers exactly the actions list view does. Thumbnails are presigned URLs
 * that can expire, so a load failure silently falls back to the placeholder
 * instead of showing a broken image.
 */
@Component({
  selector: 'app-drawing-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiIconComponent, UiMenuTriggerDirective, RelativeTimePipe],
  template: `
    <div
      class="dc"
      [class.dc--selected]="selected()"
      [attr.draggable]="draggable() ? 'true' : null"
      [uiMenuTrigger]="menu()"
      [openOnClick]="false"
      #ctx="uiMenuTrigger"
      (uiMenuSelect)="action.emit($event.id)"
      (contextmenu)="onContextMenu($event, ctx)"
      (dragstart)="dragStart.emit($event)"
      (dragend)="dragEnd.emit()"
    >
      <button type="button" class="dc__hit" [attr.aria-label]="'Open ' + drawing().name" (click)="open.emit()">
        <span class="dc__thumb">
          @if (drawing().thumbnailUrl && !thumbFailed()) {
            <img [src]="drawing().thumbnailUrl" alt="" loading="lazy" decoding="async" (error)="thumbFailed.set(true)" />
          } @else {
            <span class="dc__placeholder"><ui-icon name="file" [size]="26" [strokeWidth]="1.4" /></span>
          }
          @if (drawing().format === 'dwg') {
            <span class="dc__badge">DWG</span>
          }
        </span>
        <span class="dc__meta">
          <span class="dc__name" [title]="drawing().name">{{ drawing().name }}</span>
          <span class="dc__sub">
            Edited {{ drawing().updatedAt | relativeTime }}
            @if (readOnly()) {
              · View only
            }
          </span>
        </span>
      </button>

      @if (selectable()) {
        <input
          type="checkbox"
          class="dc__check"
          [checked]="selected()"
          [attr.aria-label]="'Select ' + drawing().name"
          (click)="onPick($event)"
        />
      }

      <button
        type="button"
        uiButton
        variant="ghost"
        size="sm"
        iconOnly
        class="dc__kebab"
        [attr.aria-label]="'Actions for ' + drawing().name"
        [uiMenuTrigger]="menu()"
        menuAlign="end"
        (uiMenuSelect)="action.emit($event.id)"
      >
        <ui-icon name="more" />
      </button>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .dc {
        position: relative;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg);
        background: var(--ui-surface);
        transition: border-color var(--ui-dur-fast), background var(--ui-dur-fast);
      }
      .dc:hover { border-color: var(--ui-border-strong); }
      .dc:hover .dc__kebab, .dc__kebab[aria-expanded='true'] { opacity: 1; }
      .dc:hover .dc__check, .dc--selected .dc__check, .dc__check:focus-visible { opacity: 1; }
      .dc--selected { border-color: var(--ui-accent); box-shadow: 0 0 0 1px var(--ui-accent); }

      .dc__hit {
        display: block; width: 100%; padding: 0; text-align: left;
        background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer;
        border-radius: var(--ui-radius-lg);
      }
      .dc__hit:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }

      .dc__thumb {
        position: relative; display: grid; place-items: center;
        aspect-ratio: 8 / 5; overflow: hidden;
        border-radius: calc(var(--ui-radius-lg) - 1px) calc(var(--ui-radius-lg) - 1px) 0 0;
        background: var(--ui-bg);
        border-bottom: 1px solid var(--ui-border);
      }
      .dc__thumb img { width: 100%; height: 100%; object-fit: contain; }
      .dc__placeholder { color: var(--ui-text-dim); opacity: .6; }
      .dc__badge {
        position: absolute; top: 8px; left: 8px;
        padding: 2px 6px; border-radius: var(--ui-radius-sm);
        background: var(--ui-warning-tint); color: var(--ui-warning);
        font: 600 var(--ui-text-xs) / 1.4 var(--ui-font-mono); letter-spacing: .04em;
      }

      .dc__meta { display: block; padding: 10px 12px 12px; }
      .dc__name {
        display: block; font-size: var(--ui-text-md); font-weight: 500; color: var(--ui-text-strong);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .dc__sub { display: block; margin-top: 3px; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .dc__kebab {
        position: absolute; top: 8px; right: 8px;
        opacity: 0; background: var(--ui-surface); border-color: var(--ui-border);
        transition: opacity var(--ui-dur-fast);
      }
      .dc__kebab:focus-visible { opacity: 1; }
      @media (hover: none) { .dc__kebab { opacity: 1; } }

      .dc__check {
        position: absolute; top: 10px; left: 10px;
        width: 16px; height: 16px; margin: 0;
        accent-color: var(--ui-accent); cursor: pointer;
        opacity: 0; transition: opacity var(--ui-dur-fast);
      }
      @media (hover: none) { .dc__check { opacity: 1; } }
    `,
  ],
})
export class DrawingCardComponent {
  readonly drawing = input.required<DrawingSummaryDto>();
  /** Override the menu; leave unset for the access-aware default. */
  readonly menuItems = input<UiMenuItem[] | null>(null);
  /** Show the selection checkbox. */
  readonly selectable = input(true);
  readonly selected = input(false);
  /** Let the tile start an HTML5 drag (the page fills the `dataTransfer`). */
  readonly draggable = input(false);

  /** Primary activation (click / Enter on the tile). */
  readonly open = output<void>();
  /** A menu item id — narrow it with `toDrawingAction`. */
  readonly action = output<string>();
  readonly selectChange = output<RowSelectEvent>();
  readonly dragStart = output<DragEvent>();
  readonly dragEnd = output<void>();

  protected readonly thumbFailed = signal(false);
  protected readonly menu = computed<UiMenuItem[]>(() => this.menuItems() ?? drawingMenuFor(this.drawing()));
  protected readonly readOnly = computed(() => this.drawing().access === 'view');

  protected onContextMenu(event: MouseEvent, trigger: UiMenuTriggerDirective): void {
    event.preventDefault();
    trigger.openAt(event.clientX, event.clientY);
  }

  protected onPick(event: MouseEvent): void {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.selectChange.emit({ selected: input.checked, shift: event.shiftKey });
  }
}
