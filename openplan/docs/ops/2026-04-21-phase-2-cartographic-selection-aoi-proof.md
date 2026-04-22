# Phase 2 — Cartographic selection wiring + AOI enrichment (2026-04-21)

## What shipped

Phase 1 mounted the D2 cartographic shell (rail / worksurface / inspector dock / Mapbox backdrop / layers panel) but the interaction loop was inert — hovering list rows didn't preview anything, detail pages still rendered at the narrow default width, the Mapbox backdrop defaulted to a null center, and no workspace data ever reached the map. Phase 2 wires that loop end-to-end and enriches the NCTC demo seed so Phase 3 Slice A has real polygons to render.

Phase 1 shell bits (the `cartographic/` component tree + `cartographic.css` + font/shell layout wiring) ship inside this proof doc's commit because they have no standalone proof doc — the shell existed but was dead.

### New cartographic components

| File | LOC | Role |
|---|---:|---|
| `src/components/cartographic/cartographic-shell.tsx` | 167 | Server-component shell. Resolves `loadCurrentWorkspaceMembership` + `resolveWorkspaceShellState`, mounts `CartographicProvider` around rail/header/backdrop/overview/layers/inspector. |
| `src/components/cartographic/cartographic-context.tsx` | 106 | React Context exposing `selection` + `layers` state. `useCartographic` is strict; `useCartographicSelection` + `useCartographicLayers` degrade to no-op hooks when no provider is mounted. |
| `src/components/cartographic/cartographic-map-backdrop.tsx` | 153 (before Phase 3A) | Mapbox GL JS v3.20 backdrop with theme-reactive style swap, suppression on `/explore` (which owns its own map). Default center **`[-121.033982, 39.239137]`** (Grass Valley — NCTC demo anchor). |
| `src/components/cartographic/cartographic-rail.tsx` | 113 | Left nav rail. |
| `src/components/cartographic/cartographic-header.tsx` | 73 | Top bar with server-action sign-out. |
| `src/components/cartographic/cartographic-overview-surface.tsx` | 37 | Default worksurface body. |
| `src/components/cartographic/cartographic-layers-panel.tsx` | 51 | Right-side layer toggles. Default-on: projects / rtp / corridors / aerial. Default-off: engagement / transit / crashes / equity. |
| `src/components/cartographic/cartographic-inspector-dock.tsx` | 87 | Inspector dock contract + type `CartographicInspectorSelection`. |
| `src/components/cartographic/cartographic-inspector-dock-connected.tsx` | 9 | Thin connector reading the current `selection` from context. |
| `src/components/cartographic/cartographic-selection-link.tsx` | 39 | `<Link>` wrapper: fires `setSelection(payload)` on `onMouseEnter`/`onFocus`/`onClick` so hovering a row previews the inspector without navigating. |
| `src/components/cartographic/cartographic-surface-wide.tsx` | 23 | Mount-only side effect setting `body[data-surface-wide="true"]` — collapses the layers-panel gap so wide tables / long-form docs get more horizontal room. |
| `src/app/cartographic.css` | 769 | Scoped design system (parchment tokens, warm-gradient accents, rhythm/spacing utilities). |

### Shell wiring

- `src/app/layout.tsx` — font + `<CartographicShell>` wiring at the root.
- `src/app/(app)/layout.tsx` — mounts the shell around all authenticated surfaces.

### List-page selection sweep (9 surfaces)

Replaced plain `<Link>` row links with `<CartographicSelectionLink>` so the inspector previews the hovered item:

- `src/app/(app)/projects/page.tsx`
- `src/app/(app)/plans/page.tsx`
- `src/app/(app)/programs/page.tsx`
- `src/app/(app)/scenarios/page.tsx`
- `src/app/(app)/models/page.tsx`
- `src/app/(app)/reports/page.tsx`
- `src/app/(app)/engagement/page.tsx`
- `src/app/(app)/rtp/_components/rtp-cycle-registry-table.tsx`
- `src/app/(app)/explore/page.tsx` (row cells where the explore registry surfaces previews)

### Detail-page wide-surface sweep (11 surfaces)

Each detail page mounts `<CartographicSurfaceWide />` as the first child so `body[data-surface-wide]` is set while the page is visible. Most pages take the single-line insert; `aerial/missions/[missionId]` needed fragment wrapping around its `<Worksurface>` owner component.

