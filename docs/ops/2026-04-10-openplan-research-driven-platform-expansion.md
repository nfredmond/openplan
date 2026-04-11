# OpenPlan Research-Driven Platform Expansion

**Date:** 2026-04-10  
**Owner:** Bartholomew Hale (COO)  
**Status:** planning synthesis memo  
**Purpose:** absorb the 2026-04-10 deep research report into OpenPlan's canonical planning direction without losing current product truth.

## Executive synthesis

The research materially strengthens the OpenPlan thesis, but it does **not** change the core rule that the product must stay truthful and staged.

OpenPlan should now be framed as a **regional planning operating system** with:
- one shared platform core,
- one shared scenario and evidence spine,
- and **four** tightly linked operating systems:
  1. **RTP OS**
  2. **Grants OS**
  3. **Aerial Operations OS**
  4. **Transportation Modeling OS**

The research also makes five product truths clearer:
1. OpenPlan should be **composable**, not a monolith that replaces every specialist engine.
2. OpenPlan should be **standards-first** in data and interoperability.
3. OpenPlan should treat **scenario versioning, assumptions, and evidence** as first-class infrastructure.
4. OpenPlan should make **accessibility, equity, and environmental accounting** core outputs, not late reporting extras.
5. OpenPlan should treat **land-use allocation, zoning/regulatory simulation, and urban design testing** as explicit scenario capabilities, even if those arrive in stages rather than as one giant first release.

## Research-backed additions to the product thesis

### 1. Shared scenario workspace is mandatory
OpenPlan should not only hold projects, reports, and controls. It should also hold:
- baselines,
- scenario branches,
- intervention assumptions,
- comparison snapshots,
- publishable scenario artifacts,
- and impact summaries tied back to the same planning records.

### 2. Standards-first data plane
OpenPlan should align to open standards wherever practical instead of inventing brittle proprietary integration patterns.

Priority standards/data posture:
- **OpenStreetMap** for street/base network sourcing where appropriate
- **GTFS / GTFS Realtime** for transit
- **GBFS** for shared mobility when relevant
- **OGC API Features** for geospatial feature APIs
- **GeoPackage** for portable/offline exchange
- **COG** and **GeoParquet** for cloud-native geospatial data patterns
- **STAC** for spatiotemporal/asset metadata where remote sensing or imagery matters
- **OAuth 2.0 / OpenID Connect** for auth posture
- **SensorThings / similar standards-aware adapters** for operational sensor feeds where relevant

### 3. Transportation Modeling OS is broader than travel-demand execution
The modeling lane should be treated as a full **Transportation Modeling OS**, not just a run launcher.

It should eventually cover:
- model records and run governance,
- network packages,
- county/regional onboarding,
- scenario assumptions,
- managed execution,
- artifact manifests,
- KPI extraction,
- evidence packets,
- accessibility outputs,
- screening and behavioral demand layers,
- and later bounded dynamic simulation.

### 4. Accessibility, equity, and environmental impacts should be first-class outputs
OpenPlan should not make these downstream PDF-only calculations.
They should be reusable platform outputs that can feed:
- RTP project prioritization,
- scenario comparisons,
- public-facing plan narratives,
- board packets,
- grant strategy,
- and pilot evidence.

### 5. Land use, zoning, and urban design belong in the roadmap
The research reinforces that a credible all-in-one planning OS cannot stop at project tracking and transportation outputs.

OpenPlan should explicitly reserve roadmap space for:
- land-use allocation workflows,
- zoning/regulatory simulation,
- parcel or place-based capacity logic,
- urban design / place-testing scenarios,
- and their interaction with transportation accessibility and project prioritization.

This does **not** mean shipping a full LUTI engine immediately.
It means planning for a future where those capabilities plug into the same scenario, evidence, and reporting spine.

## What this does **not** change

The research does **not** justify overclaiming.
OpenPlan should still avoid saying any of the following unless the evidence is real:
- validated forecasting platform,
- calibrated behavioral model in production,
- full compliance/legal automation,
- universal self-serve municipal SaaS,
- finished end-to-end digital twin.

## Recommended planning consequences

### Architecture
- Keep one canonical project/evidence spine.
- Add an explicit shared **scenario workspace + impact ledger** concept to the platform architecture.
- Expand the top-line architecture from three OSs to four by naming **Transportation Modeling OS** explicitly.

### Execution
After the current project-controls shell lane, the highest-compounding work should move toward:
1. standards-first data contracts,
2. scenario versioning and publishable comparisons,
3. reusable accessibility/equity/environment indicator contracts,
4. network package and modeling-run contract maturity,
5. later zoning/LUTI hooks.

### Pilot posture
The first pilot should stay supervised and narrow, but should increasingly aim to prove:
- project continuity,
- report traceability,
- one bounded scenario comparison,
- and, where feasible, one small accessibility/equity insight that is easy to explain and audit.

## Bottom line

The research confirms that OpenPlan should become a **composable planning operating system** built around open standards, shared scenarios, and evidence-linked decision support, not a pile of disconnected planning tools and not a brittle everything-engineered-here monolith.
