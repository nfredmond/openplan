# OpenPlan Nevada Runtime Validation Rerun Checkpoint

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Reusable runtime advanced; Nevada screening gate still fails materially

## Why this checkpoint exists

Yesterday's Nevada note identified the correct next move: stop relying on one-off pilot scripts alone, wire observed-count validation directly into the reusable screening runtime, and run one clean Nevada rerun from that reusable lane.

This checkpoint records that work.

## What changed today

### 1) Observed-count validation is now integrated into the reusable screening runtime
Updated runtime/tooling:
- `scripts/modeling/run_screening_model.py`
- `scripts/modeling/screening_runtime.py`
- `scripts/modeling/validate_screening_observed_counts.py`
- `scripts/modeling/screening_bundle.py`

What changed functionally:
- the reusable runtime can now accept `--counts-csv` and emit a standardized validation bundle during the run,
- the validator is now callable as a library function instead of only as a sidecar CLI,
- bundle manifests now carry validation artifacts and top-line validation status,
- the screening evidence packet now includes an explicit `run_id`.

### 2) A real reusable-runtime bug was found and fixed during the Nevada rerun
The first clean Nevada rerun failed because the assignment code hard-coded `capacity_ab` as the capacity field even though the prepared graph does not always expose that field under that exact name.

The runtime now selects the usable prepared-graph capacity field dynamically instead of assuming a single column name.

That matters because this was not just a cosmetic fix: the bug would have caused false confidence about runtime readiness if it stayed hidden.

## Clean Nevada rerun produced from the reusable runtime
Run folder:
- `data/screening-runs/nevada-county-runtime-validation-20260324/`

Primary artifacts:
- `run_summary.json`
- `bundle_manifest.json`
- `run_output/evidence_packet.json`
- `validation/validation_results.csv`
- `validation/validation_summary.json`
- `validation/validation_report.md`

Invocation basis:
- reusable runtime
- county FIPS boundary: `06057`
- observed counts: `data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`

## What the clean rerun proves

### Runtime execution proof
The reusable runtime can now:
- build a Nevada screening bundle,
- run assignment,
- emit durable output artifacts,
- and immediately generate a standardized observed-count validation bundle.

That is real productization progress.

### Nevada validation result
The Nevada rerun is **not** screening-ready.

Top-line results from `validation/validation_summary.json`:
- matched stations: **5 / 5**
- gate status: **internal prototype only**
- median absolute percent error: **90.52%**
- mean absolute percent error: **80.09%**
- min absolute percent error: **32.76%**
- max absolute percent error: **99.64%**
- Spearman rho (facility ranking): **-0.7**

### Facility-level pattern
- `SR 20 at Jct Rte 49`: observed **45,500**, modeled **162**, APE **99.64%**
- `SR 20 at Brunswick Rd`: observed **35,500**, modeled **3,366**, APE **90.52%**
- `SR 49 at South Grass Valley`: observed **26,000**, modeled **4,726**, APE **81.82%**
- `SR 20 at Penn Valley Dr`: observed **17,500**, modeled **747**, APE **95.73%**
- `SR 174 at Brunswick Rd`: observed **10,300**, modeled **6,926**, APE **32.76%**

## Interpretation

## A. The reusable runtime is now more operationally honest
This is a good result in one important sense: the runtime is now capable of proving its own failure against observed counts instead of leaving validation as an optional afterthought.

That is exactly what we want from a decision-useful modeling lane.

## B. The generic Nevada runtime is materially worse than the stronger Nevada experimental pilot branch
Yesterday's best documented Nevada experimental result (`run_output_v3`) remained:
- median APE: **59.52%**
- max APE: **72.33%**
- Spearman rho: **0.8**

By contrast, today's clean reusable-runtime rerun landed at:
- median APE: **90.52%**
- max APE: **99.64%**
- Spearman rho: **-0.7**

That means the current reusable runtime has **not yet absorbed the specific Nevada salvage logic that made the v3 experimental lane directionally more credible**.

## C. The main remaining blocker is now clearly runtime realism, not packaging/validation plumbing
The new bottleneck is not:
- missing observed counts,
- inability to generate validation artifacts,
- or inability to execute the reusable lane.

The new bottleneck is:
- unrealistic generic connector attachment and/or gateway allocation behavior for Nevada,
- insufficient preservation of the Nevada-specific improvements proven in the better experimental path,
- and a generic runtime that still collapses key SR 20 facilities even while total demand is high.

## D. Early diagnostic signal: several Nevada centroids are still effectively falling out of the prepared graph
The reusable Nevada rerun emitted AequilibraE warnings that these centroid nodes were not present in the prepared graph:
- `24722, 24723, 24724, 24725, 24727, 24728, 24731, 24732, 24741`

Crosswalk from `work/network_setup_summary.json` maps those to zone IDs:
- **5, 6, 7, 8, 10, 11, 14, 15, 24**

Those include several core western Nevada / Grass Valley-area tracts plus one Truckee-area tract:
- Tract **1.07** (`zone_id 5`)
- Tract **2** (`zone_id 6`)
- Tract **3** (`zone_id 7`)
- Tract **4.01** (`zone_id 8`)
- Tract **4.04** (`zone_id 10`)
- Tract **5.02** (`zone_id 11`)
- Tract **6.01** (`zone_id 14`)
- Tract **6.02** (`zone_id 15`)
- Tract **12.09** (`zone_id 24`)

That does not by itself fully explain the poor validation fit, but it is a strong signal that the next Nevada-improving slice should include explicit centroid-attachment diagnostics instead of treating this as demand-generation only.

## Governing status language after this rerun

### Internal status
- **internal prototype only**

### External/client-safe status
- **not ready for outward modeling claims**

### Explicitly unsupported claims
Do **not** claim that the reusable runtime Nevada lane is:
- validated,
- calibration-ready,
- bounded screening-ready,
- or directionally reliable on Grass Valley/SR 20 facilities.

## Best next step

The best next technical step is **not** another blind rerun.

It is to promote the specific Nevada-improving logic into the reusable runtime, then rerun cleanly again. In practice, that means:

1. **Connector realism pass**
   - inspect centroid attachment behavior for the Grass Valley core and SR 20 / SR 49 facilities,
   - determine why the reusable runtime still leaves critical Nevada centroids directionally disconnected from the main corridor loading pattern,
   - port the successful parts of the step-5 connector repair logic into a reusable QA/repair rule.

2. **Gateway plausibility pass**
   - review automatic gateway detection/allocation, especially the current I-80-heavy injections,
   - prevent gateway volumes from inflating total demand while still starving the observed SR 20 screenline locations.

3. **Rerun only after those changes are promoted**
   - one clean Nevada rerun from the reusable runtime,
   - one validation bundle,
   - one explicit gate decision.

## Bottom line

Today's work was still the correct move.

We materially improved the reusable modeling lane by:
- integrating validation into the runtime itself,
- surfacing and fixing a real assignment-field bug,
- and producing a clean Nevada rerun with durable artifacts.

But the Nevada result is also clear:
- **the reusable runtime runs,**
- **the reusable runtime validates,**
- **and the reusable runtime still fails the Nevada screening gate badly.**

That is progress in truth, not in theater.
