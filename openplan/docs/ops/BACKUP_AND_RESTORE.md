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
sample. Full mode now retains the mounted local database encryption root key.
Neither mode captures external worker files or the complete protected configuration.

## Inventory and consistency before capture

Record the database/Storage services, app and worker versions, persistent mounts,
required `local://` model results and county-run inputs/outputs, manifests and
source hashes. Determine which caches can actually be reconstructed from retained
sources; do not assume every directory outside Supabase is disposable.

Include protected copies of configuration, Auth settings and required encryption
keys. Preserve `OPENPLAN_INTEGRATION_KEY_SECRET` and, when retained workspace
keys or sealed worker credentials depend on it,
`OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET`. Restore those required secrets to
the web app and every credential-reading worker before resuming work. Use the
[rotation procedure](../SELF_HOSTING.md#rotate-the-integration-encryption-secret)
to preserve both read keys through a rolling transition. A database or journal
copy does not contain these environment secrets. Do not retire either secret
while a required recovery point depends on it. Preserve the mounted PostgreSQL Vault root key separately from
the database dump. Identical encrypted rows can fail to decrypt in a fresh
cluster with a different root key. A database dump does not include every cluster-level role or
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

## Explicit worker assessments and protected configuration

The candidate inventory command requires an explicit assessment for each of the
15 currently catalogued worker families. The [source audit](../../../docs/reviews/2026-10-11-installation-worker-inventory/WORKER_FOOTPRINTS.md)
identifies different roots, shared state and external dependencies. It does not
discover the running installation. Start with the
[unassessed profile template](../../../docs/reviews/2026-10-11-installation-worker-inventory/profile-template.json)
in a private operator-owned directory. Keep the edited profile and every selected
configuration file private, with no symlinks or hard-link aliases.

Replace the inventory's `installationId` label and add actual absolute paths to
its `roots` and `configuration` lists. Each item has a unique safe `id` and a
`path`. For every worker, record configuration state as `configured`,
`not_deployed` or `unassessed`, with explanatory notes. This is a configuration
assessment, not a claim that the worker is healthy. Missing environment variables
do not establish absence. Configured workers require `configurationIds` and
declare custody as `local_roots`, `database_and_storage`, `external` or
`unassessed`. Local custody also requires `rootIds`. Every selected file/root
must have an assessment reference. Shared roots have one ID; historical roots
may remain referenced by a stopped or unassessed family.

The label does not replace the original runtime installation identity. Preserve
the actual worker and deployment identities in exact protected configuration.
Record external services, native account reauthorization and unresolved custody
in the notes. Environment files remain opaque bytes; this command never executes
their contents. From `openplan/`, after declaring configuration-writer quiescence:

```bash
python3 scripts/ops/installation_worker_inventory.py \
  --profile /private/operator/worker-profile.json \
  --destination /private/recovery/worker-inventory \
  --writers-quiesced --timeout 120
python3 scripts/ops/installation_worker_inventory.py \
  --verify /private/recovery/worker-inventory
```

Require exit 0 and verification before using the generated `inventory.json`
from that private destination with the worker-root set command below. The package retains the exact profile,
known entrypoint/launcher catalogue, selected configuration bytes and one final
receipt. It rechecks sources and never overwrites a destination. Retain failed
destinations for diagnosis and retry in a new directory. Keep the entire verified
inventory package with the recovery point's protected configuration. The root-set
command retains its exact selection bytes but does not separately copy these
configuration files.

The inventory binds current package and source bytes and refuses unreviewed
Python worker entrypoints, npm worker keys or retargeted npm launch commands.
It does not bind every imported library or discover arbitrary installed helpers.
An empty selection with 15 unassessed entries is not evidence of zero workers.
Operator declarations and installation coverage remain unassessed. The command
does not capture worker roots, a database or Storage, align a live cut, encrypt a
backup, or demonstrate operational restart. [Dated checks](../../../docs/reviews/2026-10-11-installation-worker-inventory/STATUS.md)
record the candidate's narrower evidence.

## Model worker recovery records

Include the complete durable worker root in the recovery inventory. This
includes original inputs and outputs, `state.json`, assessment
`command-journal` directories and `stage-journals/<stage_id>/model-commands.sqlite3`.
The journal can hold unresolved delivery requests, resolved receipts and
interrupted computation starts. None of these records is a disposable cache.

SQLite may retain committed records in its WAL sidecar. Copying only the main
`.sqlite3` file can lose those records. Use SQLite's backup API or a completed,
verified checkpoint before archiving a journal. Establish write quiescence for
the database, worker journals and files before coordinating those copies. A
SQLite-consistent copy by itself does not establish a consistent installation
backup. Verify both the journal records and inventoried file bytes after restore.

For each model command journal, the candidate Linux snapshot command implements
the SQLite backup-API copy. First quiesce every relevant writer as part of the
installation's coordinated cut. Use an existing private destination parent,
owned by the current operator with no group or other access. The journal and
its directory must also be private and owned by that operator. From `openplan/`:

```bash
python3 scripts/ops/worker_journal_snapshot.py \
  --source /private/worker/stage-journals/STAGE/model-commands.sqlite3 \
  --destination /private/recovery-point/STAGE-journal \
  --writers-quiesced --timeout 30
```

The flag records the operator's declaration; it does not stop or fence writers.
The command reads through SQLite in read-only mode, includes committed WAL
pages, checks copied database integrity and the command-table shape, and records
the copied file's size and SHA-256 hash. It syncs the database, publishes a
private metadata receipt atomically, and syncs the destination and parent.
Its deadline applies to backup progress and lock retry, not every disk operation.
It never overwrites a destination. A failed destination remains private; retry
with a new directory and retain the failure for diagnosis. Require exit 0 before
using the snapshot, and compare its actual size/hash with `snapshot.json`.
A metadata file alone does not establish successful completion after a
filesystem failure.

Include this complete snapshot and the original input/output files in the
private recovery inventory. Restore the snapshotted journal as
`model-commands.sqlite3` in the corresponding stage directory. Preserve the
original installation identity. Independently compare current database rows
and server receipts before recovering uncertain deliveries. Never clear an
interrupted computation start to permit replay. The [dated checks](../../../docs/reviews/2026-10-11-worker-journal-snapshot/STATUS.md)
cover one populated local journal, not the complete installation backup,
automatic quiescence, full stage continuation or scientific acceptance.

Preserve `OPENPLAN_DEPLOYMENT_ID` and the original logical base URL when restoring
that same installation from a coordinated backup. A different or newly
initialized installation needs a distinct identity; do not edit an old journal
to send its commands there. Retain private configuration through the same
protected process as other installation secrets.

A local cached receipt does not contact the restored database. Compare the
current output, receipt and execution-start rows independently before calling a
restore complete. Keep uncertain delivery requests pending until the original
request recovers its matching server receipt. A saved computation start without
a saved result remains unresolved and must not be deleted to permit another run.
Historical reconciliation and full stage continuation remain unfinished.

The [October 8 proof](../../../docs/reviews/2026-10-08-model-custody-metadata/WORKER_LOCAL_RESTORE.md)
restores a full native PostgreSQL dump and synthetic local worker files inside
one owned cluster. It compares eight model tables, recovers a lost reply through
a fresh process, and refuses repeated computation. This is additional evidence,
not a whole-host recovery claim. Cluster roles, database properties, all-table
inventories, Storage, real-worker quiescence and a different physical host still
require their own verification. The default-local archive commands below do not
capture the worker roots automatically.

## Capture an explicitly selected worker-root set

The candidate Linux set command retains one private inventory and every selected
root as a single verified package. It does not discover omitted workers. Establish
the required roots from the installation's actual configuration and preserve that
authority separately. A private inventory has this shape; paths below are examples:

```json
{
  "format": "openplan-worker-root-inventory-v1",
  "roots": [
    {"id": "transit", "path": "/private/installation/transit-worker"},
    {"id": "model", "path": "/private/installation/model-worker"}
  ]
}
```

Use unique IDs containing only ASCII letters, numbers, `.`, `_` or `-`, beginning
with a letter or number, with at most 64 characters. Paths must be absolute and
private, without aliases or overlapping roots. Keep the inventory private and
operator-owned. Its exact bytes, including any opaque metadata, are retained.
An empty `roots` list means zero selected roots; it does not establish an empty
installation. Quiesce every relevant writer and keep it stopped through the whole
coordinated point. From `openplan/`, using a fresh destination with a private parent:

```bash
python3 scripts/ops/worker_root_set_snapshot.py \
  --inventory /private/installation/worker-inventory.json \
  --destination /private/recovery-point/worker-root-set \
  --writers-quiesced --timeout 120
python3 scripts/ops/worker_root_set_snapshot.py \
  --destination /private/recovery-point/worker-root-set --verify --timeout 120
```

Require both commands to exit 0. The timeout covers the selected set. The command
inventories all sources before component copying, binds each component to that
initial inventory, and rechecks all sources and selection bytes before publishing
the final manifest. These checks detect observed changes; they do not acquire a
writer fence or detect every change and exact restoration between observations.
Retain an incomplete destination for diagnosis and use a fresh one on retry.
Nested component manifests do not establish complete set capture.

The package contains exact `inventory.json`, component packages under `roots/<id>/`,
and final `snapshot.json`. Verification uses only these retained files and works
without the original source paths. Preserve the set manifest hash through the
protected coordinated point with database, Storage, installation identity and
configuration. Self-consistent retained files do not authenticate their own origin.
This command does not encrypt data or create that coordinated point automatically.

Recover verified `roots/<id>/root/` directories into fresh working locations,
preserving relative paths, modes and original command custody. Keep the retained
set unchanged while working copies recover receipts. Source-path identity binds
the original selection; it does not authorize computation at a new location.
The [dated set checks](../../../docs/reviews/2026-10-11-worker-root-set/STATUS.md)
record five known retained roots, exact relocation checks and the remaining
installation, browser, physical-host and scientific boundaries.

## Capture a complete selected worker root

The candidate Linux root operator packages one explicitly selected private worker
root, including its ordinary files, empty directories, modes and SQLite databases.
List every required root in the installation inventory. Quiesce all relevant
writers before capture and keep them quiescent until the complete coordinated
point finishes. The declaration below does not stop workers or acquire a
whole-root lock. Use a new destination outside the source, with an existing
private parent owned by the operator. From `openplan/`:

```bash
python3 scripts/ops/worker_root_snapshot.py \
  --source /private/installation/worker-root \
  --destination /private/recovery-point/selected-worker-root \
  --writers-quiesced --timeout 120
python3 scripts/ops/worker_root_snapshot.py \
  --destination /private/recovery-point/selected-worker-root --verify
```

Require both commands to exit 0. Capture refuses aliases, foreign ownership,
group or other access, special files and destination reuse. It reads every
ordinary byte and retains its SHA-256 hash. SQLite main files are recognized
by their header and copied through the native backup API, including committed
WAL records. The copied database must pass integrity checking and use DELETE
journal mode. Named model command journals must retain their command-table
shape. A filename ending in `-wal` or `-shm` must belong to a recognized SQLite
main; an orphan sidecar is refused. This conservative naming rule also applies
to ordinary files with those suffixes.

SQLite normalization may change physical page metadata. Compare all required
logical records independently after recovery; do not require the normalized
main's hash to equal the source main's hash. Ordinary files, directory paths and
modes must remain exact. Read-only SQLite can create transient SHM or a new empty
WAL beside a closed WAL-mode source. The stability check excludes only recognized
SHM and newly created empty WAL bytes. Original or populated WAL bytes remain
required. This does not fence a writer or detect every change followed by an
exact restoration between inventory reads.

The private package contains `root/` and `snapshot.json`. The manifest records
source and retained inventories, SQLite normalization mappings and the limited
consistency scope. It can contain private paths and state metadata. Preserve the
whole package in the same protected coordinated point as the database, Storage,
installation identity and required configuration. Verification checks package
contents against its manifest, not authenticity against an external authority.
Bind its manifest hash through the protected point. The timeout checks inventory,
copy and SQLite backup progress; it cannot interrupt every blocking kernel call.

A refused destination remains incomplete and cannot be reused. Retain it for
diagnosis and use a fresh destination after resolving the cause. A manifest left
after a filesystem failure does not override a nonzero capture exit. Restore the
verified `root/` into a fresh working directory, preserving relative paths and
modes. Keep the retained package unchanged when command recovery later updates
SQLite receipts. Verify the recovered database and original requests before
reconciling delivery; the package does not authorize another computation.

The [dated root checks](../../../docs/reviews/2026-10-11-worker-root-snapshot/STATUS.md)
record the candidate build and limits. This command does not discover every root,
encrypt the package, align database/Storage captures, recover another physical
host, resume models or establish scientific acceptance. Native SQLite extension
requirements and complete agency installations remain unassessed.

## Seal already retained local recovery artifacts

The candidate offline packet command binds retained database and Storage bytes,
cluster roles, database root key, protected configuration and a verified worker-root
set. It does not create those artifacts or establish a new consistent cut. Complete
the topology-specific capture under declared quiescence first. Use a private,
operator-owned packet directory and include the actual software/installation
identity, Auth settings, integration encryption secret, database properties,
required roles and all other configuration identified by the installation inventory.
Do not copy secrets into source control, public reports or chat.

Every packet file and directory must deny group and other access. Backend files
can carry broader original permissions. Preserve their original file/directory
metadata privately, harden a fresh packet copy and keep the original unchanged.
Restoring backend permissions and ownership remains topology-specific; private
packet permissions do not define the running service's required permissions.

Save exact private `point-inventory.json` inside the packet. This example names
required categories; replace paths with the retained artifacts for your topology:

```json
{
  "format": "openplan-recovery-packet-inventory-v1",
  "artifacts": {
    "databaseArchive": {"kind": "file", "path": "postgres.dump"},
    "storage": {"kind": "file", "path": "storage.tgz"},
    "clusterRoles": {"kind": "file", "path": "configuration/roles.sql"},
    "databaseRootKey": {"kind": "file", "path": "configuration/root.key"},
    "configuration": {"kind": "directory", "path": "configuration"},
    "workerRootSet": {"kind": "directory", "path": "worker-root-set"}
  }
}
```

Storage can instead name a retained object-byte directory with `kind: "directory"`.
Artifact paths are relative to the packet, without absolute paths, aliases, parent
traversal, duplicate paths or normalized-path ambiguity. Roles and key files may
sit inside the configuration directory. All required file artifacts must be
nonempty. Opaque metadata in the declaration remains byte bound; it does not
establish that the named roles, settings or artifacts are complete or usable.

From `openplan/`, using the already captured packet:

```bash
python3 scripts/ops/recovery_point_manifest.py \
  --point /private/recovery-point --seal --writers-quiesced --timeout 120
python3 scripts/ops/recovery_point_manifest.py \
  --point /private/recovery-point --verify --timeout 120
```

Require both commands to exit 0. Sealing validates the worker-root set, syncs all
retained files and directories, rechecks the complete packet and publishes
`recovery-point.json` last. A completed or interrupted publication cannot be
overwritten. Preserve an incomplete packet for diagnosis and create a fresh one
on retry. The timeout checks progress; it cannot interrupt every blocking kernel
operation. Declared quiescence is not a live writer fence.

Keep the manifest hash with the protected backup authority. Encrypt and retain
the complete packet through the installation's chosen backup process. Verify the
protected copy, restore to a fresh directory and rerun packet verification before
using its artifacts. It needs no original worker paths or running services. Keep
the packet unchanged while recovery uses fresh working copies. A self-consistent
manifest does not authenticate its origin. Matching hashes do not establish native
database restoration, Storage access, complete installation coverage or permission
to resume computation. The command leaves installation consistency unassessed.

The [dated packet evidence](../../../docs/reviews/2026-10-11-recovery-point-manifest/STATUS.md)
records controls, retained-artifact transport and remaining acceptance boundaries.

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
consistency interval, with access controls and hashes. The selected worker-root
set command above covers explicitly named private filesystem roots, not every
worker volume automatically. Include that verified set and all protected
configuration before sealing the packet. Record the actual selected paths and
their owners; installation-wide discovery remains unimplemented.

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

Use Python 3.11 or newer, the repository Node/npm setup and Docker. The first
launch may download the Supabase service images. From the app directory:

```bash
npm run ops:restore-drill -- --full-archive
```

This creates two fresh disposable Supabase projects, seeds synthetic saved work,
quiesces the source API/Auth/Storage writers, captures the full PostgreSQL custom
archive and Storage volume, and restores both into the isolated target. It creates
no app workers and refuses scheduled SQL jobs. Never point this test at a working
agency database. The script verifies project ownership and matching runtime images
before capture and refuses existing target records or incompatible cluster roles.

Full mode also captures the source database's mounted root key and the fresh
target's previous key in private files beside the archives. It records the target
container identity, image and file binding before stopping that target. Initial
capture compares host and mounted bytes through the recorded source and target
container IDs. An atomic host-file replacement can leave an older file bound in
a running container; preparation refuses that mismatch. Existing-intent replay
uses the retained keys without requiring the stopped target to answer a mount
read. The actual decryption canary separately checks the restored backend. It
atomically replaces the target key, syncs the file and directory, restarts the
recorded target and verifies the mounted bytes. The source key stays unchanged.
The target must have no existing Vault secrets. The helper refuses SSH and TCP Docker
endpoints and unexpected mounts, identities, key bytes or recovery intents.

The key archive is `database-root-private.key`. Its checked intent and the previous
target key are private too. Protect all three as secrets. Do not copy them into
public reports, source control or chat. A restart interruption leaves the checked
intent and both keys for recovery. The bounded key helper can repeat that step
using the exact recorded target and retained incoming bytes. This does not make
the entire full restore command resumable: it still refuses an existing capture
directory or recovery database. Preserve and inspect failed drill state rather
than deleting it or rerunning against a populated target.

For that key step only, from the application directory, use the retained private
capture directory:

```bash
python3 scripts/ops/database_key_custody.py --recover-target-key /private/drill/backup/full
```

The command accepts the generated disposable target project recorded in the
intent. It does not select a new container, import database rows, change Storage
or restart app workers. It refuses a different container, image, file binding or
key payload. Verify the remaining saved work separately before accepting recovery.

The drill seeds a synthetic encrypted Vault record and verifies its actual
decryption on the target. [Native key recovery evidence](../../../docs/reviews/2026-10-10-encryption-recovery/STATUS.md)
records wrong-key failure, interrupted restart recovery and the limits of these
checks. Local fixture recovery does not establish hosted recovery, whole-host
cutover or physical power-loss acceptance.

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
