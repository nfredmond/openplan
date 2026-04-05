# OpenPlan Screening Validation Tooling Checkpoint

**Date:** 2026-03-23  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Practical checkpoint; validation tooling advanced, gate still not passed

## Why this checkpoint exists

The Nevada County lane already contained meaningful but fragmented modeling work:
- a legacy observed-count validation script (`data/pilot-nevada-county/step3_validate.py`),
- an experimental demand expansion run (`run_output_v2/` + `step4_demand_improvement.py`), and
- an experimental centroid-connector repair run (`run_output_v3/` + `step5_centroid_connector_fix.py`).

What was missing was a more reusable, data-driven validation path and a current durable note that reconciles those artifacts with the modeling status language.

## What I changed

### 1) Added a reusable screening validation CLI
Created:
- `scripts/modeling/validate_screening_observed_counts.py`

What it does:
- reads a screening run bundle (`link_volumes.csv`, `evidence_packet.json`, `loaded_links.geojson` or `top_loaded_links.geojson`),
- reads a CSV of observed count stations with candidate model link names and bounding boxes,
- optionally uses an explicit AequilibraE `project_database.sqlite` when the GeoJSON sample is incomplete,
- writes durable artifacts:
  - `validation_results.csv`
  - `validation_summary.json`
  - `validation_report.md`
- applies the existing gate logic directly:
  - minimum matched stations,
  - median APE threshold,
  - critical-facility APE threshold,
  - final label = `internal prototype only` or `bounded screening-ready`.

### 2) Converted the Nevada validation slice into data, not hardcoded script state
Created:
- `data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv`
- `data/templates/screening_validation_station_template.csv`

This turns the Grass Valley core validation slice into a reusable input pattern instead of a one-off script constant block.

### 3) Wrote fresh validation bundles for the Nevada pilot artifacts
Created:
- `data/pilot-nevada-county/validation/canonical_run/`
- `data/pilot-nevada-county/validation/experimental_v2/`
- `data/pilot-nevada-county/validation/experimental_v3/`

These folders contain standardized validation outputs from the reusable CLI.

### 4) Updated the modeling-status language note so it no longer implies counts are still missing
Updated:
- `docs/ops/2026-03-22-openplan-modeling-status-language-pack.md`

The recommended status does **not** change, but the reason is now current: validation exists locally and still does not pass the gate.

## What I found

## A. The repo is farther along than the 2026-03-22 docs implied
Observed counts are no longer missing locally.

The Nevada lane already has:
- a completed legacy v1 validation,
- a materially improved v2 demand experiment,
- and a v3 connector-repair experiment.

That means the modeling conversation should move from “do we have counts yet?” to “what exact improvements are required to turn the experimental gains into a reproducible, claim-safe run?”

## B. The experimental direction is real, but the lane still fails the screening-ready gate
### Historical canonical run (`run_output/`)
Use the legacy v1 validation files already in the repo as the governing historical comparison for the canonical run:
- `data/pilot-nevada-county/run_output/validation_summary.json`
- `data/pilot-nevada-county/run_output/validation_results.csv`

Those legacy artifacts show very poor fit:
- median APE ≈ **97.78%**
- Spearman rho ≈ **-0.9**

The reusable validator can only partially revalidate that historical bundle from `top_loaded_links.geojson` alone, because the exact frozen full-link geometry bundle is not preserved alongside the historical run. That is a run-freeze integrity issue, not a reason to discard the earlier result.

### Experimental demand expansion (`run_output_v2/`)
Standardized validation bundle:
- `data/pilot-nevada-county/validation/experimental_v2/validation_summary.json`

Key results:
- matched stations: **5 / 5**
- median APE: **60.10%**
- mean APE: **68.43%**
- Spearman rho: **0.0**
- gate: **internal prototype only**

Interpretation:
- demand scaling moved the lane materially in the right direction versus v1,
- but one core facility still collapses to zero modeled volume,
- and the error profile is still far outside the documented bounded-screening threshold.

### Experimental connector repair (`run_output_v3/`)
Standardized validation bundle:
- `data/pilot-nevada-county/validation/experimental_v3/validation_summary.json`

Key results:
- matched stations: **5 / 5**
- median APE: **59.52%**
- mean APE: **55.09%**
- min APE: **23.81%**
- max APE: **72.33%**
- Spearman rho: **0.8**
- gate: **internal prototype only**

Interpretation:
- this is the strongest Nevada result in the repo today,
- facility ordering is now directionally credible,
- at least one station is in a useful screening range,
- but the run still misses the documented gate because:
  - median APE is still ~60%, well above the <=30% threshold, and
  - at least one core facility still exceeds the ~50% critical-facility tolerance.

## C. The next blocker is now reproducibility + demand realism, not “missing counts”
The highest-value blocker has shifted.

### No longer the main blocker
- “We do not have observed counts locally.”

### Current blocker
- the improved experimental logic is not yet promoted into the reusable screening runtime,
- historical run bundles do not consistently preserve the exact geometry/DB context needed for perfect revalidation,
- and the best Nevada experimental result still does not satisfy the documented gate.

## Active transportation / multimodal review note
I did not find a materially advanced active transportation assignment lane in the current root modeling artifacts. The substantive executed work remains concentrated in:
- auto screening demand synthesis,
- AequilibraE assignment,
- skims,
- observed-count validation,
- and connector/debug experimentation.

That means the most practical next slice is still to stabilize the auto screening lane first, rather than to overstate bike/ped modeling readiness.

## Recommended next steps

### 1) Promote the v2/v3 logic into the reusable screening runtime
Specifically:
- external gateway demand injection,
- non-work demand layers beyond HBW,
- connector QA/repair checks,
- and run-bundle outputs that preserve validation-ready geometry.

### 2) Freeze validation-ready artifacts with every run
For future screening runs, keep enough of the run context to support exact revalidation later:
- `loaded_links.geojson` (not just `top_loaded_links.geojson`),
- the exact `project_database.sqlite` when feasible, or
- another explicit full-link geometry artifact keyed to the run.

### 3) Re-run Nevada from the promoted runtime, not from one-off pilot scripts
The next Nevada proof slice should be:
- one reproducible rerun from the reusable tooling,
- one validation bundle generated from the standardized CLI,
- one explicit gate decision.

### 4) Keep outward language locked down
Current status should remain:
- **internally:** `internal prototype only`
- **externally:** `not ready for outward modeling claims`

## Bottom line

The modeling lane did advance materially today, but in the right way:
- not by pretending the lane is already validated,
- but by converting scattered Nevada validation work into reusable tooling and durable artifacts.

The strongest Nevada experimental result in the repo is now clearly documented:
- **v3 improves ranking materially**,
- **v3 still does not pass the screening-ready gate**,
- and the honest next move is to productize the improvements into the reusable runtime and rerun cleanly.
