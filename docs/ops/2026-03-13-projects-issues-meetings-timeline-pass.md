# OpenPlan Projects Issues + Meetings + Timeline Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — project operating workspace expanded

## Summary
Extended the Projects module again with:
- Issues
- Meetings
- Activity timeline

This makes the project detail page behave much more like an actual operating workspace.

## What shipped
### Database
Added migration:
- `supabase/migrations/20260313000013_project_issues_meetings.sql`

New tables:
- `project_issues`
- `project_meetings`

### API
Extended:
- `src/app/api/projects/[projectId]/records/route.ts`

Now supports creation of:
- deliverable
- risk
- issue
- decision
- meeting

### UI / UX
Updated:
- `src/components/projects/project-record-composer.tsx`
- `src/app/(app)/projects/[projectId]/page.tsx`

New project detail capabilities:
- issue logging
- meeting logging
- unified activity timeline from subrecords + runs + stage-gate decisions

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`25` files / `133` tests)
- `npm run build` ✅

## Product meaning
The Projects module now has the beginnings of a true execution spine:
- what we must ship
- what is going wrong
- why we chose something
- who met and what happened
- what recently changed across the project

## Recommended next step
Use this operating layer to drive:
1. binder/report assembly
2. engagement linkage
3. project-level dashboard summaries
4. scenario/model traceability into project records
