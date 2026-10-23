# S2 cordon experiment closes inconclusive before assignment

**Decision: retire this execution from advancement. Scientific outcome:
inconclusive.** The evaluator exits during input preparation after the sealed
receipt is durable. It produces no assignment, completed pre-output audit or
county comparison. This is an execution failure, not evidence that the demand
candidate improves or worsens observed traffic. S2 remains incomplete.

## What changed

The worker and county demand builder accept one non-default setting:
`OPENPLAN_EXTERNAL_DISTRIBUTION=cordon_impedance_v1`. It conditions terminating
external trips on retained network time and balances the result to unchanged
origin and destination totals. Internal demand, through trips, structural zero
cells and unreachable cells stay fixed. The candidate records its algorithm
hash, settings, matrix/skim/mask hashes, conservation errors and coverage.
Worker state and evidence packets retain the candidate record when selected.
Defaults add no new metadata and keep the original demand object.

The [design](S2_CORDON_IMPEDANCE_DESIGN_2026-10-23.md) explains selection and
rejected alternatives. The [preregistration](S2_CORDON_IMPEDANCE_PREREGISTRATION_2026-10-23.md)
fixes the experiment before outcomes. Core code contains no jurisdiction,
coordinate, county identifier or geographic default. The study registry names
its five permitted development counties.

## Custody and failure

- Base source: `57be0eed1cbcf4e41dd6459a3bd6ed4df2517797` from fetched main.
- Preregistration commit: `09792dd2d`.
- Candidate and execution-lock commit: `eadba1d13`.
- Lock SHA-256: `37846a58bbfdf5f6621de38225ddb6557b2f172b4e0440cee20382ca253f3b9f`.
- Receipt SHA-256: `6357c2a24859545b0d8e82ad7a9113b056ecc17f4e12679d2f6a7c7fed86a887`.
- Runtime: AequilibraE 1.6.2, NumPy 2.0.2, pandas 2.3.3, SciPy 1.17.1.
  The registry records the remaining numerical packages.
- Input archive: 30 allowlisted files, 74,508,907 compressed bytes. Only the
  original five development counties supply inputs. No new or consumed holdout
  partition supplies a file. The archive contains no previous assignment or
  validation result. It includes retained demand and skim inputs.
- Evaluator exit: 1, no signal. Peak RSS: 506,171,392 bytes, about 483 MiB.
- Evaluator stdout: zero bytes. Stderr: 707 bytes, hash
  `980d17c82fc544d9b4b5a41dd6882c09c9a40310019dfc11af4901bf3d9790ef`.

The sealed runner deliberately retains stream hashes rather than their content.
The record therefore does not establish the particular exception or failed
assertion. No completed audit or assignment progress record exists. Do not infer
a scientific failure or an out-of-memory termination from this process exit.
The receipt and result remain permanent. This work does not rerun the opening,
delete its receipt, change its frozen evaluator, or inspect additional partitions.
All 190 frozen evaluator/validator file hashes still match after closure.

After closure, a new two-zone synthetic OMX fixture reproduces a defect in
the evaluator's preparation code. In AequilibraE 1.6.2, loading an OMX file
does not populate `skim.matrix["travel_time"]`. That direct read raises
`KeyError: 'travel_time'`. The public
`skim.get_matrix("travel_time", copy=True)` API returns the expected matrix
and preserves the fixture's explicit index. The evaluator uses the failing
direct read. This establishes an adapter defect without reopening study inputs;
the sealed stderr hash alone cannot prove the original exception was identical.
The frozen evaluator remains unchanged. A successor should use the public
reader and first prove complete native input preparation on synthetic packages.

Exact records are in
[`data/modeling/s2-cordon-impedance-2026-10-23`](../../data/modeling/s2-cordon-impedance-2026-10-23/).
The ignored input archive and local execution directory remain under
`/home/nathaniel/.local/state/openplan/s2-cordon-20261023/`.

## Raw and uncertainty-aware results remain unavailable

Merced and Broomfield are the registered diagnosis stratum. San Benito, Tulare
and Pueblo are the registered evaluation stratum. Each has the same outcome:
baseline not run, candidate not run, raw residual not measured, uncertainty-aware
residual unavailable, and no advance decision supported. County and road-class
count errors and loaded-link changes are **not measured**, not zero. Road-class
strata were not reached. The repeated San Benito assignment was not reached.

Eleven assignments were planned: five baseline, five candidate and one repeat.
Zero ran; all 11 remain unexecuted. No raw comparison can be supplied from this
execution. Model day/year and observation intervals also remain insufficient
for an accuracy claim. Neither the historical 43.3 percent selection metric nor
the old VMT ratio supplies a substitute result. ActivitySim did not run and its
results are not averaged, reused as truth or promoted.

## Commands and checks

All commands run from this worktree unless a directory is stated. `$PY` below
denotes `/home/nathaniel/.local/state/openplan/s2-cordon-20261023/venv/bin/python3`.
This is a notation for the commands, not a replacement system environment variable.

