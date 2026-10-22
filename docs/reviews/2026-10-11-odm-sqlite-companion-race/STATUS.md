# Concurrent aerial journal access tolerates retired SQLite companions

The original PR226 GitHub run fails in an older journal controller's restored
positive run, after the worker suites pass. Its diagnostic omitted subprocess
stderr. The first correction exposes that output. A later GitHub run passes, but
that pass does not explain the earlier failure.

On installed Python 3.11.15, 20 full 52-test repeats and the older 57 controls
pass. A separate serial native stress run then fails on its 82nd pair of
concurrent admission/start tests. Another SQLite connection removes the transient
`-shm` file between the existence check and `lstat`, raising `FileNotFoundError`.
GitHub uses Python 3.11.17. The reproduced local defect does not prove the exact
cause of the earlier hidden hosted failure.

The journal now tolerates only `FileNotFoundError` while validating transient
`-wal` and `-shm` companions. Original database and directory checks retain their
existing refusal rules. Present companions still require private ownership and
ordinary files without aliases. Permission errors and other I/O errors propagate
before SQLite opens. This is a cooperative local-writer boundary, not a hostile
same-user file-race claim.

Two new tests use actual private SQLite admissions. One moves a companion after
its existence check and before the original `lstat`, then restores the fixture
in `finally`. The other asserts that unavailable companions cannot reach SQLite.
Targeted source variants remove the disappearance allowance or broaden it to all
I/O errors. Both fail at the intended diagnostic. The historical journal control
runner now retains positive-run stderr and covers these tests.

All 54 tests and 59 controls pass on installed Python 3.11.15 and 3.14. Two
new targeted variants fail for the intended reasons. All 200 serial native
concurrency pairs pass after the correction, in 49.032 seconds. The initial
[failed repeats](evidence/failed-concurrency-repeats.json) remain beside the
[corrected repeats](evidence/fixed-concurrency-repeats.json),
[control results](evidence/python311-controls.json) and
[exact source bindings](evidence/verification.json). The corrected owned service
runs under 256 MiB, one CPU and no extra swap. Its final journal reports 65.8 MiB
peak; the unit unloads before final property capture, so exact final bytes remain
unavailable. A guarded publication helper refuses that unloaded state; the source
checkpoint precedes this evidence publication. [Resources](evidence/resources.json)
preserve failed and passing outcomes. All three owned services have zero active
PID and stop. Small fixtures do not establish maximum-job capacity, power-loss
recovery or live application authority.

Stopped-root recovery and the committed GitHub head require separate verification.
Main merges remain held. No public contract, worker default, deployment, database
migration or hosted-system changes are part of this correction.

Implementation and controlled checks belong to GPT-6.1 Sol at high reasoning.
They do not constitute an independent review or full worker-recovery acceptance.


## Inherited actual CI commands pass with corrected source

All 16 [actual inherited YAML commands](evidence/actual-ci-steps.json)
pass locally, including every one of the 16 aerial suites and historical source
controls. Native journal capture/replay passes. Repeated owned runtime
preparation interruption, two-root capture and original-task resumption passes
with 26 observations/81 controls, in 1.189 seconds.
[Current bindings](evidence/preparation-native-source-bindings.json) retain
the corrected journal and exact candidate worker files. Earlier preparation
proofs remain historical. Full worker recovery stays false; no engine/callback
transport, decoding or live authority runs.

The serial actual-CI service reaches its 256 MiB configured limit and exits zero.
Final cgroup memory-event counters are unavailable, so no event-count or spare
capacity claim follows. It has zero active PID and stops. A publication helper
initially expects the historical journal summary under the wrong filename; the
actual `result.json` remains intact and publishes through the corrected path.
GitHub checks for the next committed head remain separate.

All 14 nested application documentation tests and the product direction check
pass. Existing direction reminders stay visible. The serial documentation unit
peaks at 285,016,064 bytes under 1 GiB, exits zero and stops.


## Exact-head GitHub identifies a separate fixture race

The committed `530637b1f` run passes journal checks but fails in native HTTP
recovery while reading a partial listener. The [separate readiness correction](../2026-10-11-odm-native-readiness-race/STATUS.md)
reproduces that actual failure deterministically and publishes complete listener
JSON atomically. This does not revise the retained original SQLite counterexample.
