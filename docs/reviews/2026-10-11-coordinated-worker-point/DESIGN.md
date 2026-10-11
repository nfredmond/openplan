# Coordinated model worker point, October 11 preparation

This extends existing M3 recovery work. The next proof will capture a complete
synthetic model worker root together with the full native database image,
retained Storage bytes, roles, configuration and key custody. The proof must
recover an uncertain original command without computation. It remains a local
engineering fixture, with no scientific or agency acceptance claim.

## Existing evidence and the gap

The [October 8 coordinated model proof](../2026-10-08-model-custody-metadata/WORKER_LOCAL_RESTORE.md)
restores a lost legacy KPI reply and an interrupted local start. It compares
eight model tables and named files within one cluster. The
[October 11 separate-cluster transit proof](../2026-10-09-gtfs-managed-ingestion/SEPARATE_CLUSTER_RECOVERY.md)
compares 374 table images, roles, key custody and ten Storage objects. Its GTFS
roots have no populated SQLite journal. The
[new snapshot command](../2026-10-11-worker-journal-snapshot/STATUS.md) retains
populated WAL requests, receipts and starts in one journal. These are separate
fixtures. None proves their complete coordinated join.

The next proof reuses those mechanisms. It does not treat their separate green
results as combined acceptance. The current source is
`9446f76af65106897eb8a693c5aff9817de5de7f`; new driver code must record its
pre-execution hashes and every subsequent correction separately.

## Source and owned resources

Use the retained encrypted transit point as the base fixture. Keep its original
files, service configurations, database clusters and volumes unchanged. Create
new dedicated source and target clusters with immutable receipts, separate
volumes and copied keys. Reconstruct roles independently. Reuse the pinned local
PostgreSQL image and current native semantic schema comparator. The comparator
remains a fixture harness; production full-restore behavior is unchanged.

Planned caps are 1 GiB per new PostgreSQL cluster and 128 MiB per required
PostgREST service, with no additional swap and one CPU per database. The driver
uses a 1 GiB cap, no swap and one CPU. Expensive phases run serially. Check free
disk against the measured point and proposed copies before launching them.
No database port is published. A private network and exact owned service IDs
bind the required transports. Do not reuse or reconfigure existing proof APIs
or stop any other lane's service. No native resources are launched by this design.

## Capture and recovery sequence

1. Restore the unchanged base point into the new source. Verify all native rows,
   sequences, schema semantics, properties, roles, key bytes and retained files
   before adding synthetic records. Preserve initial failures as failed.
2. Use actual model command and computation checkpoint producers to populate
   the known worker root. Include `state.json`, input/output bytes, empty
   directories and populated command/stage journals. Add only labeled synthetic
   run/stage records to this source. No engine, protected study or holdout runs.
3. Deliver an actual legacy custody command through a route-restricted bridge.
   Drop the reply after native commit. The installed recovery CLI must report
   uncertainty and retain its original unresolved request. Retain a separately
   resolved receipt and both completed/interrupted local checkpoint records.
4. Quiesce all writers owned by this fixture. Record the interval and verify
   zero remaining database writer sessions. Keep a non-writing SQLite keeper
   open so WAL records genuinely remain outside the main file. This exercises
   the capture method; it does not establish a general live-worker fence.
5. Snapshot each populated model command journal with the actual operator CLI.
   Retain an explicit original-relative-path mapping. Inventory the entire
   known worker root, including empty directories and metadata. Keep model
   inputs/outputs byte-identical. Record SQLite logical rows separately from
   the normalized backup file's physical hash. Capture the full database,
   Storage and protected configuration under the same quiescent interval.
6. Encrypt, fully read-check and restore the point into separate private storage.
   Restore the database into the new target cluster. Reconstruct the worker
   root using the captured journal mapping, without editing any request,
   destination, input, result or interrupted start.
7. Compare all native tables/sequences/schema/roles/properties/key custody and
   every inventoried worker/Storage byte. Compare the current server output and
   receipt independently. A local cached receipt alone cannot prove recovery.
8. A fresh installed CLI must recover the original uncertain request through
   the verified target transport. Preserve its original logical model origin
   and installation identity. Require exact request/receipt equality, one
   committed output, no changed database image and no computation callback.
9. Re-read the original fixture, captured point and source. Stop only exact new
   owned services and retain all proof, failed trials and volumes. No deletion,
   reset, main merge, release or hosted cutover occurs in this sequence.

## Required adverse controls

Start with baseline and harmless serialization/metadata controls. Then remove
one input/output or empty directory, change a required mode, replace the SQLite
backup with a main-file copy, omit a command receipt or interrupted start, and
change the logical installation identity. Each must fail its own byte, record
or transport assertion. Native missing-server-output/receipt controls must use
rollback-only target transactions and verify the restored image afterward.
Exercise altered policy/default privilege controls through the existing native
catalog comparator. Restore every mutation in `finally`. Record blind categories.

## Boundaries and disposition

This is a known synthetic root and legacy custody command, not the complete
current managed-stage dispatcher, every worker family or useful computation
beyond 45 minutes. It does not establish power-loss recovery, a different
physical host, generic writer fencing, hostile same-user race resistance,
browser/practitioner acceptance or independent engine validity. Historical
Vault decryption requires its own populated secret evidence. Source comparison
does not audit unrelated databases or processes. Keep those limits visible.

The roadmap remains the sole queue. Hosted coordination and the main merge hold
remain with the relaunch agent. Deployment, migrations, scientific algorithms
and worker protocols remain outside this proof's changes.
