# OpenPlan Canonical Architecture, Status, and Ruthless Build Plan

**Date:** 2026-04-13  
**Owner:** Bartholomew Hale  
**Executive sponsor:** Nathaniel Ford Redmond  
**Status:** Canonical April 2026 synthesis memo  
**Purpose:** define the current true state of OpenPlan, the intended integrated product architecture, and the ruthless phased build sequence required to turn OpenPlan into one coherent planning operating system.

## Executive Summary

OpenPlan should become the shared operating system for small agencies, RTPAs, counties, tribes, and planning consultancies.

The platform goal is not to accumulate isolated modules.
The goal is to unify the operating truth of:
- planning,
- funding,
- modeling,
- delivery,
- compliance,
- engagement,
- and field evidence

inside one product with:
- one shared workspace and project spine,
- one shared scenario and evidence spine,
- one shared control-room layer,
- and one trustworthy AI-enabled runtime.

### Current truth
OpenPlan is already beyond prototype theater.
It is strongest today as a **supervised pilot Planning OS** with:
- a credible shared platform core,
- a strong RTP vertical,
- real report and packet traceability,
- meaningful grants and modeling foundations,
- and an early but real operations runtime.

What it is **not** yet:
- a fully integrated all-in-one planning operating system,
- a bug-free self-serve municipal SaaS,
- a fully proven modeling platform,
- or a fully integrated aerial evidence platform.

### Core diagnosis
The main problem is no longer lack of ideas.
The main problem is **integration discipline**.

The next phase must optimize for:
1. closing full operating loops,
2. forcing cross-system write-back,
3. making stale-state and readiness semantics universal,
4. expanding the runtime only where it improves real operator leverage,
5. and making the interface calmer and more trustworthy.

---

## Product North Star

OpenPlan should feel like this:
- a workspace represents a real agency, consultancy, or regional planning environment,
- projects are the canonical operating spine,
- RTP cycles, grants, models, scenarios, runs, reports, controls, and aerial evidence all connect back to those projects,
- changes to upstream facts propagate truthfully across packet posture, grant posture, delivery controls, maps, narratives, and executive guidance,
- and the runtime can explain what changed, why it matters, and what should happen next.

The desired product feeling is:

**one coherent planning operating system, not a stack of adjacent tools.**

---

## The Integrated Architecture

OpenPlan should be treated as one shared platform core with four tightly linked operating systems on top of it, plus one control-room/runtime layer across all of them.

### 1. Shared Platform Core

This is the non-negotiable foundation.

#### Canonical objects
- workspaces / agencies
- users / memberships / roles
- projects
- RTP cycles / plans / programs
- geographies / corridors / sites / AOIs
- datasets / provenance records
- network packages
- scenarios / assumptions / comparison snapshots
- models / runs / evidence packets
- reports / board packets / exports
- stage gates / milestones / submittals / invoices / reimbursement controls
- risks / issues / decisions / meetings
- engagement campaigns / comments / consultation artifacts
- aerial missions / field artifacts / measurable outputs
- audit history

#### Required shared behaviors
- one linked-record graph
- one stale-state / drift propagation model
- one deadline and next-action aggregation layer
- one provenance and evidence ledger
- one assistant/runtime context assembly layer
- one action registry with audit trails

#### Non-negotiable rule
No module gets to invent its own meaning for:
- readiness,
- freshness,
- release,
- evidence,
- blocked status,
- or next action.

---

### 2. RTP OS

#### Purpose
Run RTP and related planning-cycle work end to end.

#### Must own
- cycle registry
- chapter scaffolding and editing
- policy, action, and financial elements
- constrained vs illustrative portfolio logic
- prioritization rationale
- packet generation, review, release, and adoption support
- public review and consultation loop

#### Must consume
- projects
- grants and funding posture
- scenarios and modeling outputs
- engagement comments and consultation records
- reports and evidence
- stage gates and deadlines

