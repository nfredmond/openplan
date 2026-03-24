# Screening Validation Report

- Model run id: `nevada-county-runtime-mainline-scalar04-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar04-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar04-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- At least one core facility has 58.54% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **27.68%**
- Mean absolute percent error: **32.85%**
- Min absolute percent error: **8.29%**
- Max absolute percent error: **58.54%**
- Spearman rho (facility ranking): **0.7**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 34785 | 23.55% | matched |
| SR 20 at Brunswick Rd | 35500 | 32556 | 8.29% | matched |
| SR 49 at South Grass Valley | 26000 | 38006 | 46.18% | matched |
| SR 20 at Penn Valley Dr | 17500 | 22344 | 27.68% | matched |
| SR 174 at Brunswick Rd | 10300 | 16330 | 58.54% | matched |
