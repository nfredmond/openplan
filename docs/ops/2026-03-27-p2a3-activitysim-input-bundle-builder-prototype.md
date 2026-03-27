# P2A.3 ActivitySim Input Bundle Builder Prototype

**Date:** 2026-03-27  
**Status:** prototype implemented  
**Scope:** AequilibraE screening handoff to ActivitySim input-bundle scaffold

## Purpose
This slice adds a first honest packaging artifact between the existing OpenPlan/AequilibraE screening lane and a future ActivitySim worker.

It does **not** run ActivitySim. It packages screening outputs into a reproducible bundle scaffold so later worker slices can consume a stable handoff contract.

## Script
`scripts/modeling/build_activitysim_input_bundle.py`

## Inputs
The builder accepts either:

- a completed screening run directory via `--screening-run-dir`
- or a screening bundle manifest path via `--screening-manifest`

Required source artifacts inside the screening run:

- `bundle_manifest.json`
- `package/zone_attributes.csv`
- `run_output/travel_time_skims.omx`

## Output bundle
The builder writes a bundle directory containing:

- `manifest.json`
- `land_use.csv`
- `households.csv`
- `persons.csv`
- `skims/travel_time_skims.omx`
- `README.md`
- `configs/README.md`
- `metadata/source_screening_bundle_manifest.json`

## What the builder does
- Reuses screening `zone_attributes.csv` as the source for land-use and population scaffolding.
- Produces `land_use.csv` with zone IDs, households, population, workers, employment, and a few carried-forward employment segments.
- Produces deterministic prototype `households.csv` and `persons.csv` by expanding zone totals into synthetic records.
- Copies or symlinks the screening skim OMX into the bundle.
- Writes a bundle manifest with provenance, file registry, skim materialization mode, and explicit caveats.

## Caveats
- The synthetic population is a **prototype scaffold**, not a calibrated IPF or PopulationSim output.
- Household and person rows are derived from screening zone totals with deterministic heuristics and are **not production-ready ActivitySim agents**.
- The current `households.csv` and `persons.csv` are a handoff layer for future worker development, not a final locked ActivitySim schema/config package.
- Any zone with fractional screening totals may require integerization adjustments so the scaffold can emit valid household/person rows.

## Example
```bash
python3 scripts/modeling/build_activitysim_input_bundle.py \
  --screening-run-dir data/screening-runs/nevada-county-bounded \
  --output-dir data/activitysim-bundles/nevada-county-prototype
```

## Validation
Focused Python tests live at:

- `scripts/modeling/tests/test_build_activitysim_input_bundle.py`

Additional real-run verification completed on 2026-03-27 against:

- `data/screening-runs/nevada-county-runtime-mainline-scalar0369-20260324`

Observed bundle output from that real screening run:

- `land_use.csv` rows: `26`
- prototype households: `41,415`
- prototype persons: `102,322`
- skim materialization: `copy`

This confirms the builder works not only in unit tests but against the current Nevada County screening artifact set.

## County onramp integration
As of the same 2026-03-27 modeling pass, `scripts/modeling/bootstrap_county_validation_onramp.py` now attempts to build this ActivitySim bundle automatically after a successful county screening bootstrap and records the resulting bundle manifest path in the county onramp manifest when the build succeeds.
