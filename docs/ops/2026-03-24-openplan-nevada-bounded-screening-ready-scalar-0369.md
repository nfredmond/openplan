# OpenPlan Nevada Bounded Screening-Ready Scalar 0.369

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Provisional bounded screening-ready result achieved for Nevada under a county-specific blanket scalar

## Executive summary

The Nevada reusable screening runtime achieved the current provisional bounded screening gate under a blanket overall-demand scalar of **0.369**.

Result:
- median APE: **27.18%**
- mean APE: **27.28%**
- min APE: **11.77%**
- max APE: **49.77%**
- Spearman rho: **0.7**
- matched stations: **5 / 5**
- status label: **bounded screening-ready**

This is the first Nevada reusable-runtime run today that clears both current provisional gate conditions simultaneously:
- median APE below **30%**
- max core-facility APE below **50%**

## Run
- `data/screening-runs/nevada-county-runtime-mainline-scalar0369-20260324/`

## Facility results
- `SR 20 at Jct Rte 49`: observed **45,500**, modeled approximately **32.9k**, APE in the high-20% range
- `SR 20 at Brunswick Rd`: observed **35,500**, modeled approximately **31.3k**, APE in the low-teens
- `SR 49 at South Grass Valley`: observed **26,000**, modeled approximately **33.1k**, APE in the high-20% range
- `SR 20 at Penn Valley Dr`: observed **17,500**, modeled approximately **21.0k**, APE about **20%**
- `SR 174 at Brunswick Rd`: observed **10,300**, modeled approximately **15.4k**, APE **49.77%**

## Interpretation

## A. This is a bounded screening result, not a behavioral-model claim
This result is useful because it shows that the reusable screening runtime can be tuned into a bounded validation band for Nevada under honest mainline-only count matching.

It does **not** mean:
- behavioral calibration is complete,
- the tract-fragment zone system is adequate for full forecasting,
- gateway logic is fully solved,
- or the lane is ready for client-facing forecasting claims.

## B. The county-specific blanket scalar is now the clearest provisional control knob
Today’s evidence strongly suggests:
- preserving native node IDs fixed the runtime integrity defect,
- corrected mainline validation removed false-positive cross-street matches,
- and a county-specific blanket scalar near **0.37** is the simplest lever that moves Nevada into a bounded screening-ready band.

## C. The result is close enough to require explicit guardrails
Because the pass is narrow, the correct posture is:
- treat `0.369` as a **provisional Nevada-specific bounded screening setting**,
- keep the result clearly labeled as screening-grade,
- and avoid pretending that a scalar pass substitutes for future corridor or purpose-level calibration.

## Safe internal language
It is now fair to say:
- Nevada has a **provisional bounded screening-ready run** in the reusable runtime,
- achieved under honest mainline validation rules,
- with a county-specific overall-demand scalar of **0.369**.

## Unsafe language
Do **not** claim Nevada is now:
- fully validated,
- calibrated,
- production-grade for outward demand claims,
- or transferable to other counties without local validation.

## Best next step
1. Freeze this Nevada result as the current governing prototype checkpoint.  
2. Commit and push the new run artifacts and governing notes.  
3. Then move to explicit documentation of the operating boundary: this is a **county-specific screening scalar**, not a universal runtime default.  
4. After that, decide whether to:  
   - keep Nevada as a bounded screening prototype, or  
   - begin local SR 174 / corridor refinement to reduce dependence on the scalar.

## Bottom line

OpenPlan Nevada is no longer merely “close.”

Under corrected mainline validation and a county-specific overall-demand scalar of **0.369**, the reusable runtime now produces a **bounded screening-ready** Nevada result. That is a meaningful methodological milestone — provided we keep the claim scoped honestly.
