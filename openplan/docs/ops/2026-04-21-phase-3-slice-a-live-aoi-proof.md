# Phase 3 Slice A — Live mission AOIs on cartographic backdrop (2026-04-21)

## What shipped

The cartographic shell backdrop was a parchment Mapbox style with no workspace data on it. Phase 3 Slice A makes it data-driven: authenticated workspace sessions now see their own aerial-mission AOI polygons drawn over the basemap, with the layers-panel "Aerial missions" toggle wired through.

### New API route

`src/app/api/map-features/aerial-missions/route.ts` — **~100 LOC**, `GET` only.

Path: auth → membership → scoped query → type-guard filter → shape. In detail:

1. `supabase.auth.getUser()` — anon returns **401 Unauthorized**, no DB access.
2. `loadCurrentWorkspaceMembership(supabase, user.id)` — a signed-in user with no workspace returns an **empty FeatureCollection at 200** (no data leak, no noisy 404).
3. `supabase.from("aerial_missions").select(...).eq("workspace_id", membership.workspace_id).not("aoi_geojson", "is", null).limit(500)` — the `.limit(500)` is a TODO-documented cap before proper pagination lands (inline comment on `route.ts:40`).
4. Rows pass through `isAoiPolygonGeoJson` from `@/lib/aerial/dji-export` before being shaped into GeoJSON Features:

```ts
properties: {
  kind: "aerial_mission",
  missionId: row.id,
  projectId: row.project_id,
  title: row.title,
  status: row.status,
  missionType: row.mission_type,
}
```

5. Structured audit logging via `createApiAuditLogger("map-features.aerial-missions", request)`:
   - `aerial_mission_aois_loaded` on success (with `workspaceId`, `count`, `durationMs`).
   - `aerial_mission_aoi_query_failed` on DB error (with `message`, `code`).
   - `aerial_mission_aoi_unhandled_error` on unexpected catch.

DB errors return **500** with a generic `{ error: "Failed to load mission AOIs" }` message (no leak of DB text to the client).

### Backdrop fetch + paint

`src/components/cartographic/cartographic-map-backdrop.tsx` — **+111 LOC** (153 → 264).

Three effects added alongside the pre-existing style-swap effect:

1. **Fetch on mount** (`useEffect` with `cancelled` guard):
   ```ts
   fetch("/api/map-features/aerial-missions", { credentials: "same-origin" })
   ```
   Non-401 failures emit `console.warn("[cartographic-backdrop] aerial-missions fetch returned <status>")`; the catch branch emits `console.warn("[cartographic-backdrop] aerial-missions fetch failed", err)`. 401 is silent (expected on anon sessions). The early `suppressed` return (on `/explore`) skips this effect entirely.
2. **Paint source + layers** on `ready && aois` change:
   - Source: `geojson` with the FeatureCollection.
   - Fill layer `cartographic-aerial-mission-aois-fill`: `fill-color #e45635 @ fill-opacity 0.18`.
   - Outline layer `cartographic-aerial-mission-aois-outline`: `line-color #e45635 @ line-opacity 0.85 @ line-width 1.75`.
   - Uses `map.once("style.load", paint)` for the theme-swap path — `setStyle()` wipes the source/layer registry, so a blind re-run would throw.
3. **Visibility toggle** honoring `layers.aerial` from `useCartographicLayers()`:
   ```ts
   map.setLayoutProperty(layerId, "visibility", layers.aerial ? "visible" : "none")
   ```

### New route tests

`src/test/map-features-aerial-missions-route.test.ts` — **175 LOC**, 4 cases:

| Case | Expected | Assertion |
|---|---|---|
| Anonymous request | 401 | `loadCurrentWorkspaceMembership` never called |
| Signed-in, no workspace membership | 200 empty FC | DB query never fired |
| Valid + malformed polygon mix | 200, 1 feature | malformed row filtered; `audit.info("aerial_mission_aois_loaded", { count: 1 })` |
| DB error | 500 | `audit.error("aerial_mission_aoi_query_failed", { workspaceId, message: "boom" })` |

