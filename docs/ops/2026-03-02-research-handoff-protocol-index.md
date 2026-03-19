# OpenPlan — Cross-Lane Research Handoff Protocol Index

**Date (PT):** 2026-03-02
**Purpose:** Single index for canonical lane handoff formats and enforcement references.

## Canonical Protocol Artifacts
- GIS: `openplan/docs/ops/2026-03-02-gis-research-handoff-protocol.md`
- Engineering: `openplan/docs/ops/2026-03-02-engineering-research-handoff-protocol.md`
- Urban Design: `openplan/docs/ops/2026-03-02-urban-design-research-handoff-protocol.md`
- Principal Planner: `openplan/docs/ops/2026-03-02-principal-planner-research-handoff-protocol.md`
- Associate Planner: `openplan/docs/ops/2026-03-02-associate-planner-research-handoff-protocol.md`
- Assistant Planner: `openplan/docs/ops/2026-03-02-assistant-planner-research-handoff-protocol.md`
- Message template: `openplan/docs/ops/2026-03-02-research-handoff-message-template.md`

## Standard Required Handoff Fields (all lanes)
1. Topic
2. Artifact path
3. Commit
4. Decision deltas
5. Risks/asks
6. Manual-verification items

## Global Enforcement Rules
- Scope-drift risk must be called out up front.
- Lock posture must be stated explicitly in each update.
- Claims without evidence paths are treated as unresolved.
- Strategy artifacts do not authorize implementation under lock.
