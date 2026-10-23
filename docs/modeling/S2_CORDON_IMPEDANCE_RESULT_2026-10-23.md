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
