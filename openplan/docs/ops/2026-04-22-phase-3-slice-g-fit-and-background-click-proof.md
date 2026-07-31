# Phase 3 Slice G — pan/fit-to-selection + background-click-to-clear

> **DATED RECORD — 2026-04-22.** This describes what was true on the day it was written.
> It is kept because it records *why* decisions were made, which nothing else captures.
> **Do not treat any factual claim here as current** — verify against the code, the
> database, or `CHANGELOG.md` before acting on it. A stale doc that reads as current
> costs more than a missing one: on 2026-07-30 a roadmap in this folder listed two
> "remaining" items that had both already shipped, and nearly cost a full rebuild of a
> feature that already exists.


**Date:** 2026-04-22
**Parent:** Phase 3 cartographic shell (Slices A–F shipped 2026-04-21 → 2026-04-22)
**Status:** shipped locally, tests 939/195 → 945/196 (+6 tests / +1 file), `pnpm qa:gate` clean.

## Goal

Close the two UX polish items flagged as "Next: Suggested Slice G" in the Slice F proof: on click, the map pans/zooms to the selected feature's geometry; on background click (map area with no feature under the cursor), the current selection clears.

Bundled because both live on the backdrop click surface, and together they're ~100 LOC + one pure-helper file that's independently useful for any future "focus this feature on the map" entry point.

## What shipped

### 1. Pure geometry-to-viewport helper

`src/lib/cartographic/geometry-bbox.ts` (78 LOC). Single export `fitInstructionFromGeometry(geometry)` that maps a GeoJSON geometry into one of two viewport instructions:

- **Point** → `{ kind: "center", center: [lng, lat] }` — no bbox math, just a center.
- **LineString** → `{ kind: "bbox", bbox }` — envelope of all positions.
- **Polygon** → `{ kind: "bbox", bbox }` — envelope of the **outer ring only** (index 0); interior holes are not part of the feature's spatial extent for fit purposes.
- Everything else (MultiPolygon, GeometryCollection, malformed, missing `coordinates`, NaN/Infinity lng or lat) → `null`.

The helper is router-free and Mapbox-free, so it's trivially unit-testable. Defensive posture: a single malformed position inside a LineString or Polygon outer ring is skipped rather than throwing, so a partial-garbage feature still yields a valid bbox over the good positions. If no positions are valid, returns `null`.

No MultiPolygon / MultiLineString support. The writer-side validators (`isAoiPolygonGeoJson`, `isCorridorLineGeoJson`) already reject those upstream, so adding paint code for geometry shapes that never reach the backdrop would be dead code.

### 2. Fit-to-selection on click

`src/components/cartographic/cartographic-map-backdrop.tsx` (636 → 706 LOC). Each of the three layer-scoped click handlers (`onClick` on AOI fill, `onProjectClick` on circles, `onCorridorClick` on lines) now calls a shared local `fitToFeatureGeometry(feature.geometry)` immediately after `setSelection(nextSelection)`. The helper:

- `kind: "center"` (Point) → `map.easeTo({ center, zoom: POINT_FIT_ZOOM=14, duration: 400 })` — lands at neighborhood scale so a single marker has spatial context (a city-wide Point marker would feel placeless if we just centered without zooming in).
- `kind: "bbox"` (LineString / Polygon) → `map.fitBounds(bbox, { padding: 64, maxZoom: 15, duration: 400 })` — padding leaves room for UI chrome on the sides; `maxZoom` keeps a tiny feature (a short corridor, a small polygon) from punching past neighborhood scale.

**Jitter avoidance (the Slice F-flagged concern):** fit is attached to the click handler, **not** to the `selection` state. List-row hover / focus fires `setSelection` without going through the map click — that path never triggers a map movement. Map clicks are the only thing that can cause a pan/zoom. So hovering a 20-row list doesn't produce 20 map animations.

**Geometry source:** the click handler reads `feature.geometry` off the Mapbox click event directly, not via `queryRenderedFeatures` or a source lookup. No extra round-trip, no coupling to source ids.

### 3. Background-click-to-clear

The same `useEffect` registers a **map-level** click handler (no layer scoping) that runs on every click, fires after any layer-scoped handler:

