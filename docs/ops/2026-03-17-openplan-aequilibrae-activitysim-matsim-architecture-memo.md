# OpenPlan Architecture Memo — AequilibraE + ActivitySim + MATSim Combined Modeling Stack

**Date:** 2026-03-17  
**Author:** Iris Chen  
**Status:** internal architecture/research memo  
**Scope:** how OpenPlan could incorporate **AequilibraE**, **ActivitySim**, and **MATSim** as a combined modeling system  

> Assumption: the request said "ActivySim," but the intended platform is **ActivitySim**.

---

## 1. Executive summary

Yes, OpenPlan can plausibly incorporate **AequilibraE**, **ActivitySim**, and **MATSim** as a combined modeling system.

However, the right architecture is **not** to fuse them into one giant engine. The right architecture is to make OpenPlan the **planning/data/orchestration platform** and treat the three tools as **specialized engines in a layered stack**:

- **AequilibraE** = fast network, skimming, assignment, accessibility, and GIS-friendly preprocessing spine
- **ActivitySim** = household/person/tour/trip demand-generation brain
- **MATSim** = dynamic agent-based simulation and feedback engine

If we do this well, OpenPlan becomes:

1. a **planning OS** for project/scenario/model/report continuity,
2. a **model registry and run orchestration layer**,
3. a **multi-engine transportation analysis platform**, and
4. a **report-grade evidence system** that can explain what engine ran, on what data, with what assumptions, and with what confidence.

My recommendation is:

- **Phase 1:** ship a serious **AequilibraE-first** modeling backbone
- **Phase 2:** add **ActivitySim** as the behavioral demand layer
- **Phase 3:** add **MATSim** as the high-fidelity dynamic engine
- **Phase 4:** build a controlled **feedback loop** between ActivitySim and MATSim

That order gives OpenPlan real value early, preserves engineering tractability, and avoids making MATSim the default hammer for every planning question.

---

## 2. Why this matters for OpenPlan specifically

OpenPlan is already moving toward a richer modeling posture.

Two internal facts are especially important:

1. The current command board explicitly calls out future need for a **"chained demand-model / transportation-model posture."**
2. The current codebase already includes first-class model families for:
   - `travel_demand`
   - `activity_based_model`
   - `scenario_model`
   - `accessibility`

Relevant local context:

- `docs/ops/2026-03-15-openplan-v1-command-board.md`
- `openplan/src/lib/models/catalog.ts`
- `openplan/supabase/migrations/20260315000023_models_module.sql`
- `openplan/supabase/migrations/20260317000025_model_runs_module.sql`

The current implementation is not yet a full multi-engine orchestration system. It is closer to:

- a **model registry**,
- a **readiness/metadata framework**,
- a **launch template abstraction**, and
- an early **model run tracking** layer.

That is actually a good starting point. We do **not** need to rip it up. We need to extend it in a disciplined way.

---

## 3. What each engine is best at

## 3.1 AequilibraE

### Best role
AequilibraE should be OpenPlan's **network intelligence and fast-run engine**.

### Why it fits
AequilibraE is especially strong for:

- network representation and editing
- path computation
- skimming
- static assignment
- matrix handling
- OMX interoperability
- GIS-friendly workflows
- public transport assignment workflows
- fast, reproducible pre/post-processing around transportation models

### Why it is strategically useful
OpenPlan is not a research-only platform. It needs:

- deterministic outputs,
- fast turnaround,
- strong GIS integration,
- explainable scenario changes,
- reproducible artifacts,
- county/RTPA/small-agency practicality.

AequilibraE is the most naturally operational engine for those needs.

### OpenPlan functions AequilibraE can power

- network import/cleaning
- zone attachment and centroid connectors
- time-period skim generation
- multimodal accessibility surfaces
- corridor screening
- static highway assignment
- quick-turn scenario comparison
- fallback/QA baseline when more complex pipelines disagree

### My product view
If we did nothing else, an **AequilibraE-first OpenPlan lane** would already be commercially meaningful.

---

## 3.2 ActivitySim

### Best role
ActivitySim should be OpenPlan's **behavioral demand-generation brain**.

### Why it fits
ActivitySim is built around:

- households and persons
- disaggregate microsimulation
- tours and trips
- destination choice
- mode choice
- time-of-day / scheduling logic
- OMX/HDF5/CSV data pipelines
- vectorized Python workflows
- reproducible pipeline checkpoints

