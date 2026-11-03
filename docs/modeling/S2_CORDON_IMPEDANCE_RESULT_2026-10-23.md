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

## Round 2 corrected successor result, October 23, 2026

**Development decision: retire. Scientific accuracy: inconclusive.**
The successor completes all five input preparations and all 11 registered
assignments. Every assignment converges. The independent validator accepts the
evaluator record, and the sealed runner publishes `rejected`.
This is a completed development comparison. It does not establish scientific
accuracy, untouched acceptance or completed S2. The candidate stays available
and off by default. The complete round 1 record above remains byte-identical.

All three evaluation counties have zero median APE improvement at the retained
score precision, below the required five percentage points. Tulare also loses
one loaded observed station, in its secondary-road stratum. Merced and Broomfield
pass their diagnosis non-inferiority checks. Their local pass cannot rescue the
evaluation failures. No county/road-class stratum with at least five stations
worsens by more than one point.

### Correction and pre-execution proof

The new `evaluate_successor.py` differs from the frozen round 1 evaluator in
exactly two statements: its study identifier and its public OMX core read.
The successor uses `skim.get_matrix("travel_time", copy=True)`. The original
evaluator, candidate algorithm, assignment profile, validator and scoring stay
unchanged. The hypothesis, splits, held-fixed inputs, metric and advance/retire
criteria remain byte-identical in the successor preregistration. Registry
experiment fields and all 30 archive members remain identical. Only study
identity, preregistration reference, lineage and execution paths change.

The first requested checkout command fetches successfully but Git refuses the
branch switch because the round 1 worktree holds the branch. This round uses
`git checkout --detach origin/work/s2-aeq-structural-experiment` in the clean
`/home/nathaniel/.t3/worktrees/openplan/t3-cc6b7a60` checkout. It pushes verified
commits with `git push origin HEAD:work/s2-aeq-structural-experiment`.
The predecessor checkout and all its frozen files remain untouched.

The synthetic fixture supplies two invented geographies and all 12 required
input members. It deliberately shuffles zone, OMX and centroid order. It
executes the real sealed runner, lease, code and source checks, receipt,
runtime checks, extraction, OD/skim preparation, candidate conservation,
default identity, Spatialite reads, count matching, both pre-output audits,
five native assignments, scoring, repeat, validator and aggregate publication.
A first fixture attempt fails before receipt creation because its scratch
directory does not exist. Creating that directory corrects the fixture setup.
The final suite passes both tests with zero failures and zero skips.

Mutation proof records one harmless survivor and three intended assertion
failures: restoring the invalid OMX read, replacing centroid mapping with
positional ordering, and omitting the native repeat. The public-reader restore
passes one test; the complete restored suite passes two. Every mutated source
returns to its exact bytes. No scientific source supplies these controls.

### Successor custody

- Preregistration and proof commit: `72a765cd4`.
- Lock commit, pushed before execution: `dfcb80a12a1477b1134a9759384c1b70dcf24289`.
- Successor lock SHA-256: `d867974ee13a8a92834e99837519f278edc24db49d5da88495ce19ae6c94823a`.
- Successor receipt SHA-256: `24201fe45da2f7eb9aacc315410fd1da308843801188b1c4ab0a7ae173bb3d61`.
- Successor aggregate SHA-256: `9597071411578f9b09e53529123da47ba9416a404f134898974c0a5cf3680763`.
- Predecessor lock SHA-256: `37846a58bbfdf5f6621de38225ddb6557b2f172b4e0440cee20382ca253f3b9f`.
- Post-run custody: 190 of 190 predecessor files and 201 of 201 successor files match.
- Scope: `run-p455366-i59030582.scope`; MemoryMax 6,442,450,944 bytes; MemorySwapMax 0.
- Evaluator exit: 0, no signal. Peak RSS: 1,057,968,128 bytes, about 1,009 MiB.
- Evaluator stdout: zero bytes. Stderr: 6,586 bytes, hash
  `285120484a4b53b2f10db1a43030326980042154c146cc8b6ac1ad2c1195831a`.
  The sealed protocol retains no stream text; its contents remain unknown.
- Candidate result: 91,837 bytes, hash
  `809520aa034c79680d6e62b115d88c1b51195fe1f134fa8cce60aa1d26f02e9f`.
- Local assignment and station diagnostics remain under
  `/home/nathaniel/.local/state/openplan/s2-cordon-successor-20261023/execution/`.
- Versioned records: `data/modeling/s2-cordon-impedance-successor-2026-10-23/`.

### County results and the registered decision

APE is absolute percent error against the retained published count. Positive
improvement means baseline median APE minus candidate median APE, in percentage
points. These are raw diagnostics on exposed development inputs. All five
counties lack documented observation intervals and comparable model day/year.
Uncertainty-aware excess APE is unavailable for all 337 matched stations.
The 83 unmatched or excluded observations remain in coverage accounting.
The near-100-percent raw errors appear in both arms. This single distribution
experiment does not identify their cause or establish the validity of the
modeled volume scale. No scalar correction or rematching follows the result.

| Stratum | County | Matched | Unmatched or excluded | Baseline median APE (%) | Candidate median APE (%) | Improvement (points) | Loaded stations, baseline/candidate | Decision and reasons |
|---|---|---:|---:|---:|---:|---:|---:|---|
| diagnosis | Merced | 78 | 27 | 99.950000 | 99.955000 | -0.005000 | 75/75 | advance: all criteria pass |
| evaluation | San Benito | 18 | 9 | 99.980000 | 99.980000 | 0.000000 | 15/15 | retire: evaluation_improvement_below_5_points |
| evaluation | Tulare | 140 | 42 | 99.930000 | 99.930000 | 0.000000 | 131/130 | retire: evaluation_improvement_below_5_points, lost_loaded_station |
| diagnosis | Broomfield | 21 | 0 | 99.990000 | 99.990000 | 0.000000 | 18/18 | advance: all criteria pass |
| evaluation | Pueblo | 80 | 5 | 99.930000 | 99.930000 | 0.000000 | 77/77 | retire: evaluation_improvement_below_5_points |

| County | Arm | Median signed residual (vehicles/day) | Median absolute residual (vehicles/day) | Uncertainty unavailable, matched stations |
|---|---|---:|---:|---:|
| Merced | baseline | -14890.750000 | 14890.750000 | 78 |
| Merced | candidate | -14893.150000 | 14893.150000 | 78 |
| San Benito | baseline | -24535.900000 | 24535.900000 | 18 |
| San Benito | candidate | -24535.900000 | 24535.900000 | 18 |
| Tulare | baseline | -12039.850000 | 12039.850000 | 140 |
| Tulare | candidate | -12039.200000 | 12039.200000 | 140 |
| Broomfield | baseline | -32000.000000 | 32000.000000 | 21 |
| Broomfield | candidate | -32000.000000 | 32000.000000 | 21 |
| Pueblo | baseline | -14992.800000 | 14992.800000 | 80 |
| Pueblo | candidate | -14992.950000 | 14992.950000 | 80 |

### County and road-class results

Every scored road class appears below. Unknown classes are retained if present.
A missing scored class is not a zero-error class. The network table separately
shows classes with no matched count. Values use baseline/candidate order.

