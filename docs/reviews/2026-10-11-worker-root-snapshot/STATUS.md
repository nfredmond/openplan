# Complete selected worker-root snapshot candidate

The Linux candidate operator captures one explicitly selected private worker
root. Ordinary bytes, relative paths, empty directories and modes are retained.
Native SQLite backup preserves committed WAL and BLOB records and normalizes
retained main files. A private manifest is published last and verified separately.
This is bounded M3 engineering evidence. It is not a completed installation
recovery procedure or a release.

The candidate builds above `8ba8ab1fdfce7af0f40b76dee272c8ec49892a29`.
[Source and test hashes](evidence/mutation-controls.json) identify the tested
implementation. The [design](DESIGN.md), [operator instructions](../../../openplan/docs/ops/BACKUP_AND_RESTORE.md)
and archived [executed driver bindings](evidence/retained-drivers.json) retain
its intent and exact native provenance. Eight [binding controls](evidence/driver-binding-controls.json) include harmless ordering, changed driver bytes and omitted binding refusal. The driver archives describe fixed
private fixture topology; they are not general installation scripts.

## Behavior and controls

From the nested application directory, `scripts/ops/worker_root_snapshot.py`
requires declared writer quiescence, a private operator-owned source and a fresh
private destination outside that source. It refuses aliases, other owners,
group/other access, special files, orphan SQLite sidecars, invalid model-journal
schema and observed durable source changes. A named `-wal` or `-shm` file must
belong to a recognized SQLite main, including ordinary files with those suffixes.
It never overwrites an existing package.

The command inventories every ordinary byte and directory, preserves modes,
reads SQLite sources in read-only mode and uses native backup. It checks copied
SQLite integrity and DELETE mode. Original or populated WAL bytes must remain
stable. Recognized SHM and newly created empty WAL can be reader artifacts;
closed/crashed native database tests cover these distinctions. SQLite page
metadata can change under normalization. All logical records are compared
independently in the native tests and fixture continuation.

Files, the manifest, affected directories and the destination parent are synced.
A failure refuses success and retains the private destination as incomplete.
Success requires exit 0, then a verified package. The verifier checks complete
contents against the private manifest. It does not authenticate the manifest
against an external authority; the protected coordinated point must bind it.

All 36 new native tests have a selected broken-behavior control. The
[48-case mutation run](evidence/mutation-controls.json) records 42 broken cases
and six survivors. Five survivors run the full suite: baseline, harmless source
comment, reversed enumeration, different JSON indentation and restored source.
The remaining survivor removes a redundant predicate in one selected case;
an independent original-WAL census still rejects that change. This selected
survival is not a whole-program harmlessness claim.

Broken cases expose lost committed WAL/BLOB rows, omitted state or empty paths,
changed ordinary bytes or SQLite mode/type, unsafe source/destination scope,
invalid CLI arguments, private-path disclosure, missing fsync, false publication,
invalid deadlines and a native backup hung by an exclusive lock. The lock case
ends only its owned test child after four seconds. Source bytes are restored and
synced in `finally`. Fake bad-integrity/mode reports test refusal branches; they
do not establish native corrupt-file or extension acceptance. The final complete
operations suite passes 177 tests with no skips. Direction checking passes with
existing registry/version-age reminders preserved.

A verifier follow-up rejects missing, malformed or altered SQLite mappings with
a controlled CLI refusal. All retained SQLite paths must have their matching
backup-API, DELETE-mode and integrity mappings. Both new tests fail their selected
omission controls. The [current verifier rechecks](evidence/manifest-followup.json)
accept all five retained packages. Module content outside the verifier is equal
to the source used for native packaging and installed command recovery.

## Native retained-root packaging

[The supported CLI run](evidence/native-packages.json) captures and independently
verifies all five known roots in the accepted managed-stage point. Each command
exits 0. Every ordinary byte/path/mode, empty directory and all four SQLite
journal schemas/table rows match their original records.

| Selected root | Files | Directories | Retained bytes | SQLite copies |
| --- | ---: | ---: | ---: | ---: |
| Managed-stage worker | 5 | 13 | 41,676 | 2 |
| Legacy model worker | 5 | 7 | 33,499 | 2 |
| Configured transit worker | 699 | 620 | 274,085,334 | 0 |
| Replacement transit worker | 29 | 23 | 2,873,176 | 0 |
| Capacity transit worker | 787 | 780 | 235,651,073 | 0 |