### What this unlocks for OpenPlan
ActivitySim moves OpenPlan beyond:

- corridor-only analytics,
- sketch metrics,
- static trip tables with thin behavior,
- and report surfaces that lack genuine demand-side logic.

With ActivitySim, OpenPlan can start to model:

- how different household types respond to land use and accessibility,
- why mode shares change,
- how tour patterns move,
- how destination and departure choices respond to policy,
- and how scenario differences propagate through actual traveler behavior.

### OpenPlan functions ActivitySim can power

- scenario demand generation
- population-sensitive policy testing
- mode/time/destination sensitivity
- baseline/future demand generation
- equity-aware demand views by household/person segment
- richer accessibility and logsum-informed indicators

### My product view
ActivitySim is the piece that makes OpenPlan more than a planning GIS/reporting platform. It gives OpenPlan a real claim to being a **behavioral planning system**.

---

## 3.3 MATSim

### Best role
MATSim should be OpenPlan's **high-fidelity dynamic simulation engine**.

### Why it fits
MATSim is designed for:

- agent-based transport simulation
- iterative replanning
- route adaptation
- departure-time adaptation
- network loading / mobility simulation
- score-based behavior updating
- rich event outputs
- extensibility for special use cases

### What this unlocks for OpenPlan
MATSim is where OpenPlan can credibly address:

- dynamic congestion effects
- operational corridor performance
- dynamic route shifts
- richer transit operations and experienced travel times
- pricing/TDM/network management experiments
- cases where static assignment is too blunt

### My product view
MATSim should **not** be the default engine for everything.

It should be the:

- premium engine,
- advanced scenario engine,
- dynamic analysis engine,
- or specialized operations/policy engine.

If OpenPlan tries to make MATSim the default workflow too early, the product will become too slow, too brittle, too calibration-heavy, and too hard to support.

---

## 4. Recommended combined architecture

## 4.1 Core principle
OpenPlan should be the **system of record and orchestration layer**, not the place where engine-specific logic is tangled everywhere.

The architecture should look like this:

```text
OpenPlan App / API / Planning UI
        ↓
OpenPlan Model Registry + Scenario Registry + Artifact Registry
        ↓
OpenPlan Orchestrator / Run Manager
        ↓
  ┌──────────────┬────────────────┬───────────────┐
  │ AequilibraE  │  ActivitySim   │    MATSim     │
  │   Worker     │    Worker      │    Worker     │
  └──────────────┴────────────────┴───────────────┘
        ↓                 ↓               ↓
      Artifacts        Artifacts       Artifacts
        ↓                 ↓               ↓
 OpenPlan Postprocessing / KPI Extraction / Comparison / Reporting
```

The engines should communicate primarily through **versioned artifacts and data contracts**, not by tightly embedding one codebase inside another.

---

## 4.2 Layer-by-layer design

### Layer A — OpenPlan canonical planning data layer
OpenPlan owns:

- projects
- scenarios / scenario sets
- study areas / corridors / geographies
- land use / demographics / employment inputs
- network metadata
- dataset lineage
- report traceability
- model records
- run manifests
- artifact metadata
- QA / calibration / validation status

This is the durable value layer.

### Layer B — AequilibraE preprocessing and fast-run layer
OpenPlan uses AequilibraE to:

- clean and build networks
- attach zones and connectors
- generate skims by period/mode
- run static assignments
- generate accessibility inputs and QA products
- export matrix/network outputs for downstream consumers

### Layer C — ActivitySim behavioral demand layer
OpenPlan uses ActivitySim to:

- ingest households, persons, land use, and skims
- run demand pipeline components
- produce tours, trips, OD structures, and logsums
- expose segmented outputs for reporting and scenario comparison

### Layer D — MATSim dynamic simulation layer
OpenPlan uses MATSim to:

- simulate agents/plans on the network
- model congestion and dynamic network performance
- simulate experienced travel times and adaptation
- produce event-level and aggregate outputs

### Layer E — feedback/postprocessing layer
OpenPlan postprocesses all engine outputs into:

- common KPIs
- geometry-linked outputs
- accessibility/equity deltas
- corridor-level summaries
- map layers
- report-ready evidence packets

---

## 5. The right way to combine them

## 5.1 Not a monolith
The wrong idea would be:

