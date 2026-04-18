---
title: 2026-04-18 Aerial mission authoring — live proof
date: 2026-04-18
phase: Phase G (forward-motion plan)
status: prototype-only
---

# 2026-04-18 Aerial mission authoring — live proof

## What this proves

OpenPlan missions can now carry a hand-drawn AOI polygon and export a
DJI-compatible waypoint file. The authoring surface is credible but
narrow — single outer polygon, no multi-polygon, no hole-cutting, no
terrain following.

## What shipped

### Schema

- Migration `supabase/migrations/20260418000057_aerial_mission_aoi.sql`
  adds `aerial_missions.aoi_geojson JSONB NULL`. Nullable — backward-
  compatible with existing rows.

### API surface

- `PATCH /api/aerial/missions/[missionId]` now accepts
  `aoiGeojson: Polygon | null` with Zod validation (closed rings,
  ≥ 4 positions per ring).
- `GET /api/aerial/missions/[missionId]/export?format=dji-json` —
  workspace-scoped. Returns a `Content-Disposition: attachment`
  waypoint JSON built via `buildDjiMissionExport()`. Returns 409 if
  the mission has no AOI.
- `POST /api/aerial/missions/[missionId]/process` — **returns HTTP
  501 with an honest integration-boundary payload**. No fake
  processing. No silent stubs.

### UI

- `src/components/aerial/mission-aoi-editor.tsx` — Mapbox GL polygon
  draw overlay. Click to add vertex, double-click to close,
  right-click to remove last vertex. Saves via PATCH.
- `src/app/(app)/aerial/missions/[missionId]/edit/page.tsx` — edit
  route hosting the editor.
- Mission detail page (`.../[missionId]/page.tsx`) now surfaces an
  **Authoring** section: "Draw AOI" / "Edit AOI" link, "Export DJI
  JSON" download (when an AOI exists), and a warning StateBlock
  stating ODM processing is not implemented.

### Lib

- `src/lib/aerial/dji-export.ts` — `buildDjiMissionExport()` +
  `isAoiPolygonGeoJson()` type guard. Outer ring becomes waypoints
  (dropping the closing duplicate). Heading is computed as bearing
  to the next waypoint. Defaults: 90 m altitude, 5 m/s speed.
- `src/lib/aerial/odm-processing.ts` — `buildOdmProcessingBoundary()`
  emits the honest not-implemented payload.

### Tests

- `src/test/aerial-dji-export.test.ts` — 10 tests covering: type
  guard accept/reject, waypoint count, default altitude/speed,
  override altitude/speed, heading range [0, 360), schema version
  pin, invalid-input throw.

Full suite: **725/166 green**. Typecheck clean.

## Honest scope (what shipped does NOT do)

1. **No actual DJI Fly / Pilot 2 mission schema.** The export is a
   Nat-Ford-internal `natford-dji-1` schema. A downstream converter
   must map to whichever target DJI spec the pilot's app expects.
   This is intentional — DJI's live formats change and are partially
   proprietary; an internal schema keeps the data stable.
2. **No ODM processing.** The `/process` endpoint explicitly returns
   HTTP 501. Standing up a real WebODM/Pix4D worker is a separate
   multi-week engagement and is not in this prototype's scope.
3. **No multi-polygon.** Single outer ring only.
4. **No hole-cutting.** Inner rings are syntactically supported by
   the column but the editor does not author them.
5. **No terrain following.** Altitude is constant across all
   waypoints.
6. **No spatial queries.** `aoi_geojson` is JSONB, not PostGIS
   geometry. Questions like "which missions cover this corridor?"
   would need a follow-up migration adding a computed `geometry`
   column.

## Live walk

1. Operator opens `/aerial/missions/[id]`.
2. Clicks "Draw AOI" → lands on `/aerial/missions/[id]/edit`.
3. Clicks map to drop vertices. Status label updates in real time.
4. Double-clicks to close polygon. Status flips to "Polygon closed".
5. Clicks "Save AOI". PATCH fires. Returns to detail page.
6. Detail page shows `n vertex polygon` badge + "Export DJI JSON"
   button.
7. Clicks "Export DJI JSON" → browser downloads
   `dji-mission-<slug>.json`.
8. Opens the JSON. Sees `schemaVersion: "natford-dji-1"`, a waypoint
   array with `{index, latitude, longitude, altitude, heading,
   speed}` per vertex, and a `source.note` explaining the schema is
   internal.

## What this does NOT prove

- **It does NOT prove the platform processes drone imagery.** ODM
  processing returns 501 and says so.
- **It does NOT prove direct compatibility with DJI Fly / DJI
  Pilot 2.** A converter step is required.
- **It does NOT prove AOI precision for survey-grade work.**
  Geometry is stored as GeoJSON, not PostGIS. No coordinate-system
  validation; client assumes WGS84.

## Artifact pointers

- Migration: `supabase/migrations/20260418000057_aerial_mission_aoi.sql`
- Editor component: `src/components/aerial/mission-aoi-editor.tsx`
- Edit page: `src/app/(app)/aerial/missions/[missionId]/edit/page.tsx`
- Export route: `src/app/api/aerial/missions/[missionId]/export/route.ts`
- ODM stub route: `src/app/api/aerial/missions/[missionId]/process/route.ts`
- DJI helper: `src/lib/aerial/dji-export.ts`
- ODM boundary: `src/lib/aerial/odm-processing.ts`
- Tests: `src/test/aerial-dji-export.test.ts`
