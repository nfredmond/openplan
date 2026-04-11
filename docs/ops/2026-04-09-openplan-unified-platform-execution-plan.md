# OpenPlan Unified Platform Execution Plan

Date: 2026-04-09  
Owner: Bartholomew Hale  
Status: Proposed next-step execution plan

## Purpose

This document converts the unified architecture memo into executable build slices.

It is optimized for:
- small safe vertical slices,
- truthful product posture,
- reuse of existing repo assets,
- and continual shipping instead of giant speculative rewrites.

## Execution priorities

Order of operations:

1. Establish the **AI-enabled operations runtime foundation**
2. Strengthen the **shared project control room** inside OpenPlan
3. Formalize the **standards-first scenario and data spine**
4. Build the **RTP Cycle + portfolio spine**
5. Continue the first **Transportation Modeling OS** contracts and surfaces
6. Add the first **Grants OS** objects and workflows
7. Connect grants to the RTP financial and prioritization logic
8. Link in **Aerial Operations OS** artifacts and mission records
9. Expand toward mission planning, land-use/zoning hooks, and deeper automation later

## Research-driven expansion rule (2026-04-10)

The deep research synthesis expands this plan in five durable ways:

1. OpenPlan should explicitly maintain a **scenario workspace** with baselines, branches, assumptions, and publishable comparisons.
2. OpenPlan should adopt a **standards-first data posture** wherever practical instead of over-investing in one-off integrations.
3. Accessibility, equity, and environmental metrics should become reusable **indicator services**, not appendix-only outputs.
4. Transportation Modeling OS should remain a distinct build lane with clear contracts back into planning, reports, and project controls.
5. Land-use allocation, zoning/regulatory simulation, and urban design testing should be planned as explicit later platform capabilities, not forgotten side ideas.

## Workstream O0: AI-enabled operations runtime foundation

Canonical companion spec:
- `docs/ops/2026-04-11-openplan-ai-enabled-operations-runtime-spec.md`

### Goal
Turn OpenPlan into an app-wide AI-enabled operations system instead of leaving intelligence trapped in page-local assistant prompts.

### Why first
The platform direction is now clear: the long-term product is not only a record system plus modules, but an agent-enabled operating environment that can see the whole workspace, gather outside information, recommend next actions, and eventually perform approved work.

The recent packet-command work is a useful early primitive, but it needs to be generalized into app-wide command logic.

### Build slice O0.1
Define a shared workspace operations summary contract.

#### Scope
- workspace-level operational brief
- cross-module counts for packet pressure, controls, deadlines, and drift
- stable summary object usable by dashboard, copilot, and future action-center surfaces

#### Acceptance criteria
- one workspace can render a truthful operations brief across projects, programs, reports, and controls
- the same summary can power both UI surfaces and assistant responses

### Build slice O0.2
Define a shared command queue contract.

#### Scope
- normalized queue item shape
- priority scoring
- target navigation
- evidence/reason strings
- module-agnostic command categories

#### Acceptance criteria
- packet pressure, stale-state logic, and next-action posture no longer require page-local custom logic
- projects, programs, reports, and later plans/grants can reuse one command model

### Build slice O0.3
Expand assistant context from page-target prompts into an operations copilot.

#### Scope
- workspace operations target kind
- multi-record context assembly
- operations brief, blockers brief, and next-action workflows
- linkage to shared command queue and controls summaries

#### Acceptance criteria
- the assistant can answer whole-workspace operational questions truthfully
- the answer is based on shared context assembly, not prompt-only guessing

### Build slice O0.4
Define internet-connected signal ingestion posture.

#### Scope
- source objects
- provenance contract
- fetch/review status
- attachment of outside signals to funding, planning, and operational records

#### Acceptance criteria
- outside data can be gathered and cited inside the app
- grants/program/project recommendations can reflect current external context

### Build slice O0.5
Define role-aware agent action runtime.

#### Scope
- safe action registry
- approval model
- audit trail requirements
- mutation vs recommendation boundaries

#### Acceptance criteria
- the future agent can do real work in-app under explicit permissions
- all actions are reviewable and tied to records/artifacts

## Workstream A0: Standards-first scenario and data spine

Canonical companion spec:
- `docs/ops/2026-04-10-openplan-scenario-data-indicator-spine-spec.md`

### Goal
Create the shared scenario/versioning/data contract layer that later RTP, modeling, grants, and engagement work can all depend on.

### Why now
The research confirms that OpenPlan will become brittle if scenarios, assumptions, accessibility/equity indicators, and network/data contracts remain scattered across module-specific implementations.

### Build slice A0.1
Define shared scenario objects and comparison posture.

#### Scope
- baseline / branch / snapshot model
- assumptions record
- publishable comparison metadata
- stable links back to projects, plans, and model runs

