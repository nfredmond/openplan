# Worker local restore evidence, October 8, 2026

The synthetic local restore proof preserves an unresolved command, exact input
and output file bytes, and an interrupted computation start. The restored start
refuses another computation call. This is one part of a combined recovery proof;
it does not establish that a PostgreSQL backup and worker records agree.

Run from the repository root:

```bash
python3 docs/reviews/2026-10-08-model-custody-metadata/prototype/verify_worker_local_restore.py
```

The proof uses the actual command journal, legacy KPI command preparation and
computation checkpoint modules. It holds a SQLite connection open and confirms
that committed WAL bytes exist. It copies the journal through SQLite's backup
API, restores the synthetic files into a separate directory, and compares the
complete pending command and file hashes. It then invokes the actual computation
helper and confirms that the interrupted start refuses replay without calling
the computation callback. Temporary directories are removed after the proof.

Baseline, harmless filesystem timestamp change and restored baseline pass.
Three adverse controls fail for their intended reasons:

- Copying only the main SQLite file loses the pending command.
- Removing an output file breaks the file inventory comparison.
- Removing the computation start breaks the retained-start comparison.

The committed JSON records the exact observed outcomes. The snapshot function
handles this known fixture only. It is not an operator backup tool and does not
claim arbitrary directory, symlink, permission, power-loss or concurrent writer
safety. The fixture has no credentials or real model data.

## Remaining combined proof

Quiesce writers before taking the coordinated backups. Create a native database
command whose reply is lost after commit, retain its unresolved local request,
and back up both stores. Restore PostgreSQL into a separate owned database and
the worker files into a fresh directory. Preserve the logical installation
identity for this same-installation restoration. Use a fresh recovery process
to deliver the original request and compare current database rows and receipts
independently. A locally cached receipt cannot establish current database state.
Verify wrong-installation refusal and incomplete-restore controls separately.

This proof does not cover PostgreSQL, Storage, a running worker's quiescence,
server receipt reconciliation, the full dispatcher, browser acceptance, actual
model computation or scientific acceptance. It does not authorize whole-stage
replay or release the integration candidate.

## Combined native database and local restore result

The coordinated proof now passes. It clones the owned migration-18 fixture,
creates a synthetic new run and observed stage start, and delivers a retained
KPI command through a private PostgREST bridge. The bridge drops the TCP reply
after the server commits. The fresh CLI reports delivery uncertainty, and the
local journal retains the original unresolved request.

With the owned gateway stopped and no database sessions remaining, the proof
takes a full custom-format PostgreSQL dump and a SQLite-backup copy of the local
journal plus synthetic files. It restores the dump into a fresh template0
database and the local files into a fresh directory. Exact rows across eight
model tables agree before recovery. The local request and file bytes agree.
The interrupted computation refuses to call its computation callback again.

The original logical installation URL and ID remain bound through the private
bridge while the underlying restored database changes. A fresh CLI process
redelivers the original unresolved command. Both HTTP request hashes and server
receipts agree, and database rows remain unchanged after delivery. There are two
HTTP requests, one before backup and one after restore, and one retained output.
A subsequent cached receipt causes no HTTP request and is not used as proof of
current database state.

A different installation ID is refused before transport. Removing the restored
KPI or execution-start record inside rollback-only transactions causes the row
comparison to reject the incomplete image. A harmless serialization change
preserves the comparison. All control changes roll back, and source rows remain
unchanged.

Private evidence is
`model-command-client-20261008-proof/coordinated-restore-v1/candidate.json`.
The successful unit is `openplan-coordinated-restore-v2.service`, invocation
`17f1242c4b2f4a648e94d69611728b54`. The earlier v1 waiting wrapper exited before
executing any proof because systemd removed the completed QA unit. The unchanged
proof then ran after both prior jobs were confirmed terminal. This was a queue
wrapper failure, not a failed restore.

The test uses a full native dump but compares eight model tables and the named
synthetic local files. It does not establish all-table inventory equivalence,
database-property portability, cluster-role reconstruction, a different physical
host, Storage bytes, real-worker quiescence, current managed-attempt ownership,
full dispatcher recovery, browser acceptance or scientific acceptance. No
application database was changed and no stage replay was authorized.
