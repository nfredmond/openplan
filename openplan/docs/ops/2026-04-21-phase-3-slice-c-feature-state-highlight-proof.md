# Phase 3 Slice C — Feature-state highlight on selection (2026-04-21)

## What shipped

Slice B made AOI polygons clickable, but the clicked polygon didn't visually lift — the selection lived in the inspector dock only, and the map gave no feedback about which feature was currently selected. Slice C closes that cosmetic gap with Mapbox feature-state driving paint expressions on the AOI fill + outline layers.

### Inspector selection contract — optional `featureRef`

`src/components/cartographic/cartographic-inspector-dock.tsx` — `CartographicInspectorSelection` gains an optional round-trip reference:

```ts
featureRef?: { sourceId: string; featureId: string | number };
```

Every existing consumer keeps working (field is optional). Consumers that know about the Mapbox source — right now just the backdrop click path — populate it so the backdrop can highlight.

### Helper — `sourceId` injection

`src/lib/cartographic/mission-feature-to-selection.ts` — `NavigateOptions` gains an optional `sourceId?: string`. When present, the returned selection includes:

```ts
featureRef: { sourceId, featureId: properties.missionId }
```

The helper stays layer-agnostic — it never references a specific source id, it just echoes whatever caller supplies. That keeps the helper unit-testable without coupling to backdrop internals.

### Backdrop paint — feature-state expressions

`src/components/cartographic/cartographic-map-backdrop.tsx` — both AOI layers now read `feature-state.selected`:

```ts
// Fill layer
"fill-opacity": [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  0.36,   // ~2x the base when selected
  0.18,
]

// Outline layer
"line-width": [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  2.75,   // thicker stroke when selected
  1.75,
]
```

The base palette (`#e45635` fill + outline) stays the same — no color shift, only weight and opacity change. This keeps the civic-parchment posture while still making the selected feature unmistakably lifted.

### Backdrop highlight effect

A new `useEffect` watches `[selection, ready, aois]` and mirrors the context selection to Mapbox feature-state. Key design points:

1. **Clear before write** — `map.removeFeatureState({ source: AOI_SOURCE_ID })` wipes all feature-state for the source, then `setFeatureState` flips only the current selection. This avoids tracking previous ids across renders (volume is small — ≤500 features per workspace by the Slice A cap).
2. **Source-guard** — skipped entirely if `map.getSource(AOI_SOURCE_ID)` is absent (e.g. before paint has run, or mid-style-swap).
3. **Style-load timing** — wrapped in `map.isStyleLoaded()` / `map.once("style.load", apply)`, same pattern as the paint effect, because `setStyle()` wipes feature-state along with sources/layers.
4. **sourceId match** — only applies when `selection.featureRef.sourceId === AOI_SOURCE_ID`. Other selection kinds (project / run / report) pass through without touching AOI state.
5. **Silent try/catch** — `setFeatureState` throws if the feature id isn't yet loaded on the source (rare, race condition during initial fetch). Swallowed; next render re-applies.

### Tests

`src/test/mission-feature-to-selection.test.ts` — **+2 cases**, 13 total:

| Case | Assertion |
|---|---|
| no `sourceId` supplied | `selection.featureRef` is `undefined` |
| `sourceId` supplied | `featureRef.sourceId` matches, `featureRef.featureId === missionId` |

No Mapbox integration test — the feature-state effect is thin and Mapbox's own state machinery is covered upstream. The paint-expression literal is tested implicitly via `pnpm build` (Mapbox validates paint expression shape at layer add time; a broken expression would fail the build path when the backdrop hydrates).

## Why this slice

Slice B delivered click-to-select but the map treated every polygon identically post-click. Without feedback, the user's only confirmation was the inspector dock lighting up — so on small viewports (or when the worksurface covered the inspector) a click could feel like a no-op. Slice C makes selection state legible directly on the map, and it sets the pattern for every future layer: publish a `featureRef` from the selection helper, and the backdrop paints the lift for free.

## Known minor issues (non-blocking)

- **One-feature-at-a-time.** Inspector dock is single-selection by contract. Multi-select would need inspector redesign plus a filter expression on feature-state.
- **No map pan/fit-to-selection.** Clicking a polygon at the viewport edge doesn't recenter. Could add a `map.fitBounds(bbox, { padding })` call — deferred because jitter on hover-row selection (lists firing setSelection on every row) would be disorienting.
- **Cross-source selections** are no-ops. A selection whose `featureRef.sourceId` isn't `AOI_SOURCE_ID` passes through silently — correct for now, but when project markers ship, the backdrop will need a dispatch table keyed on sourceId.

## Not this slice

- **Project markers.** Needs a `lat/lng` column on `projects` or geocode-on-read. Slice D candidate.
- **Corridor / engagement / crash / equity layers.** None render live data yet. Same helper/highlight pattern will apply when they do.
- **Selection persistence across navigations.** Route change unmounts the inspector's source of truth — still in-memory only.
- **Keyboard cycling through visible features.** A11y gap carried forward from Slice B.

## Gates

```bash
pnpm test --run src/test/mission-feature-to-selection.test.ts
# → 13/13 pass

pnpm qa:gate
# → lint clean · 881 tests / 187 files pass (up from 879/187 post-Slice B) · 0 advisories · Next build succeeds
```

## Files

### Modified
- `src/components/cartographic/cartographic-inspector-dock.tsx` (+3 LOC — `featureRef` on type)
- `src/lib/cartographic/mission-feature-to-selection.ts` (+8 LOC — `sourceId` option + field)
- `src/components/cartographic/cartographic-map-backdrop.tsx` (+40 LOC — paint case-expressions + highlight effect)
- `src/test/mission-feature-to-selection.test.ts` (+16 LOC — 2 new cases)

### New
- `docs/ops/2026-04-21-phase-3-slice-c-feature-state-highlight-proof.md` (this file)

## Next

Slice D candidates, prioritized:

1. **Project markers** — unlocks a second clickable layer; needs schema work (lat/lng on `projects` or geocode-on-read).
2. **Fit-to-selection on click** — UX polish; decide the pan-vs-fitBounds question.
3. **Corridor layer rendering** — bigger payload surface; wait until selection semantics are locked on two layers first.
4. **Background-click-to-clear** — still a low-stakes UX polish.

Recommendation: **Slice D = project markers**, since it proves the helper + feature-ref pattern scales to a second layer and makes the backdrop meaningfully more useful than showing only mission polygons.

## Pointers

- Phase 3 Slice B proof (click-to-select): `docs/ops/2026-04-21-phase-3-slice-b-click-to-select-proof.md`
- Phase 3 Slice A proof (live AOIs): `docs/ops/2026-04-21-phase-3-slice-a-live-aoi-proof.md`
- Mapbox feature-state: https://docs.mapbox.com/mapbox-gl-js/api/map/#map#setfeaturestate
