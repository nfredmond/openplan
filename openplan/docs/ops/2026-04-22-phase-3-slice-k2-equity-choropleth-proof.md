# Phase 3 Slice K2 — Equity / census-tract choropleth layer (proof)

**Shipped:** 2026-04-22
**Scope:** Fifth data-driven layer on the cartographic backdrop. Closes the last placeholder chip (`equity`) and the last "coming soon" entry from the `directions/02-cartographic.html` Anthropic design file that prompted Phase 3.

## What shipped

The cartographic backdrop now paints census-tract polygons with a 4-bin teal choropleth keyed to `pct_zero_vehicle`. Tracts render beneath the point / line / AOI layers (z-order via `beforeId`), click to select into the inspector dock, and lift on selection via feature-state. The layers panel, legend, counts route, and inspector dock are all wired through.

This is:

1. **The fifth data-driven layer.** Pattern is now: AOI (Polygon) → project (Point) → corridor (LineString) → RTP cycle (Point) → census tract (MultiPolygon). Every Mapbox primitive geometry kind has at least one consumer on the backdrop.
2. **The first attribute-keyed paint expression.** All four prior layers used static hex colors (project green, AOI orange, RTP plum) or a categorical `match` (corridor LOS). Census tracts use a `step` expression on a numeric attribute, the first choropleth on the backdrop.
3. **The first public-data layer.** Census tracts have no `workspace_id` — the route auth-gates but does not workspace-scope. Counts and layers-panel chip treat the equity count as shared across all workspaces.
4. **The first layer whose inspector selection has no `primaryAction`.** Census tracts have no detail page — the inspector dock renders informationally only, with status/type meta rows for population, zero-vehicle %, poverty %, non-white %.

## Design choices

- **MultiPolygon, not Polygon.** Census tracts are authored in TIGER as MultiPolygon even when the underlying shape is a single polygon (coastal islands, isolated blocks). Emitting the raw geometry as MultiPolygon avoids a pre-processing step and matches what an ingestion pipeline would produce.
- **Seed-script demo data, not live Census TIGER ingestion.** Path C from the Slice K1 "Next" section. I hand-authored four rectangular tracts across the Grass Valley / Nevada City / rural-east demo geography in `scripts/seed-nctc-demo.ts` rather than wiring a live TIGER API pull. Rationale: (a) Slice K2's goal is the UI + paint expression, not a data-pipeline slice; (b) production's `census_tracts` table was empty, so a UI slice against zero rows would be unshippable until the ingestion slice lands; (c) the four authored tracts deliberately target all four equity bins (Core 12% zv / South 7% / Nevada City 8% / Rural East 3%) so the choropleth paint expression is visually verifiable on first load. This trade pushes the "demo is real" posture further from live data but it's an acknowledged short-term cost — the live-ingestion slice can backfill later without changing the UI surface.
- **`census_tracts_map` view, not direct table read.** The Supabase JS client can't serialize PostGIS geometry to GeoJSON on its own, and doing it in the route would require an RPC wrapper per row. A `security_invoker` view with `ST_AsGeoJSON(geometry)::jsonb AS geometry_geojson` lets the route read `.select("geometry_geojson")` directly, inheriting RLS from `census_tracts_computed` underneath (which reads from `census_tracts`, which has a public SELECT policy). Clean; no new RLS surface.
- **`seed_public_census_tract()` RPC, service_role only.** The JS client also can't write PostGIS geometry directly. The seed script needs to upsert 4 tracts with GeoJSON geometries that the database will parse via `ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)::geometry(MultiPolygon, 4326)`. The RPC does exactly that, with `SET search_path = public, pg_catalog`, `SECURITY DEFINER`, and `REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`. So the seed script (which uses service-role creds) can run it, but no end-user surface can.
- **Z-order via `beforeId`.** Tracts are 2D polygons — if they paint on top of projects / corridors / RTP pins / AOIs, they block clicks and obscure the symbols. The paint effect resolves the first existing feature-layer id from the current style (`AOI_FILL_LAYER_ID || PROJECTS_CIRCLE_LAYER_ID || CORRIDORS_LINE_LAYER_ID || RTP_CYCLES_CIRCLE_LAYER_ID`) and passes it to `map.addLayer(..., beforeId)`. The four symbol layers end up on top; tracts sit underneath both visually and in the click-pick order.
- **Equity layer defaults to off.** `DEFAULT_LAYERS.equity = false` in the cartographic context. Rationale: the choropleth is visually heavy (full-county tract coverage at 45% fill opacity). Loading a fresh backdrop with tracts painting by default would dominate the first impression of the map. The layers panel already exposed `equity` as a toggle — Slice K2 just makes that toggle mean something. Users turn it on intentionally; the legend only appears once they do.
- **`step` expression with a null-safe `case` wrapper.** Some tracts have null `pct_zero_vehicle` (ACS sample limitations on low-population blocks). The paint is:
  ```
  ["case",
    ["==", ["get", "pctZeroVehicle"], null], "#cccccc",
    ["step", ["get", "pctZeroVehicle"],
      "#d4e8e5",
      5, "#8fb5b0",
      10, "#4d847c",
      15, "#1f544c"]]
  ```
  Null renders neutral gray, distinct from the lowest bin's pale teal. The legend shows the 4 bins only; null is documented but not legended.