| County | Road class | Matched stations | Median APE (%) | Median signed residual (vehicles/day) | Median absolute residual (vehicles/day) | Loaded stations | Uncertainty unavailable, matched stations |
|---|---|---:|---:|---:|---:|---:|---:|
| Merced | motorway | 29 | 99.980000/99.980000 | -52978.300000/-52980.600000 | 52978.300000/52980.600000 | 28/28 | 29/29 |
| Merced | primary | 33 | 99.800000/99.820000 | -8878.400000/-8879.800000 | 8878.400000/8879.800000 | 33/33 | 33/33 |
| Merced | secondary | 2 | 100.000000/100.000000 | -2100.000000/-2100.000000 | 2100.000000/2100.000000 | 0/0 | 2/2 |
| Merced | tertiary | 1 | 99.790000/99.790000 | -8481.900000/-8482.200000 | 8481.900000/8482.200000 | 1/1 | 1/1 |
| Merced | trunk | 13 | 99.940000/99.950000 | -18495.000000/-18495.300000 | 18495.000000/18495.300000 | 13/13 | 13/13 |
| San Benito | motorway | 5 | 99.990000/99.990000 | -57994.100000/-57994.700000 | 57994.100000/57994.700000 | 4/4 | 5/5 |
| San Benito | primary | 6 | 99.745000/99.765000 | -4378.000000/-4382.300000 | 4378.000000/4382.300000 | 5/5 | 6/6 |
| San Benito | secondary | 2 | 100.000000/100.000000 | -20999.900000/-20999.900000 | 20999.900000/20999.900000 | 1/1 | 2/2 |
| San Benito | tertiary | 1 | 99.950000/99.950000 | -28486.000000/-28486.800000 | 28486.000000/28486.800000 | 1/1 | 1/1 |
| San Benito | trunk | 4 | 99.965000/99.965000 | -21991.700000/-21991.800000 | 21991.700000/21991.800000 | 4/4 | 4/4 |
| Tulare | motorway | 26 | 99.980000/99.980000 | -62488.550000/-62489.250000 | 62488.550000/62489.250000 | 26/26 | 26/26 |
| Tulare | primary | 69 | 99.890000/99.880000 | -9878.300000/-9878.700000 | 9878.300000/9878.700000 | 67/67 | 69/69 |
| Tulare | secondary | 35 | 99.950000/99.950000 | -4986.500000/-4986.200000 | 4986.500000/4986.200000 | 28/27 | 35/35 |
| Tulare | tertiary | 5 | 99.980000/99.980000 | -25994.000000/-25995.500000 | 25994.000000/25995.500000 | 5/5 | 5/5 |
| Tulare | trunk | 5 | 99.840000/99.840000 | -12280.100000/-12280.400000 | 12280.100000/12280.400000 | 5/5 | 5/5 |
| Broomfield | motorway | 5 | 100.000000/100.000000 | -89997.300000/-89997.400000 | 89997.300000/89997.400000 | 5/5 | 5/5 |
| Broomfield | primary | 8 | 99.965000/99.975000 | -30992.800000/-30993.600000 | 30992.800000/30993.600000 | 7/7 | 8/8 |
| Broomfield | secondary | 1 | 99.990000/99.990000 | -15998.100000/-15998.500000 | 15998.100000/15998.500000 | 1/1 | 1/1 |
| Broomfield | tertiary | 3 | 100.000000/100.000000 | -17000.000000/-17000.000000 | 17000.000000/17000.000000 | 1/1 | 3/3 |
| Broomfield | trunk | 4 | 99.955000/99.965000 | -26493.350000/-26494.000000 | 26493.350000/26494.000000 | 4/4 | 4/4 |
| Pueblo | motorway | 26 | 99.975000/99.975000 | -35494.350000/-35494.500000 | 35494.350000/35494.500000 | 26/26 | 26/26 |
| Pueblo | primary | 34 | 99.910000/99.910000 | -17483.350000/-17483.500000 | 17483.350000/17483.500000 | 34/34 | 34/34 |
| Pueblo | secondary | 12 | 99.795000/99.800000 | -4198.000000/-4198.250000 | 4198.000000/4198.250000 | 12/12 | 12/12 |
| Pueblo | tertiary | 2 | 100.000000/100.000000 | -24500.000000/-24500.000000 | 24500.000000/24500.000000 | 0/0 | 2/2 |
| Pueblo | trunk | 6 | 99.960000/99.960000 | -12494.600000/-12494.850000 | 12494.600000/12494.850000 | 5/5 | 6/6 |

| County | Network class | Links | Loaded, baseline/candidate | Unloaded, baseline/candidate |
|---|---|---:|---:|---:|
| Merced | centroid_connector | 213 | 191/191 | 22/22 |
| Merced | construction | 127 | 0/0 | 127/127 |
| Merced | living_street | 3 | 0/0 | 3/3 |
| Merced | motorway | 1183 | 620/565 | 563/618 |
| Merced | pedestrian | 86 | 0/0 | 86/86 |
| Merced | primary | 3283 | 1378/1254 | 1905/2029 |
| Merced | residential | 40682 | 982/960 | 39700/39722 |
| Merced | rest_area | 4 | 0/0 | 4/4 |
| Merced | secondary | 5535 | 1813/1771 | 3722/3764 |
| Merced | service | 34915 | 56/56 | 34859/34859 |
| Merced | services | 12 | 0/0 | 12/12 |
| Merced | tertiary | 8119 | 1440/1380 | 6679/6739 |
| Merced | trunk | 635 | 491/491 | 144/144 |
| Merced | unclassified | 3953 | 158/160 | 3795/3793 |
| San Benito | centroid_connector | 60 | 49/49 | 11/11 |
| San Benito | construction | 1 | 0/0 | 1/1 |
| San Benito | living_street | 42 | 0/0 | 42/42 |
| San Benito | motorway | 609 | 198/196 | 411/413 |
| San Benito | pedestrian | 51 | 0/0 | 51/51 |
| San Benito | primary | 695 | 184/184 | 511/511 |
| San Benito | residential | 13688 | 176/172 | 13512/13516 |
| San Benito | rest_area | 3 | 0/0 | 3/3 |
| San Benito | secondary | 2644 | 394/389 | 2250/2255 |
| San Benito | service | 11360 | 17/11 | 11343/11349 |
| San Benito | services | 2 | 0/0 | 2/2 |
| San Benito | tertiary | 3446 | 502/506 | 2944/2940 |
| San Benito | trunk | 682 | 344/344 | 338/338 |
| San Benito | unclassified | 757 | 0/0 | 757/757 |
| Tulare | bridleway | 7 | 0/0 | 7/7 |
| Tulare | centroid_connector | 333 | 300/298 | 33/35 |
| Tulare | construction | 132 | 1/1 | 131/131 |
| Tulare | living_street | 124 | 0/0 | 124/124 |
| Tulare | motorway | 824 | 729/724 | 95/100 |
| Tulare | primary | 3577 | 2569/2567 | 1008/1010 |
| Tulare | residential | 32350 | 702/676 | 31648/31674 |
| Tulare | rest_area | 1 | 0/0 | 1/1 |
| Tulare | secondary | 5942 | 4297/4244 | 1645/1698 |
| Tulare | service | 32377 | 39/39 | 32338/32338 |
| Tulare | services | 3 | 0/0 | 3/3 |
| Tulare | tertiary | 8988 | 3666/3631 | 5322/5357 |
| Tulare | trunk | 489 | 234/233 | 255/256 |
| Tulare | unclassified | 5543 | 723/731 | 4820/4812 |
| Broomfield | bus_stop | 2 | 0/0 | 2/2 |
| Broomfield | centroid_connector | 96 | 85/85 | 11/11 |
| Broomfield | construction | 91 | 0/0 | 91/91 |
| Broomfield | living_street | 75 | 0/0 | 75/75 |
| Broomfield | motorway | 742 | 375/375 | 367/367 |
| Broomfield | pedestrian | 4 | 0/0 | 4/4 |
| Broomfield | planned | 5 | 0/0 | 5/5 |
| Broomfield | primary | 3039 | 818/818 | 2221/2221 |
| Broomfield | residential | 23146 | 119/128 | 23027/23018 |
| Broomfield | secondary | 3643 | 926/938 | 2717/2705 |
| Broomfield | service | 12898 | 2/4 | 12896/12894 |
| Broomfield | tertiary | 3703 | 301/298 | 3402/3405 |
| Broomfield | trunk | 238 | 200/200 | 38/38 |
| Broomfield | unclassified | 1544 | 57/57 | 1487/1487 |
| Pueblo | centroid_connector | 198 | 165/165 | 33/33 |
| Pueblo | construction | 77 | 0/0 | 77/77 |
| Pueblo | living_street | 47 | 0/0 | 47/47 |
| Pueblo | motorway | 621 | 467/466 | 154/155 |
| Pueblo | pedestrian | 3 | 0/0 | 3/3 |
| Pueblo | primary | 824 | 737/737 | 87/87 |
| Pueblo | residential | 14904 | 579/570 | 14325/14334 |
| Pueblo | road | 3 | 1/1 | 2/2 |
| Pueblo | secondary | 1502 | 1259/1236 | 243/266 |
| Pueblo | service | 14325 | 22/22 | 14303/14303 |
| Pueblo | services | 1 | 0/0 | 1/1 |
| Pueblo | tertiary | 3354 | 1454/1440 | 1900/1914 |
| Pueblo | trunk | 936 | 590/589 | 346/347 |
| Pueblo | unclassified | 1583 | 220/219 | 1363/1364 |

