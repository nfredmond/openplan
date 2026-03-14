# OpenPlan Overlay Summary Hardening Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — map-view summaries now include overlay mode and geometry attachment

## Summary
Extended the shared map-view summary contract so Run History, comparison UI, and report artifacts no longer stop at the overlay dataset name.

They now also preserve:
- overlay mode
- geometry attachment type

## What changed
### Shared helper
Updated:
- `src/lib/analysis/map-view-state.ts`

Added:
- `formatGeometryAttachmentLabel`
- `formatOverlayModeLabel`
- richer `summarizeMapViewState()` output when active overlay context exists

### Reports
Updated:
- `src/app/api/report/route.ts`

Report generation now uses the shared map-view helper so overlay summaries stay consistent across surfaces.

### Tests
Added/updated:
- `src/test/map-view-state.test.ts`
- `src/test/report-route.test.ts`

## Why this matters
OpenPlan artifacts can now say not just which dataset was selected, but whether it was:
- a coverage footprint or thematic overlay
- attached to tracts, corridor geometry, or crash-point geometry

That improves auditability and reduces ambiguity in later review.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`29` files / `149` tests)
- `npm run build` ✅

## Recommended next step
1. Add non-crash point attachment models for asset / observation datasets
2. Surface attachment-type deltas more explicitly in comparison exports
3. Continue building outward from the geometry ladder with honest source-backed point datasets
