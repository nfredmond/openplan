# OpenPlan Tract Legend + Inspector Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — choropleth legibility pass

## Summary
Added the next practical layer on top of the new census tract choropleth work in Analysis Studio:
- active tract-theme legend
- hover inspector for tract attributes

This closes the immediate usability gap after the first choropleth pass. Operators can now understand what the map colors mean and inspect tract-level values without leaving the map surface.

## What changed
### Analysis Studio UI
Updated `src/app/(app)/explore/page.tsx` to add:
- active legend panel for the selected tract theme
- color-range keys for:
  - minority share
  - poverty share
  - median income
  - disadvantaged flag
- hover inspector for visible tract polygons

### Tract inspection details
Hovered tracts now surface:
- tract name
- GEOID
- population
- median income
- minority share
- poverty share
- zero-vehicle household share
- transit commute share
- disadvantaged flag posture via current theme badge

## Why this matters
The first choropleth pass made tract geometry visible, but not yet fully legible.
This pass makes the map more operator-grade by answering two immediate questions:
1. What do these colors mean?
2. What tract am I actually looking at?

That improves planning review, QA, and client-demo clarity without pretending the deeper map stack is finished.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`26` files / `136` tests)
- `npm run build` ✅

## Recommended next step
1. Add SWITRS collision point layer + severity filters
2. Add project-linked overlays from the new Projects/Data Hub modules
3. Add richer map-side provenance / source toggles for each visible layer
