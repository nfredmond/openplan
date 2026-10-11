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

Verification results and resource records follow after the corrected run. Main
merges remain held. No public contract, worker default, deployment, database
migration or hosted-system changes are part of this correction.

Implementation and controlled checks belong to GPT-6.1 Sol at high reasoning.
They do not constitute an independent review or full worker-recovery acceptance.
