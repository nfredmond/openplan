# OpenPlan Projects Subrecords Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — project control layer added

## Summary
Extended the new Projects module with three first-class project subrecord types:
1. Deliverables
2. Risks
3. Decisions

This turns the project detail page from a static record shell into an initial project control room.

## What shipped
### Database
Added migration:
- `supabase/migrations/20260313000012_project_subrecords.sql`

New tables:
- `project_deliverables`
- `project_risks`
- `project_decisions`

Each table includes:
- FK to `projects`
- timestamps
- creator linkage
- RLS policies derived from project -> workspace membership
- updated-at trigger coverage

### API
Added dynamic route:
- `src/app/api/projects/[projectId]/records/route.ts`

Current behavior:
- authenticated `POST`
- validates project access
- creates one of:
  - deliverable
  - risk
  - decision

### UI / UX
Added creation surface:
- `src/components/projects/project-record-composer.tsx`

Updated project detail page:
- `src/app/(app)/projects/[projectId]/page.tsx`

New visible sections:
- Deliverables list
- Risks list
- Decisions list
- Existing runs / governance sections retained

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`25` files / `132` tests)
- `npm run build` ✅

## Product meaning
OpenPlan now has a meaningful project-operations layer:
- create a project
- add outputs to ship
- log threats/mitigations
- record why key choices were made

That is still early, but it is materially closer to a real Planning OS than the prior corridor-only posture.

## Recommended next step
Add project timeline + meetings/notes + issue tracking, then connect those records to reports/binders and stage-gate evidence views.
