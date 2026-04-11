# OpenPlan Modeling Stack — Build Backlog and Execution Plan

**Date:** 2026-03-17  
**Owner:** Bartholomew Hale (COO)  
**Authoring support:** Iris Chen  
**Status:** ACTIVE PROPOSAL  
**Companion docs:**
- `docs/ADRs/ADR-002-multi-engine-modeling-stack.md`
- `docs/ops/2026-03-17-openplan-aequilibrae-activitysim-matsim-architecture-memo.md`
- `docs/ops/2026-03-17-openplan-modeling-stack-technical-spec.md`

## Executive objective
Build OpenPlan into a **multi-engine planning platform** that can support:

1. fast network/accessibility screening,
2. richer behavioral demand modeling,
3. advanced dynamic operations simulation,
4. evidence-backed reporting and traceable run artifacts.

As of the 2026-04-10 research synthesis, this backlog should also be understood as part of a broader **Transportation Modeling OS** inside the overall planning platform.

## Operating principle
Do **not** attempt to ship a full three-engine system in one wave.

The implementation order is:

1. **AequilibraE-first**
2. **ActivitySim integration**
3. **MATSim bounded advanced lane**
4. **controlled feedback loop**

## Scope rule
Prioritize tasks that improve one or more of the following:

1. planner trust and client-safe evidence,
2. deterministic orchestration,
3. reusable modeling infrastructure,
4. future demand/simulation extensibility,
5. practical decision value for real study areas.

If a task adds engine complexity without improving planning value, defer it.

---

## Strategic success condition
This program is a success if OpenPlan can eventually support three honest run classes:

- **Fast screening**
- **Behavioral demand**
- **Dynamic operations**

with clear provenance, explicit runtime expectations, and calibration/validation honesty.

It should also produce reusable outputs that can feed:
- RTP/project prioritization,
- scenario comparison,
- grants strategy,
- and public/report narratives where the evidence is real.

## Research-driven backlog additions (2026-04-10)

The deep research synthesis adds four durable backlog requirements around the engine sequence:

1. **Shared scenario contracts**
   - baselines, branches, assumptions, and comparison snapshots should not live only inside run-local metadata.
2. **Standards-first data posture**
   - network/data package work should stay aligned with reusable, standards-aware ingestion/export contracts where practical.
3. **Reusable indicator outputs**
   - accessibility, equity, and environmental summaries should be product artifacts, not only ad hoc postprocessing tables.
4. **Future land-use/zoning compatibility**
   - later land-use, zoning, and urban-design scenario inputs should be able to connect to this stack without forcing a full redesign.

---

## Phase 0 — Architecture lock and pilot framing

**Intent:** de-risk the direction before heavy buildout.

### P0.1 — Adopt the architecture decision
**Objective**
Make the multi-engine architecture an explicit product/engineering decision.

**Acceptance criteria**
- ADR accepted and committed
- architecture memo and technical spec committed
- implementation order locked: AequilibraE → ActivitySim → MATSim

**Output**
- accepted ADR
- linked companion documents

### P0.2 — Pick pilot geography and study type
**Objective**
Avoid building a generic platform without a proving ground.

**Acceptance criteria**
- one pilot geography selected
- one primary planning use case selected
- one fallback smaller geography selected if the first proves too heavy

**Selection criteria**
- manageable network size
- available observed data for validation
- realistic near-term planning value
- reasonable corridor/zone definition effort

**Output**
- pilot geography decision note

### P0.3 — Define the first package boundary
**Objective**
Choose the first real OpenPlan modeling package.

**Recommended first package**
- **County / corridor accessibility and assignment package** powered by AequilibraE

**Acceptance criteria**
- named package
- intended use cases documented
- required inputs documented
- expected outputs documented
- known limitations documented

### P0.4 — Licensing / packaging review for MATSim lane
**Objective**
Do not back into a licensing problem later.

**Acceptance criteria**
- short internal review note exists
- MATSim service-boundary posture is explicitly recommended or revised
- unresolved legal/packaging questions are listed rather than implied away

---

## Phase 1 — AequilibraE-first production backbone

**Intent:** ship a practical, fast, planner-valuable modeling lane.

## Track 1A — Data and network foundation

### P1A.1 — Canonical network package schema
**Objective**
Define how OpenPlan stores versioned network bundles.

**Acceptance criteria**
- network package spec documented
- version fields defined
- study area / geography linkage defined
- storage location and manifest pattern decided

### P1A.2 — Zone / corridor / connector contract
**Objective**
Standardize how zones and corridors attach to networks.

**Acceptance criteria**
- zone layer contract defined
- centroid/connector strategy documented
- corridor geometry rules documented
- QA checks listed

