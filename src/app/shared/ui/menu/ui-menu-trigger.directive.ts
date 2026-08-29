import { ConnectedPosition, Overlay, OverlayRef, PositionStrategy } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ComponentRef, Directive, ElementRef, OnDestroy, inject, input, output, signal } from '@angular/core';
import { UiMenuComponent, UiMenuItem } from './ui-menu.component';

export type UiMenuAlign = 'start' | 'end';

/**
 * Opens a `<ui-menu>` in a CDK overlay anchored to the host element.
 *
 * ```html
 * <button uiButton iconOnly aria-label="More"
 *         [uiMenuTrigger]="menuItems" menuAlign="end" (uiMenuSelect)="onMenu($event)">
 *   <ui-icon name="more" />
 * </button>
 *
 * <!-- context menu: -->
 * <div (contextmenu)="$event.preventDefault(); menu.openAt($event.clientX, $event.clientY)"
 *      [uiMenuTrigger]="items" #menu="uiMenuTrigger" (uiMenuSelect)="…"></div>
 * ```
 * Click toggles; selecting an item, Esc, Tab, a backdrop click or destroying
 * the host closes it and returns focus to the host.
 */
@Directive({
  selector: '[uiMenuTrigger]',
  standalone: true,
  exportAs: 'uiMenuTrigger',
  host: {
    '(click)': 'onHostClick($event)',
    '[attr.aria-haspopup]': '"menu"',
    '[attr.aria-expanded]': 'isOpen()',
  },
})
export class UiMenuTriggerDirective implements OnDestroy {
  /** The menu entries. */
  readonly items = input.required<UiMenuItem[]>({ alias: 'uiMenuTrigger' });
  /** Horizontal edge the menu aligns to. */
  readonly menuAlign = input<UiMenuAlign>('start');
  /** Set false when the host handles opening itself (e.g. right-click only). */
  readonly openOnClick = input(true);
  /** Fires with the chosen item. */
  readonly uiMenuSelect = output<UiMenuItem>();

  readonly isOpen = signal(false);

  private readonly overlay = inject(Overlay);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private overlayRef: OverlayRef | null = null;
  private menuRef: ComponentRef<UiMenuComponent> | null = null;

  protected onHostClick(e: MouseEvent): void {
    if (!this.openOnClick()) return;
    e.stopPropagation();
    this.toggle();
  }

  toggle(): void {
    this.isOpen() ? this.close() : this.open();
  }

  /** Open anchored to the host element. */
  open(): void {
    const align = this.menuAlign();
    const positions: ConnectedPosition[] = [
      { originX: align, originY: 'bottom', overlayX: align, overlayY: 'top', offsetY: 4 },
      { originX: align, originY: 'top', overlayX: align, overlayY: 'bottom', offsetY: -4 },
    ];
    this.show(this.overlay.position().flexibleConnectedTo(this.host).withPositions(positions).withPush(true));
  }

  /** Open at a viewport point (context menus). */
  openAt(x: number, y: number): void {
    const positions: ConnectedPosition[] = [
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
      { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
      { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
    ];
    this.show(this.overlay.position().flexibleConnectedTo({ x, y }).withPositions(positions).withPush(true));
  }

  close(): void {
    if (!this.overlayRef) return;
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.menuRef = null;
    this.isOpen.set(false);
    this.host.nativeElement.focus?.();
  }

  ngOnDestroy(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.menuRef = null;
  }

  private show(positionStrategy: PositionStrategy): void {
    this.close();
    const overlayRef = this.overlay.create({
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'ui-menu-panel',
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
    });
    const ref = overlayRef.attach(new ComponentPortal(UiMenuComponent));
    ref.setInput('items', this.items());
    ref.instance.selected.subscribe((item) => {
      this.uiMenuSelect.emit(item);
      this.close();
    });
    ref.instance.closed.subscribe(() => this.close());
    overlayRef.backdropClick().subscribe(() => this.close());
    overlayRef.detachments().subscribe(() => {
      if (this.overlayRef === overlayRef) this.close();
    });
    ref.changeDetectorRef.detectChanges();
    this.overlayRef = overlayRef;
    this.menuRef = ref;
    this.isOpen.set(true);
    // Focus after the overlay has been positioned and painted.
    requestAnimationFrame(() => this.menuRef?.instance.focusFirst());
  }
}
