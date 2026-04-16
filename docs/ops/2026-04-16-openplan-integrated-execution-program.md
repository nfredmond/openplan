# OpenPlan Integrated Execution Program

**Date:** 2026-04-16  
**Owner:** Bartholomew Hale  
**Executive sponsor:** Nathaniel Ford Redmond  
**Status:** Canonical execution program for the next build chapter  
**Purpose:** turn the current OpenPlan architecture, sprint notes, and execution board into one concrete program with exact epics, build order, owners, acceptance criteria, proof obligations, and stop-rules.

## Executive Summary

OpenPlan already has enough real product truth to justify serious execution.

Current reality:
- the app is not concept vapor,
- the architecture direction is right,
- the platform core is credible,
- RTP is the strongest integrated lane,
- grants and aerial are underbuilt relative to vision,
- modeling is real but still not consequential enough in downstream planning truth,
- and the runtime is promising but not yet authoritative.

### Current grounded health read
As of this execution-program date:
- local **lint passes with warnings only**
- local **tests pass**
- local **production build passes**
- the app already exposes real routes for:
  - dashboard
  - projects
  - plans
  - programs
  - RTP
  - reports
  - grants
  - models
  - scenarios
  - engagement
  - county runs
  - aerial APIs

This means the next challenge is not idea generation.
It is **integration discipline**.

## Program thesis

OpenPlan wins if it becomes one shared operating system where:
- the **project** is the canonical spine,
- the **scenario and evidence chain** is shared,
- the **control room** is authoritative,
- and every major subsystem writes back into one operational truth.

The product loses if it becomes:
- one good RTP tool,
- one decent grant tracker,
- one interesting modeling lab,
- one separate drone app,
- and one decorative AI layer.

---

## The operating rule set

### Rule 1. Workflow completion beats feature count
One fully closed loop is worth more than five partial modules.

### Rule 2. Shared semantics are mandatory
The following terms must mean one thing everywhere:
- readiness
- freshness
- blocked
- release
- evidence
- next action
- review
- current
- stale

### Rule 3. No second truth stores
Workers may execute specialized jobs.
They may not become separate product truth stores.

### Rule 4. Project is the canonical spine
Grants, modeling, reports, controls, engagement, and aerial evidence must all attach back to project truth.

### Rule 5. Provenance beats magic
Every generated artifact, outside signal, and evidence-backed recommendation must remain auditable.

### Rule 6. The runtime must be useful, not theatrical
Every assistant/runtime expansion must improve real operator leverage.

### Rule 7. Do not broaden scope faster than we close loops
If a slice does not improve:
- workflow completion,
- cross-system propagation,
- runtime leverage,
- or UX coherence,
it is not a priority.

---

## Current state scorecard

| Area | Score | Blunt read |
|---|---:|---|
| Shared platform core | 7/10 | strong enough to build on, not yet universal |
| RTP OS | 8/10 | strongest vertical, nearest to full loop |
| Grants OS | 5.5/10 | foundations exist, still not first-class |
| Transportation Modeling OS | 6/10 | real, but downstream leverage still too weak |
| Aerial Operations OS integration | 2.5/10 | strategically valuable, weak in-product integration |
| Runtime / control room | 5/10 | meaningful foundation, still narrow |
| UX coherence | 6/10 | useful, not yet calm or unified |
| Cross-system write-back | 5.5/10 | biggest platform weakness |

### Present engineering health note
- `npm run lint` passes with warnings only.
- `npm test` passes.
- `npm run build` passes.
- There are still repo hygiene items, but no immediate sign that the current app is structurally unstable.

### Present product truth
OpenPlan is already a **credible supervised-pilot Planning OS**.
It is **not yet** the fully integrated planning, grants, modeling, compliance, engagement, and aerial operating system described by the long-term vision.

---

## Program objective

Over the next build chapter, OpenPlan should achieve all of the following:

1. **One indisputably complete flagship RTP loop**
2. **One real Grants OS loop with write-back**
3. **One consequential modeling-to-planning write-back path**
4. **One first-class aerial evidence contract and first in-product linked evidence path**
5. **One stronger workspace control room and bounded action runtime**
6. **One calmer, more intuitive workbench experience across touched surfaces**

---

## Canonical epic register

## Epic 1. RTP flagship loop closure
**Priority:** P0  
**Primary owner:** Iris Chen  
**Planning QA:** Elena Marquez  
**Support:** Mateo Ruiz, Bartholomew Hale

### Goal
Make RTP OS the first indisputably complete operator loop in OpenPlan.

### Scope
- first packet record creation from live operating surfaces
- create + generate + refresh in one coherent path
- stable post-action re-grounding
- normalized packet review and release semantics
- public review and comment-response foundation
- scenario/model changes visibly affecting packet-basis posture

### Key seams
- RTP registry
- RTP cycle detail
- report detail
- packet queues
- runtime guidance
- packet generation routes and helpers

