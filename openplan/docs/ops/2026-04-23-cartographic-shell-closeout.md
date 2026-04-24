# Cartographic shell close-out

**Shipped:** 2026-04-23 Pacific
**Scope:** Close-out for the `directions/02-cartographic.html` implementation line: cartographic shell, selection loop, data-driven backdrop layers, live counts, legend, seeded NCTC proof data, and user-owned production smoke checklist.

## Outcome

The cartographic shell is now a real civic workbench surface: left rail, continuous worksurface, Mapbox backdrop, right layers panel, map legend, inspector dock, list-to-inspector preview, map-click selection, feature-state highlight, fit-to-selection, background click clear, and Escape clear.

The backdrop has six data-driven layers:

| Layer | Source | Geometry | Scope | Default | Status |
|---|---|---|---|---|---|
| Aerial missions | `aerial_missions.aoi_geojson` | Polygon | workspace | on | live + NCTC seeded |
| Projects | `projects.latitude` / `longitude` | Point | workspace | on | live + NCTC seeded |
| Study corridors | `project_corridors.geometry_geojson` | LineString | workspace | on | live + NCTC seeded |
| RTP cycles | `rtp_cycles.anchor_latitude` / `anchor_longitude` | Point | workspace | on | live + NCTC seeded |
| Equity priority | `census_tracts_map.geometry_geojson` | MultiPolygon | public data | off | live route + NCTC demo tracts |
| Community input | `engagement_items.latitude` / `longitude` via campaigns | Point | workspace via campaign | on | live + NCTC seeded |

The shell is ready for Nathaniel's browser smoke as the demo owner. No known map-shell mechanics remain from the design file; the remaining work is product/data expansion.

## Slice Ledger

K shipped as two proof entries, so the sequence below records the Phase 2 foundation plus the full Phase 3 A-L line:

| Slice | Proof | What it closed |
|---|---|---|
| Phase 2 | `2026-04-21-phase-2-cartographic-selection-aoi-proof.md` | Shell, rail/header/worksurface/backdrop/layers/inspector, selection context, wide surfaces, NCTC AOI seed |
| A | `2026-04-21-phase-3-slice-a-live-aoi-proof.md` | Live aerial AOI polygons |
| B | `2026-04-21-phase-3-slice-b-click-to-select-proof.md` | AOI click-to-inspector |
| C | `2026-04-21-phase-3-slice-c-feature-state-highlight-proof.md` | Feature-state selected highlight |
| D | `2026-04-21-phase-3-slice-d-project-markers-proof.md` | Project point markers |
| E | `2026-04-21-phase-3-slice-e-corridor-layer-proof.md` | Study corridor LineStrings |
| F | `2026-04-22-phase-3-slice-f-layers-panel-live-counts-proof.md` | Live layer counts route and chips |
| G | `2026-04-22-phase-3-slice-g-fit-and-background-click-proof.md` | Fit-to-selection and background-click clear |
| H | `2026-04-22-phase-3-slice-h-escape-to-clear-proof.md` | Escape-to-clear keyboard parity |
| I | `2026-04-22-phase-3-slice-i-rtp-pin-layer-proof.md` | RTP cycle pins |
| J | `2026-04-22-phase-3-slice-j-cartographic-map-legend-proof.md` | Toggle-reactive legend |
| K1 | `2026-04-22-phase-3-slice-k1-multipolygon-bbox-proof.md` | MultiPolygon bbox helper |
| K2 | `2026-04-22-phase-3-slice-k2-equity-choropleth-proof.md` | Census/equity choropleth |
| L | `2026-04-23-phase-3-slice-l-engagement-items-proof.md` | Approved engagement-item points |

## Final Palette

| Layer | Paint |
|---|---|
| Projects | `#1f6b5e` circle |
| Aerial AOIs | `#e45635` fill/outline |
| Corridors by LOS | A/B `#4a7a9e`; C/D `#c8962f`; E `#b45239`; F `#8a2e24`; fallback `#4a7a9e` |
| RTP cycles | `#6b4a9e` circle |
| Equity priority | null `#cccccc`; `<5%` `#d4e8e5`; `5-10%` `#8fb5b0`; `10-15%` `#4d847c`; `>15%` `#1f544c` |
| Community input | `#c24a7f` circle |

## Final Source Tuple

`cartographic-map-backdrop.tsx` now highlights across this tuple:

```ts
[
  AOI_SOURCE_ID,
  PROJECTS_SOURCE_ID,
  CORRIDORS_SOURCE_ID,
  RTP_CYCLES_SOURCE_ID,
  CENSUS_TRACTS_SOURCE_ID,
  ENGAGEMENT_SOURCE_ID,
]
```

The background-click pick list is the corresponding rendered-layer set:

```ts
[
  AOI_FILL_LAYER_ID,
  PROJECTS_CIRCLE_LAYER_ID,
  CORRIDORS_LINE_LAYER_ID,
  RTP_CYCLES_CIRCLE_LAYER_ID,
  CENSUS_TRACTS_FILL_LAYER_ID,
  ENGAGEMENT_CIRCLE_LAYER_ID,
]
```

## Production State

Live on `main`:

- All six map-feature routes: aerial missions, projects, corridors, RTP cycles, census tracts, engagement items.
- Counts route with six count keys: `projects`, `aerial`, `corridors`, `rtp`, `equity`, `engagement`.
- Layers panel chips for every live data-driven layer.
- Legend entries for every painted layer, with equity gated by its toggle.
- Inspector selections for all six data kinds.

Demo-seeded in prod:

- NCTC demo workspace and owner membership.
- NCTC project pin and RTP cycle anchor.
- Three aerial missions and three evidence packages.
- Two project corridors.
- Four public demo census tracts covering all equity bins.
- One engagement campaign and four approved engagement items.

User-owned smoke:

- Task 46 remains pending because it needs a browser signed in as `nctc-demo@openplan-demo.natford.example`.
- Checklist now includes project, RTP, AOI, corridor, equity, and engagement layers; engagement chip/count; rose circles; inspector `Open campaign`; cross-source highlight mutual exclusion; background click and Escape clear.

## Deferred

Deferred by design, not hidden inside the shell close-out:

- Live Census TIGER + ACS ingestion to replace hand-authored demo tracts.
- Engagement submission UI tied to the cartographic shell.
- Engagement moderation dashboard for public-input review.
- Tract primary action / downstream workflow beyond informational inspector and click-to-fit. K2 now exercises MultiPolygon fit-to-selection through census-tract clicks, but there is still no tract detail page or primary action.

These should be driven by customer pull, not by the shell mechanics.

## Handoff Posture

The cartographic shell is no longer the blocking demo surface. The next commercial-readiness work should move up the stack: billing/metering, provisioning/invites, multi-tenant isolation proof, and first-customer onboarding assets.
