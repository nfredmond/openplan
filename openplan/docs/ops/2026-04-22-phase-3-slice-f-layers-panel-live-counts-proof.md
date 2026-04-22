# Phase 3 Slice F — layers panel live counts

**Date:** 2026-04-22
**Parent:** Phase 3 cartographic shell (Slices A–E shipped 2026-04-21)
**Status:** shipped on `main`, tests 928/193 → 939/195 (+11 tests / +2 files), `pnpm qa:gate` clean.

## Goal

Close the TODO that's been open since Slice A: replace the placeholder chip values on `cartographic-layers-panel.tsx` with live workspace-scoped counts. Now that three data-driven layers are live (Slice A = aerial AOIs, Slice D = project markers, Slice E = study corridors), a single aggregate query backs all three chips.

## What shipped

### 1. New `GET /api/map-features/counts` route

`src/app/api/map-features/counts/route.ts` (86 LOC). Mirrors the auth / workspace-scope / audit shape of sibling routes (`aerial-missions`, `projects`, `corridors`), but diverges on query shape — instead of pulling rows and transforming them into features, each table is queried `head: true, count: "exact"`. Supabase returns the count in the response metadata with no row payload, which is cheap even on workspaces with thousands of rows.

Three parallel counts, dispatched via `Promise.all`:

| Layer key (panel) | Table | Filter beyond `workspace_id` |
|---|---|---|
| `projects` | `projects` | `latitude IS NOT NULL AND longitude IS NOT NULL` (mirrors the projects map-features route — only markers that will render count) |
| `aerial` | `aerial_missions` | `aoi_geojson IS NOT NULL` (mirrors the aerial-missions route) |
| `corridors` | `project_corridors` | none — every row has a geometry by schema (`geometry_geojson jsonb NOT NULL`) |

**Error posture:** per-layer `null` on failure. If one query fails, the other two still return their counts and the failing layer comes back as `null` — the panel hides that chip rather than the whole panel breaking. A structured `audit.warn("map_feature_counts_partial_failure", …)` fires when any layer errors.

**Response shape** (`MapFeatureCounts`):

```ts
{ projects: number | null, aerial: number | null, corridors: number | null }
```

Anonymous → 401. No-membership → `{ projects: 0, aerial: 0, corridors: 0 }` (no queries run). Logged events:

- `map_feature_counts_loaded` (info) on success or partial success
- `map_feature_counts_partial_failure` (warn) when any individual query errors
- `map_feature_counts_unhandled_error` (error) on unhandled throw

### 2. Rewired layers panel

`src/components/cartographic/cartographic-layers-panel.tsx` (49 → 89 LOC):

- Dropped the `TODO(live-counts)` block and its NCTC-demo placeholders (`14` / `2` / `6` / `3.8k` / `1`).
- Added `useEffect` + `AbortController` to `fetch("/api/map-features/counts")` on mount. On unmount, the request aborts silently (no `console.warn` for `AbortError`).
- The three data-driven layer keys (`projects`, `aerial`, `corridors`) pull their chip value from the fetched payload. The other five keys (`rtp`, `engagement`, `transit`, `crashes`, `equity`) stay chip-less until they gain their own data sources — no placeholder values, no fake chips.
- `formatChip` renders integers verbatim up to 999, then switches to `Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })` for 1000+. Zero stays `"0"` instead of disappearing (distinguishes "no rows yet" from "no data source wired").
- Fetch failure or `null` count → chip is undefined → no chip renders (empty slot, not `"—"` or `"?"`).

### 3. Tests

11 new tests across 2 files:

- `src/test/map-features-counts-route.test.ts` (177 LOC, 5 tests) — 401 anon, zero counts on no-membership, happy-path all three layers, partial failure posture, `null`-count coercion to 0.
- `src/test/cartographic-layers-panel.test.tsx` (130 LOC, 6 tests) — pre-fetch empty-chip state, live chips on successful fetch, zero counts render `"0"`, `null`-per-layer hides that single chip, 1000+ formats as compact (`3.8K`), fetch-failure hides all chips.

### Cost model

The endpoint is three `count: "exact", head: true` queries in parallel. Postgres' exact-count is not free (sequential scan with RLS predicate), but at the scale the NCTC demo operates (1-digit to low-3-digit row counts per table per workspace) it's negligible. If a workspace ever grows into the tens of thousands on any one table, we'd swap to `count: "planned"` or `count: "estimated"` — same API surface, planner-side stats cost, cached in-memory.

