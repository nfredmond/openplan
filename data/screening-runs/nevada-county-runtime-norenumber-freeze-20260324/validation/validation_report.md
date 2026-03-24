# Screening Validation Report

- Model run id: `nevada-county-runtime-norenumber-freeze-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/run_output/loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/work/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- At least one core facility has 237.62% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **27.4%**
- Mean absolute percent error: **68.75%**
- Min absolute percent error: **4.1%**
- Max absolute percent error: **237.62%**
- Spearman rho (facility ranking): **0.4**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 73666 | 61.9% | matched |
| SR 20 at Brunswick Rd | 35500 | 30975 | 12.75% | matched |
| SR 49 at South Grass Valley | 26000 | 27067 | 4.1% | matched |
| SR 20 at Penn Valley Dr | 17500 | 12705 | 27.4% | matched |
| SR 174 at Brunswick Rd | 10300 | 34775 | 237.62% | matched |