### Acceptance criteria
- a planner can move from no packet to generated packet to review posture without losing context
- the registry, cycle detail, report detail, and runtime all agree on packet status
- the system stops recommending first-packet creation after success
- a relevant scenario/model change can mark packet basis stale or refresh-recommended
- at least one bounded public review / response path is materially real

### Proof required
- focused tests on first-packet create/generate/re-grounding
- browser-level smoke on RTP flagship flow
- refreshed RTP proof packet under `docs/ops/`

### Exit rule
Do not leave this epic half-done.
RTP must become the reference loop for the rest of the platform.

---

## Epic 2. Grants OS first-class operating lane
**Priority:** P0 after RTP flagship closure  
**Primary owner:** Owen Park  
**Implementation owner:** Iris Chen  
**Support:** Elena Marquez, Bartholomew Hale

### Goal
Turn grants from scattered funding surfaces into one real operating system.

### Scope
- workspace funding program catalog
- opportunity registry and calendar posture
- pursue / monitor / skip board
- project and program linkage
- award posture
- match posture
- reimbursement posture
- invoicing controls
- compliance milestone skeleton
- closeout posture

### Required write-back
Grants must write back into:
- project readiness
- RTP constrained / unconstrained posture
- deadline pressure
- reimbursement and compliance controls
- control-room next actions

### Acceptance criteria
- a planner can work a grant queue from one workspace surface
- pursuing, winning, or delaying a grant changes project and RTP truth outside `/grants`
- reimbursement and compliance posture show up in shared operations summaries
- grants pressure is visible in the workspace command queue

### Proof required
- route and helper tests for grant decisions and write-back
- browser smoke on `/grants`, linked project, and linked RTP surfaces
- one proof memo showing opportunity → decision → downstream posture change

### Exit rule
Grants is not “real” until it visibly changes truth outside its own page.

---

## Epic 3. Modeling write-back into planning truth
**Priority:** P0.5  
**Primary owner:** Priya Nanduri  
**Implementation owner:** Iris Chen  
**Support:** Elena Marquez

### Goal
Make modeling operationally consequential rather than technically isolated.

### Scope
- scenario and run changes affecting packet basis where appropriate
- comparison snapshots reusable across more than one planning surface
- project prioritization context enriched by model evidence
- grant-readiness summaries able to consume model-backed evidence
- planner-facing interpretation with explicit method/caveat/confidence language

### Engine path discipline
- AequilibraE = first practical assignment and screening backbone
- ActivitySim = behavioral-demand layer after the screening lane is stable
- MATSim = later advanced simulation tier, not current priority

### Acceptance criteria
- at least one model/scenario change causes visible downstream planning-state change
- at least one grant or prioritization surface consumes model evidence truthfully
- caveats and confidence remain explicit wherever model evidence appears
- modeling no longer feels like a separate technical lab product

### Proof required
- focused tests on packet-basis invalidation and comparison reuse
- one end-to-end proof showing run change → downstream planning effect
- bounded claim memo describing safe current modeling posture

### Exit rule
Do not broaden modeling claims until downstream write-back is real and proven.

---

## Epic 4. Aerial Operations OS as evidence infrastructure
**Priority:** P1  
**Primary owner:** Bartholomew Hale  
**Implementation owner:** Iris Chen  
**UI support:** Mateo Ruiz

### Goal
Make aerial work part of the same project and evidence spine rather than a side product.

### Canonical objects
- mission
- AOI
- ingest job
- processing job
- QA bundle
- measurable output bundle
- share package

### Scope
- define the OpenPlan-native object model
- define project linkage rules
- define report linkage rules
- integrate with evidence ledger and operations truth
- surface field-verification posture in the control room

### Acceptance criteria
- at least one project can hold first-class aerial evidence records
- at least one report can see aerial evidence as linked support
- field evidence affects project readiness or report support posture
- no separate “drone truth model” appears inside OpenPlan

### Proof required
- canonical contract memo
- schema or application-layer implementation proof
- one linked project/report evidence smoke path

### Exit rule
Do not build broad aerial UI before the contracts are explicit and linked.

---

## Epic 5. Workspace control room and bounded runtime
**Priority:** P1  
**Primary owner:** Iris Chen  
**Product owner:** Bartholomew Hale  
**Support:** Priya Nanduri, Owen Park

### Goal
Make the workspace control room and runtime authoritative across modules.

### Scope
- stronger workspace operations summary
- unified command queue across RTP, grants, reports, controls, evidence, and modeling posture
- canonical action registry
- approval-aware action framing
- post-action re-grounding contract
- visible action audit history
- later, outside-signal ingestion with provenance

### Canonical action classes
- read
- create
- refresh
- generate
- attach evidence
- propose status update
- run bounded multi-step workflow

### Acceptance criteria
- a user can understand the most important next actions from one workspace-level view
- the runtime can explain what changed and what should happen next using shared truth
- after major actions, the app and runtime re-ground cleanly without stale confusion
- at least a small bounded set of actions is truly executable and auditable

