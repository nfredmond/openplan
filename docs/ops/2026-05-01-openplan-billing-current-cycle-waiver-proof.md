# OpenPlan Billing Current-Cycle Waiver Proof

**Date:** 2026-05-01
**Status:** PASS - explicit commercial proof boundary retained
**Scope:** sales/release posture for managed-hosting billing

## Decision

No fresh same-cycle paid checkout canary was run for this release packet. The accepted billing posture is:

> OpenPlan managed-hosting billing is treated as operational based on historical live payment evidence plus current non-money-moving billing proof. The fresh paid checkout canary is explicitly waived for this cycle and must not be described as re-proven today.

## Evidence Retained

- PASS: `2026-03-17-openplan-commercial-proof-waiver.md` records the CEO decision to waive a fresh supervised paid Starter canary for cost/cash-preservation reasons.
- PASS: Current public pricing copy now carries the same boundary: historical live payment evidence plus current non-money-moving billing proof; no fresh same-cycle paid canary was run for this release packet.
- PASS: `2026-05-01-openplan-local-admin-support-flow-smoke.md` proves supervised admin provisioning writes a pilot workspace billing posture without outbound email or a paid checkout claim.
- PASS: `2026-05-01-openplan-local-grants-flow-smoke.md` proves project-delivery billing/reimbursement records for grant closeout are operational inside the planning spine.
- PASS: `pnpm ops:check-public-demo-preflight` and production health checks keep public billing readiness protected; they do not attempt Stripe writes or imply a paid canary.
- PASS: Focused billing tests continue to cover checkout initialization, webhook handling, usage/quota, readiness, and support-state behavior without moving real money.

## Sales Language

Use:

> OpenPlan includes managed-hosting billing infrastructure and treats payment operations as working based on historical live payment evidence plus current non-money-moving billing proof. For this cycle, Nat Ford waived a fresh paid checkout canary; paid activation should still be handled as a supervised workspace-specific step.

Do not use:

> Billing was fully re-proven with a fresh paid checkout today.

Do not imply:

- broad self-serve SaaS activation,
- automatic workspace creation after public request-access submission,
- legal/accounting-grade reimbursement automation,
- or a same-cycle money-moving Stripe canary that did not happen.

## Reopen Conditions

Reopen the paid canary lane if:

- a billing regression appears,
- a customer or procurement reviewer requires stronger same-cycle proof,
- or Nat Ford chooses to run the strongest possible commercial proof packet before a broader paid launch.

## Verdict

PASS: The billing flow is not claimed as freshly paid-canary-proven. The current saleable posture is explicit waiver plus historical live payment evidence, current protected billing/readiness proof, workspace-specific provisioning posture, and supervised activation language.
