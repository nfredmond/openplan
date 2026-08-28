# Observed-count validation instrument readiness

Date: 2026-08-28
Study: `california-seven-county-observed-count-instrument`
Registry: `scripts/modeling/development/california_validation_instrument_study.v1.json`

## Decision

The seven-county development instrument is **not ready**. Zero of seven county
pairs meet the frozen-input requirements, so OpenPlan did not open model-output
bytes, calculate comparative metrics, select a method, change defaults,
calibrate a candidate, or open an acceptance holdout.

This negative result completes the readiness study. It does not complete the
comparative instrument study.

## Readiness result

The audit hashes the network, observation package, and match audit for the two
existing method runs. It deliberately does not read `link_volumes.csv`.

| County FIPS | Frozen network matches | Observation package matches | AequilibraE match audit | ActivitySim match audit | Ready |
|---|---:|---:|---|---|---:|
| 06007 | yes | no | contains modeled volumes | contains modeled volumes | no |
| 06039 | yes | no | contains modeled volumes | contains modeled volumes | no |
| 06047 | yes | no | contains modeled volumes | contains modeled volumes | no |
| 06053 | yes | no | contains modeled volumes | contains modeled volumes | no |
| 06057 | yes | no | missing | contains modeled volumes | no |
| 06069 | yes | no | contains modeled volumes | contains modeled volumes | no |
| 06107 | yes | no | contains modeled volumes | contains modeled volumes | no |

The existing match-audit files are post-model diagnostics: they include modeled
values. They cannot prove that route, geometry, direction, facility, and
duplicate-lineage choices were frozen before the modeled volumes were known.
The observation packages also differ between methods in every county pair;
ActivitySim's 06057 run has no observation package or match audit.

## What must be frozen next

A successor may be frozen only after each county has:

1. one exact network package shared by both methods;
2. one exact observation package shared by both methods, including source
   identities and SHA-256 hashes;
3. a route, geometry, direction, facility, and duplicate-lineage match audit
   with `frozen_before_model_volume: true` and no modeled values;
4. one unchanged baseline per method using those exact packages; and
5. a preregistered partition and planning use. Any acceptance holdout remains
   sealed until the development instrument and use-specific acceptance rule are
   separately approved.

Only then may the development study reveal model volumes and publish results by
county, facility class, evidence grade, source, and loaded-network coverage.
Negative or inconclusive results remain valid outcomes.

## Reproduction

```bash
python3 scripts/modeling/prepare_validation_instrument_study.py \
  --registry scripts/modeling/development/california_validation_instrument_study.v1.json
```

The emitted record is
`openplan.development-validation-instrument-readiness.v1`. A regression test
also proves that changing model-output bytes cannot change the readiness result.
