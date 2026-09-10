# Backup and restore OpenPlan

A recovery point must cover PostgreSQL, Supabase Storage object bytes, required
local worker artifacts, deployment configuration and secrets. Database metadata
alone cannot recreate the files it references. Keep versions, hashes and a state
inventory with every recovery point. Use [SELF_HOSTING](../SELF_HOSTING.md) to
identify your topology and [FIRST_DEPLOYMENT](../FIRST_DEPLOYMENT.md) to record
acceptance.

The archive example below is specific to the default Supabase CLI local stack.
It is not a tested universal procedure for hosted Supabase or an independently
self-hosted production stack. The disposable drill has a full database and
Storage mode for matching default-local images, alongside the older selected-row
sample. Neither mode captures external worker files or protected configuration.

## Inventory and consistency before capture

Record the database/Storage services, app and worker versions, persistent mounts,
required `local://` model results and county-run inputs/outputs, manifests and
source hashes. Determine which caches can actually be reconstructed from retained
sources; do not assume every directory outside Supabase is disposable.

Include protected copies of configuration, Auth settings and required encryption
keys. In particular, preserve `OPENPLAN_INTEGRATION_KEY_SECRET` for encrypted
workspace keys. A database dump does not include every cluster-level role or
service configuration. Keep the information needed to recreate those alongside
its matching software versions. Store backups privately outside the repository
and chat, with a protected independent copy and an agency retention policy.

Establish a consistent cut across database rows, object bytes and local artifacts.
The commands below run sequentially and do not establish that consistency on
their own. Use a documented maintenance window that quiesces all relevant app,
worker, upload and external writers, or a tested coordinated snapshot procedure.
Record the chosen method and interval. Resume writers only after capture and
inventory completion. A backup taken while those writers continue is not yet a
proved consistent recovery point.

## Capture the default local stack

From the nested `openplan/` app directory, confirm the selected project and its
actual container/storage layout. These examples assume the default CLI project
id, `openplan`, and Storage bytes under the storage container's `/mnt`. Adjust
only after verifying your topology. Check available space for every inventoried
volume and the protected backup destination.

Run the following as a Bash script after establishing write quiescence. The
placeholder directory must be replaced with a private destination you control.
The shell stops on a failed archive command; retain failed captures as incomplete
until resolved.

```bash
set -euo pipefail
umask 077
OPENPLAN_BACKUP_DIR="/path/you/control/openplan-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$OPENPLAN_BACKUP_DIR"
docker exec supabase_db_openplan pg_dump -U postgres -d postgres --format=custom \
  > "$OPENPLAN_BACKUP_DIR/postgres.dump"
docker exec supabase_storage_openplan sh -c 'cd /mnt && tar -czf - .' \
  > "$OPENPLAN_BACKUP_DIR/storage.tgz"
test -s "$OPENPLAN_BACKUP_DIR/postgres.dump"
test -s "$OPENPLAN_BACKUP_DIR/storage.tgz"
(
  cd "$OPENPLAN_BACKUP_DIR"
  sha256sum postgres.dump storage.tgz > SHA256SUMS
)
```

These two archives exclude separately mounted local worker files and protected
configuration. Capture every other item in the inventory under the same
consistency interval, with access controls and hashes. No universal worker-volume
archive script exists here; record the exact selected paths and their owners.

Check archive structure using the source container's PostgreSQL tooling and local
tar, then verify hashes:

```bash
docker exec -i supabase_db_openplan pg_restore --list \
  < "$OPENPLAN_BACKUP_DIR/postgres.dump" > /dev/null
tar -tzf "$OPENPLAN_BACKUP_DIR/storage.tgz" > /dev/null
(
  cd "$OPENPLAN_BACKUP_DIR"
  sha256sum --check SHA256SUMS
)
```

The hash file uses paths relative to the recovery directory so it can travel
with the archives. Repeat verification on the protected copy. Nonempty files,
readable archive indexes and matching hashes establish capture integrity;
they do not establish complete coverage or a successful restore. Measure those
by restoring and reopening the actual saved work.

## What the disposable drill exercises

From the app directory:

