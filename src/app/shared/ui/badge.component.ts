import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Semantic weight of a badge. `neutral` is the default and carries no colour. */
export type UiBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * A small status chip.
 *
 * Exists so state reads at a glance in a dense table — "suspended" as red text
 * among twenty rows of black is easy to miss, the same word in a red-bordered
 * chip is not. Tone is semantic and deliberately separate from the product
 * accent, so a status can never be confused with a brand colour.
 */
@Component({
  selector: 'ui-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="'badge--' + tone()"><ng-content /></span>`,
  styles: [
    `
      .badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 1px 8px; border-radius: var(--ui-radius-full);
        font-size: var(--ui-text-xs); font-weight: 600; letter-spacing: .02em; line-height: 1.5;
        white-space: nowrap; text-transform: lowercase;
        border: 1px solid var(--ui-border); color: var(--ui-text-dim); background: var(--ui-surface-raised);
      }
      .badge--info { border-color: transparent; background: var(--ui-active); color: var(--ui-accent); }
      .badge--success { border-color: transparent; background: var(--ui-success-tint); color: var(--ui-success); }
      .badge--warning { border-color: transparent; background: var(--ui-warning-tint); color: var(--ui-warning); }
      .badge--danger { border-color: transparent; background: var(--ui-danger-tint); color: var(--ui-danger); }
    `,
  ],
})
export class UiBadgeComponent {
  readonly tone = input<UiBadgeTone>('neutral');
}
