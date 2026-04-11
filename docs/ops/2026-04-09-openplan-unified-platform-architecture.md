# OpenPlan Unified Platform Architecture

Date: 2026-04-09  
Owner: Bartholomew Hale  
Status: Proposed operating architecture

## Executive summary

OpenPlan should not evolve into one shapeless municipal super-app.

It should become a **shared planning platform core** with four tightly-linked operating systems:

1. **RTP OS** for digital plan authoring, project portfolio management, public engagement, and adoption support
2. **Grants OS** for opportunity tracking, application strategy, awards, spending, reimbursement, and compliance
3. **Aerial Operations OS** for mission planning, imagery ingest, ODM/WebODM processing, measurable deliverables, and project-linked field evidence
4. **Transportation Modeling OS** for network packages, scenarios, managed runs, accessibility outputs, demand-model artifacts, and evidence-backed analytical comparison

This architecture fits Nathaniel's actual product vision, aligns with California rural RTPA reality, and reuses the strongest existing repo assets instead of starting over.

## Product thesis

For small rural agencies, RTPAs, county transportation commissions, tribes, and planning consultancies, the real operating problem is not just planning, engagement, grants, or drone processing in isolation.

The real problem is:

- deciding what projects belong in the plan,
- explaining why they are prioritized,
- identifying what can actually be funded,
- managing delivery and reimbursement controls,
- and grounding project narratives in real, current site evidence.

OpenPlan should therefore act as a **regional planning operating system with shared evidence, funding, and delivery context**.

## Honest current posture

Current evidence supports the following platform posture:

- **OpenPlan** is the canonical base for planning-domain continuity, engagement, programs, reports, and evidence-linked workflows.
- **project_manager** is a strong donor repo for grants, Caltrans invoicing, action-center, and control-room patterns.
- **aerial-intel-platform** is the canonical base for aerial operations, ODM-oriented processing, mission ingest, jobs, and artifacts.
- **drone-mapper** is the strongest donor repo for DJI mission-planning logic, KMZ/WPML generation, and flight-planning algorithms.
- **planpulse**, **DOT-Dashboard**, **transitscore-3d**, and **nat-ford-website** contain useful patterns but should be mined selectively rather than treated as canonical bases.

## Platform structure

### Research-driven additions (2026-04-10)

The deep research synthesis adds six durable architecture requirements:

1. **Shared scenario workspace**
   - baselines, scenario branches, intervention assumptions, comparison snapshots, and publishable scenario artifacts should be first-class platform objects rather than scattered report-side metadata.
2. **Standards-first data plane**
   - OpenPlan should prefer open standards and interoperable formats where practical, including OSM, GTFS/GTFS-Realtime, GBFS, OGC API Features, GeoPackage, COG, GeoParquet, and STAC-style metadata patterns.
3. **Accessibility/equity/environment as reusable outputs**
   - these should feed RTP prioritization, scenario comparison, grant strategy, and public reporting instead of living only in bespoke spreadsheets or one-off appendix tables.
4. **Land use + zoning + urban design as explicit scenario capabilities**
   - OpenPlan should reserve product architecture for land-use allocation, zoning/regulatory simulation, and place-testing workflows instead of limiting itself to project tracking plus transportation analytics.
5. **Composable engine strategy**
   - OpenPlan should wrap mature engines and standards-based services inside a unified planning/evidence/governance layer rather than attempting to replace every specialist tool internally.
6. **Privacy and provenance discipline**
   - higher-sensitivity mobility and operational data should be handled with privacy-by-design posture and explicit provenance/audit metadata.

## 1. Shared Platform Core

The shared core should live conceptually inside OpenPlan and provide the common objects used by all modules.

### Shared entities

- Workspace / Agency
- User / Membership / Role
- Project
- Scenario Baseline / Scenario Branch / Assumption Set
- Geography / Corridor / Site
- Plan / RTP Cycle / Chapter
- Program
- Funding Program
- Funding Opportunity
- Award / Allocation
- Budget Line / Phase Funding
- Deliverable
- Submittal
- Invoice / Reimbursement Record
- Risk / Issue / Decision / Meeting
- Dataset
- Network Package / Run Bundle / Indicator Snapshot
- Artifact
- Engagement Campaign / Item / Comment
- Stage Gate / Control Decision
- Report / Board Packet / Export

### Shared services

