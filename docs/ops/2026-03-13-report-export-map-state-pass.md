# OpenPlan Report / Export Map-State Persistence Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — map-view persistence into runs, reports, and exports

## Summary
Extended the SWITRS / Analysis Studio work so the current map-view state is no longer ephemeral.

This pass makes OpenPlan preserve and propagate the operator's current map posture across:
- saved runs
- report generation
- CSV exports
- GeoJSON exports

That means crash severity filters, VRU filters, tract theme, crash lane visibility, tract visibility, and selected project-linked overlay state can now travel with the analytical artifact instead of living only in the browser session.

## What changed
### Run persistence
Updated `src/app/api/runs/route.ts` to support `PATCH /api/runs` for map-view updates.

Stored shape includes:
- `tractMetric`
- `showTracts`
- `showCrashes`
- `crashSeverityFilter`
- `crashUserFilter`
- `activeDatasetOverlayId`

Updated auth matrix + conformance test to include:
- `runs.update`

### Analysis Studio restore behavior
Updated `src/app/(app)/explore/page.tsx` so reloading a saved run restores persisted map state back into the live UI.

Also added a soft-save behavior that writes map-view changes back to the run without interrupting active analysis work.

### Reports
Updated `src/app/api/report/route.ts` so report generation can include current map-view context.

HTML/PDF reports now carry an **Active Map View** section when that state is present.

### Exports
Updated `src/lib/export/download.ts` and Analysis Studio export calls so:
- CSV metrics flatten `mapViewState.*`
- exported GeoJSON carries `metadata.mapViewState`

## Why this matters
Before this pass, SWITRS and tract/data-hub map work was visually useful but not durable.
Now the exported artifact can explain:
- which crash slice the planner was looking at
- whether the crash lane was visible
- which tract theme was active
- whether a project-linked overlay was selected

That makes OpenPlan's outputs more auditable and more useful for later review.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `142` tests)
- `npm run build` ✅

## Recommended next step
1. Surface persisted map-view metadata in Run History UI
2. Bind report/export metadata into comparison workflows
3. Continue Data Hub geometry attachment so overlays can progress from coverage footprints to true thematic layers
