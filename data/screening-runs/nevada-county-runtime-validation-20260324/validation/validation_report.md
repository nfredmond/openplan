# Screening Validation Report

- Model run id: `nevada-county-runtime-validation-20260324`
- Model engine: `AequilibraE screening runtime`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/screening-runs/nevada-county-runtime-validation-20260324/run_output/loaded_links.geojson`
- Project DB: `None`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- Median absolute percent error is 90.52%, above the 30.00% screening threshold.
- At least one core facility has 99.64% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **90.52%**
- Mean absolute percent error: **80.09%**
- Min absolute percent error: **32.76%**
- Max absolute percent error: **99.64%**
- Spearman rho (facility ranking): **-0.7**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 162 | 99.64% | matched |
| SR 20 at Brunswick Rd | 35500 | 3366 | 90.52% | matched |
| SR 49 at South Grass Valley | 26000 | 4726 | 81.82% | matched |
| SR 20 at Penn Valley Dr | 17500 | 747 | 95.73% | matched |
| SR 174 at Brunswick Rd | 10300 | 6926 | 32.76% | matched |
