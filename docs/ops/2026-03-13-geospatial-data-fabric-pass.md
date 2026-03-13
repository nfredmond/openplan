# OpenPlan Geospatial Data Fabric Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — Analysis Studio geospatial briefing + source posture pass

## Summary
Extended Analysis Studio beyond visual map polish by exposing more of the actual geospatial/data stack to the operator interface.

This pass does **not** fake future map layers. Instead, it makes the current product more honest and useful by surfacing:
- planning signals
- source metadata
- crash/transit/census posture
- the next geospatial build lanes

## What changed
### API metadata enrichment
Updated `src/app/api/analysis/route.ts` source snapshot metadata to include richer notes and retrieval context for:
- Census / ACS
- LODES
- Transit access
- Crash data
- Equity screening

### Analysis Studio UI
Updated `src/app/(app)/explore/page.tsx` to add:
- Geospatial Intelligence Briefing card
- planning signal tiles
- data fabric status panel
- citations / next geospatial lanes panel
- clearer visibility into whether crash data is SWITRS-local, FARS-backed, or fallback

## Why this matters
OpenPlan should not pretend to have finished Census choropleths or SWITRS point layers before those are actually implemented.
This pass improves the product by:
- making current evidence sources legible
- improving client-safe transparency
- setting the stage for tract geometry, SWITRS layers, and CARTO-backed derived products

## Validation
- `npm run lint` ✅
- `npm run build` ✅

## Recommended next step
1. Add tract geometry retrieval + Census choropleth overlays
2. Add SWITRS collision point layer + filters
3. Add project-linked overlays in map context
4. Establish CARTO workflow lane for derived spatial products and scheduled refreshes
