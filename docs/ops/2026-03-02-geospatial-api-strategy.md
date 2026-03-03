# 2026-03-02 Geospatial API Strategy (OpenPlan) — Strategy Artifact Only

## Scope + Governance Status
- **Directive in force:** OpenPlan remains under **no-new-feature lock**.
- This document defines provider strategy, benchmark protocol, success metrics, and risk controls.
- **No implementation is authorized by this artifact.**
- Any future build work requires explicit COO/CEO approval after Phase 0 results.

## Decision Summary (Provider Portfolio)

| Provider | Decision | Primary Use in OpenPlan Context | Why | Current Status |
|---|---|---|---|---|
| Overpass (OpenStreetMap) | **Adopt as core open-data source (conditional on QA gates)** | POIs, network/context enrichment, admin features where available | Free/open, flexible query model, strong breadth | Strategy-approved; benchmark required |
| Geoapify | **Adopt as primary commercial geospatial API candidate** | Geocoding, routing, isochrones, reachability analysis | Broad API suite, practical pricing/free credits, good fit for accessibility workflows | Strategy-approved; benchmark required |
| Distancematrix.ai | **Secondary / benchmark-only candidate** | Travel-time matrix backup/comparison path | Useful matrix capability but lower certainty vs incumbents | Not selected as primary dependency |
| Mapillary | **Targeted pilot only** | Street-level observational evidence (signage/conditions context) | Unique imagery coverage for field-adjacent analysis | Pilot-only, non-core |
| Amadeus | **Defer** | Tourism/hospitality-specific analyses only | Sector-specialized; not aligned with current OpenPlan core workloads | Out of near-term scope |

## Attribution + License Constraints (Mandatory)

> Policy: no external-facing artifact can ship unless attribution/license checks pass.

### 1) Overpass / OpenStreetMap (ODbL ecosystem)
- Must include visible attribution to OpenStreetMap contributors where required.
- Derived database/share-alike implications under ODbL must be reviewed for each use case.
- Keep provenance logs: query text, endpoint, timestamp, bbox/area, and transformation steps.

### 2) Geoapify
- Respect plan-level requirements (including free-tier attribution obligations).
- Include provider attribution in UI/report outputs if required by current plan/terms.
- Track per-endpoint usage to avoid accidental overages.

### 3) Distancematrix.ai
- Commercial use appears allowed, but terms/licensing must be confirmed directly in official docs at time of use.
- No production dependency until legal/commercial terms are documented internally.

### 4) Mapillary
- Attribution and downstream rights for image use must be checked per current Mapillary terms.
- Treat imagery as potentially sensitive context data; do not expose identifiable content without policy review.

### 5) Basemap Attribution (cross-cutting)
- Every map output must include complete basemap/provider attribution (e.g., OSM contributors, tile provider terms).
- Attribution text must be legible at publication scale.

### Compliance Gate (all providers)
Before any external release, require:
1. Provider + endpoint recorded
2. Access date/time recorded
3. License/terms link recorded
4. Required attribution rendered on artifact
5. QA sign-off that attribution text is readable and complete

## Phase 0 Benchmark Protocol (No Implementation)

## Objective
Identify the best provider mix for reliability, coverage, quality, cost predictability, and compliance fit in planning-grade workflows.

## Duration
- **1 week** (5 business days) time-boxed.

## Test Geographies
- Nevada County, CA (rural/mountain)
- Placer County, CA (mixed urban-rural)
- Sacramento core sample area (higher-density baseline)

## Workload Classes
1. Forward geocoding (address → point)
2. Reverse geocoding (point → normalized address)
3. OD travel-time matrix (drive + transit where supported)
4. Isochrone generation (10/20/30 min)
5. POI retrieval by category + boundary
6. (Pilot-only) imagery metadata retrieval for street-level context

## Benchmark Method
1. Define a fixed golden query set per workload and geography.
2. Run equivalent calls across candidate providers where functionally comparable.
3. Capture full provenance for each call (provider, endpoint, params, timestamp, status, latency, response size).
4. Score against success metrics (below).
5. Perform manual QA sample review for semantic correctness (minimum 50 records per workload class).
6. Produce recommendation memo with **Primary / Backup / Defer** outcomes.

## Required Benchmark Artifacts
- `benchmark_query_catalog.json`
- `benchmark_raw_results/` (timestamped)
- `benchmark_scoring_matrix.csv`
- `benchmark_findings.md`
- `license_attribution_checklist.md`

## Success Metrics (Phase 0 Pass Thresholds)

## Data Quality + Coverage
- Geocode match success: **>= 95%** on clean test addresses.
- Reverse-geocode plausibility pass: **>= 95%**.
- POI completeness vs control sample: **>= 90%** in each test geography.
- Isochrone topology validity (non-self-intersecting valid polygons): **100%**.

## Reliability + Performance
- API success rate (non-4xx/5xx after retry policy): **>= 99%**.
- p95 latency:
  - geocode/reverse: **<= 1.5s**
  - matrix/isochrone: **<= 3.0s**
- Rate-limit resilience: no unhandled hard failures under benchmark burst profile.

## Cost + Operational Fit
- Forecast monthly cost at planned usage remains within approved operating envelope.
- Per-1,000-call unit economics documented and stable.
- Caching potential identified to reduce recurring cost.

## Compliance + Governance
- 100% of benchmark outputs include provider attribution metadata.
- 100% of candidate providers have current terms/licensing notes captured.
- Legal/commercial unknowns = **0** before any production recommendation.

## Risk Register

| ID | Risk | Probability | Impact | Early Signal | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R1 | License/attribution non-compliance on client-facing maps | Medium | High | Missing/illegible source credits in exports | Mandatory attribution QA gate + template footers + checklist sign-off | GIS + QA |
| R2 | Rural coverage gaps (OSM/Mapillary variability) | High | High | Incomplete POIs/routes in rural counties | Coverage scoring by geography; backup provider path; confidence flags on outputs | GIS |
| R3 | Vendor outages / rate limiting | Medium | High | Spike in 429/5xx; latency drift | Retry/backoff policy, quota monitors, provider fallback matrix | Engineering/Ops |
| R4 | Cost overrun from matrix/isochrone volume | Medium | High | Cost per call exceeds forecast; monthly burn spikes | Budget caps, caching, batching, usage alerts, COO monthly review | COO + Ops |
| R5 | Data drift/freshness uncertainty | Medium | Medium | Unexpected result changes without schema change | Snapshot timestamps + periodic drift checks + versioned benchmark reruns | GIS + QA |
| R6 | Privacy/ethical exposure from street imagery usage | Low-Med | High | Sensitive content appears in analysis artifacts | Restrict usage to metadata/context; redaction policy; human QA before release | GIS + Ethics Gate |
| R7 | Over-dependence on single provider | Medium | Medium-High | Single-provider critical path in all workflows | Provider abstraction strategy + benchmarked backup provider | Architecture |
| R8 | Scope creep violates no-new-feature lock | Medium | High | Benchmark activity starts producing implementation tickets | Explicit governance checkpoint: strategy/benchmark only until approval memo signed | COO |

## Approval Gates (Before Any Build Work)
1. Phase 0 benchmark complete with pass/fail matrix
2. License/attribution constraints signed off
3. Cost envelope approved by COO
4. Explicit written approval to transition from strategy to implementation

## Recommended Immediate Next Step (still non-implementation)
- Prepare the Phase 0 benchmark packet (query catalog + scoring template + license checklist) for leadership review.

---
**Prepared by:** GIS lane (Priya)
**Date:** 2026-03-02
**Type:** Strategy artifact only (no implementation authority)
