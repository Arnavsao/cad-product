import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { UiIconComponent } from '../../../shared/ui/icon.component';

export interface SiteAccordionItem {
  id: string;
  title: string;
  body: string;
  /** Optional small label shown after the title ("Free", "Pro", "Roadmap"). */
  tag?: string;
}

/**
 * Accordion for FAQs and long lists of explanations.
 *
 * Buttons with `aria-expanded` and `aria-controls` rather than `<details>`, so
 * the open height can animate: the panel is a CSS grid whose row goes from
 * `0fr` to `1fr`, which transitions smoothly without measuring anything in JS.
 * `single` keeps one item open at a time (FAQ), otherwise several may be open.
 */
@Component({
  selector: 'site-accordion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent],
  template: `
    @for (item of items(); track item.id) {
      <div class="acc__item" [class.acc__item--open]="isOpen(item.id)">
        <h3 class="acc__h">
          <button
            type="button"
            class="acc__btn"
            [id]="'acc-btn-' + item.id"
            [attr.aria-expanded]="isOpen(item.id)"
            [attr.aria-controls]="'acc-panel-' + item.id"
            (click)="toggle(item.id)"
          >
            <span class="acc__title">{{ item.title }}</span>
            @if (item.tag) { <span class="site-pill site-pill--muted acc__tag">{{ item.tag }}</span> }
            <ui-icon class="acc__chev" name="chevron-down" [size]="16" />
          </button>
        </h3>
        <div class="acc__panel" [id]="'acc-panel-' + item.id" role="region" [attr.aria-labelledby]="'acc-btn-' + item.id" [attr.aria-hidden]="!isOpen(item.id)">
          <div class="acc__inner">
            <p class="acc__body">{{ item.body }}</p>
          </div>
        </div>
      </div>
    }
  `,
  host: { class: 'site-accordion' },
  styles: [
    `
      :host {
        display: block;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-xl);
        background: color-mix(in srgb, var(--ui-surface) 84%, transparent);
        overflow: hidden;
      }
      .acc__item { border-bottom: 1px solid var(--ui-border); }
      .acc__item:last-child { border-bottom: 0; }
      .acc__h { margin: 0; font: inherit; }
      .acc__btn {
        display: flex;
        align-items: center;
        gap: var(--ui-space-3);
        width: 100%;
        padding: 16px 18px;
        border: 0;
        background: transparent;
        color: var(--ui-text-strong);
        font: 500 var(--ui-text-base) / 1.35 var(--ui-font);
        text-align: left;
        cursor: pointer;
        transition: background var(--ui-dur-fast);
      }
      .acc__btn:hover { background: var(--ui-hover); }
      .acc__btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
      .acc__title { flex: 1; }
      .acc__tag { flex: 0 0 auto; }
      .acc__chev { flex: 0 0 auto; color: var(--ui-text-dim); transition: transform var(--ui-dur) var(--ui-ease-out); }
      .acc__item--open .acc__chev { transform: rotate(180deg); }

      .acc__panel {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows var(--ui-dur-slow) var(--ui-ease-out);
      }
      .acc__item--open .acc__panel { grid-template-rows: 1fr; }
      .acc__inner { overflow: hidden; min-height: 0; }
      .acc__body {
        margin: 0;
        padding: 0 18px 18px;
        font-size: var(--ui-text-md);
        line-height: 1.6;
        color: var(--ui-text-dim);
        text-wrap: pretty;
      }

      @media (prefers-reduced-motion: reduce) {
        .acc__panel, .acc__chev { transition: none; }
      }
    `,
  ],
})
export class SiteAccordionComponent {
  readonly items = input.required<readonly SiteAccordionItem[]>();
  readonly single = input(true);
  /** Ids open on first render. */
  readonly initiallyOpen = input<readonly string[]>([]);

  private readonly open = signal<ReadonlySet<string> | null>(null);

  protected isOpen(id: string): boolean {
    return (this.open() ?? new Set(this.initiallyOpen())).has(id);
  }

  protected toggle(id: string): void {
    const current = new Set(this.open() ?? this.initiallyOpen());
    if (current.has(id)) current.delete(id);
    else {
      if (this.single()) current.clear();
      current.add(id);
    }
    this.open.set(current);
  }
}
