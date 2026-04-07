# OpenPlan V1 Closeout Plan

**Date:** 2026-04-07  
**Owner:** Bartholomew Hale (COO)  
**Executive Sponsor:** Nathaniel Ford Redmond  
**Product posture:** supervised pilot / early-access planning OS  
**Purpose:** close the narrow remaining gaps between the current evidence-backed product state and an honest external pilot-v1 release posture.

## Executive Summary

OpenPlan is no longer primarily blocked by core product instability. The current blocking work is narrower:

1. close the canonical billing proof lane,
2. refresh Principal Planner adjudication on the current packet,
3. remove or document the remaining billing/operator ambiguity,
4. freeze the v1 boundary so proof closure is not diluted by feature sprawl.

This plan assumes a **7-day focused closeout sprint** with no major new feature wave opened until the proof/governance/commercial lane is settled.

## Current Truth State

### Already materially proven
- Production authenticated smoke is green across sign-in redirect continuity, Projects, Plans, Models, Programs, and authenticated billing-page load.
- Planning-domain core is real and supportable enough for supervised pilot language.
- Local quality gate was re-stabilized after test drift, not fresh product breakage.

### Still blocking an honest external v1 PASS
- Supervised paid canary proof is not yet freshly closed on one canonical public alias.
- Principal Planner signoff is not yet refreshed against the latest packet.
- Billing/operator posture still has a narrow alias and workflow ambiguity that should be fixed or explicitly documented.

## Decision Rule

For this sprint, a task is in scope only if it improves one of the following:
- proof closure,
- governance closure,
- billing/commercial clarity,
- operator trust,
- pilot-readiness language accuracy.

Anything decorative, speculative, or thesis-expanding is out of scope until this closeout plan is complete.

## 7-Day Closeout Sprint

## Day 1 — Canonical Alias Decision + Proof Lane Setup
**Primary owner:** Iris Chen  
**Support:** Bartholomew Hale

### Objective
Choose and lock the one canonical proof surface so the billing canary lane can run cleanly.

### Tasks
- Decide whether `openplan-natford.vercel.app` remains the canonical proof surface.
- If yes, provide one of:
  - `OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET`, or
  - an intentionally authenticated browser session for proof execution.
- If no, explicitly switch proof surface to `openplan-zeta.vercel.app` and align all downstream billing/webhook assumptions.
- Record the decision in the ops docs so there is no split-brain alias behavior.

### Acceptance criteria
- One canonical proof alias is documented.
- Proof runner has a valid path through Vercel protection.
- No ambiguity remains about which public URL is authoritative for billing proof.

### Output artifacts
- updated proof preflight note or alias decision memo
- any required env/procedure note for bypass/authenticated proof execution

---

## Day 2 — Supervised Paid Canary Closure
**Primary owner:** Iris Chen  
**Support:** Bartholomew Hale

### Objective
Run the supervised paid canary on the canonical proof surface and produce fresh evidence.

### Tasks
- Execute the supervised paid canary preflight and full run against the canonical alias.
- Verify Stripe checkout, redirect continuity, subscription creation, and webhook receipt on the same canonical surface.
- Capture evidence for the exact billed path and resulting system state.
- If a live paid charge is still intentionally avoided, document the explicit executive decision and the exact residual caveat.

### Acceptance criteria
- Fresh paid-canary packet exists and is complete.
- Billing proof covers the canonical alias end to end.
- Subscription/webhook state is auditable from the packet.
- Any remaining caveat is narrow, explicit, and decision-backed.

### Output artifacts
- refreshed paid canary packet
- billing evidence screenshots/logs
- updated internal ship gate references

---

## Day 3 — Billing UX / Operator Clarity Pass
**Primary owner:** Iris Chen  
**Support:** Owen Park

### Objective
Eliminate operator confusion around billing posture, especially for workspace targeting and review states.

### Tasks
- Inspect current `/billing` workflow for multi-workspace targeting ambiguity.
- Either fix the targeting behavior or explicitly constrain/document current supported behavior.
- Tighten any billing-screen copy that could cause mistaken operator interpretation.
- Confirm the UI matches the actual commercial posture: supervised pilot, not broad self-serve rollout.

### Acceptance criteria
- Billing path is either behaviorally fixed or truthfully documented.
- An operator can tell which workspace is being billed and why.
- No misleading UI language suggests a broader release posture than the product currently supports.

### Output artifacts
- code change and/or operator note
- short billing UX truth memo

---

## Day 4 — Principal Planner QA Re-Adjudication
**Primary owner:** Elena Marquez  
**Support:** Bartholomew Hale, Owen Park

### Objective
Refresh formal QA/QC review against the exact current packet.

