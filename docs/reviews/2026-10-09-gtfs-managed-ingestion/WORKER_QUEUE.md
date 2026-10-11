# Recoverable transit worker polling

October 10 development checkpoint. Roadmap M3 continues in the owned branch.
Application import routes remain synchronous and unenrolled. Migration 28 is an
unreleased candidate. This checkpoint does not adopt feeds or establish release
readiness.

`managed-worker-queue.ts` joins database candidates and private retained jobs.
One installation lock serializes bounded passes. A durable rotating cursor
interleaves retained failures and the returned candidate page. Private job identity precedes
claiming. Installation, database target, version, permissions and file ownership
remain checked. An existing attempt recovers its exact command journal even when
a live lease or a committed terminal state excludes it from database candidates.

A replacement requires current eligibility and a fresh SQL claim. Eligibility
alone grants no authority. Its new command and parser directories retain the
old attempt's files. A version-scoped source directory shares the original
bytes. A later terminal attempt becomes an observed terminal state without
replaying an older unresolved terminal command. Unavailable replies retain
unconfirmed work instead of manufacturing feed failure or adoption.

`npm run worker:gtfs-ingestion` polls serial passes. `--once` runs a bounded pass,
not a full queue drain. `--help` works without credentials. SIGINT and SIGTERM
cancel source, parser and transport work. Configure and retain
`OPENPLAN_GTFS_INSTALLATION_ID`, `OPENPLAN_GTFS_PARSER_BUILD` and an absolute
private `OPENPLAN_GTFS_WORK_DIR`, plus the existing Supabase service configuration.
The target URL determines a separate directory. The parser build is an explicit
40 to 64 character lowercase hexadecimal identity. Retain original configuration,
source bytes, old attempts and journals across service restarts. Do not point
this candidate worker at the demo or an installation without candidate migration
28.

## Verification and limits

[Queue controls](queue-controls.json) record 32 runs: baseline, harmless comment
and restored source pass; 29 deliberately broken variants fail the intended
assertions. Controls cover retained recovery, terminal settling, replacement
eligibility/history/source, fairness, all identity bindings, private directories,
symlinks, caps, shutdown, locking, diagnostics, polling and CLI configuration.
The runner restores source in `finally`. The final run takes 73.2 seconds and
peaks at 273.6 MiB. An earlier polling-stop variant survives because its test
only stops after reporting. A new stop-during-queue-read case detects that
behavior. The incomplete earlier control run is not counted here.

[Native queue recovery](queue-native.json) uses actual PostgreSQL, PostgREST,
Storage, owned loopback HTTP and the production BART parser. An owned process
group stops after archive preparation commits but before its reply reaches the
journal. A new process recovers the live attempt even with zero database
candidates. A second case waits 120.2 seconds for actual server-clock expiry,
without changing the fixture timestamp. A successor obtains attempt 2 and the
old token cannot renew or stage while that successor is running. Both recoveries
make zero publisher requests, publish 95 route rows and 717 stop rows in nine
batches, and retain exactly one completion receipt. Neither adopts the version.
A final pass does no work and changes none of those observed states.

The native service takes 136.1 seconds and peaks at 160 MiB, with separately
bounded database gateway and Storage containers. Two earlier native runs leave
the replacement unconfirmed because the proof's fencing probes use table URLs
instead of RPC URLs. Corrected probes pass in a diagnostic run with synthetic
expiry. That diagnostic is not real-clock acceptance; the linked final run uses
actual expiry. All proof databases remain retained.

Scoped TypeScript and changed-file lint pass separately. [Regression results](queue-tests.json) record 50 files and 1,237 tests:
1,220 pass, 17 live-database cases remain skipped and none fail. The final
bounded service takes 64.2 seconds and peaks at 387.4 MiB. Controlled queue tests do not establish
live database policy. Native evidence uses the retained main-derived clone with
399 migrations and candidate DDL applied separately; it is not a fresh official
CLI installation or a full archive restore. Local HTTP does not establish public
DNS/TLS. The current database list returns its first bounded eligible page. Persistent
errors in that page can hide later candidates; paginated discovery is still
required before unattended full-backlog operation. Complete route/actor
enrollment, live role checks, worker CLI operation,
capacity, retention cleanup, upgrade/restore, T3 desktop and 390px journeys,
practitioner observation, full branch CI and release verification remain open.

Reproduce with new private output directories and no concurrent source mutation:

```bash
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_queue_controls.py /private/new-controls
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_queue_native.py \
  /private/reconciliation-database.json /private/bart.zip /private/new-native-proof
```
