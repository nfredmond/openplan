# OpenPlan Plans Module — V1 Plan

Date: 2026-03-15
Owner: Bartholomew (COO)
Status: PROPOSED — recommended next module after Engagement foundation
Priority: HIGH

## Executive Decision

The next OpenPlan module should be **Plans**.

OpenPlan now has:
- stronger Analysis Studio workflows,
- real Reports,
- real Scenarios,
- real Engagement foundations,
- and a visible placeholder gap at `/plans`.

Plans V1 should become the system of record for formal planning artifacts such as corridor plans, ATPs, safety plans, regional plans, and related plan objects.

It should **not** try to become a full document editor or every compliance workflow in the first pass.

## Why Plans Next

### Current platform state
OpenPlan already has enough substrate to support a real Plans layer:
- **Projects** hold execution context
- **Scenarios** hold alternatives/baselines
- **Engagement** can hold input campaigns
- **Reports** can hold packet/output generation
- `/plans` is still a placeholder, making it the next strong module gap

### Strategic reason
Plans is the right next module because it:
1. gives the Planning OS a durable “formal plan object” layer,
2. connects projects/scenarios/engagement/reports into one planning record,
3. creates a clean bridge toward Programs/funding packaging later,
4. matches Nathaniel’s actual planning domain work (ATP, corridor, safety, RTP, etc.),
5. reduces the feeling that OpenPlan is only analysis + engagement surfaces.

## Product Thesis

OpenPlan Plans is not just a list of PDFs.

It is the structured operating surface where a workspace can define:
- what a plan is,
- what type it is,
- what geography/time horizon it covers,
- what projects/scenarios/engagement work feed it,
- and what stage/chapters/readiness state it is in.

## V1 Goal

Enable Nathaniel to create a plan record linked to a project, define its type/horizon/status, attach related scenarios and engagement campaigns, and review the plan from a real `/plans` module.

## V1 Success Criteria

Plans V1 is successful when a user can:
1. open `/plans`,
2. see a catalog of plan records,
3. create a plan linked to a project,
4. define plan type, geography, and horizon year,
5. attach related scenarios/reports/engagement campaigns,
6. review readiness/status from a plan detail page,
7. understand how the plan connects to the rest of the Planning OS.

## Explicit Non-Goals for V1

Do **not** include in the first pass:
- full rich-text chapter editor,
- every regulatory/compliance template,
- automatic CEQA narrative generation,
- collaborative external review workflows,
- DOCX document production,
- publishing portal.

## Module Scope

### In scope
1. **Plan catalog**
2. **Plan creation flow**
3. **Plan detail page**
4. **Plan typology + status + horizon metadata**
5. **Project linkage**
6. **Related scenarios / engagement / reports linkage**
7. **Light readiness summary**

### Out of scope
- full document authoring
- public publishing
- approvals/comments system
- exhaustive compliance engines

## Recommended V1 Object Model

### Concept 1 — Plan Record
A formal planning object (corridor plan, ATP, safety plan, RTP, etc.) linked to a workspace and optionally a primary project.

### Concept 2 — Plan Linkages
A plan can reference:
- related scenarios
- related engagement campaigns
- related reports
- related project records

### Concept 3 — Plan Readiness Summary
A light, computed view of whether the plan has enough connected artifacts to move forward.

## Information Architecture

### Primary route surface
- `src/app/(app)/plans/page.tsx`

Replace the placeholder with a real plan catalog.

### Likely child routes
- `src/app/(app)/plans/[planId]/page.tsx`
- `src/app/api/plans/route.ts`
- `src/app/api/plans/[planId]/route.ts`

## Suggested Data Model

### `plans`
Fields:
- `id`
- `workspace_id`
- `project_id` nullable
- `title`
- `plan_type` (`corridor`, `atp`, `safety`, `regional`, `complete_streets`, `other`)
- `status` (`draft`, `active`, `adopted`, `archived`)
- `geography_label` nullable
- `horizon_year` nullable
- `summary` nullable
- `created_by`
- timestamps

### `plan_links`
Fields:
- `id`
- `plan_id`
- `link_type` (`scenario_set`, `engagement_campaign`, `report`, `project_record`)
- `linked_id`
- `label` nullable
- timestamps

## V1 API Surface

### `GET /api/plans`
Returns plan catalog for current workspace.

Supports:
- filter by project
- filter by plan type
- filter by status

### `POST /api/plans`
Creates a plan.

Input:
- `projectId` optional
- `title`
- `planType`
- optional `status`
- optional `geographyLabel`
- optional `horizonYear`
- optional `summary`

### `GET /api/plans/[planId]`
Returns:
- plan metadata
- linked project summary
- linked scenarios
- linked engagement campaigns
- linked reports
- readiness summary

### `PATCH /api/plans/[planId]`
Updates plan metadata.

## V1 UI Plan

### A. Plans catalog page
Must include:
- plan list
- create plan action
- filters for type/status/project
- quick counts by plan type/status

### B. Plan detail page
Panels:
1. plan metadata
2. linked project
3. related scenarios
4. related engagement campaigns
5. related reports
6. readiness summary

### C. Plan creator
Inputs:
- title
- plan type
- project link
- status
- geography label
- horizon year
- summary

## Readiness Strategy For V1

Keep it light and explicit.

Examples of readiness signals:
- has linked project
- has linked scenario set
- has linked engagement campaign
- has linked report
- has horizon year
- has geography label

No fake scoring. Just transparent readiness checks.

## Traceability Requirements

Every plan detail page should disclose:
- what the plan is
- what project it belongs to
- what scenarios/engagement/reports feed it
- current status
- horizon/geography metadata
- readiness basis

## Ethical / Quality Gate Rules

Plans V1 must preserve:
- no fake completeness,
- no hidden readiness scoring,
- clear distinction between linked artifacts and finished plan outputs,
- explicit status/readiness language.

## Technical Build Order

### Pass 1 — data + API foundation
- add migrations for plans and plan_links
- add RLS + updated_at triggers
- add CRUD endpoints
- add tests

### Pass 2 — catalog + detail surface
- replace `/plans` placeholder
- add plan detail route
- add create flow

### Pass 3 — linkage + readiness refinement
- attach scenarios/engagement/reports cleanly
- improve readiness summary and operator value

## Acceptance Criteria

### Product acceptance
- `/plans` is no longer a placeholder
- user can create a plan record
- user can define type/status/horizon/geography
- user can view a detail page with linkages and readiness

### Engineering acceptance
- lint passes
- tests pass
- build passes
- auth/RLS protect plans by workspace

## Key Risks

### Risk 1 — turning V1 into a document editor
Mitigation:
- keep V1 on plan records + linkages, not full chapter authoring

### Risk 2 — vague readiness scoring
Mitigation:
- use explicit checklist-style readiness summaries only

### Risk 3 — too many plan types at once
Mitigation:
- use a narrow typology enum and expand later

## Follow-On Expansions After V1

1. chapter/status breakdowns
2. plan templates by plan type
3. direct report packet generation from plans
4. plan-to-program linkage and funding cycle integration
5. richer adoption/compliance tracking

## Recommendation

Proceed with **Plans V1** as the next OpenPlan module.

This is the right next build because it gives the Planning OS a formal planning-record layer that ties together the modules that are now being built underneath it.
