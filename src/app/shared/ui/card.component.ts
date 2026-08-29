import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

export type UiCardPadding = 'none' | 'sm' | 'md' | 'lg';

/**
 * Surface container. `interactive` adds hover/focus affordances for cards that
 * act as links or buttons (drawing tiles) — give those a `tabindex`/`role`.
 *
 * ```html
 * <ui-card padding="sm" interactive (click)="open()" role="button" tabindex="0">…</ui-card>
 * ```
 */
@Component({
  selector: 'ui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    class: 'ui-card',
    '[class.ui-card--interactive]': 'interactive()',
    '[class.ui-card--selected]': 'selected()',
    '[attr.data-padding]': 'padding()',
  },
  styles: [
    `
      :host {
        display: block;
        background: var(--ui-surface);
        color: var(--ui-text);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-lg);
        transition: border-color var(--ui-dur-fast), background var(--ui-dur-fast), box-shadow var(--ui-dur-fast);
      }
      :host([data-padding='none']) { padding: 0; }
      :host([data-padding='sm']) { padding: var(--ui-space-3); }
      :host([data-padding='md']) { padding: var(--ui-space-4); }
      :host([data-padding='lg']) { padding: var(--ui-space-6); }
      :host(.ui-card--interactive) { cursor: pointer; }
      :host(.ui-card--interactive:hover) { border-color: var(--ui-border-strong); background: var(--ui-hover); }
      :host(.ui-card--interactive:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      :host(.ui-card--selected) { border-color: var(--ui-accent); box-shadow: var(--ui-focus-ring); }
    `,
  ],
})
export class UiCardComponent {
  readonly padding = input<UiCardPadding>('md');
  readonly interactive = input(false, { transform: booleanAttribute });
  readonly selected = input(false, { transform: booleanAttribute });
}
