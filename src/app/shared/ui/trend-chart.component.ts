import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

export interface TrendPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  value: number;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 36 };

/**
 * A single-series line-and-area chart over time, with a crosshair tooltip.
 *
 * Sized to its container in real pixels (a ResizeObserver feeds the width) so
 * text never stretches — a `preserveAspectRatio="none"` SVG would squash every
 * label. The plot is recessive: three light gridlines, axis text in the muted
 * ink, a 2px line in the accent and a faint area under it. One series, so no
 * legend: the surrounding heading names it.
 *
 * Hover snaps to the nearest x — the reader aims at a date, never at the line
 * — and the same readout is reachable from the keyboard with the arrow keys.
 */
@Component({
  selector: 'ui-trend-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ui-trend-chart' },
  template: `
    <div class="tc" [style.height.px]="height()">
      @if (allZero()) {
        <p class="tc__empty">{{ emptyText() }}</p>
      }
      <svg
        class="tc__svg"
        [attr.width]="width()"
        [attr.height]="height()"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        tabindex="0"
        (keydown)="onKey($event)"
        (pointermove)="onMove($event)"
        (pointerleave)="active.set(null)"
        (blur)="active.set(null)"
      >
        <!-- gridlines + y labels -->
        @for (tick of yTicks(); track tick.value) {
          <line class="tc__grid" [attr.x1]="pad.left" [attr.x2]="width() - pad.right" [attr.y1]="tick.y" [attr.y2]="tick.y" />
          <text class="tc__axis" [attr.x]="pad.left - 8" [attr.y]="tick.y + 3.5" text-anchor="end">{{ tick.label }}</text>
        }
        <!-- x labels: first, middle, last -->
        @for (tick of xTicks(); track tick.x) {
          <text class="tc__axis" [attr.x]="tick.x" [attr.y]="height() - 8" [attr.text-anchor]="tick.anchor">{{ tick.label }}</text>
        }
        <!-- series -->
        @if (!allZero()) {
          <path class="tc__area" [attr.d]="areaPath()" />
          <path class="tc__line" [attr.d]="linePath()" />
          <circle class="tc__end" [attr.cx]="last().x" [attr.cy]="last().y" r="3.5" />
        }
        <!-- crosshair -->
        @if (activePoint(); as p) {
          <line class="tc__hair" [attr.x1]="p.x" [attr.x2]="p.x" [attr.y1]="pad.top" [attr.y2]="height() - pad.bottom" />
          <circle class="tc__dot" [attr.cx]="p.x" [attr.cy]="p.y" r="4.5" />
        }
      </svg>
      @if (activePoint(); as p) {
        <div class="tc__tip" [style.left.px]="tipLeft()" [style.top.px]="p.y - 10" role="status">
          <span class="tc__tip-value">{{ p.value.toLocaleString() }}</span>
          <span class="tc__tip-label">{{ longDate(p.date) }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      .tc { position: relative; width: 100%; }
      .tc__svg { display: block; width: 100%; overflow: visible; outline: none; cursor: crosshair; }
      .tc__svg:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: var(--ui-radius-sm); }
      .tc__grid { stroke: var(--ui-border); stroke-width: 1; }
      .tc__axis { fill: var(--ui-text-dim); font: var(--ui-text-xs) var(--ui-font); font-variant-numeric: tabular-nums; }
      .tc__area { fill: var(--ui-accent); opacity: .12; }
      .tc__line { fill: none; stroke: var(--ui-accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
      .tc__end { fill: var(--ui-accent); stroke: var(--ui-surface); stroke-width: 2; }
      .tc__hair { stroke: var(--ui-text-dim); stroke-width: 1; stroke-dasharray: 3 3; }
      .tc__dot { fill: var(--ui-accent); stroke: var(--ui-surface); stroke-width: 2; }
      .tc__tip {
        position: absolute; transform: translate(-50%, -100%);
        display: grid; gap: 1px; padding: 6px 10px; pointer-events: none;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md);
        background: var(--ui-surface-raised); box-shadow: var(--ui-shadow-panel);
        white-space: nowrap;
      }
      .tc__tip-value { font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); font-variant-numeric: tabular-nums; }
      .tc__tip-label { font-size: var(--ui-text-xs); color: var(--ui-text-dim); }
      .tc__empty {
        position: absolute; inset: 0; margin: 0; display: grid; place-items: center;
        font-size: var(--ui-text-sm); color: var(--ui-text-dim); pointer-events: none;
      }
    `,
  ],
})
export class UiTrendChartComponent {
  readonly points = input.required<readonly TrendPoint[]>();
  /** What the series is, for the accessible name: "Sign-ups per day". */
  readonly label = input.required<string>();
  readonly height = input(200);
  readonly emptyText = input('Nothing in this period');