### Native convergence and repeat

| County | Arm | Iterations | Final relative gap | Converged |
|---|---|---:|---:|---|
| Merced | baseline | 41 | 0.000482686045 | True |
| Merced | candidate | 37 | 0.000466567940 | True |
| San Benito | baseline | 128 | 0.000467925865 | True |
| San Benito | candidate | 132 | 0.000486724979 | True |
| San Benito | repeat | 132 | 0.000486724979 | True |
| Tulare | baseline | 80 | 0.000455896765 | True |
| Tulare | candidate | 82 | 0.000422417907 | True |
| Broomfield | baseline | 14 | 0.000290918141 | True |
| Broomfield | candidate | 11 | 0.000350972101 | True |
| Pueblo | baseline | 25 | 0.000410838195 | True |
| Pueblo | candidate | 27 | 0.000471251579 | True |

San Benito candidate/repeat county median APE difference: 0.000000000000
percentage points, against the unchanged 0.1-point limit.
Candidate/repeat link-volume CSV hashes match: True.

### Round 2 commands and limits

Run these commands from the successor checkout. `PY` means
`/home/nathaniel/.local/state/openplan/s2-cordon-20261023/venv/bin/python3`.
Substitute that interpreter path for `$PY` in the commands below.

1. In `openplan/`, `npm run product:direction:check`: passes with the existing
   review-age and release-version reminders; no new product review is claimed.
2. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B scripts/modeling/s2_cordon/test_successor.py -v`:
   final result two passed, zero failed, zero skipped. The first attempt has
   one pass and one fixture setup error, retained above.
3. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B scripts/modeling/s2_cordon/prove_successor.py data/modeling/s2-cordon-impedance-successor-2026-10-23/mutation-controls.json`:
   one harmless survivor, three intended assertion failures, three restored
   test passes, zero skips, exact source restoration.
4. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B scripts/modeling/s2_cordon/test_study.py -v`:
   11 passed, zero failed, zero skipped, including the default byte comparison.
5. `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 $PY -B scripts/research/sealed_study.py run data/modeling/s2-cordon-impedance-successor-2026-10-23/lock.json`:
   one completed sealed execution, five preparations, 11 converged assignments,
   zero missing assignments. The development decision is not a test pass.
6. `git diff --check`: passes. Post-run SHA-256 and byte comparisons preserve
   all frozen files, seven predecessor records and the entire round 1 report.

Synthetic proof cannot establish real-county behavior or scientific validity.
This native run closes the execution gap for these five development counties.
It does not prove observation comparability, documented uncertainty intervals,
behavioral validity, independent or nationwide acceptance, ActivitySim accuracy,
full worker-stage delivery, browser or hosted operation, or machine-crash
recovery. No test skips occur in the executed suites. Full app QA, worker
matrix, build, browser, live database and hosted tests are not run. No hosted
system, Docker stack, held-out partition or consumed holdout partition changes.

Keep PR #375 as a draft. The lead owns selection of any next development
experiment. This round does not authorize another execution or default change.

## Round 3 addendum: the successor volume measurement is invalid

**The successor's scientific result is invalid for measurement reasons.**
The retained `PCE_*` columns contain volume/capacity ratios expanded by the
peak-hour factor, not daily passenger-car-equivalent volumes. This defect
invalidates the volume-based comparison and its interpretation as evidence
against the candidate. The recorded numbers, convergence records, exact repeat,
aggregate `rejected` result and registered `retire` decision above remain
unchanged. Retirement still prevents advancement. This annotation does not
replace the decision with an advance, repair old outputs or claim accuracy.

Round 3 makes no scientific assignment and opens no additional partition.
Any further experiment requires a **new preregistration approved by the lead**.
Use a supported, identified interpreter and prove measurement before opening
that experiment. Do not rerun either existing lock.

### San Benito trace locates the measurement failure

The read-only [trace](../../data/modeling/s2-cordon-measurement-diagnosis-2026-10-23/san-benito-trace.json)
records file hashes, matrix totals, source units, loaded-link distributions and
all 18 matched station identities. It reads the retained successor directory
and the original `u2-06069-base` development run. It runs no assignment or
replacement county score.

1. **Input demand is daily vehicle trips.** The 20-by-20 OD CSV totals
   268,937.03 trips. It is a labeled CSV, not an OMX demand core. Earlier demand
   metadata records mode choice and occupancy conversion, 115,237 internal
   trips and 153,700 external trips. Its rounded total is 268,937.0. All six
   retained source files match the corresponding original development inputs
   by SHA-256, including the network, OD, zones, skim and published counts.
2. **The public OMX read selects travel time.** The skim contains `distance`
   and `travel_time`; the evaluator selects `travel_time`, in minutes. It has
   380 positive off-diagonal cells. The evaluator maps its centroid-node index
   to the recorded zone ordering. The OMX correction does not read or scale
   demand.
3. **Assignment input retains the trips.** Baseline, candidate and repeat
   each record 268,937.03 daily trips and 26,893.703 representative-peak-hour
   trips. Each retained demand file has one core named `demand`. Its measured
   sum agrees with the period record to floating-point precision. These files
   have native AEM bytes despite their `.omx` suffix. The diagnostic loads a
   disposable `.aem` copy because the native loader opens files in write mode.
   It leaves the retained files unchanged. The live assignment receives the
   matrix object directly, so this filename mismatch does not cause the
   observed volume error.
4. **The class-flow output remains substantial.** Baseline has 1,864 positive
   links among 34,040 links. Its `demand_tot` median on positive links is
   340.053 representative-hour trips, its 95th percentile is 2,822.535, and
   its maximum is 6,065.111. Candidate has 1,851 positive links, median
   339.446, 95th percentile 2,777.006 and maximum 5,764.229. Repeat equals
   candidate. These are class-flow diagnostics, not repaired scientific scores.
5. **The PCE output loses its unit.** Baseline `PCE_tot` has positive-link
   median 3.766, 95th percentile 26.036 and maximum 85.301. Candidate has
   median 3.735, 95th percentile 25.084 and maximum 82.252. For example,
   baseline link 14233 carries 6,065.110946 period trips in `demand_tot`, but
   `PCE_tot` is 16.847530 instead of the corresponding daily class-flow value
   of 60,651.109457. Its two PCE directions equal `VOC_AB / 0.10` and
   `VOC_BA / 0.10`. The maximum directional identity error across San Benito
   baseline is 7.11e-15. The same dimensionally wrong relationship appears in
   every one of the 11 retained assignments, including the repeat.
6. **Unloaded matching does not explain the county-wide scale.** Of 27
   published observations, 18 survive matching and duplicate/exclusion rules;
   nine remain unmatched or excluded. Two matched primary links have exactly
   zero class flow in both arms. Three station diagnostics round to zero:
   links 16905 and 30540 are unloaded, while link 20543 has 0.781550 period
   trips but its erroneous PCE value of 0.008684 rounds to 0.0. Three stations
   sum paired carriageways. The study uses input-only spatial matching and
   retains all zero comparisons. No matching rule changes in this round.
7. **Observation comparability remains unresolved.** All 27 San Benito input
   counts are Caltrans 2023 two-way AADT, in vehicles per average day. The
   model expands a representative peak hour to a modeled day; its particular
   day definition and base year remain unknown. The inputs do not supply
   documented uncertainty intervals. The unavailability of uncertainty-aware
   scores for all 337 matched stations is a separate evidence limitation,
   not a consequence of choosing the wrong demand core.

The original San Benito output provides a useful unit check. It records
Python 3.11.15, NumPy 2.0.2, AequilibraE 1.6.2 and pandas 3.0.3. Its PCE daily
flow agrees with `demand_tot / 0.10` within 7.28e-12, with positive-link median
3,482.452 and maximum 61,780.679. Its retained validation summary records
91.1 percent median APE across 14 matches, not 43 to 63 percent. That older
run uses different matching, pandas and a 0.01 convergence target. It cannot
supply a like-for-like candidate score. The historical 43.29 percent selection
metric belongs to the one-county calibration study described in the August 25
uncertainty review; no selection-holdout artifact is opened here.

The first demonstrated loss of measurement units occurs in the engine's
result extraction, after class assignment and before daily expansion, VMT,
station scoring or rounding. The older and successor solvers do not have
identical settings, so this diagnosis does not claim every upstream numerical
value should match.

### The interpreter and NumPy interaction causes the defect

The sealed interpreter path reports **CPython 3.14.4 with NumPy 2.0.2**.
AequilibraE 1.6.2 calculates `voc = tot_flow / self.capacity[idx]` inside
`TrafficAssignment.results()`, then uses `tot_flow` again for the PCE columns.
On a sufficiently large synthetic array in that runtime, division overwrites
`tot_flow` with the capacity ratio. The synthetic fixture supplies 180 flow
units per direction and capacity 600. Six links return the correct total of
360; 40,000 links return 0.6. This reproduces the county output signature
without a network assignment or any scientific source.

A diagnostic control replaces that one expression in an in-memory function
copy with `np.divide(..., out=np.empty_like(tot_flow))`. The same large fixture
then returns 360 even under Python 3.14. No installed library file is edited.
This isolates the destructive division. It does not establish that other
operations in an unsupported numerical runtime are safe.

NumPy documents [broken temporary-elision heuristics on Python 3.14](https://github.com/numpy/numpy/issues/28681)
and the [subsequent reference-count correction](https://github.com/numpy/numpy/pull/29649).
The [NumPy 2.0 release notes](https://numpy.org/doc/2.0/release/2.0.0-notes.html)
limit supported Python versions to 3.9 through 3.12. A successful package
import, converged assignment and deterministic repeat do not establish
compatibility on Python 3.14.

A separate CPython 3.11.15 environment with the same AequilibraE 1.6.2,
NumPy 2.0.2, pandas 2.3.3 and SciPy 1.17.1 passes the unmodified small and
large result-adapter assertions. Both environments have byte-identical
`traffic_assignment.py`, SHA-256
`1ee79fed2add1d5a78862f30bbef04a1ff8e17efd06135b77c0d4a43f92de666`.
The [runtime/output record](../../data/modeling/s2-cordon-measurement-diagnosis-2026-10-23/runtime-and-output-signature.json)
binds both interpreter identities and all 11 retained output signatures.

### Fix and production exposure

The fix uses the reviewed CPython 3.11 runtime and refuses another interpreter.
`assignment_runtime.py` provides the shared check. County `run_assignment`
refuses before creating a demand output. The worker assignment factory refuses
before constructing an engine. Local dependency preflight refuses before
numerical imports or worker entry. Current synthetic study fixtures use their
test interpreter rather than inheriting the old scientific lock's absolute
interpreter. Future study preparation must first run
`workers/aequilibrae_worker/check_local_dependencies.py` in its selected
Python 3.11 environment, then run the measurement contract test.

No dependency version, demand default, peak factor, acceptance threshold or
matching policy changes. The code does not substitute another result column,
fit a scalar, patch the installed engine, or repair retained outputs.
CPython 3.12 and alternative interpreters also require separate review before
this pinned stack admits them. This is an explicit admission restriction,
not evidence that every other interpreter has the measured Python 3.14 bug.

Production source uses the same susceptible `results()` API. The worker call
exists since `352f68561` (March 19, 2026); the county call exists since
`cfa56ac41` (March 24, 2026). Those dates identify code exposure, not the first
corrupt run. Local package preflight added in `b1fc79843` (October 18) checks
package versions but omitted the interpreter. This round closes that gap.

The current hosted, county and standalone assignment Dockerfiles specify
Python 3.11. The standalone worker changed from Python 3.12 to 3.11 in
`e2d0de92e` on October 18. The retained original San Benito Python 3.11 run
does not show this unit defect. **No past hosted production run is confirmed
affected.** The current worker graph adapter also pins reviewed CPython 3.11 native
engine bytes before graph construction. The county study path does not use
that adapter. Production deployment histories and output inventories are not
inspected, as the task forbids hosted access. Earlier local runs under the
incompatible interpreter remain unassessed. Do not infer a first affected
production date from the source history. This round changes production source
admission, but deploys nothing.

### Proof, retained failures and limits

The requested branch checkout again refuses because `t3-6facce23` holds the
branch. Round 3 uses a clean detached checkout of
`504364117817e1a65c04fa6ca2a0dfd55042d840` in
`/home/nathaniel/.t3/worktrees/openplan/t3-25ef0c0d`, then pushes to the same
PR branch. Neither predecessor checkout changes.

All final checks run in the separate Python 3.11 environment under
`MemoryMax=6G` and `MemorySwapMax=0`. The two explicit defect probes use the
unchanged sealed Python 3.14 environment. Evidence lives in
[`s2-cordon-measurement-diagnosis-2026-10-23`](../../data/modeling/s2-cordon-measurement-diagnosis-2026-10-23/).

- Final focused suites pass **59 tests, zero failures, zero skips**: four
  runtime-admission tests, five measurement/synthetic-lock tests, 17 launcher
  tests, 11 worker assignment-setting tests, nine county assignment-setting
  tests, two complete synthetic successor tests and 11 study-unit tests.
  The synthetic successor uses invented inputs and five native assignments.
  No real-county assignment occurs in this round.
- The original-code reproducer fails as intended: large-array PCE is 0.6
  rather than 360. The explicit-division diagnostic passes on that same bad
  runtime. Both remain separately identified from the passing fixed-runtime
  contract. The pre-fix worker/preflight tests also fail their two intended
  refusal assertions before the fix.
- Final mutation proof records **eight intended assertion failures**, one
  harmless source mutation surviving three suites, and all 26 tests in those
  three restored suites passing. Sixteen recorded control invocations match
  their expected outcomes. Exact restoration passes; no skips occur. Faults
  remove interpreter admission or its worker/county/launcher calls, admit an
  unreviewed interpreter, remove the development-source refusal, restore the
  old synthetic interpreter, or substitute capacity-ratio-sized solver flow.
- The initial mutation campaign stops on a fixture import error, not a valid
  fault detection: spoofing Python 3.14 before importing SciPy requests the
  unavailable `annotationlib`. The retained failure record shows exact source
  restoration. A second fixture-scoping attempt runs the development-source
  check on the bad interpreter and receives the earlier interpreter refusal;
  it is also retained. The final campaign selects only the two numerical
  diagnosis probes for Python 3.14 and separates native checks from the
  lightweight worker test suite.
- The first regression sequence passes the 11 worker and nine county tests,
  then records one pass and one failure in the synthetic successor suite.
  Its copied lock still selects Python 3.14, which the new guard refuses.
  The synthetic-lock correction and mutation test precede the final passing
  sequence. The old failure is retained; no scientific lock changes.
- An initial native inspection probe tries to replace `results` on an engine
  instance; AequilibraE refuses that property assignment before execution.
  A subsequent class-level inspection runs on invented four-zone inputs only.
  Preliminary tiny fixtures correctly return flow and therefore do not expose
  the size-dependent defect. Neither is treated as county acceptance.
- Both frozen closures still match: **190/190 predecessor and 201/201
  successor files**. All prior result-document text remains an exact prefix;
  both record directories have no changes. Read-file hashes confirm retained
  demand, count, network, skim and output bytes remain unchanged.

The checks prove the runtime refusal, result-extraction defect and synthetic
fixed-runtime behavior. They do not prove that the old solver state, candidate
matrix, convergence statistic or all other numerical operations escaped the
unsupported-runtime defect. They do not establish a repaired county APE,
scientific accuracy, complete worker-stage delivery, an unaffected production
history, observation uncertainty, untouched acceptance or completed S2.
The earlier negative evidence remains negative evidence with its measurement
limit attached. Full app QA, the full worker matrix, build, browser, database,
Docker and hosted checks remain unexecuted. No held-out or consumed partition,
production system, managed service or secret is accessed.

## Round 4 addendum: runtime audit complete; successor preparation stops

**No second-successor scientific execution starts.** The runtime audit finds no
held-fixed input identified with the measured susceptible runtime. Preparation
then stops on an owner-authored verification command error. The driver invokes
`scripts/modeling/tests/test_screening_assignment_settings.py`, which does not
exist. Python exits 2 before that suite starts. The task says to stop on another
tooling failure, so this round makes no correction or retry and runs no further
successor test or mutation campaign. This is a preparation failure, not a model
rejection. No new advance/retire decision or county score exists.

### Runtime audit and dependencies

The [audit](RETAINED_RUNTIME_AUDIT_2026-10-23.md) inventories 898 file records:
**16 affected, nine unaffected for this defect, and 873 with unrecorded or
unresolved runtime attribution/susceptibility**. These are file counts, not
independent experiments. Locks, reports and results can describe one execution.
The inventory covers tracked modeling records and compressed assessments,
model-related review records, and five original development run summaries.
`scripts/research` has source modules but no retained output files of its own.
Exact fields, hashes and classification reasons appear in the linked inventory.

The affected scientific figures are round 2's five-county and road-class raw
APE, signed/absolute residuals, daily PCE/VMT and volume-based coverage and
retire comparison. Round 1 uses the same susceptible runtime but stops before
assignment. Fourteen August 28 comparison bases record Python 3.14.4 with
NumPy 2.5.1. Their exact extraction-runtime attribution and susceptibility remain
unverified; this audit does not label that different pair corrupt or safe.
The historical 62.80%, 43.29% and rejected 46.25% calibration selection metrics
remain runtime-unrecorded. No historical calibration figure supplies a cordon
input, baseline score or advancement threshold.

All five original `u2-<county>-base` summaries record Python 3.11.15, NumPy
2.0.2, AequilibraE 1.6.2 and pandas 3.0.3. All 30 held-fixed input hashes match
the registry. This same-run provenance excludes the identified Python 3.14
runtime defect; it does not independently attest each preprocessing stage or
clear historical pandas/graph, day/year, matching or observation-uncertainty
limitations. The input-runtime stop condition is not triggered. The later
verification-command failure independently stops preparation.

### Environment and partial proof

A new isolated environment lives at
`/home/nathaniel/.local/state/openplan/s2-cordon-py311-20261023/venv/`.
It uses CPython 3.11.15 without system-site packages. All nine numerical package
versions match round 1: AequilibraE 1.6.2, NumPy 2.0.2, pandas 2.3.3,
SciPy 1.17.1, Shapely 2.2.0, OpenMatrix 0.3.5.0, tables 3.11.1,
GeoPandas 1.2.0 and pyproj 3.7.2. The
[runtime manifest](../../data/modeling/s2-cordon-impedance-py311-2026-10-23/runtime-manifest.json)
records the interpreter hash, exact versions, all 48 installed distribution
wheel hashes and installed-file hashes excluding bytecode. It also hashes
both repository requirement files. No package or interpreter in the old
scientific environments changes.

The new `evaluate_py311.py` preserves the successor's scientific implementation.
Its source differences are a new study identifier and a runtime refusal before
numerical imports. New synthetic fixtures exercise that evaluator and the real
sealed protocol. These are preparatory sources, not a registered scientific lock.

Under `MemoryMax=6G` and `MemorySwapMax=0`, the checks complete as follows:

| Check | Outcome |
|---|---|
| Pinned dependency preflight on new Python 3.11 | Pass |
| Actual old Python 3.14 preflight | Expected refusal before numerical imports |
| Runtime-admission suite | 4 passed |
| Measurement and synthetic-lock suite | 5 passed, including the unmodified 40,000-link result adapter returning 360 PCE |
| New synthetic successor suite | 3 passed; five invented-network assignments complete, including repeat |
| Local launcher suite | 17 passed |
| Worker assignment-settings suite | 11 passed |
| Incorrect county test path | Exit 2; suite never starts; stop |
| Remaining regression checks | Not run |
| Runtime and new successor mutation campaigns | Not run; zero new mutation results |

The total is **40 tests passed, zero test failures or skips, and one verification
command error**. Five planned checks remain unexecuted: county assignment
settings, the existing successor suite, study-unit suite, graph probe and
package-pin suite. The prior round's 59 passes and eight mutation failures are
historical evidence and are not counted again here. The new guard has no
completed mutation proof in this round. Its prepared controller remains unrun.
The literal failed driver, outputs, hashes and
[disposition](../../data/modeling/s2-cordon-impedance-py311-2026-10-23/disposition.json)
remain versioned. The observed scope is `run-p1037863-i59683146.scope`.

### Custody and handback

The requested fetch succeeds; branch checkout refuses because the round 1
worktree still holds the branch. This round uses a clean detached checkout of
`277d0db681784cf79379dcec54d101a87b1213cd` at
`/home/nathaniel/.t3/worktrees/openplan/t3-b1b612ea`. It pushes only to the
existing draft PR branch. Earlier worktrees and frozen record bytes remain
unchanged. This addendum appends to the complete earlier result text. Read-only integrity
accounting confirms 190/190 round 1 closure files, 201/201 round 2 closure files,
the exact 42,672-byte earlier report prefix, and unchanged hashes for the other
897 audited records. `git diff --check` passes. These checks do not resume the
stopped validation sequence.

No second-successor preregistration or execution lock is committed. No receipt
or scientific result is created. All 11 planned real assignments, county and
road-class metrics, uncertainty-aware scores, repeat determinism and progression
decision remain unexecuted. The audit and preparation sources are reviewable,
but the tooling stop requires lead disposition before a continuation. The
existing county regression filename is
`scripts/modeling/tests/test_assignment_convergence_settings.py`; this round
does not run it after discovering the mistake.

No frozen or consumed scientific result is edited, rerun or regraded. No new
holdout source is opened. No build, browser, full app QA, full worker matrix,
Docker, hosted system, production service or secret is accessed. The audit
does not establish an unaffected hosted history, scientific validity or completed
S2. Keep PR #375 draft and keep the candidate off by default.

## Round 5 addendum: corrected driver and Python 3.11 preparation

The lead authorizes a second successor after reviewing the round 4 command
error. The requested fetch succeeds. Checkout exits 128 because
`t3-6facce23` still holds `work/s2-aeq-structural-experiment`. As in the earlier
rounds, this thread uses its clean isolated checkout, detached at
`b801d736321e8170a1e607c7a0544a39e18817d3`, in
`/home/nathaniel/.t3/worktrees/openplan/t3-ea6314aa`. The old worktree remains
unchanged. The lead's `assignment_runtime.py` import projection stays intact.
This checkout conflict occurs before scientific preparation and is not an
execution failure. No driver or study retries follow a failed verification.

### Every verification entry point exists before execution

The [precheck](../../data/modeling/s2-cordon-py311-round5-2026-10-23/driver-precheck.json)
lists 488 source/test files with existence results and hashes. All exist.
It includes the corrected driver, both mutation controllers and their source
projections. The table lists every direct verification entry point; each path
is relative to the repository root unless absolute. Fixture-generated files
are created by their tests, not expected to exist before the tests start.
The preserved round 4 driver and its failed output remain unchanged.

| File or command checked before use | Existence result |
|---|---|
| `/home/nathaniel/.local/bin/python3.11` | File exists; executable resolves to CPython 3.11.15 |
| `scripts/modeling/requirements.txt` | File exists; hash recorded |
| `workers/aequilibrae_worker/requirements.txt` | File exists; hash recorded |
| `data/modeling/s2-cordon-impedance-py311-2026-10-23/requirements-exact.txt` | File exists; hash recorded |
| `/home/nathaniel/.local/state/openplan/s2-cordon-py311-round5-20261023/venv/bin/python3` | File exists before driver |
| `/home/nathaniel/.local/state/openplan/s2-cordon-20261023/venv/bin/python3` | File exists; unchanged Python 3.14 refusal probe |
| `data/modeling/s2-cordon-py311-round5-2026-10-23/verification-driver.py` | File exists; corrected county reference |
| `workers/aequilibrae_worker/check_local_dependencies.py` | File exists |
| `workers/aequilibrae_worker/test_assignment_runtime.py` | File exists |
| `scripts/modeling/s2_cordon/test_measurement_contract.py` | File exists |
| `scripts/modeling/s2_cordon/test_py311_successor.py` | File exists |
| `workers/aequilibrae_worker/test_local_launchers.py` | File exists |
| `workers/aequilibrae_worker/test_assignment_settings.py` | File exists |
| `scripts/modeling/tests/test_assignment_convergence_settings.py` | File exists; replaces the nonexistent filename |
| `scripts/modeling/s2_cordon/test_successor.py` | File exists |
| `scripts/modeling/s2_cordon/test_study.py` | File exists |
| `workers/hosted-models/verify_graph_compatibility.py` | File exists |
| `workers/aequilibrae_worker/test_dependency_pins.py` | File exists |
| `scripts/modeling/tests/test_fresh_osm_mode_import_paths.py` | File exists; lead's projection retained |
| `scripts/modeling/s2_cordon/prove_py311_successor.py` | File exists; all named test methods exist |
| `scripts/modeling/s2_cordon/prove_measurement.py` | File exists; all named test methods exist |
| `scripts/modeling/s2_cordon/evaluate_py311.py` | File exists |
| `scripts/modeling/s2_cordon/validate.py` | File exists |
| `scripts/research/sealed_study.py` | File exists |
| `systemd-run`, `bash`, `env` | Resolve to `/usr/bin/systemd-run`, `/usr/bin/bash`, `/usr/bin/env` |

### Environment and preparation proof

The new venv uses CPython 3.11.15, AequilibraE 1.6.2, NumPy 2.0.2,
pandas 2.3.3, SciPy 1.17.1, Shapely 2.2.0, OpenMatrix 0.3.5.0,
tables 3.11.1, GeoPandas 1.2.0 and pyproj 3.7.2. Both repository requirement
files and the retained exact-version list supply installation constraints.
No installed library is patched. The
[runtime manifest](../../data/modeling/s2-cordon-py311-round5-2026-10-23/runtime-manifest.json)
records all 48 distribution archive hashes and installed-file hashes, excluding
bytecode. Interpreter SHA-256:
`9e7f0dd93c77a32d07aa66631b48116101db6266701b292ebdc56a30d6cc7924`.
Manifest SHA-256:
`8151954eb80f4a804d35fe2560212ded91816f209d2b206878f6e68aa5083fdf`.

All numerical installation, verification and mutation processes run under
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0`.
The verification scope is `run-p1157999-i59810031.scope`. The successor mutation
scope is `run-p1166116-i59758951.scope`; runtime mutation scope is
`run-p1173566-i59759345.scope`. The
[corrected driver and outputs](../../data/modeling/s2-cordon-py311-round5-2026-10-23/checks.json)
retain exact commands, exits and output hashes.

