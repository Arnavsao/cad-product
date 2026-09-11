import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { SiteRevealDirective } from '../motion/reveal.directive';
import { SiteCtaComponent } from './cta.component';

/**
 * The closing band: a headline, one line of support, the CTA pair. Used at the
 * bottom of every public page so the ending is consistent and the copy per
 * page is the only thing that changes.
 *
 * Inputs are display strings: pass `[title]="t('…')"` from a template that
 * already has a `*transloco` scope. Unset inputs fall back to translated
 * defaults.
 */
@Component({
  selector: 'site-closing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SiteCtaComponent, SiteRevealDirective, TranslocoDirective],
  // Keep the `title` input off the host element, or it shows as a tooltip.
  host: { '[attr.title]': 'null' },
  template: `
    <section class="close site-section" aria-labelledby="site-close-title" *transloco="let t">
      <div class="site-container">
        <div class="close__inner site-panel" siteReveal="scale">
          <h2 class="close__title" id="site-close-title">{{ title() ?? t('site.components.closing.title') }}</h2>
          <p class="close__sub">{{ sub() ?? t('site.components.closing.sub') }}</p>
          <site-cta class="site-cta--center" [primaryLabel]="primaryLabel() ?? t('site.components.cta.createFreeAccount')" [secondaryLabel]="secondaryLabel() ?? t('site.components.cta.seePricing')" [secondaryLink]="secondaryLink()" />
          <p class="close__fine">{{ t('site.components.closing.fine') }}</p>
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
  readonly title = input<string | undefined>(undefined);
  readonly sub = input<string | undefined>(undefined);
  readonly primaryLabel = input<string | undefined>(undefined);
  readonly secondaryLabel = input<string | undefined>(undefined);
  readonly secondaryLink = input<string | null>('/pricing');
}
