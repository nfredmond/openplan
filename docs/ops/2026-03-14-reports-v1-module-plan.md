# OpenPlan Reports Module — V1 Plan

Date: 2026-03-14
Owner: Bartholomew (COO)
Status: PROPOSED — recommended next module
Priority: HIGH

## Executive Decision

The next OpenPlan module should be **Reports**.

This is the strongest next move because it converts the current Planning OS spine into client-usable outputs without opening an oversized new domain too early.

Reports V1 should become a real product surface for:
- project packets,
- analysis-backed summaries,
- binder assembly,
- and export traceability.

It should **not** try to become a fully autonomous narrative-writing engine in the first pass.

## Why Reports Next

### Current platform state
OpenPlan already has enough substrate to justify a real Reports layer:
- **Projects module** is real and data-backed
- project subrecords exist: deliverables, risks, issues, decisions, meetings
- project activity timeline exists
- Analysis Studio preserves map-view state in runs/reports/exports
- run history and comparison context have already been strengthened
- Data Hub and project context are now visibly connected to Analysis Studio

### Strategic reason
Reports is the best bridging module because it:
1. compounds prior work instead of creating another silo,
2. creates obvious pilot/client value fast,
3. reinforces the "Planning OS" framing,
4. improves auditability and trust,
5. sets up future Engagement and Scenarios modules to plug into a shared output layer.

## Product Thesis

OpenPlan Reports is **not** merely "download a PDF from Analysis Studio."

It is the platform-wide output layer where a workspace can assemble:
- project operations context,
- analytical evidence,
- selected maps/artifacts,
- and transparent assumptions
into a coherent deliverable.

## V1 Goal

Enable Nathaniel to generate a clean, auditable report packet from a real OpenPlan project and one or more linked analysis runs.

## V1 Success Criteria

Reports V1 is considered successful when a user can:
1. open `/reports`,
2. see a catalog of generated outputs,
3. create a new report tied to a project,
4. optionally attach one or more runs,
5. include project records and timeline material,
6. generate an HTML/PDF packet,
7. inspect the packet with visible assumptions + source context,
8. reopen the generated artifact later from the report catalog.

## Explicit Non-Goals for V1

Do **not** include in the first pass:
- full AI-authored report drafting workflows,
- public engagement report synthesis,
- grant-specific expert templates across every funding program,
- collaborative block editing,
- comments/approvals workflow,
- DOCX export,
- advanced theming/branding system,
- client-facing final shipment automation.

## Module Scope

### In scope
1. **Reports catalog**
2. **Report creation flow**
3. **Project-linked packet assembly**
4. **Run attachment + map context inclusion**
5. **HTML first, PDF second**
6. **Report detail page with provenance**
7. **Basic report status lifecycle**

### Out of scope
- external send/share workflows
- multi-user editing
- polished proposal-writing AI
- outreach/engagement report ingestion
- scenarios-specific narrative explanation layer

## Recommended V1 Report Types

Start with these three report archetypes only:

### 1. Project Status Packet
Use case:
- internal review
- leadership snapshot
- pilot/customer progress review

Sections:
- project overview
- current status / plan type / delivery phase
- deliverables
- risks / issues
- decisions
- meetings
- recent activity timeline

### 2. Analysis Summary Packet
Use case:
- corridor/study evidence summary
- analysis deliverable appendix

Sections:
- project overview
- selected run summary
- map state summary
- key metrics
- attached overlay/map context
- exported analysis artifacts list
- methods / assumptions

### 3. Board / Binder Packet (lightweight)
Use case:
- assemble a printable packet from existing project and run materials

Sections:
- cover page
- executive summary
- project records digest
- selected analysis summaries
- appendix / references

## Information Architecture

### Primary route surface
- `src/app/(app)/reports/page.tsx`

Replace current placeholder with a real catalog page.

### Likely child routes
- `src/app/(app)/reports/[reportId]/page.tsx`
- `src/app/api/reports/route.ts`
- `src/app/api/reports/[reportId]/route.ts`
- `src/app/api/reports/[reportId]/generate/route.ts`

### Suggested navigation posture
Reports should feel like an operational output system, not a download drawer.

Recommended sections within the module UI:
- All Reports
- Drafts
- Generated
- By Project
- Templates

## Proposed Data Model

Add a first-pass reporting schema.

### `reports`
Fields:
- `id`
- `workspace_id`
- `project_id` (nullable but preferably required in V1)
- `title`
- `report_type` (`project_status`, `analysis_summary`, `board_packet`)
- `status` (`draft`, `generated`, `archived`)
- `summary` nullable
- `created_by`
- `generated_at` nullable
- `latest_artifact_url` nullable
- `latest_artifact_kind` nullable (`html`, `pdf`)
- timestamps

### `report_runs`
Join table linking reports to selected analysis runs.
Fields:
- `id`
- `report_id`
- `run_id`
- `sort_order`
- timestamps

### `report_sections`
Optional first-pass structure for controlling assembled packet sections.
Fields:
- `id`
- `report_id`
- `section_key`
- `title`
- `enabled`
- `sort_order`
- `config_json`
- timestamps

