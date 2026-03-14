# OpenPlan Active Overlay Artifact Context Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — selected overlay identity now travels with reports and exports

## Summary
Extended the map-context persistence thread so artifacts do not just say that an overlay was selected — they now preserve which dataset was active and, when thematic, which metric was driving the map.

## What changed
### Map-view state model
Updated `src/lib/analysis/map-view-state.ts` to support:
- `activeOverlayContext`
  - dataset id
  - dataset name
  - overlay mode (`coverage_footprint` or `thematic_overlay`)
  - geometry attachment
  - thematic metric key
  - thematic metric label
  - connector label

### Run persistence + report intake
Updated:
- `src/app/api/runs/route.ts`
- `src/app/api/report/route.ts`

Run persistence and report generation now accept/store the richer active overlay context.

### Analysis Studio
Updated `src/app/(app)/explore/page.tsx` so current map-view state includes resolved overlay identity when a dataset overlay is active.

### Artifact effect
Reports and other map-view driven artifacts can now preserve:
- which linked dataset was selected
- whether it was just a coverage footprint or a true thematic overlay
- which thematic metric was active when relevant

## Why this matters
This removes the last major ambiguity in the current map-context artifact chain.
Now a later reader can tell not just that an overlay existed, but exactly which dataset and theme shaped the planning view.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `143` tests)
- `npm run build` ✅

## Recommended next step
1. Surface active overlay identity inside report/download history surfaces
2. Add corridor / route / point geometry attachment types beyond tracts
3. Introduce richer dataset-native thematic pipelines over time
