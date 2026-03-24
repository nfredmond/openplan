# Screening Validation Report

- Model run id: `nevada-county-runtime-mainline-scalar05-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar05-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-mainline-scalar05-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- Median absolute percent error is 62.30%, above the 30.00% screening threshold.
- At least one core facility has 102.42% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **62.3%**
- Mean absolute percent error: **49.58%**
- Min absolute percent error: **7.62%**
- Max absolute percent error: **102.42%**
- Spearman rho (facility ranking): **0.7**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 42032 | 7.62% | matched |
| SR 20 at Brunswick Rd | 35500 | 38910 | 9.61% | matched |
| SR 49 at South Grass Valley | 26000 | 43147 | 65.95% | matched |
| SR 20 at Penn Valley Dr | 17500 | 28402 | 62.3% | matched |
| SR 174 at Brunswick Rd | 10300 | 20849 | 102.42% | matched |
