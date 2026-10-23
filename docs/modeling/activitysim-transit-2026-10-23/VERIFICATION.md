# Verification boundary

All numerical work uses the existing CPython 3.11.15 ActivitySim environment.
The regional routing runs and Python suites run in user systemd scopes with
`MemoryMax=6G` and `MemorySwapMax=0`. Vitest uses forks and at most two workers.
No application build, Docker operation, hosted service, production database,
or observed travel-choice comparison runs in this task.

## Tests exercise computation and the bundle boundary

The final scoped Python run has 79 passing tests and no skips: 24 new transit
tests plus 55 existing MTC/bundle tests. The existing installed-stock tests use
an explicit path to ActivitySim 1.5.1. [tests.log](evidence/tests.log) retains the
results. The scoped dependency guard has two passing tests and no skips in
[dependencies.log](evidence/dependencies.log).

The synthetic feed has a first vehicle at 08:05, arriving at the transfer stop
at 08:15, and a second vehicle from 08:20 to 08:35. Zero-distance endpoint
connectors give 25 minutes in vehicle, five minutes initial wait, five minutes
transfer wait, two boardings, one transfer, and 35 minutes total. Its single
$2.50 fare allows one transfer within two hours. Independent assertions check
these values in every period. Other fixtures cover walk access/egress,
cross-stop walking, drive access/egress, primary-mode boarding, ferry versus
light-rail time, on-board dwell, missed/prohibited transfers, pickup/drop-off
restrictions, after-midnight GTFS times, fare expiry, and explicit free fares.

Refusals cover no service, calendar removals, unmatched stops, absent feeds,
hash mismatch, zones without access, unsupported frequencies and conditional
boarding, incompatible MTC scaling, missing source information, and invalid
configuration. A no-path result remains distinct from a path with unknown fare.
The full opt-in bundle test inspects its manifest, custody file, raw artifact
hash, and README caveat together.

The standalone installed-stock probe writes all 826 matrices and reads them
back through OpenMatrix. It checks finite stock values and independently
specified transit expectations. This is file/schema execution evidence. It is
not an ActivitySim behavioral run or acceptance of the coefficients.

## Defaults retain their existing behavior and bytes

The baseline is the exact source from main commit
`e7e9cd1b43fa25e6ebf82572cc763a09435a2356`. Compressed baseline source and hashes
live under `scripts/modeling/tests/fixtures/activitysim-transit-baseline/`, so
shallow CI checkouts do not need Git history. Initial test preparation used
`05dd3e8da`; the final tests bind the actual fetched base above and rerun.

Both implementations receive the same fixtures and output paths. The tests
hold the manifest clock fixed and suppress HDF5 dataset creation timestamps in
both implementations, then compare every bundle byte. This clock control is
necessary: unmodified OpenMatrix files created two seconds apart differ in
timestamp bytes. The production builder retains its existing timestamp behavior.
Numerical values, matrix names, layout, attributes, manifests, CSV files,
configuration files, and caveats remain subject to byte comparison.

## Mutation controls prove the checks can reject wrong behavior

The final campaign has 33 controls: two harmless survivors and 31 targeted
failures, with zero skipped controls. The source checks remain unchanged after
the campaign. Python mutations execute isolated source copies with `-B`; the
runner rejects import/setup errors as proof of an assertion's sensitivity.

- [Transit mutations](evidence/mutations.json): 24 wrong behaviors fail and a
  comment-only change survives. Faults include halved in-vehicle time, erased
  wait/transfer/access components, wrong MTC scaling, missed and prohibited
  connections, calendar changes ignored, a bypassed hash check, unknown fare
  treated as free, erased drive time, primary mode omitted, dwell treated as
  wait, unsupported frequency service admitted, pickup/drop-off ignored,
  omitted transfer walk, expired fares reused, unsourced fare policy admitted,
  wrong Python admitted, dropped skim export, no-path status mislabeled, and
  ferry time labeled light rail.
- [Integration mutations](evidence/integration-mutations.json): five wrong
  behaviors fail. They bypass the stock scaling gate, change the default
  starter version, enable default transit, alter default auto time, or drop the
  opt-in caveat.
- [Dependency mutations](evidence/dependency-mutations.json): a comment-only
  change survives. Removing the new `bisect` standard-library admission fails;
  adding an undeclared library also fails. Temporary files are removed.

Two earlier mutation rounds exposed test weaknesses, not clean controls.
Ignoring a calendar addition and bypassing the feed hash check each reached a
`KeyError` before the intended assertion. Those outputs remain in
[attempt 1](evidence/mutations-attempt1.json) and
[attempt 2](evidence/mutations-attempt2.json). The tests now assert the status
before reading dependent results. The final controls fail by assertion for the
intended wrong behavior.

Two dependency-test attempts also failed before valid verification. The first
ran from the repository root and resolved the wrong scan path; the second used
the package directory before its Node dependencies were installed. Both logs
remain beside the final passing result. `npm ci --ignore-scripts` installed this
checkout's locked dependencies. No dependency versions changed.

## What these checks cannot see

The numerical fixtures do not establish timetable truth, network walkability,
GTFS completeness, congestion, parking feasibility, fare-product correctness,
or model accuracy. The byte checks cover the declared fixtures under controlled
clocks, not every possible population or environment. The dependency guard scans
Python imports; it cannot prove runtime binary compatibility or discover all
dynamic imports. The stock probe does not execute ActivitySim utilities or tour
choices. The Twin Cities percentiles summarize reachable paths within a declared
three-hour cap and cannot validate observed mode shares.

The frozen TBI study remains unadmitted. This work supplies a bounded input
capability and preserves unresolved fare, drive-access, pedestrian, highway,
population, and study-custody requirements.

## Reproduce the scoped checks

Set `TRANSIT_PY` to a CPython 3.11 environment with the declared ActivitySim
execution requirements, and `TRANSIT_STOCK` to its `examples/prototype_mtc`.
From the repository root:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  "$TRANSIT_PY" -B docs/modeling/activitysim-transit-2026-10-23/evidence/verify.py "$TRANSIT_STOCK"
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  "$TRANSIT_PY" -B docs/modeling/activitysim-transit-2026-10-23/evidence/mutate.py
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  "$TRANSIT_PY" -B docs/modeling/activitysim-transit-2026-10-23/evidence/mutate-integration.py
"$TRANSIT_PY" docs/modeling/activitysim-transit-2026-10-23/evidence/mutate-dependencies.py
```

From `openplan/`:

```bash
npm exec -- vitest run src/test/modeling-requirements-cover-the-modeling-imports.test.ts --pool=forks --maxWorkers=2
```
