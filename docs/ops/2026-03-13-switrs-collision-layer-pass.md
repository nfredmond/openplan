# OpenPlan SWITRS Collision Layer Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — SWITRS point layer + severity filter pass

## Summary
Extended Analysis Studio with a real point-level crash lane using local SWITRS geometry when available.

This pass keeps the map honest:
- if the run uses local SWITRS-backed California crash data, Analysis Studio can now surface actual crash points
- if the run falls back to FARS or estimated crash metrics, no point layer is fabricated

## What changed
### Crash data source layer
Updated `src/lib/data-sources/crashes.ts` to support:
- reusable SWITRS CSV loading for a bbox
- SWITRS severity bucket classification:
  - `fatal`
  - `severe_injury`
  - `injury`
- real crash point GeoJSON features from SWITRS local data

### Analysis API
Updated `src/app/api/analysis/route.ts` to:
- attach SWITRS crash point features to the analysis result GeoJSON when crash source is `switrs-local`
- expose `crashPointCount` in metrics

### Analysis Studio map UI
Updated `src/app/(app)/explore/page.tsx` to add:
- dedicated SWITRS crash point layers
- show/hide control for the collision lane
- severity filtering
- crash hover inspector
- posture messaging when point-level crash geometry is unavailable

## UX posture
The new lane intentionally differentiates between:
- **crash metrics available**
- **drawable crash geometry available**

This is important because OpenPlan may have usable crash summary metrics from FARS/estimates without having real point geometry to draw.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`27` files / `140` tests)
- `npm run build` ✅

## Recommended next step
1. Bind crash point filtering into saved run comparisons / report artifacts
2. Add vulnerable-road-user focused map filters (ped/bike toggles)
3. Add Data Hub geometry attachment so project datasets can move from coverage footprints to real thematic overlays
