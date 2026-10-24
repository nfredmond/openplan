# Choice-level parity verification and stopped execution

October 24, 2026 UTC. The 64-household comparison fails on two departure choices.
No engine run occurs in this round. The 2,000-household fixture and both full
arms remain unrun under the explicit stop rule. No TBI outcomes are accessed.

## Source checks

Twenty-one tests pass with zero skips:

- `parity-tests.log`: eight choice-level and six retained exact-comparison tests.
- `memory-runner-no-site-tests.log`: three runner tests under CPython 3.11 `-S`.
  Site packages are disabled and `importlib.util.find_spec("psutil")` is `None`.
- `packaging-tests.log`: two image-layout/catalog tests. No Docker build runs.
- `import-guard-tests.log`: two Vitest import checks, forks and two workers.

The first scoped Vitest invocation fails during configuration loading because
this new checkout lacks `vitest/config` and `@vitejs/plugin-react`. The successful
invocation uses an ignored local `node_modules` symlink to the existing root
checkout installation. This is source-test evidence, not a clean npm install,
application build, hosted check or passing GitHub CI run.

`mutations.json` records eight accepted comparator controls: one harmless
source comment and seven targeted assertion failures. The target faults admit
tolerance on choice columns, widen relative tolerance, allow five ULP at zero,
admit missing tables, admit ambiguous identities, admit changed schema/IDs,
and omit differing cells. The test fixtures also preserve row-order tolerance,
reject unequal nonfinite values, and ensure an admitted logsum difference cannot
hide a later departure-choice difference. A disposable source copy receives
each mutation and restores exact original bytes.

`lead-fix-controls.json` records six further controls: three harmless comments,
two intended assertion failures and one intended missing-dependency failure.
Removing `codecs` from the standard-library set fails the import guard. Changing
the pinned 2019 catalog identity fails the packaging assertion. Restoring the
module-level `psutil` import fails with the expected `ModuleNotFoundError` under
`-S`. Each owned source file is restored in `finally` and checked byte-for-byte.
The total is 14 accepted controls: four harmless survivors, nine assertion
failures and one expected dependency-import failure.

`mutations.initial.json` retains the rejected initial campaign. Its missing-table
mutation bypasses the census guard but reaches a downstream missing-file error.
That incidental error is not an accepted targeted assertion. The final campaign
instead mutates the refusal into successful return and observes the intended
missing-table test failure. Final logs supersede the initial per-control logs;
the rejected campaign is not added to the accepted count.

These controls cover comparator and source-import boundaries. They cannot prove
native random-stream equivalence, full-population execution, historical travel
conditions, survey eligibility, uncertainty methods or scientific accuracy.
The native controller's unexecuted launch/cache paths are not admitted by these
unit tests. The earlier full-arm recipe also contains an undefined `stdout`
variable. It remains historical and unused; a later full-arm launch requires a
reviewed successor controller after the choice discrepancy is resolved.

## Retained-output comparison

`prepare.py` rehashes the public archive and verifies the existing 14 final-table
hashes against the previous receipt before comparison. It copies inputs into
this worktree and freezes the second membership without consulting choices.
`input-freeze.json` records 2,000 households, 4,971 persons, seed zero and every
input/configuration hash. No source or destination geography changes.

`run-parity.py` compares the existing current-coefficient reference and training
outputs first. It stops on trip IDs `914860869` and `914860870`, whose departure
choices change from 16 to 18 and 18 to 19. `parity-result.json` retains the stop.
`audit-existing.py` then compares those same files without running the engine;
`complete-comparison.json` adds all seven table censuses, all file hashes and the
two tolerated one-ULP logsum differences. `exact-differing-trips.json` retains the
complete model rows through an independent standard-library CSV read.

The existing runs contain 244 tours and 628 trips each. Their matching counts and
tour-mode shares do not rescue differing departure choices. Earlier elapsed and
memory receipts remain dated earlier evidence, not new execution. Full-arm
elapsed time, peak memory, outputs and modeled shares are null in `full-runs.json`.
Production parity, all SEMCOG parity and both 2,000-household checks are unrun.

All 117 original frozen files retain their hashes. The prior exact-comparison
failure, archives and engine outputs remain unchanged. The archived memory-runner
copy preserves its old dependency behavior; this branch's standard-library RSS
repair is separately pinned in `closure.json`. No default coefficient, scalar,
fit gate, split, holdout, Docker stack or hosted service changes.
