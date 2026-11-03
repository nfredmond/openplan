# Cordon impedance development preregistration

Study ID: `s2-cordon-impedance-development-20261023`.
Status at creation: frozen purpose and decision rule, before candidate outcomes.
The commit adding this file precedes implementation and experiment execution.

## Purpose and partition

Test whether network impedance improves terminating external-trip distribution
without changing gateway volumes, internal-zone totals, through trips, internal
demand, network structure, or defaults. Only AequilibraE demand is in scope.
Do not run or score ActivitySim, combine methods, or claim method agreement.

Use the original five development counties named in the August 17 trip-length
study: Merced (06047), San Benito (06069), Tulare (06107), Broomfield (08014), and
Pueblo (08101). Use their retained `u2-<geography>-base` inputs only. Do not read
any `holdout` path or any other county. The seven-county successor registry
contains historically consumed inputs, so it is not this experiment's source.

Merced and Broomfield form the development diagnosis stratum. San Benito,
Tulare, and Pueblo form the development evaluation stratum. All five remain
exposed development evidence, never independent acceptance. No parameter is
fitted on either stratum. Report every county separately; no pooled rescue.

## Fixed algorithm and inputs

For each directional external/internal block, multiply baseline positive cells
by `1 / max(freeflow_minutes, 1)`. Balance that seed to the exact baseline row
and column sums with iterative proportional fitting. Stop at absolute marginal
error no greater than `1e-7 * max(1, largest target marginal)`, with a 10,000
iteration numerical ceiling. Failure to converge refuses the candidate.
This ceiling is a numerical failure condition, not a model runtime shortcut.

Preserve baseline zero cells. Preserve unreachable cells unchanged and count
their demand separately. Apply no output-guided rematching, new route pairing,
gateway cap change, through-share change, mode change, or rounding within the
candidate algorithm. Use the baseline's 0.35 through share and no calibration.
Preserve gateway-to-gateway and internal-to-internal cells byte for byte.
The default setting returns the original object without inspecting or changing
its bytes. The opt-in setting is `OPENPLAN_EXTERNAL_DISTRIBUTION=cordon_impedance_v1`.

Freeze a ZIP containing only each selected run's zone attributes, demand input
matrix, network setup, skim, network database, and published count input. Copy
no previous assignment, validation or study result. Record every member hash,
source path, network attribution, source vintage available from setup, and
unknown day/year/observation uncertainty explicitly. Freeze evaluator and
validator code closures, numerical runtime versions, assignment profile and
commands in a sealed-study lock committed before execution. The input archive
is development evidence, not a fresh holdout.

Run baseline and candidate with identical code, engine, network, internal demand,
matching, counts and assignment settings. Reconstruct baseline external demand
with existing code. Keep the retained total OD input as baseline and replace
only that external layer for the candidate; refuse negative residual internal
demand beyond CSV rounding tolerance of 0.011 trips per cell. Preserve the same
reachability mask in both arms and record removed demand. Use one assignment
core, BFW/BPR, target gap 0.0005, ceiling 3,000 iterations, peak factor 0.10.
Run a repeated candidate assignment on San Benito to measure numerical repeat
variation. Record ordered zone-to-centroid mapping; do not assume row order.

## Metrics and decision

Primary metric: raw station median absolute percent error (APE), computed on
the same input-only match set in both arms. Preserve zero-volume comparisons.
Report station count, unmatched/excluded count, raw median APE, signed residual,
absolute residual, loaded/unloaded links and station coverage by county and
road class, including unknown classes. Preserve paired-carriageway handling.
The legacy match instrument supplies diagnostics only, not rules-v4 acceptance.

Report uncertainty-aware excess APE only when the source supplies an explicit,
documented interval and comparable year, day, direction and vehicle basis.
Otherwise report `unavailable`, with the number of affected observations.
Do not invent a percentage interval. Unknown model day/year and legacy matching
prevent an accuracy claim even if raw diagnostics improve.

Advance this candidate to another development study only if every county has
at least one matched station, every assignment converges, conservation and
coverage guards pass, each evaluation county improves median raw APE by at
least five percentage points, no diagnosis county worsens by more than one
point, and no county/road-class stratum with at least five stations worsens by
more than one point. No county may lose a loaded observed station. At least
one positive-demand cell must change; an inert arm cannot advance. Repeated
San Benito county median APE must differ by no more than 0.1 percentage point.
These are experimental progression criteria, not acceptance tolerances.

Retire if a complete comparison fails any criterion. If missing input, runtime
failure, nonconvergence, custody failure or insufficient comparison prevents a
complete result, retain an `inconclusive` result and retire this execution from
advancement, distinguishing it from scientific rejection. Keep the opt-in
candidate available either way. Do not choose a successor from new holdouts.

## Execution, proof and limits

Use `scripts/research/sealed_study.py` with its exclusive receipt, inherited
host lease, frozen closure, validator and aggregate publication. Run under
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0`. The workstation
limit overrides the generic protocol's no-memory-cancellation guidance. A kill
after receipt consumes this execution and yields an inconclusive result through
the documented recovery path. Never delete a receipt or rerun that opening.

Unit fixtures may run before the lock. Prove setting admission, shape/value
admission, marginal conservation, unchanged blocks, support retention,
nonconvergence refusal, source custody and progression rules with a harmless
mutation, targeted failure and restored pass. Native assignment, repeated run,
and default output-byte checks remain separate evidence tiers. No browser,
hosted service, CEQA determination, default promotion or untouched acceptance
is authorized by this study.
