# Phase 3 Slice I — RTP cycle pin layer on cartographic backdrop

**Date:** 2026-04-22
**Parent:** Phase 3 cartographic shell (Slices A–H shipped 2026-04-21 → 2026-04-22)
**Status:** shipped locally + applied to prod, tests 945/196 → 973/199 (+28 tests / +3 files), `pnpm qa:gate` clean.

## Goal

Close the dormant `rtp` chip in the layers panel by wiring it to a fourth data-driven map layer. RTP cycles render as single muted-plum circle pins located at the planning area's geographic anchor (county seat or centroid). Clicking a pin opens the cartographic inspector dock with the cycle's status / geography / horizon and a primary "Open cycle" action that navigates to `/rtp/{rtpCycleId}`.

This slice proves the layer dispatch pattern (helper + fetch effect + paint effect + click handler + feature-state highlight) scales **to a fourth layer** without architectural change — `KNOWN_SOURCES` and `FEATURE_LAYERS` just grow by one entry, exactly as designed when Slice D generalized the Slice A pattern.

## What shipped

### 1. Migration — nullable anchor columns on `rtp_cycles`

`supabase/migrations/20260422000067_rtp_cycles_anchor.sql`. Adds `anchor_latitude` + `anchor_longitude` as nullable `NUMERIC`, with CHECK constraints pinning to WGS84 range (`[-90, 90]` / `[-180, 180]`). Both constraints are guarded by `IF NOT EXISTS (SELECT 1 FROM pg_constraint ...)` so the migration is idempotent.

**Design decision: plain lat/lng, not PostGIS geography.** Same rationale as `projects.latitude/.longitude` (migration 20260421000065): these columns are display-only backdrop anchors, never spatial-query subjects (no "cycles within radius X of point Y" workflow exists). Numeric columns are cheaper to query, index, and render than `geography(Point)`.

**Design decision: nullable, not required.** Existing cycles stay valid; a cycle without an anchor simply won't render a pin. Metadata and chapters stay reachable via the normal `/rtp/{rtpCycleId}` routes.

**Design decision: anchor columns on `rtp_cycles`, not inherited from linked projects.** RTP cycles represent planning areas (typically county-wide or multi-county), not individual projects. Each cycle should have its own pin independent of which projects are currently linked to it. Inheriting from a "primary project" would also require a notion of primary-project ordering, which the schema doesn't model.

### 2. API route — `GET /api/map-features/rtp-cycles`

`src/app/api/map-features/rtp-cycles/route.ts` (~130 LOC). Mirrors the projects route shape:

- `loadCurrentWorkspaceMembership`-based auth gate: 401 when anonymous, empty FeatureCollection when no membership.
- `.not("anchor_latitude", "is", null).not("anchor_longitude", "is", null).limit(500)` — same stopgap as peer routes.
- Defensive `coerceLat` / `coerceLng` helpers that handle PostgREST's number-or-string NUMERIC representation + range clamp + `NaN`/`Infinity` guard.
- Emits Point features with properties `{kind: "rtp_cycle", rtpCycleId, title, status, geographyLabel, horizonStartYear, horizonEndYear}`.
- Structured audit: `rtp_cycle_pins_loaded` / `rtp_cycle_pins_query_failed` / `rtp_cycle_pins_unhandled_error` via `createApiAuditLogger`.

### 3. Helper — `rtpCycleFeatureToSelection`

`src/lib/cartographic/rtp-cycle-feature-to-selection.ts`. Mirrors the project helper shape:

