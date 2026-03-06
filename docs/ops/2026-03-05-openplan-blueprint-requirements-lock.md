# OpenPlan Blueprint Requirements Lock

Date: 2026-03-05 (PST)
Owner: Bartholomew (COO)
Status: ACTIVE — canonical scope baseline

## Source of Truth
- Blueprint file: `/home/nathaniel/.openclaw/workspace/openplan-blueprint.md`
- File timestamp observed: `2026-03-05 00:19 PST`

## Scope Position
The blueprint is accepted as the strategic target-state for OpenPlan (California transportation planning “everything” SaaS), including:
- Multi-tenant role-based platform and audit-grade traceability.
- California compliance spine (LAPM, Office Bulletins/LPPs, STIP/RTIP, CEQA §15064.3, SB 743 guidance).
- Engagement mapping (Social Pinpoint-like), governed ingestion fabric, VMT/scenario workflows, ABM pipeline, and AI governance layer.

## Delivery Policy (Truth-in-Execution)
- Target-state scope is **locked**.
- Shipping proceeds in controlled slices to maintain reliability and avoid fake completion claims.
- No “checkbox theater”: each module requires runtime proof, tests, and artifacts.

## Phase Breakdown
### Phase 1 — Ship Reliability + Core Spine (now)
1. Auth/tenancy/RLS, RBAC, audit log integrity.
2. Stage-gate engine with California template scaffolding.
3. Build/runtime stability and evidence pack PASS.

### Phase 2 — Public Engagement + Ingestion Backbone
1. Campaign map + moderation + exports.
2. Policy monitor and source-diff workflow.
3. Initial authoritative connectors with provenance schema.

### Phase 3 — VMT/CEQA + Scenario System
1. CEQA §15064.3 workflow with documentation fields.
2. Scenario manager + comparison report generation.
3. SHS/SB 743 track and induced-travel workflow path.

### Phase 4 — ABM + AI Gateway
1. Containerized managed model runs + output warehouse.
2. AI Gateway with citations/provenance + guardrails.
3. Copilots (delivery, CEQA, engagement, policy updates).

## Immediate Ship-Day Commitments (2026-03-05)
1. Keep OpenPlan no-new-feature P0 closure discipline until gate PASS evidence is complete.
2. Publish explicit module map from blueprint → backlog epics and acceptance criteria.
3. Prepare next executable coding packet for Phase 1 implementation with measurable exit criteria.

## Exit Criteria for “Blueprint Received + Operationalized”
- [x] Blueprint file verified and timestamped.
- [x] Scope declared canonical target-state.
- [x] Phased delivery sequence documented.
- [x] Backlog epics linked 1:1 to module requirements (`openplan/docs/ops/2026-03-05-blueprint-module-to-epic-map.md`).
- [x] Runtime evidence pack updated with phase status dashboard (`docs/ops/2026-03-05-ship-evidence-index.md`, `docs/ops/2026-03-05-op001-op003-acceptance-crosswalk.md`).

## Execution Tracking (2026-03-05 night addendum)
- Gate packet (09:00 / 13:00 / 17:30 backfill + recommendations): `openplan/docs/ops/2026-03-05-phase1-gate-packet.md`
- Reusable daily checklist template for evidence hygiene: `openplan/docs/ops/2026-03-05-phase1-evidence-checklist.md`
- Same-cycle engineering evidence index: `openplan/docs/ops/2026-03-05-ship-evidence-index.md`
- Dated OP-001/OP-003 acceptance crosswalk: `openplan/docs/ops/2026-03-05-op001-op003-acceptance-crosswalk.md`
- These files are now the working control pair + evidence companion set for Phase-1 governance updates until superseded by a dated next-day packet.
