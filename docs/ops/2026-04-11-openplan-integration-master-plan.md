# OpenPlan Integration Master Plan

**Date:** 2026-04-11  
**Owner:** Bartholomew Hale  
**Status:** Canonical integration plan  
**Purpose:** define how OpenPlan becomes one coherent planning operating system where platform core, RTP OS, Grants OS, Aerial Operations OS, Transportation Modeling OS, and the AI-enabled runtime work together instead of maturing as disconnected feature lanes.

## Executive Summary

OpenPlan already has a real platform core and one strong flagship vertical.

Current truth:
- **Platform core:** real and increasingly coherent
- **RTP OS:** strongest integrated vertical today
- **Transportation Modeling OS:** real foundations, partially integrated
- **AI-enabled runtime:** real foundation, early action posture
- **Grants OS:** materially underbuilt relative to business value
- **Aerial Operations OS:** strategically valuable but not yet OpenPlan-native
- **UX coherence and hardening:** improving, not yet calm enough

The next challenge is not invention.
The next challenge is disciplined integration.

OpenPlan should now be built toward one product feeling:
**a shared operating system where planning, funding, modeling, delivery, compliance, engagement, and field evidence stay connected through one project spine, one evidence spine, one control room, and one trustworthy action layer.**

---

## 1. Product North Star

OpenPlan should become the operating system for:
- small agencies
- counties
- tribes
- RTPAs / transportation commissions
- planning consultancies

The platform should unify the full operating truth of:
- projects
- RTP cycles
- funding strategy and awards
- scenarios and modeling
- reports and board packets
- milestones, submittals, invoices, and compliance posture
- engagement and consultation
- aerial and field evidence
- audit and provenance history

The product should feel like this:
- one workspace represents a real agency or consultancy environment
- one project is the canonical operating spine
- RTP, grants, modeling, controls, reports, engagement, and field evidence all connect back to that spine
- when upstream facts change, downstream packet posture, readiness, narratives, and executive guidance update truthfully
- the runtime can explain what matters, why it matters, and what should happen next

---

## 2. Architecture Decision

## Decision
OpenPlan should remain a **modular monolith with specialized workers**, not a microservices estate.

## Why
This product is still in the phase where:
- shared record integrity matters more than independent deployment
- integration speed matters more than service isolation
- module boundaries are still being refined through real workflow closure
- shared stale-state, provenance, and action semantics must stay consistent

## Architecture posture
- **Main app:** one Next.js + Supabase application as the canonical system of record
- **Specialized workers:** separate execution lanes only where compute or orchestration demands it, especially for modeling, county onboarding, and later imagery processing
- **Shared contracts:** all operating systems must use common platform objects, shared propagation logic, shared audit, and shared runtime action semantics

## Architectural rule
**Workers may execute specialized jobs. They may not become separate truth stores.**

---

## 3. Shared Platform Core

## Canonical objects
The following objects must remain platform-level and reusable across all operating systems:
- workspaces
- users, memberships, roles
- projects
- RTP cycles, plans, programs
- geographies, corridors, sites, AOIs
- datasets and provenance records
- network packages
- scenarios, assumptions, intervention records, comparison snapshots
- models, runs, evidence packets
- reports, exports, board packets
- milestones, submittals, invoices, reimbursement controls, stage gates
- risks, issues, decisions, meetings
- engagement campaigns, comments, consultation artifacts
- aerial missions, imagery-derived artifacts, measurable outputs
- audit and evidence history

## Required shared behaviors
- one linked-record graph
- one stale-state / drift propagation model
- one deadline and next-action aggregation layer
- one provenance and evidence ledger
- one control-room posture model
- one assistant/runtime context assembly layer
- one action registry with audit trails

## Non-negotiable rule
**No module gets to invent its own meaning for readiness, freshness, review, release, evidence, or next action.**

---

## 4. Operating-System Integration Model

## 4.1 RTP OS
### Purpose
Run RTP and related plan-cycle work end to end.

### Must own
- cycle registry
- chapter scaffolding and editing
- policy, action, and financial elements
- constrained vs illustrative portfolio logic
- project prioritization rationale
- packet generation, review, release, and adoption support
- public review and consultation loops

### Must consume from shared core
- projects
- scenarios and comparison outputs
- reports and evidence
- grants and funding posture
- engagement comments and consultation records
- stage gates and deadlines

### Must write back into shared core
- packet freshness
- chapter readiness
- project prioritization posture
- adoption/review status
- executive and board packet state

