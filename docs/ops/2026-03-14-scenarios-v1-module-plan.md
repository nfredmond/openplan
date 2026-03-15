# OpenPlan Scenarios Module — V1 Plan

Date: 2026-03-14
Owner: Bartholomew (COO)
Status: PROPOSED — recommended next module after Reports
Priority: HIGH

## Executive Decision

The next OpenPlan module should be **Scenarios**.

Reports is now real enough to serve as the output layer. Analysis Studio comparison UX is now strong enough to support a real scenario system instead of treating every run as an isolated artifact.

Scenarios V1 should become the operating surface for:
- baseline registration,
- alternative tracking,
- structured comparison,
- and scenario-to-project linkage.

It should **not** attempt a full CEQA engine or fully quantified mitigation optimizer in the first pass.

## Why Scenarios Next

### Current platform state
OpenPlan now has enough substrate to justify a real Scenarios layer:
- **Projects** already exist as planning containers
- **Analysis Studio** already supports runs, current-vs-baseline comparison, map context, and stronger auditability
- **Reports** can now capture and present structured outputs
- **Data Hub** exists as supporting evidence/context infrastructure
- The `/scenarios` route is currently only a placeholder, making it a clear module gap

### Strategic reason
Scenarios is the best next module because it:
1. converts run-by-run analysis into a planning decision system,
2. gives the comparison workflow a durable home,
3. creates a bridge to CEQA/VMT, alternatives analysis, and mitigation packaging,
4. strengthens the Planning OS posture beyond “analysis app + reports”,
5. compounds the recent Analysis Studio UI work rather than ignoring it.

## Product Thesis

OpenPlan Scenarios is not just a list of model runs.

It is the operating surface where a workspace can define:
- what the baseline is,
- what alternatives exist,
- why each alternative matters,
- what evidence supports it,
- and how alternatives compare over time.

## V1 Goal

Enable Nathaniel to create a scenario set for a project, designate a baseline, attach analysis runs as alternatives, and review structured comparisons from a dedicated `/scenarios` module.

## V1 Success Criteria

Scenarios V1 is successful when a user can:
1. open `/scenarios`,
2. see a catalog of scenario sets,
3. create a scenario set linked to a project,
4. define one baseline and one or more alternatives,
5. attach saved analysis runs to those alternatives,
6. compare baseline vs alternative inside a structured scenario detail view,
7. understand assumptions, status, and linkage to reports/projects,
8. reopen that scenario set later as a durable planning artifact.

## Explicit Non-Goals for V1

Do **not** include in the first pass:
- full CEQA significance determination engine,
- quantified mitigation package optimizer,
- multi-branch scenario trees with version DAGs,
- collaborative commenting/approval workflows,
- scenario-specific AI drafting as a primary surface,
- public engagement synthesis inside the scenario module,
- external publishing/sharing flows.

## Module Scope

### In scope
1. **Scenario set catalog**
2. **Scenario set creation flow**
3. **Baseline + alternatives registry**
4. **Run attachment to scenarios**
5. **Scenario detail view with comparison context**
6. **Status + assumptions metadata**
7. **Project linkage**

### Out of scope
- public release workflows
- scenario branch graphs
- automated mitigation calculators
- CEQA document automation
- collaborative approvals/comments

## Recommended V1 Object Model

### Concept 1 — Scenario Set
A scenario set belongs to a project and groups one baseline with one or more alternatives.

### Concept 2 — Scenario Entry
A scenario entry is one member of the scenario set:
- baseline
- alternative A
- alternative B
- etc.

Each scenario entry can optionally reference:
- an attached analysis run,
- assumptions,
- narrative notes,
- and status.

## Information Architecture

### Primary route surface
- `src/app/(app)/scenarios/page.tsx`

Replace the placeholder with a real scenario-set catalog.

### Likely child routes
- `src/app/(app)/scenarios/[scenarioSetId]/page.tsx`
- `src/app/api/scenarios/route.ts`
- `src/app/api/scenarios/[scenarioSetId]/route.ts`
- `src/app/api/scenarios/[scenarioSetId]/entries/route.ts`

## Suggested Data Model

### `scenario_sets`
Fields:
- `id`
- `workspace_id`
- `project_id`
- `title`
- `summary` nullable
- `planning_question` nullable
- `status` (`draft`, `active`, `archived`)
- `baseline_entry_id` nullable
- `created_by`
- timestamps