#### Must write back
- packet freshness
- review/release posture
- project prioritization context
- adoption and board-packet status
- control-room guidance

---

### 3. Grants OS

#### Purpose
Make funding strategy, award posture, reimbursement, invoicing, and compliance operational instead of spreadsheet-bound.

#### Must own
- funding program catalog
- opportunity calendar
- pursue / monitor / skip board
- application strategy workspace
- award and match posture
- reimbursement posture
- invoicing controls
- compliance milestones
- closeout workflow

#### Must consume
- project scope and readiness
- RTP priorities and financial posture
- scenario and modeling evidence
- deadlines, stage gates, and packet needs

#### Must write back
- project readiness
- RTP constrained/unconstrained posture
- deadline pressure
- reimbursement and compliance posture
- control-room guidance

---

### 4. Transportation Modeling OS

#### Purpose
Serve as the analytical engine of the platform, not a disconnected technical lab.

#### Must own
- model records
- network packages
- county onboarding and validation pipelines
- scenario assumptions
- run orchestration
- staged execution flows
- skim, assignment, KPI, and evidence outputs
- layered engine path:
  - AequilibraE first
  - ActivitySim second
  - MATSim later

#### Must consume
- projects
- geographies and corridors
- scenarios and assumptions
- datasets and network packages
- report and grant-support needs

#### Must write back
- project prioritization evidence
- RTP packet basis and drift posture
- corridor comparison evidence
- grant-readiness support
- report refresh posture
- method, caveat, and confidence signals

---

### 5. Aerial Operations OS

#### Purpose
Bring field evidence and measurable outputs into the same planning operating system.

#### Must own
- mission records
- AOIs and flight geometry
- imagery ingest
- processing jobs
- QA bundles
- measurable output packages
- share/export bundles

#### Must consume
- projects
- sites / corridors / geographies
- report and evidence requirements
- stage gates and field-verification tasks

#### Must write back
- evidence-chain posture
- project verification readiness
- report support artifacts
- delivery support and auditability
- control-room field-verification status

---

### 6. Shared Control Room and AI Runtime

#### Purpose
Tie the whole operation together across modules.

#### Must own
- workspace operations summary
- shared command queue
- linked-record context assembly
- evidence-aware recommendations
- bounded action registry
- approval-aware execution
- audit history for agent actions

#### Must consume
- all major records and posture summaries
- provenance and evidence state
- deadlines, drift, controls, and blockers
- later outside-signal ingestion

#### Must write back
- action audit history
- generated drafts and artifacts
- recommended-action state
- reviewable mutation records

---

## Current Status Assessment

### Overall posture
OpenPlan is currently a **credible supervised pilot Planning OS** that has already proven meaningful product truth in production.

### Platform-wide assessment
| Area | Current state | Read |
|---|---|---|
| Shared platform core | Moderate to strong | believable foundation, but not yet universal in behavior |
| RTP OS | Strongest | closest to a fully integrated operating loop |
| Grants OS | Moderate but under-integrated | real foundations, still not fully first-class |
| Transportation Modeling OS | Moderate | real foundations, still not writing back hard enough |
| Aerial Operations OS integration | Weak | strategically valuable, barely integrated in-product |
| Runtime / control room | Early but real | useful foundation, still too narrow |
| UX coherence | Improving | real capability, still not calm or unified enough |
| Cross-system propagation | Incomplete | strongest overall product gap |

### Plain-English scorecard
- **Platform core:** 7/10
- **RTP OS:** 8/10
- **Grants OS:** 5.5/10
- **Transportation Modeling OS:** 6/10
- **Aerial Operations OS integration:** 2.5/10
- **Runtime / control room:** 5/10
- **UX coherence / intuitive use:** 6/10
- **Cross-system “works together” truth:** 5.5/10

