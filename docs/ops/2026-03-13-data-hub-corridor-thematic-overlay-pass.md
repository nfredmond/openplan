# OpenPlan Data Hub Corridor Thematic Overlay Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — corridor/route datasets can now attach to analysis corridor geometry

## Summary
Extended the new Data Hub thematic overlay bridge beyond tracts into the next honest geometry type: analysis corridor geometry.

This pass allows corridor/route datasets to declare an explicit geometry attachment to the existing analysis corridor and bind to corridor-scale metrics already present on the run.

## What changed
### Schema
Added migration:
- `supabase/migrations/20260313000016_data_hub_corridor_attachment.sql`

Expanded allowed attachment / metric values to support:
- `geometry_attachment = analysis_corridor`
- thematic metric keys:
  - `overallScore`
  - `accessibilityScore`
  - `safetyScore`
  - `equityScore`

### Data Hub API + composer
Updated:
- `src/app/api/data-hub/records/route.ts`
- `src/components/data-hub/data-hub-record-composer.tsx`
- `src/app/(app)/data-hub/page.tsx`

Added guardrails:
- corridor geometry attachment requires `geography_scope = corridor` or `route`
- geometry attachments still require a thematic metric key

### Analysis context + map rendering
Updated:
- `src/app/api/analysis/context/route.ts`
- `src/app/(app)/explore/page.tsx`

Analysis Studio can now treat corridor/route datasets as `thematicReady` when they are attached to analysis corridor geometry.

Selected corridor thematic datasets render against the real corridor geometry using real run-level corridor scores, instead of falling back to an orange generic footprint.

## Why this matters
OpenPlan is no longer tract-only for thematic overlay behavior.
It now has the beginning of a geometry-attachment framework:
- tract geometry attachment
- corridor geometry attachment

That is a much stronger foundation for future route and point-level attachment models.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `143` tests)
- `npm run build` ✅

## Recommended next step
1. Add point-level attachment types for crash / asset / observation datasets
2. Surface active thematic overlay identity in more artifact/history surfaces
3. Expand thematic-ready tests to cover corridor attachment cases explicitly
