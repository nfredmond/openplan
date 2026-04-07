# OpenPlan Production Billing Truth Refresh — 2026-04-06

**Owner:** Bartholomew Hale (COO)  
**Scope:** refresh production truth for billing/access confidence without overstating paid-proof closure  
**Status:** evidence refreshed; commercial lane still bounded

## Executive read
Today’s truthful answer is narrower than a clean commercial PASS.

What I could freshly prove:
- the repo slice for billing/support clarity is now hardened locally,
- billing routes now fail explicitly with `503 Billing configuration unavailable` when service-role billing env is missing instead of failing opaquely deeper in Supabase client construction,
- the supervised paid canary preflight now writes an explicit blocker summary instead of dying early with a generic missing-env message,
- the supervised paid canary preflight now distinguishes a truly reachable alias from a Vercel-protected alias and can validate a legitimate bypass-header proof mode when the operator provides the secret,
- the current production Vercel lane is still actively deploying on `natford/openplan`,
- the live Starter Stripe price is present, active, recurring monthly, and non-zero,
- the canonical alias currently sits behind Vercel auth/protection for anonymous curl,
- and the currently pulled production env snapshot does **not** contain a usable `SUPABASE_SERVICE_ROLE_KEY`, which blocks a clean rerun of the admin-created QA-user proof harness from this environment alone.

What I could **not** honestly claim today:
- a freshly re-proven production paid happy path,
- a freshly re-proven full authenticated QA smoke using a newly created prod auth user,
- or a clean webhook-confidence PASS for the canonical alias.

## Fresh evidence captured today
### 1. Local validation for shipped billing/support slice
From `openplan/openplan`:
- `npm run lint` → **PASS**
- `npm test -- src/test/billing-support.test.ts src/test/billing-checkout-launcher.test.tsx src/test/billing-checkout-route.test.ts src/test/workspace-membership-current.test.ts src/test/sign-in-page.test.tsx src/test/pricing-page.test.tsx` → **PASS**
- `npm run build` → **PASS**

### 2. Current production deploy lane still live
From `vercel ls openplan --scope natford`:
- newest listed production deployment at capture time: **Ready**, age ~**19 minutes**
- project: `natford/openplan`

This confirms the product is still shipping through the canonical Nat Ford Vercel project rather than a stale duplicate lane.

### 3. Canonical alias behavior from anonymous HTTP
Fresh curl against `https://openplan-natford.vercel.app` returned:
- HTTP status: **401**
- server: **Vercel**
- `/billing` from anonymous curl also returned **401**

Interpretation:
- the canonical alias is not anonymously reachable by bare curl right now,
- so any browser proof lane must either use authenticated browser access and/or the correct Vercel protection-bypass setup,
- the preflight now records that posture explicitly instead of treating a bare `401` as “reachable,”
- and we should not describe the current alias posture as publicly open if it is currently protection-gated.

### 4. Live Stripe price posture
Fresh Stripe API check against the current configured Starter price returned:
- price id: `price_1T5JiYFRyHCgEytn6DLs0Vt2`
- `active: true`
- `livemode: true`
- currency: `usd`
- unit amount: `24900`
- type: `recurring`
- recurring interval: `month`

Interpretation:
- the configured Starter commercial object still exists and is live at **$249/month**.

### 5. Canonical webhook confidence check
Fresh Stripe webhook endpoint listing under the currently pulled production Stripe key returned:
- matches for `https://openplan-natford.vercel.app/api/billing/webhook`: **none**

Interpretation:
- as checked today, I do **not** have fresh evidence that Stripe is currently pointed at the canonical alias webhook endpoint,
- which means webhook confidence is **not closed** by today’s refresh,
- and this is exactly the sort of gap that must be documented plainly instead of hand-waved.

## Proof blocker encountered
### Missing service-role key in the pulled production env snapshot
Fresh `vercel env pull /tmp/openplan.vercel.env --environment=production -y` produced an env file where:
- `NEXT_PUBLIC_SUPABASE_URL` is present,
- Stripe keys and price ids are present,
- but `SUPABASE_SERVICE_ROLE_KEY` is blank.

That means:
- `qa-harness/openplan-prod-auth-smoke.js` cannot create a dedicated QA auth user from the pulled env snapshot,
- `openplan/scripts/openplan-supervised-paid-canary-preflight.sh` now makes that blocker explicit in its summary, but still cannot complete its workspace snapshot / monitor lane from that env snapshot alone,
- billing checkout and webhook routes now surface this configuration hole as a clear `503` instead of a vague downstream failure,
- and a clean same-session replay of the prior admin-created proof flow is blocked until a valid service-role source is restored or explicitly provided.

## Product slice shipped alongside this truth refresh
Billing page support/error handling is now clearer for real buyer/operator states:
- if Stripe returns but the workspace is still `checkout_pending` with no visible webhook-backed billing update, the UI now says that activation is not confirmed yet,
- generic `checkout_pending` states now explain what to verify next instead of leaving operators to infer it,
- inactive / canceled / past-due states now carry stronger workspace-specific caution language,
- identity-review mismatch handling remains explicit and unchanged.

This does not fake proof. It does make the app more trustworthy when proof is still incomplete.

## Honest current commercial posture after today’s refresh
### Proven enough to say
- OpenPlan has a live configured Starter price.
- OpenPlan’s billing UI now communicates pending / unresolved states more safely.
- The production deployment lane is current and active.

### Not proven enough to say
- “The full paid billing happy path was freshly re-proven today.”
- “The canonical webhook path is confirmed healthy today.”
- “The production billing lane is fully closed.”

## Recommended next action
1. Restore or explicitly provide the valid production `SUPABASE_SERVICE_ROLE_KEY` to the proof lane.
2. Verify the intended Stripe webhook endpoint for the canonical alias and correct it if necessary.
3. Re-run:
   - `qa-harness/npm run prod-auth-smoke`
   - `openplan/scripts/openplan-supervised-paid-canary-preflight.sh`
4. Treat the preflight summary as the operator source of truth: it now records whether alias reachability is direct or protection-bypassed, whether live price posture and canonical webhook posture are actually present, and whether service-role-backed workspace evidence exists.
5. Only then decide whether a supervised paid canary is required this cycle or whether the billing lane is honestly strong enough without money-moving proof.

## Bottom line
Today improved trust and clarity, but it did **not** close the billing proof lane.

The correct statement is:

> OpenPlan’s local billing/support UX is stronger, the live Starter Stripe object still exists, but the fresh production billing proof lane remains incomplete because the pulled production env lacks a usable Supabase service-role key and the canonical Stripe webhook endpoint was not freshly confirmed on `openplan-natford`.
