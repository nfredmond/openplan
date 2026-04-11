# OpenPlan Engagement Module — V1 Plan

Date: 2026-03-14
Owner: Bartholomew (COO)
Status: PROPOSED — recommended next module after Reports + Scenarios
Priority: HIGH

## Executive Decision

The next OpenPlan module should be **Engagement**.

OpenPlan now has:
- stronger Analysis Studio workflows,
- a real Reports layer,
- a real Scenarios layer,
- and a visible placeholder gap at `/engagement`.

Engagement V1 should become the platform surface for structured public-input campaigns, intake, moderation, and traceable linkage into projects/plans/scenarios.

It should **not** attempt a full public-social platform or every outreach modality in the first pass.

## Why Engagement Next

### Current platform state
OpenPlan already has enough substrate to support a real Engagement layer:
- **Projects** can act as campaign containers
- **Scenarios** can receive/benefit from public-input linkage later
- **Reports** can become the output layer for engagement summaries
- **Analysis Studio** can ultimately connect public feedback with corridor/place-specific evidence
- `/engagement` is still a placeholder, making it the next obvious module gap

### Strategic reason
Engagement is the right next module because it:
1. fulfills the broader Planning OS vision beyond internal analysis,
2. moves OpenPlan closer to Social Pinpoint-like utility,
3. creates a citizen/stakeholder input lane that can feed plans, projects, and scenarios,
4. strengthens differentiation from a pure analysis/reporting app,
5. gives the platform a stronger multi-stakeholder operating model.

## Product Thesis

OpenPlan Engagement is not merely a comment inbox.

It is the planning-operations surface where a workspace can:
- define engagement campaigns,
- collect and moderate public/stakeholder input,
- structure themes and categories,
- and trace what input influenced planning outputs.

As of the 2026-04-10 research synthesis, this should also be read as part of a larger rule:
- engagement should connect to shared scenarios, accessibility/equity/environment indicators, and publishable planning comparisons,
- but those richer feedback loops should arrive through the same shared scenario/evidence spine rather than via one-off engagement-only logic.

## V1 Goal

Enable Nathaniel to create an engagement campaign linked to a project, define a few intake categories, record/map public input items, moderate them, and review the campaign from a real `/engagement` module.

## V1 Success Criteria

Engagement V1 is successful when a user can:
1. open `/engagement`,
2. see a catalog of engagement campaigns,
3. create a campaign linked to a project,
4. define basic feedback categories,
5. store public-input items with status/location/category metadata,
6. moderate or classify those items,
7. review campaign totals and recent items from a detail page,
8. understand which project the campaign belongs to.

## Explicit Non-Goals for V1

Do **not** include in the first pass:
- full public-facing portal auth flows,
- advanced sentiment AI pipelines,
- live map drawing/editing for public users,
- file upload-heavy workflows,
- multilingual publishing system,
- survey-builder complexity explosion,
- collaborative moderation roles beyond simple internal operator handling,
- direct scenario/report synthesis automation.

## Module Scope

### In scope
1. **Campaign catalog**
2. **Campaign creation flow**
3. **Project linkage**
4. **Feedback category setup**
5. **Feedback item registry**
6. **Moderation/status handling**
7. **Campaign detail page with counts + recent feedback**

### Out of scope
- public publishing system
- advanced survey engines
- sentiment clustering AI
- media uploads
- full external participant portal

## Recommended V1 Object Model

### Concept 1 — Engagement Campaign
A campaign belongs to a workspace and can be linked to a project.

### Concept 2 — Engagement Category
A category structures the kinds of feedback being collected (e.g. safety, access, parking, crossings, transit, aesthetics).

### Concept 3 — Engagement Item
A feedback/input record tied to a campaign, optionally categorized and optionally geolocated, with moderation/status metadata.

## Information Architecture

### Primary route surface
- `src/app/(app)/engagement/page.tsx`

Replace the placeholder with a real campaign catalog.

### Likely child routes
- `src/app/(app)/engagement/[campaignId]/page.tsx`
- `src/app/api/engagement/campaigns/route.ts`
- `src/app/api/engagement/campaigns/[campaignId]/route.ts`
- `src/app/api/engagement/campaigns/[campaignId]/categories/route.ts`
- `src/app/api/engagement/campaigns/[campaignId]/items/route.ts`
- `src/app/api/engagement/campaigns/[campaignId]/items/[itemId]/route.ts`

