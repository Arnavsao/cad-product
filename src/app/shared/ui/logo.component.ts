import { ChangeDetectionStrategy, Component, input, numberAttribute } from '@angular/core';

/**
 * The CADOnline mark: four rounded tiles in a 2×2 grid, each with a square
 * cut-out. The geometry is the brand SVG (`public/cad-logo-svg.svg`) normalised
 * to a 100-unit box, so the same four paths serve the 13px editor header, the
 * 28px brand chips, the favicon and the loading animation — which needs each
 * tile as its own element so it can move independently.
 *
 * Filled with `currentColor` rather than the source's hard-coded white, so the
 * mark takes the colour of whatever chip it sits on (`--ui-on-accent` on an
 * accent square) and needs no per-theme variant.
 */
export const LOGO_VIEWBOX = '0 0 100 100';

// Tile edge, gap, corner radius and cut-out inset, in viewBox units. Measured
// from the source: 382px tiles with an 81px gap, 70px corner radii and a 150px
// stroke — i.e. a 75px inset to a hole whose corners come out square, because
// the stroke is wider than twice the radius.
const TILE = 45.2;
const GAP = 9.6;
const RADIUS = 8.3;
const INSET = 8.9;
const EDGE = 28.6; // TILE - 2 * RADIUS
const HOLE = 27.4; // TILE - 2 * INSET

/** Keep path numbers short: `54.8 + 8.3` is `63.099999…` in floating point. */
const n = (v: number): number => Number(v.toFixed(1));

function tile(x: number, y: number): string {
  const r = RADIUS;
  return (
    `M${n(x + r)} ${y}h${EDGE}a${r} ${r} 0 0 1 ${r} ${r}v${EDGE}a${r} ${r} 0 0 1 -${r} ${r}` +
    `h-${EDGE}a${r} ${r} 0 0 1 -${r} -${r}v-${EDGE}a${r} ${r} 0 0 1 ${r} -${r}Z` +
    `M${n(x + INSET)} ${n(y + INSET)}h${HOLE}v${HOLE}h-${HOLE}Z`
  );
}

const OFFSET = n(TILE + GAP);

/** Top-left, top-right, bottom-left, bottom-right. Render with `fill-rule="evenodd"`. */
export const LOGO_TILE_PATHS: readonly string[] = [
  tile(0, 0),
  tile(OFFSET, 0),
  tile(0, OFFSET),
  tile(OFFSET, OFFSET),
];

/**
 * ```html
 * <ui-logo />              16px, inherits color
 * <ui-logo [size]="28" />
 * ```
 * Decorative (`aria-hidden`); label the surrounding link or button.
 */
@Component({
  selector: 'ui-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      fill="currentColor"
      fill-rule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      @for (d of tiles; track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
  host: {
    class: 'ui-logo',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  styles: [
    `
      :host { display: inline-flex; flex: 0 0 auto; line-height: 0; vertical-align: middle; color: inherit; }
    `,
  ],
})
export class UiLogoComponent {
  readonly size = input(16, { transform: numberAttribute });

  protected readonly viewBox = LOGO_VIEWBOX;
  protected readonly tiles = LOGO_TILE_PATHS;
}