```ts
const FEATURE_LAYERS = [
  AOI_FILL_LAYER_ID,
  PROJECTS_CIRCLE_LAYER_ID,
  CORRIDORS_LINE_LAYER_ID,
];

const onBackgroundClick = (e: mapboxgl.MapMouseEvent) => {
  const renderedLayers = FEATURE_LAYERS.filter((layerId) => map.getLayer(layerId));
  if (renderedLayers.length === 0) {
    clearSelection();
    return;
  }
  const hits = map.queryRenderedFeatures(e.point, { layers: renderedLayers });
  if (hits.length === 0) clearSelection();
};
```

`queryRenderedFeatures` is filtered to the three feature layers only — style baselayers, labels, and the Mapbox glyph layer are all ignored. If the click hit zero feature layers, it's background: `clearSelection()`. If it hit one or more, a layer-scoped handler already set a new selection, so we leave it alone.

**Layer-filter guard:** we pre-filter `FEATURE_LAYERS` through `map.getLayer()` before passing to `queryRenderedFeatures`. If a data fetch hasn't landed yet (e.g., no projects in the workspace so the projects source is never mounted), passing an unknown layer id would throw. On an empty-layer page, any click is background → clear.

**Order-of-operations:** Mapbox dispatches layer-scoped click handlers before the map-level click handler. So when a user clicks a feature:
1. Layer-scoped `onClick` / `onProjectClick` / `onCorridorClick` fires → `setSelection` + `fitToFeatureGeometry` run.
2. Map-level `onBackgroundClick` fires → `queryRenderedFeatures` finds the feature → no-op.

When a user clicks background:
1. No layer-scoped handler fires.
2. Map-level `onBackgroundClick` runs → `queryRenderedFeatures` finds no hits → `clearSelection`.

### 4. Tests

6 new tests in `src/test/geometry-bbox.test.ts` (110 LOC):

- Point returns `{ kind: "center", center }`.
- LineString returns `{ kind: "bbox", bbox }` over all positions.
- Polygon returns `{ kind: "bbox", bbox }` over outer ring only (interior hole ignored).
- Unsupported geometry types (MultiPolygon, GeometryCollection) return `null`.
- Malformed / missing inputs (`null`, `undefined`, `{}`, missing `coordinates`, non-array coordinates, NaN/Infinity coords, nested-garbage Polygon) return `null`.
- Malformed positions inside a LineString are skipped without throwing (string mixed into coordinate array still yields a valid bbox over the good positions).

**Deliberately no Mapbox+JSDOM integration test for the click-handler shim.** Mapbox's `fitBounds` / `easeTo` / `queryRenderedFeatures` aren't available in JSDOM, and the handler itself is a three-line dispatcher over the pure helper plus Mapbox method calls. The helper is fully covered; the integration surface is validated during browser smoke (see "Smoke plan" below).

## Why this slice

Both items were flagged as the recommended next slice in the Slice F proof:

> 1. **Pan / fit-to-selection** — on click, `map.fitBounds()` the feature's bbox (jitter problem when list-row hover fires `setSelection` on every row is solvable with a single `ignoreHover` flag on the list-row path).
> 2. **Background-click-to-clear** — click on map background (not on a feature) clears the current selection. Low-stakes polish, bundles naturally with #1.

The "ignoreHover flag" turned out to be unnecessary — fit is attached to the click handler rather than the selection state, so hover flows never trigger map movement by construction. No flag needed.

Bundled because:
- Both live on the backdrop click surface.
- Combined diff is ~70 lines in the same `useEffect`; splitting into two separate slices would create two similar-shaped commits with overlapping deps arrays.
- The bbox helper is used by both paths (fit reads geometry, background-click is the natural opposite UX to fit — one lands the user on a feature, the other returns them to the overview).

Corridor authoring UI and the RTP pin layer are deferred per the user's instruction; both are materially larger slices that deserve their own plans.

## Known minor issues / scope boundaries

