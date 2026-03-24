# OpenPlan County Validation Onboarding Workflow

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Standardize how a new county moves from auto-built screening run to truth-gated validation slice

## Why this workflow exists

Nevada and Placer established two important facts on the same day:

1. the reusable screening runtime can now run real counties cleanly with preserved node IDs and improved centroid connector logic, and  
2. the next scaling bottleneck is no longer basic runtime execution — it is how quickly a county can be brought into an honest observed-count validation workflow.

This workflow standardizes that county-onboarding path.

## Scope
This workflow is for **screening-grade county onboarding** only.

It does **not** establish:
- behavioral calibration,
- forecast readiness,
- client-safe outward modeling claims,
- or universal transferability of any county-specific scalar or tuning choice.

## Standard workflow

## Step 1 — Run the reusable screening runtime
Input:
- geography selection (typically county FIPS or explicit boundary)

Expected outputs:
- boundary package
- zone package
- demand matrix
- skim matrix
- assignment results
- evidence packet

Required checks:
- county build completes cleanly
- assignment converges to target gap
- centroid coverage is complete or any missing centroids are explicitly diagnosed
- project can be retained when deeper diagnostics are needed

## Step 2 — Freeze the runtime-transfer checkpoint
Before doing validation work, document:
- county size / zones / population represented
- network health
- skim reachability
- assignment convergence
- key caveats

Why:
- separates “runtime ran” from “runtime validated”
- prevents later confusion about what exactly was proven at each stage

## Step 3 — Generate a first-pass validation scaffold
Preferred bootstrap path:
- `scripts/modeling/bootstrap_county_validation_onramp.py`
- can either build a new county run or attach to an existing completed run via `--existing-run-dir`
- can emit a JSON manifest for orchestration/backends via `--output-manifest`

Direct scaffold-generation helper:
- `scripts/modeling/generate_validation_scaffold.py`

Outputs:
- starter scaffold CSV
- markdown review packet

Purpose:
- identify strong candidate mainline facilities from the completed run
- propose initial station IDs, facility names, candidate link types, and bounding boxes

Guardrail:
- scaffold rows are **not** validation evidence
- they are only starter definitions pending real observed counts

## Step 4 — Source observed counts
Fill the scaffold with:
- actual observed volumes
- count year
- count type
- source agency
- source description / count location / postmile metadata as available

Priority rule:
- prefer a small number of strategically strong facilities first
- do not attempt exhaustive countywide count ingestion before proving the workflow on a core slice

## Step 5 — Tighten station definitions before formal interpretation
For each starter station:
- confirm the intended counted mainline facility
- keep the bbox tight
- add `candidate_link_types`
- add `exclude_model_names` when ramps, frontage roads, or cross streets could contaminate the match

Nevada lesson:
- if cross-street contamination is not blocked early, the first “good” validation result may be misleading

## Step 6 — Run the validator
Use:
- `scripts/modeling/validate_screening_observed_counts.py`

Required outputs:
- validation results CSV
- validation summary JSON
- validation report markdown
- candidate audit JSON / CSV

Purpose:
- compute screening metrics honestly
- preserve the full candidate match evidence per station
- allow station-definition cleanup when ambiguity exists

## Step 7 — Distinguish validation truth from model truth
If results are poor, determine which of these is true:

### A. Station-definition problem
Symptoms:
- cross-street or ramp contamination
- wrong named candidate selected inside the bbox
- candidate audit shows ambiguity rather than a clear corridor miss

### B. Runtime-structure problem
Symptoms:
- missing centroids
- connector anomalies
- graph-coverage issues
- implausible local network entry

### C. Magnitude / distribution problem
Symptoms:
- correct rank order but systematic over- or under-assignment
- corridor-wide miss across multiple candidate segments
- strong sensitivity to blanket or purpose-specific demand scalars

## Step 8 — Upgrade status only with explicit caveats
Possible internal statuses:
- `internal prototype only`
- `bounded screening-ready`

Upgrade rule:
- a county can be called `bounded screening-ready` only on the documented validated slice and only with all required caveats preserved

Required caveats always include:
- screening-grade
- uncalibrated
- not behavioral demand
- not client-ready forecasting
- validated slice only
- county-specific when applicable

## Step 9 — Freeze the county checkpoint
After a meaningful pass or failure, write a durable note that records:
- what changed
- what was tested
- exact metrics
- what is now allowed to be claimed
- what is still disallowed
- best next step

This prevents repetition and keeps the modeling lane decision-useful.

## Example bootstrap invocation
```bash
python3 scripts/modeling/bootstrap_county_validation_onramp.py \
  --name placer-county-runtime-connectorbias2-20260324 \
  --county-fips 06061 \
  --county-prefix PLACER \
  --output-csv data/pilot-placer-county/validation/placer_priority_count_scaffold_auto.csv \
  --output-md docs/ops/2026-03-24-openplan-placer-validation-review-packet.md \
  --keep-project --force
```

For a brand-new county, use a fresh `--name` and county-specific output paths.

## Products created by this workflow
A county that follows this workflow should accumulate:
- completed screening run directory
- transfer/runtime checkpoint note
- starter scaffold CSV
- review packet markdown
- completed counts CSV
- validation outputs
- county truth memo / checkpoint note

## Current proven examples
### Nevada County
Proves:
- bounded screening-ready result is possible under corrected mainline validation
- connector heuristics matter materially
- county-specific scalar tuning can help, but must be guarded carefully

### Placer County
Proves:
- improved runtime is portable to a second county
- validation onboarding can now be seeded automatically
- the next blocker is count ingestion, not runtime fragility

## Product implication
This workflow is the bridge between:
- “choose a geography and auto-build a model,” and
- “have an honest, repeatable path to a locally truth-gated screening result.”

That bridge is essential for the eventual web product because automatic execution without honest local validation pathways would not be decision-useful enough.

## Bottom line
A new county should no longer be treated as an ad hoc modeling adventure.

The standard path is now:
1. run the reusable runtime,  
2. freeze the runtime checkpoint,  
3. auto-generate the validation scaffold,  
4. source counts,  
5. run validation,  
6. diagnose truthfully,  
7. upgrade status only with explicit caveats.

That is how OpenPlan moves from a promising prototype toward a real geography-first national screening workflow.