| Current check | Result |
|---|---|
| Python 3.11 dependency preflight | Pass |
| Actual Python 3.14 dependency preflight | Expected refusal before numerical imports |
| Runtime admission | 4 passed |
| Measurement contract | 5 passed; 40,000-link adapter returns 360 PCE |
| Python 3.11 synthetic successor | 3 passed; full preparation and five invented assignments |
| Local launchers | 17 passed |
| Worker assignment settings | 11 passed |
| County assignment settings | 9 passed |
| Existing synthetic successor | 2 passed; full preparation and five invented assignments |
| Study unit suite | 11 passed |
| Dependency pins | 7 passed |
| Fresh-OSM import projections | 1 passed, covering CLI and three image layouts |
| Native graph probe | Pass: two compressed links and route distance 2.0 |

Total: **70 tests passed, zero failed, zero skipped**, plus the graph probe and
two expected preflight outcomes. The
[runtime controls](../../data/modeling/s2-cordon-py311-round5-2026-10-23/runtime-mutation-controls.json)
complete all 16 expected invocations: one harmless mutation survives three
suites, eight injected faults fail their intended assertions, the actual
Python 3.14 defect reproduces, and the explicit-division diagnostic passes.
The restored suites pass 26 tests. The
[successor controls](../../data/modeling/s2-cordon-py311-round5-2026-10-23/successor-mutation-controls.json)
record one harmless survivor, four intended assertion failures and four restored
test passes. Both controllers confirm exact source restoration, with zero skips.
Mutation checks do not prove native solver correctness, county behavior,
scientific accuracy, hosted history or machine-crash recovery. Passing suites
are not counted again as additional distinct tests.

