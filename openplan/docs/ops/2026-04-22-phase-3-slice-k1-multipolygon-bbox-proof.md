# Phase 3 Slice K1 — MultiPolygon bbox in `fitInstructionFromGeometry`

**Date:** 2026-04-22
**Parent:** Phase 3 cartographic shell (Slices A–J shipped 2026-04-21 → 2026-04-22)
**Status:** shipped locally, tests 978/200 → 981/200 (+3 tests / +0 files), `pnpm qa:gate` clean.

## Goal

Extend the pan/fit helper `fitInstructionFromGeometry` to handle GeoJSON `MultiPolygon` geometries. Closes the acknowledged gap from Slice G (the pan/fit-to-selection slice, 2026-04-22) where MultiPolygon returned `null` — meaning any future layer that emits MultiPolygon (e.g. census tracts, multi-parcel project footprints) would click-select but not pan/fit.

## Why this slice, not "full equity choropleth"

Initial recommendation in the Slice J proof was Slice K = equity / census-tract choropleth layer. That recommendation assumed `census_tracts` was populated. It isn't — production has **zero** rows in `census_tracts` (checked with a service-role count against `aggphdqkanxsfzzoxlbk`), including zero Nevada County tracts (FIPS 06057).

A "full equity slice" would actually be two slices bundled:
1. A data-pipeline slice (TIGER boundary ingestion + ACS attribute join + choropleth-worthy field computation).
2. A UI slice (fifth data-driven layer, first attribute-keyed paint expression, first vertical-ramp legend entry).

Bundling those into one commit hides the data-sourcing decision (live Census API pull vs. pre-processed GeoJSON upload vs. hand-authored demo-only tracts) inside an implementation slice. That's a scope decision the user should make explicitly, not one I should quietly absorb.

So: split. **K1** (this slice) — extend the helper. Small, real, low-risk, closes an acknowledged gap, unblocks any future MultiPolygon-emitting layer (equity choropleth being one of many candidates — multi-parcel projects, multi-county plans, aerial mosaic tile groups, etc.). **K2** (future) — real equity layer, which gets its own scope conversation.

## What shipped

### 1. `fitInstructionFromGeometry` handles MultiPolygon

`src/lib/cartographic/geometry-bbox.ts` adds a `MultiPolygon` branch after the existing `Polygon` branch. The implementation mirrors the pattern from the API route that emits AOIs: iterate each polygon's outer ring, compute its bbox via `bboxFromPositions`, then union each polygon's bbox into a running accumulator using the existing `expand` primitive.

Defensive posture matches the rest of the helper:
- `coordinates` not an array → `null`.
- Malformed polygon (non-array, or outer ring non-array) → **skipped**, not fatal.
- Malformed position *inside* an outer ring → skipped by `bboxFromPositions`.
- All polygons malformed / empty array → `null` (unionless).
- **Interior rings (polygon holes) are ignored** for bbox math. A hole cannot extend a feature's envelope, so including it would either be a no-op or wrong if the hole's vertices somehow exceeded the outer ring (malformed GeoJSON, but still).

### 2. Header comment updated

The file comment bumps "three GeoJSON primitive shapes" → "four", and now names MultiPolygon explicitly. MultiLineString and GeometryCollection are still called out as rejected.

### 3. Tests

`src/test/geometry-bbox.test.ts` gains three new MultiPolygon positive cases and tightens the unsupported-types assertion:

- **Bbox union across a MultiPolygon** — two polygons (one with an interior hole, which is ignored), expected bbox is the envelope of both outer rings.
- **Empty MultiPolygon returns null** — `coordinates: []` → `null`, matching the existing LineString-with-no-valid-positions contract.
- **Skips malformed polygons inside a MultiPolygon without throwing** — one valid polygon between two malformed ones (a string and a `[[[1]]]` shape with no finite lng/lat pair), expected bbox is only the valid polygon's envelope.
- **Unsupported types now explicitly asserts MultiLineString returns null** — previously the block tested GeometryCollection; MultiLineString was untested. MultiPolygon was the only MultiX geometry worth adding, so naming MultiLineString as the remaining rejected one is the smallest change that keeps the contract unambiguous.

Net: 6 test functions → 9 test functions in the describe block (three new positive MultiPolygon cases; one existing assertion enriched but not forked into its own test).

## Gates

- Lint: clean
- `pnpm audit --prod --audit-level=moderate`: 0 advisories
- `pnpm test`: 200 files / 981 tests passing (was 200 / 978)
- `pnpm build`: 65 routes (no new routes; pure helper), compile success

## Files shipped

### Modified
- `src/lib/cartographic/geometry-bbox.ts` (78 → 97 LOC — +1 branch, header comment bump)
- `src/test/geometry-bbox.test.ts` (110 → 186 LOC — +3 positive MultiPolygon tests, +1 MultiLineString-null assertion in the unsupported-types block, replacing the single pre-existing MultiPolygon-null assertion)

### Added
_None._

## Pointers

- Phase 3 Slice G proof (where MultiPolygon was flagged as deferred): `docs/ops/2026-04-22-phase-3-slice-g-fit-and-background-click-proof.md`
- Phase 3 Slice J proof (previous slice; originally recommended K = equity choropleth): `docs/ops/2026-04-22-phase-3-slice-j-cartographic-map-legend-proof.md`
- Helper consumers: currently only the backdrop click handlers in `src/components/cartographic/cartographic-map-backdrop.tsx` (three layer-scoped click paths: AOI / project / corridor). No consumer emits MultiPolygon today, so this slice is a capability, not a behavior change.

## Next

Two directions, picking one is a scope decision:

1. **Slice K2 — real equity choropleth layer.** Fifth data-driven layer. Needs a data-sourcing decision first:
   - **Option A:** Live Census TIGER + ACS pull via the existing Supabase Edge Functions pattern (closest to the "free, open-source, replicates Replica" mission — every deployment ingests its own boundaries). Slower ingestion, but honest.
   - **Option B:** Pre-processed GeoJSON checked into the repo (fastest to ship; obviously not tenable at national scale but fine for an NCTC-demo proof).
   - **Option C:** Hand-authored Nevada County tracts in the seed script, matching the Slice A AOI / Slice E corridor pattern (smallest delta; but now three layers use hand-authored demo data and only one uses real ingestion, which pushes the "demo is real" posture in a bad direction).

   I'd lean Option A, but it's a bigger slice (Edge Function + ACS column selection + RLS re-confirm + import schema decision on the 9K+ California tract payload). Worth its own plan document before ship.

2. **Slice I/J follow-up — revalidate layers-panel counts on create.** Slice F's known gap. Once corridor or RTP authoring UI lands, a server-side revalidation or client-side refetch on mutation would close this.

Recommendation: **hold until user picks K2 data-sourcing or requests a different direction.** K1 doesn't block anything else — the helper is a capability, and its lack of consumers today is fine.

No user-owned follow-ups — Slice K1 ships pure helper additions, no migration, no seed change, no new routes.
