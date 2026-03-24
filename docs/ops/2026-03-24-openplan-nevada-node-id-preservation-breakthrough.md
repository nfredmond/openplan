# OpenPlan Nevada Node-ID Preservation Breakthrough

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Major Nevada screening-runtime improvement confirmed; still not yet gate-clear

## Executive summary

Today's diagnostic sequence found a decisive runtime problem and a decisive improvement.

### What changed
The reusable screening runtime previously performed a manual node renumbering pass after injecting centroid connectors.

That renumbering logic was producing an internal centroid/link mismatch severe enough to drop multiple Nevada centroids out of the prepared graph. After removing that manual renumbering and preserving the OSM/AequilibraE node IDs, the Nevada reusable-runtime run improved materially.

### What improved
Nevada reusable-runtime results changed from:
- **median APE = 90.52%**
- **Spearman rho = -0.7**
- **9 centroids missing from graph**
- status: **internal prototype only**

To:
- **median APE = 27.4%**
- **Spearman rho = 0.4**
- **0 centroids missing from graph**
- status: **still internal prototype only**

This is not final validation, but it is a real methodological breakthrough in the reusable runtime.

## Diagnostic sequence

## 1. Stable failure under the renumbered runtime
The reusable-runtime Nevada diagnostic run with retained project files showed:
- missing centroids in graph: `24722, 24723, 24724, 24725, 24727, 24728, 24731, 24732, 24741`
- validation remained poor:
  - median APE: **90.52%**
  - max APE: **99.64%**
  - Spearman rho: **-0.7**

Connector diagnostics also showed that the failing zones were still attaching to nodes in the largest component, which meant the problem was **not simply fallback attachment to isolated fragments**.

## 2. Root cause signal
Direct database inspection of the retained project showed an internal inconsistency:
- centroid nodes in `nodes` existed at the expected remapped IDs,
- but several centroid connector links were pointing to different non-centroid node IDs,
- which explained why those centroids later disappeared from the prepared graph.

That made the manual post-import node renumbering pass the prime suspect.

## 3. Node-ID preservation rerun
The runtime was then changed to **preserve imported node IDs** instead of renumbering nodes after centroid injection.

Clean Nevada rerun:
- `data/screening-runs/nevada-county-runtime-norenumber-20260324/`

## Confirmed result after preserving node IDs

### Graph integrity
- missing centroids in graph: **none**
- graph centroid coverage: **100%**
- reachable skim pairs: **650 / 650**

### Validation result
- matched stations: **5 / 5**
- median APE: **27.4%**
- mean APE: **68.75%**
- min APE: **4.1%**
- max APE: **237.62%**
- Spearman rho: **0.4**
- gate status: **internal prototype only**

## Facility-level results after preserving node IDs
- `SR 20 at Jct Rte 49`: observed **45,500**, modeled **73,666**, APE **61.9%**
- `SR 20 at Brunswick Rd`: observed **35,500**, modeled **30,975**, APE **12.75%**
- `SR 49 at South Grass Valley`: observed **26,000**, modeled **27,067**, APE **4.1%**
- `SR 20 at Penn Valley Dr`: observed **17,500**, modeled **12,705**, APE **27.4%**
- `SR 174 at Brunswick Rd`: observed **10,300**, modeled **34,775**, APE **237.62%**

## Interpretation

## A. The reusable runtime was being materially damaged by manual node renumbering
This is now the clearest conclusion from the day's work.

The prior Nevada failure pattern was not just “generic screening is weak.” The runtime itself was introducing a graph-integrity problem through manual renumbering after centroid injection.

Preserving native/imported node IDs eliminated the missing-centroid issue and substantially improved the reusable-runtime result.

## B. Nevada is now directionally much more plausible, but still not release-ready
The new result is genuinely better:
- median error is now below the provisional 30% screening threshold,
- SR 20 at Brunswick and SR 49 South Grass Valley are now directionally credible,
- SR 20 at Penn Valley is within a tolerable prototype band.

But the run still fails the gate because:
- `SR 20 at Jct Rte 49` is still high at **61.9%**,
- `SR 174 at Brunswick Rd` is severely overassigned at **237.62%**,
- ranking fit is only modest (`rho = 0.4`).

## C. The next blocker is no longer centroid loss; it is corridor allocation realism
Now that centroid coverage is complete, the remaining Nevada issues look more like:
- corridor competition / route-choice distortion around Grass Valley,
- possible over-allocation to the SR 174 / Colfax Highway facility,
- and likely remaining gateway / connector realism issues near the western Nevada core.

## Governing status after this breakthrough

### Internal status
- **bounded prototype with real progress**

### External/client-safe status
- **still not ready for outward validation claims**

### Safe claim now allowed internally
It is now fair to say:
- the reusable runtime can produce a Nevada run with full centroid graph coverage,
- integrated validation works,
- and preserving native node IDs materially improves screening plausibility.

### Claims still not allowed
Do **not** claim that Nevada is now:
- validated,
- calibration-ready,
- deployment-ready,
- or suitable for client-facing demand claims.

## Best next step

The next best technical step is **not** another generic rebuild from scratch.

It is to diagnose and tame the remaining over-assignment around:
- `SR 174 at Brunswick Rd`
- `SR 20 at Jct Rte 49`

Recommended next slice:
1. inspect top-loaded links and connector neighborhoods around the Brunswick / SR 174 / SR 20 cluster,
2. test whether gateway injections or connector competition are pushing too much flow onto Colfax Highway,
3. refine the reusable runtime only after that causal pattern is explicit.

## Bottom line

Today produced a genuine reusable-runtime breakthrough.

The important truth is now this:
- **the earlier Nevada reusable-runtime failure was materially worsened by manual node renumbering,**
- **preserving node IDs removed the centroid-loss defect,**
- **and Nevada now looks substantially more plausible, though still not yet screening-gate ready.**
