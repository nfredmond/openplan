# Phase 3 Slice E — Corridor layer on the cartographic backdrop (2026-04-21)

## What shipped

Slice D proved the helper + feature-ref + highlight pattern generalizes from Polygons (Slice A) to Points (Slice D). Slice E lands the third Mapbox primitive geometry — **LineStrings** — completing the pattern-generalization across all three shapes the backdrop will need for the per-project corridor overlay story.

### Schema — display-only `project_corridors`

`supabase/migrations/20260421000066_project_corridors.sql` adds:

```sql
CREATE TABLE IF NOT EXISTS public.project_corridors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  corridor_type text NOT NULL DEFAULT 'arterial'
    CHECK (corridor_type IN ('highway', 'arterial', 'transit', 'bike', 'trail', 'custom')),
  los_grade text
    CHECK (los_grade IS NULL OR los_grade IN ('A', 'B', 'C', 'D', 'E', 'F')),
  geometry_geojson jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- **`geometry_geojson jsonb`**, not `geography(LineString, 4326)`. Cheaper, matches the AOI (polygon jsonb) + project-marker (plain lat/lng NUMERIC) storage shapes, and display-only LineStrings are never spatial-query subjects.
- **Distinct from `network_corridors`.** The transportation-modeling corridor chain lives under `network_packages` + `network_corridors` (see `20260318000027` / `20260318000028`) and requires the full model-package chain to seed. Planning-level corridors a project wants on the backdrop belong here.
- **Workspace-scoped RLS** mirrors `project_markers`' shape: select/insert/update/delete all gated on `workspace_members`.

Migration not yet applied to prod — flagged as a user-owned follow-up at the bottom.

### Validator — `isCorridorLineGeoJson`

`src/lib/cartographic/corridor-line-geojson.ts`: LineString geometry guard that asserts `type === "LineString"`, `coordinates.length >= 2`, every position is a `[lng, lat]` pair of finite numbers inside the WGS84 range (`[-180, 180]` × `[-90, 90]`). Covered by 8 cases in `src/test/corridor-line-geojson.test.ts`.

### API route — `GET /api/map-features/corridors`

`src/app/api/map-features/corridors/route.ts` mirrors the projects + aerial-missions route pattern:

- Auth-gated via `supabase.auth.getUser()` (401 anon).
- Workspace-scoped via `loadCurrentWorkspaceMembership`; returns empty FeatureCollection if the user has no membership.
- `.from("project_corridors").select(…).eq("workspace_id", …).limit(500)` — same 500-row stopgap + TODO-pagination carryover from the earlier slices.
- Defensive `isCorridorLineGeoJson` filter drops malformed rows at the API layer (defense in depth — the `geometry_geojson jsonb NOT NULL` column would reject a `null`, but the type guard catches Polygon-in-a-corridor-row and similar data drift).
- Structured audit via `createApiAuditLogger("map-features.corridors", request)`: `project_corridors_loaded` on success (+ `count`, `durationMs`), `project_corridors_query_failed` on DB error, `project_corridors_unhandled_error` on unexpected catch.
- Emits GeoJSON `LineString` Features with properties:

```ts
{ kind: "corridor", corridorId, projectId, name, corridorType, losGrade }
```

### Helper — `corridor-feature-to-selection.ts`

`src/lib/cartographic/corridor-feature-to-selection.ts` — pure, route-agnostic, DI `navigate`, mirrors the project helper's shape:

- `isCorridorFeatureProperties` type guard (rejects missing `corridorId`, wrong `kind`, non-object input; accepts null `projectId` and null `losGrade`).
- `corridorFeatureToSelection` returns a `CartographicInspectorSelection` with `kind: "corridor"`, kicker `"Corridor"`, avatar `"C"`, meta rows for `type` (always) and `LOS` (when non-null). Primary action navigates to `/projects/:projectId` only when `projectId` is non-null (corridors can be orphaned from a project and the inspector should still open). Populates `featureRef` when `sourceId` is supplied.

`CartographicInspectorSelection["kind"]` in `src/components/cartographic/cartographic-inspector-dock.tsx` extended from `"project" | "run" | "mission" | "report"` to include `"corridor"`.

### Backdrop — third source + line layer + click + highlight + LOS color ramp

`src/components/cartographic/cartographic-map-backdrop.tsx` additions:

1. **Fetch effect** — new `useEffect` fetches `/api/map-features/corridors` into `corridors` state with the same cancel-guard + `console.warn` posture as the AOI + projects fetches.
2. **Paint effect** — adds `cartographic-corridors` geojson source + `cartographic-corridors-line` line layer:

   ```ts
   "line-color": [
     "match",
     ["get", "losGrade"],
     "A", "#4a7a9e",  "B", "#4a7a9e",   // calm blue-slate
     "C", "#c8962f",  "D", "#c8962f",   // warm amber
     "E", "#b45239",                      // burnt orange
     "F", "#8a2e24",                      // congestion red
     "#4a7a9e",                           // fallback: neutral base
   ],
   "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 5, 3],
   "line-opacity": 0.9,
   layout: { "line-cap": "round", "line-join": "round" },
   ```

   LOS-driven color ramp per planning convention — lower grades degrade from calm blue-slate toward congestion red. Lines without LOS fall through to the neutral base. Selected lift: line-width `3 → 5`.
3. **Visibility effect** — honors `layers.corridors` from the cartographic context (already wired in `cartographic-context.tsx` from Phase 2; default `true`).
4. **Click + hover handlers** — `onCorridorClick` goes through `corridorFeatureToSelection`, shared cursor handlers now cover three layers.
5. **Highlight effect** — `KNOWN_SOURCES` tuple extended from `[AOI_SOURCE_ID, PROJECTS_SOURCE_ID]` to `[AOI_SOURCE_ID, PROJECTS_SOURCE_ID, CORRIDORS_SOURCE_ID]`. Dependency array extended to include `corridors`. No architectural change — the Slice D dispatch-table pattern scales as expected.

### Seed — 2 hand-authored NCTC corridors

`scripts/seed-nctc-demo.ts`:

- New exported constants:
  - `DEMO_CORRIDOR_SR49` — 7-position LineString tracing SR-49 through Grass Valley heading south.
  - `DEMO_CORRIDOR_EMPIRE_ST` — 5-position LineString tracing Empire St east toward Empire Mine State Historic Park.
- New upsert loop after evidence-packages creates two `project_corridors` rows: SR-49 at `los_grade = "D"` (signalized arterial, warm-amber paint), Empire St at `los_grade = "C"` (same color family, suburban arterial). Both `workspace_id = DEMO_WORKSPACE_ID`, `project_id = DEMO_PROJECT_ID`.
- New `DEMO_CORRIDOR_SR49_ID` / `_EMPIRE_ID` deterministic UUIDs so the seed remains idempotent.

### Tests

| File | Cases | What it covers |
|---|---|---|
| `src/test/corridor-line-geojson.test.ts` | 8 | validator shape: valid, 2-position minimum, non-object, wrong type, fewer than 2 positions, non-numeric, non-finite, WGS84 range |
| `src/test/corridor-feature-to-selection.test.ts` | +15 new | guard (7) + transform (8): guard true/false branches across `kind`/`corridorId`/null `projectId`/null `losGrade`, transform happy path + null-projectId no-primary-action + null-losGrade no-LOS-meta + blank-name fallback + featureRef absent/present |
| `src/test/map-features-corridors-route.test.ts` | +4 new | 401 anon / 200 empty for no-membership / 200 filtered mix of valid + orphan + malformed geometry / 500 on DB error |
| `src/test/nctc-demo-corridors.test.ts` | +3 new | Both seeded LineStrings pass `isCorridorLineGeoJson`, have ≥ 2 positions, and stay inside the Nevada County WGS84 window |

No backdrop integration test — the wiring surface is thin (one additional effect chain + extended KNOWN_SOURCES + new click handler) and Mapbox's `addLayer` paint-expression validation runs at `pnpm build` time.

## Why this slice

Closes the third of three Mapbox primitive geometry kinds on the backdrop — Polygon (Slice A) → Point (Slice D) → **LineString (Slice E)**. Every data-driven layer the product will need beyond this (engagement point clusters, crash hotspot heatmaps, equity tract fills) is a styling variation on these three primitives, not a new primitive. The pattern is now fully proven; future layers reuse the helper + feature-ref + highlight + KNOWN_SOURCES tuple without architectural change.

The corridor-specific LOS color ramp also seeds the pattern for per-feature paint-driven styling — the next LineString layer (e.g., equity impact classification) can steal the `match` expression shape wholesale.

## Known minor issues (non-blocking)

- **Prod close-out pending.** Migration `20260421000066_project_corridors.sql` + re-seed are the two user-owned follow-ups; Slice E is not "live" until both land. Mirrors the Slice D close-out shape — same `supabase migration list` → `db push` → service-role `SELECT` verification flow.
- **No clustering or segment-level styling.** 500 individual lines is fine today; corridors with per-segment LOS (different grades along different stretches) would need segmented LineStrings — deferred.
- **No line-label paint.** Corridor name doesn't appear on the map without a click. If labels become necessary, `symbol` layer on the same source + `text-field` off `properties.name` is the natural upgrade.
- **Pan/fit-to-selection.** Same carryover as Slices B–D.
- **Keyboard path for map-clicks.** Same A11y carryover from Slice B.

## Not this slice

- **Corridor editing UI.** The table + RLS supports insert/update/delete, but no UI ships in this slice — corridor authoring is seed-only for now.
- **Engagement / crashes / equity overlays.** Same helper/highlight pattern will apply; geometry payload shape is the per-layer open question.
- **Deck.gl mode for richer styling.** Mapbox native line layer is sufficient for display-only corridors; deck.gl's `PathLayer` would unlock dash patterns + per-segment gradients but adds bundle weight.

## Gates

```bash
pnpm test --run src/test/corridor-line-geojson.test.ts \
  src/test/corridor-feature-to-selection.test.ts \
  src/test/map-features-corridors-route.test.ts \
  src/test/nctc-demo-corridors.test.ts