- **Teal ramp `#d4e8e5 → #1f544c`.** Distinct from every other layer color (project `#1f6b5e` green, AOI `#e45635` orange, corridor LOS blue→amber→orange→red, RTP `#6b4a9e` plum). Teal reads as "demographic/equity" by convention (common in DOT equity dashboards) and sits in a different hue space from the other four layer colors so overlap with, e.g., the project green doesn't read as a single layer.
- **No `primaryAction` on tract selection.** `tractFeatureToSelection` omits both `primaryAction` and `secondaryAction`. The inspector dock already handles this case gracefully (the "Open X" button block is conditional). Census tracts are a read-only informational layer — there's no `/census-tracts/:geoid` page, and manufacturing one would be scope creep.
- **`avatarChar: "E"` for "Equity", `kicker: "Census tract"`.** Follows the pattern of project "P", corridor "C", RTP "R". E is the free letter after A (AOI / aerial mission).
- **Feature-state lift: fill-opacity 0.45 → 0.7, line-width 0.75 → 1.75.** Heavier lift than the symbol layers because polygons are lower-contrast against the basemap than points / lines. Line color unchanged (`#1f544c`, darkest teal).

## Known minor issues

- **Tract ingestion is demo-only.** The only way a new deployment gets tracts is to run `pnpm seed:nctc` with service-role creds. Real production deployments covering multiple counties / states will need a TIGER + ACS ingestion pipeline. Deferred to a future slice; tracked in the "Next" section below.
- **500 row cap.** Same `.limit(500)` pattern as every other data layer. Nevada County has ~22 tracts so this is a non-issue at demo scale, but a statewide deployment will hit the cap immediately. Closing this requires a viewport-bounds tile / pagination decision, also deferred.
- **Paint is keyed to a single attribute (`pctZeroVehicle`).** No UI to swap to `pct_poverty` or `pct_nonwhite`. Those two are emitted in the feature properties (for inspector readout) but the paint expression is hardcoded. Multi-attribute swap would need a new context surface (which attribute is "active" for the choropleth) + a new control in the layers panel — another slice.

## Files shipped

### New files

