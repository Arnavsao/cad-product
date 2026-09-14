import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A labelled number, an optional change against a named period, and an
 * optional sparkline.
 *
 * Layout is a fixed vertical stack — label, value, hint, then the sparkline
 * in a strip of its own — so nothing overlaps whatever the numbers happen to
 * be. The earlier version painted the sparkline absolutely across the bottom,
 * which put it through the hint text the moment both were present.
 *
 * Follows the stat-tile contract: value in semibold sans, compacted past four
 * digits (12.9K); delta signed and coloured by direction × whether up is good;
 * sparkline in the de-emphasis ink with only the current point in the accent.
 */
@Component({
  selector: 'ui-stat-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tile">
      <div class="tile__top">
        <span class="tile__label">{{ label() }}</span>
        @if (deltaText(); as d) {
          <span
            class="tile__delta"
            [class.tile__delta--good]="deltaGood()"
            [class.tile__delta--bad]="deltaBad()"
            [title]="deltaTitle()"
          >
            <span aria-hidden="true">{{ deltaArrow() }}</span>{{ d }}
            <span class="tile__delta-period">{{ change()?.period }}</span>
          </span>
        }
      </div>
      <span class="tile__value">{{ display() }}</span>
      @if (hint(); as h) {
        <span class="tile__hint">{{ h }}</span>
      }
      @if (points().length > 1) {
        <svg class="tile__spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <polyline class="tile__spark-line" [attr.points]="path()" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        </svg>
        <svg class="tile__spark-dot" viewBox="0 0 100 28" aria-hidden="true" focusable="false">
          <circle [attr.cx]="lastX()" [attr.cy]="lastY()" r="2.5" />
        </svg>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      .tile {
        position: relative;
        display: grid;
        gap: 2px;
        padding: var(--ui-space-4) var(--ui-space-5);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-lg);
        background: var(--ui-surface);
      }
      .tile__top { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-2); }
      .tile__label {
        font-size: var(--ui-text-xs); font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
        color: var(--ui-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .tile__delta {
        display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto;
        padding: 1px 7px; border-radius: var(--ui-radius-full);
        font-size: var(--ui-text-xs); font-weight: 600; font-variant-numeric: tabular-nums;
        color: var(--ui-text-dim); background: var(--ui-hover);
      }
      .tile__delta-period { font-weight: 500; opacity: .75; margin-left: 2px; }
      .tile__delta--good { color: var(--ui-success); background: var(--ui-success-tint); }
      .tile__delta--bad { color: var(--ui-danger); background: var(--ui-danger-tint); }
      .tile__value {
        margin-top: 4px;
        font-size: var(--ui-text-2xl); font-weight: 650; letter-spacing: -.02em; line-height: 1.1;
        color: var(--ui-text-strong); font-variant-numeric: tabular-nums;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .tile__hint { font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .tile__spark {
        display: block; width: 100%; height: 28px; margin-top: var(--ui-space-2);
        overflow: visible;
      }
      .tile__spark-line { stroke: var(--ui-text-dim); opacity: .55; }
      /* Drawn in a second, aspect-preserving SVG so the dot is round however
         wide the tile is; the line's SVG stretches, which would squash it. */
      .tile__spark-dot {
        position: absolute; right: var(--ui-space-5); bottom: var(--ui-space-4);
        width: calc(100% - 2 * var(--ui-space-5)); height: 28px; pointer-events: none; overflow: visible;
      }
      .tile__spark-dot circle { fill: var(--ui-accent); stroke: var(--ui-surface); stroke-width: 2; }
    `,
  ],
})
export class UiStatTileComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number | string>();
  readonly hint = input<string | null>(null);
  /** Series for the sparkline; fewer than two points draws nothing. */
  readonly points = input<readonly number[]>([]);
  /**
   * What changed, against a named period. Null hides the pill.
   *
   * `current` and `previous` are counts of the same flow (sign-ups this week,
   * sign-ups last week). The tile decides how to say it: a percentage once the
   * base is big enough to make one meaningful, an absolute difference before
   * that — "−33%" on a base of three tells the reader nothing true.
   */
  readonly change = input<{ current: number; previous: number; period: string; noun?: string } | null>(null);
  /** Whether an increase is a good thing. Open feedback going up is not. */
  readonly upIsGood = input(true);

  protected readonly display = computed(() => {
    const v = this.value();
    return typeof v === 'number' ? compact(v) : v;
  });

  /** Signed difference, in whichever unit is honest for the base. */
  private readonly diff = computed(() => {
    const c = this.change();
    if (!c) return null;
    return c.current - c.previous;
  });
  protected readonly deltaText = computed(() => {
    const c = this.change();
    const d = this.diff();
    if (!c || d === null) return null;
    if (d === 0) return 'no change';
    // Below ten events the percentage is dominated by noise; the count is the
    // number a reader can actually act on.
    if (c.previous < 10) return `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
    return `${d > 0 ? '+' : '−'}${Math.abs(Math.round((d / c.previous) * 100))}%`;
  });
  protected readonly deltaTitle = computed(() => {
    const c = this.change();
    if (!c) return '';
    const noun = c.noun ?? 'events';
    return `${c.current.toLocaleString()} ${noun} in the last ${c.period}, ${c.previous.toLocaleString()} in the ${c.period} before`;
  });
  protected readonly deltaArrow = computed(() => {
    const d = this.diff();
    return d === null || d === 0 ? '' : d > 0 ? '↑' : '↓';
  });
  protected readonly deltaGood = computed(() => {
    const d = this.diff();
    return d !== null && d !== 0 && d > 0 === this.upIsGood();
  });
  protected readonly deltaBad = computed(() => {
    const d = this.diff();
    return d !== null && d !== 0 && d > 0 !== this.upIsGood();
  });

  /**
   * Maps the series into the 100×28 box. A flat series sits mid-height so "no
   * change" does not read as "maxed out".
   */
  protected readonly path = computed(() => {
    const values = this.points();
    if (values.length < 2) return '';
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const step = 100 / (values.length - 1);
    return values
      .map((value, i) => `${(i * step).toFixed(2)},${y(value, min, max, span).toFixed(2)}`)
      .join(' ');
  });
  protected readonly lastX = computed(() => 100);
  protected readonly lastY = computed(() => {
    const values = this.points();
    if (values.length < 2) return 14;
    const max = Math.max(...values);
    const min = Math.min(...values);
    return y(values[values.length - 1], min, max, max - min || 1);
  });
}

function y(value: number, min: number, max: number, span: number): number {
  return max === min ? 14 : 25 - ((value - min) / span) * 22;
}

/** 1284 → "1,284"; 12 900 → "12.9K"; 4 200 000 → "4.2M". */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 10_000) return `${trim(n / 1_000)}K`;
  return n.toLocaleString();
}
function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}
