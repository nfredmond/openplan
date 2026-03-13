# OpenPlan Census Tract Choropleth Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — first tract geometry + choropleth pass

## Summary
Added the first real census tract geometry overlay pipeline to Analysis Studio.

This pass moves the map from:
- corridor-only geometry + point preview

to:
- corridor geometry
- tract overlay retrieval from Census TIGERweb
- choropleth-ready tract properties
- tract theme switching in the Mapbox interface

## What changed
### Backend / analysis pipeline
- Added `src/lib/data-sources/census-geometry.ts`
- Analysis pipeline now fetches tract geometry from Census TIGERweb based on corridor bbox
- Returned analysis GeoJSON now includes tract features with Planning OS-friendly properties:
  - `pctMinority`
  - `pctBelowPoverty`
  - `medianIncome`
  - `population`
  - `zeroVehiclePct`
  - `transitCommutePct`
  - `isDisadvantaged`
- Corridor and centroid features are now tagged with explicit `kind` values so map layers can style them separately from tract polygons

### Frontend / Mapbox shell
Updated `src/app/(app)/explore/page.tsx` to:
- add tract fill + tract outline layers
- separate corridor layers from tract layers
- add tract visibility toggle
- add tract theme selector with four modes:
  - minority share
  - poverty share
  - median income
  - disadvantaged flag

## Validation
- `npm run lint` ✅
- `npm run build` ✅

## Recommended next step
1. Add legend panel for active tract theme
2. Add hover tooltip / inspector for tract attributes
3. Add SWITRS point layer + severity filters
4. Add project-linked overlays and engagement geography