- `src/app/(app)/projects/[projectId]/page.tsx`
- `src/app/(app)/rtp/[rtpCycleId]/page.tsx`
- `src/app/(app)/rtp/[rtpCycleId]/document/page.tsx`
- `src/app/(app)/plans/[planId]/page.tsx`
- `src/app/(app)/programs/[programId]/page.tsx`
- `src/app/(app)/scenarios/[scenarioSetId]/page.tsx`
- `src/app/(app)/models/[modelId]/page.tsx`
- `src/app/(app)/reports/[reportId]/page.tsx`
- `src/app/(app)/engagement/[campaignId]/page.tsx`
- `src/app/(app)/data-hub/page.tsx`
- `src/app/(app)/aerial/missions/[missionId]/page.tsx`

### Grass Valley default center

`DEFAULT_CENTER = [-121.033982, 39.239137]` becomes the single source of truth for "no data, no project — where does the map sit?". Applied in:

- `src/components/cartographic/cartographic-map-backdrop.tsx:19`
- `src/components/engagement/location-display-map.tsx`
- `src/components/engagement/location-picker-map.tsx`
- `src/components/models/traffic-volume-map.tsx`

### AOI enrichment in the NCTC demo seed

`scripts/seed-nctc-demo.ts` gains **three hand-authored polygon constants** (10–11 vertices each, closed rings, scale ~1 mile):

- `DEMO_AOI_DOWNTOWN` — downtown Grass Valley (Mill/Main/South Auburn).
- `DEMO_AOI_SR49_ALTA_SIERRA` — SR-49 corridor, Grass Valley south to Alta Sierra.
- `DEMO_AOI_EMPIRE_MINE` — Empire Mine State Historic Park.

Plus two idempotent upsert loops against prod `aerial_missions` (3 rows tagged `aoi_capture` / `corridor_survey` / `corridor_survey` with `project_id = DEMO_PROJECT_ID`) and `evidence_packages` (3 rows tagged `ready` / `shared` / `qa_pending`). All three polygons pass `isAoiPolygonGeoJson` from `src/lib/aerial/dji-export.ts` at seed time.

Net change in `scripts/seed-nctc-demo.ts`: **+175 LOC**.

### New test

`src/test/nctc-demo-aoi-polygons.test.ts` — 6 tests: 3 `isAoiPolygonGeoJson` guards + 3 closed-ring asserts.

## Why this slice

The Phase 1 shell was a skeleton: every surface rendered under it but nothing from the shell's state reached the page, and nothing from a hovered row reached the shell. Phase 2 closes the loop. It's also a natural boundary for seed-data enrichment — Phase 3 Slice A lands on top of this and finally gets real polygons on the map.

## Gates

```bash
pnpm qa:gate
# → lint clean · 868 tests / 186 files pass · 0 audit advisories · Next build succeeds
pnpm test --run src/test/nctc-demo-aoi-polygons.test.ts
# → 6/6 pass
pnpm seed:nctc -- --env-file .env.production.local
# → live upsert against prod Supabase: workspace + project + rtp + chapter + 3 missions + 3 packages
```

## LOC rollup

```text
 106 src/components/cartographic/cartographic-context.tsx
 167 src/components/cartographic/cartographic-shell.tsx
 153 src/components/cartographic/cartographic-map-backdrop.tsx    (Phase 1 baseline; +111 in Phase 3A)
 113 src/components/cartographic/cartographic-rail.tsx
  87 src/components/cartographic/cartographic-inspector-dock.tsx
  73 src/components/cartographic/cartographic-header.tsx
  51 src/components/cartographic/cartographic-layers-panel.tsx
  39 src/components/cartographic/cartographic-selection-link.tsx
  37 src/components/cartographic/cartographic-overview-surface.tsx
  23 src/components/cartographic/cartographic-surface-wide.tsx
   9 src/components/cartographic/cartographic-inspector-dock-connected.tsx
 769 src/app/cartographic.css
+175 scripts/seed-nctc-demo.ts        (AOI + mission + package additions)
 +30 src/test/nctc-demo-aoi-polygons.test.ts
```

Page sweep diff (list + detail + shell wiring + root layout): +312 / −101 across 23 files.

## Not this slice

- **No live data on the backdrop yet.** That's Phase 3 Slice A (next commit).
- **No click-to-select from the map → inspector.** Proposed Slice B.
- **No inspector-dock live counts.** `cartographic-layers-panel.tsx` chip values (`14`, `2`, `6`, `3.8k`, `1`) remain NCTC-demo placeholders — TODO comment flagged.
- **No project markers.** Needs a lat/lng column on `projects` or geocode-on-read — future slice.

## Next

Phase 3 Slice A — render the seeded mission AOIs on the shell backdrop via a new `/api/map-features/aerial-missions` route + backdrop fetch/paint/visibility effects.

## Pointers

- Deep-dive scorecard + execution program: `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`
- Frontend constitution (civic workbench, not SaaS cards): `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`
- Phase 3 Slice A proof: `docs/ops/2026-04-21-phase-3-slice-a-live-aoi-proof.md`
