# OpenPlan Modeling Roadmap

**Date:** 2026-03-16  
**Owner:** Bartholomew Hale (COO)  
**Status:** recommended roadmap; not an immediate ship-lane diversion

## Executive Decision
OpenPlan should not jump straight into the heaviest transport-modeling stack first.

**Recommended sequence:**
1. **AequilibraE first** — first practical managed engine inside OpenPlan
2. **ActivitySim second** — first true chained-activity / ABM layer
3. **MATSim third** — advanced dynamic simulation option
4. **SUMO fourth** — specialist downstream corridor / operations validator

## Why this order wins
OpenPlan’s current product stage still rewards:
- traceable runs
- clean provenance
- scenario-to-output continuity
- GIS/Python friendliness
- managed execution that can be wrapped in a planning-safe UX

That means the first win is **not** “most academically ambitious model.”
It is **the first engine OpenPlan can wrap cleanly and operate reliably.**

---

## Phase 0 — Prerequisites (now)
Before any real engine integration, OpenPlan needs a stable model-run contract.

### Must-have platform primitives
- scenario snapshot input bundle
- versioned model configuration record
- run status + logs
- normalized output manifest
- artifact storage conventions
- provenance / reviewer metadata
- run-to-plan / run-to-report linkage

### Acceptance criteria
- one shared run contract documented in the repo
- output storage and metadata pattern defined
- model records can anchor engine runs without special-case logic per engine

---

## Phase 1 — AequilibraE wrapper
**Goal:** prove OpenPlan can manage real transportation-model runs inside the product.

### Why AequilibraE first
- closest fit to current Python/PostGIS-friendly stack
- good for assignment, skims, accessibility, and sketch-planning outputs
- lower integration burden than ActivitySim/MATSim/SUMO
- fastest route to useful outputs OpenPlan can actually surface soon

### What OpenPlan should expose
- network bundle selection
- scenario assumptions
- run creation / status / rerun
- stored skims and assignment outputs
- accessibility summaries
- map/report-ready output packages

### Exit criteria
- one reproducible managed run works end-to-end
- outputs are warehoused and tied to planning records
- provenance is visible inside the UI

---

## Phase 2 — ActivitySim integration
**Goal:** realize the original chained-activity / ABM vision in a controlled way.

### Why ActivitySim second
- strongest fit to OpenPlan’s original demand-model thesis
- credible North American ABM posture
- better strategic planning fit than SUMO
- more product-ready near-term than jumping straight to MATSim

### What must already exist first
- stable run orchestration
- clean skim/assignment support
- strong data contracts
- scenario definitions mature enough to feed ABM inputs

### Exit criteria
- one bounded ActivitySim workflow can run under OpenPlan control
- household/person/trip outputs can be normalized into OpenPlan artifacts
- outputs can feed plan/scenario evaluation workflows

---

## Phase 3 — MATSim advanced lane
**Goal:** add dynamic multimodal simulation where network feedback truly matters.

### When to do it
Only if one of these becomes true:
- a pilot/client needs advanced agent simulation
- OpenPlan is moving toward a real digital-twin posture
- shared mobility / DRT / AV / freight simulation becomes commercially important

### Role in OpenPlan
- advanced simulation tier
- not the first default engine
- not the first modeling backbone

---

## Phase 4 — SUMO specialist lane
**Goal:** use SUMO for corridor/intersection/operations validation.

### Best use cases
- signal/intersection studies
- queue/spillback testing
- bus priority
- lane reallocation validation
- work-zone and detour operations

### Role in OpenPlan
- specialist downstream validator
- not the backbone
- not the first modeling engine to wrap

---

## What not to do
- Do **not** make SUMO the first modeling backbone.
- Do **not** jump straight into MATSim because it is impressive.
- Do **not** bolt raw engine internals into the web app.
- Do **not** derail current v1 closure work for modeling expansion before the run contract is ready.

---

## Near-Term Execution Recommendation
Once the current v1 hardening lane is stable, the first modeling-specific execution slice should be:

### Slice 1 — Model run contract + AequilibraE feasibility spike
Deliver:
- one documented managed-run contract
- one AequilibraE adapter proof-of-concept
- one normalized output manifest
- one UI-visible run artifact tied to a model record

That gives OpenPlan a real modeling spine without trying to finish the whole transportation-planning universe in one jump.

## Final Recommendation
If we want to be both ambitious and sane:
- **AequilibraE first**
- **ActivitySim next**
- **MATSim later**
- **SUMO as specialist ops validation**

That is the best match for OpenPlan’s current maturity, the original long-range vision, and the need to ship real value without collapsing under integration complexity.
