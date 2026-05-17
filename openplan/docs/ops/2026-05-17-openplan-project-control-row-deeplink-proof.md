# OpenPlan project control row deep-link proof

**Date:** 2026-05-17  
**Status:** Implemented and locally validated  
**Scope:** Small safe buyer/demo-readiness slice for project detail controls.

## Why this slice

The May 17 launch evidence checklist left authenticated production deep-link proof pending for project report packet routing. The next safe code slice was to reduce ambiguity in the same project-control surface without touching production data or requiring Nathaniel approval: when the project control room surfaces blocked/overdue controls, links should resolve to the first concrete row instead of only the lane section.

## What changed

- `src/lib/projects/controls.ts`
  - Adds `targetRowId` to blocked milestone, overdue milestone, overdue submittal, and overdue invoice attention summaries.
  - Recommended next actions for blocked/overdue controls now carry the first concrete row anchor when a row id exists.
- `src/app/(app)/projects/[projectId]/_components/project-delivery-board.tsx`
  - Attention-lane links now consume the summary-provided row anchors instead of rebuilding them locally.
- `src/test/project-controls-summary.test.ts`
  - Adds coverage proving attention and next-action controls deep-link to the first blocked/overdue row.

## Validation

Run from `openplan/openplan`:

```bash
npm test -- --run src/test/project-detail-page.test.tsx src/test/project-controls-summary.test.ts
npm run lint -- 'src/app/(app)/projects/[projectId]/_components/project-delivery-board.tsx' src/lib/projects/controls.ts src/test/project-controls-summary.test.ts
```

Result:

- Test files: **2 passed**
- Tests: **13 passed**
- ESLint: **passed**

## Boundary

This does not close the production authenticated walkthrough item in `2026-05-17-openplan-launch-evidence-checklist.md`. It improves local/app behavior so the eventual walkthrough has fewer ambiguous lane-only links to verify.