## 4.2 Grants OS
### Purpose
Make funding strategy and delivery controls operational, not spreadsheet-bound.

### Must own
- funding program catalog
- opportunity calendar
- pursue / monitor / skip decisions
- application strategy workspace
- award, match, and reimbursement posture
- invoicing and compliance milestones
- closeout workflow

### Must consume from shared core
- project scope and readiness
- RTP priorities and constrained/unconstrained posture
- scenario and modeling evidence
- reports, deadlines, stage gates, and packet needs

### Must write back into shared core
- project readiness
- RTP financial posture
- deadline pressure
- compliance and reimbursement controls
- control-room guidance

## 4.3 Aerial Operations OS
### Purpose
Bring field evidence and measurable outputs into the planning operating system.

### Must own
- mission records
- AOIs and flight geometry
- imagery ingest
- processing jobs
- QA bundles
- measurable output packages
- share/export bundles

### Must consume from shared core
- projects
- sites/corridors/geographies
- report/evidence requirements
- stage gates and field-verification tasks

### Must write back into shared core
- evidence-chain posture
- report support artifacts
- project verification readiness
- deliverable support and auditability

## 4.4 Transportation Modeling OS
### Purpose
Serve as the analytical engine of the platform, not a disconnected technical lab.

### Must own
- model records
- network packages
- onboarding and validation pipelines
- scenario assumptions and run orchestration
- staged execution flows
- skim, assignment, KPI, and evidence outputs
- engine path discipline:
  - AequilibraE first
  - ActivitySim second
  - MATSim later

### Must consume from shared core
- projects
- geographies and corridors
- scenarios and assumptions
- datasets and network packages
- report and grant-support needs

### Must write back into shared core
- project prioritization context
- RTP packet basis
- corridor comparison evidence
- grant readiness evidence
- report refresh posture
- explicit method, caveat, and confidence signals

## 4.5 AI-Enabled Operations Runtime
### Purpose
Let users interact with the whole operation instead of one page at a time.

### Must own
- workspace operations summaries
- shared command queue
- context assembly across linked records
- evidence-aware recommendations
- bounded action registry
- approval-aware mutation flows

### Must consume from shared core
- all major records and posture summaries
- provenance and evidence state
- deadlines, drift, controls, and blockers
- later outside-signal ingestion

### Must write back into shared core
- action audit history
- generated artifacts and drafts
- explicit recommended-action state
- reviewable mutation records

---

## 5. Current Maturity Assessment

| Area | Current state | Read |
|---|---|---|
| Shared platform core | Moderate to strong | believable foundation, not yet universal in behavior |
| RTP OS | Strongest | flagship vertical, nearest to full loop |
| Grants OS | Weak | biggest business and operational gap |
| Aerial OS integration | Weak | strong strategic upside, weak in-product integration |
| Modeling OS | Moderate | real foundations, still not writing back hard enough |
| Reports and provenance | Strong | one of the clearest truth-preserving assets |
| Control-room layer | Moderate | strong pattern, not yet universal |
| Runtime read layer | Moderate to strong | shared summary and context work is real |
| Runtime action layer | Early | promising, still narrow |
| UX coherence | Mixed | useful, but not yet one calm workbench |
| Reliability and QA | Mixed | some strong proof lanes, not yet full integrated regression closure |

## Blunt read
OpenPlan is already credible as a supervised-pilot planning OS.
It is not yet a fully integrated planning/funding/modeling/field-evidence operating system.

---

## 6. Integrated Feature Matrix

| System | Must-have integrated features | Current posture | Main gap |
|---|---|---|---|
| Platform core | linked records, shared graph, shared provenance, deadlines, audit, permissions | real | universal propagation and consistency |
| RTP OS | cycles, chapters, portfolios, packet generation/review/release, public review, adoption support | strong | full workflow closure |
| Grants OS | opportunities, pursue/monitor/skip, applications, awards, match, reimbursement, closeout | weak | whole operating loop missing |
| Aerial OS | missions, AOIs, ingest, processing, QA, measurable outputs, share packages | weak inside app | not OpenPlan-native yet |
| Modeling OS | scenarios, assumptions, networks, runs, comparisons, KPIs, evidence packets | moderate | practical write-back into decisions |
| Reports | packet generation, evidence chain, provenance, refresh posture, exports | strong | broader cross-module invalidation and release consistency |
| Control room | next actions, deadlines, readiness, blockers, stage gates, artifact freshness | moderate | common semantics across all modules |
| Runtime | workspace brief, command queue, recommendations, safe actions, audit trail | early but real | broader actions and approval model |
| UX | worksurface, rails, inspector, unified status language, low-fragmentation navigation | mixed | calmness and consistency |