### P1A.3 — Ingestion + QA pipeline
**Objective**
Build a reliable prep path from raw network data into a usable model package.

**Acceptance criteria**
- raw import path identified
- QA checklist defined
- common failure cases documented
- pilot ingest test performed

## Track 1B — Execution and artifacts

### P1B.1 — Expand model run orchestration beyond thin single-run rows
**Objective**
Move from a simple `model_runs` row to staged run orchestration.

**Acceptance criteria**
- staged run schema drafted
- statuses and transitions documented
- artifact registry shape documented
- failure handling policy defined

### P1B.2 — AequilibraE worker prototype
**Objective**
Run OpenPlan-managed AequilibraE jobs outside the web app path.

**Acceptance criteria**
- worker/runtime choice documented
- job can be launched from orchestrator
- status transitions work
- output artifacts register correctly

### P1B.3 — Skim artifact generation
**Objective**
Produce reproducible skim bundles.

**Acceptance criteria**
- time-period skim outputs generated
- matrix storage pattern documented
- artifact hashing/registration works
- bundle can be retrieved by a later step

### P1B.4 — Assignment and accessibility extractors
**Objective**
Turn engine outputs into OpenPlan-native KPIs.

**Acceptance criteria**
- baseline KPI list implemented
- geometry-linked outputs available
- comparison-ready summaries generated
- report-safe outputs documented

## Track 1C — Product integration

### P1C.1 — New run-mode surface in UI
**Objective**
Expose AequilibraE-backed runs as a planner-facing run class.

**Acceptance criteria**
- run mode label chosen
- launch form fields defined
- run status UI supports queued/running/succeeded/failed
- artifact and KPI surfaces visible in model detail

### P1C.2 — Evidence packet output
**Objective**
Make the first modeling package reportable.

**Acceptance criteria**
- run manifest visible
- inputs/assumptions visible
- outputs visible
- caveats visible
- export/report packet format drafted

### Phase 1 exit criteria
- one real pilot geography runs end-to-end through AequilibraE lane
- outputs are comparison-ready
- artifacts are registered and reproducible
- OpenPlan UI can launch and inspect runs cleanly
- one client-safe internal evidence packet exists

---

## Phase 2 — ActivitySim behavioral demand lane

**Intent:** add real demand-generation depth.

## Track 2A — Inputs and packaging

### P2A.1 — Household/person schema for OpenPlan
**Objective**
Define canonical population inputs for ActivitySim packaging.

**Acceptance criteria**
- required fields listed
- provenance fields listed
- segmentation rules documented
- geography linkage documented

### P2A.2 — Land use and skim handoff contract
**Objective**
Make AequilibraE outputs consumable by ActivitySim.

**Acceptance criteria**
- OMX/CSV/HDF5 handoff contract written
- period/mode naming conventions set
- manifest fields defined

### P2A.3 — ActivitySim package builder
**Objective**
Automate preparation of ActivitySim input bundles from OpenPlan data.

**Acceptance criteria**
- package builder design documented
- config template approach selected
- versioning approach documented

## Track 2B — Execution and outputs

### P2B.1 — ActivitySim worker runtime
**Objective**
Stand up reproducible ActivitySim execution.

**Acceptance criteria**
- container/runtime approach documented
- worker launch path integrated with orchestrator
- logs and status transitions captured
- failures are supportable

### P2B.2 — Output bundle ingestion
**Objective**
Turn ActivitySim outputs into OpenPlan-native artifacts.

**Acceptance criteria**
- tours/trips/output tables register as artifacts
- KPI extractors defined
- segmented summaries generated
- scenario comparison surface planned

### P2B.3 — Behavioral KPI set
**Objective**
Define what OpenPlan shows after an ActivitySim run.

**Recommended initial KPIs**
- trip volumes by purpose
- mode shares
- VMT/VHT proxies where appropriate
- accessibility/logsum deltas where supportable
- segment-level deltas by household/person type

## Track 2C — Product integration

### P2C.1 — Behavioral demand run mode
**Objective**
Expose an honest ActivitySim-backed run class in the UI.

**Acceptance criteria**
- run mode naming chosen
- expected runtime messaging exists
- calibration caveat messaging exists
- outputs are shown in model detail and comparison views

### Phase 2 exit criteria
- one pilot geography runs through ActivitySim packaging/execution successfully
- AequilibraE skim outputs are consumed correctly
- OpenPlan can display behavioral demand deltas with clear caveats
- one internal validation/evidence packet exists

---

## Phase 3 — MATSim bounded advanced lane

**Intent:** add high-fidelity dynamic simulation without destabilizing the product.

## Track 3A — Architecture and boundaries

### P3A.1 — Lock service boundary for MATSim
**Objective**
Keep MATSim in a bounded job/service lane.

