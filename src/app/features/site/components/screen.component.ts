import { ChangeDetectionStrategy, Component, input, model, signal } from '@angular/core';

/** A callout pinned to a point on the screenshot, in percentages of its box. */
export interface ScreenHotspot {
  id: string;
  x: number;
  y: number;
  label: string;
  detail: string;
}

/**
 * A real editor screenshot in a window frame, optionally with hotspots.
 *
 * The frame is what makes a screenshot read as "the software" rather than as
 * an illustration: title bar, traffic lights, the drawing's file name. The
 * image reserves its aspect ratio so nothing shifts when it loads, and it is
 * lazy unless `eager` is set (the hero is the one place that should be).
 *
 * Hotspots are buttons: keyboard users can reach them, and the parent can bind
 * `[(active)]` to drive them from a list of parts beside the picture.
 */
@Component({
  selector: 'site-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="scr">
      <div class="scr__bar" aria-hidden="true">
        <span class="scr__dots"><i></i><i></i><i></i></span>
        <span class="scr__title">{{ title() }}</span>
        <span class="scr__spacer"></span>
      </div>
      <div class="scr__stage" [style.aspect-ratio]="ratio()">
        <img
          class="scr__img"
          [src]="src()"
          [alt]="alt()"
          [attr.loading]="eager() ? 'eager' : 'lazy'"
          [attr.fetchpriority]="eager() ? 'high' : null"
          decoding="async"
        />
        @for (spot of hotspots(); track spot.id) {
          <button
            type="button"
            class="scr__spot"
            [class.scr__spot--on]="active() === spot.id"
            [style.left.%]="spot.x"
            [style.top.%]="spot.y"
            [attr.aria-label]="spot.label"
            [attr.aria-pressed]="active() === spot.id"
            (click)="active.set(active() === spot.id ? null : spot.id)"
            (mouseenter)="hover.set(spot.id)"
            (mouseleave)="hover.set(null)"
            (focus)="hover.set(spot.id)"
            (blur)="hover.set(null)"
          >
            <span class="scr__ring"></span>
          </button>
          @if ((active() === spot.id || hover() === spot.id)) {
            <div class="scr__tip" role="status" [style.left.%]="spot.x" [style.top.%]="spot.y" [class.scr__tip--left]="spot.x > 60" [class.scr__tip--up]="spot.y > 70">
              <strong>{{ spot.label }}</strong>
              <span>{{ spot.detail }}</span>
            </div>
          }
        }
      </div>
      @if (caption()) { <figcaption class="scr__cap">{{ caption() }}</figcaption> }
    </figure>
  `,
  host: { class: 'site-screen' },
  styles: [
    `
      :host { display: block; }
      .scr {
        margin: 0;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-xl);
        background: var(--ui-surface-raised);
        box-shadow: var(--ui-shadow-float);
        overflow: hidden;
      }
      .scr__bar {
        display: flex;
        align-items: center;
        gap: 12px;
        height: 34px;
        padding: 0 12px;
        border-bottom: 1px solid var(--ui-border);
        background: color-mix(in srgb, var(--ui-surface-raised) 80%, var(--ui-bg));
      }
      .scr__dots { display: inline-flex; gap: 6px; }
      .scr__dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--ui-border-strong); opacity: .55; }
      .scr__title {
        flex: 1;
        text-align: center;
        font: 500 var(--ui-text-xs) / 1 var(--ui-font-mono);
        letter-spacing: .02em;
        color: var(--ui-text-dim);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .scr__spacer { width: 42px; }
      .scr__stage { position: relative; background: var(--ui-bg); }
      .scr__img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }

      .scr__spot {
        position: absolute;
        width: 28px;
        height: 28px;
        margin: -14px 0 0 -14px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        cursor: pointer;
      }
      .scr__spot:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .scr__ring {
        position: absolute;
        inset: 6px;
        border-radius: 50%;
        background: var(--ui-accent);
        box-shadow: 0 0 0 4px var(--ui-accent-glow);
        transition: transform var(--ui-dur) var(--ui-ease-out);
      }
      .scr__ring::after {
        content: '';
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        border: 1.5px solid var(--ui-accent);
        opacity: .7;
        animation: scr-pulse 2.2s var(--ui-ease-out) infinite;
      }
      .scr__spot--on .scr__ring { transform: scale(1.2); }
      .scr__spot--on .scr__ring::after { animation: none; opacity: 1; }
      @keyframes scr-pulse { 0% { transform: scale(.7); opacity: .8; } 100% { transform: scale(1.5); opacity: 0; } }

      .scr__tip {
        position: absolute;
        z-index: 2;
        display: grid;
        gap: 3px;
        width: max-content;
        max-width: 240px;
        margin: 18px 0 0 18px;
        padding: 10px 12px;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-lg);
        background: var(--ui-surface);
        box-shadow: var(--ui-shadow-float);
        font-size: var(--ui-text-sm);
        line-height: 1.4;
        color: var(--ui-text-dim);
        pointer-events: none;
        animation: ui-pop-in var(--ui-dur) var(--ui-ease);
      }
      .scr__tip strong { color: var(--ui-text-strong); font-weight: 600; }
      .scr__tip--left { transform: translateX(-100%); margin-left: -18px; }
      .scr__tip--up { transform: translateY(-100%); margin-top: -18px; }
      .scr__tip--left.scr__tip--up { transform: translate(-100%, -100%); }

      .scr__cap {
        padding: 10px 14px;
        border-top: 1px solid var(--ui-border);
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
        text-align: center;
      }
      @media (prefers-reduced-motion: reduce) { .scr__ring::after { animation: none; } .scr__tip { animation: none; } }
    `,
  ],
})
export class SiteScreenComponent {
  readonly src = input.required<string>();
  readonly alt = input.required<string>();
  readonly title = input('CADO');
  readonly caption = input('');
  /** Width / height, as a CSS aspect-ratio value. */
  readonly ratio = input('16 / 10');
  readonly eager = input(false);
  readonly hotspots = input<readonly ScreenHotspot[]>([]);
  readonly active = model<string | null>(null);
  protected readonly hover = signal<string | null>(null);
}
