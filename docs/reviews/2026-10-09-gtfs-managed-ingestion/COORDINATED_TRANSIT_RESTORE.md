# Coordinated transit database and worker-file recovery

The [file-only backup](WORKER_FILE_BACKUP_PLAN.md#completed-file-only-probe) and
[terminal replay](WORKER_FILE_REPLAY.md) establish separate boundaries. This
follow-on captures a fresh isolated database and a complete private GTFS worker
root during one verified interval without writers. It restores both from an
encrypted snapshot, then recovers a dropped native completion reply. Application
source remains frozen at bf1f6ffa; original worker artifacts remain from ba1b497f.
No application, schema, worker contract or hosted configuration changes.

## Native point and recovery

The [third native trial](coordinated-transit-restore-20261011/result.json) passes.
A read-only custom PostgreSQL dump captures the original isolated fixture.
Restoration creates a fresh UUID database from `template0`. Before replay, the
runner compares all 374 tables, six sequence values and schema definitions,
including owners and grants. Complete-row hashes and counts agree. Dump comments
and random restriction tokens are excluded from the schema comparison.

Only three named transit RPCs cross the owned loopback bridge. The source returns
the original completion receipt with HTTP 200. The bridge closes the connection
without delivering that reply. The actual owned-attempt coordinator reports
`GTFS worker acknowledgement unavailable`. The copied command stays unresolved,
with its original identifier and payload. No work callback runs. This loses a
replayed receipt whose publication already exists; it does not create a first
publication or claim that cancellation undoes one.

The owned bridge and PostgREST stop before capture. A native session check refuses
writers without terminating them. The custom database dump and complete copied
worker root then enter one private bundle. Source inventories agree before and
after capture. Restic 0.19.1 encrypts the bundle, reads all repository data for
verification, and restores with caches disabled. The restored point contains
788 files and 248,044,157 bytes, including the database dump. Original worker
roots retain all 787 files and 235,591,323 bytes unchanged.

The restored dump enters another fresh database. A narrowly scoped transport
mapping preserves the original logical API URL and installation identity. It
does not rewrite old journals. Fresh-process recovery returns the same native
completion receipt and resolves the restored terminal record. A cached repeat
and harmless review note read native claim and attempt without another completion
delivery. A wrong installation refuses before an RPC. All five cases perform
zero work computations and verify retained archive/parser bytes first.

A rollback-only native control removes a completion receipt inside one session.
The actual incomplete table image fails comparison. Rollback restores the entire
image before replay. Final native reads compare the target, source and original
fixture again. All tables, sequences and schema agree. The original roots and
captured bundle remain unchanged. Only the restored terminal receipt changes.
[Ten retained native images](coordinated-transit-restore-20261011/native-image-summary.json)
agree, and a separate post-run read checks the original command and payload,
exact target receipt, images and stopped service identities.

## Resource limits and retained failures

The runner uses 1 GiB, no swap and one CPU. Its final journal reports 283.978
seconds and an 841.9 MiB peak. Its final producer result and all native child
exit codes are retained. The transient unit is collected afterward; its main
exit status is not recovered from default `systemctl` fields. Each PostgREST
uses 128 MiB, no additional swap and half a CPU. Both exact services stop and
remain retained, with shutdown exit status 255 and no OOM flag. This does not
establish graceful service shutdown or production supervision acceptance.

The [first trial](coordinated-transit-restore-20261011/failed-trial-01.json)
captures and restores the database, but its auto-removed PostgREST disappears
before inspection. Its startup cause is not established. The
[second trial](coordinated-transit-restore-20261011/failed-trial-02.json)
retains the container and confirms exit 137 with an OOM flag during full generated
API readiness queries. Neither trial reaches worker replay or captures a
coordinated point. Both source databases and failed proofs remain retained.

The third profile disables the generated API description and uses a small HEAD
request for readiness. Two separate native startup diagnostics pass under the
same 128 MiB cap, with the disabled description returning 404. An initial pure
control also catches a fixture that changes both database and OpenAPI settings.
Its correction isolates the database mutation. The full third trial starts only
after the corrected fail-fast control sequence passes.

## Controls and limits

Actual extracted guards pass four positive/21 broken scope cases, three
positive/13 broken transport cases, five positive/11 broken mapping cases and
three positive/five broken image cases. Separate result checks pass three
positive/21 broken observations. Each broken case also fails its refusal oracle
when the relevant guard is omitted in memory. These controls use copied inputs;
they do not mutate the app, native source or original files. The native receipt
control rolls back in its own fresh proof database.

Retained Python and Node runners support review. They use private local fixture
paths and are not a customer recovery recipe. Raw database dumps, command tokens,
source files, parsed output and encryption keys remain outside the repository.

This point covers the database and this complete GTFS worker root in one existing
PostgreSQL cluster on the same physical host. It reuses cluster roles and the
mounted key. It does not restore full external Storage bytes, protected service
configuration, cluster roles, database properties, Auth service startup, populated
SQLite/WAL, either demand worker, a physical host, new computation or agency
acceptance. Those remain distinct M3 requirements. Hosted coordination and the
main-merge hold remain with the relaunch agent. No main merge or release occurs.