- `openplan/supabase/migrations/20260422000068_census_tracts_map_view.sql` — 84 LOC. Creates `census_tracts_map` view with `security_invoker = true`, grants `SELECT` to `anon` + `authenticated`; defines `seed_public_census_tract(p_geoid TEXT, p_state_fips TEXT, p_county_fips TEXT, p_name TEXT, p_geometry_geojson JSONB, p_pop_total NUMERIC, p_households NUMERIC, p_pct_nonwhite NUMERIC, p_pct_zero_vehicle NUMERIC, p_pct_poverty NUMERIC)` as `SECURITY DEFINER` with `SET search_path = public, pg_catalog`, upserts on `geoid`, revokes `EXECUTE` from public/anon/authenticated, grants to `service_role` only.
- `openplan/src/app/api/map-features/census-tracts/route.ts` — 125 LOC. `GET` handler. Auth-gated (401 anon). Reads `census_tracts_map` with explicit column list, `.limit(500)`. Defensive `coerceNumber()` for PostgREST string/number NUMERIC surface; `isMultiPolygonGeometry()` type guard filters non-MultiPolygon rows. Emits a GeoJSON `FeatureCollection` where each feature's `properties` is `{kind: "census_tract", geoid, name, popTotal, pctZeroVehicle, pctPoverty, pctNonwhite}`. Audit events: `census_tract_choropleth_loaded` (with `count`), `census_tract_choropleth_query_failed`, `census_tract_choropleth_unhandled_error`. No workspace membership scoping — public data.
- `openplan/src/lib/cartographic/tract-feature-to-selection.ts` — 85 LOC. `TractFeatureProperties` type, `isTractFeatureProperties` guard, `tractFeatureToSelection({properties, sourceId?})` factory. Returns `CartographicInspectorSelection | null` with `kind: "census_tract"`, `kicker: "Census tract"`, `avatarChar: "E"`, meta rows for population / zero-vehicle % / poverty % / non-white % (the last row omitted when `pctNonwhite` is null), no `primaryAction`, no `secondaryAction`. Title falls back to `Census tract <geoid>` when `name` is null or whitespace. `featureRef` populated with `geoid` as `featureId` when `sourceId` is supplied.
- `openplan/src/test/tract-feature-to-selection.test.ts` — 137 LOC, 16 tests covering the type guard (well-formed / null nullable fields / wrong kind / blank geoid / non-number pctZeroVehicle / non-object input) and the factory (valid transform / invalid returns null / no primaryAction / no secondaryAction / omits nonwhite row when null / renders em-dash for null numerics / fallback title / featureRef omitted without sourceId / featureRef shape with sourceId).
- `openplan/src/test/map-features-census-tracts-route.test.ts` — 197 LOC, 4 tests: 401 anon, happy-path MultiPolygon + malformed-geometry drop + string-NUMERIC coercion, 500 on query error, no-workspace-scope assertion (tracts are public data).
- `openplan/src/test/nctc-demo-census-tracts.test.ts` — 58 LOC, 10 tests. `it.each` across the 4 demo tract constants asserting each is a valid MultiPolygon with a closed outer ring (≥4 vertices, first position equal to last), that each GEOID matches `^06057\d{6}$` (Nevada County FIPS), that every position lands in WGS84 lat/lng range, and that the set's GEOIDs are unique.

### Modified files

