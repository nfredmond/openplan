# OpenPlan Analysis Studio Coverage Overlay Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — honest overlay-lane control pass

## Summary
Extended Analysis Studio from project-context visibility into **selectable coverage overlays** for linked datasets where real geometry is already available.

Important constraint:
This pass does **not** invent dataset geometry or dataset-specific thematic values.
It only draws an honest **coverage footprint** when OpenPlan already has sufficient geometry to do so.

## What changed
### Analysis Studio overlay-lane controls
Updated `src/app/(app)/explore/page.tsx` to add a richer overlay-lane control surface for:
- corridor footprint
- corridor centroid
- census tract layer
- project-linked coverage overlay lane

### Linked dataset coverage rendering
Linked datasets from the Project Context panel can now be toggled into the map when they are both:
- overlay-ready, and
- drawable with real geometry already available in the current analysis session

Current drawable cases:
- `tract` datasets → draw tract coverage using current tract polygons
- `corridor` / `route` datasets → draw corridor coverage using current corridor geometry

Current non-drawable cases remain explicit and honest:
- registry-only datasets
- overlay-ready datasets without geometry attachment support yet
- larger-area scopes without a current geometry artifact in session

### Map rendering
Added a dedicated `dataset-overlay` GeoJSON source and overlay layers to the Mapbox shell:
- `dataset-overlay-fill`
- `dataset-overlay-line`

These layers render a distinct orange coverage footprint so operators can visually distinguish:
- analytical result layers
- tract choropleths
- project-linked dataset coverage overlays

## Why this matters
This is the first step from:
- "the project has linked datasets"

to:
- "the map can visibly reflect project-linked data posture"

It keeps the product honest by drawing only what can actually be supported today.
That is materially better than pretending the full overlay pipeline exists before geometry and thematic binding are ready.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`27` files / `139` tests)
- `npm run build` ✅

## Recommended next step
1. Add true geometry attachment / artifact binding for Data Hub datasets
2. Add SWITRS collision points + severity filters
3. Bind saved runs back to project context for stronger traceability
