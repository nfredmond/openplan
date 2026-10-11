# Populated model journal snapshot candidate, October 11

The operator command copies a private model command journal through SQLite's
backup API, including committed WAL records. A plain main-file copy loses
records in the same native fixture. This is a bounded M3 improvement to the
existing backup method. It does not complete installation-wide recovery.

## Behavior and custody

[The command](../../../openplan/scripts/ops/worker_journal_snapshot.py) requires
a declared maintenance cut, a private operator-owned journal and a new output
directory under a private operator-owned parent. It rejects symlinks, hard
links, wrong file types, accessible or foreign-owned paths, another database
name, and outputs inside the source journal directory. It normalizes `..`
paths after rejecting symlink ancestors. It never reuses an existing output.

The source connection is read-only and reads committed WAL pages. The copied
database must pass native integrity and command-table checks. The command
records its size and SHA-256 hash, syncs the file, atomically links the completed
private metadata receipt, and syncs both destination and parent directories.
A directory sync failure removes the completion receipt if the filesystem
permits, and returns failure. Receipt presence alone is not successful completion.
Failed directories remain private. The command does not remove them or overwrite
them on retry. Metadata stdout omits source paths and command contents.

The declared quiescence flag is not a writer fence. Operators must establish
the coordinated cut before calling the command. The progress deadline bounds
backup and lock retries; it cannot bound every filesystem operation. See the
[operator instructions](../../../openplan/docs/ops/BACKUP_AND_RESTORE.md).
The method follows [SQLite's backup API](https://sqlite.org/backup.html) and
the [Python connection API](https://docs.python.org/3.14/library/sqlite3.html#sqlite3.Connection.backup).

## Native checks and failure controls

[The focused tests](../../../openplan/scripts/ops/tests/test_worker_journal_snapshot.py)
use the actual model journal and computation checkpoint modules. An open WAL
connection holds committed rows outside the main file. The fixture contains
two commands, one pending and one resolved, plus a retained result and an
interrupted computation start. The copied database preserves every fixture
row and the original source records. The restored saved result returns without
a callback; the interrupted start refuses another callback. These callbacks
are synthetic record producers, not model engines or scientific validation.

The native CLI succeeds on the populated WAL fixture. Another native CLI exits
with failure at its short deadline while the source has an exclusive lock.
A deliberately changed index value creates a validly readable but inconsistent
database; native integrity checking rejects it without a completion receipt.
Private modes, output refusal, source write refusal, record size/hash, metadata
privacy, sync ordering and publication/sync failures have separate checks.

[Final controls](evidence/controls.json) pass baseline, harmless comment,
harmless JSON formatting and restored runs of all 23 focused tests. All 29
targeted broken variants fail at their intended assertions. They include
main-file copying, ignoring WAL, lost receipts/starts, writable source access,
omitted path/identity/schema/integrity/deadline checks, false hashes/sizes,
missing syncs, non-atomic publication, retained failed receipts and stdout
disclosure. Mutation copies restore in `finally`; application source stays
unchanged. [Pre-execution hashes](evidence/pre-execution-source-sha256.json)
match the final executed helper, tests and control driver.

The control service exits 0 under a 512 MiB cap, no swap and one CPU, peaking
at 41,779,200 bytes. The complete ops regression passes 141 tests in 12.292
seconds. Its service exits 0 under a 1 GiB cap, no swap and one CPU, peaking
at 71,237,632 bytes. Python is 3.14.4 on this Linux host. Current head CI
requires separate inspection after publication.

## Retained failed trials

The first control run fails because its symlink fixture also falls inside the
source directory. The second fails because the invalid-file-type fixture has
the same placement problem. Corrected fixtures put those inputs under separate
private parents. The third run passes 26 variants before later review adds the
hard-link and normalized-path cases. The fourth fails because the new hard-link
predicate classifies a directory after the file-type guard is deliberately
removed. The predicate now applies to regular files. The fifth, final run passes
all 29 variants. These are distinct runs, not a promotion of earlier failures.
[Failure records](evidence/failed-controls-01.json),
[the second failure](evidence/failed-controls-02.json) and
[the fourth failure](evidence/failed-controls-04.json) retain their source
capture timing and service outcomes. Private executed source copies and logs
remain outside Git, with their hashes recorded where available.

## Limits and disposition

These checks cover one populated SQLite journal and retained local behavior.
They do not establish a full worker-root inventory, PostgreSQL/Storage alignment,
current server receipt reconciliation, all-worker restoration, live writer
fencing, path-race resistance against another same-user process, physical
power-loss recovery, another host or clean agency commissioning. The owner
mismatch test changes the UID predicate; it is not a second-user login test.
Native sync calls and injected failures prove ordering and refusal, not recovery
after losing hardware. No GUI, browser, practitioner or scientific acceptance
is added. AequilibraE and ActivitySim acceptance remains separate for every use.

The candidate branch is based on PR199's recovery evidence and awaits its own
review and CI. Hosted coordination and the main merge hold remain with the
relaunch agent. This work changes no deployment, migration, worker protocol,
model algorithm, hosted schema or release version.