# → 30/30 pass

pnpm qa:gate
# → lint clean · 928 tests / 193 files pass (up from 906/190 post-Slice D close-out)
#   · 0 advisories · Next build succeeds · 63 routes prerendered
```

## Files

### New
- `supabase/migrations/20260421000066_project_corridors.sql` (83 LOC — table + indexes + RLS + comments; committed earlier in `980ee59` as the Slice E foundation)
- `src/lib/cartographic/corridor-line-geojson.ts` (19 LOC — type guard; also committed in `980ee59`)
- `src/lib/cartographic/corridor-feature-to-selection.ts` (70 LOC — guard + transform)
- `src/app/api/map-features/corridors/route.ts` (~95 LOC — GET handler + defensive geometry filter)
- `src/test/corridor-line-geojson.test.ts` (8 cases; also committed in `980ee59`)
- `src/test/corridor-feature-to-selection.test.ts` (15 cases)
- `src/test/map-features-corridors-route.test.ts` (4 cases)
- `src/test/nctc-demo-corridors.test.ts` (3 cases)
- `docs/ops/2026-04-21-phase-3-slice-e-corridor-layer-proof.md` (this file)

### Modified
- `scripts/seed-nctc-demo.ts` (+61 LOC — `DEMO_CORRIDOR_SR49`/`_EMPIRE_ST` constants, 2 corridor UUIDs, upsert loop + manifest line)
- `src/components/cartographic/cartographic-map-backdrop.tsx` (+130 LOC — corridor fetch + paint + visibility + click + extended highlight + LOS color ramp)
- `src/components/cartographic/cartographic-inspector-dock.tsx` (+1 LOC — `"corridor"` added to the selection `kind` union)

## User-owned follow-ups

1. **Apply migration `20260421000066_project_corridors.sql` to prod.** Same shape as the Slice D close-out:
   - `pnpm supabase migration list` — confirm the migration is the only one pending.
   - `pnpm supabase db push` — single migration, idempotent (`CREATE TABLE IF NOT EXISTS` + `DROP POLICY IF EXISTS`).
   - Post-apply: `SELECT table_name FROM information_schema.tables WHERE table_name = 'project_corridors'` should return the row.
2. **Re-seed the NCTC demo** via `pnpm seed:nctc -- --env-file .env.production.local`. Idempotent on `id` — existing workspace/project/mission/package rows are no-ops; new corridor rows land. Expected output includes two new `upserted project corridor d0000001-…-000000000[0ef]` lines + a `corridors: 2 (SR-49 / Empire St)` summary.
3. **Smoke test** against the signed-in demo browser — expect two blue-slate and/or amber lines running south through downtown Grass Valley. Click → inspector dock shows `kind: "corridor"`, kicker "Corridor", meta rows for type/LOS, "Open project" primary action. Line visually thickens `3 → 5px` on select. Can ride along with the still-pending Slice D smoke test.

## Pointers

- Phase 3 Slice D proof (same pattern, Point primitive): `docs/ops/2026-04-21-phase-3-slice-d-project-markers-proof.md`
- Phase 3 Slice C proof (feature-state highlight origin): `docs/ops/2026-04-21-phase-3-slice-c-feature-state-highlight-proof.md`
- Project helper (identical shape): `src/lib/cartographic/project-feature-to-selection.ts`
- Mapbox line layer paint: https://docs.mapbox.com/style-spec/reference/layers/#line
- Mapbox `match` expression: https://docs.mapbox.com/style-spec/reference/expressions/#match

## Next

Slice F candidates, prioritized:

1. **Prod close-out** — land the Slice E migration + re-seed against `aggphdqkanxsfzzoxlbk`, close this doc's user-owned follow-ups, complete the combined Slice D + Slice E smoke test. The bigger-picture next-slice work assumes prod is caught up.
2. **Layers panel live counts** — the chip placeholders in `cartographic-layers-panel.tsx` have been TODO since Slice A. Now that three data-driven layers exist, a single workspace aggregate query (counts per table, auth-scoped) can back all three chips. Cleanup slice.
3. **Pan / fit-to-selection** — UX polish; on click, `map.fitBounds()` the feature's bbox. Jitter problem when a list-row hover fires `setSelection` on every row.
4. **Background-click-to-clear** — still the lowest-stakes polish.
5. **Corridor authoring UI** — the table supports writes via RLS, but no UI exists. Next step for turning corridors from a seed-only demo asset into a first-class per-project editing surface.

Recommendation: **Slice F = prod close-out + layers panel live counts**, bundled. Close-out is quick (mirrors Slice D) and the layers-panel counts slice is small enough to ride along. Saves a round-trip on prod migrations.
