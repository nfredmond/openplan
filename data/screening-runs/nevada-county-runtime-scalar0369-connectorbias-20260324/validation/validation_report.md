# Screening Validation Report

- Model run id: `nevada-county-runtime-scalar0369-connectorbias-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-scalar0369-connectorbias-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-scalar0369-connectorbias-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- Median absolute percent error is 36.99%, above the 30.00% screening threshold.
- At least one core facility has 64.27% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **36.99%**
- Mean absolute percent error: **37.44%**
- Min absolute percent error: **16.72%**
- Max absolute percent error: **64.27%**
- Spearman rho (facility ranking): **0.7**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 28669 | 36.99% | matched |
| SR 20 at Brunswick Rd | 35500 | 25796 | 27.34% | matched |
| SR 49 at South Grass Valley | 26000 | 30348 | 16.72% | matched |
| SR 20 at Penn Valley Dr | 17500 | 24830 | 41.89% | matched |
| SR 174 at Brunswick Rd | 10300 | 16920 | 64.27% | matched |
