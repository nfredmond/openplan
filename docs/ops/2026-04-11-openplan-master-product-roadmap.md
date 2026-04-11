# OpenPlan Master Product Roadmap

Date: 2026-04-11  
Owner: Bartholomew Hale  
Status: Canonical product roadmap  
Purpose: convert the OpenPlan platform thesis into one integrated execution roadmap covering platform core, RTP OS, Grants OS, Aerial Operations OS, Transportation Modeling OS, and the AI-enabled operations runtime.

## Executive summary

OpenPlan should become the shared operating system for small agencies, RTPAs, counties, tribes, and planning consultancies.

The product goal is not just to store planning records, generate reports, or host a page-local copilot.

The real goal is to unify the full operating truth of:
- planning,
- funding,
- modeling,
- delivery,
- compliance,
- engagement,
- and field evidence

inside one platform with one project spine, one evidence spine, one operational command layer, and one trustworthy AI runtime.

The strongest current truth is:
- **Platform core:** materially real and increasingly coherent
- **RTP OS:** strongest integrated vertical today
- **Transportation Modeling OS:** real foundations, partially integrated
- **AI operations runtime:** real foundation, early action capability now live
- **Grants OS:** still underbuilt relative to product vision
- **Aerial Operations OS:** strong external foundation, not yet truly integrated into OpenPlan

This means the next phase should optimize for:
1. **workflow completion**,
2. **cross-system integration**,
3. **shared control and stale-state propagation**,
4. **safe agent action expansion**,
5. **UX simplification and hardening**,
not for disconnected feature accumulation.

---

## 1. Product north star

OpenPlan should function like this:

- a workspace represents a real agency, consultancy, or planning environment
- projects are the canonical operating spine
- RTP cycles, grants, scenarios, models, runs, reports, controls, and field evidence all connect back to those projects
- funding posture, packet freshness, control readiness, delivery deadlines, and evidence provenance remain visible in one place
- when upstream facts change, OpenPlan truthfully propagates the impact across downstream packets, narratives, comparisons, and decision support
- an AI-enabled runtime can see the whole operation, gather outside information, recommend next actions, and perform approved work with visible auditability

That is the target product feeling:
**one coherent planning operating system, not a stack of adjacent tools.**

---

## 2. Platform architecture that must work together

## 2.1 Shared Platform Core

This is the foundation every operating system depends on.

### Canonical entities
- workspaces / agencies
- users / memberships / roles
- projects
- RTP cycles / plans / programs
- geographies / corridors / sites / AOIs
- datasets / sources / provenance records
- network packages
- scenarios / assumptions / comparison snapshots
- models / runs / evidence packets
- reports / board packets / exports
- stage gates / milestones / submittals / invoices / reimbursement controls
- risks / issues / decisions / meetings
- engagement campaigns / comments / response tracking
- artifacts / evidence bundles / share packages
- audit history

### Required platform behaviors
- role-aware access control
- one shared linked-record graph
- one shared stale-state / drift propagation model
- one shared deadline and action aggregation layer
- one shared provenance and evidence ledger
- one shared search and context assembly layer
- one shared AI runtime contract

### Current maturity
- **Status:** strong foundation, not complete
- **Current strengths:** projects, RTP cycles, reports, scenarios, models, runs, controls, packet freshness, operations summaries
- **Main gap:** universal propagation and workflow consistency across all modules

---

## 2.2 RTP OS

### Purpose
Run real RTP cycles end to end, from setup through portfolio logic, narrative assembly, packet production, public review, and adoption support.

### Required feature set
- RTP cycle registry
- chapter scaffolding and chapter workflow
- policy / action / financial elements
- constrained vs illustrative portfolios
- project prioritization rationale
- project-to-cycle linkage
- digital RTP document assembly
- public review windows and comment intake
- consultation tracking
- board packets and adoption packets
- packet freshness, drift, and release posture
- chapter / portfolio / engagement linkage to packet generation

### Current maturity
- **Status:** strongest vertical today
- **Shipped / materially real:**
  - cycle registry
  - project linkage
  - chapter shell + editing
  - RTP exports and digital document surface
  - RTP board packet integration
  - packet freshness/drift/preset logic
  - registry packet queue and trace posture
  - RTP assistant contexts and posture-aware packet guidance
  - first safe in-panel RTP packet generation/refresh execution
