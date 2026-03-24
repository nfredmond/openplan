# OpenPlan Nevada Connector-Bias Breakthrough

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Stronger bounded screening-ready Nevada result achieved through a structurally better connector rule

## Executive summary

A second-generation centroid connector heuristic materially improved the Nevada reusable screening runtime while preserving the county-specific bounded screening-ready pass.

New best documented Nevada result:
- run: `data/screening-runs/nevada-county-runtime-scalar0369-connectorbias2-20260324/`
- status label: **`bounded screening-ready`**
- median APE: **16.01%**
- mean APE: **23.13%**
- min APE: **9.3%**
- max APE: **49.48%**
- Spearman rho: **1.0**
- matched stations: **5 / 5**

This is materially better than the earlier Nevada scalar-only bounded pass at `0.369`.

## Why this mattered

Earlier same-day retained diagnostics showed that several hot Grass Valley-area centroids were entering the network through very local streets near the Golden Center / Eric Rood / Colfax knot. That suggested the reusable runtime still needed a better centroid-attachment rule, not just a scalar.

## What was tested

### Baseline winning scalar pass
- `nevada-county-runtime-mainline-scalar0369-20260324`
- bounded screening-ready
- median APE: **27.18%**
- max APE: **49.77%**

### Connector bias v1
A hard preference for stronger adjacent road classes was tested first.

Result:
- `nevada-county-runtime-scalar0369-connectorbias-20260324`
- dropped back to **internal prototype only**
- median APE: **36.99%**
- max APE: **64.27%**

Interpretation:
- the idea was directionally sensible,
- but the rule was too aggressive and over-shifted network entry.

### Connector bias v2 (winning version)
The heuristic was softened into a **distance-weighted road-class preference**:
- stronger roads are preferred when they are nearby enough to be believable,
- but very close local streets can still win when the higher-class alternative is too far away.

Result:
- `nevada-county-runtime-scalar0369-connectorbias2-20260324`
- **bounded screening-ready**
- median APE: **16.01%**
- max APE: **49.48%**
- Spearman rho: **1.0**

## Facility results
- `SR 20 at Jct Rte 49`: observed **45,500**, modeled **32,822**, APE **27.86%**
- `SR 20 at Brunswick Rd`: observed **35,500**, modeled **30,890**, APE **12.99%**
- `SR 49 at South Grass Valley`: observed **26,000**, modeled **30,162**, APE **16.01%**
- `SR 20 at Penn Valley Dr`: observed **17,500**, modeled **19,128**, APE **9.3%**
- `SR 174 at Brunswick Rd`: observed **10,300**, modeled **15,396**, APE **49.48%**

## Interpretation

## A. This is better than a scalar-only story
The important truth is not merely that Nevada can be forced into the gate with a blanket scalar.

The stronger truth is that the reusable runtime now performs better when centroid attachment uses a more realistic, distance-sensitive preference for stronger nearby road classes.

That is exactly the kind of improvement that matters for the long-term “choose any geography” goal.

## B. The winning rule is nuanced, not blunt
The hard-bias connector rule failed.
The softened distance-weighted rule succeeded.

That is methodologically important because it suggests the runtime should not treat road class as an absolute priority. Instead, it should weigh:
- road class,
- proximity,
- and local plausibility together.

## C. Nevada is now stronger both numerically and structurally
Compared with the earlier scalar-only bounded pass:
- median APE improved from **27.18%** to **16.01%**
- mean APE improved from **27.28%** to **23.13%**
- max APE improved from **49.77%** to **49.48%**
- ranking fit improved from **0.7** to **1.0**

This is not just a tiny numeric gain. It is evidence that a reusable runtime rule improved the Nevada fit in a conceptually sensible way.

## Guardrail
This is still:
- Nevada-specific,
- screening-grade,
- uncalibrated,
- not behavioral demand,
- and not a transferable client-safe forecasting claim.

The new connector rule is promising, but it should still be treated as an improved screening-runtime heuristic, not as proof of universal generalization.

## Best next step
1. Freeze this as the current best Nevada checkpoint.  
2. Commit and push the improved runtime heuristic plus the new diagnostic run.  
3. Then decide whether to test the softened connector rule on a second county to see whether the structural gain generalizes beyond Nevada.  

## Bottom line

This is one of the most meaningful modeling improvements of the day.

OpenPlan Nevada is no longer just bounded screening-ready under a county-specific scalar. It is now **more strongly bounded screening-ready under a smarter reusable connector heuristic**, which is much closer to the actual long-term product vision.
