import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SiteRevealDirective } from '../motion/reveal.directive';
import { SiteCtaComponent } from './cta.component';

/**
 * The closing band: a headline, one line of support, the CTA pair. Used at the
 * bottom of every public page so the ending is consistent and the copy per
 * page is the only thing that changes.
 */
@Component({
  selector: 'site-closing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SiteCtaComponent, SiteRevealDirective],
  // Keep the `title` input off the host element, or it shows as a tooltip.
  host: { '[attr.title]': 'null' },
  template: `
    <section class="close site-section" aria-labelledby="site-close-title">
      <div class="site-container">
        <div class="close__inner site-panel" siteReveal="scale">
          <h2 class="close__title" id="site-close-title">{{ title() }}</h2>
          <p class="close__sub">{{ sub() }}</p>
          <site-cta class="site-cta--center" [primaryLabel]="primaryLabel()" [secondaryLabel]="secondaryLabel()" [secondaryLink]="secondaryLink()" />
          <p class="close__fine">No install. No licence server. DXF export is free on every plan.</p>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .close__inner {
        position: relative;
        padding: clamp(40px, 7vw, 80px) clamp(20px, 5vw, 64px);
        text-align: center;
        overflow: hidden;
        background:
          radial-gradient(ellipse 70% 90% at 50% 120%, var(--ui-accent-tint), transparent 70%),
          color-mix(in srgb, var(--ui-surface) 84%, transparent);
      }
      .close__title {
        margin: 0;
        font-size: clamp(26px, 3.6vw, 44px);
        line-height: 1.08;
        font-weight: 700;
        letter-spacing: -.025em;
        color: var(--ui-text-strong);
        text-wrap: balance;
      }
      .close__sub {
        max-width: 56ch;
        margin: 14px auto 28px;
        font-size: var(--ui-text-base);
        line-height: 1.55;
        color: var(--ui-text-dim);
        text-wrap: pretty;
      }
      .close__fine { margin: 20px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
    `,
  ],
})
export class SiteClosingComponent {
  readonly title = input('Open a drawing in the next ten seconds.');
  readonly sub = input('It runs in the tab you already have open, on the machine you already have.');
  readonly primaryLabel = input('Create a free account');
  readonly secondaryLabel = input('See pricing');
  readonly secondaryLink = input<string | null>('/pricing');
}