### Current strengths
- authenticated planning workspace continuity is real
- projects are a credible canonical spine
- RTP is the strongest integrated vertical
- reports, packet artifacts, and freshness/drift logic are materially real
- grants foundations already exist in project/program/workspace flows
- modeling foundations and scenario/data/indicator direction are real
- the runtime already has meaningful command and action patterns

### Current gaps
- shared semantics are still uneven across modules
- not every module writes back into the same control-room truth
- modeling outputs do not yet influence enough planning decisions automatically
- grants is still too distributed across local pages and partial surfaces
- aerial evidence is not yet OpenPlan-native
- the interface still feels more like capable routes than one unified workbench

---

## The Main Product Rule

Every significant state change in OpenPlan should answer five questions:
1. What changed?
2. What else is now stale or affected?
3. What packet, report, grant, control, or milestone does this affect?
4. What evidence supports that conclusion?
5. What is the next safe action?

If OpenPlan can answer those five questions consistently, the product will feel deeply integrated.
If it cannot, it will keep feeling fragmented no matter how many features are added.

---

## Ruthless Build Plan

## Phase 1. Finish the RTP flagship loop

### Objective
Turn RTP OS from the strongest vertical into the first indisputably complete operating loop inside OpenPlan.

### Why this is first
- it already has the deepest real product surface
- it is the fastest path to proving OpenPlan can close a full planning loop
- it creates the operating standard for every other OS

### Must ship
- first packet creation from live operating surfaces
- create + generate in one coherent operating flow
- shared review/release posture across registry, cycle detail, report detail, and runtime
- public-review/comment-response foundation
- scenario/model changes visibly affecting packet basis and freshness
- fresh proof packet for the RTP loop

### Acceptance criteria
- a planner can manage an RTP cycle from setup through packet review without losing project, report, scenario, or control context
- after packet creation/generation, all surfaces re-ground truthfully without stale prompts
- packet posture labels mean the same thing everywhere
- one current proof artifact demonstrates the loop end to end

### Exit rule
Do not call Phase 1 complete until RTP is the first clear example of OpenPlan closing a full operating loop.

---

## Phase 2. Make Grants OS first-class

### Objective
Turn grants from scattered funding surfaces into one shared operating system.

### Why this is second
- it is one of the largest business-value gaps
- it directly improves project readiness, RTP financial truth, and delivery controls
- much of the foundational data model already exists

### Must ship
- canonical workspace-level Grants OS surface
- opportunity calendar and decision board
- pursue / monitor / skip operating posture
- award and match tracking
- reimbursement and invoicing posture
- compliance milestone skeleton
- project and RTP write-back
- runtime/control-room integration

### Acceptance criteria
- a planner can scan, filter, and act on funding opportunities across the workspace in one lane
- pursuing or winning a grant changes project and RTP posture in visible ways
- reimbursement and compliance posture appear in the same operating truth as packet and delivery readiness
- grants guidance appears in the shared command queue, not only in local project sections

### Exit rule
Do not call Grants OS real until it writes back into the shared control room and changes planning truth outside its own page.

---

## Phase 3. Force Modeling OS write-back into planning truth

### Objective
Make modeling outputs materially affect planning decisions and artifacts instead of living in technical isolation.

### Why this is third
- the modeling foundations are already real enough to support deeper leverage
- write-back is the missing bridge between analysis and planning operations

### Must ship
- scenario/run changes causing packet drift and refresh pressure where appropriate
- comparison snapshots tied to reports and RTP context
- planner-facing interpretation surfaces with explicit caveats
- grant-readiness evidence hooks
- stronger project prioritization support from modeling outputs

### Acceptance criteria
- scenario and run outputs visibly affect RTP packet posture, project prioritization, or grant readiness
- comparison artifacts are reusable across reports and executive review surfaces
- method, caveat, and confidence signals remain visible wherever model evidence is shown
- modeling no longer feels like a disconnected lab product

### Exit rule
Do not broaden modeling claims until outputs demonstrably write back into planning truth in operator-facing surfaces.