- **Main gaps:**
  - first packet record creation directly in panel when none exists
  - full public-review/comment-response loop
  - stronger financial-element and constrained/unconstrained operating surface
  - richer adoption / consultation package workflow
  - broader packet release workflow closure

### Acceptance criteria for “working together”
- a planner can create and manage an RTP cycle without losing project, funding, engagement, or packet context
- changes to chapter, project, or engagement posture propagate into packet freshness and release review
- the RTP registry, cycle detail, report detail, and assistant all agree on next action

---

## 2.3 Grants OS

### Purpose
Turn funding strategy, applications, awards, reimbursement, and compliance into a real operating system that writes back into projects, RTP, and delivery controls.

### Required feature set
- funding program catalog
- opportunity calendar
- pursue / monitor / skip board
- grant strategy workspace
- application package and narrative support
- award / allocation tracking
- match tracking
- reimbursement posture
- invoicing controls
- compliance milestones
- closeout workflow

### Current maturity
- **Status:** underbuilt relative to vision
- **Current strengths:** related control-room patterns exist in donor material and some OpenPlan foundations can support this
- **Main gaps:**
  - no true integrated Grants OS yet
  - no end-to-end funding opportunity → award → reimbursement → closeout loop
  - insufficient write-back into RTP financial posture and project delivery readiness

### Acceptance criteria for “working together”
- pursuing or winning a grant changes project readiness, RTP funding posture, deadlines, and packet context
- reimbursement and compliance status appear in the same control room as project and packet readiness
- grant strategy is visible as operational truth, not buried in separate trackers

---

## 2.4 Aerial Operations OS

### Purpose
Bring field evidence, measurable outputs, and mission-derived truth into the planning platform.

### Required feature set
- mission workspace
- AOIs and flight geometry
- DJI mission-planning logic and geometry support
- imagery ingest
- ODM / WebODM / NodeODM processing jobs
- QA review bundles
- measurable orthos / models / surfaces / exports
- artifact share packages
- project-linked evidence integration

### Current maturity
- **Status:** architecture-ready, not yet integrated into OpenPlan
- **Current strengths:** strong external repo posture and clear donor/canonical sources
- **Main gaps:**
  - no unified project-linked aerial evidence lane inside OpenPlan itself
  - no shared project/report/artifact flow for field evidence
  - no visible write-back from field evidence into planning packets and decision support

### Acceptance criteria for “working together”
- a project can hold aerial evidence alongside planning, grants, controls, and reports
- measurable outputs become artifacts in the same evidence chain as model outputs and engagement artifacts
- field evidence can truthfully affect project readiness, packet support, and executive review

---

## 2.5 Transportation Modeling OS

### Purpose
Provide the analytical engine of the planning platform, not a disconnected modeling lab.

### Required feature set
- model records
- network packages
- county onboarding and data validation
- scenario assumptions and shared scenario spine
- managed run orchestration
- staged execution flows
- skims / assignment outputs / KPI extraction
- comparison artifacts
- evidence packets
- layered engine strategy:
  - AequilibraE first
  - ActivitySim second
  - MATSim later

### Current maturity
- **Status:** real, partially integrated
- **Shipped / materially real:**
  - models, runs, network package concepts
  - scenario/data/indicator spine work
  - evidence packets
  - truthful engine posture and staged roadmap
  - integration into reports and comparison surfaces is underway
- **Main gaps:**
  - stronger direct write-back from scenarios/runs into RTP prioritization and financial constraint logic
  - more mature scenario comparison → packet refresh propagation
  - broader planner-facing interpretation workflows
  - tighter ties into grants and delivery decisions

### Acceptance criteria for “working together”
- scenario and run outputs directly inform RTP packet posture, project prioritization, and grant readiness
- model evidence is visible as a first-class part of the platform truth, not hidden behind technical screens
- confidence, provenance, and limitations remain explicit everywhere

---

## 2.6 AI-Enabled Operations Runtime

### Purpose
Make the platform operationally intelligent across the whole workspace, not just record-aware at one page.

### Required feature set
- app-wide operations summary
- shared command queue
- linked-record context assembly
- stale-state / drift propagation
- outside-signal ingestion with provenance
- role-aware agent action registry
- approval-aware execution
- visible audit history for actions
- conversational operations support across the full workspace

### Current maturity
- **Status:** real foundation, early action phase
- **Shipped / materially real:**
  - shared workspace operations summary
  - shared command board surfaces across multiple modules
  - Planner Agent with grouped operations and board-state shaping
  - record-aware assistant contexts for plans, programs, RTP registry, RTP cycle, reports, RTP packet reports, scenarios, models, runs
  - posture-aware RTP packet guidance
  - first safe in-panel RTP packet artifact generation/refresh execution