### `scenario_entries`
Fields:
- `id`
- `scenario_set_id`
- `entry_type` (`baseline`, `alternative`)
- `label`
- `slug`
- `summary` nullable
- `assumptions_json` nullable
- `attached_run_id` nullable
- `status` (`draft`, `ready`, `superseded`)
- `sort_order`
- timestamps

### `scenario_comparisons`
Optional first-pass materialized comparison metadata.
Fields:
- `id`
- `scenario_set_id`
- `baseline_entry_id`
- `candidate_entry_id`
- `comparison_status` (`ready`, `stale`, `missing-run`)
- `metadata_json`
- timestamps

## V1 API Surface

### `GET /api/scenarios`
Returns scenario-set catalog for current workspace.

Supports:
- filter by project
- filter by status

### `POST /api/scenarios`
Creates a scenario set.

Input:
- `projectId`
- `title`
- optional `summary`
- optional `planningQuestion`

### `GET /api/scenarios/[scenarioSetId]`
Returns:
- scenario-set metadata
- project summary
- baseline entry
- alternative entries
- attached run summaries

### `PATCH /api/scenarios/[scenarioSetId]`
Updates scenario-set metadata.

### `POST /api/scenarios/[scenarioSetId]/entries`
Creates a scenario entry.

Input:
- `entryType`
- `label`
- optional `summary`
- optional `attachedRunId`
- optional assumptions

### `PATCH /api/scenarios/[scenarioSetId]/entries/[entryId]`
Updates scenario entry metadata, run attachment, label, assumptions, or status.

## V1 UI Plan

### A. Scenarios catalog page
Must include:
- scenario-set list
- create scenario set button
- project filter
- status filter
- quick counts for baseline/alternatives

### B. Scenario set detail page
Panels:
1. scenario-set metadata
2. project linkage
3. baseline panel
4. alternatives list
5. comparison summary zone
6. assumptions / planning question
7. linked reports / outputs (if available)

### C. Scenario entry composer
Simple first pass:
- label
- type
- summary
- attached run selector
- assumptions

## Comparison Strategy For V1

V1 should **reuse the existing Analysis Studio comparison posture where practical**, rather than inventing a second incompatible comparison system.

That means:
- if a baseline entry and candidate entry both have attached runs,
- surface the comparison summary using existing comparison-friendly data structures/patterns where available.

## Traceability Requirements

Every scenario set/detail view should disclose:
- linked project
- baseline identity
- alternative identity
- attached run IDs/timestamps when present
- assumptions / notes
- status of evidence readiness

## Ethical / Quality Gate Rules

Scenarios V1 must preserve:
- explicit assumptions,
- no overstated certainty,
- clear distinction between attached evidence vs narrative interpretation,
- no hidden AI authority posture.

## Technical Build Order

### Pass 1 — data + API foundation
- add migrations for scenario sets and entries
- add RLS + updated_at trigger coverage
- add CRUD endpoints
- add tests

### Pass 2 — catalog + detail surface
- replace `/scenarios` placeholder
- add scenario-set detail route
- add create flow

### Pass 3 — run attachment + baseline/alternative behavior
- attach saved analysis runs
- enforce one baseline per scenario set
- show structured comparison context when both runs exist

### Pass 4 — polish / report linkage
- linked report awareness
- empty states
- validation hardening
- status/audit copy refinement

## Acceptance Criteria

### Product acceptance
- `/scenarios` is no longer a placeholder
- user can create a scenario set linked to a project
- user can create one baseline and at least one alternative
- user can attach saved runs to entries
- scenario detail view clearly distinguishes baseline vs alternatives
- assumptions and evidence status are visible

### Engineering acceptance
- lint passes
- tests pass
- build passes
- auth/RLS protect records by workspace
- baseline uniqueness is enforced within a scenario set

## Key Risks

### Risk 1 — duplicating Analysis Studio comparison logic
Mitigation:
- reuse existing comparison structures where practical

### Risk 2 — turning V1 into a CEQA mega-system
Mitigation:
- keep first pass on scenario registry + attachment + structured comparison

### Risk 3 — weak baseline semantics
Mitigation:
- enforce one designated baseline and make state explicit everywhere

## Follow-On Expansions After V1

1. mitigation package builder
2. CEQA/VMT narrative templates
3. branch/version lineage between alternatives
4. report packet generation directly from scenario sets
5. engagement-linked scenario feedback loops

## Recommendation

Proceed with **Scenarios V1** as the next OpenPlan module.

This is the correct next build because it gives OpenPlan a durable planning-decision layer above raw runs and below final reports.