### Tasks
- Review the latest proof packet, authenticated smoke, and billing canary evidence.
- Validate claims, assumptions, limitations, and any remaining caveats.
- Update `docs/ops/PRINCIPAL_QA_APPROVAL.md` with explicit PASS or HOLD.
- If HOLD remains, list exact blockers and the narrowest path to PASS.

### Acceptance criteria
- `PRINCIPAL_QA_APPROVAL.md` is refreshed and dated.
- Scope reviewed, assumptions, blockers, and recommendation are explicit.
- There is no stale-signoff ambiguity.

### Output artifacts
- refreshed `docs/ops/PRINCIPAL_QA_APPROVAL.md`
- short reviewer memo if needed

---

## Day 5 — COO Verification + External Language Lock
**Primary owner:** Bartholomew Hale  
**Support:** Elena Marquez

### Objective
Convert technical/gov truth into safe pilot-facing release language.

### Tasks
- Perform secondary COO verification against ethics, confidentiality, citation, and scope truth.
- Refresh the internal ship gate and current status memo.
- Lock external positioning language to:
  - supervised pilot,
  - early access,
  - evidence-backed current capabilities,
  - explicitly bounded caveats.
- Remove any stale language implying broad self-serve maturity if not yet earned.

### Acceptance criteria
- External language matches current proof and governance truth.
- Internal ship gate reflects current status, not historical optimism.
- Pilot-facing claims are defensible.

### Output artifacts
- refreshed status memo / ship gate memo
- updated positioning note if required

---

## Day 6 — Pilot Operations Pack
**Primary owner:** Owen Park  
**Support:** Bartholomew Hale, Mateo Ruiz

### Objective
Prepare the minimum viable operational package for a supervised pilot user.

### Tasks
- Draft pilot onboarding sequence and operator checklist.
- Define what support is manual vs automated during pilot.
- Define what types of agencies/workflows are in scope for pilot onboarding.
- Prepare a short escalation/runbook for auth, billing, and workspace provisioning issues.

### Acceptance criteria
- A pilot operator can explain setup, support boundaries, and escalation paths.
- The pilot package does not promise unsupported automation.
- Internal team knows how to support first live pilot users.

### Output artifacts
- pilot onboarding checklist
- pilot support runbook
- scope/in-scope memo for first pilot cohort

---

## Day 7 — Go / No-Go Review
**Primary owner:** Nathaniel Ford Redmond  
**Support:** Bartholomew Hale, Elena Marquez, Iris Chen

### Objective
Make a clean release posture decision based on evidence, not momentum.

### Decision options
1. **PASS: supervised pilot v1**
   - proof lane closed,
   - Principal QA PASS,
   - billing/operator caveats are acceptable and documented.

2. **CONDITIONAL PASS: limited pilot admission**
   - core proof is sufficient,
   - one or two narrow caveats remain,
   - external language is constrained accordingly.

3. **HOLD**
   - one or more core trust/commercial/governance gaps remain,
   - no external v1 language beyond internal testing/pilot-prep.

### Acceptance criteria
- One release posture is selected explicitly.
- Supporting rationale is written down.
- Next-step queue is updated based on the chosen posture.

### Output artifacts
- go/no-go memo
- updated command board or status memo

## Owners Matrix

- **Bartholomew Hale (COO):** sprint coordination, truth-state management, ship-gate language, secondary verification
- **Nathaniel Ford Redmond (CEO):** executive decision-maker on commercial sufficiency and go/no-go posture
- **Elena Marquez (Principal Planner):** formal QA/QC adjudication and approval artifact
- **Iris Chen (Expert Developer Programmer):** billing/proof implementation, alias resolution, canary execution support, workflow fixes
- **Owen Park (Associate Planner):** operator documentation, support packaging, workflow clarity review
- **Mateo Ruiz (Assistant Planner):** support/runbook drafting assistance and checklist formatting

## Non-Negotiable Constraints

- No new major feature wave until proof/governance/commercial closure is settled.
- No external “v1 shipped” language without refreshed Principal Planner review or explicit written CEO override.
- No claim should exceed current evidence.
- If the paid canary is waived again, that waiver must be explicit and documented, not implied.

## Post-Closeout Queue (only after this sprint)

Once this closeout plan is complete, the highest-leverage next module should be chosen from:
1. planning/report orchestration, **recommended first**,
2. engagement foundation,
3. assistant workflow surface.

Recommendation: **planning/report orchestration first**, because it compounds planner productivity and client-visible value without opening a reckless new platform surface.

## Source Notes

Primary source artifacts for this closeout plan:
- `docs/ops/2026-03-15-openplan-v1-command-board.md`
- `docs/ops/2026-04-07-openplan-production-authenticated-smoke.md`
- `docs/ops/2026-04-07-openplan-proof-rerun-preflight-refresh.md`
