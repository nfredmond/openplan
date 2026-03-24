# Screening Validation Report

- Model run id: `nevada-county-runtime-mainline-scalar06-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar06-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar06-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- Median absolute percent error is 74.33%, above the 30.00% screening threshold.
- At least one core facility has 137.83% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **74.33%**
- Mean absolute percent error: **68.95%**
- Min absolute percent error: **12.78%**
- Max absolute percent error: **137.83%**
- Spearman rho (facility ranking): **0.9**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 51313 | 12.78% | matched |
| SR 20 at Brunswick Rd | 35500 | 43074 | 21.34% | matched |
| SR 49 at South Grass Valley | 26000 | 45326 | 74.33% | matched |
| SR 20 at Penn Valley Dr | 17500 | 34736 | 98.49% | matched |
| SR 174 at Brunswick Rd | 10300 | 24496 | 137.83% | matched |
