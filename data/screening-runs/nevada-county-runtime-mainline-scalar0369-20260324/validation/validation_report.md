# Screening Validation Report

- Model run id: `nevada-county-runtime-mainline-scalar0369-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar0369-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar0369-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **bounded screening-ready**

## Gate reasons
- Matched stations >= 3, median absolute percent error <= 30.00%, and no matched facility exceeds 50.00% absolute percent error.

## Metrics
- Median absolute percent error: **27.18%**
- Mean absolute percent error: **27.28%**
- Min absolute percent error: **11.77%**
- Max absolute percent error: **49.77%**
- Spearman rho (facility ranking): **0.7**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 32827 | 27.85% | matched |
| SR 20 at Brunswick Rd | 35500 | 31323 | 11.77% | matched |
| SR 49 at South Grass Valley | 26000 | 33066 | 27.18% | matched |
| SR 20 at Penn Valley Dr | 17500 | 20968 | 19.82% | matched |
| SR 174 at Brunswick Rd | 10300 | 15426 | 49.77% | matched |