```bash
npm run ops:restore-drill -- --full-archive
```

This creates two fresh disposable Supabase projects, seeds synthetic saved work,
quiesces the source API/Auth/Storage writers, captures the full PostgreSQL custom
archive and Storage volume, and restores both into the isolated target. It creates
no app workers and refuses scheduled SQL jobs. Never point this test at a working
agency database. The script verifies project ownership and matching runtime images
before capture and refuses existing target records or incompatible cluster roles.

The recovered database is built from `template0` with the original database owner,
grants and settings. The target bootstrap database is retained under a separate
name with connections disabled. Schema, all discovered non-system tables, large
objects, materialized views, sequence positions, database properties and Storage
file hashes are compared. A schema-only replay accounts for PostgreSQL's own
normalization of SQL expressions. Private settings are hashed in evidence.

The drill independently reconstructs two overlapping OWP cycles from retained
records, including old and corrected approvals, unpaid claims, commitments,
refund matches and separate costs. It also checks restored password sign-in,
private document bytes and live RLS. Its synthetic prior reporting period is an
interim closed period; this is not proof of a completed real agency year-end.

The implementation is in [disposable-restore-drill.sh](../../scripts/ops/disposable-restore-drill.sh),
[full_restore.py](../../scripts/ops/full_restore.py) and
[the independent reconstruction](../../scripts/ops/reconstruct_owp_restore.py).
[Current evidence](../../../docs/reviews/2026-09-09-owp-full-recovery/VERIFICATION.md)
records the accepted build and remaining checks. The scheduled Restore Drill
workflow runs the full mode. `npm run ops:restore-drill` without arguments retains
the smaller selected-row and Storage API sample for comparison.

On Linux, both modes select unused six-port blocks between 20000 and 31987,
excluding the kernel outbound connection range and the source stack's ports.
They do not stop existing listeners. A later port collision fails the drill.
Cleanup stops only projects created by the current invocation. Set
`OPENPLAN_RESTORE_KEEP=1` to retain those projects and private scratch files for
browser follow-up; the output identifies both. Set
`OPENPLAN_RESTORE_EVIDENCE_DIR` to a protected output directory to retain sanitized
inventory and reconstruction summaries. Raw archives, Auth responses, passwords
and settings must remain private.

This mode does not restore external worker artifacts, custom cluster roles,
delegated database grants, encryption configuration, external Auth providers or
outgoing services. It does not implement a production cutover. Rehearse the whole
inventory for the selected deployment before relying on that recovery procedure.

## Rehearse and perform a real recovery

A recovery that replaces durable state is destructive and requires the deployment
owner's explicit approval. First restore into an isolated target; do not develop
a restoration recipe against the only working copy.

1. Select and record the recovery point, verify hashes and inventory coverage,
   and preserve the damaged state where feasible for diagnosis.
2. Provision an isolated target matching the required software/configuration,
   roles, extensions and storage backend. Prevent external callbacks, scheduled
   jobs and outgoing messages from acting on the restored copy during rehearsal.
3. Use a topology-specific procedure to restore PostgreSQL, Storage bytes,
   protected configuration and local artifacts, preserving paths and ownership.
   Full `pg_restore` ordering and service-role/Auth compatibility still require
   a tested OpenPlan procedure for the selected production topology.
4. Verify row relationships and representative object/local-artifact hashes.
   Test sign-in and private/public boundaries, reopen saved planner work, inspect
   exports and confirm worker result access against the restored instance.
5. Run `npm run test:rls-live` only against an explicitly configured disposable
   local test target. The suite creates test records; it is not a read-only
   production health check. Preserve skipped or failed results as unproved.
6. Record data loss relative to the recovery point, elapsed recovery time,
   required manual steps and all unresolved differences. Compare them with the
   agency's recovery objectives.
7. Prepare an approved cutover with controlled writes, configured origins and
   callbacks, and verified application/worker access. Keep the previous stack
   intact until the owner accepts recovery.

The disposable drill is not an executable implementation of this complete
incident procedure. Exact full restore and cutover commands, across all durable
state, remain an operational deliverable to prove before production dependence.