#### Acceptance criteria
- one scenario can be named, versioned, and compared without hiding assumptions in ad hoc notes
- reports and model runs can point to the same scenario snapshot

### Build slice A0.2
Define standards-aware data contracts for the first external data plane.

#### Scope
- OSM / GTFS / county input posture
- network package metadata and provenance rules
- export/import posture for GeoPackage, COG/GeoParquet where relevant, and standards-aware API notes

#### Acceptance criteria
- the first data and network package flows have explicit provenance and format expectations
- later modeling and county onboarding lanes can extend the same contract instead of inventing parallel ingestion logic

### Build slice A0.3
Define reusable indicator contracts.

#### Scope
- accessibility summary contract
- equity/distribution summary contract
- environmental-impact summary contract
- report-ready / scenario-ready metadata posture

#### Acceptance criteria
- one indicator family can be computed, stored, and surfaced as a reusable product output
- RTP, modeling, and report lanes can consume the same indicator objects

## Workstream A: Shared Project Control Room

### Goal
Create one common project-linked control surface that all later modules can depend on.

### Why first
The existing repo evidence shows reusable foundations for:
- submittals
- deliverables
- risks
- issues
- decisions
- meetings
- invoice records
- dataset links
- report artifacts
- stage-gate summaries

That is enough to establish a common backbone before adding more product-specific objects.

### Build slice A1
Add a normalized project control room summary model inside OpenPlan.

#### Scope
- unify linked summaries for:
  - milestones
  - submittals
  - invoices
  - risks
  - issues
  - decisions
  - meetings
  - datasets
  - stage-gates
  - reports / packet freshness
- expose a stable project-control aggregate for project detail pages and future grants/RTP use

#### Acceptance criteria
- a project page can show one coherent control-room summary
- the summary is safe when some migration tables are pending or absent
- report freshness and evidence-linked status remain visible
- no fake compliance language is introduced

### Build slice A2
Add an action-center-ready deadline layer.

#### Scope
- normalize due dates and statuses from submittals, milestones, invoices, and grant deadlines
- surface urgent/attention/healthy groupings
- make it reusable across RTP, grants, and controls

#### Acceptance criteria
- one project can show its upcoming deadlines in a stable order
- date logic is not hardcoded to one module

## Workstream B: RTP Cycle + Portfolio Spine

### Goal
Turn the RTP into a first-class domain, not just scattered plans and engagement surfaces.

### Build slice B1
Create the `rtp_cycles` domain.

#### Scope
- RTP cycle title
- agency/workspace linkage
- adoption horizon years
- status
- draft/public review/adoption dates
- checklist posture
- narrative posture

#### Acceptance criteria
- one workspace can create and list RTP cycles
- one RTP cycle can act as a parent object for projects, chapters, and engagement

### Build slice B2
Create RTP project portfolio linkage.

#### Scope
- project <-> RTP cycle association
- constrained / illustrative status
- priority tier
- sponsor/jurisdiction
- corridor/geography linkage
- funding posture summary
- rationale summary

#### Acceptance criteria
- one RTP cycle can show a project list and map-linked portfolio
- each project can display why it is prioritized and whether it is constrained

### Build slice B3
Create digital RTP narrative scaffolding.

#### Scope
- chapter objects
- chapter ordering
- chapter summary and narrative blocks
- linked project and policy references
- chapter-level public engagement hooks

#### Acceptance criteria
- one RTP cycle can render a minimal digital plan shell with chapters and linked projects

## Workstream B0: Transportation Modeling OS contracts

### Goal
Turn the existing models/county-runs/network-package lane into a clearer Transportation Modeling OS that feeds planning decisions rather than behaving like a detached technical sandbox.

### Build slice B0.1
Stabilize the shared run and artifact contract.

#### Scope
- scenario snapshot linkage
- network package reference
- run manifest posture
- artifact/evidence packet conventions
- planner-safe run class language

#### Acceptance criteria
- a model run can point cleanly back to a scenario/project context
- one evidence packet can explain what was run, with what inputs, and what the outputs are safe to mean

### Build slice B0.2
Define reusable indicator outputs for planning consumption.

#### Scope
- accessibility summaries
- screening KPI summaries
- comparison-ready output posture
- links into RTP/report/project surfaces

#### Acceptance criteria
- one model output family can be reused in reports and planning context without bespoke one-off formatting
- the modeling lane strengthens RTP/project decision support instead of drifting into isolated tooling

## Workstream C: Grants OS foundation

### Goal
Add funding strategy and opportunity management in a way that writes back into RTP and project controls.

### Build slice C1
Create the funding catalog backbone.

#### Scope
- funding programs
- funding opportunities
- formula vs discretionary classification
- open/closed/upcoming status
- owner / agency / cadence fields