- **Main gaps:**
  - broader action registry beyond RTP packet generation
  - safe creation actions for missing record seams
  - outside data gathering and signal provenance
  - multi-step workflow orchestration
  - broader mutation and approval model

### Acceptance criteria for “working together”
- the assistant can answer whole-workspace questions using shared context
- the assistant can perform at least a small set of approved real actions with trustworthy auditability
- the assistant can re-ground itself after actions and explain what changed

---

## 3. Integrated feature matrix

| Area | Current status | Main gaps | Why it matters |
|---|---|---|---|
| Shared project spine | Strong | more universal propagation | everything depends on this |
| RTP cycles + packets | Strongest vertical | review/adoption/public-review completion | flagship planning loop |
| Scenario/data/indicator spine | Moderate | deeper planner-facing integration | shared analytical truth |
| Models/runs/evidence | Moderate-strong | stronger write-back into planning and grants | real analytical engine |
| Reports/artifacts/provenance | Strong | richer cross-module invalidation and release workflow | executive and board truth |
| Control room / deadlines / gates | Moderate-strong | universal use across all modules | operational coherence |
| Grants OS | Weak | needs full product lane | funding is mission-critical |
| Aerial OS integration | Weak | needs OpenPlan-native evidence linkage | field truth and verification |
| AI runtime read layer | Strong foundation | broaden context and consistency | whole-system intelligence |
| AI runtime action layer | Early | needs more safe actions and approvals | real operational leverage |
| UX coherence | Mixed | simplification and unified mental model | intuitive adoption |
| Production hardening | Mixed | full end-to-end pilot-grade QA | trust and reliability |

---

## 4. What must be true for OpenPlan to feel amazing

OpenPlan should feel amazing when:
- the user can work from one project spine without duplicating truth across tools
- RTP, grants, modeling, controls, and evidence all appear as one connected operating picture
- the assistant can reliably tell the user the highest-leverage next action
- the user can trust why the system is recommending something
- stale packets, changed evidence, funding movement, and delivery risk all show up naturally
- core workflows feel deterministic and calm rather than clever but brittle

This means the product must optimize for:
- consistency,
- clarity,
- trust,
- and flow completion.

---

## 5. Major product gaps to close next

## Gap A: Complete the RTP flagship loop
OpenPlan needs one indisputably complete flagship loop before expanding too far.

### Target loop
- create cycle
- attach projects
- manage chapters
- generate first packet record
- generate / refresh packet artifact
- review packet
- manage public review/comment posture
- revise and advance cycle
- support adoption packet flow

### Immediate gaps
- create first packet record directly from assistant/runtime
- richer release and adoption workflow closure
- stronger financial element and constrained/unconstrained surfaces
- public-review and response loop completeness

## Gap B: Build a real Grants OS
This is the single largest business/operational gap.

### Target loop
- monitor opportunities
- decide pursue / monitor / skip
- attach to program/project/RTP priorities
- manage application strategy
- track award/match
- run reimbursement/compliance/invoicing controls
- close out cleanly

## Gap C: Tighten modeling write-back into planning decisions
The modeling lane is real, but it still needs stronger practical write-back.

### Target loop
- define scenario assumptions
- run model / compare
- update project prioritization context
- refresh report packet basis
- support grant readiness and corridor comparison

## Gap D: Integrate field evidence as first-class evidence infrastructure
The aerial lane should behave like part of planning truth, not a sidecar.

## Gap E: Broaden AI runtime actions safely
The current action surface is promising, but still narrow.

### Must add
- create missing RTP packet record
- run approved multi-step planning workflows
- later grants and control-room actions
- outside-signal ingestion with provenance

---

## 6. Recommended build order for the next 4 to 8 weeks

## Phase 1: Finish the flagship Planning OS loop
**Priority:** highest  
**Duration:** immediate, 1 to 2 weeks

### Scope
- complete RTP cycle → packet record → packet artifact → review loop
- strengthen packet release workflow and post-action re-grounding
- make scenario/model changes more visibly affect packet freshness and review posture
- tighten public-review foundations where feasible

### Acceptance criteria
- a user can run the RTP packet workflow end to end inside OpenPlan
- registry, cycle detail, report detail, and assistant agree on packet posture
- first-packet and stale-packet actions work from the runtime cleanly

