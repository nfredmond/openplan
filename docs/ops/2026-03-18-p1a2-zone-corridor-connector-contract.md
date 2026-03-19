# P1A.2: Zone / Corridor / Connector Contract — Technical Spec

**Date:** 2026-03-18  
**Author:** Bartholomew Hale (COO) + Iris Chen  
**Status:** IMPLEMENTING

## Objective
Standardize how zones and corridors attach to network packages, enabling the AequilibraE modeling backbone to consume structured geographic inputs for assignment and accessibility analysis.

## Core Concepts

### Zones
A **zone** represents a geographic unit (TAZ, census tract, custom area) that serves as an origin/destination in modeling. Zones attach to a specific network package version so model runs can resolve OD pairs against the correct network.

### Corridors
A **corridor** is a linear geographic feature (route, road segment, transit line) used for thematic overlays, assignment extraction, and reporting. Corridors attach to network packages and can be used across multiple model runs.

### Connectors
A **connector** is the logical link between a zone centroid and the physical network. Connectors define how demand loads onto the network from each zone. The centroid/connector strategy is critical for assignment quality.

## Database Schema

### `network_zones`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `package_version_id` | UUID | FK to `network_package_versions` |
| `zone_id_external` | TEXT | External zone identifier (e.g., TAZ ID, FIPS) |
| `zone_type` | TEXT | `taz`, `census_tract`, `custom` |
| `name` | TEXT | Human-readable label |
| `centroid_lat` | FLOAT | Centroid latitude |
| `centroid_lng` | FLOAT | Centroid longitude |
| `geometry_geojson` | JSONB | Zone boundary as GeoJSON |
| `properties` | JSONB | Extensible metadata (population, employment, land use) |
| `created_at` | TIMESTAMPTZ | Auto |

### `network_corridors`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `package_version_id` | UUID | FK to `network_package_versions` |
| `corridor_name` | TEXT | Human-readable label |
| `corridor_type` | TEXT | `highway`, `arterial`, `transit`, `bike`, `custom` |
| `geometry_geojson` | JSONB | LineString or MultiLineString GeoJSON |
| `direction` | TEXT | `both`, `northbound`, `southbound`, etc. |
| `properties` | JSONB | Extensible metadata (speed limit, capacity, lanes) |
| `created_at` | TIMESTAMPTZ | Auto |

### `network_connectors`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `zone_id` | UUID | FK to `network_zones` |
| `package_version_id` | UUID | FK to `network_package_versions` |
| `target_node_id` | TEXT | Network node the connector attaches to |
| `connector_type` | TEXT | `auto`, `transit`, `walk`, `bike` |
| `impedance_minutes` | FLOAT | Travel time penalty for the connector |
| `geometry_geojson` | JSONB | LineString from centroid to network node |
| `created_at` | TIMESTAMPTZ | Auto |

## Centroid/Connector Strategy
1. Each zone has exactly one centroid point (derived from geometry or manually placed).
2. Connectors link the centroid to one or more nearby network nodes.
3. Default: auto-generate connectors to the N nearest nodes (configurable, default N=3).
4. Mode-specific connectors allow different loading points for auto vs. transit vs. active modes.
5. Connector impedance represents the access/egress penalty and should be calibrated per study area.

## Corridor Geometry Rules
1. Corridors must be valid LineString or MultiLineString GeoJSON.
2. Corridors should be snapped to or derived from the underlying network links where possible.
3. A corridor can span multiple links and intersections.
4. Direction is optional; `both` is the default for bidirectional facilities.
5. Corridors are reusable across model runs within the same network package version.

## QA Checks
1. **Zone completeness:** Every zone must have a valid centroid (lat/lng or derived from geometry).
2. **Connector coverage:** Every zone should have at least one connector per active mode.
3. **Geometry validity:** All GeoJSON geometries must pass `ST_IsValid` equivalent checks.
4. **Orphan detection:** Flag zones with no connectors or connectors pointing to non-existent network nodes.
5. **Duplicate detection:** Flag zones with duplicate `zone_id_external` within the same package version.
6. **Corridor snapping:** Warn if corridor geometry deviates >50m from any network link.

## RLS Policy
All three tables inherit workspace isolation through the `network_package_versions` → `network_packages` → `workspace_id` chain. SELECT/INSERT/UPDATE/DELETE policies enforce that users can only access zones/corridors/connectors belonging to network packages in their workspace.
