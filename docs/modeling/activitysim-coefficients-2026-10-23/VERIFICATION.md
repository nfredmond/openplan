# Verification and execution record

The final scoped tests pass: **22 passed, zero failed, zero skipped**.
Thirty-five targeted mutation controls expose the intended failures. Harmless
controls survive, restored source passes, and two final native synthetic runs
produce identical numerical aggregates. The real development run executes once
and retires the candidate with scientific status `inconclusive`.

## Check counts and blind categories

| Check | Pass | Unexpected fail | Skip | What it cannot establish |
|---|---:|---:|---:|---|
| New transfer/aggregation/custody unit tests | 16 | 0 | 0 | Real observed behavior or transfer validity |
| Existing accepted-component tests | 4 | 0 | 0 | All installation environments or complete model execution |
| Existing coefficient-package tests | 2 | 0 | 0 | This donor's behavioral applicability |
| Unit mutation targets | 32 intended failures | 0 | 0 | Native engine selection by themselves |
| Preparation mutation targets | 2 intended failures | 0 | 0 | Every possible filesystem/path attack |
| Native missing-overlay mutation | 1 intended failure | 0 | 0 | Scientific accuracy |
| Final synthetic full preparation runs | 2 | 0 | 0 | Geographic or survey validity |
| Real native stages | 4 | 0 | 0 | Downstream trip-mode/assignment or nationwide accuracy |

The 32 unit mutations remove refusals or corrupt transferred values, means,
uncertainty, defaults, census, probability conservation, replay, unchanged joint
behavior, runtime identity, frozen candidate identity and retirement rules.
Every mutation fails through an assertion in its named test; none fails through
an unrelated import or orchestration error. `evidence/unit-mutations.json`
records each assertion, output hash and exact restoration hash. A harmless
source comment passes the whole 16-test suite. Reordered chooser rows and extra
nonoperative result metadata also survive.

Two preparation mutations allow an existing source archive or a holdout/output
path. Each fails `test_archive_member_allowlist` at the intended refusal
assertion. The restored preparation source passes 16 tests. Exact code and
results are retained under `evidence/preparation-controls.*`.

The native mutation routes the candidate branch through the baseline overlay.
The synthetic native stages run, but the evaluator refuses identical baseline
and candidate probabilities with `candidate has no probability effect`.
The sealed runner publishes an inconclusive failure. A separate synthetic-only
comparison of retained probability frames confirms that exact reason. The source
is restored before both final successful runs. See `evidence/native-control.*`.

The final synthetic fixture contains 60 households, 240 people, six zones,
284 primary tours and nine joint tours. It creates numeric land use and skims
rather than borrowing real survey choices. All 67 stratum records and all mode
probabilities repeat exactly across the two runs. The generated ZIP archives and OMX container bytes differ between preparations.
All CSV/configuration bytes, all 826 skim matrix values and their index mappings,
and the numerical aggregates match. Binary determinism of newly generated OMX
files is not established. This distinction does not alter the frozen real archive,
which has one exact hash and one opening.

## Initial preparation failures remain visible

1. Synthetic attempt `a`: the runner refuses `validator file overlaps a control
   or result path` before creating a receipt. Its API rejects duplicate files
   across evaluator and validator closure lists. The corrected lock gives the
   validator a separate entry-point file. The union of both closures freezes
   the shared implementation.
2. Synthetic attempt `b`: a native child fails with
   `StateAccessError: settings not initialized for this state`. The runner
   retains `EvaluatorProcessFailed`. The wrapper changes from filesystem-only
   initialization to ActivitySim's `State.make_default`, which loads settings.
3. Synthetic attempt `c`: all native stages pass. Resource warnings from
   unclosed CSV readers were corrected during preparation. Final attempts `d`
   and `e` use the final evaluator and repeat exactly.

The one initial native setup failure is not counted as a scientific rejection.
The initial refusal and failed native receipt are not silently replaced by the
later successful synthetic records. None consumes a real survey or acceptance
partition. Historical synthetic locks identify their own code hashes and are
not reusable instructions against the final source.

## Exact commands recorded

