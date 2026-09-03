import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { COMPARISON, CURRENCY, FAQS, TIERS, type ComparisonRow, type PricingTier } from './pricing.data';

/**
 * `/pricing` — plans and what they include.
 *
 * Public and reachable signed out: this is a page people read *before* deciding
 * to sign up, so it must not sit behind the auth guard.
 *
 * **Presentational only.** There is no payment provider wired up, so every CTA
 * routes to sign-up rather than a checkout. The prices in `pricing.data.ts` are
 * placeholders for the product owner to set.
 */
@Component({
  selector: 'app-pricing-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiIconComponent],
  templateUrl: './pricing.page.html',
  styleUrl: './pricing.page.scss',
})
export class PricingPage {
  private readonly auth = inject(SupabaseAuthService);

  protected readonly tiers = TIERS;
  protected readonly comparison = COMPARISON;
  protected readonly faqs = FAQS;
  protected readonly currency = CURRENCY;
  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();

  /** Annual is the default because it is the cheaper, and the one we recommend. */
  protected readonly annual = signal(true);

  protected readonly signedIn = computed(() => this.auth.isSignedIn());
  protected readonly homeLink = computed(() => (this.auth.isSignedIn() ? '/dashboard' : '/'));

  /** Signed-in visitors have nothing to sign up for; send them to the app. */
  protected readonly ctaLink = computed(() => (this.auth.isSignedIn() ? '/dashboard' : '/sign-up'));

  protected priceOf(tier: PricingTier): number {
    return this.annual() ? tier.annual : tier.monthly;
  }

  protected savingOf(tier: PricingTier): number {
    if (!tier.monthly) return 0;
    return Math.round((1 - tier.annual / tier.monthly) * 100);
  }

  protected ctaFor(tier: PricingTier): string {
    return this.signedIn() ? 'Go to dashboard' : tier.cta;
  }

  protected cell(row: ComparisonRow, tier: PricingTier['id']): string | boolean {
    return row[tier];
  }
}
