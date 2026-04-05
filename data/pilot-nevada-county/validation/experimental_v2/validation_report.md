# Screening Validation Report

- Model run id: `nevada-county-pilot-v2-nhts-expansion`
- Model engine: `AequilibraE 1.6.1`
- Count source CSV: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- Geometry source: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/run_output_v2/top_loaded_links.geojson`
- Project DB: `/home/nathaniel/.openclaw/workspace/openplan/data/pilot-nevada-county/aeq_project/project_database.sqlite`
- Matched stations: **5 / 5**
- Gate status: **internal prototype only**

## Gate reasons
- Median absolute percent error is 60.10%, above the 30.00% screening threshold.
- At least one core facility has 100.00% absolute percent error, above the 50.00% critical-facility threshold.

## Metrics
- Median absolute percent error: **60.1%**
- Mean absolute percent error: **68.43%**
- Min absolute percent error: **52.21%**
- Max absolute percent error: **100.0%**
- Spearman rho (facility ranking): **0.0**

## Matched facilities

| Station | Observed | Modeled | APE | Match |
|---|---:|---:|---:|---|
| SR 20 at Jct Rte 49 | 45500 | 0 | 100.0% | matched |
| SR 20 at Brunswick Rd | 35500 | 16964 | 52.21% | matched |
| SR 49 at South Grass Valley | 26000 | 7469 | 71.27% | matched |
| SR 20 at Penn Valley Dr | 17500 | 6983 | 60.1% | matched |
| SR 174 at Brunswick Rd | 10300 | 4265 | 58.59% | matched |