Mocks `createClient`, `createApiAuditLogger`, `loadCurrentWorkspaceMembership` at the module boundary. Chain: `select → eq → not → limit` (mock chain extended post-review when `.limit(500)` was added).

## Post-review hardening (folded in)

The /review flagged four small items; all addressed in this slice rather than a separate commit:

- **`Object.freeze(DEFAULT_LAYERS)`** in `cartographic-context.tsx:28`. Prevents mutation by no-op hook consumers who receive the default object when no provider is mounted.
- **`.limit(500)`** on the route query (`aerial-missions/route.ts:41`) plus a TODO comment documenting the pre-pagination stopgap.
- **`console.warn`** on non-401 fetch failures + catch branch in `cartographic-map-backdrop.tsx:119-140` so real 500s are at least greppable in devtools.
- **TODO-live-counts comment** on `LAYER_META` in `cartographic-layers-panel.tsx:5` — the chip values are NCTC-demo placeholders and should wire to live workspace counts in a later slice.

## Why this slice

The shell was decorative until this slice. Rendering real workspace data on the backdrop is the smallest possible first step toward "the map is the product" — and it's the one that unlocks Slice B work like click-to-select and corridor rendering.

Aerial missions were picked first because (a) they already had `aoi_geojson` on the schema, (b) Phase 2's seed enrichment just landed 3 realistic NCTC polygons, and (c) the D2 palette's `#e45635` accent was designed to be visible against both light and dark Mapbox styles.

## Gates

```bash
pnpm qa:gate
# → lint clean · 868 tests / 186 files pass (up from 858/184 pre-phase-3A) · 0 audit advisories · Next build succeeds
pnpm test --run src/test/map-features-aerial-missions-route.test.ts
# → 4/4 pass
pnpm seed:nctc -- --env-file .env.production.local
# → live prod upsert: 3 aerial missions + 3 evidence packages landed; backdrop fetch will render 3 polygons for NCTC demo sessions
```

## Known minor issues (non-blocking)

- Fetch is once-per-mount — no refetch-on-focus / SWR-style refresh. A user creating a mission in another tab won't see it until a hard reload. Acceptable for Slice A; worth a focus listener in Slice B.
- Inspector-dock chip counts still placeholder (flagged with TODO).
- No click-to-select wiring — polygons render but aren't interactive. Slice B candidate.

## Not this slice

- **Click-to-select from the map → inspector** (Slice B — requires canvas overlay or stacking reorder).
- **Project markers.** Needs a lat/lng column on `projects` or geocode-on-read.
- **Corridor / engagement layer rendering from live data.**
- **Aerial Operations OS full surface** (mission detail page already reads `projects.aerial_posture`; shell-backdrop rendering is a separate lane).

## Next

Slice B candidates, prioritized:

1. **Click-to-select** — closes the Phase 2 feedback loop in the opposite direction (map → inspector). Most visible UX win.
2. **Project markers** — requires schema work or a geocode step.
3. **Corridor layer** — bigger payload surface; wait until selection semantics are locked.
4. **Engagement pins** — lower priority until engagement flows are live.

Recommendation: **Slice B = click-to-select**, since it completes the selection loop the current Slice A only half-closes.

## Files

### New

- `src/app/api/map-features/aerial-missions/route.ts` (~100 LOC)
- `src/test/map-features-aerial-missions-route.test.ts` (175 LOC)
- `.mcp.json` (Supabase MCP HTTP transport config — scoped to project, read-only against prod project `aggphdqkanxsfzzoxlbk`)

### Modified

- `src/components/cartographic/cartographic-map-backdrop.tsx` (153 → 264 LOC)
- `src/components/cartographic/cartographic-context.tsx` (+1 LOC `Object.freeze`)
- `src/components/cartographic/cartographic-layers-panel.tsx` (+3 LOC TODO comment)

## Pointers

- Phase 2 proof (selection wiring + AOI seed): `docs/ops/2026-04-21-phase-2-cartographic-selection-aoi-proof.md`
- Deep-dive scorecard: `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`
- DJI waypoint export + polygon guard: `src/lib/aerial/dji-export.ts`
