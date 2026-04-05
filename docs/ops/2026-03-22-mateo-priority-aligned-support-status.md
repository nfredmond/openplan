# Mateo Support Lane — Priority-Aligned Status

**Date:** 2026-03-22  
**Author:** Mateo Ruiz (Assistant Planner)  
**Standing order:** LAPM/PM/invoicing → Engagement → AI copilot → Modeling combo  
**Role:** docs/runbook/QA support only. Bart is overwatch. No code.

---

## Priority #1 — LAPM / PM / Invoicing

### Current state
- **Worktree:** `openplan-worktrees/lapm-pm-invoicing`
- **Latest commit:** `58d3534` — "Add LAPM project controls and invoice register scaffolding"
- **What shipped:** migration (`20260321000032_lane_c_lapm_pm_invoicing.sql`), invoice API route, invoice record composer, project controls library, billing page expansion, 5 new test files, stage-gate template updates
- **LAPM compliance docs:**
  - `docs/ops/2026-03-05-ca-stage-gate-lapm-v02-review-pack.md` — v0.2 LAPM ID insertion map (36 evidence items across 9 gates, all `PENDING_REVIEW`)
  - `docs/ops/2026-03-05-california-stage-gate-template-pack.md` — template pack
  - `docs/ops/2026-03-05-lapm-review-decision-log-template.md` — decision log template
  - `docs/ops/2026-03-05-lapm-source-citation-index-draft.md` — source citation draft
  - `docs/ops/templates/ca_stage_gates_v0.1.json` — active enforcement template
  - `docs/ops/templates/ca_stage_gates_v0.2_draft.json` — draft (doc-only, not runtime)

### Blockers
- **LAPM exhibit/form IDs still `PENDING_REVIEW`** in v0.2 draft — all 36 evidence items need real Caltrans chapter/exhibit IDs filled in before this template can go active.
- **Smallest unblock path:** Mateo can produce a LAPM ID lookup table mapping each of the 9 gates + 36 evidence items to actual LAPM chapter numbers and exhibit/form references from the current Caltrans LAPM (2024 edition). This is a docs-only research task, no code.

### Mateo next action
Produce `2026-03-22-lapm-exhibit-id-lookup-table.md` — a clean crosswalk mapping each gate and evidence item to the correct LAPM chapter, exhibit number, form ID, and source URL. Deliver as docs-only reference for engineering to bind into `ca_stage_gates_v0.2_draft.json`.

---

## Priority #2 — Engagement

### Current state
- **Worktree:** `openplan-worktrees/engagement-socialpinpoint`
- **Latest commit:** `e785eee` — "feat(engagement): public portal, export, bulk moderation, share controls"
- **What already shipped (main):**
  - Engagement module foundation (operator-facing campaigns, categories, items, approval workflow)
  - Engagement → report handoff (`docs/ops/2026-03-17-engagement-report-handoff-slice.md`)
  - Report traceability backlink (`docs/ops/2026-03-17-report-traceability-backlink-slice.md`)
  - Production smoke: engagement catalog, campaign detail, category/item CRUD, approval, active state (8 screenshots in `2026-03-17-test-output/`)
- **Module plan:** `docs/ops/2026-03-14-engagement-v1-module-plan.md`

### Blockers
- None visible from docs lane. Engagement worktree has active code; no docs-side gap blocking it.

### Mateo next action
After LAPM lookup table is delivered, produce an engagement QA checklist aligned to the v1 module plan — what surfaces need production smoke, what claims need evidence, what's proven vs. doc-only.

---

## Priority #3 — AI Copilot

### Current state
- **Worktree:** `openplan-worktrees/ai-assistant-integration`
- **Plan doc:** `docs/ops/2026-03-21-openplan-workspace-copilot-agent-workers-plan.md`

### Blockers
- Per standing order: do not open AI copilot scope while #1 or #2 has unresolved work. Currently deferred.

### Mateo next action
None until #1 and #2 are clean.

---

## Priority #4 — Modeling Combo

### Current state
- **Worktrees:** `modeling-aeq-activitysim`, `modeling-activitysim-proof`, `modeling-activitysim-runtime`
- **Shipped on main:** AequilibraE end-to-end pilot, Nevada County network package, trip generation, traffic assignment, volume visualization, KPI comparison, evidence packet output
- **Specs:** 10 phase-1 spec documents (`p1a1` through `p1c2`), phase-2 ActivitySim spec

### Blockers
- Per standing order: explicitly bounded to avoid scope ballooning. Do not expand while #1 or #2 needs work.

### Mateo next action
None until #1 and #2 are clean.

---

## Governance reference
- Priority lock doc: `docs/ops/2026-03-22-openplan-priority-order-governance-lock.md`
- Four-priority acceleration plan: `docs/ops/2026-03-21-openplan-four-priority-acceleration-plan.md`
