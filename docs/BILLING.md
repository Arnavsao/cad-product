# Billing (Dodo Payments)

CADOnline sells the Pro and Team tiers as subscriptions through
[Dodo Payments](https://dodopayments.com). This document is what you need to go
from the code as shipped to a working checkout.

## Current state

Everything is implemented and tested **except the keys**, which are yours to
add. With no keys configured:

- `GET /billing` reports the Free plan, so `/me` and the dashboard work normally.
- `POST /billing/checkout` and `/billing/portal` answer `503 BILLING_NOT_CONFIGURED`.
- `POST /billing/webhook` **rejects every delivery**. This fails closed on
  purpose: an unauthenticated route that changes what someone has paid for must
  never accept an unverified body.

The pricing page's paid CTAs only become checkout buttons for a signed-in user;
signed-out visitors still go to sign-up, because a subscription needs an account
to attach to.

## What this does and does not track

It records **which plan an account is entitled to**. It does not yet enforce
anything — the Free tier's advertised limits (3 drawings, 50 MB) are not applied.
`BillingService.effectivePlan()` is the single place to read when you add
enforcement; do not read `subscription.plan` directly, because a cancelled Pro
subscription still has `plan = PRO` as the record of what was bought.

## Setup

### 1. Create the products

In the Dodo dashboard, create **four** subscription products — monthly and
annual for each of Pro and Team. Monthly and annual are separate products in
Dodo, not two prices on one product.

The prices in `src/app/features/pricing/pricing.data.ts` are **display only**.
The amount actually charged is whatever the Dodo product says. Nothing in the
code can reconcile the two, so changing a price means changing it in both
places.

### 2. Configure the API

In `server/.env`:

```bash
DODO_API_KEY=sk_test_...          # Developer -> API keys
DODO_WEBHOOK_KEY=whsec_...        # Developer -> Webhooks -> your endpoint -> Overview
DODO_PRODUCT_PRO_MONTHLY=pdt_...
DODO_PRODUCT_PRO_ANNUAL=pdt_...
DODO_PRODUCT_TEAM_MONTHLY=pdt_...
DODO_PRODUCT_TEAM_ANNUAL=pdt_...
```

**Test vs live is inferred from the key prefix.** `sk_test_…` targets
`test.dodopayments.com`, anything else targets `live.dodopayments.com`. There is
deliberately no separate mode flag: it could contradict the key, and a test key
pointed at the live host is a mistake nobody notices until a real customer hits
it.

A tier with no product ids is simply unavailable — launching Pro before Team
exists is a supported configuration, not a broken one.

On boot the API logs which mode it is in and which tiers are sellable:

```
[BillingModule] Billing enabled against Dodo Payments (test mode)
[BillingCatalog] Billing catalog: pro:annual, pro:monthly
```

### 3. Configure the webhook

Point a Dodo webhook endpoint at:

```
https://<your-host>/api/v1/billing/webhook
```

Subscribe at minimum to the subscription lifecycle:

`subscription.active` · `subscription.renewed` · `subscription.on_hold` ·
`subscription.failed` · `subscription.cancelled` · `subscription.plan_changed`

Other event families (payments, refunds, disputes, licence keys) are **recorded
but not acted on**. Adding a handler later needs no backfill — the history is
already in `webhook_events`.

For local development, Dodo cannot reach `localhost`. Use a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

and point the endpoint at `https://<tunnel-host>/api/v1/billing/webhook`.

> **If `DODO_API_KEY` is set but `DODO_WEBHOOK_KEY` is not**, the API logs a
> warning at boot. That combination is the worst failure mode in the module:
> checkout succeeds, every webhook is rejected, and the customer pays without
> ever getting their plan.

## How it fits together

```
Pricing page  ──POST /billing/checkout──▶  API ──▶ Dodo: create customer + session
      │                                                      │
      └──────────── redirect to checkout_url ────────────────┘
                                                             │
                          customer pays on Dodo's page  ─────┤
                                                             │
   return_url: /dashboard/settings/billing  ◀────────────────┤
                                                             │
   POST /billing/webhook  ◀── subscription.active ───────────┘
        │
        └─▶ verify signature ─▶ dedupe on webhook-id ─▶ upsert subscriptions
```

**Dodo is the source of truth; the `subscriptions` table is a projection.**
Nothing in this codebase decides that someone is paid up — it records what Dodo
reported. That is why there is no local cancel endpoint: cancellation happens in
the customer portal and arrives as a webhook. Any other design has two
authorities over the same fact, and the one the customer's card follows is
theirs.

### The race you will actually hit

The browser's return from checkout regularly **beats the webhook**. Without a
fix the user lands on their billing page still showing Free, having just paid.
`POST /billing/refresh` re-reads the subscription from Dodo directly; the
Settings pane exposes it as a **Refresh** button. It is also the recovery path
for a webhook that was missed entirely (all 8 delivery attempts exhausted, or
the endpoint misconfigured for a while).

### Webhook safety properties

| Property | How |
| --- | --- |
| Fails closed | No `DODO_WEBHOOK_KEY` → every delivery rejected with 503. |
| Signature verified | Standard Webhooks HMAC over `{id}.{timestamp}.{body}`, before anything is written. |
| Verified against raw bytes | `app.setup.ts` mounts `express.raw()` for this path — `express.json()` re-serialising the body would break the signature. |
| Idempotent | `webhook-id` is the primary key of `webhook_events`; the insert *is* the dedupe. Dodo retries up to 8 times over ~18 hours. |
| Retries on failure | A handler error returns 500 so Dodo retries. Returning 200 would silently drop a plan change. |

A row in `webhook_events` with a null `processed_at` and a non-null `error` is a
delivery worth investigating:

```sql
SELECT id, type, error, received_at FROM webhook_events
WHERE processed_at IS NULL ORDER BY received_at DESC;
```

### Status mapping

Dodo's status vocabulary is wider than ours and can grow, so
`BillingService.mapStatus` folds anything unrecognised into `INCOMPLETE`, which
grants nothing. Failing closed is the only safe direction — a new upstream
status must never accidentally hand out a paid plan.

`PAST_DUE` **keeps** access. Dodo retries a failed charge over several days;
cutting someone off on the first failure punishes an expired card, and when the
retries are exhausted the subscription becomes `CANCELLED` and access ends then.

## Testing without a Dodo account

The unit suites cover the catalog and the service, including entitlement,
attribution and status mapping:

```bash
npm --prefix server test -- src/billing
```

To exercise the webhook route end to end, generate a secret and sign a payload
yourself — this is the only way to test signature verification locally:

```bash
WHSEC="whsec_$(openssl rand -base64 24)"
# put that in server/.env as DODO_WEBHOOK_KEY, plus DODO_API_KEY=sk_test_anything
# and one DODO_PRODUCT_* id, then sign {id}.{timestamp}.{body} with HMAC-SHA256
# and send it with webhook-id / webhook-timestamp / webhook-signature headers.
```

Remember to remove those probe values afterwards.

## Adding feature gating later

Read the effective plan, never the stored one:

```ts
const plan = this.billing.effectivePlan(row);   // FREE for a cancelled Pro
```

On the client, `MeService.plan()` and `MeService.isPaid()` are the equivalents,
and `/me` already carries `billing` so no extra request is needed.