- a single backend process with all three engines deeply interwoven
- no explicit artifact contracts
- no engine-specific job boundaries
- no per-engine reproducibility or caching
- engine logic leaking into UI code

That will become a maintenance trap.

## 5.2 A layered model stack
The right idea is to define three run classes:

### Run class 1 — Fast screening
**Engine path:** AequilibraE only

Use for:

- corridor screening
- accessibility runs
- quick scenario comparisons
- data QA
- basic assignment
- rapid ATP/RTP alternatives testing

### Run class 2 — Behavioral demand
**Engine path:** ActivitySim + AequilibraE

Use for:

- household/person-sensitive demand modeling
- mode and destination sensitivity
- policy tests where behavior matters more than dynamic operations
- richer long-range planning runs

### Run class 3 — Dynamic operations
**Engine path:** ActivitySim + MATSim, with AequilibraE supporting prep/postprocessing

Use for:

- operational analyses
- dynamic congestion/policy testing
- managed lanes / pricing / TDM experiments
- transit operations and experienced LOS scenarios

This creates a product ladder instead of an all-or-nothing engineering cliff.

---

## 6. Data contracts and handoffs

## 6.1 Canonical rule
All engine handoffs should be explicit and versioned.

Every run should be able to answer:

- what inputs were used,
- what scenario deltas were active,
- what engine version ran,
- what adapter version transformed the data,
- what artifacts were generated,
- what assumptions/calibration caveats apply.

## 6.2 AequilibraE → ActivitySim
Preferred handoff:

- OMX skims
- CSV/HDF5 zone/land use tables
- metadata manifest for period/mode mapping

Reason:

- both ecosystems already align naturally around matrix-oriented artifacts
- this is the cleanest seam
- it minimizes custom translation complexity

## 6.3 ActivitySim → MATSim
This is where OpenPlan will need custom IP.

OpenPlan should build an adapter that converts ActivitySim outputs into MATSim-consumable scenario inputs.

Likely responsibilities:

- map households/persons/tours/trips into agent plan structures
- derive MATSim population/plans inputs
- map activity purposes and timing into MATSim-compatible representations
- map mode structures and access/egress logic
- preserve segment metadata for postprocessing and equity analysis

This adapter is one of the most valuable engineering assets in the entire strategy.

## 6.4 MATSim → OpenPlan / ActivitySim
OpenPlan should postprocess MATSim outputs into:

- zonal LOS/skims
- period-specific travel times/costs
- corridor KPI summaries
- link and transit performance summaries
- experienced accessibility indicators
- segment-aware reporting tables

## 6.5 OpenPlan artifact model
Every run should produce an artifact manifest with classes such as:

- `network_package`
- `skim_cube`
- `activitysim_input_bundle`
- `activitysim_output_bundle`
- `matsim_scenario_bundle`
- `matsim_event_bundle`
- `kpi_summary`
- `validation_packet`
- `report_packet`

These should live in object storage, with relational metadata in Postgres/Supabase.

---

## 7. How this maps to the current OpenPlan codebase

## 7.1 What already exists that helps
OpenPlan already has useful primitives:

- a `models` table
- model family/status concepts
- model linkage objects
- `model_runs`
- engine keys for `deterministic_corridor_v1`, `aequilibrae`, and `activitysim`
- launch templates with query text and corridor geometry

This means we are **not** starting from zero.

## 7.2 Gaps in the current schema
Current `model_runs.engine_key` does **not** yet include MATSim.

Current run schema is too thin for a true multi-engine stack. It needs richer concepts for:

- run stages
- run dependencies
- artifact manifests
- engine/adaptor versioning
- calibration status
- validation packets
- feedback-loop iterations
- long-running external job orchestration

## 7.3 Recommended schema additions
If we did this, I would add tables roughly like:

### `model_engines`
Stores supported engines and versions.

Fields:

- `engine_key` (`aequilibrae`, `activitysim`, `matsim`, etc.)
- `display_name`
- `engine_version`
- `adapter_version`
- `runtime_image`
- `status`

### `model_run_stages`
Tracks per-stage status within a multi-stage run.

Examples:

- `network_prepare`
- `skim_generate`
- `activitysim_run`
- `matsim_run`
- `postprocess`
- `report_extract`

### `model_run_artifacts`
Registers every generated artifact.

Fields:

