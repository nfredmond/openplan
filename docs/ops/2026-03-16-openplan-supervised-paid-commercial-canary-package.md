# OpenPlan Supervised Paid Commercial Canary Preparation Package — 2026-03-16

**Owner:** Bartholomew Hale (COO)  
**Status:** READY FOR SUPERVISED EXECUTION — no charge executed in this pass  
**Chosen slice:** supervised paid commercial canary preparation package

## Executive Summary
This was the highest-leverage compact slice because OpenPlan’s remaining honest v1 HOLD basis is now narrow:
- **governance** — the current-cycle Principal Planner artifact is posted but still HOLD / unsigned pending Elena review, and
- **commercial sufficiency** — current production billing proof is strong, but it still stops short of a real paid live happy-path canary.

I cannot honestly clear governance inside this lane, and I should not casually create a real recurring charge without explicit supervised approval. So the right next move was to make the **shortest safe path to that decision executable**:
1. correct the packet where it still carried a stale billing-ambiguity blocker,
2. package the exact supervised canary plan, and
3. reduce the remaining billing question to a simple explicit choice instead of another open-ended investigation.

## Why This Best Fits `promt1.md` + Current V1 State
The original plan is about building a credible, integrated, operationally real planning platform — not staging launch theater.

Given today’s shipped closure wave, the shortest honest path to v1 is **not** broad new feature scope. It is:
- preserving the now-proven planning-domain spine,
- closing documentation drift in the ship packet,
- and preparing the one remaining commercial proof step so Nathaniel and Elena can either run it or consciously waive it for pilot readiness.

That is tighter, more truthful, and more in line with the plan than reopening product breadth tonight.

## Current Starting Truth
Already proven in the current packet:
- production alias alignment on the public URL,
- authenticated production create/list/detail continuity,
- authenticated production edit/update persistence,
- auth/proxy closure,
- provisioning cleanup hardening,
- planning save rollback hardening,
- billing identity-review hardening,
- billing workspace chooser fix live on production,
- purchaser-identity mismatch hold branch proven on production short of a real charge,
- cancel/refund operational lane narrowed with return-path correction and re-verified historical live evidence.

Therefore the remaining billing question is no longer "is billing fundamentally behaving?" It is simply:
- **Is the current non-money-moving production proof sufficient for pilot/pre-close?**
- **Or do we want one supervised paid commercial canary to close the happy path with maximum confidence?**

## Recommended Canary Shape
If Nathaniel and Elena decide to run the canary, use the smallest honest live commercial proof:

### Canary objective
Prove the **happy-path commercial activation** on current production with one real paid checkout using the public alias and then decide whether immediate cancel/refund is also required.

### Canary profile
- **Plan:** Starter only (minimize spend)
- **Environment:** current public production alias `https://openplan-zeta.vercel.app`
- **Workspace posture:** one dedicated canary workspace only
- **Identity posture:** initiator email and purchaser email should match
- **Session count:** exactly one paid checkout attempt unless an explicit stop/review decision authorizes another

### Why this exact shape
- the **mismatch hold** path is already production-proven,
- the **chooser/targeting bug** is already closed live,
- the missing proof is the **happy-path real-money completion**, not another synthetic hold replay.

## Roles / Supervision
- **Nathaniel:** spend authority + live operator approval
- **Elena:** Principal Planner witness/reviewer for same-cycle governance confidence
- **Bartholomew:** evidence capture, reconciliation, and final gate memo preparation

## Preflight Checklist (Must All Be True Before Any Charge)
1. Public alias still resolves to the current intended production deployment.
2. `/billing` chooser behavior still requires explicit workspace selection for multi-workspace users.
3. Target workspace is identified explicitly via `/billing?workspaceId=<uuid>`.
4. Target price is confirmed live and expected:
   - Starter price id
   - amount
   - recurring monthly cadence
5. Production webhook endpoint exists and is still enabled for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
6. Evidence capture folder for the canary is pre-named under `docs/ops/2026-03-16-test-output/` or next-cycle equivalent.
7. Monitor command is ready before payment submission.
8. Cancel/refund decision is made in advance:
   - **Path A:** keep subscription live after proof, or
   - **Path B:** immediately cancel and optionally refund after proof.

## Recommended Preflight Command
### One-command prep wrapper (preferred)
```bash
cd /home/nathaniel/.openclaw/workspace/openplan/openplan
./scripts/openplan-supervised-paid-canary-preflight.sh \
  --workspace-id <workspace-uuid> \
  --billing-email <approved-operator-email>
```

What this now does in one pass:
- pulls/loads the current production env snapshot,
- confirms the public alias is responding,
- confirms the live Starter price posture,
- confirms the production Stripe webhook endpoint + required events,
- confirms the target workspace exists and captures its current production snapshot,
- captures a monitor snapshot into a dated evidence folder,
- emits the exact `/billing?workspaceId=...` route and live monitor command to use during the supervised session.

