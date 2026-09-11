import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { UiIconName } from '../../../shared/ui/icon.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { MotionService } from '../motion/motion.service';

/** One tab. The prose fields hold translation keys, resolved here. */
export interface SiteTab {
  id: string;
  labelKey: string;
  icon?: UiIconName;
  /** Optional short line under the label, for the vertical variant. */
  hintKey?: string;
}

/**
 * Accessible tabs. The parent owns which panel is shown (`@switch` on
 * `active`); this component owns the tablist semantics, keyboard handling and
 * the panel's enter animation.
 *
 * ```html
 * <site-tabs [tabs]="tabs" [(active)]="active" orientation="vertical">
 *   @switch (active()) { … }
 * </site-tabs>
 * ```
 *
 * Roving tabindex with arrow keys, Home and End, per the WAI-ARIA tabs pattern.
 * Selection follows focus so keyboard users do not have to press Enter twice.
 */
@Component({
  selector: 'site-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, UiIconComponent],
  template: `
    <ng-container *transloco="let t">
    <div class="tabs__list" role="tablist" [attr.aria-orientation]="orientation()" [attr.aria-label]="t(labelKey())" (keydown)="onKey($event)">
      @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          role="tab"
          class="tabs__tab"
          [id]="idFor(tab.id)"
          [class.tabs__tab--on]="active() === tab.id"
          [attr.aria-selected]="active() === tab.id"
          [attr.aria-controls]="panelIdFor(tab.id)"
          [tabindex]="active() === tab.id ? 0 : -1"
          (click)="select(tab.id)"
        >
          @if (tab.icon) { <ui-icon class="tabs__icon" [name]="tab.icon" [size]="16" /> }
          <span class="tabs__text">
            <span class="tabs__label">{{ t(tab.labelKey) }}</span>
            @if (tab.hintKey) { <span class="tabs__hint">{{ t(tab.hintKey) }}</span> }
          </span>
        </button>
      }
    </div>
    <div #panel class="tabs__panel" role="tabpanel" [id]="panelIdFor(active())" [attr.aria-labelledby]="idFor(active())" tabindex="0">
      <ng-content />
    </div>
    </ng-container>
  `,
  host: {
    class: 'site-tabs',
    '[class.site-tabs--vertical]': 'orientation() === "vertical"',
  },
  styles: [
    `
      :host { display: grid; gap: var(--ui-space-6); }
      :host(.site-tabs--vertical) { grid-template-columns: minmax(200px, 280px) minmax(0, 1fr); align-items: start; }

      .tabs__list {
        display: flex;
        gap: 4px;
        padding: 4px;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-lg);
        background: color-mix(in srgb, var(--ui-surface) 84%, transparent);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .tabs__list::-webkit-scrollbar { display: none; }
      :host(.site-tabs--vertical) .tabs__list { flex-direction: column; overflow: visible; position: sticky; top: calc(var(--site-header-h) + 16px); }

      .tabs__tab {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex: 1 0 auto;
        padding: 9px 14px;
        border: 0;
        border-radius: var(--ui-radius-md);
        background: transparent;
        color: var(--ui-text-dim);
        font: 500 var(--ui-text-md) / 1.2 var(--ui-font);
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--ui-dur-fast), color var(--ui-dur-fast);
      }
      :host(.site-tabs--vertical) .tabs__tab { flex: 0 0 auto; padding: 12px 14px; white-space: normal; }
      .tabs__tab:hover { color: var(--ui-text-strong); background: var(--ui-hover); }
      .tabs__tab:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
      .tabs__tab--on,
      .tabs__tab--on:hover { background: var(--ui-accent); color: var(--ui-on-accent); }
      :host(.site-tabs--vertical) .tabs__tab--on,
      :host(.site-tabs--vertical) .tabs__tab--on:hover {
        background: var(--ui-accent-tint);
        color: var(--ui-text-strong);
        box-shadow: inset 3px 0 0 var(--ui-accent);
      }
      .tabs__icon { flex: 0 0 auto; }
      .tabs__text { display: grid; gap: 2px; min-width: 0; }
      .tabs__hint { font-size: var(--ui-text-xs); font-weight: 400; color: var(--ui-text-dim); line-height: 1.35; }
      .tabs__tab--on .tabs__hint { color: inherit; opacity: .85; }
      :host(.site-tabs--vertical) .tabs__tab--on .tabs__hint { color: var(--ui-text-dim); opacity: 1; }

      .tabs__panel { min-width: 0; }
      .tabs__panel:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 4px; border-radius: var(--ui-radius-lg); }

      @media (max-width: 820px) {
        :host(.site-tabs--vertical) { grid-template-columns: minmax(0, 1fr); }
        :host(.site-tabs--vertical) .tabs__list { flex-direction: row; position: static; overflow-x: auto; }
        :host(.site-tabs--vertical) .tabs__tab { white-space: nowrap; padding: 9px 14px; }
        :host(.site-tabs--vertical) .tabs__hint { display: none; }
        :host(.site-tabs--vertical) .tabs__tab--on { background: var(--ui-accent); color: var(--ui-on-accent); box-shadow: none; }
      }
    `,
  ],
})
export class SiteTabsComponent implements AfterViewInit {
  readonly tabs = input.required<readonly SiteTab[]>();
  readonly active = model.required<string>();
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  /** Translation key for the tablist's accessible name. */
  readonly labelKey = input('site.components.tabs.sections');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly uid = `st${Math.random().toString(36).slice(2, 8)}`;
  private ready = false;

  constructor() {
    // Animate the panel in whenever the selection changes (not on first render).
    effect(() => {
      this.active();
      if (this.ready) void this.animatePanel();
    });
  }

  ngAfterViewInit(): void {
    this.ready = true;
  }

  protected idFor(id: string): string {
    return `${this.uid}-tab-${id}`;
  }
  protected panelIdFor(id: string): string {
    return `${this.uid}-panel-${id}`;
  }

  protected select(id: string): void {
    if (this.active() !== id) this.active.set(id);
  }

  protected onKey(event: KeyboardEvent): void {
    const ids = this.tabs().map((t) => t.id);
    const i = ids.indexOf(this.active());
    const vertical = this.orientation() === 'vertical';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    let to = -1;
    if (event.key === next) to = (i + 1) % ids.length;
    else if (event.key === prev) to = (i - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = ids.length - 1;
    if (to < 0) return;
    event.preventDefault();
    this.select(ids[to]);
    const btn = this.host.nativeElement.querySelector<HTMLButtonElement>(`#${this.idFor(ids[to])}`);
    btn?.focus();
  }

  private async animatePanel(): Promise<void> {
    if (this.motion.reduced()) return;
    const el = this.panel().nativeElement;
    const { gsap } = await this.motion.load();
    const tween = gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', clearProps: 'transform' });
    this.destroyRef.onDestroy(() => tween.kill());
  }
}
