import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../../shared/ui/menu/ui-menu-trigger.directive';
import { FileSizePipe } from '../../../shared/ui/pipes/file-size.pipe';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { DRAWING_MENU_ITEMS } from './drawing-menu';

/**
 * List-view counterpart of `DrawingCardComponent` — same inputs, same events,
 * so the drawings page swaps one for the other without touching its handlers.
 * A 40px thumbnail replaces the tile preview; size and edit time move into
 * columns that collapse away below 720px.
 */
@Component({
  selector: 'app-drawing-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiIconComponent, UiMenuTriggerDirective, RelativeTimePipe, FileSizePipe],
  template: `
    <div
      class="dr"
      [uiMenuTrigger]="menuItems()"
      [openOnClick]="false"
      #ctx="uiMenuTrigger"
      (uiMenuSelect)="action.emit($event.id)"
      (contextmenu)="onContextMenu($event, ctx)"
    >
      <button type="button" class="dr__hit" [attr.aria-label]="'Open ' + drawing().name" (click)="open.emit()">
        <span class="dr__thumb">
          @if (drawing().thumbnailUrl && !thumbFailed()) {
            <img [src]="drawing().thumbnailUrl" alt="" loading="lazy" decoding="async" (error)="thumbFailed.set(true)" />
          } @else {
            <ui-icon name="file" [size]="16" />
          }
        </span>
        <span class="dr__name" [title]="drawing().name">{{ drawing().name }}</span>
        <span class="dr__col dr__col--time">Edited {{ drawing().updatedAt | relativeTime }}</span>
        <span class="dr__col dr__col--size">{{ drawing().byteSize | fileSize }}</span>
      </button>

      <button
        type="button"
        uiButton
        variant="ghost"
        size="sm"
        iconOnly
        class="dr__kebab"
        [attr.aria-label]="'Actions for ' + drawing().name"
        [uiMenuTrigger]="menuItems()"
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
      .dr {
        display: flex; align-items: center; gap: var(--ui-space-2);
        padding-right: 8px;
        border-bottom: 1px solid var(--ui-border);
      }
      /* Last row in a bordered list container should not double the frame. */
      :host(:last-child) .dr { border-bottom: 0; }
      .dr:hover { background: var(--ui-hover); }
      .dr:hover .dr__kebab, .dr__kebab[aria-expanded='true'] { opacity: 1; }

      .dr__hit {
        display: flex; align-items: center; gap: var(--ui-space-3);
        flex: 1; min-width: 0; padding: 9px 10px;
        background: transparent; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer;
        border-radius: var(--ui-radius-sm);
      }
      .dr__hit:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }

      .dr__thumb {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 40px; height: 30px; overflow: hidden;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
        background: var(--ui-bg); color: var(--ui-text-dim);
      }
      .dr__thumb img { width: 100%; height: 100%; object-fit: contain; }

      .dr__name {
        flex: 1; min-width: 0;
        font-size: var(--ui-text-md); font-weight: 500; color: var(--ui-text-strong);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .dr__col { flex: 0 0 auto; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .dr__col--time { width: 140px; }
      .dr__col--size { width: 76px; text-align: right; font-family: var(--ui-font-mono); }

      .dr__kebab { opacity: 0; transition: opacity var(--ui-dur-fast); }
      .dr__kebab:focus-visible { opacity: 1; }
      @media (hover: none) { .dr__kebab { opacity: 1; } }
      @media (max-width: 720px) { .dr__col--size { display: none; } }
      @media (max-width: 560px) { .dr__col--time { display: none; } }
    `,
  ],
})
export class DrawingRowComponent {
  readonly drawing = input.required<DrawingSummaryDto>();
  readonly menuItems = input<UiMenuItem[]>([...DRAWING_MENU_ITEMS]);

  readonly open = output<void>();
  readonly action = output<string>();

  protected readonly thumbFailed = signal(false);

  protected onContextMenu(event: MouseEvent, trigger: UiMenuTriggerDirective): void {
    event.preventDefault();
    trigger.openAt(event.clientX, event.clientY);
  }
}
