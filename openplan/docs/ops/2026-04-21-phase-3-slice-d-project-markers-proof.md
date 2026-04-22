# Phase 3 Slice D — Project markers on the cartographic backdrop (2026-04-21)

## What shipped

Slice A put mission AOIs on the backdrop. Slice B made them clickable. Slice C added feature-state highlight. Slice D adds a second data-driven layer — **project markers** — and proves the helper + feature-ref + highlight pattern generalizes beyond the aerial-missions source.

### Schema — nullable `latitude` / `longitude` on `projects`

`supabase/migrations/20260421000065_projects_location.sql` adds:

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC;
```

Both nullable so existing rows stay valid. Range check constraints (`-90..90`, `-180..180`) are installed idempotently. No PostGIS geometry column: projects are **display-only markers**, never spatial-query subjects, so plain NUMERIC lat/lng is cheaper than `geography(Point, 4326)` and avoids WKT/GeoJSON casting on the seed path.

Expected migration posture: applied in dev via `pnpm supabase db push`; production apply + demo re-seed is a user-owned follow-up (noted at the end).

### Seed — NCTC demo project gets coords

`scripts/seed-nctc-demo.ts` — new exported constants `DEMO_PROJECT_LATITUDE = 39.239137` and `DEMO_PROJECT_LONGITUDE = -121.033982` (the Grass Valley anchor — same value as `DEFAULT_CENTER` in the backdrop), threaded into both `buildSeedRecords` output and the live upsert payload. One additional assertion in `src/test/seed-nctc-demo.test.ts` pins the values so a future refactor can't silently drift the marker off the initial viewport.

### API route — `GET /api/map-features/projects`

`src/app/api/map-features/projects/route.ts` — mirrors the aerial-missions route pattern:

- Auth-gated via `supabase.auth.getUser()` (401 anon).
- Workspace-scoped via `loadCurrentWorkspaceMembership`; returns empty FeatureCollection if the user has no membership.
- `.from("projects").select(…).eq("workspace_id", …).not("latitude", "is", null).not("longitude", "is", null).limit(500)` — both coords required, 500-row stopgap (TODO-pagination same as aerial-missions).
- Defensive coercion: PostgREST can surface NUMERIC as either a JS number or a string depending on driver plumbing. `coerceLat` / `coerceLng` accept both, reject non-finite values, and enforce the range constraint a second time at the API layer (defense in depth — the DB check constraint would reject out-of-range **writes**, but this guards against a legacy row slipping through).
- Structured audit via `createApiAuditLogger("map-features.projects", request)`: `project_markers_loaded` on success (+ `count`, `durationMs`), `project_markers_query_failed` on DB error, `project_markers_unhandled_error` on unexpected catch.
- Emits GeoJSON `Point` Features with properties:

```ts
{ kind: "project", projectId, name, status, deliveryPhase, planType }
```

### Helper — `project-feature-to-selection.ts`

`src/lib/cartographic/project-feature-to-selection.ts` — pure, route-agnostic, dependency-injected `navigate`, matching the mission helper's shape:

- `isProjectFeatureProperties` type guard (rejects missing `projectId`, wrong `kind`, non-object input; accepts null `planType`).
- `projectFeatureToSelection` returns a `CartographicInspectorSelection` with `kind: "project"`, kicker "Project", avatar "P", and meta rows for `status` / `phase` / (optionally) `type`. Primary action navigates to `/projects/:id`. Populates `featureRef` when `sourceId` is supplied so the backdrop can highlight via feature-state (same contract as the mission helper).

### Backdrop — second source + circle layer + click + highlight

`src/components/cartographic/cartographic-map-backdrop.tsx` — additions layered on top of Slice A–C:

1. **Fetch effect** — separate `useEffect` fetches `/api/map-features/projects` into a new `projectMarkers` state with the same cancel-guard + `console.warn` posture as the AOI fetch.
2. **Paint effect** — adds `cartographic-projects` geojson source + `cartographic-projects-circle` circle layer:

```ts
"circle-color": "#1f6b5e",   // D2 accent-2 green; distinct from AOI orange
"circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 9, 6],
"circle-stroke-color": "#ffffff",
"circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 1.5],
"circle-opacity": 0.92,
```

Selected lift: radius 6→9, stroke 1.5→2.5. Same case-expression shape as Slice C's AOI paint.

3. **Visibility effect** — honors `layers.projects` from the cartographic context (`DEFAULT_LAYERS.projects === true`).
4. **Click + hover handlers** — `onProjectClick` goes through `projectFeatureToSelection` and `setSelection` (the shared cursor handlers cover both layers).
5. **Highlight effect** — generalized to iterate a `KNOWN_SOURCES = [AOI_SOURCE_ID, PROJECTS_SOURCE_ID]` tuple, clear feature-state on every known source, and apply the `selected: true` write when `selection.featureRef.sourceId` matches any of them. This is exactly the dispatch-table pattern flagged as a known-minor-issue in the Slice C proof doc.

### Tests

| File | Cases | What it covers |
|---|---|---|
| `src/test/project-feature-to-selection.test.ts` | **+12 new** | guard (5) + transform (7): null/non-object/missing-fields/wrong-kind, happy-path meta, navigation, null-planType meta omission, blank-name fallback, featureRef absence/presence |
| `src/test/map-features-projects-route.test.ts` | **+4 new** | 401 anon / 200 empty for no-membership / 200 filtered mix of valid & out-of-range & string-coded coords / 500 on DB error |
| `src/test/seed-nctc-demo.test.ts` | **+1 case** | pins `project.latitude === 39.239137` and `project.longitude === -121.033982` |

No backdrop integration test — the wiring surface is thin (two additional effects + three new event handlers reuse Slice B/C patterns) and Mapbox's state machinery is upstream-covered. Build-time validation of the circle paint expression runs via `pnpm build` (Mapbox rejects malformed paint at `addLayer` time).

## Why this slice

Slice C left an explicit gap: *"Cross-source selections are no-ops. A selection whose `featureRef.sourceId` isn't `AOI_SOURCE_ID` passes through silently — correct for now, but when project markers ship, the backdrop will need a dispatch table keyed on sourceId."* This slice closes that gap by shipping the second layer and generalizing the highlight effect to a source-tuple iteration. The pattern is now proven for N layers — corridor / engagement / crashes / equity can all follow the same helper + featureRef + paint-case shape without any backdrop architecture change.

## Known minor issues (non-blocking)

- **No clustering.** 500 individual circles is fine today; above that, Mapbox's `cluster: true` on the geojson source is the natural upgrade (with a per-cluster count label paint on a separate layer).
- **Projects w/o coords are invisible.** The route filters on both `latitude` and `longitude` not-null, and the seed currently only coords the NCTC demo project. Other projects in the demo workspace (none yet) would drop off silently until someone adds coords. Acceptable for now — the inspector dock and list pages still surface them.
- **No pan/fit-to-selection.** Same carryover as Slice C.
- **Non-clustered stacking.** If two projects sit on top of each other, the click target is the top one — no "expand to pick" UI.

## Not this slice

- **Live project counts on the layers panel.** Chip values in `cartographic-layers-panel.tsx` remain NCTC-demo placeholders, carried forward from Slice A.
- **Corridor / engagement / crashes / equity layers.** Same helper/highlight pattern will apply; geometry payload shape is the per-layer open question.
- **Keyboard cycling through visible features.** A11y gap carried forward from Slice B.
- **RTP cycle markers.** Separate layer, different id semantics — deferred.

## Gates

```bash
pnpm test --run src/test/project-feature-to-selection.test.ts \
  src/test/map-features-projects-route.test.ts \
  src/test/seed-nctc-demo.test.ts \
  src/test/mission-feature-to-selection.test.ts
