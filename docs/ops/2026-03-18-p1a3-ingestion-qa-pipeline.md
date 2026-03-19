# P1A.3: Ingestion + QA Pipeline — Technical Spec

**Date:** 2026-03-18  
**Author:** Bartholomew Hale (COO)  
**Status:** IMPLEMENTING

## Objective
Build a reliable prep path from raw network data into a usable model package. This supports the AequilibraE modeling backbone by ensuring network packages have validated, well-structured data before any model run consumes them.

## Ingestion Path

### Raw Import Flow
1. **Upload:** Planner uploads network files (GeoJSON nodes/links, optional transit GTFS, optional AequilibraE SQLite project) via the network package version API.
2. **Validate:** Server-side validation checks file format, required fields, and geometry validity.
3. **Store:** Valid files are stored in Supabase Storage under `network-packages/{workspace_id}/{package_id}/{version_id}/`.
4. **Register:** The `manifest_json` on the `network_package_versions` record is updated with file references and content hashes.
5. **QA:** Automated QA checks run and results are stored as a QA report on the version record.

### API Route
- `POST /api/network-packages/[packageId]/versions/[versionId]/ingest` — accepts multipart file upload, validates, stores, and runs QA checks.

## QA Checklist (automated)

### Network Structure
1. **Nodes file present:** At least one valid node with coordinates.
2. **Links file present:** At least one valid link referencing existing nodes.
3. **Node connectivity:** Flag isolated nodes with zero links.
4. **Link directionality:** Verify `is_oneway` or directional attributes are consistent.
5. **Geometry validity:** All features pass GeoJSON validity checks.

### Zone Integration (if zones attached)
6. **Zone coverage:** Warn if any zone centroid falls outside the network bounding box.
7. **Connector existence:** Warn if zones exist but no connectors are defined.

### Data Quality
8. **Missing attributes:** Flag links missing speed, capacity, or lane count.
9. **Duplicate detection:** Flag duplicate node IDs or overlapping link geometries.
10. **CRS consistency:** Verify all files use the same coordinate reference system.

## QA Report Schema

The QA report is stored as JSONB on `network_package_versions.qa_report_json`:

```json
{
  "run_at": "2026-03-18T17:00:00Z",
  "status": "pass" | "warn" | "fail",
  "checks": [
    {
      "name": "nodes_present",
      "status": "pass",
      "message": "Found 142 nodes."
    },
    {
      "name": "isolated_nodes",
      "status": "warn",
      "count": 3,
      "message": "3 nodes have zero connected links."
    }
  ],
  "summary": {
    "total_checks": 10,
    "passed": 8,
    "warnings": 1,
    "failures": 1
  }
}
```

## Database Changes
- Add `qa_report_json JSONB` column to `network_package_versions`.
- Add `file_hash TEXT` column to `network_package_versions` for content integrity verification.

## Common Failure Cases
1. **Wrong file format:** Upload is not valid GeoJSON or GTFS → reject with clear error.
2. **Missing required fields:** Nodes without coordinates, links without from/to → fail QA.
3. **Geometry errors:** Self-intersecting polygons, invalid coordinates → fail QA.
4. **Empty files:** Valid JSON but zero features → fail QA.
5. **CRS mismatch:** Mixed projections across files → warn QA.

## Acceptance Criteria
- [x] Raw import path identified (file upload → validate → store → register)
- [x] QA checklist defined (10 automated checks)
- [x] Common failure cases documented
- [ ] Pilot ingest test performed (deferred until real network data available)
