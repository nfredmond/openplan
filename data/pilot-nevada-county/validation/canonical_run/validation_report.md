# Screening Validation Report

- Model run id: `1de72401-4bb7-4377-a1c0-bbb7381a8f95`
- Model engine: `AequilibraE 1.6.1`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/run_output/top_loaded_links.geojson`
- Project DB: `None`
- Matched stations: **2 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- Only 2 matched stations; at least 3 are required for a bounded screening-ready decision.
- Median absolute percent error is 100.00%, above the 30.00% screening threshold.
- At least one core facility has 100.00% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **100.0%**
- Mean absolute percent error: **100.0%**
- Min absolute percent error: **100.0%**
- Max absolute percent error: **100.0%**
- Spearman rho (facility ranking): **1.0**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 0 | 100.0% | matched |
| SR 20 at Brunswick Rd | 35500 |  |  | model_miss |
| SR 49 at South Grass Valley | 26000 |  |  | model_miss |
| SR 20 at Penn Valley Dr | 17500 |  |  | model_miss |
| SR 174 at Brunswick Rd | 10300 | 0 | 100.0% | matched |