---

## 7. Dependency Map

## Foundational dependencies
These must be treated as upstream shared infrastructure:
1. shared project spine
2. shared scenario, data, and indicator spine
3. shared provenance and evidence ledger
4. shared control-room posture model
5. shared runtime action registry
6. shared status vocabulary

## Critical downstream dependencies

### RTP depends on
- projects
- reports
- scenarios/comparisons
- packet freshness logic
- engagement inputs
- grants/funding posture

### Grants depends on
- projects
- programs
- RTP priorities
- controls/deadlines/stage gates
- reports/evidence
- scenario/model outputs where relevant

### Aerial depends on
- projects
- geographies/sites/AOIs
- evidence/artifact contracts
- reports and control-room needs

### Modeling depends on
- scenarios/assumptions
- network packages
- geographies/corridors
- datasets/provenance
- report and packet consumers
- grant and project consumers

### Runtime depends on
- all posture summaries being shared and trustworthy
- permissions being explicit
- audit model being universal

## Sequencing rule
**Do not build downstream module-specific automation on top of weak shared semantics. Tighten the shared contracts first.**

---

## 8. What Must Happen Next

## Priority 1: close the RTP flagship loop
### Why
This is the nearest thing to a complete operating-system loop already in motion.

### Required closure
- create first packet record when none exists
- generate/refresh packet artifact from the same operating flow
- re-ground packet posture after action
- tighten review/release logic
- complete public review and response posture
- complete adoption-support flow

### Success condition
A planner can run an RTP cycle packet workflow end to end without losing project, scenario, evidence, or control context.

## Priority 2: build the Grants OS foundation
### Why
This is the largest business-value gap.

### First build slice
- funding program catalog
- opportunity registry
- pursue / monitor / skip posture
- project/program linkage
- award and match posture
- reimbursement/compliance control scaffolding

### Success condition
Grant activity visibly changes project, RTP, and control-room truth instead of living in a side tracker.

## Priority 3: force modeling write-back into planning truth
### Why
The modeling lane must become operationally useful, not just technically impressive.

### First build slice
- scenario/run outputs must change packet posture
- project prioritization context must reflect model evidence
- grant readiness must be able to consume model evidence
- report refresh logic must react to changed model/scenario basis

### Success condition
A changed scenario or model run creates visible, auditable consequences across projects, RTP, reports, and grants.

## Priority 4: define and integrate Aerial as evidence infrastructure
### Why
This is strategic differentiation, but only if it becomes part of the planning truth spine.

### First build slice
- define canonical mission, ingest, processing, QA, measurable-output, and evidence-link contracts
- link those objects to projects and reports
- surface aerial evidence in the shared evidence chain and control room

### Success condition
Field evidence meaningfully affects report support, project readiness, and executive review.

## Priority 5: broaden runtime actions safely
### Why
The app should be operationally intelligent, not just record-aware.

### First build slice
- safe creation actions
- refresh actions
- evidence attachment actions
- structured draft-generation actions
- bounded multi-step workflows
- explicit approval semantics

### Success condition
The runtime can perform useful work across multiple modules with visible auditability and trustworthy re-grounding.

## Priority 6: run the UX coherence pass
### Why
The product will not feel amazing until it feels calm.

### First build slice
- unify status language
- unify command-board behavior
- simplify navigation between project, controls, evidence, packets, and records
- reduce page-local semantic drift
- verify all critical screens at real viewports

### Success condition
A planner can use the system without needing to understand the architecture underneath it.

---

## 9. Phase Plan

## Phase 1, 1 to 2 weeks
### Objective
Finish the flagship RTP operating loop.

### Deliverables
- first packet creation from live operating surfaces
- end-to-end packet generation and refresh closure
- post-action re-grounding
- tighter release/review posture
- public review foundation tightening

### Acceptance criteria
- registry, cycle detail, report detail, and runtime all agree on packet posture
- a new cycle can move from setup to usable packet state cleanly

## Phase 2, 2 to 4 weeks
### Objective
Build Grants OS as the second real operating loop.

### Deliverables
- funding catalog
- opportunity board
- pursue/monitor/skip workflow
- award and match records
- reimbursement/compliance controls
- project and RTP write-back

### Acceptance criteria
- opportunity-to-award posture can be tracked inside OpenPlan
- resulting funding truth changes project and RTP readiness

