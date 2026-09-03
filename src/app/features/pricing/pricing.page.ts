import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { BillingApiService } from '../../core/api/billing-api.service';
import { MeService } from '../../core/api/me.service';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { messageOf } from '../dashboard/data/drawings-list.store';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { COMPARISON, CURRENCY, FAQS, TIERS, type ComparisonRow, type PricingTier } from './pricing.data';

/**
 * `/pricing` — plans and what they include.
 *
 * Public and reachable signed out: this is a page people read *before* deciding
 * to sign up, so it must not sit behind the auth guard.
 *
 * The paid tiers start a real Dodo Payments checkout for signed-in visitors.
 * Signed-out ones are sent to sign-up first: a subscription has to attach to an
 * account, so there is no useful anonymous checkout.
 *
 * The prices in `pricing.data.ts` are display only — the amount actually
 * charged is whatever the Dodo product is configured for. Keeping them in step
 * is a dashboard discipline, not something this page can enforce, which is why
 * `DODO_PRODUCT_*` ids are per-tier rather than derived from these numbers.
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
  private readonly billing = inject(BillingApiService);
  private readonly me = inject(MeService);
  private readonly notify = inject(NotificationService);

  protected readonly tiers = TIERS;
  protected readonly comparison = COMPARISON;
  protected readonly faqs = FAQS;
  protected readonly currency = CURRENCY;
  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();

  /** Annual is the default because it is the cheaper, and the one we recommend. */
  protected readonly annual = signal(true);

  /** Tier whose checkout is being created, so only that button spins. */
  protected readonly buying = signal<PricingTier['id'] | null>(null);

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
    if (!this.signedIn()) return tier.cta;
    // Signed in and already on this tier — nothing to buy.
    if (this.me.plan() === tier.id) return 'Current plan';
    if (tier.id === 'free') return 'Go to dashboard';
    return tier.cta;
  }

  /**
   * The plan to check out for this tier, or null when the CTA should stay a
   * plain link (Free, signed out, or already on this plan).
   */
  protected checkoutFor(tier: PricingTier): 'pro' | 'team' | null {
    if (!this.signedIn() || tier.id === 'free') return null;
    if (this.me.plan() === tier.id) return null;
    return tier.id;
  }

  /**
   * Create a checkout session and hand the browser to Dodo.
   *
   * `location.assign`, not the router: the URL is on Dodo's domain. The spinner
   * is deliberately never cleared on success — the page is navigating away, and
   * clearing it would flash the button back to normal first.
   */
  protected async startCheckout(plan: 'pro' | 'team'): Promise<void> {
    if (this.buying()) return;
    this.buying.set(plan);
    try {
      const { checkoutUrl } = await this.billing.createCheckout({
        plan,
        interval: this.annual() ? 'annual' : 'monthly',
      });
      location.assign(checkoutUrl);
    } catch (e) {
      this.buying.set(null);
      this.notify.error(messageOf(e));
    }
  }

  protected cell(row: ComparisonRow, tier: PricingTier['id']): string | boolean {
    return row[tier];
  }
}
