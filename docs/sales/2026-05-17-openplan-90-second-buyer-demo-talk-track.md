# OpenPlan 90-Second Buyer Demo Talk Track

**Date:** 2026-05-17  
**Status:** Operator script for supervised buyer walkthroughs; not outbound marketing copy.  
**Use when:** Nathaniel or a Nat Ford operator needs a concise opening narration before moving into Command Center, Pilot Readiness, Request Access, and Examples.

## Operator setup

Before speaking, open the buyer-demo path in this order:

1. `/command-center`
2. `/admin/pilot-readiness`
3. `/request-access`
4. `/examples`

Run the final live-read preflight only when preparing for an actual supervised walkthrough:

```bash
npm run ops:check-buyer-demo-preflight -- --live-reads
```

## 90-second script

> OpenPlan is Apache-2.0 open-source planning software with Nat Ford implementation, hosting, onboarding, support, and planning services around it. The point of this walkthrough is not to pretend the platform is a finished self-serve municipal SaaS. The point is to show how we keep planning work proof-first: the claim, the evidence, and the caveat stay together.
>
> I’m going to start in Command Center because that is the operator surface. It tells us what proof packet to verify, what the current demo boundary is, and what not to claim. For the Nevada County screening example, the important fact is that the run remains **internal prototype only**. It includes useful evidence, but the Max APE is 237.62%, so we do not present it as validated forecasting.
>
> Next, Pilot Readiness shows the ledger and preflight posture. Request Access is deliberately reviewed-first: a request starts an internal intake review, not an automatic account, subscription, workspace, or services commitment. Then Examples shows the public proof artifact with the same caveats preserved.
>
> If this is useful, the next step is not “click buy now.” The next step is to scope one supervised first workflow: geography, data owner, review owner, hosting lane, and the evidence standard needed before anyone relies on outputs.

## Required caveats to say out loud

- screening-grade only
- OSM default speeds/capacities
- tract fragments are not calibrated TAZs
- jobs are estimated from tract-scale demographic proxies
- external gateways are inferred from major boundary-crossing roads

## Do not say

- “This is validated forecasting.”
- “The model is calibrated for production reliance.”
- “Request access automatically creates a workspace.”
- “The customer can self-serve activation today.”
- “The example proves current live runtime state.”
- “AI makes the planning decision.”
- “OpenPlan replaces legal, professional, or agency review.”

## Close with these questions

1. What is the first workflow worth proving together?
2. Who owns review and acceptance on the buyer side?
3. What data sensitivity, procurement, public-records, or hosting constraint matters?
4. Should follow-up be self-hosted, managed-hosted, implementation-only, planning support, or a blended lane?

## Evidence links

- Command Center: `/command-center`
- Pilot Readiness: `/admin/pilot-readiness`
- Request Access: `/request-access`
- Examples: `/examples`
- Buyer-demo preflight proof: `docs/ops/2026-05-17-buyer-demo-preflight-proof.md`
- Current buyer-demo evidence note: `docs/sales/2026-05-17-openplan-buyer-demo-evidence-note.md`