  protected readonly pad = PAD;
  protected readonly width = signal(600);
  protected readonly active = signal<number | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement;
      const measure = () => this.width.set(Math.max(240, Math.floor(el.clientWidth)));
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      destroy.onDestroy(() => ro.disconnect());
    });
  }

  protected readonly max = computed(() => {
    const top = Math.max(0, ...this.points().map((p) => p.value));
    return niceCeil(top);
  });
  protected readonly allZero = computed(() => this.points().every((p) => p.value === 0));
  protected readonly ariaLabel = computed(() => {
    const pts = this.points();
    const total = pts.reduce((s, p) => s + p.value, 0);
    return `${this.label()}: ${total.toLocaleString()} over ${pts.length} days`;
  });

  private readonly plot = computed(() => {
    const w = this.width() - PAD.left - PAD.right;
    const h = this.height() - PAD.top - PAD.bottom;
    return { w, h };
  });

  protected readonly xy = computed(() => {
    const pts = this.points();
    const { w, h } = this.plot();
    const max = this.max() || 1;
    const step = pts.length > 1 ? w / (pts.length - 1) : 0;
    return pts.map((p, i) => ({
      ...p,
      x: PAD.left + i * step,
      y: PAD.top + h - (p.value / max) * h,
    }));
  });

  protected readonly linePath = computed(() =>
    this.xy()
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' '),
  );
  protected readonly areaPath = computed(() => {
    const pts = this.xy();
    if (pts.length === 0) return '';
    const base = PAD.top + this.plot().h;
    return `${this.linePath()} L${pts[pts.length - 1].x.toFixed(1)} ${base} L${pts[0].x.toFixed(1)} ${base} Z`;
  });
  protected readonly last = computed(() => this.xy()[this.xy().length - 1] ?? { x: 0, y: 0 });

  protected readonly yTicks = computed(() => {
    const max = this.max();
    const { h } = this.plot();
    return [0, 0.5, 1].map((f) => ({
      value: max * f,
      label: compactAxis(max * f),
      y: PAD.top + h - f * h,
    }));
  });
  protected readonly xTicks = computed(() => {
    const pts = this.xy();
    if (pts.length === 0) return [];
    const idx = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    return [...new Set(idx)].map((i, n, all) => ({
      x: pts[i].x,
      label: shortDate(pts[i].date),
      anchor: n === 0 ? 'start' : n === all.length - 1 ? 'end' : 'middle',
    }));
  });

  protected readonly activePoint = computed(() => {
    const i = this.active();
    return i === null ? null : (this.xy()[i] ?? null);
  });
  /** Clamp so the tooltip never runs off the chart's edges. */
  protected readonly tipLeft = computed(() => {
    const p = this.activePoint();
    if (!p) return 0;
    return Math.min(Math.max(p.x, 70), this.width() - 70);
  });

  protected onMove(event: PointerEvent): void {
    const pts = this.xy();
    if (pts.length === 0) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].x - x) < Math.abs(pts[best].x - x)) best = i;
    }
    this.active.set(best);
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.points().length;
    if (n === 0) return;
    const cur = this.active() ?? n - 1;
    if (event.key === 'ArrowLeft') this.active.set(Math.max(0, cur - 1));
    else if (event.key === 'ArrowRight') this.active.set(Math.min(n - 1, cur + 1));
    else if (event.key === 'Home') this.active.set(0);
    else if (event.key === 'End') this.active.set(n - 1);
    else if (event.key === 'Escape') this.active.set(null);
    else return;
    event.preventDefault();
  }

  protected longDate(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  }
}

/** 0 → 4; 7 → 8; 23 → 25; 130 → 150; 1700 → 2000. Gives axis labels that read as round numbers. */
function niceCeil(v: number): number {
  if (v <= 0) return 4;
  if (v <= 4) return 4;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}
function compactAxis(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
