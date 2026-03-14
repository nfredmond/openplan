# OpenPlan Data Hub Readiness Surface Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — Data Hub now visibly distinguishes coverage / overlay / thematic readiness

## Summary
Followed the tract thematic-overlay bridge with a UI polish pass so operators can see dataset readiness directly inside Data Hub without inferring it from Analysis Studio.

## What changed
Updated `src/app/(app)/data-hub/page.tsx` to surface:
- overlay-ready dataset count
- thematic-ready dataset count
- card-level readiness badges:
  - Coverage-only
  - Overlay-ready
  - Thematic-ready
- geometry attachment chips
- thematic metric chips
- an explicit overlay-posture panel on each dataset card

## Why this matters
OpenPlan now communicates the readiness ladder more clearly:
- registry only
- drawable coverage
- true thematic overlay

That makes Data Hub more operator-grade and reduces ambiguity about what a linked dataset will actually do in Analysis Studio.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `143` tests)
- `npm run build` ✅

## Recommended next step
1. Attach active thematic overlay identity into report/export artifacts when selected
2. Add more geometry attachment types beyond analysis tracts
3. Start introducing point / route / corridor-specific thematic attachment models over time
