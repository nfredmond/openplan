# OpenPlan V1 Status Memo Refresh — 2026-04-07

**Owner:** Bartholomew Hale (COO)  
**Executive sponsor:** Nathaniel Ford Redmond  
**Purpose:** current-truth executive memo after the April proof refresh, canonical alias lock, canary preflight readiness, and explicit CEO waiver refresh.

## Executive Summary

OpenPlan is now in a cleaner and more operationally honest state than it was at the start of this closeout push.

The current posture is:
- **supervised pilot readiness:** **GO**
- **broad public self-serve launch:** **NO-GO**
- **authenticated planning-domain production proof:** **PASS**
- **canonical billing/proof path on `openplan-natford`:** **PASS for preflight readiness**
- **fresh same-cycle paid happy-path commercial proof:** **WAIVED by explicit CEO decision for this cycle**

That means the remaining work is no longer “figure out whether OpenPlan basically works.”

The remaining work is:
- propagate the newly issued Principal QA pilot PASS across the active closeout docs,
- keep final external/client-safe language locked to that exact approved boundary,
- use the pilot ops pack as the operating baseline,
- and continue into supervised pilot motion without broad-launch drift.

## Current Truth State

### 1. Launch boundary
The canonical April launch boundary remains:
- **GO for supervised external pilot use**
- **NO-GO for broad public self-serve launch**

Reference:
- `docs/ops/2026-04-05-openplan-launch-readiness-truth-memo.md`

This remains the right operating sentence because current evidence supports a production-backed planning OS for guided pilot use, not a universal self-serve municipal SaaS claim.

### 2. Planning-domain production proof
Current authenticated production smoke on the canonical alias is green.

Fresh April proof confirms:
- signed-out redirect continuity,
- sign-in return-path behavior,
- authenticated workspace/project creation,
- Project → Plan → Model → Program continuity,
- billing-page authenticated load.

Reference:
- `docs/ops/2026-04-07-openplan-production-authenticated-smoke.md`

This materially strengthens current confidence in the planning-domain spine.

### 3. Canonical alias and billing proof posture
The proof lane is now cleanly centered on:
- `https://openplan-natford.vercel.app`

What is now settled:
- canonical proof alias is locked,
- Vercel protection bypass path works,
- supervised paid canary preflight is green on the canonical alias,
- current live canary workspace target is identified,
- webhook posture and live Starter price posture are validated in the preflight packet.

References:
- `docs/ops/2026-04-07-openplan-canonical-proof-alias-decision.md`
- `docs/ops/2026-04-07-openplan-canonical-alias-protection-path-unblock.md`
- `docs/ops/2026-04-07-openplan-canary-preflight-ready.md`
- `docs/ops/2026-04-07-test-output/20260407T201100Z-supervised-paid-canary-preflight/preflight-summary.md`

This means the billing lane is no longer blocked by alias confusion or proof-lane setup drift.

### 4. Commercial proof decision for this cycle
Nathaniel explicitly waived the requirement to run a fresh supervised paid Starter canary in this April closeout cycle.

Reference:
- `docs/ops/2026-04-07-openplan-commercial-proof-waiver-refresh.md`

That means the correct commercial posture is:
- payments are treated as operationally sufficient for now,
- the canary preflight is ready,
- but **no fresh same-cycle real paid happy-path checkout was executed**.

This is an accepted evidence boundary, not unresolved confusion.

## What Is Closed

1. **Canonical alias ambiguity**  
   The proof lane now has one clean target: `openplan-natford`.

2. **Protection-path uncertainty**  
   The Vercel protection bypass path was verified against the canonical alias.

3. **Proof target drift**  
   The stale historical canary workspace was replaced with a current live workspace target.

4. **Authenticated planning-domain confidence refresh**  
   Fresh production smoke now exists on the canonical alias.

5. **Commercial canary decision ambiguity for this cycle**  
   The canary is now explicitly waived rather than left as a vague “maybe later” blocker.

## What Remains Intentionally Bounded

1. **No fresh same-cycle paid happy-path billing proof was executed.**
2. **Broad self-serve commercial launch language remains out of bounds.**
3. **Modeling/compliance claims remain bounded and should not outrun evidence.**
4. **Principal QA approval is now refreshed for the April packet as a bounded supervised-pilot PASS.**

## Recommended Language Discipline

### Safe language
- production-backed
- supervised pilot ready
- evidence-accurate
- guided onboarding
- auditable workflow continuity
- payments treated as operationally sufficient for now under explicit waiver

### Unsafe language
- fully launched self-serve SaaS
- freshly re-proven paid happy path this cycle
- universally validated forecasting platform
- complete commercial proof closure this week
- ready for any agency without qualification

## Operating Recommendation

For current operations, use this posture:
- **product confidence:** strong enough for supervised pilot use
- **commercial confidence:** bounded but acceptable for current pilot posture under explicit waiver
- **governance posture:** refresh and finalize against the April packet
- **external claim posture:** disciplined and specific

## Immediate Next Actions

1. Refresh the active status/governance memos so they explicitly reflect the new April Principal QA pilot PASS.
2. Keep the client-safe positioning note locked to the approved supervised-pilot boundary.
3. Use the pilot onboarding/support pack as the live operating baseline.
4. Continue into supervised pilot motion with disciplined commercial and modeling language.

## Bottom Line

OpenPlan is now in a credible April 2026 v1 posture for **supervised pilot use**.

The remaining caution is not technical fog. It is disciplined governance and honest language:
- principal review is now in place for the supervised-pilot boundary,
- no broad self-serve overclaiming,
- no pretending a fresh paid canary happened when it did not,
- and no drift away from the approved pilot-bounded posture.
