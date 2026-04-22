# Phase 3 Slice J — Cartographic map legend (proof)

**Shipped:** 2026-04-22
**Scope:** Client-only. No migration, no API route, no seed change.

## What shipped

The four live data-driven layers on the backdrop (projects, aerial AOIs, corridors, RTP cycles) now have a visible color key in the top-right control stack. A user looking at the map can decode every symbol without reading the component source.

Mounted as a sibling fixed panel under `CartographicLayersPanel` (top-right, below the panel at `top: 420px`). Hides under the same route/responsive rules the layers panel already respects (`body[data-map-owner="true"]` on `/explore`, `@media (max-width: 1100px)`). On wide-surface routes (`body[data-surface-wide="true"]`), the legend inherits the same compacted 200px-wide 0.88-opacity treatment the layers panel gets.

## Design choices

- **Standalone panel, not embedded in layers panel.** The layers panel is a control surface (toggle layers on/off). The legend is informational (decode colors). Keeping them separate means each has one job, and each has its own collapse state if we ever add that to the layers panel. Positioning them as stacked fixed siblings is the minimum change to the shell.
- **Only data-driven layers appear.** The five placeholder layers (engagement, transit, crashes, equity) have no visual signature on the backdrop yet — their entries would be misleading. They'll join the legend naturally when their data sources land.
- **Entries are toggle-reactive.** When a user hides a layer via the layers panel (e.g., toggles `projects` off), its legend entry disappears. This keeps the key honest: the legend only describes what's currently painted.
- **Corridor LOS ramp is a 4-stop gradient.** Six grades collapse to four visible buckets on the backdrop (A=B `#4a7a9e`, C=D `#c8962f`, E `#b45239`, F `#8a2e24`). The legend shows the same four buckets with A/B, C/D, E, F labels underneath — no attempt to show 6 stops since the paint expression only has 4.
- **Colors are hand-coded, not imported from the backdrop.** `cartographic-map-backdrop.tsx` defines the hex values inline in paint expressions, not as exported constants. I chose not to extract a shared color module for this slice because (a) the values haven't changed since Slice I, (b) extracting would mean editing backdrop paint for a pure-visual-refactor and risking a Mapbox expression regression, and (c) a future slice that adds data-driven layer #5 (equity choropleth) will be a better time to centralize the palette. Trade-off: a backdrop color change now requires a matching edit in two files. Acceptable for the volume (~5 hex values).
- **Collapse is local state, not persisted.** Cartesian clicks → `useState(collapsed)`. Not wired into URL or localStorage. Most users will leave it open. Adding persistence is a future polish slice if usage patterns warrant it.
- **When every data-driven layer is off, the whole legend returns `null`.** An empty `Legend` header with no rows would be visually confusing. Clean disappearance is clearer.

## Known minor issues

- **Hardcoded `top: 420px`.** The legend's fixed top is picked to clear the layers panel at its default height (8 items × ~36px + padding ≈ 380px). If someone adds a 9th layer key to `LAYER_KEYS`, the panels will overlap by ~30px. Low-likelihood regression; a future slice can wrap both in a flex column container to eliminate the magic number.
- **Responsive break hides both panels below 1100px.** Matches the layers panel's existing behavior. Acceptable because the whole backdrop interaction model (hover, click, precise selection) degrades on narrow viewports; the legend follows the same floor.

## Files shipped

**New files:**

- `openplan/src/components/cartographic/cartographic-map-legend.tsx` — 97 LOC. The component. Uses `useCartographicLayers`, static `LEGEND_ENTRIES` keyed by the four data-driven layer kinds, renders swatches for singletons and a 4-stop gradient for corridor LOS. Returns `null` if no data-driven layer is visible.
- `openplan/src/test/cartographic-map-legend.test.tsx` — 5 tests: renders all four entries with defaults, renders the LOS ramp with four stops + labels, hides entries on per-layer toggle, returns null when all four are off, collapses/restores on header click.

**Modified files:**

- `openplan/src/components/cartographic/cartographic-shell.tsx` — mounts `<CartographicMapLegend />` right after `<CartographicLayersPanel />`.
- `openplan/src/app/cartographic.css` — new `.op-cart-legend*` block (97 lines added) between the layers-panel and inspector-dock sections; legend added to the `body[data-map-owner="true"]`, `body[data-surface-wide="true"]`, and `@media (max-width: 1100px)` rules so it honors the same visibility contract as the layers panel.

## Tests

- Before: 973/199
- After: 978/200 (**+5 tests, +1 test file**)

Gate output (abbreviated):
```
Test Files  200 passed (200)
     Tests  978 passed (978)
No known vulnerabilities found
✓ Compiled successfully in 9.9s
```

## Pointers

- Backdrop paint where the colors live: `openplan/src/components/cartographic/cartographic-map-backdrop.tsx:44-52, 323, 340, 385, 504` plus the LOS ramp `match` expression in the corridor line-color paint.
- Prior slices that established the pattern: Slice I (`2026-04-22-phase-3-slice-i-rtp-pin-layer-proof.md`) for the 4-layer buildout; Slice F (`2026-04-22-phase-3-slice-f-layers-panel-live-counts-proof.md`) for the layers panel's counts pattern which the legend mirrors structurally.

## Next

Recommendation: **Slice K = equity / census tract choropleth layer.** This is the natural continuation of the data-driven pattern:

- Fifth data-driven layer, closes one of the four remaining placeholder chips (`equity`).
- New geometry kind: **MULTIPOLYGON** (census tracts are multipolygons). Would extend `fitInstructionFromGeometry` to handle MultiPolygon, closing the Slice G deferred case at the same time.
- Data-driven paint: choropleth fill keyed to `pct_zero_vehicle` or `pct_poverty` from `census_tracts_computed`. First appearance of a `match`/`interpolate` expression driven by row attributes, not a static color.
- Public data (workspace_id IS NULL). No auth friction, same shape as the GTFS public-data pattern.
- Once live, the legend slice gets its first attribute-keyed entry (a vertical color ramp + value breakpoints) which will flush out any design gaps in the ramp component.

Alternative (deferred, weaker): transit layer (GTFS stops + shapes). Two geometry kinds in one slice sounds nice but the stop volume in even one mid-size agency can exceed the 500 limit, forcing a pagination/tiling decision that doesn't belong in a single slice. Park it behind the equity slice.

Hold Slice K scope until the user green-lights.
