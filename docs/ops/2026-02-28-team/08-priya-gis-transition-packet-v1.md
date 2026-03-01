# Priya GIS Transition Packet v1 — Post-SRF Priority Queue

- **Date Issued (PT):** 2026-02-28
- **Execution Start (PT):** 2026-02-28 02:17
- **Owner:** Priya (GIS Expert)
- **Manager:** Elena (Principal Planner)
- **Priority:** P0
- **Context:** Transition immediately after SRF app completion
- **Status:** ACTIVE

## Mission
Shift GIS capacity to OpenPlan pilot-readiness by locking geospatial reliability, decision-quality analytics, and map/report performance under one execution lane, with nationwide U.S. jurisdiction support.

## Top 3 Priorities (in order)
1. **Pilot geospatial data hardening**
2. **Decision-ready safety/accessibility analytics pack**
3. **Map/report performance + reliability pass**

## Deliverables (first 48 hours)

### A) Pilot Geospatial Data Hardening
- Build/confirm canonical layer inventory with source-of-truth flags.
- Validate schema + geometry + CRS consistency.
- Produce QA pass log with fixes and unresolved anomalies.

**Artifact:** `09-gis-pilot-data-hardening-checklist.md`

### B) Safety/Accessibility Analytics Pack
- Define metric set for leadership/council packet use.
- Prepare map/export spec with naming/version conventions.
- Produce one mock output bundle path structure for rapid replication.

**Artifact:** `10-council-analytics-pack-spec.md`

### C) Reliability + Smoke Suite
- Define production-like smoke checks for geospatial query/render/export.
- Log expected run durations and failure thresholds.
- Flag top infra risks and immediate mitigations.

**Artifact:** `11-gis-reliability-smoke-suite.md`


## U.S. nationwide scope alignment
- This GIS lane is now explicitly **jurisdiction-agnostic across the United States**.
- Method/docs language must support:
  - municipalities, counties, and county-equivalents (parishes, boroughs, municipios, independent cities),
  - tribal governments and tribal transportation contexts,
  - RTPAs/transportation commissions,
  - state DOT agencies.
- Positioning line for outward contexts remains:
  - **"Based in Northern California, serving agencies across the United States."**
- Jurisdiction coverage addendum artifact: `22-jurisdiction-coverage-addendum.md`



## Updated handoff note paths (nationwide framing)
- `/home/nathaniel/.openclaw/workspace/projects/map-data-pipeline/docs/handoff-expert-programmer.md`
- `/home/nathaniel/.openclaw/workspace/agents/team/gis-expert/projects/map-data-pipeline/docs/handoff-expert-programmer.md`

## Check-in cadence
- **+12h:** status + blockers (**due 2026-02-28 14:10 PT**)
- **+24h:** first artifact draft set
- **+48h:** v1 complete with recommendations

## Initial execution notes (completed at kickoff)
- Confirmed OpenPlan repository structure and current GIS/analysis code paths.
- Ran baseline engineering checks in `openplan/openplan`:
  - `npm run test` ✅ (12 files / 40 tests passed)
  - `npm run build` ✅
  - `npm run lint` ⚠️ (1 non-blocking warning in `src/lib/export/download.ts`)
- Implemented corridor geometry hard gate for WGS84 bounds + closed-ring validation (client upload + `/api/analysis` server guard).
- Confirmed existing analytics are currently source-mixed (Census/OSM/FARS or SWITRS fallback + estimates), requiring council-facing caveat discipline.

## Required status format
- Completed
- In Progress
- Next 24h
- Blockers / Decisions Needed
- ETA Confidence