---

## Phase 4. Integrate Aerial Operations OS through shared evidence contracts

### Objective
Make aerial work part of the same project and evidence spine instead of a side app.

### Why this is fourth
- high strategic upside
- currently weakest integrated lane
- easiest area to bloat unless object contracts are defined first

### Must ship
- canonical aerial object model:
  - mission
  - AOI
  - ingest job
  - processing job
  - QA bundle
  - measurable output bundle
  - share package
- project/report linkage rules
- evidence-ledger integration
- field-verification posture in the control room

### Acceptance criteria
- a project can hold aerial evidence alongside planning, grants, and reports
- measurable outputs become first-class artifacts in the same evidence chain as model and engagement outputs
- field evidence can affect project readiness, packet support, and executive review posture
- no second truth store is introduced for aerial operations

### Exit rule
Do not build broad aerial UI before the object contracts and write-back rules are explicit.

---

## Phase 5. Expand the control room and AI runtime

### Objective
Make the runtime a real operations layer across the platform.

### Why this is fifth
- the current assistant/runtime foundation is real, but still too narrow
- a broader runtime only becomes trustworthy after the major OS loops share one truth model

### Must ship
- shared workspace operations summary
- unified command queue across modules
- linked-record context assembly
- bounded action registry
- explicit approval semantics
- post-action re-grounding contract
- provenance-aware outside-signal ingestion

### Acceptance criteria
- a user can ask about the whole workspace, not just a current page
- the system can explain what matters, what changed, and what should happen next using shared operational truth
- bounded actions can be approved, executed, and audited in-platform
- recommendations remain evidence-aware rather than generic

### Exit rule
Do not turn the runtime into decorative chat. Every expansion must improve real operator leverage.

---

## Phase 6. UX coherence and hardening

### Objective
Make OpenPlan feel calm, unified, intuitive, and trustworthy under real work.

### Why this is sixth
- coherence matters most after the core loops are real
- otherwise the team risks polishing surfaces that will be reworked by later integration

### Must ship
- navigation that reflects the true operating systems
- worksurface + rails design posture across major screens
- consistent posture language across modules
- fewer dead-end pages and fewer local-only interpretations
- regression coverage on shared semantics and high-risk cross-module flows
- production proof refresh across flagship workflows

### Acceptance criteria
- the product feels like one workbench, not a stack of routes
- the primary operator flows are obvious without training by tribal knowledge
- freshness, readiness, evidence, and next action read consistently everywhere
- critical cross-system flows have proof and regression coverage

### Exit rule
Do not call the UX intuitive until the whole workbench supports scan, inspect, compare, and act without semantic drift.

---

## What Not To Do

To avoid scope sprawl, do **not** do the following before the above phases are closed:
- do not chase decorative feature breadth
- do not build broad new UI for weakly integrated lanes before shared contracts exist
- do not let grants, modeling, or aerial become isolated sub-products
- do not let each page invent its own readiness and freshness semantics
- do not overclaim modeling, compliance, or autonomy
- do not confuse “many routes” with “one operating system”

---

## Near-Term Execution Order

For the next serious build chapter, the build order should remain:
1. RTP loop closure
2. Grants OS first-class integration
3. Modeling write-back
4. Aerial evidence contract + integration
5. Runtime/control-room expansion
6. UX coherence + hardening

This is the cleanest path to increasing product power and product coherence at the same time.

---

## Bottom Line

OpenPlan is already a serious product.

It is not yet the fully integrated planning operating system you want, but the path is now clear.

The work ahead is not mainly invention.
It is disciplined integration:
- one project spine,
- one scenario/evidence spine,
- one control room,
- one action model,
- and four operating systems that truly write back into one another.

If the team follows the ruthless phase order in this memo, OpenPlan can become an unusually powerful and unusually coherent planning platform rather than a growing pile of impressive but disconnected tools.