### Manual equivalents (if the wrapper is unavailable)
#### Pull current production env snapshot
```bash
vercel env pull /tmp/openplan.vercel.env --environment=production -y
```

#### Confirm live price posture
```bash
source /tmp/openplan.vercel.env
curl -sS https://api.stripe.com/v1/prices/$OPENPLAN_STRIPE_PRICE_ID_STARTER -u "$OPENPLAN_STRIPE_SECRET_KEY:" | jq '{id, livemode, active, currency, unit_amount, type, recurring}'
```

#### Confirm production webhook endpoint
```bash
curl -sS https://api.stripe.com/v1/webhook_endpoints -u "$OPENPLAN_STRIPE_SECRET_KEY:" | jq '[.data[] | {id, status, url, enabled_events}]'
```

#### Start the evidence monitor before checkout completion
```bash
cd /home/nathaniel/.openclaw/workspace/openplan/openplan
./scripts/openplan-starter-canary-monitor.sh \
  --workspace-id <workspace-uuid> \
  --since-minutes 180 \
  --env-file /tmp/openplan.vercel.env
```

## Exact Execution Sequence
1. Sign in as the approved canary operator on the public production alias.
2. Open the exact workspace billing route:
   - `/billing?workspaceId=<workspace-uuid>`
3. Capture the **before** state:
   - billing page screenshot
   - workspace status/plan
   - recent billing events
4. Start **Starter** checkout.
5. On Stripe Checkout, confirm before submitting payment:
   - correct workspace/customer context,
   - correct plan,
   - correct live monthly amount,
   - purchaser email matches initiator email.
6. Complete the real payment **once**.
7. Capture the **return/success** state.
8. Confirm Stripe and OpenPlan evidence:
   - `checkout.session.completed`
   - subscription created/updated events as applicable
   - processed webhook receipts
   - workspace status transitions to active/trialing as expected
   - billing page reflects active commercial state on the exact workspace
9. If the pre-decided path is cancel/refund, execute that immediately afterward using the documented closeout runbook:
   - `docs/ops/2026-03-16-openplan-cancel-refund-operational-closeout.md`
10. Write the resulting evidence memo and update the internal ship gate.

## Abort Conditions
Stop immediately and do **not** submit payment if any of the following occur:
- wrong workspace is being shown,
- wrong plan or amount is displayed,
- purchaser email does not match the intended canary identity,
- public alias appears stale or inconsistent with current production proof,
- webhook endpoint posture is not what the packet expects,
- any page copy or route behavior suggests a regression from the current packet.

## Evidence Checklist For The Canary Memo
At minimum, the future canary memo should include:
- exact workspace id
- exact purchaser / initiator identity posture
- exact Stripe Checkout Session id
- screenshots before checkout, on Stripe Checkout, and after return
- Stripe event ids observed
- OpenPlan billing event ids observed
- webhook receipt processing status
- final workspace billing snapshot
- whether subscription was kept, canceled, and/or refunded
- exact reason if the canary was aborted instead of completed

## Pass / Fail Interpretation
### PASS
A supervised canary should be treated as a commercial PASS if all of the following are true:
- one real paid checkout completes on current production,
- Stripe generates the live completion event,
- OpenPlan processes the webhook correctly,
- the target workspace moves into the expected active commercial state,
- the billing page shows the correct post-purchase state for that exact workspace,
- and any chosen cancel/refund follow-through completes per the runbook.

### HOLD
Remain at HOLD if:
- payment is not submitted,
- webhook processing is incomplete or contradictory,
- workspace targeting is wrong,
- activation state does not reconcile cleanly,
- or the canary reveals a new operational defect.

## What Changed In This Pass
1. Added this supervised paid commercial canary package so the remaining commercial decision is executable.
2. Updated the current proof packet to remove stale wording that still treated billing workspace ambiguity as an open blocker after the chooser production proof closed it.
3. Updated the internal ship gate to reflect the narrower remaining HOLD basis and to point at this package as the concrete next step if a paid canary is required.

## V1 Status Impact
This pass does **not** claim final external ship.

What it does do:
- narrows the remaining HOLD basis to **governance + explicit commercial decision**,
- removes stale packet drift that overstated an already-closed billing ambiguity,
- and leaves OpenPlan one supervised session away from the strongest possible commercial proof if Nathaniel and Elena want it.

## Bottom Line
The right next move was not more breadth. It was to make the final honest commercial decision clean.

That is now done: OpenPlan has a prepared supervised paid canary path, and the current HOLD basis is narrower, cleaner, and easier to close.