- `model_run_id`
- `artifact_type`
- `storage_uri`
- `content_hash`
- `metadata_json`
- `created_at`

### `model_validation_packets`
Stores validation/calibration outputs.

### `model_profiles`
Represents reusable packaged configurations, such as:

- countywide sketch model
- rural corridor ABM-lite
- dynamic downtown ops model

## 7.4 Recommended extension to `engine_key`
At minimum, extend engine support to:

- `aequilibrae`
- `activitysim`
- `matsim`
- `aequilibrae_activitysim`
- `activitysim_matsim`
- `aequilibrae_activitysim_matsim`

Or, better, stop pretending one string can represent the whole pipeline and move to a staged run model.

---

## 8. What OpenPlan should productize in the UI

OpenPlan should avoid exposing raw engine names as the primary user-facing abstraction.

Most planners do not want to pick between open-source engine brands. They want to choose the **analysis class** and understand:

- how long it takes,
- what inputs it needs,
- how credible it is,
- and what decisions it is appropriate for.

## 8.1 Recommended UX abstraction
### Analysis package
A packaged method, for example:

- County Accessibility Screening
- Corridor Demand Comparison
- ATP Benefit Screening
- Dynamic Operations Stress Test
- Transit Access and Reliability Scenario

### Run mode
A user-friendly label such as:

- **Fast screening**
- **Behavioral demand**
- **Dynamic operations**

### Confidence and intended use
Every package should display:

- intended decision context
- calibration level
- known limitations
- runtime range
- sensitivity expectations

This is much better than a UI that says, "Choose AequilibraE vs ActivitySim vs MATSim."

---

## 9. If we did it: concrete implementation plan

## Phase 0 — architecture, licensing, and proof-of-concept design

### Goal
De-risk the stack before major buildout.

### Deliverables
- architecture ADR
- engine boundary decision memo
- license review memo
- data contract draft
- one small reference study area
- one canonical network package

### Critical decisions
1. Is MATSim kept as a strict external service boundary?
2. What zone system strategy do we use first?
3. What household/person source do we use for pilot geographies?
4. What baseline KPI set is common across all engines?

### Recommendation
Do this before committing to any deep MATSim integration.

---

## Phase 1 — AequilibraE-first production lane

### Goal
Ship a serious fast-run engine inside OpenPlan.

### Scope
Build:

- network package builder
- zone/connector builder
- skim generator
- static assignment runner
- artifact storage
- run-stage tracking
- map/report integration
- KPI extractors

### Product outcomes
OpenPlan can reliably do:

- travel time surfaces
- accessibility comparisons
- assignment-based corridor stress testing
- scenario comparison maps
- reportable tables and charts

### Why this first
Because it gives us:

- near-term user value
- GIS-aligned workflows
- repeatable artifacts
- lower runtime burden
- an engine we can use even after ActivitySim and MATSim land

### Exit criteria
- reproducible run manifests
- exportable skim bundles
- stable comparison outputs
- pilot geometry + scenario support
- internal QA packet generation

---

## Phase 2 — ActivitySim behavioral demand lane

### Goal
Add real disaggregate demand modeling.

### Scope
Build:

- household/person input packaging
- land use + skim handoff contracts
- ActivitySim config/package manager
- OpenPlan-runner for ActivitySim jobs
- segmented demand outputs and dashboards
- logsums/accessibility extraction

### Technical notes
This phase requires choices on:

- population synthesis source
- segmentation conventions
- zone hierarchy strategy
- household/person schema normalization

### Product outcomes
OpenPlan can answer:

- how scenario changes affect mode choice,
- how destination patterns shift,
- how different household segments respond,
- how changes propagate beyond simple travel time deltas.

### Exit criteria
- one reproducible pilot geography
- one working ActivitySim package
- OpenPlan comparison UI showing segmented demand changes
- documented calibration caveats

---

## Phase 3 — MATSim dynamic simulation lane

### Goal
Add high-fidelity operational simulation.

### Scope
Build:

- ActivitySim-to-MATSim adapter
- MATSim scenario builder
- MATSim worker service/job runner
- event postprocessor
- KPI and skim extractor
- dynamic visualization outputs

### Design requirement
Keep MATSim at a service/job boundary with explicit artifacts.

### Product outcomes
OpenPlan can analyze:

- dynamic congestion response
- route/departure adaptation
- dynamic scenario operations
- advanced policy experiments

