# Screening Validation Report

- Model run id: `nevada-county-runtime-mainline-scalar037-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar037-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar037-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- At least one core facility has 50.21% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **27.52%**
- Mean absolute percent error: **27.42%**
- Min absolute percent error: **11.54%**
- Max absolute percent error: **50.21%**
- Spearman rho (facility ranking): **0.7**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 32912 | 27.67% | matched |
| SR 20 at Brunswick Rd | 35500 | 31404 | 11.54% | matched |
| SR 49 at South Grass Valley | 26000 | 33155 | 27.52% | matched |
| SR 20 at Penn Valley Dr | 17500 | 21028 | 20.16% | matched |
| SR 174 at Brunswick Rd | 10300 | 15472 | 50.21% | matched |
