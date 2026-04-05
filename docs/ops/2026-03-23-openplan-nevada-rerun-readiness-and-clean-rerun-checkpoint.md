# OpenPlan Nevada rerun readiness + clean-source rerun checkpoint

Date: 2026-03-23
Owner: Dr. Adrian Velasco

## What was verified on this machine

The current workspace **does have enough local source-data and environment support to rerun the Nevada County pilot richer-demand lane**, with one important qualification:

- The reusable screening runtime in `scripts/modeling/` is still the generalized screening stack and **does not yet natively reproduce the Nevada pilot's richer LODES + external-trip + centroid-fix lane**.
- The Nevada pilot lane is currently reproducible through the pilot assets under `data/pilot-nevada-county/`, using the pilot virtual environment.

### Local environment status

Working environment:
- Python executable: `data/pilot-nevada-county/.venv/bin/python`
- Verified modules present in that venv:
  - `geopandas`
  - `numpy`
  - `pandas`
  - `aequilibrae`
  - `openmatrix`
  - `tables`

Important caveat:
- The repo/root Python environment is **not** the authoritative Nevada pilot runtime. Use the pilot `.venv` for Nevada rebuild/rerun work.

### Local source-data status

Confirmed present locally:
- Raw LODES OD: `data/pilot-nevada-county/ca_od_main_JT00_2021.csv.gz`
- Raw LODES WAC: `data/pilot-nevada-county/ca_wac_S000_JT00_2021.csv.gz`
- Synthetic population sidecars:
  - `data/pilot-nevada-county/synthetic_population/csv_hca.zip`
  - `data/pilot-nevada-county/synthetic_population/csv_pca.zip`
- Observed-count workbook: `data/pilot-nevada-county/caltrans_2023_aadt.xlsx`
- AequilibraE project DBs:
  - `data/pilot-nevada-county/aeq_project/project_database.sqlite`
  - `data/pilot-nevada-county/aeq_project/project_database_step5_seed.sqlite`

## Integrity correction made during this checkpoint

An initial rerun attempt reused the already-modified `project_database.sqlite`, which blurred the distinction between v2 and v3. That is not a clean baseline.

To correct that, the clean rerun lane now explicitly:
1. rebuilds package artifacts from raw local sources,
2. restores `project_database_step5_seed.sqlite` before step 4,
3. reruns step 4 from the clean seed,
4. reruns step 5 from that clean step-4 state,
5. hydrates full `loaded_links.geojson` sidecars for both runs, and
6. emits standardized validation bundles for both clean reruns.

## New durable scripts added

### 1) Clean richer-demand Nevada rerun wrapper
- `scripts/modeling/run_nevada_pilot_richer_lane.sh`

Purpose:
- Rebuilds package artifacts
- Restores the clean pre-step5 DB seed
- Runs clean v2 and clean v3 Nevada pilot reruns
- Hydrates geometry sidecars
- Produces standardized validation bundles

Run command:

```bash
scripts/modeling/run_nevada_pilot_richer_lane.sh
```

### 2) Legacy assignment geometry hydrator
- `scripts/modeling/hydrate_assignment_geometry.py`

Purpose:
- Reconstructs `loaded_links.geojson` / `top_loaded_links.geojson` for historical or pilot run folders from:
  - `link_volumes.csv`
  - matching `project_database.sqlite`

Example:

```bash
data/pilot-nevada-county/.venv/bin/python scripts/modeling/hydrate_assignment_geometry.py \
  --run-output-dir data/pilot-nevada-county/run_output_v2 \
  --project-db data/pilot-nevada-county/aeq_project/project_database_step5_seed.sqlite
```

## What was regenerated

### Package artifacts rebuilt from raw local inputs
- `data/pilot-nevada-county/package/network_links.geojson`
- `data/pilot-nevada-county/package/zones.geojson`
- `data/pilot-nevada-county/package/zone_centroids.geojson`
- `data/pilot-nevada-county/package/corridors.json`
- `data/pilot-nevada-county/package/manifest.json`
- `data/pilot-nevada-county/package/zone_attributes.csv`
- `data/pilot-nevada-county/package/od_trip_matrix.csv`

### Clean richer-demand rerun outputs regenerated
- `data/pilot-nevada-county/run_output_v2/*`
- `data/pilot-nevada-county/run_output_v3/*`

New/important sidecars now present:
- `data/pilot-nevada-county/run_output_v2/loaded_links.geojson`
- `data/pilot-nevada-county/run_output_v3/loaded_links.geojson`

### Standardized validation bundles generated
- `data/pilot-nevada-county/validation/rerun_clean_v2_from_seed/`
- `data/pilot-nevada-county/validation/rerun_clean_v3_from_seed/`

## Clean rerun results

### Clean v2 rerun from seed
Source bundle:
- `data/pilot-nevada-county/run_output_v2/`

Validation bundle:
- `data/pilot-nevada-county/validation/rerun_clean_v2_from_seed/validation_summary.json`

Key metrics:
- Median APE: **60.10%**
- Mean APE: **67.39%**
- Max APE: **94.77%**
- Spearman rho: **0.0**

Notable facility result:
- `SR 20 at Jct Rte 49` modeled **2,378** vs observed **45,500**

Interpretation:
- Clean step-4 richer demand improves on the original v1 prototype, but it is still well outside screening readiness thresholds and remains internal-only.

### Clean v3 rerun from seed
Source bundle:
- `data/pilot-nevada-county/run_output_v3/`

Validation bundle:
- `data/pilot-nevada-county/validation/rerun_clean_v3_from_seed/validation_summary.json`

Key metrics:
- Median APE: **59.52%**
- Mean APE: **55.09%**
- Max APE: **72.33%**
- Spearman rho: **0.8**

Notable facility result:
- `SR 20 at Jct Rte 49` modeled **13,390** vs observed **45,500**

Interpretation:
- The centroid-fix lane materially improves spatial ranking and the worst mismatch at the SR 20 / SR 49 core facility, but **still fails the screening gate**.

## Current readiness statement

Truthful current status:
- **A full clean Nevada richer-demand rerun did happen on this machine.**
- The lane is now materially more reproducible because the repo contains an explicit wrapper and geometry-hydration utility.
- The Nevada pilot remains **internal prototype only**.
- It is **not ready for external/model-readiness claims**.
- The generalized screening runtime still needs additional promotion work if we want the Nevada pilot's richer LODES/external/connector-repair behavior to live fully inside the reusable `scripts/modeling/` runtime rather than the pilot lane.

## Exact reproducible command

```bash
cd /home/nathaniel/.openclaw/workspace/openplan
scripts/modeling/run_nevada_pilot_richer_lane.sh
```

## Next recommended promotion step

If we continue this lane, the next methodologically honest target is:
1. promote the Nevada pilot's richer demand logic and connector/geometry handling into the reusable screening runtime in a way that preserves provenance and caveats, and
2. keep the clean-seed validation comparison so runtime promotion can be tested against the current clean v2/v3 reference bundles.
