import { ChangeDetectionStrategy, Component, input, numberAttribute } from '@angular/core';
import { LOGO_TILE_PATHS, LOGO_VIEWBOX } from './logo.component';

/**
 * Full-page loading mark built from the logo's four tiles.
 *
 * The tiles fade in sequence — top-left, top-right, bottom-right, bottom-left —
 * so a single dwell travels clockwise around the mark. Nothing moves, scales or
 * changes hue: at the size this renders, motion reads as noise, and the logo
 * stays legible as itself the whole time. Opacity only, which also keeps it on
 * the compositor.
 *
 * The 2s loop is staggered a quarter-turn per tile, so exactly one tile peaks
 * every 500ms — slow enough to read as deliberate rather than busy.
 *
 * The same choreography is inlined in `src/index.html` for the pre-bootstrap
 * splash, which runs before any component can. Change one, change both.
 *
 * Reduced motion: the mark holds at a steady dim. The affordance is then the
 * label, not the animation.
 *
 * ```html
 * <ui-logo-loader />
 * <ui-logo-loader [size]="80" label="Loading drawing" />
 * ```
 */
@Component({
  selector: 'ui-logo-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ll" role="status" aria-live="polite" [attr.aria-label]="label() || 'Loading'">
      <svg
        class="ll__mark"
        [attr.viewBox]="viewBox"
        fill="currentColor"
        fill-rule="evenodd"
        aria-hidden="true"
        focusable="false"
      >
        @for (d of tiles; track $index) {
          <path class="ll__tile" [attr.d]="d" />
        }
      </svg>
      @if (label(); as text) {
        <span class="ll__label">{{ text }}</span>
      }
    </div>
  `,
  host: {
    class: 'ui-logo-loader',
    '[style.--ll-size]': 'size() + "px"',
  },
  styles: [
    `
      :host { display: inline-grid; place-items: center; }

      .ll {
        display: grid;
        justify-items: center;
        gap: calc(var(--ll-size) * .28);
      }

      .ll__mark {
        width: var(--ll-size);
        height: var(--ll-size);
        /* Accent here, not on the host, so the label keeps the page's text colour. */
        color: var(--ui-accent, var(--cad-accent, #4c9aff));
      }

      /* Source order is TL, TR, BL, BR; the delays run clockwise, evenly spaced
         a quarter-loop apart so the highlight travels at a constant rate and no
         two tiles ever peak together. */
      .ll__tile { animation: ll-dwell 2s ease-in-out infinite; }
      .ll__tile:nth-child(1) { animation-delay: 0s; }
      .ll__tile:nth-child(2) { animation-delay: .5s; }
      .ll__tile:nth-child(3) { animation-delay: 1.5s; }
      .ll__tile:nth-child(4) { animation-delay: 1s; }

      .ll__label {
        font: 500 11px/1 var(--ui-font, var(--cad-font, Inter, system-ui, sans-serif));
        letter-spacing: .14em;
        text-transform: uppercase;
        color: inherit;
        opacity: .55;
      }

      /* The floor is high and the peak is brief: the mark reads as the logo at
         all times, with one tile lifting out of it rather than three dropping
         away. A lower floor makes the whole thing flicker. */
      @keyframes ll-dwell {
        0%, 100% { opacity: .45; }
        20%      { opacity: 1; }
      }

      @media (prefers-reduced-motion: reduce) {
        .ll__tile { animation: none; opacity: .6; }
      }
    `,
  ],
})
export class UiLogoLoaderComponent {
  /** Edge of the mark in px. The label gap scales with it. */
  readonly size = input(72, { transform: numberAttribute });
  /** Optional caption under the mark. Also becomes the status label. */
  readonly label = input('');

  protected readonly viewBox = LOGO_VIEWBOX;
  protected readonly tiles = LOGO_TILE_PATHS;
}
