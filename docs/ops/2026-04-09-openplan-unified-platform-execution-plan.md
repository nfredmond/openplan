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

1. Strengthen the **shared project control room** inside OpenPlan
2. Build the **RTP Cycle + portfolio spine**
3. Add the first **Grants OS** objects and workflows
4. Connect grants to the RTP financial and prioritization logic
5. Link in **Aerial Operations OS** artifacts and mission records
6. Expand toward mission planning and deeper automation later

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
