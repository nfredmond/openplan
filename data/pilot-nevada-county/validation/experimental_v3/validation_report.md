# Screening Validation Report

- Model run id: `nevada-county-pilot-v3-centroid-fix`
- Model engine: `AequilibraE 1.6.1`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/run_output_v3/top_loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- Median absolute percent error is 59.52%, above the 30.00% screening threshold.
- At least one core facility has 72.33% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **59.52%**
- Mean absolute percent error: **55.09%**
- Min absolute percent error: **23.81%**
- Max absolute percent error: **72.33%**
- Spearman rho (facility ranking): **0.8**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 13390 | 70.57% | matched |
| SR 20 at Brunswick Rd | 35500 | 27046 | 23.81% | matched |
| SR 49 at South Grass Valley | 26000 | 7195 | 72.33% | matched |
| SR 20 at Penn Valley Dr | 17500 | 8890 | 49.2% | matched |
| SR 174 at Brunswick Rd | 10300 | 4169 | 59.52% | matched |
