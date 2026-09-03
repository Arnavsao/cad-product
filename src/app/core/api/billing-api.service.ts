import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import type { BillingStateDto, CheckoutResponse, CreateCheckoutRequest, PortalResponse } from './api.models';

/**
 * `/billing` — plan, checkout and the customer portal.
 *
 * Deliberately thin: there is no local "set plan" or "cancel" call because the
 * server exposes none. Both happen at Dodo Payments and come back as webhooks,
 * so the only writes here are "start a checkout", "open the portal" and
 * "re-read what Dodo says".
 */
@Injectable({ providedIn: 'root' })
export class BillingApiService {
  private readonly api = inject(HttpManagerService);

  /** Current plan and period. */
  state(): Promise<BillingStateDto> {
    return firstValueFrom(this.api.get<BillingStateDto>('billing'));
  }

  /**
   * Start a hosted checkout. The caller navigates to `checkoutUrl`.
   *
   * A full page navigation, not a popup: the URL is single-use and Dodo's page
   * owns the card fields, so keeping our tab alive behind a popup buys nothing
   * and popup blockers make it unreliable.
   */
  createCheckout(body: CreateCheckoutRequest): Promise<CheckoutResponse> {
    return firstValueFrom(this.api.post<CheckoutResponse>('billing/checkout', body));
  }

  /** Link to Dodo's hosted portal for card, invoices and cancellation. */
  createPortalSession(): Promise<PortalResponse> {
    return firstValueFrom(this.api.post<PortalResponse>('billing/portal', {}));
  }

  /**
   * Re-read the subscription from Dodo.
   *
   * Needed because the browser's return from checkout regularly beats the
   * webhook: without this the user lands back on the billing pane still
   * showing Free having just paid.
   */
  refresh(): Promise<BillingStateDto> {
    return firstValueFrom(this.api.post<BillingStateDto>('billing/refresh', {}));
  }
}
