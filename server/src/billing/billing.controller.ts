import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import {
  CreateCheckoutDto,
  type BillingStateDto,
  type CheckoutResponseDto,
  type PortalResponseDto,
} from './dto/billing.dto';

/**
 * `/billing` — the signed-in user's plan, checkout and portal links.
 *
 * Everything here is authenticated by the global guard. Note what is *absent*:
 * there is no endpoint to set a plan, cancel, or change price. Those all happen
 * in Dodo (through checkout or the customer portal) and reach us as webhooks.
 * Exposing a local mutation would create a second authority over what someone
 * has paid for, and the two would eventually disagree.
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * `GET /billing` → current plan and period.
   *
   * Also available inside `GET /me`; this exists for the billing settings pane
   * to re-read after returning from checkout without refetching all of `/me`.
   */
  @Get()
  state(@CurrentUser('id') userId: string): Promise<BillingStateDto> {
    return this.billing.stateFor(userId);
  }

  /**
   * `POST /billing/checkout` → `{ checkoutUrl }` to redirect the browser to.
   *
   * Rate-limited well below the global budget: each call creates a customer
   * and/or a session upstream, so this is the one endpoint here that costs us
   * something per request. A human buying a plan needs a handful of attempts,
   * not sixty.
   */
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createCheckout(@CurrentUser('id') userId: string, @Body() dto: CreateCheckoutDto): Promise<CheckoutResponseDto> {
    // Annual is the default, matching the pricing page's default toggle.
    return this.billing.createCheckout(userId, dto.plan, dto.interval ?? 'annual');
  }

  /** `POST /billing/portal` → `{ portalUrl }` for Dodo's hosted portal. */
  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createPortal(@CurrentUser('id') userId: string): Promise<PortalResponseDto> {
    return this.billing.createPortalSession(userId);
  }

  /**
   * `POST /billing/refresh` → re-read the subscription from Dodo.
   *
   * The recovery path for a webhook that never arrived, and what the settings
   * pane calls when the browser comes back from checkout: the `return_url`
   * redirect frequently beats the webhook, so without this the user would land
   * on their billing page still showing Free having just paid.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@CurrentUser('id') userId: string): Promise<BillingStateDto> {
    return this.billing.reconcile(userId);
  }
}
