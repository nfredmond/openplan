# OpenPlan Nevada Demand Scalar Bracket

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** First usable bracket identified; scalar 0.4 is the current best Nevada setting

## Why this note exists

After tightening Nevada validation to the highway mainlines, the reusable screening runtime still materially over-assigned the Nevada corridor system. The next question was whether a broad demand magnitude adjustment could move the county into a more plausible screening band.

This note records the first scalar bracket around that hypothesis.

## Tested settings

### Baseline corrected mainline validation
- run: `nevada-county-runtime-norenumber-freeze-20260324`
- interpretation: truthful mainline-only validation, no blanket demand cut
- result:
  - median APE: **121.67%**
  - max APE: **237.62%**
  - Spearman rho: **1.0**

### Blanket demand scalar 0.5
- run: `nevada-county-runtime-mainline-scalar05-20260324`
- result:
  - median APE: **62.3%**
  - max APE: **102.42%**
  - Spearman rho: **0.7**

### Blanket demand scalar 0.6
- run: `nevada-county-runtime-mainline-scalar06-20260324`
- result:
  - median APE: **74.33%**
  - max APE: **137.83%**
  - Spearman rho: **0.9**

### Blanket demand scalar 0.4
- run: `nevada-county-runtime-mainline-scalar04-20260324`
- result:
  - median APE: **27.68%**
  - mean APE: **32.85%**
  - min APE: **8.29%**
  - max APE: **58.54%**
  - Spearman rho: **0.7**

## Key facility comparison

### Scalar 0.4 (current best)
- `SR 20 at Jct Rte 49`: observed **45,500**, modeled **34,785**, APE **23.55%**
- `SR 20 at Brunswick Rd`: observed **35,500**, modeled **32,556**, APE **8.29%**
- `SR 49 at South Grass Valley`: observed **26,000**, modeled **38,006**, APE **46.18%**
- `SR 20 at Penn Valley Dr`: observed **17,500**, modeled **22,344**, APE **27.68%**
- `SR 174 at Brunswick Rd`: observed **10,300**, modeled **16,330**, APE **58.54%**

## Interpretation

## A. Nevada responds strongly to blanket demand magnitude
That is now clear.

A simple scalar reduction moves Nevada far more effectively than:
- cutting external demand alone, or
- selectively trimming HBO/NHB while leaving the total lane hotter.

## B. The current best provisional scalar is 0.4
Under the current corrected mainline validation rules, scalar `0.4` is the first setting that:
- brings the **median APE below the provisional 30% threshold**, and
- leaves only **one** major blocker above the provisional critical-facility threshold.

## C. The remaining red lane is now isolated
At scalar `0.4`, the only station still outside the provisional critical-facility threshold is:
- `SR 174 at Brunswick Rd` at **58.54%**

That means the Nevada problem has shifted from “countywide overassignment everywhere” to a narrower residual distortion focused on the SR 174 / Brunswick / Colfax Highway facility.

## Governing status

### Safe internal language
- The Nevada reusable runtime is now **very close to the provisional bounded screening gate** under a blanket demand scalar of `0.4`.
- The remaining miss is **concentrated and diagnosable**.

### Unsafe language
Do **not** claim Nevada is now:
- validated,
- fully screening-ready,
- calibrated,
- or client-safe for outward demand claims.

## Best next step

1. Test a narrow scalar refinement below `0.4` (currently `0.37` in progress).  
2. If that clears SR 174 without materially degrading the other four facilities, freeze a provisional Nevada-specific screening scalar.  
3. If not, keep `0.4` as the current best overall setting and move next into localized SR 174 corridor tuning.

## Bottom line

The Nevada lane is no longer wandering blindly.

Current evidence says:
- the reusable runtime is structurally healthier than it was earlier in the day,
- corrected mainline validation is now honest,
- and a blanket demand scalar of **0.4** is the first setting that gets Nevada close to the provisional screening gate with only a single major blocker left.