No new indexes needed: the `workspace_id` predicate hits the existing `idx_project_corridors_workspace` on corridors, `aerial_missions.workspace_id` is part of RLS and already indexed via the policy's EXISTS subquery, and `projects.workspace_id` is part of existing key constraints.

## Why this slice

Every prior Slice proof called out this TODO as the follow-up that would ride along once the third data-driven layer landed. Now that Slice E closes the polygon/point/line generalization loop, one aggregate query backs all three chips with no new architecture — just a count RPC-like read that mirrors the read pattern we already trust.

Bundling it into Slice F (not folded into Slice E) kept the Slice E proof focused on the pattern generalization and let the counts work stand on its own for review.

## Known minor issues / scope boundaries

- **Counts fetch re-runs only on panel mount.** A mission/corridor added elsewhere in the app doesn't refresh the chip live. The backdrop's source data is fetched on the same lifecycle (backdrop mount), so for the demo-path the two numbers are consistent. A `revalidate` event (e.g., after a create in the inspector, once authoring lands) is a future polish.
- **Five layer keys stay chip-less.** `rtp` (RTP corridors), `engagement`, `transit` (GTFS), `crashes`, `equity` — all placeholders until each gets a data-driven layer. No fake chip values; empty is honest.
- **No cache header.** Response is `max-age=0` by default. Next step could be `s-maxage=60, stale-while-revalidate=600` once caching is the bottleneck, but the payload is ~60 bytes and three cold COUNT(*)s are so cheap on NCTC-scale data that adding caching now would be premature.
- **No accessibility escalation for count changes.** Chips are visual decoration inside a `<label>` — they don't announce via aria-live. If a screen reader user toggles a layer, the label + checkbox state announce; the count is redundant context, intentionally not re-announced on fetch.

## Gates

- Lint: clean
- `pnpm audit --prod --audit-level=moderate`: 0 advisories
- `pnpm test`: 195 files / 939 tests passing (was 193 / 928)
- `pnpm build`: 63 routes (now 64 — `/api/map-features/counts` added), compile success

## Files shipped

### Added
- `src/app/api/map-features/counts/route.ts` (86 LOC — workspace-scoped aggregate-count route)
- `src/test/map-features-counts-route.test.ts` (177 LOC, 5 tests)
- `src/test/cartographic-layers-panel.test.tsx` (130 LOC, 6 tests)

### Modified
- `src/components/cartographic/cartographic-layers-panel.tsx` (49 → 89 LOC — fetch effect + live chips, dropped placeholder TODO)

## Pointers

- Phase 3 Slice E proof (prior): `docs/ops/2026-04-21-phase-3-slice-e-corridor-layer-proof.md`
- Phase 3 Slice A proof (where the live-counts TODO was first deferred): `docs/ops/2026-04-21-phase-3-slice-a-live-aoi-proof.md`
- Supabase head-count docs: `select("id", { count: "exact", head: true })` — returns count in response metadata with no row payload

## Next

Candidates, prioritized:

1. **Pan / fit-to-selection** — on click, `map.fitBounds()` the feature's bbox (jitter problem when list-row hover fires `setSelection` on every row is solvable with a single `ignoreHover` flag on the list-row path).
2. **Background-click-to-clear** — click on map background (not on a feature) clears the current selection. Low-stakes polish, bundles naturally with #1.
3. **Corridor authoring UI** — first editable surface for the cartographic system. Inspector-dock "Edit corridor" → draw mode on the backdrop → persist via `POST /api/map-features/corridors`. Bigger slice; would want its own plan.
4. **RTP cycle "pin on map" layer** — wire the `rtp` chip to a data source. Requires an editor call on how to geolocate an RTP cycle: anchor to the primary project's coords, or a new nullable `rtp_cycles.anchor_lat/lng` column. Mild schema slice.

Recommendation: **bundle #1 + #2 as Slice G** — both UX polish, both on the backdrop click surface, ~100 LOC. Defer corridor authoring to its own slice; defer RTP pin layer until someone asks for it.

No user-owned follow-ups — Slice F ships pure additions through the existing API surface, no migration, no seed change.
