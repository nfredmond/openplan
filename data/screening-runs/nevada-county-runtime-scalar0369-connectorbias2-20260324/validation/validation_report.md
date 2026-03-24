# Screening Validation Report

- Model run id: `nevada-county-runtime-scalar0369-connectorbias2-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-scalar0369-connectorbias2-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-scalar0369-connectorbias2-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **bounded screening-ready**

## Gate reasons
- Matched stations >= 3, median absolute percent error <= 30.00%, and no matched facility exceeds 50.00% absolute percent error.

## Metrics
- Median absolute percent error: **16.01%**
- Mean absolute percent error: **23.13%**
- Min absolute percent error: **9.3%**
- Max absolute percent error: **49.48%**
- Spearman rho (facility ranking): **1.0**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 32822 | 27.86% | matched |
| SR 20 at Brunswick Rd | 35500 | 30890 | 12.99% | matched |
| SR 49 at South Grass Valley | 26000 | 30162 | 16.01% | matched |
| SR 20 at Penn Valley Dr | 17500 | 19128 | 9.3% | matched |
| SR 174 at Brunswick Rd | 10300 | 15396 | 49.48% | matched |
