# OpenPlan Ship Week — Day 1 Team Tasking Matrix

**Date:** 2026-03-01  
**Priority posture:** 80% OpenPlan ship lane / 20% portfolio maintenance  
**Cadence:** 09:00 scope gate · 13:00 QA sweep · 17:30 ship gate

## Command Intent
Ship a reliable, pilot-ready OpenPlan v1 in 7 days without uncontrolled scope growth.

## Owner Assignments

### Elena Marquez — Principal Planner (Delegation Lead + Final QA)
- Run daily coordination across all lanes and enforce status format.
- Maintain P0/P1 defect board with owner + ETA + evidence links.
- Prepare final Principal QA packet and PASS/HOLD recommendation for Day 6/7.
- Deliverable today: `openplan/docs/ops/2026-03-01-principal-qa-assembly-plan.md`

### Iris Chen — Expert Programmer (Primary Coding Owner)
- Map current engineering work to P0 Must-Ship list.
- Close or explicitly triage gaps in auth/session, workspace role gates, and billing/webhook reliability.
- Produce executable regression command list + latest pass/fail outputs.
- Deliverable today: `openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md`

### Owen Park — Associate Planner (Pilot Readiness + Acceptance)
- Convert Must-Ship items into acceptance criteria language for planner-facing workflows.
- Draft pilot runbook sections for onboarding, expected outputs, and support handoff.
- Deliverable today: `openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md`

### Priya Nanduri — GIS Expert (Geospatial QA + Constraint Control)
- Validate geospatial workflow requirements against v1 scope (what is in/out for ship week).
- Produce geospatial quality checklist for map/report outputs tied to ship gate.
- Flag any P0 geospatial risk that could invalidate pilot trust.
- Deliverable today: `openplan/docs/ops/2026-03-01-geospatial-qa-gate.md`

### Mateo Ruiz — Assistant Planner (Execution PMO + Evidence Hygiene)
- Build evidence index for daily QA pack (auth, planner, grant-lab, billing, blockers).
- Keep ship board checkboxes current with links to proofs.
- Compile unresolved blocker digest for 17:30 gate.
- Deliverable today: `openplan/docs/ops/2026-03-01-ship-evidence-index.md`

### Camila Reyes — Urban Design & Graphic Systems Expert (Critical UX/Clarity)
- Audit critical ship flows for clarity/readability/trust cues (no cosmetic scope creep).
- Produce focused UX risk list with only ship-relevant fixes.
- Deliverable today: `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`

## Required Status Format (all owners)
- **Done**
- **In Progress**
- **Blockers**
- **ETA Confidence**
- **Evidence Paths**

## Non-Negotiable Rules
1. No unscoped feature adds unless they directly resolve P0/P1 risk.
2. Every claim must link to evidence artifact (file, test output, screenshot, or commit).
3. Any unresolved P0 at 17:30 = automatic HOLD posture.
