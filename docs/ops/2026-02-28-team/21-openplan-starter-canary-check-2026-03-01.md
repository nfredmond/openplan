# OpenPlan Starter Canary Check — 2026-03-01 UTC

## Scope
Live canary verification for `openplan-starter` including Stripe event capture, webhook processing status, and post-purchase refund/cancel confirmation.

## Evidence IDs (Stripe)
- `evt_1T5z5sFRyHCgEytnojyHBuxt` — `checkout.session.completed`
- `evt_1T5z5sFRyHCgEytnsaSIYsTB` — `customer.subscription.created`
- `evt_1T5z5sFRyHCgEytnSFqeaKkj` — `invoice.payment_succeeded`
- `evt_3T5z5pFRyHCgEytn08Ze8L3S` — `charge.refunded`
- `evt_1T5zFbFRyHCgEytn6jmETfBA` — `customer.subscription.deleted`

### Stripe object evidence
- Checkout session: `cs_live_a12ZOmR55H0BK7j2OD3IZ1j61MZVB4d3qiH14d4LbEBrRaPit2uOBEtDQN`
- Subscription: `sub_1T5z5rFRyHCgEytnshdcrLAi` (status: `canceled`)
- Charge: `ch_3T5z5pFRyHCgEytn0cBVoWFz` (`amount_refunded=9900`, `refunded=true`)

## Webhook processing status
- OpenPlan webhook endpoint configured in Stripe:
  - `https://openplan-zeta.vercel.app/api/billing/webhook`
- Stripe events above currently show `pending_webhooks=1` (undelivered/unacknowledged from Stripe perspective).
- OpenPlan DB evidence during this canary window:
  - `billing_events`: no matching canary rows
  - `billing_webhook_receipts`: no matching live canary rows (only prior test receipt present)

## Refund / Cancel confirmation
- Refund confirmed (full): charge `ch_3T5z5pFRyHCgEytn0cBVoWFz` refunded true, amount_refunded 9900.
- Subscription cancel confirmed: `sub_1T5z5rFRyHCgEytnshdcrLAi` status `canceled`.

## Monetization monitor update path
- Runtime monitor script:
  - `openplan/openplan/scripts/openplan-starter-canary-monitor.sh`
- Command:
  - `./scripts/openplan-starter-canary-monitor.sh --email <billing-email> --since-minutes 180`
- This document is the current monitor record for today’s canary.

## Follow-up required
1. Validate why Stripe delivery remains pending for webhook events (signature secret mismatch vs endpoint delivery error).
2. Replay undelivered events after webhook delivery issue is resolved.
3. Confirm workspace-bound metadata (`workspaceId`) is present for OpenPlan canaries after purchase-path patch lands.
