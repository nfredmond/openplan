# OpenPlan Report Route Build Repair Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — report route restored to build-clean state

## Summary
Repaired a build regression introduced during the overlay-summary hardening work.

The failure path was in `src/app/api/report/route.ts` around the newer shared map-view summary wiring. The route has been restored to a self-contained summary path that preserves the richer overlay metadata while keeping the server build stable.

## What changed
Updated:
- `src/app/api/report/route.ts`

Key adjustment:
- removed the fragile shared-helper dependency from the server report route
- restored a local, explicit `buildMapViewSummary()` path
- preserved richer overlay summary fields including:
  - active overlay dataset
  - overlay mode
  - overlay geometry

## Why this matters
The latest local state needed to be brought back to build-clean before further feature work continued. This pass re-establishes a stable base without backing out the new overlay summary semantics.

## Validation
- `npm run lint` ✅
- `npm test` ✅
- `npm run build` ✅

## Recommended next step
Resume forward motion from the stabilized base:
1. continue honest point-data families beyond crash points
2. keep expanding source-backed geometry attachment types
3. fold the stronger overlay summaries into more artifact/history surfaces over time
