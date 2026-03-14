# OpenPlan Data Hub Crash-Point Thematic Overlay Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — point datasets can now attach to analysis crash-point geometry

## Summary
Extended the Data Hub geometry-attachment system into the next honest point-level tier: analysis crash points.

This pass allows point datasets to declare an explicit attachment to the SWITRS-backed crash-point geometry already present in the analysis result and bind to crash-specific attributes for thematic rendering.

## What changed
### Schema
Added migration:
- `supabase/migrations/20260313000017_data_hub_crash_point_attachment.sql`

Expanded geometry attachment + thematic metric support to include:
- `geometry_attachment = analysis_crash_points`
- thematic metric keys:
  - `severityBucket`
  - `pedestrianInvolved`
  - `bicyclistInvolved`
  - `fatalCount`
  - `injuryCount`

### Data Hub API + UI
Updated:
- `src/app/api/data-hub/records/route.ts`
- `src/components/data-hub/data-hub-record-composer.tsx`
- `src/app/(app)/data-hub/page.tsx`

Added guardrails:
- crash-point geometry attachment requires `geography_scope = point`
- geometry attachments still require a thematic metric key

### Analysis Studio
Updated:
- `src/app/api/analysis/context/route.ts`
- `src/app/(app)/explore/page.tsx`

Point datasets attached to `analysis_crash_points` can now render as thematic overlays using the real SWITRS crash-point geometry already present in the run.

## Why this matters
OpenPlan now has an honest geometry-attachment ladder across three real tiers:
- tracts
- corridor/route geometry
- crash-point geometry

That is materially closer to a real planning data fabric than the earlier generic coverage-only model.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `144` tests)
- `npm run build` ✅

## Recommended next step
1. Surface explicit point-attachment posture in Analysis Studio legends / inspectors
2. Add non-crash point attachment models for asset / observation datasets over time
3. Expand analysis-context tests to cover point thematic-ready datasets explicitly
