# Expanded local transit recovery point

This M3 follow-on restores a coordinated database, complete physical Storage,
three known GTFS roots and protected configuration from an encrypted local point.
The installed queue CLI recovers an unsettled job after a real completion reply
is dropped. A separate continuation validates native Auth changes and repeats
preservation checks. The original producer failure remains recorded.

Application source stays frozen at bf1f6ffa710b11b7f36747a676943edab667a4ae.
Original CTA worker artifacts remain from ba1b497f. This work changes review
harnesses and evidence, without changing application code, SQL or worker contracts.

## Point and installed CLI recovery

The source is the owned isolated fixture, not the demo or hosted installation.
Preflight verifies immutable service IDs, image IDs, labels, database URIs,
mounts and memory limits. It refuses active owned app/workers, another database
client, foreign tables, scheduled SQL work and queued outbound requests. It stops
only the four exact fixture API services. Original databases and files remain.

A read-only capture retains the selected database, all ten physical Storage
files and all three known private GTFS roots. The roots contain 1,515 files and
512,549,833 bytes; Storage contains ten files and 119,425,015 bytes. Protected
service/app configuration, database settings, role backup and mounted key enter
the private point. The native mounted bytes match the captured key. Source and
target names are fresh UUID databases in the existing isolated PostgreSQL cluster.

The database restore preserves the PostgreSQL owner, UTF-8 encoding, ICU locale,
connection limit, database ACLs and database/role settings. PostgreSQL quotes
captured identifiers and values. Saved commands bind to their exact target and
hash, rather than replacing database names inside setting values. All 374
non-system tables, six sequences and normalized schema match before recovery.
Schema comparison includes owners and grants and excludes dump comments and
random restriction tokens.

The trial marks only the copied CTA job unsettled and its copied completion
receipt unresolved. Its original command and payload stay unchanged. The actual
installed `gtfs-ingestion.ts --once` entry runs with the retained installation
identity and original logical API URL. A bounded loopback bridge allows four
named transit RPCs. It returns the native empty candidate queue and forwards
the original completion request. Native completion returns HTTP 200; the bridge
closes the socket without delivering that reply. The CLI exits 2, retaining the
unsettled job and unresolved receipt. Three native lock holders run. No parser,
model process or source network request runs.

After source services stop, a session check refuses remaining clients. Restic
0.19.1 captures the database and complete private point, reads all encrypted
repository data, and restores with caches disabled. The point contains 1,541
files and 644,693,866 bytes. Its snapshot is
`08090b60e8c1fa07b71c2181704df5295ade9c9af40f45d7f8f2c09dba400acc`.
Raw files, configuration, Auth rows, passwords and keys stay outside Git.

The restored installed CLI exits zero. It rediscovers the local unsettled job
despite an empty native candidate queue, recovers the original completion receipt
and settles the job. The native request and response hashes agree with the lost
reply. No computation repeats. Every retained Storage object downloads with its
actual size and SHA-256 matching the physical bytes. Completion leaves CTA
unadopted and preserves the other transit records.

## Retained failures and separate continuation

All three original producers exit 1 and remain retained. Their failed state is
not replaced by the later accepted continuation.

| Producer | Actual boundary | Correction |
| --- | --- | --- |
| [First](expanded-local-point-20261011/failed-producer-01.json) | Auth/REST readiness passes before Storage listens. Kong records upstream connection refusal; the response status is not retained. A source receipt filename also overwrites the original snapshot filename, blocking automatic restart. | Check all three service endpoints, keep receipts separate from original snapshots, and restore exact originals from the separately captured snapshot. A `TIME_WAIT` socket is permitted while an active listener still refuses. |
| [Second](expanded-local-point-20261011/failed-producer-02.json) | All ten copied objects read back. The strict child-process allowlist prevents the existing journal lock before any RPC. Source inspection and the corrected native CLI identify the required `flock`/`cat` operation. | Permit only exact hashed lock binaries, fixed no-fork arguments, private copied lock paths, isolated environment and pipes. Original services restart automatically after cleanup. |
| [Third](expanded-local-point-20261011/failed-producer-03.json) | The installed CLI and restored Storage succeed. Password sign-in succeeds, but the expected Auth table list omits its new authentication-method row. | Validate the specific native Auth user/session graph in a separate controlled continuation. Preserve the original failure and exit status. |

The first launch also retains a bookkeeping error: directory fsync is incorrectly
wrapped with `fdopen`, and a non-fail-fast shell still launches the controlled
runner after the pure controls pass. Directory fsync is corrected, and later
dependent launch sequences use `set -e`. Executed first-trial source is retained
separately from later diagnostic edits.

