# OpenPlan Analysis Studio Project Context Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — Projects/Data Hub bridge surfaced in Analysis Studio

## Summary
Bound the new Planning OS spine back into Analysis Studio by adding a workspace context API and a visible project/dataset context panel.

This does **not** pretend that every linked dataset is already a drawable map layer.
Instead, it makes the current relationship honest and legible:
- which project this workspace belongs to
- how much project operating structure exists
- which datasets are linked to the project
- which linked datasets are actually overlay-ready versus registry-only

## What changed
### API
Added:
- `src/app/api/analysis/context/route.ts`

This route returns, for the current workspace:
- attached project summary
- project record counts (deliverables, risks, issues, decisions, meetings)
- recent analysis runs
- linked datasets from Data Hub
- overlay readiness flags
- migration-pending posture if the Data Hub schema is not yet applied

### Auth / role matrix
Updated:
- `src/lib/auth/role-matrix.ts`
- `src/test/op001-role-matrix-conformance.test.ts`

Added explicit read permission for:
- `analysis.context.read`

### Analysis Studio UI
Updated:
- `src/app/(app)/explore/page.tsx`

Added a new **Project Context** block in Analysis Studio showing:
- current project identity and status
- counts for project records, linked datasets, and recent runs
- direct links to Project Detail and Data Hub
- a map-linked dataset queue with overlay-ready vs registry-only posture
- migration-safe notice when Data Hub tables are not live yet

### Tests
Added:
- `src/test/analysis-context-route.test.ts`

Coverage includes:
- unauthorized access
- successful project/dataset context response
- graceful degradation when Data Hub schema is pending

## Why this matters
OpenPlan was starting to regain structure in separate silos:
- Projects
- Data Hub
- Analysis Studio

This pass makes the product feel more like one system again.
Analysis Studio now reflects the operational context around a run, not just the run itself.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`27` files / `139` tests)
- `npm run build` ✅

## Recommended next step
1. Turn overlay-ready datasets into actual selectable map overlay lanes
2. Add SWITRS collision points + severity filters
3. Attach project context directly to saved runs for stronger traceability
