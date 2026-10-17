# Source custody and pending decisions

This packet reads the assigned worktree after its authorized local fast-forward.
It does not copy ROOT's preparation, earlier acceptance captures, frozen studies
or another lane's proof. Private evidence resides only in the NEW directory
`/home/nathaniel/.local/state/openplan/public-designation-wrapped-viewport-preparation-20261016`.
`binding.json` retains the T3 thread/run/worktree identity and reasoning limit.
`source-sha256.txt` pins the selected current working bytes. These hashes bind
source review, not an executed build.

## Current local sources

Application paths below are relative to the repository root.

- `openplan/src/components/land-use-plans/public-designation-map.tsx:28-37,65-72`:
  clipping, missing-bounds fallback, generation increment and invalid early
  return. The stored extent still uses the strict reader and frames separately.
- `openplan/src/lib/geo/wgs84-bounds.ts:31-92`: finite tuple validation,
  strict canonical stored extent, zero-area viewport refusal and point helper.
- `openplan/src/lib/land-use-plans/public-map.ts:35-116`: frozen designation,
  ready/version/hash/workspace checks, exact projection, old RPC, safe count
  validation, all-or-nothing cap and public-field output filtering.
- `openplan/src/app/api/public/land-use-plans/[planId]/map/[designationId]/route.ts`:
  published packet, direct Number conversion, 404/503 distinctions.
- `openplan/src/app/api/public/land-use-plan-reviews/[shareToken]/map/[designationId]/route.ts`:
  token format, public review packet, direct Number conversion and status mapping.
- `openplan/src/app/api/reports/[reportId]/land-use-map/[designationId]/route.ts`:
  blank-part refusal before auth, report/member access, artifact metadata,
  historical frozen snapshot, session-scoped map read and private no-store reply.
- `openplan/src/lib/land-use-plans/public.ts:49-147`:
  adopted/published pointer, review release token/withdrawal filter, frozen
  identity and hash checks. `report-snapshot.ts` owns the historical report path.
- `openplan/src/lib/supabase/server.ts:25-58`: session versus service clients.
  No environment values are read or recorded by this lane.
- `openplan/supabase/migrations/20260812000016_workspace_gis_features.sql:24-120,222-272`:
  feature identity, WGS84 storage constraint, indexes, member RLS, table grants,
  original RPC, one matched/count relation, sentinel and function grants.
- `openplan/supabase/migrations/20260812000015_workspace_gis_layers.sql:425-440`:
  version read membership policy. The migration search finds no later
  `workspace_gis_features_in_bbox` definition or grant outside migration 16.
- `openplan/src/app/api/map-features/workspace-gis/[layerId]/route.ts`:
  old strict viewport caller. Its parser uses `Number.parseFloat`; this lane
  does not change that separate route or claim it has the public parser grammar.
- `openplan/src/lib/workspace-gis/coverage.ts:28-54`:
  shared draw cap and PostgREST response-size relationship.
- `openplan/src/lib/maps/map-engine.ts`:
  Mapbox token precedence, operator-style MapLibre fallback, common typed API,
  lazy loading, worker URL and construction failure handling.
- The existing test and frozen-access sources identified in `TEST_PLAN.md`
  are inspected as text only.

No package-local Mapbox or MapLibre source directory is present at
`openplan/node_modules/mapbox-gl` or `openplan/node_modules/maplibre-gl` in this
new worktree. This is a directory observation, not an installation attempt.
`package-lock.json` resolves Mapbox GL 3.20.0 and MapLibre GL 6.13.0. The package
manifest uses corresponding caret ranges; the lockfile pins the reviewed
versions and package integrity strings. Nothing is imported, installed or loaded.

## Exact tagged official source is documentation evidence

The official source URLs below are read through the web documentation tool as
plaintext. The private `sdk-source-excerpts.txt` records the versions, selected
short excerpts, findings and uncertainty. Its SHA-256 pins that captured excerpt
file, not the full upstream files, a release archive or installed dependency.

- [Mapbox 3.20.0 map.ts](https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v3.20.0/src/ui/map.ts):
  `getBounds` returns the transform bounds and its return type permits null.
- [Mapbox 3.20.0 lng_lat.ts](https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v3.20.0/src/geo/lng_lat.ts):
  bounds documentation permits longitudes beyond ±180 with world copies.
  West/east accessors return stored values; extending bounds takes minima/maxima.
- [Mapbox 3.20.0 transform.ts](https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v3.20.0/src/geo/transform.ts):
  Mercator/equirectangular use rectangular corner bounds. Other projections use
  a different path; globe pole visibility can produce full longitude coverage.
- [MapLibre 6.13.0 map.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/v6.13.0/src/ui/map.ts):
  `getBounds` delegates to the camera transform and returns `LngLatBounds`.
- [MapLibre 6.13.0 lng_lat_bounds.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/v6.13.0/src/geo/lng_lat_bounds.ts):
  west/east accessors return stored values. Extension uses minima/maxima.
  `adjustAntiMeridian` adds 360 to the east of a reversed canonical box.
- [MapLibre 6.13.0 mercator_transform.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/v6.13.0/src/geo/projection/mercator_transform.ts):
  `getBounds` extends four screen-corner locations into a bounds object.

This establishes why independent clipping is not a valid generic treatment of
the SDK bounds contract. The rectangular implementations assemble ordered
world-copy bounds, rather than requiring canonical west > east output. Support
for explicit canonical crossing input is a separate defensive query contract.
No code is evaluated to show that a particular current camera emits any example.
No exact installed bundle, globe/terrain projection journey, WebGL operation or
provider behavior is claimed. ROOT's unversioned documentation handoff remains
conditional documentation evidence, distinct from these tagged source reads.

The initial Mapbox bounds filename lookup returns a web internal error, followed
by a raw-source 404. Reading the actual import resolves its definition to
`lng_lat.ts`. These discovery errors are retained in private `read-errors.txt`.
They are not SDK runtime or application failures. The same file retains the two
mistaken local path lookups and output-truncation limits.

## Product direction does not change

Read the current applicable AGENTS.md, planner-writing, any-place, prove-it,
Supabase and Postgres skill entries. Read the relevant Postgres privilege/RLS
references. Runtime actions suggested by skills remain subject to ROOT's
explicit source-only hold. No CLI help, query, changelog-driven implementation,
advisor or native verification runs here.

Reassess the current contract's nationwide requirements, the sole roadmap M1
row, the October 6 direction review, matrix land-use/GIS/organization/geography
cells, KI-025 and architecture geography/permissions/map-provider boundaries.
Their dated inventories remain dated. This correction does not promote a cell,
resolve legal applicability, alter authority, or complete M1/full v1. Matrix
territory depth remains explicitly unassessed rather than inferred from states.

## Decisions ROOT must settle before authoring

1. Approve or revise the dedicated-RPC recommendation. Replacing/overloading the
   old RPC remains a possible broader contract change, not a chosen migration.
2. Confirm symmetric ±180 seam-edge inclusion. This packet recommends it and
   describes the internal seam-only envelope terms required to achieve it.
3. Set the raw camera magnitude guard. MAX_SAFE_INTEGER is a refusal ceiling,
   not a sub-degree precision guarantee at extreme world-copy offsets. A
   smaller explicit ceiling may be preferable, with the unavailable-view notice.
4. Grant a finite actual CLI generation window before assigning any migration
   path. Then grant application/SQL authoring and focused tests as separate work.

No unresolved choice authorizes a fallback that sums capped RPC replies, changes
stored extents, defaults unreadable bounds to the world or treats failure as zero.