### `report_artifacts`
Track generated outputs over time.
Fields:
- `id`
- `report_id`
- `artifact_kind` (`html`, `pdf`)
- `storage_path` or signed URL reference
- `generated_by`
- `generated_at`
- `metadata_json`

## V1 API Surface

### `GET /api/reports`
Returns report catalog for current workspace.

Supports:
- filter by project
- filter by report type
- filter by status

### `POST /api/reports`
Creates draft report.

Input:
- `projectId`
- `title`
- `reportType`
- optional selected `runIds`
- optional enabled sections

### `GET /api/reports/[reportId]`
Returns report detail payload including:
- report metadata
- linked project summary
- linked runs
- available sections
- latest artifacts
- provenance context

### `PATCH /api/reports/[reportId]`
Updates:
- title
- summary
- status
- section enablement/order
- linked runs

### `POST /api/reports/[reportId]/generate`
Generates artifact(s).

V1 behavior:
- always generate HTML
- optionally generate PDF from the same rendered template
- store artifact record
- return artifact metadata

## V1 UI Plan

### A. Reports catalog page
Purpose:
- become the command center for generated outputs

Must include:
- report list/table
- create report button
- filters: type / status / project
- latest generated timestamp
- quick open to detail page

### B. Report creation panel
Simple and structured.

Inputs:
- project selector
- report type selector
- title
- optional run selector
- section toggles

### C. Report detail page
Main control surface.

Panels:
1. report metadata
2. linked project summary
3. linked runs
4. section configuration
5. artifact history
6. provenance / assumptions box

### D. Generated artifact preview
For V1, even a simple embedded HTML preview is enough.

## Section Assembly Rules

### Project Status Packet
Pull from:
- `projects`
- project deliverables
- project risks
- project issues
- project decisions
- project meetings
- activity timeline

### Analysis Summary Packet
Pull from:
- linked run summary
- persisted map-view state
- report/export metadata already captured by Analysis Studio
- current project identity if linked

### Board / Binder Packet
Pull from:
- project context
- selected project records
- selected run summaries
- exported appendix links

## Traceability / Provenance Requirements

Every generated report should visibly disclose:
- project name
- workspace context
- selected run IDs/timestamps if analysis-backed
- active map-view state when relevant
- generated timestamp
- methods / assumptions section
- explicit note when content is assembled from saved records rather than freshly interpreted

This is mandatory for trust and auditability.

## Ethical / Quality Gate Rules

Reports V1 must follow Nat Ford policy:
- no overstated certainty,
- no hidden assumptions,
- no misleading AI authority posture,
- no burden-shifting recommendations,
- maintain client-safe auditability.

Recommended language for report footer or metadata block:
- "OpenPlan assembles structured project and analysis information for review. Final conclusions and external submissions require human review and approval."

## Rendering Strategy

### Recommended approach
1. Generate a canonical HTML artifact first
2. Convert HTML to PDF using the existing app/server-side rendering path
3. Store artifact metadata and retrieval path

### Why this approach
- simplest to ship
- easiest to preview in-app
- easiest to version
- keeps PDF as derivative output instead of special-case source

## Technical Build Order

### Pass 1 — data + API foundation
- add migrations for `reports`, `report_runs`, `report_sections`, `report_artifacts`
- add RLS policies
- add CRUD endpoints
- add tests

### Pass 2 — catalog + create flow
- replace `/reports` placeholder
- add report create panel
- add report list filters
- add report detail route

### Pass 3 — HTML generation
- add report assembly logic
- implement first template set for the 3 report types
- persist artifact records

### Pass 4 — PDF generation
- derive PDF from HTML template/render path
- attach artifact history to report detail page

### Pass 5 — polish / hardening
- provenance panel
- empty states
- generation error states
- validation and build hardening

## Acceptance Criteria

### Product acceptance
- `/reports` is no longer a placeholder
- user can create a report from a real project
- user can attach at least one run to a report
- user can generate at least one HTML artifact
- user can regenerate and retain artifact history
- generated report clearly exposes project/run provenance

### Engineering acceptance
- lint passes
- tests pass
- build passes
- report generation gracefully handles missing optional data
- auth/RLS protects report records by workspace

## Key Risks

### Risk 1 — scope creep into AI writing tool
Mitigation:
- keep V1 assembly-first, not prose-generation-first

### Risk 2 — weak report templates
Mitigation:
- ship only 3 report archetypes and make them structurally sound

### Risk 3 — report data inconsistency across modules
Mitigation:
- centralize assembly logic and provenance metadata

### Risk 4 — premature external-delivery assumptions
Mitigation:
- keep V1 internal/operator-facing and auditable first

## Follow-On Expansions After V1

1. scenario comparison packets
2. engagement summary packets
3. grant-specific output templates
4. collaborative review / approval workflow
5. richer branded layout system
6. AI-assisted summary drafting with explicit review gates

## Recommendation

Proceed with **Reports V1** as the next OpenPlan module.

This is the right next build because it turns OpenPlan from a growing internal operating system into a platform that can produce coherent, inspectable deliverables from the work already being captured.
