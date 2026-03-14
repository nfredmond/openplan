# OpenPlan Active Overlay Legend Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — active thematic overlays now explain themselves in Analysis Studio

## Summary
Followed the new tract / corridor / crash-point thematic overlay work with an operator-legibility pass inside Analysis Studio.

When a thematic overlay is active, the map chrome now explains:
- whether the selected overlay is coverage vs thematic
- which metric is driving the overlay
- what the legend colors or point categories mean

## What changed
Updated:
- `src/app/(app)/explore/page.tsx`

Added:
- active overlay legend model
- point-specific legend handling for crash-point thematic overlays
- clearer active overlay card copy for:
  - tract overlays
  - corridor overlays
  - crash-point overlays

## Why this matters
OpenPlan's new thematic overlay capability is much more useful when the operator does not have to infer what the colors mean.
This pass turns the active overlay box into a real explanatory surface instead of just a status line.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `144` tests)
- `npm run build` ✅

## Recommended next step
1. Expand automated tests around non-tract thematic-ready datasets in analysis context
2. Add non-crash point attachment models for asset / observation datasets
3. Surface overlay legends in report/download history or artifact previews over time
