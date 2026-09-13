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
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        white-space: nowrap;
        border: 1px solid var(--ui-border);
        color: var(--ui-text-dim);
        background: var(--ui-surface-2);
      }
      .badge--info {
        border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent);
        background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
        color: var(--ui-text);
      }
      .badge--success {
        border-color: color-mix(in srgb, var(--ui-success, #3fb950) 45%, transparent);
        background: color-mix(in srgb, var(--ui-success, #3fb950) 14%, transparent);
        color: var(--ui-text);
      }
      .badge--warning {
        border-color: color-mix(in srgb, var(--ui-warning, #d29922) 50%, transparent);
        background: color-mix(in srgb, var(--ui-warning, #d29922) 16%, transparent);
        color: var(--ui-text);
      }
      .badge--danger {
        border-color: color-mix(in srgb, var(--ui-danger, #f85149) 50%, transparent);
        background: color-mix(in srgb, var(--ui-danger, #f85149) 14%, transparent);
        color: var(--ui-text);
      }
    `,
  ],
})
export class UiBadgeComponent {
  readonly tone = input<UiBadgeTone>('neutral');
}
