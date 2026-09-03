import DodoPayments from 'dodopayments';

/**
 * The slice of the Dodo Payments SDK this module uses.
 *
 * Declared as an interface rather than using the SDK type directly so specs can
 * provide a small fake instead of stubbing a client with thirty resources on it.
 * The shape is intentionally minimal: adding a method here should be a
 * deliberate decision about widening our dependency on their API.
 */
export interface DodoClient {
  checkoutSessions: {
    create(body: CheckoutSessionCreateParams): Promise<CheckoutSessionResponse>;
  };
  customers: {
    create(body: { email: string; name: string }): Promise<{ customer_id: string }>;
    customerPortal: {
      create(customerId: string, query?: { send_email?: boolean }): Promise<{ link: string }>;
    };
  };
  subscriptions: {
    retrieve(subscriptionId: string): Promise<DodoSubscription>;
  };
  webhooks: {
    unwrap(body: string, options: { headers: Record<string, string | undefined> }): unknown;
  };
}

/**
 * Request body for `POST /checkouts`.
 *
 * Only the fields we send are modelled. `return_url` is where Dodo sends the
 * browser after payment, with `?status=` and either `payment_id` or
 * `subscription_id` appended.
 */
export interface CheckoutSessionCreateParams {
  product_cart: Array<{ product_id: string; quantity: number }>;
  customer?: { customer_id: string } | { email: string; name?: string };
  return_url?: string;
  /**
   * Echoed back verbatim on every webhook for the resulting payment or
   * subscription. We put our own `userId` here so a webhook can be attributed
   * to an account even if the Dodo customer record was created out of band.
   */
  metadata?: Record<string, string>;
  subscription_data?: { trial_period_days?: number };
}

export interface CheckoutSessionResponse {
  session_id: string;
  /** Null when the session was confirmed server-side; we never do that. */
  checkout_url?: string | null;
}

/** The subscription fields we read when reconciling against Dodo. */
export interface DodoSubscription {
  subscription_id: string;
  customer?: { customer_id?: string } | null;
  product_id?: string | null;
  status?: string | null;
  next_billing_date?: string | null;
  previous_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean | null;
  trial_period_days?: number | null;
  metadata?: Record<string, string> | null;
}

/**
 * Builds a real SDK client.
 *
 * Mode is inferred from the key prefix rather than being its own env var. A
 * separate `DODO_MODE` could disagree with the key — pointing a live key at the
 * test host, or worse a test key at the live host — and there is no way to
 * detect that mistake before a customer hits it. The key already carries the
 * answer, so it is the only input.
 */
export function createDodoClient(apiKey: string, webhookKey?: string): DodoClient {
  const environment = apiKey.startsWith('sk_test') ? 'test_mode' : 'live_mode';
  return new DodoPayments({
    bearerToken: apiKey,
    webhookKey,
    environment,
  }) as unknown as DodoClient;
}

/** Which Dodo host a key targets. Logged at boot so the mode is never a guess. */
export function modeOf(apiKey: string): 'test' | 'live' {
  return apiKey.startsWith('sk_test') ? 'test' : 'live';
}
