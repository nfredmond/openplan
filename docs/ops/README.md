# docs/ops — technical records index

**Last updated:** 2026-07-27

These are dated technical records: accurate as of their dates, kept because they document systems
still in the code. They are not current product claims — the live docs are the root `README.md`,
`openplan/README.md`, and `openplan/docs/SELF_HOSTING.md`. The commercial-era records that used to
live here (launch boundaries, pricing/positioning, pilot packets, billing proofs) were deleted
2026-07-27; git history is the archive.

## Current-era shipped handoffs (July 2026) — read these first

| Doc | What it records |
|---|---|
| `2026-07-18-post-v1-plan.md` | The post-v1 direction at the v1 milestone |
| `2026-07-18-v1-handoff-for-next-agent.md` | Full v1 state handoff |
| `2026-07-17-v1-demo-runbook.md` | Running the seeded demo end-to-end (also linked from the root README) |
| `2026-07-17/18/19-*-shipped*.md` | Grants BCA/screening, grants.gov sync, modeling 1.1 arc + roadmap E–G |
| `2026-07-22/23-*-smoke.md` | ActivitySim behavioral lane, pilot hardening, aerial processing contract live smokes |

## Modeling stack — specs and architecture (March 2026)

`2026-03-15` engine options → `2026-03-16` roadmap → `2026-03-17` AequilibraE/ActivitySim/MATSim
architecture memo + technical spec → `2026-03-18` phase-1 PRD and `p1a*/p1b*/p1c*` artifact specs
(network package schema, zone/corridor/connector contract, ingestion QA, worker prototype, skims,
extractors, run-mode UI, evidence packet) → `2026-03-19`/`2026-03-27` `p2*` ActivitySim behavioral
lane specs.

## Modeling validation evidence (Nevada + Placer counties, March–April 2026)

The screening-runtime validation record: pilot geography decision, truth memos, count-validation
setup, rerun checkpoints, connector-bias and node-id breakthroughs, demand-scalar brackets,
operating guardrails, Placer transfer/onramp/review packet, count inventory spec, and the
`2026-04-05` county containment rerun. These numbers back the public `/examples` evidence catalog
and the modeling caveat gates.

## Modeling claim honesty

`2026-03-22-openplan-modeling-status-language-pack.md`, plus the `2026-05-01`/`2026-05-08`
caveat-gate proofs. The enforcement now lives in code (run-mode caveat strings, claim-boundary
guard tests over `src/`).

## County validation onramp (March 2026)

`2026-03-24-openplan-county-*` — API outline, backend data model, manifest schema, worker
contract, UI state model, onboarding workflow; plus `2026-05-10` manifest proof UI.

## LAPM / stage-gate provenance (March 2026)

`2026-03-05` California stage-gate template pack + LAPM v0.2 review pack + review-decision-log and
source-citation templates; `2026-03-22` LAPM PM+invoicing release checklist and validation
runbook. Source docs for `openplan/src/lib/stage-gates/` and `openplan/src/lib/invoicing/`.

## Crash / geospatial data lane (March 2026)

`2026-03-13` SWITRS collision layer, VRU filter, and geospatial data fabric passes. See also
`../ADRs/ADR-003-crash-data-acquisition.md` (CCRS is the live source; SWITRS is dead upstream).

## Templates

`templates/ca_stage_gates_v0.2_draft.json` (draft successor to the shipped v0.1 template),
`templates/engagement_operator_seed_safe_routes_v0.1.json`.

## Registers

`KNOWN_ISSUES.md` — the active quality register.

Deeper implementation proofs for the app itself (component decompositions, cartographic shell,
evidence backbone, security hardening) live in `../../openplan/docs/ops/`.
