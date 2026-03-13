# OpenPlan Projects Module — First Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — first real Planning OS module established

## Summary
Implemented the first real data-backed Planning OS module: **Projects**.

This moves OpenPlan beyond shell-only restructuring and begins the actual domain correction from corridor-centered app toward a broader planning operating system.

## What shipped
### Data model
- Added migration: `supabase/migrations/20260313000011_projects_module.sql`
- New `projects` table includes:
  - `id`
  - `workspace_id`
  - `name`
  - `summary`
  - `status`
  - `plan_type`
  - `delivery_phase`
  - `created_by`
  - timestamps
- Added RLS policies and updated-at trigger.

### API
- Extended `src/app/api/projects/route.ts`
- `POST /api/projects` now:
  - creates workspace shell
  - creates owner membership
  - creates a real `projects` record
  - returns `projectRecordId` + project metadata
- Added `GET /api/projects` for authenticated project list retrieval.

### UI / UX
- Added project creation panel:
  - `src/components/projects/project-workspace-creator.tsx`
- Replaced Projects placeholder page with a real module surface:
  - `src/app/(app)/projects/page.tsx`
- Added project detail page:
  - `src/app/(app)/projects/[projectId]/page.tsx`

## Current product meaning
Projects now function as real records inside OpenPlan rather than pure placeholders.
This is still an early module, but it establishes the correct product direction:
- create project container
- attach workspace
- inspect project summary/status/type/phase
- view recent runs and stage-gate decisions from the linked workspace

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`24` files / `129` tests)
- `npm run build` ✅

## Recommended next module expansion
Build out project sub-objects in this order:
1. Deliverables
2. Risks / Issues
3. Decisions
4. Meetings / notes
5. Activity timeline / event stream

## Strategic note
This pass keeps the current workspace-based architecture alive while introducing an explicit Planning OS domain object. It is a transitional but productive move and should now be used as the precedent for Plans, Programs, and Engagement.