- Auth, tenancy, permissions
- PostGIS-backed geometry and map context
- standards-aware ingestion + validation
- Artifact storage and signed delivery
- Evidence-chain / provenance tracking
- Audit logging
- Shared search and linked-record context
- Shared action-center / deadline aggregation
- shared scenario comparison + impact ledger
- reusable accessibility / equity / environmental indicator services

## 2. RTP OS

The RTP module should be a first-class operating system, not just a plan editor.

### Core RTP domains

- RTP Cycle
- Policy Element
- Action Element
- Financial Element
- Project Portfolio
- Constrained / Illustrative project sets
- Chapter narrative and embedded tables/maps
- Public review windows and comment intake
- Consultation and adoption tracking
- Checklist / package assembly

### Canonical workflow

Workspace / Agency -> RTP Cycle -> Policies / Goals / Assumptions -> Projects / Corridors / Funding -> Financial Constraint -> Public Narrative + Project Explorer -> Comments / Responses -> Adoption Package

### Key product surfaces

- RTP workspace dashboard
- project explorer with map + filters + project detail
- digital RTP narrative surface
- policy change tracker
- financial element builder
- public comment portal
- adoption / consultation packet workspace

### Critical design rule

RTP projects must carry funding and rationale context directly.

Each project should be able to answer:

- what it is,
- where it is,
- what mode(s) it touches,
- who sponsors it,
- whether it is constrained or illustrative,
- what funding sources are plausible,
- why it is prioritized,
- what comments and evidence support it,
- and what chapter/report outputs reference it.

## 3. Grants OS

Grants should be a standalone operating system that also writes back into RTP and project controls.

### Core grants domains

- Funding Program catalog
- Funding Opportunity calendar
- Pursue / Monitor / Skip strategy board
- Application package
- Award / Allocation record
- Budget and match tracking
- Reimbursement / invoicing
- Compliance milestones
- Closeout

### Shared-with-core domains

- project linkage
- report linkage
- document linkage
- risks / issues / decisions / meetings
- action-center deadlines
- stage-gate and evidence controls

### Critical design rule

Do not build grants as a dead-end submission tracker.

Every grant object should be able to influence:

- RTP constrained/unconstrained status
- financial element narratives and tables
- project readiness posture
- billing / reimbursement control state
- board and report outputs

## 4. Aerial Operations OS

Aerial operations should remain a dedicated operating system, but tightly linked to OpenPlan.

### Core aerial domains

- Mission
- AOI / flight geometry
- Capture dataset
- Processing job
- Artifact / deliverable
- Review bundle
- share/export package
- drone/controller compatibility profile

### Product workflow

Mission planning -> imagery ingest -> processing request -> ODM/WebODM/NodeODM execution -> output QA -> deliverable share -> linked planning/project evidence

### Critical design rule

Do not force aerial processing to become an RTP subfeature.

It is a sister operating system that feeds evidence and measurable outputs into the planning platform.

## 5. Transportation Modeling OS

Transportation Modeling OS should be treated as a full operating system, not a hidden technical subsystem.

### Core modeling domains

- Model
- Model Run
- Run Stage / Orchestration State
- Network Package
- County / regional onboarding package
- Scenario assumptions and run manifests
- Skim / assignment / KPI artifacts
- Accessibility outputs
- Evidence packet / validation packet

### Critical design rule

The modeling stack should remain planner-facing and evidence-safe.

That means:
- OpenPlan owns project/scenario/evidence context,
- engines run behind explicit manifests and artifacts,
- AequilibraE is the first practical backbone,
- ActivitySim follows when behavioral demand materially matters,
- MATSim remains a later bounded advanced engine,
- and modeling outputs write back into RTP, grants, reports, and project controls instead of living in a detached lab lane.

## Repo strategy

## Canonical bases

### OpenPlan
Use as the canonical base for:
- platform core
- RTP OS
- shared controls/evidence/reporting model
- future Grants OS primary home

### aerial-intel-platform
Use as the canonical base for:
- Aerial Operations OS
- ingest/jobs/artifacts
- truthful ODM/WebODM orchestration path
- aerial delivery and mission workspace

## Donor repos

### project_manager
Mine for:
- grants workflow patterns
- Caltrans invoice tracking
- action center
- public community portal moderation concepts
- documents / deadline / control-room patterns

### drone-mapper
Mine for:
- DJI KMZ/WPML generation
- coverage pattern logic
- mission simulation concepts
- flight-planning utilities
- image management ideas

