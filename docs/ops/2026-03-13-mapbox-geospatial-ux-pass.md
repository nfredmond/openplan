# OpenPlan Mapbox Geospatial UX Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — first Mapbox-facing UX correction pass

## Summary
Replaced the old demo-style map posture in Analysis Studio with a real Mapbox-based geospatial foundation and a more operator-grade planning map shell.

## What changed
### Stack correction
- Added `mapbox-gl`
- Removed `maplibre-gl`
- Added global Mapbox CSS import
- Added `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` to `.env.example`

### Explore / Analysis Studio UX
Updated `src/app/(app)/explore/page.tsx` to:
- initialize Mapbox instead of MapLibre demo tiles
- use a dark planning-oriented basemap
- add Navigation / Fullscreen / Scale controls
- preview uploaded corridor geometry before analysis runs
- style polygon, outline, and point layers more intentionally
- add top-of-map product chrome and contextual operator overlays
- add quick controls for polygon fill, point visibility, and camera mode
- improve framing language from generic corridor-tool posture toward geospatial planning platform posture

### Documentation artifact
Started an Excalidraw MCP checkpoint for the geospatial UX reset:
- `checkpoint_id=0132e6b148044218af`

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`25` files / `133` tests) prior to dependency cleanup
- `npm run build` ✅ after Mapbox migration and MapLibre removal

## Notes
- The code now expects a public Mapbox token via `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` (or `NEXT_PUBLIC_MAPBOX_TOKEN` fallback in code).
- I did not inject or rewrite any secret token value into repo files.
- The local `.env.local` should be updated with the actual public Mapbox token before final runtime verification.

## Recommended next geospatial steps
1. Add project-linked overlays (deliverables / issues / engagement geography)
2. Add Census choropleth layers and source citation panel
3. Add SWITRS collision layer + severity filtering
4. Add Mapbox Draw / editable geometry workflow
5. Add public engagement pin/comment layer under Engagement module
