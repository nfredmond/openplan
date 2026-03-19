# OpenPlan — Research Handoff Enforcement Checklist

**Date (PT):** 2026-03-02
**Purpose:** Ensure every lane update is decision-ready and format-consistent.

## Intake Gate (apply to every lane update)
- [ ] Uses canonical 6-field structure:
  1) Topic
  2) Artifact path
  3) Commit
  4) Decision deltas
  5) Risks/asks
  6) Manual-verification items
- [ ] Scope-drift risk is called out up front.
- [ ] Lock posture is explicitly stated.
- [ ] Evidence paths are present for all claims.

## Lane-specific checks
- Engineering: [ ] P0/P1 impact explicitly stated
- Urban Design: [ ] ship-critical vs cosmetic clearly separated
- Associate Planner: [ ] pilot acceptance criteria impact stated
- Assistant Planner: [ ] evidence-index alignment confirmed
- GIS: [ ] manual license/policy verification flags included where needed
- Principal Planner: [ ] gate posture effect (PASS/HOLD impact) included

## Rejection criteria (return to sender)
- Missing any canonical field
- Missing scope-drift callout
- Missing lock posture line
- Claims without evidence paths

## Governance reference index
- `openplan/docs/ops/2026-03-02-research-handoff-protocol-index.md`
- `openplan/docs/ops/2026-03-02-research-handoff-message-template.md`