## Suggested Data Model

### `engagement_campaigns`
Fields:
- `id`
- `workspace_id`
- `project_id` nullable
- `title`
- `summary` nullable
- `status` (`draft`, `active`, `closed`, `archived`)
- `engagement_type` (`map_feedback`, `comment_collection`, `meeting_intake`) for light first-pass structuring
- `created_by`
- timestamps

### `engagement_categories`
Fields:
- `id`
- `campaign_id`
- `label`
- `slug`
- `description` nullable
- `sort_order`
- timestamps

### `engagement_items`
Fields:
- `id`
- `campaign_id`
- `category_id` nullable
- `title` nullable
- `body`
- `submitted_by` nullable
- `status` (`pending`, `approved`, `rejected`, `flagged`)
- `source_type` (`internal`, `public`, `meeting`, `email`) default sensible value
- `latitude` nullable
- `longitude` nullable
- `metadata_json` nullable
- `moderation_notes` nullable
- timestamps

## V1 API Surface

### `GET /api/engagement/campaigns`
Returns campaign catalog for current workspace.

Supports:
- filter by project
- filter by status

### `POST /api/engagement/campaigns`
Creates a campaign.

Input:
- `projectId` optional
- `title`
- optional `summary`
- optional `engagementType`

### `GET /api/engagement/campaigns/[campaignId]`
Returns:
- campaign metadata
- linked project summary
- categories
- recent items
- counts by status/category

### `PATCH /api/engagement/campaigns/[campaignId]`
Updates campaign metadata/status.

### `POST /api/engagement/campaigns/[campaignId]/categories`
Creates a category.

### `POST /api/engagement/campaigns/[campaignId]/items`
Creates a feedback item.

### `PATCH /api/engagement/campaigns/[campaignId]/items/[itemId]`
Updates moderation/category/status/body metadata.

## V1 UI Plan

### A. Engagement catalog page
Must include:
- campaign list
- create campaign action
- status/project filters
- quick counts for active/closed campaigns

### B. Campaign detail page
Panels:
1. campaign metadata
2. linked project context
3. category registry
4. recent/public input item list
5. moderation/status summary
6. basic operator actions

### C. Campaign creator
Inputs:
- title
- summary
- project link
- engagement type

### D. Feedback item composer
Inputs:
- category
- title/body
- optional submitter/source
- optional lat/lng
- status/moderation notes for internal use

## Traceability Requirements

Every campaign/detail view should disclose:
- linked project (if any)
- status
- category structure
- counts by moderation state
- whether items are geolocated or not
- explicit note that this is an internal/operator surface in V1 unless public publishing is later added

## Ethical / Quality Gate Rules

Engagement V1 must preserve:
- no fake public consensus,
- no hidden moderation logic,
- clear distinction between collected input and staff interpretation,
- transparent status handling for feedback items.

## Technical Build Order

### Pass 1 — data + API foundation
- add migrations for campaigns/categories/items
- add RLS + updated_at triggers
- add CRUD endpoints
- add tests

### Pass 2 — catalog + campaign detail surface
- replace `/engagement` placeholder
- add campaign detail route
- add create flow

### Pass 3 — moderation/operator refinement
- better moderation/status flows
- category analytics/counts
- lightweight report linkage where appropriate

## Acceptance Criteria

### Product acceptance
- `/engagement` is no longer a placeholder
- user can create a campaign
- user can link campaign to a project
- user can create categories
- user can add and moderate feedback items
- campaign detail page clearly surfaces counts and recent items

### Engineering acceptance
- lint passes
- tests pass
- build passes
- auth/RLS protect campaigns/categories/items by workspace

## Key Risks

### Risk 1 — overbuilding a public portal too soon
Mitigation:
- keep V1 operator-facing and internal first

### Risk 2 — weak linkage to planning outputs
Mitigation:
- ensure project linkage and future report/scenario handoff posture are visible from day one

### Risk 3 — moderation ambiguity
Mitigation:
- make status states explicit and auditable

## Follow-On Expansions After V1

1. public campaign share/publish flow
2. map pin/drop UI for participant submissions
3. clustering / theme extraction
4. engagement-to-scenario/report synthesis
5. outreach reporting exports

## Recommendation

Proceed with **Engagement V1** as the next OpenPlan module.

This is the right next build because it expands OpenPlan from internal planning intelligence into a more complete stakeholder-facing Planning OS foundation.