The native Auth check finds one new password session, refresh token,
authentication-method claim and login audit row, all bound to the tested synthetic
user/session. Existing Auth rows stay unchanged. Only `last_sign_in_at` and
`updated_at` change on that existing user. Other users and credential fields stay
exact. The related refresh-token sequence advances to the new token ID; unrelated
sequences and all non-Auth records stay exact. This validates a specific sign-in,
without permitting arbitrary Auth changes.

The [separate continuation](expanded-local-point-20261011/resumed-result.json)
rechecks database images, properties, original roots, Storage, key and role
custody, original command hashes and the restored services. Its actual service
exits zero in 164.384 seconds. A
[separate final verifier](expanded-local-point-20261011/resumed-final-verification.json)
exits zero in 27.088 seconds and repeats the native target/property reads. Every
restored file retains its bytes and mode except three expected capacity journals:
queue cursor, job settlement and terminal receipt. The exact original and source
services are stopped and retained; four bounded target API services serve the
same logical origin. Original durable data stays unchanged.

Each producer, continuation and final verifier uses a 1 GiB cap, no swap and one
CPU. [Retained service records](expanded-local-point-20261011/native-service-results.json)
record the actual exit statuses. The third producer reaches its 1 GiB cap;
an in-flight cgroup read records memory-limit pressure without an OOM or OOM-kill
event at that observation. Its final failure is the Auth assertion. The
continuation peaks at 69,201,920 bytes and the final verifier at 558,108,672 bytes.
These phases are separate observations, not a standalone recovery benchmark.
REST uses 128 MiB, Auth/gateway 256 MiB and Storage 512 MiB, each without additional
swap and with half a CPU. Shutdown exit 255/137 without an OOM flag is retained
where observed; graceful production supervision is not established.

## Controls and browser limit

Scope controls exercise 28 targeted refusals. Property controls cover four
target/command refusals and the ICU creation argument. Created-service controls
cover 14 refusals, the native bridge seven, CLI mapping/loader twelve, lock-holder
scope eleven and CLI observations ten. Startup controls refuse an occupied
ephemeral port and each missing service. Specific Auth controls cover 15 refusals,
continuation controls ten, final file/result controls seventeen and preview
preflight eleven. Harmless and restored inputs pass; omitted guards allow their
targeted broken observations. These in-memory controls do not mutate original
services or application source.

[Native file controls](expanded-local-point-20261011/native-file-controls.json)
corrupt one byte in a separate archive copy and refuse it through the actual
file comparison. `finally` restores the byte. The accepted target stays unchanged.
A wrong password against this encrypted repository refuses with exit 12.

The restored app identifies bf1f6ffa through native health, W4maaz9jts1wco0KXcWbA
through the retained build, and the owned app checkout through actual process
CWDs. T3 authenticated Dashboard navigation and a Data Hub link click work at
1280px; DOM text retains the unadopted CTA and saved transit records. Repeated
snapshots fail on both the existing and a fresh owned T3 tab. Recording start
times out, then T3 reports no automation host. The
[browser limit](expanded-local-point-20261011/restored-browser-limit.json)
retains that outcome. No new screenshots, video, 390px evidence or complete console
review are accepted. The exact owned app stops afterward. Earlier bf1 visual
evidence keeps its original fixture identity. No alternate browser is used. A separate post-browser native read preserves all
non-Auth tables, including transit, project and model records, and the schema.
Four Auth tables differ after the browser read; the record does not assign those
changes to a specific request. Three extracted census/non-Auth/schema guard
controls pass. Their native read starts before the pure controls, so its
observation is accepted only after those controls pass.

## Source and acceptance limits

All four GitHub workflows pass for aca844a99: QA passes 21,774 tests in 1,579 files,
with 1,604 tests and 97 files skipped; shuffle executes and passes. Live RLS passes
1,499 tests with 125 skipped. The exact
[restore artifact](expanded-local-point-20261011/ci-aca-restore-artifact-verification.json)
retains 374 tables, six sequences, one 38-byte object, mounted-key verification,
preserved bootstrap and equal independently read OWP records. These are aca CI
results, separate from the local bf1 point. The external acc18ee80 main join is
preserved by clean fast-forward; newer-source verification remains separate.

This is same-host and same-cluster engineering evidence for known GTFS roots.
It captures roles and key bytes but reuses them, rather than rebuilding another
cluster. File modes are checked; directory metadata is outside the file census.
The roots contain no populated SQLite/WAL. Other worker-family artifacts, long
demand computation, physical-host loss, clean agency installation, complete
restored browser acceptance and practitioner acceptance remain open. Existing
model rows are retained data; no scientific claim changes.

The relaunch agent retains hosted coordination and the main-merge hold. This lane
does not apply hosted migrations, merge main, publish a release or close M3/v1.