### Exit criteria
- one pilot scenario end-to-end
- stable run orchestration
- event-to-KPI postprocessing
- documented runtime envelope
- clear operator playbook

---

## Phase 4 — controlled feedback loop

### Goal
Create a real combined brain/system.

### Scope
Build:

- MATSim experienced LOS aggregation
- LOS-to-ActivitySim feedback packaging
- convergence policy
- iteration controller
- iteration comparison dashboard

### Critical warning
Do **not** implement unconstrained iterative loops early. They are expensive, fragile, and hard to explain.

### Recommendation
Start with:

- one-way runs,
- then one feedback iteration,
- then limited repeated iteration only if it measurably improves decision value.

---

## 10. Recommended service architecture

## 10.1 OpenPlan app/API
Responsibilities:

- projects/scenarios/models/runs UI
- run creation
- run status
- artifact browsing
- KPI comparison
- reporting
- permissions

## 10.2 Orchestrator service
Responsibilities:

- create run manifests
- launch stage jobs
- manage retries
- track stage dependencies
- write status and artifact metadata
- enforce quotas/runtime limits

## 10.3 AequilibraE worker
Responsibilities:

- network prep
- skims
- assignment
- accessibility outputs

## 10.4 ActivitySim worker
Responsibilities:

- package inputs
- execute model pipeline
- collect outputs
- register artifacts

## 10.5 MATSim worker
Responsibilities:

- build MATSim inputs
- run simulation
- collect events/results
- postprocess core outputs

## 10.6 Postprocessing worker
Responsibilities:

- derive common KPIs
- build map-ready layers
- summarize segment/corridor outputs
- produce report tables/charts/json

---

## 11. Storage design

## 11.1 Relational DB
Use Postgres/Supabase for:

- model metadata
- run metadata
- stage metadata
- artifact indexes
- QA/validation summaries
- KPI summaries
- permissions and tenancy

## 11.2 Object storage
Use object storage for:

- network bundles
- OMX skim cubes
- ActivitySim bundles
- MATSim bundles
- large event outputs
- intermediate tables
- report packets

## 11.3 Geospatial layer strategy
Use PostGIS or equivalent spatial warehouse storage for:

- zones
- corridors
- network summaries
- output features for maps
- QA overlays

Do not try to stuff every large engine artifact into normal app tables.

---

## 12. Calibration and validation posture

This is the hardest real-world problem.

The challenge is not merely wiring the engines. It is making outputs defensible.

## 12.1 Required validation categories
Every serious model package should track:

- input data vintage
- network completeness
- population/land use provenance
- observed counts coverage
- travel time validation
- transit validation where relevant
- mode share validation
- sensitivity checks
- known transferability limitations

## 12.2 Calibration states
Suggested states:

- prototype
- internally benchmarked
- partially calibrated
- locally calibrated
- locally validated
- production-grade for stated use case

## 12.3 Product rule
OpenPlan should never imply that a package is policy-grade if it is only a placeholder or donor model.

The UI/report layer should make calibration status explicit.

---

## 13. Licensing and governance risk

This needs real attention.

## 13.1 AequilibraE
Low-friction open license posture with attribution requirement.

## 13.2 ActivitySim
BSD-3-Clause; generally straightforward for integration.

## 13.3 MATSim
MATSim is GPL-licensed.

### Practical consequence
Before commercializing a deep MATSim-based OpenPlan offering, we need a serious review of:

- distribution model
- deployment boundaries
- service boundaries
- what is combined vs merely orchestrated
- what code we would publish or separate

### Recommendation
Treat MATSim as a more isolated engine service unless and until we have a stronger legal/packaging position.

**This is not legal advice**, but it is a real architecture constraint.

---

## 14. Runtime and infrastructure considerations

## 14.1 AequilibraE
Usually the easiest to operationalize in a cloud worker lane.

## 14.2 ActivitySim
Needs careful packaging around:

- Python environment reproducibility
- data volume
- CPU/memory scaling
- pipeline caching/checkpointing

## 14.3 MATSim
Needs more deliberate handling around:

- Java runtime
- scenario packaging
- long-running jobs
- memory footprint
- artifact size
- failure recovery
- queueing and cancellation

## 14.4 Recommended runtime posture
Use containerized workers with strict run manifests and artifact-based handoffs.