# → 45/45 pass

pnpm qa:gate
# → lint clean · 898 tests / 189 files pass (up from 881/187 post-Slice C)
#   · 0 advisories · Next build succeeds
```

## Files

### Modified
- `scripts/seed-nctc-demo.ts` (+12 LOC — `DEMO_PROJECT_LATITUDE`/`_LONGITUDE` + both upsert call sites)
- `src/components/cartographic/cartographic-map-backdrop.tsx` (+95 LOC — projects fetch + paint + visibility + click + extended highlight)
- `src/test/seed-nctc-demo.test.ts` (+10 LOC — 1 new case + import additions)

### New
- `supabase/migrations/20260421000065_projects_location.sql` (49 LOC — lat/lng columns + check constraints + comments)
- `src/app/api/map-features/projects/route.ts` (~120 LOC — GET handler + coerce helpers)
- `src/lib/cartographic/project-feature-to-selection.ts` (69 LOC — guard + transform)
- `src/test/project-feature-to-selection.test.ts` (+12 cases)
- `src/test/map-features-projects-route.test.ts` (4 cases)
- `docs/ops/2026-04-21-phase-3-slice-d-project-markers-proof.md` (this file)

## User-owned follow-ups

1. **Apply migration to prod.** `supabase/migrations/20260421000065_projects_location.sql` is idempotent (`ADD COLUMN IF NOT EXISTS`, constraint-existence guards), safe to apply via MCP `apply_migration` or `supabase db push`. No backfill required — existing rows stay NULL and are filtered out by the route.
2. **Re-seed NCTC demo.** Re-run `pnpm seed:nctc -- --env-file .env.production.local` so the demo project picks up the Grass Valley coords. Upsert is idempotent on `id`.
3. **Smoke test against prod.** After seeding, hit `/` signed in as the demo owner — expect one green circle at Grass Valley, hover shows pointer cursor, click opens the project inspector with lifted stroke.

## Pointers

- Phase 3 Slice C proof (feature-state highlight): `docs/ops/2026-04-21-phase-3-slice-c-feature-state-highlight-proof.md`
- Phase 3 Slice B proof (click-to-select): `docs/ops/2026-04-21-phase-3-slice-b-click-to-select-proof.md`
- Phase 3 Slice A proof (live AOIs): `docs/ops/2026-04-21-phase-3-slice-a-live-aoi-proof.md`
- Mission helper (identical pattern): `src/lib/cartographic/mission-feature-to-selection.ts`
- Mapbox circle layer paint: https://docs.mapbox.com/style-spec/reference/layers/#circle

## Next

Slice E candidates, prioritized:

1. **Corridor layer rendering** — bigger payload surface than projects (LineStrings with per-segment LOS attributes), but the helper/paint/highlight pattern is now proven across Polygons (Slice A) and Points (Slice D). LineStrings are the natural third shape.
2. **Fit-to-selection on click** — UX polish; decide pan-vs-fitBounds jitter behavior when a list-row hover fires `setSelection` on every row.
3. **Background-click-to-clear** — still a low-stakes UX polish.
4. **Projects without coords → opportunistic geocode** — runtime geocode-on-read against a cached lookup (e.g., project name + city), nullable cache column. Out of scope for a display-only layer; better to require authors to set coords on project creation.

Recommendation: **Slice E = corridor layer**, since it moves us to a third geometry kind and starts the per-project corridor overlay story.
