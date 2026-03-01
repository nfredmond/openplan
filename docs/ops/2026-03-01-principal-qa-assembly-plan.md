# OpenPlan Ship Week — Day 1 Principal QA Assembly Plan

**Date:** 2026-03-01 (PT)  
**Delegation Lead:** Elena Marquez (Principal Planner)  
**Source Matrix:** `openplan/docs/ops/2026-03-01-team-tasking-matrix.md`

## Command Objective
Ship a reliable, pilot-ready OpenPlan v1 in 7 days with strict scope control and evidence-backed gating.


## Effective Immediate Enforcement Update (12:54 PT)
- **Hard no-bypass governance is active.**
- Any unresolved **P0** at any gate = **HOLD**.
- No **external-ready** claim is valid without a dated Principal QA PASS artifact.
- 13:00 and 17:30 packets must include blocker-level **owner + ETA + evidence paths**.
- Missing evidence path = unresolved blocker.
- Reference: `openplan/docs/ops/2026-03-01-hold-criteria-snapshot.md`

## Gate Cadence (enforced)
1. **09:00 — Scope Gate**
   - Collect owner status in required format.
   - Confirm day scope maps only to P0/P1 ship risks.
2. **13:00 — QA Sweep**
   - Validate evidence paths for all claimed progress.
   - Escalate blockers with owner + ETA + dependency.
3. **17:30 — Ship Gate**
   - Consolidated PASS/HOLD posture for day close.
   - Any unresolved P0 = automatic HOLD.

## Required Status Format (all owners, mandatory)
- **Done**
- **In Progress**
- **Blockers**
- **ETA Confidence**
- **Evidence Paths**

## Owner Task Board (Day 1)

### Iris Chen — Expert Programmer
- **Lane:** Engineering P0 Must-Ship
- **Deliverable:** `openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md`
- **Today focus:** auth/session reliability, workspace role gates, billing/webhook reliability, regression command list with latest outputs.

### Owen Park — Associate Planner
- **Lane:** Pilot readiness acceptance
- **Deliverable:** `openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md`
- **Today focus:** acceptance criteria for planner workflows + pilot runbook sections.

### Priya Nanduri — GIS Expert
- **Lane:** Geospatial QA + constraint control
- **Deliverable:** `openplan/docs/ops/2026-03-01-geospatial-qa-gate.md`
- **Today focus:** v1 geospatial in/out scope, QA checklist, pilot-trust P0 risks.

### Mateo Ruiz — Assistant Planner
- **Lane:** PMO evidence hygiene
- **Deliverable:** `openplan/docs/ops/2026-03-01-ship-evidence-index.md`
- **Today focus:** evidence index, ship-board proof links, unresolved blocker digest for 17:30.

### Camila Reyes — Urban Design
- **Lane:** Critical UX trust/clarity
- **Deliverable:** `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`
- **Today focus:** ship-critical UX clarity risks only (no cosmetic creep).

### Elena Marquez — Principal Planner
- **Lane:** Governance + final QA posture
- **Deliverable:** `openplan/docs/ops/2026-03-01-principal-qa-assembly-plan.md` (this file)
- **Today focus:** enforce cadence, maintain defect board, compile gate outcomes, issue PASS/HOLD recommendation.

## Escalation Rules
1. Any blocker lacking evidence path at gate time is treated as unresolved.
2. P0 blocker unresolved at 17:30 => HOLD posture.
3. New work not tied to P0/P1 risk is deferred.

## Checkpoint Output Artifacts (today)
- 09:00 scope-gate summary (owner statuses + scope lock)
- 13:00 QA sweep summary (evidence validation + blocker escalation)
- 17:30 ship-gate summary (PASS/HOLD + carry-forward list)