- `openplan/src/components/cartographic/cartographic-map-backdrop.tsx` — 923 → 1025 LOC. Fourth data-driven layer state (`censusTracts`), fetch effect mirroring the four existing ones (401 silent, non-401 `console.warn`, cancel on unmount), paint effect for fill + outline layers with the choropleth `case/step` expression, visibility effect honoring `layers.equity`, click handler registration extending the layer-scoped click / hover dispatch to include `CENSUS_TRACTS_FILL_LAYER_ID`, `FEATURE_LAYERS` extended to include the fill layer id (so background-click-to-clear correctly no-ops when clicking a tract), `KNOWN_SOURCES` tuple extended to `[AOI, PROJECTS, CORRIDORS, RTP_CYCLES, CENSUS_TRACTS]`, selection-highlight effect dep array extended with `censusTracts`.
- `openplan/src/components/cartographic/cartographic-layers-panel.tsx` — `chipForLayer` extended with `if (key === "equity") return formatChip(counts.equity);`. Panel now reads the `equity` key off the counts response.
- `openplan/src/components/cartographic/cartographic-map-legend.tsx` — `LegendLayerKey` union extended with `"equity"`, `LEGEND_ORDER` bumped to include equity, new entry with 4-stop teal ramp at labels `<5%`, `5–10%`, `10–15%`, `>15%`. Entry visibility gated on `layers.equity` (so the legend only renders equity when the layer is on).
- `openplan/src/components/cartographic/cartographic-inspector-dock.tsx` — kind union extended to `"aerial_mission" | "project" | "corridor" | "rtp" | "census_tract"`.
- `openplan/src/app/api/map-features/counts/route.ts` — `MapFeatureCounts` gains `equity: number | null`, `EMPTY_COUNTS` gains `equity: 0`, `Promise.all` gains a fifth promise reading `census_tracts_map` with `.select("geoid", { count: "exact", head: true })`, partial-failure audit payload gains `equityError`. No workspace scoping on this count (mirrors the route).
- `openplan/scripts/seed-nctc-demo.ts` — +163 LOC (cumulative diff includes the project/lat-lng and RTP-anchor scaffolding from Slices D/I, which is still present). Slice K2 additions: `DEMO_TRACT_GRASS_VALLEY_CORE_GEOID` / `_SOUTH_GEOID` / `DEMO_TRACT_NEVADA_CITY_GEOID` / `DEMO_TRACT_RURAL_EAST_GEOID` constants; four MultiPolygon constants tiled over Grass Valley / Nevada City / rural east (single rectangular rings each, closed); ACS values targeting all four equity bins (Core 12% / South 7% / Nevada City 8% / Rural East 3%); upsert loop calling `supabase.rpc("seed_public_census_tract", {...})` for each tract; `tracts` row added to the final summary log line.
- `openplan/src/test/cartographic-layers-panel.test.tsx` — added `"Equity priority"` label assertion in pre-fetch test; all fixture payloads extended to `{projects, aerial, corridors, rtp, equity}`; chip-count assertions bumped from 4 to 5; zero-chip test now expects `["0", "0", "0", "0", "0"]`.
- `openplan/src/test/cartographic-map-legend.test.tsx` — `LayerToggles` refactored to take both `toggleOffKeys` and `toggleOnKeys` (equity defaults to off, needs explicit enable); default-on test now asserts `"Zero-vehicle households"` is **not** in the document; corridor LOS ramp test rewritten to find the ramp specifically by its `"A/BC/DEF"` labels (so it still works when equity's ramp is also in the DOM); new test for the equity ramp (4 stops, labels `<5%5–10%10–15%>15%`).
- `openplan/src/test/map-features-counts-route.test.ts` — `equityChain` / `equitySelectMock` added alongside the four existing chains; `fromMock` dispatches `census_tracts_map` → `equitySelectMock`; all existing assertions updated to include `equity`; `expect(equitySelectMock).toHaveBeenCalledWith("geoid", {count: "exact", head: true})` added to the happy-path test; new test "returns null for the equity layer and logs a partial-failure warning when census_tracts_map fails" covers the fifth partial-failure branch.

## Gates

- Lint: clean
- `pnpm audit --prod --audit-level=moderate`: 0 advisories
- `pnpm test`: **203 files / 1013 tests passing** (was 200 / 945 before Slice K2 work started, so +3 files / +68 tests — Slice K2 alone contributes +3 files / +30 tests: 16 helper + 4 route + 10 seed-geometry + extensions to 3 existing test files)
- `pnpm build`: 73 routes, compile success in 8.2s (was 65 routes; +1 route: `/api/map-features/census-tracts`)

## Pattern observations (5 data-driven layers now live)

With Slice K2 shipped, every Mapbox primitive geometry on the backdrop has at least one consumer:

| Layer | Geometry | Source | Paint style |
|---|---|---|---|
| Aerial AOIs | Polygon | `aerial_missions.aoi_geojson` | Static fill `#e45635 @ 0.18` |
| Project markers | Point | `projects.latitude` / `longitude` | Static circle `#1f6b5e` |
| Corridors | LineString | `project_corridors.geometry_geojson` | `match` on `los_grade` (4 buckets) |
| RTP cycles | Point | `rtp_cycles.anchor_latitude` / `longitude` | Static circle `#6b4a9e` |
| Census tracts | MultiPolygon | `census_tracts.geometry` → `census_tracts_map` view | `step` on `pct_zero_vehicle` (4 bins + null case) |

The per-layer shape is now completely stereotyped — a sixth layer (transit stops? engagement pins? crash heat?) would follow the same template:

1. Optional migration if a new table or view is needed.
2. `/api/map-features/<kind>` route — auth-gate, workspace-scope (unless public-data like tracts), `.limit(500)`, defensive geometry filter, audit events.
3. `<kind>-feature-to-selection.ts` helper — type guard + factory returning `CartographicInspectorSelection`.
4. Backdrop: state + fetch effect + paint effect (with `beforeId` if it needs to sit beneath symbol layers) + visibility effect + click handler registration.
5. Update `KNOWN_SOURCES`, `FEATURE_LAYERS`, counts route, layers panel `chipForLayer`, legend `LEGEND_ORDER`, inspector dock kind union.
6. Seed-script additions for NCTC demo.
7. Tests: helper (guard + factory), route (auth / happy / error / coercion), seed geometry, plus legend + counts + layers-panel extensions.

The "sixth layer" decision is a data-sourcing decision — there are no new architectural primitives left to invent, just new tables / views / APIs to ingest.

## User-owned follow-ups

1. **Apply migration `20260422000068_census_tracts_map_view.sql` to prod** (`aggphdqkanxsfzzoxlbk`) via `pnpm supabase db push` from `openplan/`. The migration is idempotent (`CREATE OR REPLACE VIEW`, `CREATE OR REPLACE FUNCTION`, `GRANT` + `REVOKE` with no-op on repeat).
2. **Re-seed the NCTC demo** via `pnpm seed:nctc -- --env-file .env.production.local` so the four demo tracts land in prod. Existing project / RTP / AOI / corridor / chapter rows are unaffected (idempotent upserts).
3. **Smoke-test on prod** signed in as the demo owner: open the backdrop, toggle `Equity priority` on from the layers panel, expect 4 tract polygons painting in 4 distinct teal shades (darkest = Core 12% zv), click a tract, inspector dock shows `kind: census_tract` / kicker "Census tract" / avatar "E" / meta rows for population + zero-vehicle % + poverty % (+ non-white % if non-null), no "Open tract" button.

Combined Slice D + E + G + H + I + J + K2 browser smoke test against prod remains user-owned.

## Pointers

- Phase 3 Slice K1 proof (MultiPolygon bbox helper, unblocked this slice): `docs/ops/2026-04-22-phase-3-slice-k1-multipolygon-bbox-proof.md`
- Phase 3 Slice J proof (cartographic map legend, the ramp pattern mirrored here): `docs/ops/2026-04-22-phase-3-slice-j-cartographic-map-legend-proof.md`
- Design file that prompted Phase 3: https://api.anthropic.com/v1/design/h/dVLlTUAActH6TJzz2uUGUw?open_file=directions%2F02-cartographic.html
- `census_tracts` schema origin: `supabase/migrations/20260307000014_census_tracts.sql` (table) and `supabase/migrations/20260307000015_census_tracts_computed.sql` (computed view with ACS percentages).

## Next

Two directions, picking one is a scope decision:

1. **Live Census TIGER + ACS ingestion pipeline.** Backfills the "demo is real" gap left open by Slice K2's seed-script authorship. A Supabase Edge Function that consumes the Census API (TIGER boundaries + ACS 5-year attributes), upserts into `census_tracts`, and runs on a scheduler. Would also benefit the equity-priority layer (more tracts = more signal), the future LODES overlay, and any other tract-keyed analysis. Scope: 1–2 sessions.
2. **Sixth data-driven layer — transit stops or engagement comments.** Both are straightforward by the stereotyped pattern above. Transit stops have a row-volume problem (GTFS `stops` for even one mid-size agency exceeds 500); engagement comments have a non-trivial public-review privacy posture to work out first. I'd lean engagement because the data model is already in place (`engagement_comments` with `location_geojson`) and the privacy filtering is a UI slice, not a data-model slice.

Recommendation: **hold until user picks ingestion vs. sixth layer.** The cartographic shell's design goal from the prompting doc is now fully met — five data-driven layers, all four primitive geometries, full selection + highlight + inspector + legend + counts wiring. The next slice is a forward-investment decision, not a gap-closing one.