#### Acceptance criteria
- staff can list active and upcoming opportunities
- programs and opportunities can link to projects

### Build slice C2
Create opportunity decision workflow.

#### Scope
- pursue / monitor / skip decision state
- fit notes
- readiness notes
- owner
- decision rationale

#### Acceptance criteria
- one project can display candidate funding opportunities
- an opportunity can be intentionally skipped with a recorded reason

### Build slice C3
Create award/allocation records.

#### Scope
- awarded amount
- match posture
- project linkage
- obligation timing
- spending posture
- risk flags

#### Acceptance criteria
- a project can show awarded dollars and remaining gap
- one award can link to later invoice/reimbursement records

## Workstream D: Financial + reimbursement integration

### Goal
Make grants financially meaningful inside planning and delivery workflows.

### Build slice D1
Connect awards to project financial posture.

#### Scope
- summarize committed / likely / unfunded amounts
- support constrained vs illustrative reasoning
- surface project funding gap

#### Acceptance criteria
- project detail shows a credible funding stack summary
- RTP portfolio views can distinguish funded, partially funded, and unfunded projects

### Build slice D2
Add invoice / reimbursement workflows.

#### Scope
- invoice record linkage to awards/projects
- reimbursement status
- supporting docs posture
- caltrans posture labeling
- net request / retention / due date summaries

#### Acceptance criteria
- a project can show current invoice/reimbursement posture
- records can be used in the control-room summary without overstating LAPM readiness

## Workstream E: Public engagement extension for RTP

### Goal
Extend current engagement architecture instead of building a new public-comment system.

### Build slice E1
Create RTP-aware engagement targets.

#### Scope
- engagement target types:
  - RTP cycle
  - RTP chapter
  - RTP project
  - map feature
- retain current campaign/share-token model

#### Acceptance criteria
- comments can be scoped to a whole plan, chapter, or project
- public share windows remain controlled by active campaign state and close date

### Build slice E2
Add comment-to-record outputs.

#### Scope
- response tracker
- export-ready comment summary
- project/chapter linkage
- moderation state

#### Acceptance criteria
- one public campaign can generate a board-usable comment summary output

## Workstream F: Aerial linkage

### Goal
Connect planning records to field evidence and measurable outputs.

### Build slice F1
Create shared linkage between OpenPlan and Aerial Operations OS.

#### Scope
- shared external ID or linked-record contract for:
  - project
  - report
  - dataset
  - artifact
- minimal linked aerial record summary inside OpenPlan

#### Acceptance criteria
- a project can show linked aerial missions and recent aerial artifacts
- a report can reference an aerial artifact without duplicating storage logic

### Build slice F2
Support artifact previews and evidence summaries.

#### Scope
- latest orthomosaic / DSM / mesh / point cloud summary on project/report detail
- source date / mission label / QA posture / download link

#### Acceptance criteria
- project and report pages can surface current field evidence cleanly

## Workstream G: Later mission-planning lane

### Goal
Bring over high-value DJI mission-planning capabilities after the evidence/delivery backbone is stable.

### Candidate donor capabilities from drone-mapper
- KMZ/WPML generation
- coverage pattern logic
- overlap / spacing calculations
- mission simulation concepts
- reporting and flight-planning utilities

### Important rule
Do not block the current planning platform roadmap on controller-side automation.

Processing, deliverables, and project evidence come first.

## Repo implementation strategy

## OpenPlan repo
Primary home for:
- shared platform core
- RTP OS
- Grants OS
- engagement/report/control extensions
- cross-platform linked-record surface

## aerial-intel-platform repo
Primary home for:
- mission ingest
- jobs
- artifacts
- ODM/WebODM/NodeODM orchestration
- mission operations UI

## Port, do not merge yet
Recommended immediate posture:
- port ideas and contracts first
- do not force repo consolidation yet
- preserve truthful product boundaries

## Suggested first shipping sequence

### Sprint 1
- project control room summary
- deadline/action-center normalization
- RTP cycle object

### Sprint 2
- RTP portfolio linkage
- constrained / illustrative status
- priority rationale fields
- initial digital chapter shell

### Sprint 3
- funding programs + opportunities
- pursue / monitor / skip workflow
- award/allocation records

### Sprint 4
- invoice/reimbursement linkage
- financial stack summary
- public RTP comment targeting

### Sprint 5
- OpenPlan <-> Aerial linked artifact summaries
- project/report-level aerial evidence display

## Success definition

The architecture is succeeding when OpenPlan can truthfully demonstrate this chain:

- a project exists in an RTP cycle,
- its rationale and funding posture are visible,
- public comments and board/report outputs point back to it,
- grant opportunities and awards influence its status,
- reimbursement and control posture are visible,
- and field evidence from aerial operations can be attached to the same record.

That is the core integrated product Nathaniel is actually asking for.