### planpulse
Mine for:
- engagement map patterns
- grant narrative UX
- lighter-weight grant + public feedback flows

### nat-ford-website
Mine for:
- funding-readiness scorecard logic
- funding calendar structure
- public language for grant readiness and OpenPlan positioning

## Integration posture

Product-level integration should happen before repo-level consolidation.

That means:

- keep **OpenPlan** and **aerial-intel-platform** as separate active repos initially,
- define shared contracts and linked IDs first,
- only consolidate code if and when duplication becomes operationally expensive.

This is the safer, faster path.

## Reuse decisions from existing product truth

## Reuse inside OpenPlan now

Existing OpenPlan assets worth extending directly:

- Projects
- Plans
- Programs
- Reports
- Engagement campaigns and public share flows
- Assistant context + evidence linkage
- Stage-gate / operator-control framework
- Data hub and dataset linkage

## Extend, do not replace

### Engagement backbone
Use the existing engagement campaign/public share model as the base for:
- whole-plan public review
- chapter-level comments
- project list comments
- map-feature comments
- moderated public publication

### Stage-gates / controls
Use the current control-pack approach as the base for:
- LAPM operator controls
- grant compliance posture
- reimbursement readiness
- project control room summaries

### Reports / artifacts
Use the current report/artifact/evidence-chain patterns as the base for:
- RTP board packets
- grant response packets
- adoption package exports
- aerial evidence bundles linked back to planning records

## Cross-module shared data model

At minimum, the following cross-links should exist:

- Project <-> RTP Cycle
- Project <-> Scenario Baseline / Scenario Branch
- Project <-> Funding Opportunity / Award
- Project <-> Plan Chapter
- Project <-> Engagement Campaign
- Project <-> Report
- Project <-> Stage Gate / Control Decision
- Project <-> Invoice / Reimbursement Record
- Project <-> Dataset / Artifact
- Project <-> Model / Model Run / Indicator Snapshot
- Project <-> Aerial Mission / Aerial Artifact

Optional but high-value links:

- Report <-> Engagement Campaign
- Report <-> Grant Application / Award
- Grant Application <-> Aerial Artifact
- RTP Chapter <-> Policy Change Record
- RTP Chapter <-> Financial Scenario

## Architecture principles

1. **One canonical project spine**  
   Do not let RTP, grants, aerial, and reports create parallel project identities.

2. **Evidence before narrative theater**  
   Reports, board packets, and public claims should point back to auditable linked records.

3. **Reuse first, rewrite selectively**  
   Reuse mature patterns where they exist. Rewrite only when product shape is wrong.

4. **Separate product planes honestly**  
   Planning and aerial processing can be tightly linked without pretending they are one workflow.

5. **Design for rural agency legibility**  
   Explain why a project is prioritized, why it is fundable, and what tradeoffs are being made.

6. **Keep compliance labels disciplined**  
   Internal control ready is not the same as LAPM-ready. Candidate is not the same as approved.

7. **Adopt open standards where they reduce lock-in and integration cost**  
   Prefer standards-aware ingestion and export over fragile one-off connectors whenever the standards are mature enough to help.

8. **Treat scenarios and indicators as shared infrastructure**  
   Scenario baselines, impact deltas, and publishable evidence should be reusable across planning, modeling, engagement, and reporting.

## Recommended phase sequence

### Phase 1: Shared Project Control Room
- strengthen shared project, evidence, controls, deadlines, reports, and linked-record summaries inside OpenPlan

### Phase 2: RTP Cycle + Portfolio Spine
- add RTP cycle domain, project prioritization, constrained/illustrative logic, and financial linkage

### Phase 3: Grants OS foundation
- add funding programs, opportunities, pursue/monitor/skip workflow, and award records

### Phase 4: Reimbursement + control integration
- add invoice, reimbursement, submittal, compliance milestone, and closeout flows

### Phase 5: Aerial linkage
- link aerial missions, datasets, jobs, and deliverables into OpenPlan projects and reports

### Phase 6: Mission planning and richer field automation
- bring over DJI package generation and field planning logic from donor assets

## Bottom line

The correct north star is:

**OpenPlan as a shared planning platform core with RTP OS, Grants OS, Aerial Operations OS, and Transportation Modeling OS linked through one project/scenario/evidence spine.**

That gives Nathaniel a coherent product family instead of a pile of disconnected modules, while staying grounded in the strongest code and product truth already present in the workspace.
