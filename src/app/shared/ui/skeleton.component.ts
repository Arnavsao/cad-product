import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, numberAttribute } from '@angular/core';

/**
 * Loading placeholder with a shimmer. Sizes are CSS lengths.
 *
 * ```html
 * <ui-skeleton width="160px" height="36px" />          one block
 * <ui-skeleton [lines]="3" />                          three text lines
 * <ui-skeleton width="32px" height="32px" circle />    avatar
 * ```
 */
@Component({
  selector: 'ui-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (_ of rows(); track $index; let last = $last) {
      <span
        class="sk"
        [class.sk--circle]="circle()"
        [style.width]="lines() > 1 && last ? '60%' : width()"
        [style.height]="height()"
        [style.border-radius]="circle() ? '50%' : radius()"
      ></span>
    }
  `,
  host: { class: 'ui-skeleton', 'aria-hidden': 'true' },
  styles: [
    `
      :host { display: inline-flex; flex-direction: column; gap: 8px; max-width: 100%; vertical-align: middle; }
      :host([block]) { display: flex; }
      .sk {
        display: block;
        background: linear-gradient(90deg, var(--ui-hover) 25%, var(--ui-surface-raised) 50%, var(--ui-hover) 75%);
        background-size: 200% 100%;
        animation: ui-shimmer 1.4s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
    `,
  ],
})
export class UiSkeletonComponent {
  readonly width = input<string>('100%');
  readonly height = input<string>('14px');
  readonly radius = input<string>('var(--ui-radius-sm)');
  readonly lines = input(1, { transform: numberAttribute });
  readonly circle = input(false, { transform: booleanAttribute });

  protected readonly rows = computed(() => Array.from({ length: Math.max(1, this.lines()) }));
}
