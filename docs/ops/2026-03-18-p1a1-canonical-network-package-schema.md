# P1A.1: Canonical Network Package Schema Technical Spec

**Date:** 2026-03-18  
**Author:** Iris Chen (Expert Developer Programmer)  
**Status:** ACTIVE SPECIFICATION  

## 1. Objective
Define how OpenPlan stores, versions, and retrieves canonical network bundles to support the multi-engine modeling stack (AequilibraE, ActivitySim, MATSim). This fulfills the requirement of **P1A.1** from the Modeling Stack Phase 1 plan.

## 2. Core Concepts

A **Network Package** is a bounded, version-controlled collection of transportation network data for a specific study area. Instead of storing raw edits over time in a scattered way, a network package acts as an immutable (or strictly versioned) snapshot that model runs can depend on.

### Key Objects
- **`network_packages`**: The top-level logical container for a network (e.g., "Nevada County 2025 Baseline").
- **`network_package_versions`**: Immutable specific versions of the network (e.g., v1.0, v1.1). A model run binds to a specific version, ensuring traceability and reproducibility.

## 3. Storage and Manifest Pattern

### Relational Schema (PostgreSQL/Supabase)

#### `network_packages`
- `id` (UUID)
- `workspace_id` (UUID, reference to workspaces)
- `name` (String, e.g., "Nevada County 2025 Baseline")
- `description` (Text)
- `region_code` or `geography_id` (String/UUID linking to the study area)
- `bbox` (PostGIS geometry or JSON array, representing the bounding box)
- `created_at` / `updated_at`

#### `network_package_versions`
- `id` (UUID)
- `package_id` (UUID, reference to network_packages)
- `version_name` (String, e.g., "v1.0.0" or "20260318-baseline")
- `manifest_json` (JSONB)
- `s3_prefix` or `storage_url` (String, path to the bundled files in object storage)
- `status` (String: "draft", "active", "archived")
- `created_at` / `updated_at`

### Storage Location
- The actual network files (nodes, links, transit lines, geometries) will be stored in an S3-compatible object storage bucket (e.g., Supabase Storage bucket `network-packages`).
- The files are organized under: `network-packages/{workspace_id}/{package_id}/{version_id}/`.

### Manifest Pattern (`manifest_json`)
The manifest describes the physical files included in this versioned bundle.
```json
{
  "crs": "EPSG:4326",
  "nodes_file": "nodes.geojson",
  "links_file": "links.geojson",
  "transit_file": "transit.zip",
  "aequilibrae_project_sqlite": "project.sqlite",
  "hash": "sha256-abcdef123456..."
}
```

## 4. Acceptance Criteria Met
- **network package spec documented**: Yes, defined via `network_packages` and `network_package_versions`.
- **version fields defined**: Handled by the `network_package_versions` table and `status` fields.
- **study area / geography linkage defined**: Maintained at the package level via `region_code` / `bbox`.
- **storage location and manifest pattern decided**: Object storage organized by workspace/package/version with a JSON manifest.