The second-successor [preregistration](S2_CORDON_IMPEDANCE_PY311_PREREGISTRATION_2026-10-23.md)
keeps the round 1 scientific sections byte-identical. The new lock must be
committed before scientific execution. At this preparation checkpoint no real
county assignment, receipt or result exists. Historical closures match
190/190 and 201/201 files, and the prior 49,421 report bytes remain intact.

### Sealed execution and flow sanity check

The second successor completes the sealed protocol with `evaluated_once` and
`rejected`. Development decision: **retire**. Scientific accuracy
remains **inconclusive**. All five preparations and all 11 assignments complete.
The validator accepts the registered arithmetic, not a scientific accuracy claim.

Preregistration commit: `60bc3874d907e7321feb54abb34f061259193724`.
Lock commit, pushed before execution: `5c23d44931141c8fa35a26640a7f8f653f61376b`.

Lock SHA-256: `9757977bbc41ab42ba232235e6d0a87df5381ae1b33a18964ddf19777c312ba9`.
Receipt SHA-256: `7def6a935709480e18b887f3248f5bdaddde6dc33e4612dca2775dd5d21d02c9`.
Aggregate SHA-256: `4adf3df8cf164b32d26ea1f8fc9fa59c210ee73c742ad008012efb5c5d086e3f`.

