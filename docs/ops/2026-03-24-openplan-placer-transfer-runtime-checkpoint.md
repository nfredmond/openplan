# OpenPlan Placer Transfer Runtime Checkpoint

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Improved reusable screening runtime transferred successfully to a second county

## Why this note exists

Nevada proved that the reusable screening runtime could be pushed into a bounded screening-ready result under corrected mainline validation and a county-specific scalar. The next essential question was not more Nevada tuning. It was whether the improved runtime architecture could survive contact with a second real county.

This note records that first transfer test.

## Transfer test run
- run: `data/screening-runs/placer-county-runtime-connectorbias2-20260324/`
- geography: **Placer County, California** (`06061`)
- runtime posture:
  - preserved native/imported node IDs,
  - improved centroid connector selection using the softened distance-weighted road-class preference,
  - retained AequilibraE project for inspection,
  - no county-specific scalar tuning applied,
  - no local observed-count validation yet wired.

## What completed successfully

### 1. County build completed cleanly
- boundary source: county FIPS
- area: **1,502.236 sq mi**
- zones: **92**
- total population represented: **406,608**
- total households: **152,537**
- estimated jobs: **193,942**

### 2. Network and centroid attachment completed cleanly
- nodes before centroids: **95,050**
- links before centroids: **114,687**
- largest network component: **96.49%**
- centroid coverage in prepared graph: **100%**
- missing centroids in graph: **none**
- project retained successfully for further diagnostics

### 3. Skims and assignment completed cleanly
- reachable skim pairs: **8,372 / 8,372**
- average skim time: **32.68 min**
- max skim time: **123.03 min**
- total synthesized trips: **1,723,626.2**
- loaded links: **17,719**
- assignment converged to final gap **0.009867** within the current 0.01 target

## Why this matters

## A. The runtime improvements are not Nevada-only execution hacks
This is the most important transfer result.

The following improvements all held up in Placer on the first reusable run:
- preserve native/imported node IDs,
- integrated reusable validation/output bundle structure,
- dynamic graph field handling,
- centroid diagnostics,
- softened distance-weighted connector bias.

That means the runtime changes are at least **operationally portable** to a second county.

## B. This is still not a validation pass for Placer
Important constraint:
- Placer currently does **not** yet have a fully wired observed-count validation slice comparable to Nevada.

So this run proves:
- runtime portability,
- build stability,
- graph health,
- assignment viability,
- artifact reproducibility.

It does **not** yet prove:
- Placer bounded screening readiness,
- calibration,
- or cross-county validation generalization.

## C. The product implication is encouraging
For the long-term web goal, this is exactly the kind of result we need:
- user chooses geography,
- runtime builds zones + network + demand + skims + assignment,
- outputs are reproducible,
- and the workflow is not brittle to one county only.

Placer is the first evidence today that the improved runtime architecture is starting to behave like a reusable national screening engine instead of a Nevada-specific prototype.

## New blocker revealed by the transfer test
The next blocker is no longer “can the runtime run outside Nevada?”

The next blocker is:
- how quickly and cleanly can we stand up **validation-ready observed-count slices** for new counties,
- and how much of Nevada’s improvement will generalize once those local truth checks are in place.

## Best next step
1. Freeze this Placer runtime-transfer checkpoint.  
2. Standardize the count-ingest / station-definition workflow so a second county can be validated faster.  
3. Build a first Placer priority-count CSV using the now-improved station template / candidate-audit workflow.  
4. Then run Placer through the same truth gate Nevada just passed.

## Bottom line

Today’s second-county result is a real milestone even without Placer counts.

The improved OpenPlan screening runtime now:
- runs Nevada well,
- runs Placer cleanly,
- preserves centroid integrity,
- converges assignment,
- and emits durable artifacts.

That is the first concrete sign that the architecture is starting to move from a county-specific prototype toward a reusable geography-first national screening workflow.
