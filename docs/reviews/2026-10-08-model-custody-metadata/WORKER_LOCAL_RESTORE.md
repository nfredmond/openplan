# Worker local restore evidence, October 8, 2026

The synthetic local restore proof preserves an unresolved command, exact input
and output file bytes, and an interrupted computation start. The restored start
refuses another computation call. This is one part of a combined recovery proof;
it does not establish that a PostgreSQL backup and worker records agree.

Run from the repository root:

```bash
python docs/reviews/2026-10-08-model-custody-metadata/prototype/verify_worker_local_restore.py
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