Exact command, run once from this checkout:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/.local/state/openplan/s2-cordon-py311-round5-20261023/venv/bin/python3 -B scripts/research/sealed_study.py run data/modeling/s2-cordon-py311-round5-2026-10-23/lock.json
```

The [execution precheck](../../data/modeling/s2-cordon-py311-round5-2026-10-23/execution-precheck.json)
confirms all 215 closure files and both command entry points exist, the archive
hash matches, all 30 member records remain unchanged, and receipt/result paths
are absent before execution. The candidate output is deliberately absent until
the evaluator writes it. The scratch directory exists. The live scope record
confirms `run-p1208951-i59793145.scope`, MemoryMax 6,442,450,944 bytes and
MemorySwapMax 0.

Evaluator exit: 0, signal: None, peak RSS:
1,114,337,280 bytes. Stdout: 0 bytes; stderr:
952193 bytes, SHA-256 `c7cb17fb29f1c648b861c06b7e532bc878ef2b60e2fadc71946b3d2efd98aa93`.
The protocol retains stream hashes, not stderr text; its contents remain unknown.

The [read-only sanity record](../../data/modeling/s2-cordon-py311-round5-2026-10-23/flow-sanity.json)
checks all 11 new link outputs before interpreting county scores. All use
`class_pce=1` and peak factor 0.10. Daily PCE agrees with class vehicle flow
divided by 0.10, including both directions. The output contains vehicle flows,
not capacity ratios. Positive-link medians and upper ranges have daily traffic
units and scale; very small positive flows remain in the record. This check
does not establish local traffic accuracy or annual-average-day comparability.

The station ratio is the median modeled daily corridor flow divided by the
published count, across every matched station including zeros. It is diagnostic,
not a fitted scalar. Baseline/candidate order applies below.

| County | Positive-link median daily vehicles | Positive-link 95th percentile daily vehicles | Maximum daily vehicles | Median modeled/observed ratio | Maximum PCE versus class-daily error |
|---|---:|---:|---:|---:|---:|
| Merced | 5827.506499/5960.483343 | 37163.164544/35374.676326 | 81359.147567/71461.857924 | 1.608085/1.538469 | 0 |
| San Benito | 3400.533813/3394.457438 | 28225.352097/27774.157542 | 60651.109457/57642.288263 | 0.631708/0.627092 | 0 |
| Tulare | 5141.187143/5122.673609 | 28244.433224/27802.461426 | 78048.114090/77718.318976 | 1.753845/1.753409 | 0 |
| Broomfield | 5795.753453/5258.491641 | 25487.605747/22605.223367 | 49279.520000/43133.107708 | 0.376348/0.406477 | 0 |
| Pueblo | 3696.105379/3618.668932 | 27885.827573/27116.483981 | 47954.960045/46468.151464 | 1.358120/1.326691 | 0 |

### County results and unchanged progression rules

Raw APE means absolute percent error against published counts. Improvement is
baseline median APE minus candidate median APE, in percentage points. These
are exposed development diagnostics. No pooled measure substitutes for a county.

| County | Split | Matched | Unmatched/excluded | Baseline APE (%) | Candidate APE (%) | Improvement (points) | Loaded stations baseline/candidate | Decision and reasons |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Merced | diagnosis | 78 | 27 | 79.260000 | 69.935000 | 9.325000 | 75/75 | advance: all criteria pass |
| San Benito | evaluation | 18 | 9 | 71.960000 | 73.440000 | -1.480000 | 16/16 | retire: evaluation_improvement_below_5_points, road_class_worsened:motorway |
| Tulare | evaluation | 140 | 42 | 94.080000 | 93.550000 | 0.530000 | 131/132 | retire: evaluation_improvement_below_5_points, road_class_worsened:secondary, road_class_worsened:tertiary |
| Broomfield | diagnosis | 21 | 0 | 78.590000 | 76.620000 | 1.970000 | 18/18 | advance: all criteria pass |
| Pueblo | evaluation | 80 | 5 | 45.720000 | 41.875000 | 3.845000 | 77/77 | retire: evaluation_improvement_below_5_points |

Uncertainty-aware excess APE remains unavailable for all 337 matched stations.
All 83 unmatched or excluded observations remain in coverage. None of the
five inputs supplies documented observation intervals and comparable model
day/year. No interval is invented, and no uncertainty adjustment rescues the
registered raw-error decision.

| County | Median signed residual, vehicles/day | Median absolute residual, vehicles/day | Uncertainty-aware excess APE | Affected matched observations |
|---|---:|---:|---|---:|
| Merced | 10888.450000/8377.100000 | 18494.150000/17714.700000 | unavailable/unavailable | 78/78 |
| San Benito | -6624.250000/-6542.600000 | 15041.750000/14815.800000 | unavailable/unavailable | 18/18 |
| Tulare | 7692.650000/7898.850000 | 13252.500000/13472.300000 | unavailable/unavailable | 140/140 |
| Broomfield | -17000.000000/-17000.000000 | 21501.400000/18303.200000 | unavailable/unavailable | 21/21 |
| Pueblo | 6500.850000/6191.350000 | 9262.950000/8529.000000 | unavailable/unavailable | 80/80 |

### Every scored road class remains visible

Values use baseline/candidate order. A class with fewer than five stations
still appears, although the preregistered class non-inferiority rule applies
at five stations. Missing count coverage is not a zero-error result.

| County | Road class | Matched | Median APE (%) | Signed residual, vehicles/day | Absolute residual, vehicles/day | Loaded stations | Uncertainty-aware excess APE |
|---|---|---:|---:|---:|---:|---:|---|
| Merced | motorway | 29 | 57.870000/53.230000 | -6379.400000/-9522.700000 | 29156.000000/27679.700000 | 28/28 | unavailable for 29/29 |
| Merced | primary | 33 | 144.770000/132.670000 | 12333.300000/10827.100000 | 12609.000000/10830.800000 | 33/33 | unavailable for 33/33 |
| Merced | secondary | 2 | 100.000000/100.000000 | -2100.000000/-2100.000000 | 2100.000000/2100.000000 | 0/0 | unavailable for 2/2 |
| Merced | tertiary | 1 | 27.780000/25.990000 | 2361.500000/2209.200000 | 2361.500000/2209.200000 | 1/1 | unavailable for 1/1 |
| Merced | trunk | 13 | 123.060000/91.980000 | 34272.900000/30812.400000 | 34272.900000/30812.400000 | 13/13 | unavailable for 13/13 |
| San Benito | motorway | 5 | 60.310000/63.980000 | -34584.600000/-36749.000000 | 34584.600000/36749.000000 | 4/4 | unavailable for 5/5 |
| San Benito | primary | 6 | 207.325000/180.125000 | 14792.300000/13043.850000 | 14792.300000/13043.850000 | 5/5 | unavailable for 6/6 |
| San Benito | secondary | 2 | 99.315000/99.350000 | -20902.100000/-20906.800000 | 20902.100000/20906.800000 | 2/2 | unavailable for 2/2 |
| San Benito | tertiary | 1 | 51.160000/52.790000 | -14581.900000/-15043.900000 | 14581.900000/15043.900000 | 1/1 | unavailable for 1/1 |
| San Benito | trunk | 4 | 26.750000/26.230000 | -4826.350000/-4887.150000 | 5926.700000/5905.450000 | 4/4 | unavailable for 4/4 |
| Tulare | motorway | 26 | 36.805000/36.605000 | -4234.500000/-8434.200000 | 25956.800000/25118.400000 | 26/26 | unavailable for 26/26 |
| Tulare | primary | 69 | 146.140000/145.100000 | 13404.300000/12849.300000 | 17704.600000/17776.000000 | 67/67 | unavailable for 69/69 |
| Tulare | secondary | 35 | 97.200000/99.930000 | -567.300000/-572.100000 | 5237.300000/5237.300000 | 28/29 | unavailable for 35/35 |
| Tulare | tertiary | 5 | 86.070000/89.510000 | -22379.400000/-23273.600000 | 22379.400000/23273.600000 | 5/5 | unavailable for 5/5 |
| Tulare | trunk | 5 | 313.900000/305.860000 | 36419.000000/35954.400000 | 36419.000000/35954.400000 | 5/5 | unavailable for 5/5 |
| Broomfield | motorway | 5 | 75.790000/76.620000 | -65098.900000/-66757.300000 | 65098.900000/66757.300000 | 5/5 | unavailable for 5/5 |
| Broomfield | primary | 8 | 78.980000/59.640000 | -1449.050000/-7351.750000 | 20075.300000/17055.800000 | 7/7 | unavailable for 8/8 |
| Broomfield | secondary | 1 | 46.370000/57.280000 | -7418.400000/-9164.300000 | 7418.400000/9164.300000 | 1/1 | unavailable for 1/1 |
| Broomfield | tertiary | 3 | 100.000000/100.000000 | -17000.000000/-17000.000000 | 17000.000000/17000.000000 | 1/1 | unavailable for 3/3 |
| Broomfield | trunk | 4 | 91.980000/81.725000 | 3258.050000/487.150000 | 20501.400000/17311.400000 | 4/4 | unavailable for 4/4 |
| Pueblo | motorway | 26 | 37.155000/37.455000 | 11295.800000/9803.400000 | 15898.950000/13832.000000 | 26/26 | unavailable for 26/26 |
| Pueblo | primary | 34 | 40.755000/37.300000 | 7822.850000/7149.000000 | 7892.800000/7333.850000 | 34/34 | unavailable for 34/34 |
| Pueblo | secondary | 12 | 255.695000/248.205000 | 5048.750000/4953.300000 | 5722.600000/5633.300000 | 12/12 | unavailable for 12/12 |
| Pueblo | tertiary | 2 | 100.000000/100.000000 | -24500.000000/-24500.000000 | 24500.000000/24500.000000 | 0/0 | unavailable for 2/2 |
| Pueblo | trunk | 6 | 47.580000/44.605000 | 4167.250000/4113.850000 | 5813.950000/5266.150000 | 5/5 | unavailable for 6/6 |

| County | Network class | Links | Loaded baseline/candidate | Unloaded baseline/candidate |
|---|---|---:|---:|---:|
| Merced | centroid_connector | 213 | 191/191 | 22/22 |
| Merced | construction | 127 | 0/0 | 127/127 |
| Merced | living_street | 3 | 0/0 | 3/3 |
| Merced | motorway | 1183 | 620/565 | 563/618 |
| Merced | pedestrian | 86 | 0/0 | 86/86 |
| Merced | primary | 3283 | 1378/1254 | 1905/2029 |
| Merced | residential | 40682 | 982/960 | 39700/39722 |
| Merced | rest_area | 4 | 0/0 | 4/4 |
| Merced | secondary | 5535 | 1813/1771 | 3722/3764 |
| Merced | service | 34915 | 56/56 | 34859/34859 |
| Merced | services | 12 | 0/0 | 12/12 |
| Merced | tertiary | 8119 | 1440/1380 | 6679/6739 |
| Merced | trunk | 635 | 491/491 | 144/144 |
| Merced | unclassified | 3953 | 158/160 | 3795/3793 |
| San Benito | centroid_connector | 60 | 49/49 | 11/11 |
| San Benito | construction | 1 | 0/0 | 1/1 |
| San Benito | living_street | 42 | 0/0 | 42/42 |
| San Benito | motorway | 609 | 198/196 | 411/413 |
| San Benito | pedestrian | 51 | 0/0 | 51/51 |
| San Benito | primary | 695 | 184/184 | 511/511 |
| San Benito | residential | 13688 | 176/172 | 13512/13516 |
| San Benito | rest_area | 3 | 0/0 | 3/3 |
| San Benito | secondary | 2644 | 394/389 | 2250/2255 |
| San Benito | service | 11360 | 17/11 | 11343/11349 |
| San Benito | services | 2 | 0/0 | 2/2 |
| San Benito | tertiary | 3446 | 502/506 | 2944/2940 |
| San Benito | trunk | 682 | 344/344 | 338/338 |
| San Benito | unclassified | 757 | 0/0 | 757/757 |
| Tulare | bridleway | 7 | 0/0 | 7/7 |
| Tulare | centroid_connector | 333 | 300/298 | 33/35 |
| Tulare | construction | 132 | 1/1 | 131/131 |
| Tulare | living_street | 124 | 0/0 | 124/124 |
| Tulare | motorway | 824 | 729/724 | 95/100 |
| Tulare | primary | 3577 | 2569/2567 | 1008/1010 |
| Tulare | residential | 32350 | 702/676 | 31648/31674 |
| Tulare | rest_area | 1 | 0/0 | 1/1 |
| Tulare | secondary | 5942 | 4297/4244 | 1645/1698 |
| Tulare | service | 32377 | 39/39 | 32338/32338 |
| Tulare | services | 3 | 0/0 | 3/3 |
| Tulare | tertiary | 8988 | 3666/3631 | 5322/5357 |
| Tulare | trunk | 489 | 234/233 | 255/256 |
| Tulare | unclassified | 5543 | 723/731 | 4820/4812 |
| Broomfield | bus_stop | 2 | 0/0 | 2/2 |
| Broomfield | centroid_connector | 96 | 85/85 | 11/11 |
| Broomfield | construction | 91 | 0/0 | 91/91 |
| Broomfield | living_street | 75 | 0/0 | 75/75 |
| Broomfield | motorway | 742 | 375/375 | 367/367 |
| Broomfield | pedestrian | 4 | 0/0 | 4/4 |
| Broomfield | planned | 5 | 0/0 | 5/5 |
| Broomfield | primary | 3039 | 818/818 | 2221/2221 |
| Broomfield | residential | 23146 | 119/128 | 23027/23018 |
| Broomfield | secondary | 3643 | 926/938 | 2717/2705 |
| Broomfield | service | 12898 | 2/4 | 12896/12894 |
| Broomfield | tertiary | 3703 | 301/298 | 3402/3405 |
| Broomfield | trunk | 238 | 200/200 | 38/38 |
| Broomfield | unclassified | 1544 | 57/57 | 1487/1487 |
| Pueblo | centroid_connector | 198 | 165/165 | 33/33 |
| Pueblo | construction | 77 | 0/0 | 77/77 |
| Pueblo | living_street | 47 | 0/0 | 47/47 |
| Pueblo | motorway | 621 | 467/466 | 154/155 |
| Pueblo | pedestrian | 3 | 0/0 | 3/3 |
| Pueblo | primary | 824 | 737/737 | 87/87 |
| Pueblo | residential | 14904 | 579/570 | 14325/14334 |
| Pueblo | road | 3 | 1/1 | 2/2 |
| Pueblo | secondary | 1502 | 1259/1236 | 243/266 |
| Pueblo | service | 14325 | 22/22 | 14303/14303 |
| Pueblo | services | 1 | 0/0 | 1/1 |
| Pueblo | tertiary | 3354 | 1454/1440 | 1900/1914 |
| Pueblo | trunk | 936 | 590/589 | 346/347 |
| Pueblo | unclassified | 1583 | 220/219 | 1363/1364 |

### Convergence and repeat determinism

| County | Arm | Iterations | Final relative gap | Converged |
|---|---|---:|---:|---|
| Merced | baseline | 41 | 0.000482686045 | True |
| Merced | candidate | 37 | 0.000466567940 | True |
| San Benito | baseline | 128 | 0.000467925865 | True |
| San Benito | candidate | 132 | 0.000486724979 | True |
| San Benito | repeat | 132 | 0.000486724979 | True |
| Tulare | baseline | 80 | 0.000455896765 | True |
| Tulare | candidate | 82 | 0.000422417907 | True |
| Broomfield | baseline | 14 | 0.000290918141 | True |
| Broomfield | candidate | 11 | 0.000350972101 | True |
| Pueblo | baseline | 25 | 0.000410838195 | True |
| Pueblo | candidate | 27 | 0.000471251579 | True |

San Benito candidate/repeat median APE difference is
0.000000000000 percentage points, against the unchanged
0.1-point limit. Link-volume CSV hashes match:
True.


### Disposition, custody and remaining limits

**Retire the candidate from advancement under this preregistration.** All three
evaluation counties miss the five-point improvement rule. San Benito motorway
median APE worsens by 3.670 points; Tulare secondary worsens by 2.730 and
tertiary by 3.440. Each class has at least five matched stations and exceeds
the unchanged one-point worsening limit. Merced and Broomfield pass their
diagnosis rules, but cannot rescue those failures. No county loses a loaded
observed station. All assignments converge, candidate cells change, conservation
holds, and repeat is deterministic. Those checks do not override failed criteria.

This corrected development comparison does not show the round 2 capacity-ratio
artifact. Across all 11 outputs, total and directional PCE versus expanded
class-flow differences are exactly zero at retained CSV precision. Positive-link
medians span 3,394 to 5,960 daily vehicles, and maxima span 43,133 to 81,359.
These are plausible daily flow magnitudes, not evidence that each local road
is modeled accurately. The raw residuals and observation limits remain material.
The read-only sanity scope is `run-p1306269-i59894438.scope`; all 33 output
files exist before inspection. No output is repaired or rescored to change the
registered decision. The sanity script records both volume and capacity-ratio
distributions and retains all zero-flow matches in its station ratios.

The [post-execution preservation record](../../data/modeling/s2-cordon-py311-round5-2026-10-23/post-execution-preservation.json)
confirms **190/190 round 1, 201/201 round 2 and 215/215 current closure files**.
All **8,353 recorded installed files** and the interpreter hash match the
runtime manifest. All 30 original member records and the archive hash match.
The original 49,421-byte result-report prefix remains unchanged. Scientific
preregistration sections remain byte-identical to round 1. This round changes
no existing source under `scripts/` or `workers/`; the lead's import projection
is preserved. `git diff --check` passes.

The runtime manifest, prechecks, mutation proof, lock, receipt, aggregate,
flow sanity record and preservation accounting remain versioned under
`data/modeling/s2-cordon-py311-round5-2026-10-23/`. Retained county diagnostics
remain under `/home/nathaniel/.local/state/openplan/s2-cordon-py311-round5-20261023/execution/`.
No frozen predecessor byte, receipt, negative result or consumed partition is
changed. No holdout source is opened. ActivitySim does not run; methods are
never averaged. No scalar, default, criterion or claim tier changes.

Keep PR #375 draft and the opt-in candidate off by default. S2 remains incomplete.
Uncertainty-aware accuracy, model day/year comparability, input-stage scientific
validity, independent geographic acceptance and nationwide accuracy remain
unverified. Historical runtime gaps in the round 4 audit remain unresolved.
Full worker delivery, full app QA, browser, database, hosted operation and
machine-crash recovery are not tested. No `next build`, Docker stack, production,
Vercel, Railway, managed Supabase or secret is accessed. This round does not
authorize another experiment or select a successor from new evidence.
