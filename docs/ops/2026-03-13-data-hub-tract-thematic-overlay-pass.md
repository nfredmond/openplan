# OpenPlan Data Hub Tract Thematic Overlay Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — first true thematic overlay path from Data Hub into Analysis Studio

## Summary
Advanced the Data Hub / overlay lane from simple coverage footprints into the first honest thematic overlay path.

This pass introduces explicit dataset-side geometry attachment metadata and uses it to let tract-scoped datasets render as real thematic overlays when they are bound to:
- existing analysis tract geometry
- a known tract metric already present on that geometry

## What changed
### Schema
Added migration:
- `supabase/migrations/20260313000015_data_hub_geometry_attachment.sql`

New dataset metadata fields:
- `geometry_attachment`
- `thematic_metric_key`
- `thematic_metric_label`

### Data Hub API + form
Updated:
- `src/app/api/data-hub/records/route.ts`
- `src/components/data-hub/data-hub-record-composer.tsx`
- `src/app/(app)/data-hub/page.tsx`

Datasets can now declare:
- coverage only
- or bind to analysis tracts for thematic rendering

Guardrails added:
- tract geometry attachment requires `geography_scope = tract`
- tract geometry attachment requires a thematic metric key

### Analysis Studio context + rendering
Updated:
- `src/app/api/analysis/context/route.ts`
- `src/app/(app)/explore/page.tsx`

Analysis Studio now distinguishes between:
- `overlayReady`
- `thematicReady`

When a linked dataset is thematic-ready, the selected overlay becomes a real tract thematic layer instead of an orange coverage footprint.

### Current supported thematic metric bindings
Thematic-ready tract datasets can bind to existing tract metrics already present on analysis geometry:
- `pctMinority`
- `pctBelowPoverty`
- `medianIncome`
- `isDisadvantaged`
- `zeroVehiclePct`
- `transitCommutePct`

## Why this matters
This is the first concrete step from:
- "Data Hub knows about a dataset"

to:
- "That dataset can actually drive a map theme in Analysis Studio"

It does so without faking arbitrary geometry pipelines or pretending all datasets are map-ready.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `143` tests)
- `npm run build` ✅

## Recommended next step
1. Show thematic-attachment posture more explicitly inside the Data Hub dataset cards
2. Add non-tract geometry attachment types over time (corridor/route/point)
3. Start binding attached dataset identity into report/export artifacts when thematic overlays are active