- **No "double-click to fit without selecting".** A user who's already on an inspector panel and clicks a different feature on the map will pan/zoom and swap the inspector in one gesture. There's no way to pan to a feature without also selecting it, because the only user-initiated path that triggers fit is the selection-changing click. If that turns out to be annoying, a keyboard modifier (e.g., shift-click = fit without select) is a one-line follow-up.
- **Background-click-to-clear always clears.** It doesn't check whether there *was* a selection to clear. `clearSelection()` is idempotent for the null case, so this is cosmetic — but a stricter version could check `if (selection)` before clearing to avoid a useless state update on every empty-map click. Kept simple.
- **No keyboard path.** Map clicks are mouse/pointer only. The keyboard path for selecting a feature is still list-row hover/focus (from Phase 2's selection-link sweep). Background-click-to-clear doesn't have a keyboard equivalent; Escape-to-clear would be a natural add but needs scope discussion about focus management with the inspector dock.
- **`maxZoom: 15` is a guess.** Picked because Mapbox's `light-v11` / `dark-v11` styles have good street-level detail around zoom 15 and tile data density drops off after that. If a very small feature (single-block polygon, 50m corridor) still feels too zoomed out at 15, bumping to 16 is a one-token change.
- **Fit duration is 400ms.** Fast enough to feel responsive, slow enough that users can track the movement. Same argument as `maxZoom` — subjective, one-token adjustable.

## Smoke plan (user-owned)

The existing Slice D + Slice E prod smoke test (flagged as user-owned in both proof docs) now implicitly includes Slice G verification:

- Click the NCTC demo project circle → inspector opens AND map pans to Grass Valley at zoom ~14.
- Click an AOI polygon → inspector swaps AND map fits the polygon with padding.
- Click the SR-49 corridor line → inspector swaps AND map fits the corridor bbox.
- Click the map background (open water / empty basemap area, not on any feature) → inspector dock clears.
- Click a feature, then click a different feature → inspector swaps, map re-fits to the new feature, no stuck state.

## Gates

- Lint: clean
- `pnpm audit --prod --audit-level=moderate`: 0 advisories
- `pnpm test`: 196 files / 945 tests passing (was 195 / 939)
- `pnpm build`: 64 routes (no new routes; Slice G is pure client-side), compile success

## Files shipped

### Added
- `src/lib/cartographic/geometry-bbox.ts` (78 LOC — pure geometry → viewport instruction helper)
- `src/test/geometry-bbox.test.ts` (110 LOC, 6 tests)

### Modified
- `src/components/cartographic/cartographic-map-backdrop.tsx` (636 → 706 LOC — fit-on-click wired into the three existing layer handlers; new map-level background-click handler using `queryRenderedFeatures` + layer-id guard)

## Pointers

- Phase 3 Slice F proof (prior): `docs/ops/2026-04-22-phase-3-slice-f-layers-panel-live-counts-proof.md`
- Phase 3 Slice D proof (where project-click navigation was first wired): `docs/ops/2026-04-21-phase-3-slice-d-project-markers-proof.md`
- Mapbox `fitBounds` / `easeTo` / `queryRenderedFeatures` — the three Mapbox GL JS v3.20 methods used here

## Next

Candidates, prioritized:

1. **Corridor authoring UI** — first editable surface for the cartographic system. Inspector-dock "Edit corridor" → draw mode on the backdrop → persist via `POST /api/map-features/corridors`. Bigger slice; would want its own plan document. Natural next step now that all three read layers + the click-selection loop are done.
2. **RTP cycle "pin on map" layer** — wire the `rtp` chip to a data source. Requires an editor call on how to geolocate an RTP cycle: anchor to the primary project's coords, or a new nullable `rtp_cycles.anchor_lat/lng` column. Mild schema slice.
3. **Keyboard escape-to-clear** — press Escape to clear the current selection. Low-stakes a11y polish; naturally pairs with background-click-to-clear.
4. **Revalidate counts on create.** Phase 3 Slice F's only known gap — the layers-panel chips don't live-update when a new mission/corridor is created elsewhere in the app. Once authoring lands (#1), a `revalidate` event would close this.

Recommendation: hold before picking #1 vs #2 — corridor authoring is a substantially bigger slice that deserves scope discussion before starting. If more click-surface polish feels right first, #3 is a natural ~30-LOC follow-up.

No user-owned follow-ups — Slice G ships pure client-side additions, no migration, no seed change, no new routes.