## Phase 3, parallel or immediately after Phase 2
### Objective
Deepen Transportation Modeling OS integration.

### Deliverables
- stronger scenario usability
- better planner-facing interpretation
- model-to-project/RTP/report/grant write-back
- clearer confidence and caveat surfaces

### Acceptance criteria
- model outputs materially influence downstream decision support

## Phase 4
### Objective
Integrate Aerial Operations OS as first-class evidence infrastructure.

### Deliverables
- aerial object model and contracts
- project/report evidence linkage
- measurable-output artifact surfaces
- control-room evidence posture integration

### Acceptance criteria
- aerial evidence is visible in the same evidence chain as reports and modeling outputs

## Phase 5
### Objective
Expand AI-enabled runtime from guidance to trusted bounded operations.

### Deliverables
- action registry
- approval-aware mutation flows
- better audit history
- broader cross-module action coverage

### Acceptance criteria
- the runtime performs approved work safely and can explain what changed

## Phase 6
### Objective
Platform-wide UX coherence and simplification.

### Deliverables
- shared operator language
- calmer workbench behavior
- reduced module fragmentation
- critical-flow viewport QA

### Acceptance criteria
- the platform feels like one operating system, not several adjacent tools

## Phase 7
### Objective
Pilot hardening and proof.

### Deliverables
- integrated smoke coverage
- proof packets for core loops
- bug-bash closure on flagship workflows
- explicit known-issues register and closeout rhythm

### Acceptance criteria
- supervised real-world pilot use can proceed with honest confidence

---

## 10. Acceptance Criteria for the Fully Working Integrated Solution

OpenPlan is approaching the intended standard when all of the following are true:

### Platform coherence
- one project can hold planning, funding, modeling, controls, engagement, reports, and field evidence without truth duplication
- the same evidence and posture are visible across all major surfaces

### Cross-system propagation
- changed funding posture affects project, RTP, controls, and executive guidance
- changed scenario/model posture affects packets, prioritization, reports, and grants
- changed field evidence affects report support and project readiness

### Runtime capability
- the assistant can answer workspace-wide operational questions
- the runtime can safely perform bounded real actions
- every action is auditable and re-grounded after execution

### UX quality
- a planner can understand what matters next quickly
- statuses mean the same thing everywhere
- the app feels calm, dense, and operational rather than fragmented

### Reliability
- core workflows have repeatable smoke coverage
- artifacts and provenance remain trustworthy
- no known blocker remains in flagship loops

---

## 11. Quality Gates

## Build-quality standard
Do not use “bug free” as a vague aspiration.
Use this operating standard instead:
**zero known blockers in the integrated flagship workflows, plus explicit evidence for core loops.**

## Required quality gates for each major loop
- local workflow validation
- authenticated production smoke
- regression harness coverage for core paths
- provenance/evidence verification
- action audit verification
- multi-viewport UI review
- known-issues register with owner and disposition

## Required proof loops
At minimum, maintain current proof for:
- RTP packet flow
- project/control-room flow
- grant opportunity and award flow once built
- scenario/model write-back flow
- aerial evidence linkage flow once built
- runtime mutation and re-grounding flow

---

## 12. Not-Now List

These are important, but should not be allowed to fragment the current build wave.

## Defer for now
- premature microservices decomposition
- a giant generic scenario editor before one narrow branch workflow is fully proven
- broad self-serve launch claims
- overclaiming behavioral-demand readiness before ActivitySim proof is real
- overclaiming legal-grade LAPM automation before compliance loops are materially real
- building a decorative AI assistant layer without stronger action and provenance foundations
- field-ops UI sprawl before aerial contracts are defined
- deep LUTI/zoning simulation productization before the scenario spine and planning loops are stable
- advanced MATSim work before AequilibraE and scenario write-back are operationally useful

## Decision rule
If a feature does not improve:
- workflow completion,
- cross-system integration,
- trustworthy propagation,
- runtime leverage,
- or UX coherence,
then it should wait.

---

## 13. Bottom Line

OpenPlan is close to a powerful integrated operating system in structure, but not yet in full workflow closure.

To become the amazing, intuitive, hard-to-replace solution we want, the next sequence is clear:
1. finish RTP as a complete flagship loop,
2. build a real Grants OS,
3. make modeling outputs change planning truth everywhere they should,
4. integrate aerial as evidence infrastructure,
5. broaden the runtime safely,
6. and run the UX coherence and proof-hardening pass before broad claims.

That is the path from a strong supervised-pilot Planning OS to the full shared planning operating system Nathaniel actually wants.
