import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The drafting-paper grid behind the public pages.
 *
 * Extends the auth rail's technique (`auth-layout.component.ts`): gridlines are
 * repeating `linear-gradient`s and the fade is a `radial-gradient` mask, so the
 * whole backdrop is one element with no image request and nothing to lazy-load.
 *
 * Two things it adds over the auth rail:
 *  - **Two scales**, a fine cell inside a heavier major cell, which is what
 *    makes it read as a CAD grid rather than as graph paper.
 *  - **Density per breakpoint**, like zoom levels in the editor: the cell grows
 *    on a phone so the lines stay distinguishable instead of turning into a
 *    grey wash.
 *
 * It drifts on scroll through a `scroll()` timeline rather than a listener --
 * no JS, and the transform stays on the compositor. The layer is inset past its
 * own edges so the drift cannot expose a gap.
 */
@Component({
  selector: 'ui-grid-backdrop',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div class="gb__layer"></div>',
  host: {
    class: 'ui-grid-backdrop',
    'aria-hidden': 'true',
  },
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        /* Sits behind content without needing a stacking context per page. */
        z-index: 0;
      }

      .gb__layer {
        position: absolute;
        /* Overscan: the drift moves this up, and a flush edge would show. */
        inset: -18% 0;
        background-image:
          linear-gradient(to right, var(--ui-border) 1px, transparent 1px),
          linear-gradient(to bottom, var(--ui-border) 1px, transparent 1px),
          linear-gradient(to right, color-mix(in srgb, var(--ui-border) 42%, transparent) 1px, transparent 1px),
          linear-gradient(to bottom, color-mix(in srgb, var(--ui-border) 42%, transparent) 1px, transparent 1px);
        background-size: 140px 140px, 140px 140px, 28px 28px, 28px 28px;
        background-position: -1px -1px;
        mask-image: radial-gradient(
          ellipse var(--ui-grid-reach, 78% 62%) at var(--ui-grid-origin, 50% 12%),
          #000 0%,
          rgba(0, 0, 0, .5) 46%,
          transparent 84%
        );
      }

      @supports (animation-timeline: scroll()) {
        .gb__layer {
          animation: ui-grid-drift linear both;
          animation-timeline: scroll(root block);
        }
      }

      @keyframes ui-grid-drift {
        to { transform: translate3d(0, -7%, 0); }
      }

      /* Zoom levels: fewer, larger cells as the viewport narrows. */
      @media (max-width: 900px) {
        .gb__layer { background-size: 120px 120px, 120px 120px, 24px 24px, 24px 24px; }
      }

      @media (max-width: 560px) {
        .gb__layer { background-size: 100px 100px, 100px 100px, 20px 20px, 20px 20px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .gb__layer { animation: none; transform: none; }
      }
    `,
  ],
})
export class UiGridBackdropComponent {}
