import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import { UiIconComponent, UiIconName } from '../icon.component';

/** One entry of a `<ui-menu>`. Same shape as the editor's `IContextMenuItem`, minus the callback (selection is an event). */
export interface UiMenuItem {
  id: string;
  label: string;
  icon?: UiIconName;
  danger?: boolean;
  /** Draws a divider *before* this item. A separator-only row has no label. */
  separator?: boolean;
  disabled?: boolean;
  /** Right-aligned hint, e.g. "Ctrl+S". */
  shortcut?: string;
}

/**
 * Dropdown / context menu body. Normally created by `UiMenuTriggerDirective`
 * inside a CDK overlay, but it can also be embedded inline. Keyboard: ↑/↓ move,
 * Home/End jump, Enter/Space activate, Esc/Tab close.
 */
@Component({
  selector: 'ui-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent],
  template: `
    <div class="menu" role="menu" (keydown)="onKeydown($event)">
      @for (item of items(); track item.id) {
        @if (item.separator) {
          <div class="menu__sep" role="separator"></div>
        }
        @if (item.label) {
          <button
            type="button"
            role="menuitem"
            class="menu__item"
            [class.menu__item--danger]="item.danger"
            [disabled]="item.disabled"
            tabindex="-1"
            (click)="activate(item)"
          >
            @if (item.icon; as ic) {
              <ui-icon class="menu__icon" [name]="ic" [size]="15" />
            } @else {
              <span class="menu__icon"></span>
            }
            <span class="menu__label">{{ item.label }}</span>
            @if (item.shortcut) {
              <span class="menu__shortcut">{{ item.shortcut }}</span>
            }
          </button>
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .menu {
        min-width: 180px;
        padding: 4px;
        background: var(--ui-surface);
        color: var(--ui-text);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        box-shadow: var(--ui-shadow-panel);
        font: 400 var(--ui-text-md) / 1.2 var(--ui-font);
        animation: ui-pop-in var(--ui-dur-fast) var(--ui-ease);
      }
      .menu__sep { height: 1px; margin: 4px 6px; background: var(--ui-border); }
      .menu__item {
        display: flex; align-items: center; gap: 10px;
        width: 100%; padding: 7px 10px;
        border: 0; border-radius: var(--ui-radius-sm);
        background: transparent; color: inherit;
        font: inherit; text-align: left; cursor: pointer;
      }
      .menu__item:hover:not(:disabled), .menu__item:focus-visible { background: var(--ui-hover); outline: none; }
      .menu__item:focus-visible { box-shadow: inset 0 0 0 1px var(--ui-accent); }
      .menu__item:disabled { opacity: .45; cursor: default; }
      .menu__item--danger { color: var(--ui-danger); }
      .menu__item--danger:hover:not(:disabled) { background: var(--ui-danger-tint); }
      .menu__icon { display: inline-flex; width: 15px; color: var(--ui-text-dim); flex: 0 0 auto; }
      .menu__item--danger .menu__icon { color: inherit; }
      .menu__label { flex: 1; white-space: nowrap; }
      .menu__shortcut { color: var(--ui-text-dim); font-family: var(--ui-font-mono); font-size: var(--ui-text-xs); }
    `,
  ],
})
export class UiMenuComponent {
  readonly items = input<UiMenuItem[]>([]);
  /** Emitted with the activated (enabled) item. */
  readonly selected = output<UiMenuItem>();
  /** Emitted when the user asks to leave the menu (Esc / Tab). */
  readonly closed = output<void>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Move focus to the first enabled item (call after the menu is in the DOM). */
  focusFirst(): void {
    this.enabledItems()[0]?.focus();
  }

  protected activate(item: UiMenuItem): void {
    if (item.disabled) return;
    this.selected.emit(item);
  }

  protected onKeydown(e: KeyboardEvent): void {
    const items = this.enabledItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowDown': next = current < 0 ? 0 : (current + 1) % items.length; break;
      case 'ArrowUp': next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        this.closed.emit();
        return;
      default:
        return;
    }
    e.preventDefault();
    items[next]?.focus();
  }

  private enabledItems(): HTMLButtonElement[] {
    return Array.from(this.el.nativeElement.querySelectorAll<HTMLButtonElement>('.menu__item:not(:disabled)'));
  }
}