1. `git fetch origin && git checkout -B work/s2-aeq-structural-experiment origin/main`
   succeeds. The initial checkout is clean and isolated from the other active lane.
2. In `openplan/`, `npm run product:direction:check` passes, with existing
   review-age and release-version reminders. It is not a new product review.
3. `python3 -m venv --system-site-packages /home/nathaniel/.local/state/openplan/s2-cordon-20261023/venv`
   and that environment's `pip install 'aequilibrae==1.6.2' 'numpy==2.0.2'
   'pandas==2.3.3' 'scipy==1.17.1' 'shapely>=2.0' python-dotenv openmatrix pyproj requests`
   succeed. Existing worker environments remain unchanged. A version probe
   using `aequilibrae.__version__` fails because that attribute does not exist;
   `importlib.metadata.version` supplies the recorded versions.
4. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B workers/hosted-models/verify_graph_compatibility.py`
   passes one native fixture: two compressed links, route distance 2.0.
5. `$PY -B workers/aequilibrae_worker/test_external_distribution.py -v`
   passes 14 tests, zero failed or skipped. The first run had 13 passes and one
   test-harness error from selecting the wrong function name. The corrected
   test executes the actual worker integration statement.
6. `$PY -B scripts/modeling/s2_cordon/test_study.py -v`
   passes 11 tests, zero failed or skipped. The default county OD CSV, demand
   metadata JSON and matrix bytes match the original main implementation on
   a synthetic fixture. The opt-in path changes that fixture and retains custody.
7. `$PY -B workers/aequilibrae_worker/test_gateways.py` passes 13 existing
   gateway checks, zero failed or skipped.
8. `$PY -B scripts/modeling/s2_cordon/prove_guards.py data/modeling/s2-cordon-impedance-2026-10-23/mutation-controls.json`
   completes 30 controls: one harmless survivor and 29 intended assertion
   failures. Both restored suites pass, totaling 25 tests. Every edited source
   file returns to its exact original bytes. An earlier campaign stops when a
   shape mutation raises a NumPy error instead of reaching the expected test
   assertion. The replacement mutation admits malformed input explicitly and
   fails the intended refusal assertion. The intermediate 28-control campaign
   also passes; the final 30-control record includes both dispatch paths.
9. `git diff --check` passes. A five-file `py_compile` command also succeeds;
   the frozen file hashes, not temporary bytecode, identify executed source.
10. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B scripts/research/sealed_study.py run data/modeling/s2-cordon-impedance-2026-10-23/lock.json`
    completes its custody protocol and publishes `evaluated_once_inconclusive`.
    The child evaluator fails with exit 1. This is one failed scientific
    execution, not a passing model test. Scope: `run-p233129-i58837440.scope`.
11. A post-run SHA-256 comparison against both lock closures passes all 190
    files, with zero mismatches. No source archive is reopened for this check.
12. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B scripts/modeling/s2_cordon/test_native_omx_contract.py -v`
    passes one synthetic native test. Two preliminary inline probes fail:
    the direct core read raises `KeyError`, and a first fixture incorrectly
    assigns `index` instead of filling its existing array. The corrected
    fixture uses `index[:]` and proves both the failing direct read and the
    working public reader. It touches no scientific source.
13. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B scripts/modeling/s2_cordon/prove_native_omx.py data/modeling/s2-cordon-impedance-2026-10-23/native-omx-controls.json`
    checks the diagnosis with one harmless survivor, three intended assertion
    failures and one restored pass. The controls change only temporary copies
    of the synthetic test. Frozen code remains unchanged.

The mutation record names each control and expected assertion. It covers
setting admission, default identity, dimensions, finite/nonnegative values,
skim admission, conditioning, nonconvergence, fixed cells, support, margins,
custody, both dispatch paths, progression rules, archive/member integrity,
holdout-path refusal, matching, repeat tolerance and promotion refusal.

These checks cannot prove native county assignment, external-trip behavioral
validity, count comparability, full worker-stage delivery, browser usability,
hosted operation, machine-crash recovery or untouched acceptance. Source-level
dispatch execution is narrower than a complete worker-stage run. The study
preparation fixtures test custody refusal but did not establish successful
preparation on a complete native package. The closed failure exposes that gap.

Full app tests, full worker matrix, `qa:gate`, build, browser, live database and
hosted checks are not run. The task forbids `next build` and hosted changes.
No database, Docker stack, production deployment or secret is changed.

## Lead disposition

Keep the candidate available and off by default. Do not merge this draft as
evidence of improved model accuracy or completed S2. The lead needs to decide
whether to authorize a separately preregistered successor execution using the
public OMX reader after complete synthetic preparation proof. That successor
must preserve this failure, name its eligible development evidence and bind a
new lock. It must not reopen a holdout or relabel this execution as successful.
