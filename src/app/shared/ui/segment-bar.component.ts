import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Semantic tone of one segment. The three `accent*` steps are one hue at
 * three lightnesses, for ordinal breakdowns (Free < Pro < Team); the status
 * tones are reserved for state and never reused as "another series".
 */
export type UiSegmentTone = 'accent' | 'accent-mid' | 'accent-soft' | 'success' | 'warning' | 'danger' | 'neutral';

export interface UiSegment {
  label: string;
  value: number;
  tone: UiSegmentTone;
}

/**
 * A part-to-whole breakdown as one horizontal bar with a legend.
 *
 * Segments are separated by a 2px gap of the surface colour so adjacent fills
 * never touch, each is its own hover target with a native tooltip, and the
 * legend keys every segment by a short stroke plus its label and value — so
 * identity is never carried by colour alone, and a reader who cannot tell two
 * tones apart still gets the numbers. Values wear text ink, not segment ink.
 */
@Component({
  selector: 'ui-segment-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sb">
      @if (total() > 0) {
        <div class="sb__bar" role="img" [attr.aria-label]="ariaLabel()">
          @for (s of visible(); track s.label) {
            <div
              class="sb__seg"
              [class]="'sb__seg sb__seg--' + s.tone"
              [style.flex-grow]="s.value"
              [title]="s.label + ': ' + s.value.toLocaleString()"
            ></div>
          }
        </div>
      } @else {
        <div class="sb__bar sb__bar--empty" aria-hidden="true"></div>
      }
      <ul class="sb__legend">
        @for (s of segments(); track s.label) {
          <li class="sb__key">
            <span class="sb__swatch" [class]="'sb__swatch sb__swatch--' + s.tone" aria-hidden="true"></span>
            <span class="sb__key-label">{{ s.label }}</span>
            <span class="sb__key-value">{{ s.value.toLocaleString() }}</span>
            @if (total() > 0) {
              <span class="sb__key-pct">{{ pct(s.value) }}</span>
            }
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      .sb { display: grid; gap: var(--ui-space-3); }
      .sb__bar {
        display: flex; gap: 2px; height: 10px; border-radius: var(--ui-radius-full); overflow: hidden;
        background: var(--ui-surface);
      }
      .sb__bar--empty { background: var(--ui-hover); }
      .sb__seg { flex: 0 1 0; min-width: 3px; transition: filter var(--ui-dur-fast); }
      .sb__seg:hover { filter: brightness(1.15); }
      .sb__seg--accent, .sb__swatch--accent { background: var(--ui-accent); }
      .sb__seg--accent-mid, .sb__swatch--accent-mid { background: color-mix(in srgb, var(--ui-accent) 62%, var(--ui-surface)); }
      .sb__seg--accent-soft, .sb__swatch--accent-soft { background: color-mix(in srgb, var(--ui-accent) 32%, var(--ui-surface)); }
      .sb__seg--success, .sb__swatch--success { background: var(--ui-success); }
      .sb__seg--warning, .sb__swatch--warning { background: var(--ui-warning); }
      .sb__seg--danger, .sb__swatch--danger { background: var(--ui-danger); }
      .sb__seg--neutral, .sb__swatch--neutral { background: var(--ui-border-strong); }
      .sb__legend {
        list-style: none; margin: 0; padding: 0;
        display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px var(--ui-space-4);
      }
      .sb__key { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--ui-text-sm); }
      .sb__swatch { flex: 0 0 auto; width: 12px; height: 3px; border-radius: 2px; }
      .sb__key-label { flex: 1 1 auto; min-width: 0; color: var(--ui-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sb__key-value { color: var(--ui-text-strong); font-weight: 600; font-variant-numeric: tabular-nums; }
      .sb__key-pct { width: 3.2em; text-align: right; color: var(--ui-text-dim); font-variant-numeric: tabular-nums; font-size: var(--ui-text-xs); }
    `,
  ],
})
export class UiSegmentBarComponent {
  readonly segments = input.required<readonly UiSegment[]>();
  /** What the whole is, for the accessible name: "Feedback by status". */
  readonly label = input.required<string>();

  protected readonly total = computed(() => this.segments().reduce((s, x) => s + x.value, 0));
  protected readonly visible = computed(() => this.segments().filter((s) => s.value > 0));
  protected readonly ariaLabel = computed(
    () => `${this.label()}: ` + this.segments().map((s) => `${s.label} ${s.value}`).join(', '),
  );

  protected pct(value: number): string {
    const t = this.total();
    return t ? `${Math.round((value / t) * 100)}%` : '';
  }
}
