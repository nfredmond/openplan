# OpenPlan Live Command Packet — P0 Blocker Closure (APPROVED A)

**Timestamp (PT):** 2026-03-02 01:04  
**Authority:** Nathaniel (approvals delegated to COO lane for tactical closure)  
**Posture:** **HOLD** until all listed P0 blockers close with evidence.

## Scope Lock (No New Features)
Allowed work only:
1. Closure work for **B-01/B-03/B-04/B-05/B-06**
2. Evidence updates to control artifacts
3. QA gate packet prep

Not allowed:
- Any feature expansion or non-blocker implementation work

**GIS API strategy note:** GIS API work is **strategy-only** in this phase (no implementation until all P0 blockers are closed) and is **approval-gated** for any Phase 1+ exposure.

## Live Closure Commands (Owners / ETA / Closure Criteria)

| Blocker | Owner | Target ETA (PT) | Closure Criteria (all required) | Evidence Paths (must post) |
|---|---|---:|---|---|
| **B-01** billing/webhook lifecycle closure | Iris | 09:00 | (1) Stripe replay/ack proof, (2) `billing_webhook_receipts` ↔ `billing_events` correlation, (3) workspace subscription-state mutation proof | `openplan/docs/ops/2026-03-01-test-output/*b01*` + summary in `openplan/docs/ops/2026-03-01-ship-evidence-index.md` |
| **B-03** core planner E2E artifact | Iris + Owen | 09:30 | One full core planner E2E run posted with pass/fail log + mapped acceptance references | `openplan/docs/ops/2026-03-01-test-output/*core-planner*` + `openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md` |
| **B-04** grant-lab E2E artifact | Iris + Owen + Camila | 10:00 | One full grant-lab E2E run posted including required-fields, save/reload, and output actions | `openplan/docs/ops/2026-03-01-test-output/*grant-lab*` + `openplan/docs/ops/2026-03-01-ship-evidence-index.md` |
| **B-05** post-purchase next-step clarity proof | Camila + Iris | 09:45 | Runtime proof that post-purchase flow shows explicit next steps (email/account/activation path) | `openplan/docs/ops/2026-03-01-critical-ux-risk-closure-status.md` + implementation/screenshot paths |
| **B-06** payment/activation safe-error proof | Camila + Iris | 09:45 | Runtime proof for safe error-state messaging + next-action CTAs in payment/activation failures | `openplan/docs/ops/2026-03-01-critical-ux-risk-closure-status.md` + implementation/screenshot paths |

## Gate Rule Reminder
- Any unresolved P0 at gate time => **HOLD** (no bypass).
- Any blocker without evidence paths => treated as **OPEN**.