Working directory:
`/home/nathaniel/.t3/worktrees/openplan/t3-e642c2cd`.
The following are execution records. **Do not rerun a consumed study lock.**

```bash
git fetch origin && git checkout -B work/s2-activitysim-coefficients origin/main
```

From `openplan/`, `npm run product:direction:check` passes with reminders about
expired jurisdiction/capability reviews and later code changes. It does not
reassess those records or close their scientific gaps.

The scoped Python commands are:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -m unittest discover -s scripts/modeling/tests -p test_activitysim_walk_transfer.py -v
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B -m unittest discover -s scripts/modeling/tests -p test_activitysim_accepted_components.py -v
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B -m unittest discover -s scripts/modeling/tests -p test_package_activitysim_coefficients.py -v
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python scripts/modeling/tests/mutate_activitysim_walk_transfer.py > /tmp/openplan-walk-mutations-final.json
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python /tmp/openplan-walk-preparation-controls.py > /tmp/openplan-walk-preparation-controls.json
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python /tmp/openplan-walk-native-control.py > /tmp/openplan-walk-native-control.json
```

The temporary control scripts are preserved byte-for-byte in `evidence/`.
The mutation harness records its exact child unittest command and per-control
results. Initial test runs contained 12 tests; the final suite contains 16.

Final synthetic preparation and execution:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python scripts/modeling/prepare_activitysim_walk_transfer.py synthetic --run /tmp/openplan-walk-synthetic-20261023-d --stock /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B scripts/research/sealed_study.py run /tmp/openplan-walk-synthetic-20261023-d/lock.json > /tmp/openplan-walk-synthetic-20261023-d/runner.stdout
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python scripts/modeling/prepare_activitysim_walk_transfer.py synthetic --run /tmp/openplan-walk-synthetic-20261023-e --stock /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B scripts/research/sealed_study.py run /tmp/openplan-walk-synthetic-20261023-e/lock.json > /tmp/openplan-walk-synthetic-20261023-e/runner.stdout
```

Initial attempts use the same preparation/runner commands with suffixes `a`,
`b` and `c`. The `a` runner fails before receipt; `b` returns an inconclusive
aggregate; `c` completes. Those commands are not instructions to retry them.

The one real preparation and execution are:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python scripts/modeling/prepare_activitysim_walk_transfer.py development --run /tmp/openplan-walk-development-20261023 --stock /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs --bundle /home/nathaniel/code/openplan/data/agreement-study/runs/dev/06069/activitysim_bundle
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B scripts/research/sealed_study.py run /tmp/openplan-walk-development-20261023/lock.json > /tmp/openplan-walk-development-20261023/runner.stdout
```

The committed lock also contains the exact evaluator and validator command
arrays. Each native child command is constructed by the frozen evaluator from
those paths, using the same interpreter. All inherit the memory-limited scope.

The source-only default comparison passes:

```bash
GIT_OPTIONAL_LOCKS=0 git diff --exit-code 57be0eed1cbcf4e41dd6459a3bd6ed4df2517797 -- workers/activitysim_worker scripts/modeling/activitysim_mtc_inputs.py scripts/modeling/build_activitysim_input_bundle.py scripts/modeling/activitysim_accepted_components.py data/modeling/activitysim-accepted-components.json
```

The new code/prose whitespace check also passes. Exact upstream coefficient
and specification fixtures remain unchanged, including their original formatting.
The post-run custody check verifies every evaluator/validator closure file,
the compressed aggregate's decompressed hash, and unchanged runtime identity.

## Unexecuted tiers

No Vitest files change, so Vitest is not run. The full application suite,
`qa:gate`, `next build`, live RLS, database/worker service operations, browser
journeys, hosted systems and deployment checks are not run. They are unexecuted
tiers, not passing tests or hidden skips. No Docker stack is touched. This
research does not require an application release or version bump.

No observed modal accuracy test is possible with the frozen inputs. The
preregistered log-loss comparison and observation/coefficient uncertainty remain
unavailable. No replacement metrics, thresholds or donor selection follow the
result. The candidate remains non-default and retired for applicability.