### Proof required
- tests on action registry and re-grounding helpers
- smoke on workspace command queue + one executed action path
- audit trail artifact in docs or screenshots

### Exit rule
Do not let the runtime become decorative chat.

---

## Epic 6. UX coherence and integrated hardening
**Priority:** P1, but continuous  
**Primary owner:** Mateo Ruiz  
**Implementation support:** Iris Chen  
**Product QA:** Elena Marquez, Bartholomew Hale

### Goal
Make touched surfaces feel like one calm workbench.

### Scope
- left rail / worksurface / inspector consistency
- unified status language across touched modules
- fewer dead-end pages and route-local interpretations
- calmer next-action posture
- multi-viewport verification on flagship flows
- known-issues register for integrated loops

### Acceptance criteria
- touched screens look and behave like one operating system
- primary next actions are obvious
- evidence, freshness, and readiness language is consistent
- critical integrated flows have current proof and no known blocker bugs

### Proof required
- screenshot review at multiple viewports
- known-issues register with owner and disposition
- refreshed integrated proof bundle

### Exit rule
Do not call the UX intuitive until scan, inspect, compare, and act feel natural across modules.

---

## Build sequence

## Wave 1. RTP flagship closure
**Target:** immediate  
**Outcome:** one fully closed flagship planning loop

## Wave 2. Grants OS foundation and write-back
**Target:** immediately after Wave 1  
**Outcome:** one real funding operating lane that changes platform truth

## Wave 3. Modeling write-back
**Target:** overlaps late Wave 2 or starts right after  
**Outcome:** one credible analytical engine with visible downstream consequences

## Wave 4. Aerial evidence contract and first linked slice
**Target:** after shared write-back patterns are stable  
**Outcome:** first OpenPlan-native field evidence infrastructure

## Wave 5. Runtime action expansion and control-room unification
**Target:** after shared semantics are trustworthy  
**Outcome:** one bounded, auditable workspace runtime

## Wave 6. UX coherence and proof hardening
**Target:** always active, heaviest after Waves 1–5  
**Outcome:** a calmer and harder-to-break operator workbench

---

## Immediate next 12 tickets

These are the actual next tickets, in order.

1. Close RTP first-packet create → generate → re-ground path everywhere it appears.
2. Normalize RTP packet review / stale / blocked / released semantics across registry, detail, report, and runtime.
3. Land bounded public review / comment-response foundation for RTP.
4. Make scenario/run changes visibly affect packet-basis posture.
5. Refresh the RTP flagship proof packet.
6. Harden `/grants` as the canonical workspace operating surface.
7. Build opportunity registry plus pursue / monitor / skip decisions.
8. Add award, match, reimbursement, and compliance posture skeletons.
9. Force grant posture to write back into project, RTP, and control-room truth.
10. Reuse comparison/model evidence in project prioritization and grant-readiness surfaces.
11. Define the aerial evidence object contract and first linked project/report path.
12. Formalize the action registry and post-action re-grounding contract for the workspace runtime.

---

## Quality gates

## Engineering gates
Every meaningful checkpoint should pass:
- relevant focused tests
- broader regression tests if shared helpers changed
- build
- browser verification on touched flagship flows

## Product truth gates
At each checkpoint ask:
- Did this close a real loop?
- Did this improve cross-system write-back?
- Did this remove semantic drift or create more of it?
- Can we prove the new claim?
- Did we accidentally broaden scope without integration value?

## Ship-quality standard
Do not use “bug free” as a vague label.
Use this standard instead:

**zero known blocker bugs in flagship integrated workflows, plus current proof artifacts for the claimed behavior**

---

## Not-now list

Explicitly defer these unless they directly unblock active epics:
- premature microservices splitting
- broad public self-serve launch work
- broad LAPM/legal-grade compliance automation claims
- decorative AI assistant expansion detached from real actions
- broad aerial UI before object contracts exist
- large MATSim expansion before AequilibraE write-back is operationally useful
- speculative land-use / LUTI breadth before the shared scenario spine and planning loops are stable
- cosmetic redesign work that does not improve operator clarity or integration truth

---

## Management dashboard, plain English

If Nathaniel asks “what are we doing right now?”, the honest answer should be:

1. finishing RTP until it is indisputably complete,
2. turning grants into a real operating system,
3. making modeling outputs change planning truth,
4. attaching aerial evidence to the same project and report spine,
5. strengthening the shared control room and bounded runtime,
6. then hardening the whole thing until it feels calm and trustworthy.

---

## Bottom Line

OpenPlan does not need a new vision memo.
It needs a disciplined execution chapter.

The winning path is now clear:
- one project spine,
- one evidence spine,
- one control room,
- one shared status language,
- one flagship RTP loop finished properly,
- then grants,
- then modeling write-back,
- then aerial evidence,
- then runtime expansion,
- then a coherence and hardening pass.

If we follow that order ruthlessly, OpenPlan can become exactly what it should be:
**a shared planning operating system that small agencies, counties, tribes, RTPAs, and planning consultancies do not want to work without.**
