import { ChangeDetectionStrategy, Component, input, numberAttribute } from '@angular/core';
import { LOGO_TILE_PATHS, LOGO_VIEWBOX } from './logo.component';

/**
 * Full-page loading mark built from the logo's four tiles.
 *
 * Choreography (one 2.8s loop, four beats): the whole mark snaps through a
 * quarter turn on every beat with an overshooting ease, and mid-turn each tile
 * flies outward along its own diagonal, shrinks and spins before snapping back
 * into the grid. Underneath, the mark drifts through the hue wheel behind a
 * glow, and a ring pulses out from behind it on every beat. Everything is
 * `transform`/`opacity`/`filter`, so it stays on the compositor.
 *
 * The same choreography is inlined in `src/index.html` for the pre-bootstrap
 * splash, which runs before any component can. Change one, change both.
 *
 * Reduced motion: the tiles hold their grid and breathe in opacity; the ring is
 * dropped. The affordance stays, the motion goes.
 *
 * ```html
 * <ui-logo-loader />
 * <ui-logo-loader [size]="80" label="Loading drawing…" />
 * ```
 */
@Component({
  selector: 'ui-logo-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ll" role="status" aria-live="polite" [attr.aria-label]="label() || 'Loading'">
      <div class="ll__stage">
        <span class="ll__ring" aria-hidden="true"></span>
        <span class="ll__ring ll__ring--late" aria-hidden="true"></span>
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
      </div>
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
        gap: calc(var(--ll-size) * .3);
      }

      /* The accent lives here, not on the host, so the label keeps the page's
         text colour while the mark and rings take the brand colour. */
      .ll__stage {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--ll-size);
        height: var(--ll-size);
        color: var(--ui-accent, var(--cad-accent, #4c9aff));
      }

      .ll__mark {
        width: 100%;
        height: 100%;
        overflow: visible;
        transform-origin: 50% 50%;
        filter: drop-shadow(0 0 calc(var(--ll-size) * .14) color-mix(in srgb, currentColor 60%, transparent));
        animation:
          ll-orbit 2.8s cubic-bezier(.68, -.55, .27, 1.55) infinite,
          ll-hue 7s linear infinite;
      }

      /* Each tile scatters along its own diagonal: --dx/--dy are the signs. */
      .ll__tile {
        transform-box: fill-box;
        transform-origin: center;
        animation: ll-scatter 2.8s cubic-bezier(.2, .8, .2, 1) infinite;
      }
      .ll__tile:nth-child(1) { --dx: -1; --dy: -1; }
      .ll__tile:nth-child(2) { --dx:  1; --dy: -1; }
      .ll__tile:nth-child(3) { --dx: -1; --dy:  1; }
      .ll__tile:nth-child(4) { --dx:  1; --dy:  1; }

      .ll__ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 2px solid currentColor;
        opacity: 0;
        animation: ll-pulse 1.4s cubic-bezier(.2, .6, .3, 1) infinite;
      }
      .ll__ring--late { animation-delay: .7s; }

      .ll__label {
        font: 500 12px/1 var(--ui-font, var(--cad-font, Inter, system-ui, sans-serif));
        letter-spacing: .12em;
        text-transform: uppercase;
        color: inherit;
        opacity: .7;
        animation: ll-blink 1.4s ease-in-out infinite;
      }

      /* Four beats: turn, hold, turn, hold… The mark swells mid-turn while the
         tiles shrink, so the silhouette breathes instead of just spinning. */
      @keyframes ll-orbit {
        0%   { transform: rotate(0deg)   scale(1); }
        9%   { transform: rotate(45deg)  scale(1.16); }
        18%  { transform: rotate(90deg)  scale(1); }
        25%  { transform: rotate(90deg)  scale(1); }
        34%  { transform: rotate(135deg) scale(1.16); }
        43%  { transform: rotate(180deg) scale(1); }
        50%  { transform: rotate(180deg) scale(1); }
        59%  { transform: rotate(225deg) scale(1.16); }
        68%  { transform: rotate(270deg) scale(1); }
        75%  { transform: rotate(270deg) scale(1); }
        84%  { transform: rotate(315deg) scale(1.16); }
        93%  { transform: rotate(360deg) scale(1); }
        100% { transform: rotate(360deg) scale(1); }
      }

      @keyframes ll-scatter {
        0%, 18%, 25%, 43%, 50%, 68%, 75%, 93%, 100% {
          transform: translate(0, 0) rotate(0deg) scale(1);
        }
        9%, 34%, 59%, 84% {
          transform:
            translate(calc(var(--dx) * 17px), calc(var(--dy) * 17px))
            rotate(calc(var(--dx) * var(--dy) * 180deg))
            scale(.5);
        }
      }

      @keyframes ll-hue {
        0%   { filter: drop-shadow(0 0 calc(var(--ll-size) * .14) color-mix(in srgb, currentColor 60%, transparent)) hue-rotate(0deg); }
        100% { filter: drop-shadow(0 0 calc(var(--ll-size) * .14) color-mix(in srgb, currentColor 60%, transparent)) hue-rotate(360deg); }
      }

      @keyframes ll-pulse {
        0%   { transform: scale(.55); opacity: .55; }
        100% { transform: scale(1.75); opacity: 0; }
      }

      @keyframes ll-blink {
        0%, 100% { opacity: .45; }
        50%      { opacity: .85; }
      }

      @keyframes ll-breathe {
        0%, 100% { opacity: .55; }
        50%      { opacity: 1; }
      }

      @media (prefers-reduced-motion: reduce) {
        .ll__mark { animation: ll-breathe 2s ease-in-out infinite; filter: none; }
        .ll__tile, .ll__label { animation: none; }
        .ll__ring { display: none; }
      }
    `,
  ],
})
export class UiLogoLoaderComponent {
  /** Edge of the mark in px. The rings and label scale with it. */
  readonly size = input(72, { transform: numberAttribute });
  /** Optional caption under the mark. Also becomes the status label. */
  readonly label = input('');

  protected readonly viewBox = LOGO_VIEWBOX;
  protected readonly tiles = LOGO_TILE_PATHS;
}