Do not make these engines execute directly in the web app process.

---

## 15. Where the moat actually is

The moat is **not** merely that OpenPlan can call three open-source engines.

The moat is that OpenPlan can do all of this in one coherent planning workflow:

- define scenarios
- version assumptions
- prepare inputs
- run the right engine tier
- track lineage
- compare results
- map outputs
- package evidence
- explain limitations
- support planning/report workflows without forcing the user into raw research code

The OpenPlan moat is the **planner-safe orchestration and evidence layer**.

---

## 16. Recommended decision

## My recommendation in one sentence
**Yes, pursue this, but do it as a staged layered system with AequilibraE first, ActivitySim second, and MATSim third.**

## Strong yes for
- AequilibraE as near-term backbone
- ActivitySim as demand brain
- OpenPlan as orchestration/evidence layer

## Conditional yes for
- MATSim as advanced engine tier
- only after we design explicit boundaries, runtime controls, and licensing posture carefully

## Strong no for
- trying to build all three deeply at once
- making MATSim the default workflow
- skipping calibration/validation governance
- hiding engine limitations from users

---

## 17. Immediate next steps if we choose to proceed

### Step 1 — write a formal ADR
Decision proposal:

- OpenPlan modeling architecture will be layered and multi-engine.
- AequilibraE is the first production modeling backend.
- ActivitySim is the second-phase demand engine.
- MATSim is a separately bounded advanced simulation engine.

### Step 2 — expand schema and orchestration design
Create a spec for:

- run stages
- artifact manifests
- engine registry
- validation packets
- pipeline status UI

### Step 3 — pick one pilot geography
Prefer a manageable geography where we can realistically validate outputs and keep runtime bounded.

### Step 4 — build AequilibraE MVP lane
Focus on:

- network bundle
- skims
- assignment
- map outputs
- report outputs

### Step 5 — define the ActivitySim adapter contract
Do the design before implementation.

### Step 6 — perform MATSim licensing/packaging review
Do not defer this until after deep buildout.

---

## 18. Suggested 30/60/90-day outline

## 30 days
- ADR written
- schema extension spec written
- artifact contract draft written
- pilot geography chosen
- AequilibraE MVP run path scoped

## 60 days
- AequilibraE worker prototype running
- skim/assignment artifacts visible in OpenPlan
- run manifests and stage tracking operational
- first reportable KPI extractors live

## 90 days
- stable AequilibraE-based package in OpenPlan
- ActivitySim packaging/adapter prototype started
- MATSim boundary/worker design completed
- validation packet framework defined

---

## 19. Final position

If OpenPlan wants to become a serious planning platform rather than only a planning UI with analysis-adjacent features, this is one of the strongest medium-term directions available.

But the key is discipline:

- make OpenPlan the planner-safe operating system,
- let AequilibraE provide fast network intelligence,
- let ActivitySim provide behavioral realism,
- let MATSim provide dynamic realism,
- and connect them through explicit artifacts, staging, and evidence rules.

That is how we build a combined brain/system **without** creating an unmaintainable modeling monster.

---

## Appendix A — internal OpenPlan references

- `docs/ops/2026-03-15-openplan-v1-command-board.md`
- `openplan/src/lib/models/catalog.ts`
- `openplan/src/lib/models/run-launch.ts`
- `openplan/supabase/migrations/20260315000023_models_module.sql`
- `openplan/supabase/migrations/20260317000025_model_runs_module.sql`

## Appendix B — research notes used for this memo

High-level external documentation reviewed during memo preparation included:

- AequilibraE project/readme and documentation pages describing:
  - transportation modeling scope
  - SQLite/SpatiaLite network posture
  - OMX support
  - skimming
  - multi-class assignment
  - graph preparation
- ActivitySim project/documentation pages describing:
  - activity-based modeling mission
  - pipeline/data-orchestration design
  - OMX/HDF5/CSV formats
  - multiprocessing/vectorized architecture
  - example models
  - tour mode choice and demand structure
- MATSim documentation/pages describing:
  - agent-based transport simulation
  - replanning / scoring / mobility simulation loop
  - extension ecosystem
  - example project and user guide references

## Appendix C — one-line decision rule

If a step improves **planning credibility, run traceability, calibration honesty, or reusable modeling infrastructure**, it is in scope. If it is just flashy engine complexity without planner value, defer it.
