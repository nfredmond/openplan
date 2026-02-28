# GIS Pilot Data Hardening Checklist — OpenPlan v1

- **Updated (PT):** 2026-02-28 02:18
- **Owner:** Priya
- **Package Status:** In Progress

## 1) Canonical Layer Registry

| Layer | Current Source-of-Truth | Refresh | Schema Version | CRS | QA Risk | Status |
|---|---|---|---|---|---|---|
| Corridor centerlines | **Not yet canonicalized** (corridor boundary uploaded as GeoJSON polygon; no centerline derivation table yet) | ad hoc | n/a | WGS84 lon/lat inferred | Missing canonical centerline geometry for network-grade analytics | 🔶 Gap |
| Intersections / crossings | **Not yet implemented** as persistent layer | n/a | n/a | n/a | Cannot compute defensible crossing exposure by node | 🔶 Gap |
| Sidewalk / ADA frontage network | **Not yet implemented** | n/a | n/a | n/a | ADA continuity metric currently not layer-backed | 🔶 Gap |
| Curb use / loading zones | **Not yet implemented** | n/a | n/a | n/a | Curb conflict outputs cannot be auditable yet | 🔶 Gap |
| Transit stops + access | OSM Overpass pull at runtime (`transit.ts`) | live query per run | code-driven | WGS84 | External API variability; not snapshotted per run | 🟡 Partial |
| Collision / safety events | SWITRS local CSV (if configured) else FARS API / estimate (`crashes.ts`) | runtime | code-driven | WGS84 | Source fallback introduces confidence variance | 🟡 Partial |
| Speed / volume observation points | **Not yet implemented** | n/a | n/a | n/a | No observed operational baseline layer | 🔶 Gap |
| Parcel / frontage references | **Not yet implemented** | n/a | n/a | n/a | Frontage continuity claims are non-auditable | 🔶 Gap |

## 2) Schema + Geometry QA
- [x] Required fields present for existing runtime metrics payload in `/api/analysis`.
- [x] Data types/constraints enforced at API edge via `zod` for corridor geometry + workspace/query inputs.
- [ ] Null/blank critical fields tolerance policy documented for council outputs.
- [x] Geometry type checks present (`Polygon` / `MultiPolygon` only).
- [ ] Topology checks pass (gaps/overlaps/duplicates): not yet implemented for canonical layers.
- [ ] CRS harmonized: **explicit CRS enforcement not implemented** (assumes lon/lat WGS84 coordinates).

## 3) Integrity + Traceability
- [x] Source-to-derived lineage partially documented in source modules (`census.ts`, `transit.ts`, `crashes.ts`, `equity.ts`, `scoring.ts`).
- [ ] Last refresh timestamp persistently recorded by source layer in run output.
- [x] Known limitations logged (runtime API fallback behavior identified).
- [ ] “Safe for decision-support” status assigned by artifact class.

## 4) QA Pass Log (Kickoff)
### Checks executed
- `npm run test` → PASS (12 files / 40 tests)
- `npm run build` → PASS
- `npm run lint` → PASS with 1 warning (non-blocking)
- Sample corridor geometry read check (`demo-corridor-grass-valley.geojson`) → PASS (`Polygon`, bbox valid)

### Findings
1. OpenPlan currently supports **concept-level corridor analytics**, not full canonical GIS layer governance.
2. Multiple required pilot layers for council-grade defensibility are still absent as persisted GIS tables.
3. CRS/geometry validity beyond basic shape type is not yet hard-gated.

### Immediate remediation queue (P0/P1)
- **P0:** Add explicit CRS assertion + coordinate sanity bounds in corridor ingest.
- **P0:** Define and persist canonical pilot layer registry + data quality metadata table.
- **P1:** Add topology/validity checks for derived/ingested geometries.
- **P1:** Snapshot source timestamps + source IDs into run metadata for every output artifact.

## 5) Go / Hold recommendation
- **Internal pilot/demo analytics:** **GO with caveats** (concept-level only).
- **External council decision packet:** **HOLD** until canonical layer gaps + traceability controls above are closed.
