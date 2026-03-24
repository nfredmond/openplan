# OpenPlan Nevada Mainline Validation Reset and Demand Sensitivity

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Validation truth tightened; Nevada now appears tunable but still not gate-clear

## Why this note exists

The earlier same-day Nevada checkpoint improved dramatically after preserving node IDs, but that interim validation still contained a hidden truth problem: several count stations were matching to cross streets instead of the counted highway mainline because the station crosswalk definitions mixed mainline and cross-street names.

This note records the reset to a cleaner mainline-only validation posture and the first demand-magnitude sensitivity result under that stricter standard.

## 1. Validation integrity was tightened

### What was wrong
The Nevada station file had candidate names that allowed cross-street matches such as:
- `Brunswick Road` for SR 20 at Brunswick,
- `Penn Valley Drive` for SR 20 at Penn Valley,
- `Alta Sierra Drive` for SR 49 at South Grass Valley.

That could make the validator appear better than the model truly was because it could select a nearby crossing street rather than the counted state-route mainline.

### What changed
The validator was upgraded to support:
- `candidate_link_types`
- `exclude_model_names`
- richer candidate audit outputs

The Nevada station file was then tightened to force mainline-oriented matching:
- SR 20 at Jct Rte 49 → motorway / Golden Center Freeway lane
- SR 20 at Brunswick Rd → motorway / Golden Center Freeway lane, excluding Brunswick Road
- SR 20 at Penn Valley Dr → trunk / Eric Rood Memorial Expressway lane, excluding Penn Valley Drive and Rough and Ready Highway
- SR 49 at South Grass Valley → primary lane, excluding Alta Sierra Drive
- SR 174 at Brunswick Rd → secondary / Colfax Highway lane, excluding Brunswick Road

## 2. Mainline-only validation is materially harsher, but more honest

Re-validating the node-ID-preservation freeze run under the corrected mainline rules produced:
- median APE: **121.67%**
- mean APE: **142.35%**
- min APE: **61.9%**
- max APE: **237.62%**
- Spearman rho: **1.0**
- status: **internal prototype only**

### Interpretation
This is a better truth result than the earlier friendlier score.

It means the model was not merely overloading a few random links. Instead, it was:
- ordering the monitored Nevada facilities in the correct general hierarchy,
- but materially over-assigning the mainline system across the board.

That is a different and more actionable diagnosis.

## 3. First demand sensitivity result: overall demand scalar 0.5

To test whether the corrected mainline miss was mainly a route-choice problem or a magnitude problem, the reusable runtime was extended with:
- `--overall-demand-scalar`
- `--external-demand-scalar`

First sensitivity tested:
- run: `data/screening-runs/nevada-county-runtime-mainline-scalar05-20260324/`
- setting: `--overall-demand-scalar 0.5`

### Result
- median APE: **62.3%**
- mean APE: **49.58%**
- min APE: **7.62%**
- max APE: **102.42%**
- Spearman rho: **0.7**
- status: **internal prototype only**

### Facility-level pattern
- `SR 20 at Jct Rte 49`: observed **45,500**, modeled **42,032**, APE **7.62%**
- `SR 20 at Brunswick Rd`: observed **35,500**, modeled **38,910**, APE **9.61%**
- `SR 49 at South Grass Valley`: observed **26,000**, modeled **43,147**, APE **65.95%**
- `SR 20 at Penn Valley Dr`: observed **17,500**, modeled **28,402**, APE **62.3%**
- `SR 174 at Brunswick Rd`: observed **10,300**, modeled **20,849**, APE **102.42%**

## What this means

### A. The Nevada problem is no longer best described as a broken runtime
That was true earlier in the day when centroid loss was present.

After preserving node IDs, the runtime now appears internally coherent enough for real sensitivity work.

### B. The corrected mainline Nevada lane is still too hot, but not hopelessly so
The 0.5 demand scalar does **not** clear the gate, but it proves something important:
- the Nevada mainline validation responds strongly to demand magnitude,
- two major SR 20 stations fall into a credible prototype band immediately,
- and the remaining miss is concentrated in SR 49 South Grass Valley, SR 20 at Penn Valley, and especially SR 174 / Colfax Highway.

### C. The next likely lever is external/gateway pressure rather than another generic runtime surgery
Because a blanket demand cut helps meaningfully, the next best technical question is:
- how much of the remaining over-assignment is being driven specifically by inferred external gateways?

That makes `--external-demand-scalar` the correct next controlled test.

## Governing status

### Safe internal language
- Nevada reusable runtime is **methodologically cleaner today than this morning**.
- Mainline-only validation is **harsher but more truthful**.
- Demand sensitivity suggests the Nevada lane is **tunable**, not simply broken.

### Unsafe language
Do **not** claim Nevada is now:
- validated,
- screening-ready,
- ready for external/client claims,
- or calibrated.

## Best next step

1. Complete and inspect the Nevada `--external-demand-scalar 0.5` run.  
2. Compare whether SR 49 / SR 174 improve more than SR 20 under that setting.  
3. If yes, narrow the next change into gateway inference/rate logic instead of global trip generation.  
4. If no, focus next on internal non-home-based and discretionary demand rates by corridor context.

## Bottom line

Today’s most honest conclusion is now:
- preserving node IDs fixed a real runtime integrity defect,
- tightening mainline validation revealed that Nevada is still materially over-assigned,
- but a simple demand scalar cut improved the corrected mainline validation enough to show the problem is probably tunable rather than fundamentally unusable.