The complete original point, 1,557 files, remains byte equal. New runtime roots
are copied from these immutable packages. Five packaging dependencies and 42
native-recovery dependencies are frozen before execution and unchanged afterward.
The accepted point's model journals were already normalized. Populated and
crashed WAL acceptance comes from the separate native tests, not this packaging
run. No new coordinated database/Storage capture is claimed here.

## Native installed-CLI continuation

[The native continuation](evidence/native-recovery.json) starts only the existing
owned target database and its exact receipted PostgREST. It uses the fresh working
copies, preserving the accepted source point, immutable packages and original
recovered worker roots. Existing identity, network, mounted-key, environment,
role, property and resource-bound guards remain in force. Five
[lifecycle controls](evidence/lifecycle-controls.json) cover active-state refusal
and final stopped-state verification without starting another service.

The installed CLI rejects a wrong installation before HTTP, reconciles the
original claim and progress requests against their original native server
receipts, and then recovers cached receipts without HTTP. Exact original request
and response hashes match. Execution admissions remain zero for uncertain claim
and one for interrupted progress. Callback reentry is refused; no computation
callback runs. Ownership inspection is read-only, point-in-time and explicitly
denies continuation. [Missing native receipts](evidence/native-missing-receipts.json)
and [obsolete ownership snapshots](evidence/native-ownership-projections.json)
fail rollback-only controls.

All 374 native table images and six sequences remain equal before and after.
Role/password/membership, database properties and mounted-key bytes remain equal.
Only the two working-copy managed journals retain recovered receipts. Other
working-point bytes and all immutable packages remain equal. [Exact owned target services](evidence/final-resources.json)
stop on completion, with checked `finally` cleanup. No source cluster,
other service, demo, hosted installation or main merge changes.

## Retained failures and limits

The [first packaging producer](evidence/failed-package-byte-oracle.json) fails a
physical-byte oracle for two normalized SQLite files. All logical records match
and the source point remains unchanged. The correction compares every logical
row/mode and keeps exact ordinary bytes; it does not discard durable records.
The [second producer](evidence/failed-package-shadowing.json) fails because its
comparison loop shadows the summary list. Both private attempts remain retained.
The third producer passes.

The [first recovery wrapper](evidence/failed-recovery-port-observer.json) fails
before any service starts. It wrongly converts an empty Docker-assigned host-port
request into an integer. The corrected wrapper checks explicitly requested ports
and lets Docker allocate the already-verified loopback request. Native recovery
then passes. Earlier mutation trials, a closed-WAL test failure and a syntax-only
runner failure remain private and recorded; none is relabeled as success.

[Unit accounting](evidence/unit-accounting.json) records exact invocation IDs and
exit states. Packaging takes 26.005 seconds; installed native recovery takes
63.324 seconds. Both bounded services reach a rounded 512MiB peak, including
filesystem census/copy accounting. Exit 0 does not establish spare host capacity.
All native resources are retained and stopped. Private proof remains under
`gtfs-managed-ingestion-proof-20261009/worker-root-snapshot-20261011/`.

This verifies five known roots on the same host/disk. It does not discover every
installation root, fence concurrent writers, detect every change-and-revert
between inventories, encrypt packages, align a new database/Storage cut, recover
hardware loss or complete independent agency commissioning. Deadlines check
progress but cannot interrupt every blocking kernel call. Native Windows/macOS,
SQLite extension requirements, actual AequilibraE project reopening, all worker
families, useful computation beyond 45 minutes, normal demand-poller admission,
engine resume, browser/practitioner acceptance and separate-engine scientific
validation remain unassessed or open. M3 and the full V1 contract remain incomplete.
The relaunch agent retains hosted coordination and the main merge hold.

## Later acknowledgement test repair

The external branch update to c1c6a22 has a shuffled CI failure in a GTFS human-command wall-clock assertion. The [dated repair](../2026-10-11-gtfs-human-command-clock/STATUS.md) preserves the failed run and replaces that assertion with a controlled configured-deadline check. Original root snapshot proof remains bound to ea65534b; neither a test repair nor a push establishes new release acceptance.