## Phase 2: Build Grants OS as the second real operating loop
**Priority:** very high  
**Duration:** 2 to 4 weeks

### Scope
- funding program catalog
- opportunity board and decisions
- award/match tracking
- reimbursement/compliance control layer
- write-back into project and RTP posture

### Acceptance criteria
- a grant can move from opportunity to award to compliance tracking inside OpenPlan
- the result changes project/RTP/control truth in the main platform

## Phase 3: Deepen Transportation Modeling OS integration
**Priority:** very high  
**Duration:** parallel or immediately after Phase 2

### Scope
- scenario assumptions and comparison usability
- stronger model output write-back into projects, RTP, and reports
- clearer planner-facing interpretation and confidence posture
- stronger linkage into grant strategy and packet basis

### Acceptance criteria
- model runs are not only viewable, but operationally useful to project and RTP decision support

## Phase 4: Integrate Aerial Operations OS as evidence infrastructure
**Priority:** medium-high  
**Duration:** after flagship loop and grants foundation are stable

### Scope
- mission/AOI/project linkage
- imagery ingest and processing artifacts
- measurable output bundles
- report/project evidence linkage

### Acceptance criteria
- field evidence can materially support project, packet, and control-room truth

## Phase 5: Expand AI runtime from guided actions to trusted operations
**Priority:** high and ongoing

### Scope
- action registry expansion
- approval-aware mutations
- outside-signal ingestion
- multi-step workflows
- stronger action audit and re-grounding

### Acceptance criteria
- the assistant performs useful bounded work across multiple modules, not only RTP packet actions

## Phase 6: UX simplification and integrated workflow polishing
**Priority:** mandatory before broad rollout

### Scope
- unify language for status, freshness, readiness, review, release
- reduce duplicated mental models across modules
- improve navigation between control room, records, packets, and evidence
- verify real screens and operator flows at multiple viewports

### Acceptance criteria
- a planner can use the product without understanding the architecture underneath it

## Phase 7: Pilot hardening and proof
**Priority:** before strong external claims

### Scope
- end-to-end smoke testing of the integrated loops
- proof artifacts for key workflows
- QA closure across auth, packets, grants, controls, and modeling flows

### Acceptance criteria
- the product is trustworthy enough for supervised real-world use

---

## 7. Immediate next implementation queue

These are the best next steps from today’s actual state.

### Queue 1: finish RTP assistant execution closure
- create first RTP packet record in panel when none exists
- then generate artifact
- then re-ground into release review

### Queue 2: begin Grants OS foundation inside the shared spine
- funding program catalog
- opportunity registry
- pursue / monitor / skip posture
- project/program linkage

### Queue 3: strengthen scenario/model → packet propagation
- make changed scenario/model evidence visibly affect packet posture and control-room state more broadly

### Queue 4: define Aerial integration contract
- lock the exact OpenPlan-side evidence objects, artifact links, and project/report touchpoints before UI sprawl

### Queue 5: harden the runtime action registry
- create a small canonical registry of safe read, generate, create, and refresh actions
- make approval semantics explicit and reusable

---

## 8. Non-negotiable design rules

1. **Project is the canonical spine.** Do not let grants, modeling, or aerial drift into disconnected truth stores.
2. **Shared context beats page logic.** Packet posture, deadline pressure, and evidence drift should come from shared services.
3. **Provenance beats magic.** Every outside signal, generated packet, and evidence summary must remain auditable.
4. **One operator model.** Status, readiness, freshness, review, release, and controls should mean the same thing everywhere.
5. **Workflow completion beats feature count.** A fully working loop is worth more than five half-connected modules.
6. **Truthful product posture always.** Do not overclaim modeling maturity, compliance automation, or field-evidence integration before the loops are real.
7. **UX must simplify power.** OpenPlan can be deep, but it cannot feel fragmented.

---

## 9. Bottom line

OpenPlan is now at the stage where the architecture is believable and the flagship RTP/runtime lane is materially real.

The next challenge is not invention.
The next challenge is disciplined integration.

To become an amazing fully working solution, OpenPlan now needs:
- one fully closed flagship planning loop,
- one real Grants OS loop,
- stronger modeling write-back,
- integrated field evidence,
- a broader but still trustworthy AI action runtime,
- and a major UX coherence pass that makes the whole system feel like one calm workbench.

That is how OpenPlan becomes not just powerful, but genuinely usable and hard to replace.
