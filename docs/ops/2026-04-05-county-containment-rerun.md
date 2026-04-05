# County containment rerun — 2026-04-05

## Verdict
**County lane:** yes, it is now contained enough to stop blocking broader fan-out.

**Whole repo:** no, the repo is still not honestly clean enough for broader OpenPlan fan-out because there is a large unrelated dirty tree outside this lane.

## What this lane actually contained
I reviewed the remaining county-onramp / worker / schema / docs truth surface:
- `docs/ops/2026-03-24-openplan-county-*`
- `schemas/county_onramp_manifest.schema.json`
- `schemas/examples/county_onramp_manifest.*`
- `scripts/modeling/bootstrap_county_validation_onramp.py`
- `scripts/modeling/check_county_onramp_manifest.py`
- `scripts/modeling/generate_validation_scaffold.py`
- adjacent county worker/schema/docs references
- `workers/aequilibrae_worker/**` where the diff touched this lane

## Classification

### Durable source-controlled truth to keep
These belong in repo and are worth shipping:
- `docs/ops/2026-03-22-openplan-nevada-county-modeling-truth-memo.md`
- `docs/ops/2026-03-22-openplan-nevada-county-observed-count-validation-setup.md`
- the already-committed county-onramp schema/examples/docs/scripts contract at `HEAD`

### Half-finished or misleading surfaces that should not ship
These were present only as uncommitted local edits and were **not** coherent with the live county surface:
- schema/docs/script deletions that removed:
  - behavioral prototype artifact pointers
  - container runtime fields
  - scaffold summary fields
  - archived-run GeoJSON fallback logic
- those local deletions conflicted with current source/test expectations in:
  - `scripts/modeling/tests/test_bootstrap_county_validation_onramp.py`
  - `scripts/modeling/tests/test_generate_validation_scaffold.py`
  - `workers/county_onramp_worker/**`
  - `openplan/src/lib/models/county-onramp.ts`
  - `openplan/src/lib/api/county-onramp-worker.ts`
  - county runtime preset/client tests

### Runtime/generated noise that should not stay dirty
These were not real content changes and should not be treated as meaningful work:
- executable-bit flips on `workers/aequilibrae_worker/**`
- executable-bit flip on `openplan/supabase/migrations/20260324000134_county_onramp_runs.sql`
- executable-bit flips on worker package sample data files

## What I did
1. **Parked/reverted the half-finished contraction** by restoring the tracked county schema/docs/scripts files to `HEAD`.
2. **Cleared mode-noise** on the touched worker/migration/package files by restoring them to `HEAD`.
3. Left only the durable truth docs as candidate additions.

## Validation run
Passed:
- `python3 -m unittest scripts.modeling.tests.test_bootstrap_county_validation_onramp`
- `python3 -m unittest scripts.modeling.tests.test_generate_validation_scaffold`
- `python3 -m unittest workers.county_onramp_worker.tests.test_main`

Combined result:
- **7 tests passed**

## Final blocker
The **county lane is no longer the blocker**.

The blocker is the **remaining unrelated repo dirtiness** outside this lane. Broad fan-out still risks collision/confusion because the working tree contains many non-county edits that were intentionally left untouched here.

## Exact next action
Do a separate containment pass for the remaining non-county dirty tree. Do **not** reopen county-onramp contraction unless the app, worker payloads, schema, tests, and docs are all changed together as one honest contract update.