**Acceptance criteria**
- service-boundary diagram exists
- run contract defined
- artifact ingress/egress documented
- commercial packaging caveats documented

### P3A.2 — ActivitySim → MATSim adapter spec
**Objective**
Define the highest-value custom integration layer cleanly before building it.

**Acceptance criteria**
- population/plans mapping design documented
- purpose/mode/timing mapping documented
- segment metadata preservation documented
- unresolved assumptions listed explicitly

## Track 3B — Execution and postprocessing

### P3B.1 — MATSim worker prototype
**Objective**
Run MATSim jobs through OpenPlan orchestration.

**Acceptance criteria**
- worker/runtime approach documented
- launch path works
- status transitions work
- large artifact handling plan exists

### P3B.2 — Event postprocessor
**Objective**
Convert raw MATSim outputs into planner-usable artifacts.

**Acceptance criteria**
- event bundle registration works
- corridor/network summaries generate
- zonal LOS extraction path defined
- common KPI extracts exist

### P3B.3 — Dynamic operations run mode
**Objective**
Expose MATSim-backed analysis only where justified.

**Acceptance criteria**
- run mode positioned as advanced/high-fidelity
- runtime guidance shown
- validation/caveat messaging shown
- artifact views are usable

### Phase 3 exit criteria
- one pilot scenario executes through MATSim lane end-to-end
- OpenPlan can surface dynamic outputs in a usable form
- service boundary and artifact policy hold under real run conditions

---

## Phase 4 — Controlled feedback loop

**Intent:** create the true combined brain/system, carefully.

### P4.1 — Experienced LOS aggregation
**Objective**
Aggregate MATSim outputs into feedback-ready matrices and summaries.

### P4.2 — Feedback package builder
**Objective**
Produce ActivitySim-consumable feedback bundles.

### P4.3 — Iteration controller
**Objective**
Add controlled loop execution with explicit max-iteration and stop rules.

### P4.4 — Feedback comparison dashboard
**Objective**
Show what changed across iterations and whether the loop is materially useful.

### Phase 4 exit criteria
- one controlled iterative run works
- loop state is inspectable
- added decision value is demonstrable
- runtime cost is acceptable relative to value

---

## Cross-cutting workstreams

## X1 — Calibration and validation governance
**Needed across all phases**

Backlog items:
- define calibration state model
- define validation packet schema
- define per-package credibility labels
- define observed-data linkage requirements
- define report-safe disclosure rules

## X2 — Artifact and provenance governance
Backlog items:
- artifact naming convention
- hashing/versioning policy
- retention policy
- object storage layout
- reproducibility checklist

## X3 — Queueing, jobs, and supportability
Backlog items:
- queue technology selection
- retry/cancel policy
- worker observability plan
- timeout/runtime classes
- operator runbook

## X4 — Package and UX design
Backlog items:
- analysis package naming
- run mode labels
- caveat display policy
- evidence packet export surface
- comparison/report UX

---

## Recommended execution order
1. adopt ADR and technical spec
2. pick pilot geography and package
3. build staged run/artifact schema
4. build AequilibraE worker + skim/assignment lane
5. expose first run mode in UI
6. add evidence packet output
7. build ActivitySim package + worker lane
8. define and build ActivitySim → MATSim adapter
9. build MATSim worker lane
10. add controlled feedback loop only after one-way lanes are stable

---

## 30/60/90-day execution view

## 30 days
- ADR accepted
- technical spec committed
- pilot geography selected
- first package defined
- staged run/artifact schema designed
- AequilibraE worker MVP scoped

## 60 days
- AequilibraE run path working for pilot geography
- artifact registry live
- run status UI upgraded
- first KPI extraction layer live
- first internal evidence packet generated

## 90 days
- AequilibraE lane stable enough for repeated pilot use
- ActivitySim package builder prototype started or running
- calibration packet framework defined
- MATSim service-boundary and adapter design completed

---

## Risks and mitigations

### Risk: trying to ship all three engines at once
**Mitigation:** strict phase gating

### Risk: overbuilding infrastructure before first useful run
**Mitigation:** pilot package and pilot geography first

### Risk: unclear credibility of outputs
**Mitigation:** calibration/validation packet requirement and caveat labeling

### Risk: MATSim complexity overwhelms product velocity
**Mitigation:** keep MATSim advanced-only and bounded

### Risk: architecture drifts into ad hoc engine coupling
**Mitigation:** artifact contracts and staged orchestration are mandatory

---

## Decision rule
If a task improves **planner value, reproducibility, honest model governance, or future multi-engine extensibility**, do it.

If it mostly increases engine sophistication without improving decision support or supportability, defer it.