- `isRtpCycleFeatureProperties` type guard
- Transform produces `kind: "rtp"` (new selection kind — see #4), `kicker: "RTP cycle"`, `avatarChar: "R"`.
- Meta rows: `status` (always), `geography` (conditional on non-null `geographyLabel`), `horizon` (conditional on both years non-null).
- Primary action: `"Open cycle"` → `navigate(/rtp/:rtpCycleId)`.
- Optional `sourceId` populates `featureRef` for Mapbox highlight round-trip.

### 4. Inspector-kind union extended

`CartographicInspectorSelection["kind"]` gains `"rtp"`: `"project" | "run" | "mission" | "report" | "corridor" | "rtp"`.

### 5. Backdrop wiring — four data-driven layers now

`src/components/cartographic/cartographic-map-backdrop.tsx`. Five additions follow the established pattern:

1. **State + fetch effect** for `/api/map-features/rtp-cycles` (mirrors corridors fetch).
2. **Paint effect** adds the circle layer — muted plum `#6b4a9e`, base radius 8 / stroke 2, selected radius 12 / stroke 3 via `feature-state` paint expression. Larger base radius than projects (6) because RTP cycles are typically 1–2 per workspace; the pin should read as a prominent anchor, not a minor dot. Color chosen for visual distinction from projects green (`#1f6b5e`), AOIs orange (`#e45635`), and corridors blue-slate-to-red LOS ramp.
3. **Visibility toggle effect** on `layers.rtp`.
4. **Click handler** — registered inside the existing click-handler effect alongside `onProjectClick` / `onCorridorClick` / `onClick` (AOI). Attaches `click` + `mouseenter` + `mouseleave` to `RTP_CYCLES_CIRCLE_LAYER_ID`. Fires `setSelection` + `fitToFeatureGeometry` (pin → `easeTo({zoom: 14})`, per Slice G's geometry dispatch).
5. **Dispatch-table updates:**
   - `FEATURE_LAYERS` gains `RTP_CYCLES_CIRCLE_LAYER_ID` so background-click-to-clear correctly distinguishes RTP pin hits from real background clicks.
   - `KNOWN_SOURCES` gains `RTP_CYCLES_SOURCE_ID` so the feature-state highlight effect correctly clears + reapplies selection across cycles.
   - Highlight effect's dep array gains `rtpCycles` so the effect re-runs when the RTP layer data fetches in.

### 6. Counts route — rtp field added

`src/app/api/map-features/counts/route.ts`. `MapFeatureCounts` type extended with `rtp: number | null`, `EMPTY_COUNTS` extended with `rtp: 0`. Promise.all gains a 4th parallel query against `rtp_cycles` scoped by `workspace_id` + non-null anchor pair. Partial-failure log includes `rtpError`.

### 7. Layers panel — label fix + chip wiring

`src/components/cartographic/cartographic-layers-panel.tsx`. Two tweaks:

1. `LAYER_LABELS.rtp` renamed from **"RTP corridors"** (placeholder) → **"RTP cycles"** (now-accurate — we render one pin per cycle, not a corridor line).
2. `chipForLayer` dispatch table gains `if (key === "rtp") return formatChip(counts.rtp)` — enables the count chip once the counts route returns the new `rtp` field.

### 8. NCTC demo seed — RTP anchor

`scripts/seed-nctc-demo.ts`. New `DEMO_RTP_ANCHOR_LATITUDE = 39.2616` / `_LONGITUDE = -121.0161` (Nevada City, the Nevada County seat) threaded into both `buildSeedRecords` + the live upsert. Offset ~2.5 km northeast from the Grass Valley project anchor (`39.239137, -121.033982`) so the project marker and RTP pin don't overlap under the shell's initial viewport.

### 9. Tests

- `src/test/rtp-cycle-feature-to-selection.test.ts` — 16 tests covering guard true/false branches, transform shape, primary-action navigation, conditional geography/horizon meta, blank-title fallback, optional sourceId featureRef round-trip.
- `src/test/map-features-rtp-cycles-route.test.ts` — 4 tests (401 anon / empty on no-membership / happy-path with valid + out-of-range + string-coded-NUMERIC mix / DB error).
- `src/test/map-features-counts-route.test.ts` — +1 new test for rtp partial failure, existing 5 tests updated to assert the `rtp` field on responses.
- `src/test/cartographic-layers-panel.test.tsx` — 6 existing tests updated for the 4-chip shape + the `"RTP cycles"` label.
- `src/test/seed-nctc-demo.test.ts` — +1 new test asserting the anchor coords on the seeded rtp_cycle row (and that they don't collide with the project marker).

No Mapbox + JSDOM integration test for the click handler or paint expressions — paint-expression shape is validated at layer-add time by Mapbox itself during `pnpm build`, and the click-handler shim is a 3-line dispatcher over the pure helper that already has 16 tests.

## Prod close-out

1. **Migration applied** via `pnpm supabase db push` — remote migration list now shows `20260422000067` with both local + remote version stamps.
2. **Re-seed landed** via `pnpm seed:nctc -- --env-file .env.production.local`. Seed output confirms upserts across workspace / membership / project / rtp_cycle / link / county_run / chapter / 3 missions / 3 packages / 2 corridors.
3. **Service-role SELECT verification** on `rtp_cycles` returns `anchor_latitude: 39.2616`, `anchor_longitude: -121.0161` for the demo cycle — coords landed exactly as authored.

Combined Slice D + E + G + H + I browser smoke test remains user-owned: open prod signed in as the demo owner, expect one green circle at Grass Valley (project), one muted-plum circle ~2.5 km northeast at Nevada City (RTP cycle), 3 orange polygons (AOIs), 2 corridor LineStrings, 4 live chips in the layers panel. Clicking any feature opens the inspector; background click or Escape clears.

## Why this slice

Called out as candidate #2 in the Slice H proof's "Next" section:

> 2. **RTP cycle "pin on map" layer** — wire the `rtp` chip to a data source. Requires an editor call on how to geolocate an RTP cycle (anchor to primary project's coords, or add nullable `rtp_cycles.anchor_lat/lng` column). Mild schema slice.

Chosen over #1 (corridor authoring UI) because it's the faster concrete ship: a one-migration addition + a near-clone of the existing project-marker path + a label fix in the layers panel. Corridor authoring is the first editable surface in the cartographic system, which is a strictly bigger slice that would benefit from its own plan document.

The schema decision (nullable anchor columns on `rtp_cycles`, not "anchor to primary project") was straightforward once framed: cycles represent planning areas, not projects, and a cycle without any linked projects should still be able to render on the map.

## Known minor issues / scope boundaries

- **Fit-on-click for an RTP pin always uses the default `POINT_FIT_ZOOM = 14`.** Slice G's dispatch doesn't distinguish RTP pins from project markers — both are Points. Could argue RTP cycles (planning-area scale) should zoom out further than individual projects (neighborhood scale), but the difference is minor at 14 vs, say, 11. Deferred.
- **No pin cluster strategy.** If a workspace ever had 20+ cycles with anchors, they'd overlap at county scale. Not a near-term concern: workspaces hold 1–5 cycles typically.
- **No hover tooltip.** A hover state on the pin would be nice (show title + horizon on hover), but the inspector dock already reveals all the same info on click. Consistent with other layers.
- **Revalidate-on-create still open.** Creating a new RTP cycle elsewhere in the app doesn't live-update the layers panel chip or the backdrop pins — same gap that Slice F flagged. Closes when authoring lands.

## Gates

- Lint: clean
- `pnpm audit --prod --audit-level=moderate`: 0 advisories
- `pnpm test`: 199 files / 973 tests passing (was 196 / 945)
- `pnpm build`: 65 routes (up from 64 — new `/api/map-features/rtp-cycles`), compile success

## Files shipped

### Added
- `supabase/migrations/20260422000067_rtp_cycles_anchor.sql`
- `src/app/api/map-features/rtp-cycles/route.ts`
- `src/lib/cartographic/rtp-cycle-feature-to-selection.ts`
- `src/test/rtp-cycle-feature-to-selection.test.ts`
- `src/test/map-features-rtp-cycles-route.test.ts`

### Modified
- `src/components/cartographic/cartographic-map-backdrop.tsx` (+state / fetch / paint / visibility / click / highlight dispatch)
- `src/components/cartographic/cartographic-inspector-dock.tsx` (kind-union extended)
- `src/components/cartographic/cartographic-layers-panel.tsx` (label fix + chip dispatch)
- `src/app/api/map-features/counts/route.ts` (rtp field + 4th parallel query)
- `scripts/seed-nctc-demo.ts` (anchor constants + live upsert)
- `src/test/map-features-counts-route.test.ts` (rtp field + partial-failure case)
- `src/test/cartographic-layers-panel.test.tsx` (4-chip assertions + label fix)
- `src/test/seed-nctc-demo.test.ts` (anchor assertion)

## Pointers

- Phase 3 Slice D proof (prior, project markers pattern): `docs/ops/2026-04-21-phase-3-slice-d-project-markers-proof.md`
- Phase 3 Slice E proof (prior, corridor layer pattern): `docs/ops/2026-04-21-phase-3-slice-e-corridor-layer-proof.md`
- Phase 3 Slice F proof (prior, counts route pattern): `docs/ops/2026-04-22-phase-3-slice-f-layers-panel-live-counts-proof.md`
- Phase 3 Slice H proof (prior, called out Slice I as #2 candidate): `docs/ops/2026-04-22-phase-3-slice-h-escape-to-clear-proof.md`

## Next

With Slice I done, the layers panel now has four live chips (projects / aerial / corridors / rtp) against four data-driven layers. The remaining four chip-less entries (engagement / transit / crashes / equity) sit on data sources that either don't exist yet or live outside the cartographic surface (engagement has its own map today).

Candidates for the next slice, in rough order of my current lean:

1. **Corridor authoring UI** — first editable surface in the cartographic system. Inspector-dock "Edit corridor" → draw mode on the backdrop → persist via `POST /api/map-features/corridors` (route doesn't exist yet; Slice E only shipped GET). Bigger slice; would benefit from its own plan document. Unlocks the revalidate-on-create gap Slice F flagged.
2. **Engagement pins layer** — wire the dormant `engagement` chip. Data source already exists (`engagement_campaigns` / `engagement_comments`); schema likely needs anchor coords on campaigns, similar to this slice. Natural next chip to light up.
3. **Background-clear focus management** — when Escape or background-click clears a selection, optionally refocus a sensible anchor (the map canvas? the first list row?). Low-stakes a11y polish.
4. **Fit-on-click tuning for different kinds** — teach the dispatch to pick different `POINT_FIT_ZOOM` values for projects (14, neighborhood) vs RTP cycles (11, county). Small win; not urgent.

Recommendation: **#1 next**, because it's the biggest single unblock on the cartographic system (first editable surface) and every chip-less layer downstream will lean on the same authoring pattern. But #2 is a cleaner weekend-sized slice if more data-driven lighting-up is preferred over first-editable-surface risk.

User-owned follow-up:

- **Browser smoke test on prod.** Combined Slice D + E + G + H + I visual check. Needs a demo-owner session. Checklist (for when the smoke happens):
  - One green circle at Grass Valley (project) + one muted-plum circle ~2.5 km northeast at Nevada City (RTP cycle).
  - 3 orange polygons (Downtown / SR-49 Alta Sierra / Empire Mine AOIs).
  - 2 corridor LineStrings (SR-49 D / Empire St C).
  - Layers panel shows 4 chips (`1` / `3` / `2` / `1`) with labels Projects / Aerial missions / Study corridors / RTP cycles.
  - Click RTP pin → inspector dock shows kicker "RTP cycle", title "NCTC 2045 RTP — demo cycle", meta rows for status / geography / horizon, primary action "Open cycle".
  - Pin lifts (radius 8 → 12, stroke 2 → 3) on selection; background-click or Escape clears; selection hides the lift.
  - Toggle `rtp` off in the layers panel → pin hides. Toggle back on → pin returns.
