# OpenPlan Nevada Near-Gate Scalar 0.37 Checkpoint

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Nevada is at the provisional gate boundary; one residual station exceeds threshold by 0.21 points

## Executive summary

A blanket overall-demand scalar of **0.37** brought the Nevada reusable screening runtime to the edge of the current provisional bounded screening gate.

Result:
- median APE: **27.52%**
- mean APE: **27.42%**
- min APE: **11.54%**
- max APE: **50.21%**
- Spearman rho: **0.7**
- matched stations: **5 / 5**
- status: **internal prototype only**

The run misses the current provisional gate only because:
- `SR 174 at Brunswick Rd` lands at **50.21%** APE,
- which is **0.21 percentage points above** the provisional critical-facility threshold of **50.00%**.

## Run
- `data/screening-runs/nevada-county-runtime-mainline-scalar037-20260324/`

## Facility results
- `SR 20 at Jct Rte 49`: observed **45,500**, modeled **32,912**, APE **27.67%**
- `SR 20 at Brunswick Rd`: observed **35,500**, modeled **31,404**, APE **11.54%**
- `SR 49 at South Grass Valley`: observed **26,000**, modeled **33,155**, APE **27.52%**
- `SR 20 at Penn Valley Dr`: observed **17,500**, modeled **21,028**, APE **20.16%**
- `SR 174 at Brunswick Rd`: observed **10,300**, modeled **15,472**, APE **50.21%**

## Interpretation

## A. Nevada is now in a bounded prototype regime
This is no longer a story about a broken runtime or an obviously unusable county lane.

At scalar `0.37`, the Nevada screening runtime:
- keeps all five validation points matched,
- keeps four of five facilities within the provisional critical-facility threshold,
- and holds the median error comfortably below the provisional 30% threshold.

## B. The remaining residual is extremely narrow
The entire provisional gate miss is now concentrated in one location and one very small amount:
- `SR 174 at Brunswick Rd`
- miss above threshold: **0.21 points**

## C. This justifies one final micro-step before localized corridor tuning
Because the residual is so small, it is reasonable to test one more near-identical scalar immediately adjacent to `0.37` before declaring that the remaining issue must be handled through corridor-specific refinement.

Current micro-step in progress:
- scalar **0.369**

## Safe internal language
- Nevada is now **near the provisional bounded screening gate** under a blanket scalar near **0.37**.
- Remaining miss is **concentrated and extremely small**.

## Unsafe language
Do **not** claim Nevada is now:
- validated,
- calibrated,
- production-ready,
- or safe for client-facing demand claims.

## Best next step
1. Check scalar `0.369`.  
2. If it clears SR 174 without materially degrading the other four sites, freeze a provisional Nevada-specific scalar.  
3. If it does not, retain `0.37` as the strongest near-gate prototype and move next into local SR 174 corridor tuning.

## Bottom line

The Nevada lane is now on the threshold of the provisional screening gate. The question is no longer whether the lane can be made directionally plausible. The question is whether a tiny final magnitude adjustment is enough, or whether the last fraction of error must be solved locally on the SR 174 corridor.
