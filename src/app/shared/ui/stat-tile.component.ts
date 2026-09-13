import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A labelled number with an optional sparkline.
 *
 * The sparkline is hand-drawn SVG rather than a charting library: the artifact
 * of a 30-point series is a single `<polyline>`, and pulling in a chart package
 * for it would cost more bytes than the whole portal.
 */
@Component({
  selector: 'ui-stat-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tile">
      <span class="tile__label">{{ label() }}</span>
      <span class="tile__value">{{ display() }}</span>
      @if (hint(); as h) {
        <span class="tile__hint">{{ h }}</span>
      }
      @if (points().length > 1) {
        <svg class="tile__spark" [attr.viewBox]="'0 0 100 28'" preserveAspectRatio="none" aria-hidden="true">
          <polyline [attr.points]="path()" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .tile {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--ui-space-4);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .tile__label {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .tile__value {
        font-size: 26px;
        font-weight: 600;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }
      .tile__hint {
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .tile__spark {
        position: absolute;
        inset: auto 0 0 0;
        height: 28px;
        width: 100%;
        color: var(--ui-accent);
        opacity: 0.5;
      }
    `,
  ],
})
export class UiStatTileComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number | string>();
  readonly hint = input<string | null>(null);
  /** Series for the sparkline; fewer than two points draws nothing. */
  readonly points = input<readonly number[]>([]);

  protected readonly display = computed(() => {
    const v = this.value();
    return typeof v === 'number' ? v.toLocaleString() : v;
  });

  /**
   * Maps the series into the 100×28 viewBox. A flat series is drawn along the
   * middle rather than at the top, so "no change" does not look like "maxed
   * out".
   */
  protected readonly path = computed(() => {
    const values = this.points();
    if (values.length < 2) return '';
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const step = 100 / (values.length - 1);
    return values
      .map((value, i) => {
        const y = max === min ? 14 : 26 - ((value - min) / span) * 24;
        return `${(i * step).toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  });
}
